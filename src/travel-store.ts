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

/** 飯店查詢的條件（/api/travel/hotels） */
export interface HotelSearchParams {
  area: string;
  city?: string;
  checkIn?: string;
  checkOut?: string;
  adults: number;
  seniors?: number;
  kids?: number;
  kidAges?: string;
  level?: string;
  budgetPerNight?: number;
  notes?: string;
}

/** 飯店查詢的結果；available 為 false 時 reason 說明原因 */
export interface HotelSearchResult {
  available: boolean;
  reason?: string;
  area?: string;
  checkIn?: string;
  checkOut?: string;
  hotels?: unknown[];
  note?: string;
  sources?: { title: string; uri: string }[];
  model?: string;
  fetchedAt?: string;
}

/** 景點門票查詢的條件（/api/travel/tickets） */
export interface TicketSearchParams {
  attractions: { name: string; date?: string; place?: string }[];
  city?: string;
  adults: number;
  seniors?: number;
  kids?: number;
  kidAges?: string;
}

/** 景點門票查詢的結果；available 為 false 時 reason 說明原因 */
export interface TicketSearchResult {
  available: boolean;
  reason?: string;
  attractions?: unknown[];
  note?: string;
  sources?: { title: string; uri: string }[];
  model?: string;
  fetchedAt?: string;
}

/** 交通票券分析的條件（/api/travel/transport） */
export interface TransportSearchParams {
  legs: { day: number; date?: string; from?: string; to?: string; mode?: string; title?: string }[];
  city?: string;
  adults: number;
  seniors?: number;
  kids?: number;
  kidAges?: string;
  knownPasses?: string[];
}

/** 交通票券分析的結果；available 為 false 時 reason 說明原因 */
export interface TransportSearchResult {
  available: boolean;
  reason?: string;
  strategy?: string;
  strategyTotalTwd?: number | null;
  passes?: unknown[];
  note?: string;
  sources?: { title: string; uri: string }[];
  model?: string;
  fetchedAt?: string;
}

/** 餐廳查詢的條件（/api/travel/restaurants） */
export interface RestaurantSearchParams {
  area: string;
  city?: string;
  date?: string;
  time?: string;
  meal?: string;
  cuisine?: string;
  budgetPerPersonTwd?: number;
  diet?: string;
  notes?: string;
  adults: number;
  seniors?: number;
  kids?: number;
  kidAges?: string;
}

/** 餐廳查詢的結果；available 為 false 時 reason 說明原因 */
export interface RestaurantSearchResult {
  available: boolean;
  reason?: string;
  area?: string;
  date?: string;
  time?: string;
  meal?: string;
  restaurants?: unknown[];
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
  /** 由後端（Gemini＋Google 搜尋）查詢某個地區或景點附近的飯店 */
  searchHotels(params: HotelSearchParams): Promise<HotelSearchResult>;
  /** 由後端（Gemini＋Google 搜尋）查詢景點門票（一次最多 8 個） */
  searchTickets(params: TicketSearchParams): Promise<TicketSearchResult>;
  /** 由後端（Gemini＋Google 搜尋）依行程的移動段分析交通票券 */
  searchTransport(params: TransportSearchParams): Promise<TransportSearchResult>;
  /** 由後端（Gemini＋Google 搜尋）查詢某個地點附近的餐廳與訂位方式 */
  searchRestaurants(params: RestaurantSearchParams): Promise<RestaurantSearchResult>;
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
export function searchFlights(
  getIdToken: () => Promise<string>,
  params: FlightSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<FlightSearchResult> {
  return callTravelApi<FlightSearchResult>('/api/travel/flights', getIdToken, params, fetchImpl);
}

/** 呼叫 /api/travel/hotels，行為同 searchFlights。 */
export function searchHotels(
  getIdToken: () => Promise<string>,
  params: HotelSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<HotelSearchResult> {
  return callTravelApi<HotelSearchResult>('/api/travel/hotels', getIdToken, params, fetchImpl);
}

/** 呼叫 /api/travel/tickets，行為同 searchFlights。 */
export function searchTickets(
  getIdToken: () => Promise<string>,
  params: TicketSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<TicketSearchResult> {
  return callTravelApi<TicketSearchResult>('/api/travel/tickets', getIdToken, params, fetchImpl);
}

/** 呼叫 /api/travel/transport，行為同 searchFlights。 */
export function searchTransport(
  getIdToken: () => Promise<string>,
  params: TransportSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<TransportSearchResult> {
  return callTravelApi<TransportSearchResult>('/api/travel/transport', getIdToken, params, fetchImpl);
}

/** 呼叫 /api/travel/restaurants，行為同 searchFlights。 */
export function searchRestaurants(
  getIdToken: () => Promise<string>,
  params: RestaurantSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<RestaurantSearchResult> {
  return callTravelApi<RestaurantSearchResult>('/api/travel/restaurants', getIdToken, params, fetchImpl);
}

async function callTravelApi<T extends { available: boolean; reason?: string }>(
  path: string,
  getIdToken: () => Promise<string>,
  params: object,
  fetchImpl: typeof fetch,
): Promise<T> {
  let token: string;
  try {
    token = await getIdToken();
  } catch {
    return { available: false, reason: '無法取得登入狀態，請重新整理頁面後再試。' } as T;
  }
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    });
  } catch {
    return { available: false, reason: '連不上伺服器，請確認網路後再試。' } as T;
  }
  let body: Partial<T> & { error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 回應（例如逾時的 504） */
  }
  if (!res.ok) return { available: false, reason: body.error || `查詢失敗（HTTP ${res.status}），請稍後再試。` } as T;
  return { available: !!body.available, ...body } as T;
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
    searchHotels: (params) => searchHotels(getIdToken, params),
    searchTickets: (params) => searchTickets(getIdToken, params),
    searchTransport: (params) => searchTransport(getIdToken, params),
    searchRestaurants: (params) => searchRestaurants(getIdToken, params),

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
