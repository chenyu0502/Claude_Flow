/**
 * 旅遊規劃（/travel/）的行程存取：Firestore trips/{tripId}。
 *
 * 旅遊規劃本身是另一個 repo 的純靜態網頁，不載入 Firebase。登入檢查（travel-gate.ts）通過後，
 * 把這裡的函式以 window.ClaudeFlowTravel 提供給它使用（規格見 TravelBridge）。
 * 權限由 firestore.rules 的 trips 規則把關：知道 ID 的登入使用者可讀，只有建立者可改、可刪。
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';

/** 行程 JSON 字串長度上限，與 firestore.rules 的 validTrip 一致 */
export const TRIP_JSON_MAX = 300000;
export const TRIP_TITLE_MAX = 100;
export const OWNER_NAME_MAX = 50;

export interface TripSummary {
  id: string;
  title: string;
  updatedAt: string | null;
}

export interface TripRecord extends TripSummary {
  ownerUid: string;
  ownerName: string | null;
  /** 行程內容（旅遊規劃的手冊物件） */
  data: unknown;
  isOwner: boolean;
}

/** 航班查詢的條件（/api/travel/flights） */
export interface FlightSearchParams {
  airline: string;
  from: string;
  to: string;
  outDate?: string;
  backDate?: string;
}

/** 航班查詢的結果；available 為 false 時 reason 說明原因 */
export interface FlightSearchResult {
  available: boolean;
  reason?: string;
  airline?: string;
  outbound?: unknown[];
  inbound?: unknown[];
  note?: string;
  sources?: { title: string; uri: string }[];
  model?: string;
  fetchedAt?: string;
}

/** 提供給旅遊規劃頁面的介面（window.ClaudeFlowTravel） */
export interface TravelBridge {
  user: { uid: string; name: string | null };
  /** 由後端（Gemini＋Google 搜尋）查詢某家航空在出發日、回程日的直飛航班 */
  searchFlights(params: FlightSearchParams): Promise<FlightSearchResult>;
  listMyTrips(): Promise<TripSummary[]>;
  getTrip(id: string): Promise<TripRecord | null>;
  /** id 為 null 時新增並回傳新 ID；否則更新自己的行程 */
  saveTrip(id: string | null, data: unknown): Promise<string>;
  deleteTrip(id: string): Promise<void>;
}

const iso = (t: unknown) => ((t as Timestamp | null)?.toDate?.() ?? null)?.toISOString() ?? null;

/** 從行程內容取出標題，截到規則允許的長度；沒有標題時用預設名稱 */
export function tripTitle(data: unknown): string {
  const raw = (data as { title?: unknown } | null)?.title;
  const title = typeof raw === 'string' ? raw.trim() : '';
  return (title || '未命名行程').slice(0, TRIP_TITLE_MAX);
}

/** 行程內容轉成存檔字串；過大時直接報錯，不送出注定被規則拒絕的寫入 */
export function serializeTrip(data: unknown): string {
  const json = JSON.stringify(data);
  if (!json || json === 'null') throw new Error('行程內容是空的');
  if (json.length > TRIP_JSON_MAX) throw new Error('行程內容太大，請減少天數或內容後再存');
  return json;
}

/**
 * 呼叫 /api/travel/flights。登入憑證由 Claude Flow 取得並帶在 Authorization 標頭，
 * 旅遊規劃頁面不需要處理登入。失敗時一律回傳 available: false 與可讀的原因，不丟出例外。
 */
export async function searchFlights(
  getIdToken: () => Promise<string>,
  params: FlightSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<FlightSearchResult> {
  let token: string;
  try {
    token = await getIdToken();
  } catch {
    return { available: false, reason: '無法取得登入狀態，請重新整理頁面後再試。' };
  }
  let res: Response;
  try {
    res = await fetchImpl('/api/travel/flights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    });
  } catch {
    return { available: false, reason: '連不上伺服器，請確認網路後再試。' };
  }
  let body: Partial<FlightSearchResult> & { error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 回應（例如逾時的 504） */
  }
  if (!res.ok) return { available: false, reason: body.error || `查詢失敗（HTTP ${res.status}），請稍後再試。` };
  return { available: !!body.available, ...body } as FlightSearchResult;
}

export function createTravelBridge(
  db: Firestore,
  user: { uid: string; name: string | null },
  getIdToken: () => Promise<string> = async () => {
    throw new Error('no token');
  },
): TravelBridge {
  const trips = collection(db, 'trips');
  const ownerName = user.name ? user.name.slice(0, OWNER_NAME_MAX) : null;

  return {
    user,

    searchFlights: (params) => searchFlights(getIdToken, params),

    async listMyTrips() {
      // 只用 ownerUid 篩選、在前端排序，不需要額外建立複合索引。
      const snap = await getDocs(query(trips, where('ownerUid', '==', user.uid)));
      return snap.docs
        .map((d) => ({ id: d.id, title: String(d.get('title') ?? ''), updatedAt: iso(d.get('updatedAt')) }))
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    },

    async getTrip(id) {
      const snap = await getDoc(doc(trips, id));
      if (!snap.exists()) return null;
      const d = snap.data();
      let data: unknown = null;
      try {
        data = JSON.parse(String(d.json));
      } catch {
        throw new Error('這份行程的內容已損壞，無法開啟');
      }
      return {
        id: snap.id,
        title: String(d.title ?? ''),
        updatedAt: iso(d.updatedAt),
        ownerUid: String(d.ownerUid),
        ownerName: (d.ownerName as string | null) ?? null,
        data,
        isOwner: d.ownerUid === user.uid,
      };
    },

    async saveTrip(id, data) {
      const json = serializeTrip(data);
      const title = tripTitle(data);
      if (id) {
        await updateDoc(doc(trips, id), { title, json, ownerName, updatedAt: serverTimestamp() });
        return id;
      }
      const ref = doc(trips);
      await setDoc(ref, {
        ownerUid: user.uid,
        ownerName,
        title,
        json,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return ref.id;
    },

    async deleteTrip(id) {
      await deleteDoc(doc(trips, id));
    },
  };
}
