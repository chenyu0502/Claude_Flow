# Claude Flow

帶使用者管理與 OAuth 認證的全端應用：React 18 + Vite + TypeScript + Firebase（Auth + Firestore），部署於 Vercel。

- 登入方式：Google、GitHub、Email/密碼；同一 email 用不同方式登入時自動綁定
- 個人資料：編輯顯示名稱與頭像、綁定/解除登入方式
- 管理員後台（`/admin/users`）：搜尋、篩選、調整角色、停用帳號
- **台股分析（`/stock/`，僅管理員）**：持股、績效、個股分析與 AI 解讀，由原「台股分析」專案併入
- 權限由 Firestore Security Rules 把關（見 `firestore.rules`，規格見 `CONTRACTS.md`）

## 台股分析的架構

台股分析是同網域下的**獨立頁面**，不是 Claude Flow 的 React 路由：

| | Claude Flow 本體 | 台股分析 |
|---|---|---|
| 入口 | `index.html` → `src/main.tsx` | `stock/index.html` → `src/stock/main.jsx` |
| 技術 | TypeScript、純 CSS | JavaScript、Redux、Tailwind（原樣沿用） |
| 資料 | `users/{uid}` | `portfolios/{uid}` |
| 後端 | 無 | `api/*.js`（Vercel serverless function） |

- **分開的原因**：Tailwind 的全域重設樣式（preflight）與 Claude Flow 的樣式會互相覆蓋，獨立頁面讓兩邊完全隔離。
- **共用登入**：兩頁共用 `src/lib/firebase.ts` 的同一個 Firebase 實例，同網域的登入狀態自動共通。
- **管理員限定**：`src/stock/main.jsx` 先確認 `users/{uid}` 為未停用的 admin，才啟動雲端同步並顯示畫面。權限確認前絕不同步，否則同一台電腦上前一位使用者的本機持股可能被寫進別人的雲端文件。
- **後端 API 也只開放給管理員**：前端每個請求都帶 Firebase ID token，`api/_lib/auth.js` 拿這個 token 去讀 Firestore 的 `users/{uid}`。token 偽造或過期時 Google 會直接拒絕，讀到的文件同時用來確認是未停用的 admin。不需要 service account 金鑰。驗證結果快取 60 秒，所以被降級的管理員最多還能呼叫 60 秒。
- **API 回應不經 Vercel 邊緣快取**：成功回應只允許瀏覽器快取（`private, max-age=30`）。邊緣快取命中的請求不會進到函式，等於繞過登入驗證。

## 本地開發（Emulator，不需要真的 Firebase 專案）

需要 Node 20+ 與 **Java 21+**（Firestore Emulator 需要）。

```bash
npm install
cp .env.example .env.local      # 保留 VITE_USE_EMULATOR=true
npm run emulators               # 終端機 1：Auth :9099、Firestore :8080、UI :4000
node scripts/seed-emulator.mjs  # 終端機 2：建立 admin@example.com / user@example.com（密碼 password123）
npm run dev                     # 終端機 3：http://localhost:5173（台股：http://localhost:5173/stock/）
```

- Emulator 下點 Google / GitHub 登入會彈出 Emulator 的假登入視窗，可以隨意輸入 email 測試。
- 台股的 `/api/*` 在開發模式由 `vite-plugin-local-api.js` 掛在 dev server 上，會連到真正的上游（證交所、Yahoo、FinMind）。`.env.local` 填了 `FINMIND_TOKEN`、`GEMINI_API_KEY` 才有三大法人、估值與 AI 解讀。

## 測試

```bash
npm test             # 單元 / 元件測試（Vitest + Testing Library）
npm run test:rules   # Security Rules 測試（會自動啟動 Firestore Emulator，需要 Java；Emulator 已開著時要先關掉）
npm run typecheck
```

## 部署（Firebase 專案 myfirebase-22090 + Vercel）

沿用原台股分析的 Firebase 專案，你用同一個 Google 帳號登入就會看到原本的持股。

1. **發布規則**：`firestore.rules` 已包含 `myfirebase-22090` 上全部三段規則（`users`、`portfolios`，以及台股損益存摺 HanDan 手機端用的 `handan`，2026-11-12 從 Console 併入）。把整份貼到 Console → Firestore → 規則 發布，或執行 `npx firebase deploy --only firestore:rules --project myfirebase-22090`。之後改規則一律改這個檔案，不要只在 Console 上改，否則下次部署會被覆蓋。
2. **Authentication → Sign-in method**：Google 已啟用；要用 Email/密碼或 GitHub 再另外啟用（GitHub 需先到 GitHub → Settings → Developer settings → OAuth Apps 新建，Callback URL 填 `https://myfirebase-22090.firebaseapp.com/__/auth/handler`）。
3. **Authentication → Settings → Authorized domains**：加入 Claude Flow 的 Vercel 網域。
4. **Vercel**：匯入 GitHub repo，框架選 Vite，環境變數填 `VITE_FIREBASE_*`（`VITE_USE_EMULATOR=false`）、`FINMIND_TOKEN`、`GEMINI_API_KEY`。`vercel.json` 已設定好 `/stock/` 與 SPA 的轉址規則、API 路徑排除。
5. **第一個管理員**：用 Google 帳號登入 Claude Flow 一次，到 Firestore 控制台把 `users/{你的 uid}` 的 `role` 改為 `admin`。

原台股分析網站（tw-stock-analysis.vercel.app）與這裡讀寫同一份 `portfolios` 資料，可以並行使用，確認新版沒問題再停用。

## 已知限制

- **停用只在應用層生效**：被停用的人仍能透過 Firebase Auth 登入，但會被守衛攔在停用提示頁，也無法寫入資料。要真正封鎖登入需 Admin SDK（Cloud Functions，需 Blaze 方案）。
- Firebase 預設「一個 email 一個帳號」：先用 Email/密碼註冊、後用同 email 的 Google 登入時，Google 作為可信提供方會取代未驗證的密碼登入方式（Firebase 本身的行為）。
- 本機 Emulator 不驗證 token 簽章，偽造 token 的防護只在正式環境（真正的 Firestore）成立；自動測試以模擬 Firestore 回應涵蓋這部分。
- 台股與原網站同時開著時，雲端同步有原專案已知的 2 秒競態窗口（同時在兩邊改帳上現金或統計起算日，可能被另一邊蓋回）。
