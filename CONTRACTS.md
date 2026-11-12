# 共享契約（所有 Agent 必讀）

技術堆疊：React 18 + Vite 5 + TypeScript（strict）+ Firebase v11 modular SDK + react-router-dom v6。
UI 文案一律繁體中文（台灣用語）。共享樣式在 `src/styles.css`（`.container` `.card` `.btn` `.btn-primary` `.field` `.alert-error` `.badge` `.table` …），優先使用。

## 檔案歸屬（只改自己的檔案；需要改別人的檔案 → 在回報中說明，不要自己改）

| Agent | 負責檔案 |
|---|---|
| A 認證服務 | `src/services/auth.ts`、`src/services/auth.test.ts` |
| B 使用者資料 + 安全規則 | `src/services/users.ts`、`firestore.rules`、`tests/rules/**`、`scripts/seed-emulator.mjs` |
| C 認證狀態 + 路由守衛 | `src/auth/AuthContext.tsx`、`src/auth/guards.tsx`、`src/auth/*.test.tsx` |
| D 登入/註冊/重設密碼頁 | `src/pages/LoginPage.tsx`、`RegisterPage.tsx`、`ResetPasswordPage.tsx`、`src/pages/auth.css`、`src/components/OAuthButtons.tsx`、對應 `*.test.tsx` |
| E 版面 + 首頁 + 個人資料 | `src/components/Layout.tsx`、`src/components/NavBar.tsx`、`src/pages/HomePage.tsx`、`src/pages/ProfilePage.tsx`、`src/pages/profile.css`、對應 `*.test.tsx` |
| F 管理員後台 | `src/pages/admin/**` |

主控（我）負責：`package.json`、`tsconfig.json`、`vite.config.ts`、`App.tsx`、`src/lib/firebase.ts`、`src/types/user.ts`、`styles.css`。

**不得**：執行 `npm install` / 新增相依套件、改 package.json、git 操作。相依套件已裝好，可執行 `npx tsc --noEmit`、`npx vitest run <自己的測試檔案>`（需先補 PATH，見下）。

PowerShell 補 PATH：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`

## 資料模型

`users/{uid}` → `UserProfile`（見 `src/types/user.ts`）。

## 函式簽名

簽名已寫在各 stub 檔案中，**不可更改簽名**（其他 Agent 依賴它們）。可以新增 export。

- `src/services/auth.ts`：只操作 Firebase Auth，不碰 Firestore。
- `src/services/users.ts`：所有 Firestore 讀寫。
- `src/auth/AuthContext.tsx`：`onAuthStateChanged` → `ensureUserProfile(user)` → `subscribeUserProfile(uid)`；暴露 `AuthContextValue`。頁面只透過 `useAuth()` 登入/登出，不直接呼叫 `services/auth.ts`（個人資料頁的 link/unlink 例外，直接呼叫 `linkProvider` / `unlinkProvider`）。

## 帳號衝突（同 email 不同登入方式）

Firebase 預設「一個 email 一個帳號」。用 GitHub 登入但該 email 已用 Google 註冊時：
1. `services/auth.ts` 捕獲 `auth/account-exists-with-different-credential`，用 `GithubAuthProvider.credentialFromError` / `GoogleAuthProvider.credentialFromError` 取出憑證，拋 `AccountExistsWithDifferentCredentialError(email, credential)`。
2. `AuthContext` 捕獲後存起來（`pendingLinkEmail` 設為該 email），並**繼續拋出**讓頁面顯示訊息。
3. 使用者用原本方式登入成功後，`AuthContext` 自動 `linkPendingCredential(user, cred)`，然後清掉 pending。
4. LoginPage 在 `pendingLinkEmail` 不為 null 時顯示提示：「{email} 已用其他方式註冊，請先用原本的方式登入，完成後會自動綁定新的登入方式」。

## Security Rules 規格（Agent B）

- 未登入：全部拒絕。
- `isAdmin()` = `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'` 且該文件 `disabled == false`。
- 讀：本人可讀自己的文件（即使 disabled，前端才能顯示停用提示）；admin 可讀全部（含 list）。
- 建立：只能建立自己的 `users/{request.auth.uid}`；`role == 'user'`、`disabled == false`；`uid` 欄位等於文件 ID；只允許 UserProfile 中的欄位鍵。
- 本人更新：不得 disabled；`role`、`disabled`、`uid`、`createdAt` 不得改變；只允許改 `displayName`、`photoURL`、`email`、`providers`、`lastLoginAt`；`displayName` 為 string 且 ≤ 50 字或 null。
- admin 更新他人：只能改 `role`（'admin'|'user'）和 `disabled`（bool）。admin **不能**改自己的 role 或 disabled（防止把自己鎖在外面）。
- 刪除：全部拒絕。
- 其他集合：全部拒絕。

## 第一個 admin

前端無法自行升為 admin。Emulator：`node scripts/seed-emulator.mjs` 建立測試帳號（Agent B 寫）。正式環境：在 Firebase Console → Firestore 手動把自己的 `role` 改成 `admin`。

## 停用

`disabled` 只在應用層生效（守衛攔截 + rules 拒絕寫入）。真正封鎖 Firebase Auth 登入需要 Admin SDK / Cloud Functions，本版不做。
