# Claude Flow

帶使用者管理與 OAuth 認證的全端應用：React 18 + Vite + TypeScript + Firebase（Auth + Firestore），部署於 Vercel。

- 登入方式：Google、GitHub、Email/密碼；同一 email 用不同方式登入時自動綁定
- 個人資料：編輯顯示名稱與頭像、綁定/解除登入方式；有設定密碼的帳號可修改密碼（需先輸入目前的密碼）
- **Email 驗證**：只用 Email/密碼註冊的帳號要先點驗證信連結，才能使用各項功能。主站守衛、`/stock/`、`/interior/`、`/travel/`、`/api/*` 與 Firestore 規則（`portfolios`）都會檢查，判斷邏輯一致（`src/auth/emailVerification.ts`）。Google、GitHub 登入不受影響
- 管理員後台（`/admin/users`）：搜尋、篩選、調整角色、停用帳號
- **登入紀錄與操作日誌**（Firestore `auditLogs`）：登入、登出、註冊、改密碼、綁定／解除登入方式、修改個人資料、管理員調整角色與停用帳號。管理員在 `/admin/logs` 看全部；每個人在個人資料頁看自己最近 10 筆
- **台股分析（`/stock/`）**、**室內設計（`/interior/`）**、**旅遊規劃（`/travel/`）**、**動畫製作（`/animate/`）**：所有登入的使用者都能用，各自在獨立的 repo 開發（見下方「子網站」）
- 權限由 Firestore Security Rules 把關（見 `firestore.rules`，規格見 `CONTRACTS.md`）

## 子網站：台股分析、室內設計、旅遊規劃與動畫製作

四個子網站都在**自己的 repo 開發**，Claude Flow 不放它們的程式碼，只負責登入、使用者管理與權限：

| | 台股分析 `/stock/` | 室內設計 `/interior/` | 旅遊規劃 `/travel/` | 動畫製作 `/animate/` |
|---|---|---|---|---|
| repo | [`tw-stock-analysis`](https://github.com/chenyu0502/tw-stock-analysis) | [`Interior_Decoration`](https://github.com/chenyu0502/Interior_Decoration) | [`travel-planner`](https://github.com/chenyu0502/travel-planner) | [`animation-studio`](https://github.com/chenyu0502/animation-studio) |
| 類型 | React + Vite，有後端 API（`/api/*`） | 純靜態網頁 | 純靜態網頁（不呼叫任何 API） | 純靜態網頁；劇本由 Claude Flow 的 `/api/animate/script` 請 Gemini 生成 |
| 怎麼接上 Claude Flow | `vercel.json` 把 `/stock/*`、`/api/*` **轉送**到台股自己的 Vercel 專案（tw-stock-analysis.vercel.app） | 每次建置時 `scripts/fetch-interior.mjs` 下載最新的 `main`，放進 `public/interior/` | 每次建置時 `scripts/fetch-travel.mjs` 下載最新的 `main`，放進 `public/travel/` | 每次建置時 `scripts/fetch-animate.mjs` 下載最新的 `main`，放進 `public/animate/` |
| 更新怎麼上線 | 台股 repo 合併到 `master` 部署完就生效，Claude Flow 不用重新部署 | 室內設計 repo 合併到 `main` 後，GitHub Actions 透過 Deploy Hook 通知 Claude Flow 重新部署 | 同室內設計（Deploy Hook，Secret 名稱 `VERCEL_DEPLOY_HOOK`） | 同室內設計（Deploy Hook，Secret 名稱 `VERCEL_DEPLOY_HOOK`） |
| 公開頁面 | 無 | 唯讀分享連結（`#share=`、`?g=`）與 `ar.html` 不需登入 | 無，一律要求登入（行程含出發日期與住宿） | 無，一律要求登入 |

- **共用登入**：瀏覽器看到的都是 Claude Flow 的網域，兩個子網站與 Claude Flow 使用同一個 Firebase 專案與設定，登入狀態自動共用。台股專案的 `VITE_FIREBASE_*` 必須與 Claude Flow 完全相同。
- **權限**：子網站都先確認 `users/{uid}` 存在、未停用、Email 已驗證（Email/密碼帳號），才顯示畫面。這份判斷有兩份（Claude Flow 的 `src/auth/emailVerification.ts`、`src/subsite-access.ts`；台股的 `src/claudeFlow/`），**改登入規則時兩邊要一起改**。
- **靜態子網站的共用流程**：下載與插入登入檢查在 `scripts/fetch-subsite.mjs`，登入檢查在 `src/subsite-gate.ts`；各子網站只有一個設定檔（`scripts/fetch-<名稱>.mjs`）與一個入口（`src/<名稱>-gate.ts`）。要新增靜態子網站，照旅遊規劃的做法加這兩個檔案，再補 `vite.config.ts` 的 `STATIC_SUBSITES`、`vercel.json` 的轉址、`package.json` 的 `predev` 與 `build`、`.gitignore`。
- **Firestore 規則只有一份**，在本 repo 的 `firestore.rules`，包含台股的 `portfolios`。台股 repo 不放規則。
- 台股的架構細節（持股隔離、API 登入驗證、Gemini 金鑰）見台股 repo 的 README。
- **旅遊規劃的航班查詢（`POST /api/travel/flights`）**：照台股分析的後端做法（`api/_lib/auth.js`、`http.js`、`adapter.js` 沿用自台股），只開放給登入且未停用的使用者。後端呼叫 Gemini 並開啟 Google 搜尋，查指定航空公司在出發日、回程日的直飛航班，回傳航班、來源網頁與使用的模型。金鑰：請求帶 `X-Gemini-Key` 時用使用者自己的，否則用 Claude Flow Vercel 專案的 `GEMINI_API_KEY`（可與台股使用同一把免費金鑰）。旅遊規劃頁面透過 `window.ClaudeFlowTravel.searchFlights()` 呼叫，不處理登入。`vercel.json` 讓 `/api/travel/*` 留在本專案，其餘 `/api/*` 照舊轉送台股。
- **旅遊規劃的飯店查詢（`POST /api/travel/hotels`）**：與航班查詢同一套做法（登入驗證、Gemini＋Google 搜尋、同一把金鑰），依地區或景點、入住與退房日期、旅伴組成與預算，查附近的飯店，回傳區域、交通、全體每晚參考價、房型、評分、優缺點與來源。旅遊規劃頁面透過 `window.ClaudeFlowTravel.searchHotels()` 呼叫。
- **旅遊規劃的景點門票查詢（`POST /api/travel/tickets`）**：同一套做法，一次最多查 8 個景點：預約狀態（必須預約、建議預約、現場購票、免費）、票種與當地貨幣價格、旅伴合計（新台幣，附匯率）、營業時間與公休日、入場時段、開賣規則、購買管道與來源。網站不代售門票。旅遊規劃頁面透過 `window.ClaudeFlowTravel.searchTickets()` 呼叫。
- **旅遊規劃的交通票券分析（`POST /api/travel/transport`）**：同一套做法，網頁送出行程中的移動段（最多 40 段），後端查詢周遊券、IC 卡、機場交通與需劃位的車票，與單買比較後回傳整體策略與推薦組合合計，以及每種票券的類型、建議（推薦／可考慮／不需要）、適用範圍、效期、使用天數、價格與全體合計、省多少、購買方式、是否需預約、購買管道與來源。網站不代售票券。旅遊規劃頁面透過 `window.ClaudeFlowTravel.searchTransport()` 呼叫。
- **旅遊規劃的餐廳查詢（`POST /api/travel/restaurants`）**：同一套做法，依地區或景點、日期與時間、用餐時段、料理、每人預算、飲食限制與旅伴，查附近的餐廳：料理、交通、每人價位與全體估算、多網站評比、訂位需求與方式、開放訂位時間、營業與公休、招牌菜、親子與飲食限制說明、管道與來源。網站不代為訂位。旅遊規劃頁面透過 `window.ClaudeFlowTravel.searchRestaurants()` 呼叫。
- **Gemini 額度用完自動換模型**（`api/_lib/gemini-search.js`）：先試預設備援鏈（`DEFAULT_MODEL` + `FALLBACK_MODELS`），再接上這把金鑰實際可用的其他 Gemini 文字模型（列模型清單、快取 6 小時，新版本優先、pro 最後），最多 10 個、受 52 秒預算限制。額度用完的模型在同一個函式實例內 1 小時（每分鐘限制則 2 分鐘）排到最後。改用備援模型時，結果的 `note` 開頭會註記、並回傳 `fallbackFrom`；全部用完時說明試過幾個模型。
- **旅遊規劃的使用者金鑰**：使用者可在旅遊規劃頁面輸入自己的 Gemini 金鑰（只存在瀏覽器、依帳號分開）。`TravelBridge` 的各查詢方法接受 `{ geminiKey }`，以 `X-Gemini-Key` 標頭送出，後端優先使用（`flights.js` 的 `resolveKey`）。`POST /api/travel/key-check` 只列出金鑰可用的模型來確認有效，不消耗查詢額度。
- **旅遊規劃的行程（Firestore `trips/{tripId}`）**：旅遊規劃本身不載入 Firebase。`src/travel-gate.ts` 通過登入檢查後，把 `src/travel-store.ts` 的存取介面以 `window.ClaudeFlowTravel` 提供給它。分享方式是「知道連結就能看」：登入且未停用的使用者可以用 ID 讀單一份行程，但只能列出自己的行程；只有建立者能修改與刪除（規則與測試：`firestore.rules`、`tests/rules/trips.rules.test.ts`）。

## 動畫製作的劇本生成

- **`POST /api/animate/script`**（`api/_lib/animate.js`）：使用者用幾句話描述故事，後端請 Gemini 寫成動畫劇本 JSON（不開 Google 搜尋，`gemini-search.js` 的 `search: false`）。登入驗證、金鑰（`X-Gemini-Key` 優先，否則用網站的 `GEMINI_API_KEY`）與錯誤說明沿用旅遊規劃。模型順序與旅遊規劃不同：不上網時 `gemini-3.7-flash` 常常超過 120 秒不回應，所以依序試 `gemini-3-flash-preview` → `gemini-3.6-flash` → `gemini-3.7-flash`，每個最多等 22 秒，整個請求（含劇本不完整時的重試）共用 52 秒預算；可用 `ANIMATE_GEMINI_MODEL` 指定第一個模型（`GEMINI_MODEL` 只影響旅遊規劃）。
- **詞彙表有兩份**：提示詞裡的角色、動作、場景、道具清單（`api/_lib/animate.js` 的 `VOCAB`）要和 animation-studio 的 `js/engine/script.js` 一致；網頁端拿到劇本後會再檢查，不認得的換成最接近的並告訴使用者。
- **介面**：`src/animate-gate.ts` 通過登入檢查後提供 `window.ClaudeFlowAnimate`（`src/animate-api.ts`：`uid`、`writeScript(prompt, { duration, geminiKey })`）。畫面、畫風、配樂與 MP4 匯出全部在 animation-studio，在使用者的瀏覽器裡進行。

## 本地開發（Emulator，不需要真的 Firebase 專案）

需要 Node 20+ 與 **Java 21+**（Firestore Emulator 需要）。

```bash
npm install
cp .env.example .env.local      # 保留 VITE_USE_EMULATOR=true
npm run emulators               # 終端機 1：Auth :9099、Firestore :8080、UI :4000
node scripts/seed-emulator.mjs  # 終端機 2：建立 admin@example.com / user@example.com（密碼 password123）
npm run dev                     # 終端機 3：http://localhost:5173
```

- Emulator 下點 Google / GitHub 登入會彈出 Emulator 的假登入視窗，可以隨意輸入 email 測試。
- **連同台股一起開發**：在 `tw-stock-analysis` 執行 `npm run dev`（:5174），本機的 `/stock/`、`/api/*` 會轉送過去（`vite.config.ts` 的 proxy，網址可用 `STOCK_DEV_URL` 覆寫），和正式環境一樣同網域、共用登入。兩邊連同一個 Emulator 即可。沒開台股的開發伺服器時，`/stock/` 會顯示錯誤，不影響其他頁面。

## 測試

```bash
npm test             # 單元 / 元件測試（Vitest + Testing Library）
npm run test:rules   # Security Rules 測試（會自動啟動 Firestore Emulator，需要 Java；Emulator 已開著時要先關掉）
npm run typecheck
```

## 部署（Firebase 專案 myfirebase-22090 + Vercel）

沿用原台股分析的 Firebase 專案，你用同一個 Google 帳號登入就會看到原本的持股。

1. **發布規則與索引**：規則見下；個人資料頁的「帳號活動」需要 `auditLogs`（`actorUid` + `createdAt`）的複合索引，定義在 `firestore.indexes.json`，用 `npx firebase deploy --only firestore --project myfirebase-22090` 會一起建立。**規則**：`firestore.rules` 已包含 `myfirebase-22090` 上的全部規則（`users`、`auditLogs`、`portfolios`、旅遊規劃的 `trips`，以及台股損益存摺 HanDan 手機端用的 `handan`，2026-11-12 從 Console 併入）。把整份貼到 Console → Firestore → 規則 發布，或執行 `npx firebase deploy --only firestore:rules --project myfirebase-22090`。之後改規則一律改這個檔案，不要只在 Console 上改，否則下次部署會被覆蓋。
2. **Authentication → Sign-in method**：Google 已啟用；要用 Email/密碼或 GitHub 再另外啟用（GitHub 需先到 GitHub → Settings → Developer settings → OAuth Apps 新建，Callback URL 填 `https://myfirebase-22090.firebaseapp.com/__/auth/handler`）。
3. **Authentication → Settings → Authorized domains**：加入 Claude Flow 的 Vercel 網域。
4. **Vercel**：匯入 GitHub repo，框架選 Vite，環境變數填 `VITE_FIREBASE_*`（`VITE_USE_EMULATOR=false`），旅遊規劃的航班查詢另需 `GEMINI_API_KEY`（選填，可選 `GEMINI_MODEL` 覆寫模型）。`FINMIND_TOKEN`、`GEMINI_API_KEY` 屬於台股，設在台股的 Vercel 專案。`vercel.json` 已設定好 SPA 轉址、`/stock/` 與 `/api/` 轉送到台股專案，以及 `/assets/` 的長期快取（檔名帶內容雜湊，改版就換檔名；唯一不帶雜湊的 `interior-gate.js` 排除在外，以免使用者一直拿到舊版登入檢查）。
5. **第一個管理員**：用 Google 帳號登入 Claude Flow 一次，到 Firestore 控制台把 `users/{你的 uid}` 的 `role` 改為 `admin`。

## 已知限制

- **日誌由前端寫入**（Spark 方案沒有 Cloud Functions）：規則保證只能記自己的事、時間由伺服器決定、寫入後不能改也不能刪，管理員操作必須和實際變更同一批次寫入。但無法保證「每件事都有記」——有人直接呼叫 Firestore API 就能略過記錄；登入失敗（還沒有登入憑證）與 IP 位址也記不到。要做到完整稽核需要 Cloud Functions（Blaze 方案）。日誌不會自動刪除。

- **停用只在應用層生效**：被停用的人仍能透過 Firebase Auth 登入，但會被守衛攔在停用提示頁，也無法寫入資料。要真正封鎖登入需 Admin SDK（Cloud Functions，需 Blaze 方案）。
- Firebase 預設「一個 email 一個帳號」：先用 Email/密碼註冊、後用同 email 的 Google 登入時，Google 作為可信提供方會取代未驗證的密碼登入方式（Firebase 本身的行為）。
- 本機 Emulator 不驗證 token 簽章，偽造 token 的防護只在正式環境（真正的 Firestore）成立；自動測試以模擬 Firestore 回應涵蓋這部分。
- 台股透過轉送提供，每次請求多一段 Claude Flow → 台股專案的轉送，延遲增加約數十毫秒。
