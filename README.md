# Claude Flow

帶使用者管理與 OAuth 認證的全端應用：React 18 + Vite + TypeScript + Firebase（Auth + Firestore）。

- 登入方式：Google、GitHub、Email/密碼；同一 email 用不同方式登入時自動綁定
- 個人資料：編輯顯示名稱與頭像、綁定/解除登入方式
- 管理員後台（`/admin/users`）：搜尋、篩選、調整角色、停用帳號
- 權限由 Firestore Security Rules 把關（見 `firestore.rules`，規格見 `CONTRACTS.md`）

## 本地開發（Emulator，不需要真的 Firebase 專案）

需要 Node 20+ 與 **Java 21+**（Firestore Emulator 需要）。

```bash
npm install
cp .env.example .env.local      # 保留 VITE_USE_EMULATOR=true
npm run emulators               # 終端機 1：Auth :9099、Firestore :8080、UI :4000
node scripts/seed-emulator.mjs  # 終端機 2：建立 admin@example.com / user@example.com（密碼 password123）
npm run dev                     # 終端機 3：http://localhost:5173
```

Emulator 下點 Google / GitHub 登入會彈出 Emulator 的假登入視窗，可以隨意輸入 email 測試。

## 測試

```bash
npm test             # 單元 / 元件測試（Vitest + Testing Library）
npm run test:rules   # Security Rules 測試（會自動啟動 Firestore Emulator，需要 Java）
npm run typecheck
```

## 部署到正式 Firebase 專案

1. Firebase Console 建立專案，加入一個 Web 應用，把設定值填進 `.env.local`，並設 `VITE_USE_EMULATOR=false`。
2. Authentication → Sign-in method 啟用：
   - **Email/密碼**
   - **Google**
   - **GitHub**：先到 GitHub → Settings → Developer settings → OAuth Apps 新建，Callback URL 填 Console 給的 `https://<project>.firebaseapp.com/__/auth/handler`，再把 Client ID / Secret 填回 Console。
3. Authentication → Settings → Authorized domains 加入你的部署網域。
4. 建立 Firestore 資料庫，部署規則：`npx firebase deploy --only firestore:rules --project <project-id>`
5. 第一個管理員：自己先登入一次，到 Firestore 控制台把 `users/{你的 uid}` 的 `role` 改為 `admin`。
6. `npm run build && npx firebase deploy --only hosting --project <project-id>`

## 已知限制

- **停用只在應用層生效**：被停用的人仍能透過 Firebase Auth 登入，但會被守衛攔在停用提示頁，也無法寫入資料。要真正封鎖登入需 Admin SDK（Cloud Functions，需 Blaze 方案）。
- Firebase 預設「一個 email 一個帳號」：先用 Email/密碼註冊、後用同 email 的 Google 登入時，Google 作為可信提供方會取代未驗證的密碼登入方式（Firebase 本身的行為）。
- 打包後單一 JS chunk 超過 500 kB（主要是 Firebase SDK），之後可按路由做 code-split。
