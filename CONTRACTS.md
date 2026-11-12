# 共享契约（所有 Agent 必读）

技术栈：React 18 + Vite 5 + TypeScript（strict）+ Firebase v11 modular SDK + react-router-dom v6。
UI 文案一律简体中文。共享样式在 `src/styles.css`（`.container` `.card` `.btn` `.btn-primary` `.field` `.alert-error` `.badge` `.table` …），优先使用。

## 文件归属（只改自己的文件；需要改别人的文件 → 在回报中说明，不要自己改）

| Agent | 负责文件 |
|---|---|
| A 认证服务 | `src/services/auth.ts`、`src/services/auth.test.ts` |
| B 用户数据 + 安全规则 | `src/services/users.ts`、`firestore.rules`、`tests/rules/**`、`scripts/seed-emulator.mjs` |
| C 认证状态 + 路由守卫 | `src/auth/AuthContext.tsx`、`src/auth/guards.tsx`、`src/auth/*.test.tsx` |
| D 登录/注册/重设密码页 | `src/pages/LoginPage.tsx`、`RegisterPage.tsx`、`ResetPasswordPage.tsx`、`src/pages/auth.css`、`src/components/OAuthButtons.tsx`、对应 `*.test.tsx` |
| E 版面 + 首页 + 个人资料 | `src/components/Layout.tsx`、`src/components/NavBar.tsx`、`src/pages/HomePage.tsx`、`src/pages/ProfilePage.tsx`、`src/pages/profile.css`、对应 `*.test.tsx` |
| F 管理员后台 | `src/pages/admin/**` |

主控（我）负责：`package.json`、`tsconfig.json`、`vite.config.ts`、`App.tsx`、`src/lib/firebase.ts`、`src/types/user.ts`、`styles.css`。

**不得**：执行 `npm install` / 新增依赖、改 package.json、git 操作。依赖已装好，可执行 `npx tsc --noEmit`、`npx vitest run <自己的测试文件>`（需先补 PATH，见下）。

PowerShell 补 PATH：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`

## 数据模型

`users/{uid}` → `UserProfile`（见 `src/types/user.ts`）。

## 函数签名

签名已写在各 stub 文件中，**不可更改签名**（其他 Agent 依赖它们）。可以新增 export。

- `src/services/auth.ts`：只操作 Firebase Auth，不碰 Firestore。
- `src/services/users.ts`：所有 Firestore 读写。
- `src/auth/AuthContext.tsx`：`onAuthStateChanged` → `ensureUserProfile(user)` → `subscribeUserProfile(uid)`；暴露 `AuthContextValue`。页面只通过 `useAuth()` 登录/登出，不直接调 `services/auth.ts`（个人资料页的 link/unlink 例外，直接调 `linkProvider` / `unlinkProvider`）。

## 账号冲突（同 email 不同登录方式）

Firebase 默认「一个 email 一个账号」。用 GitHub 登录但该 email 已用 Google 注册时：
1. `services/auth.ts` 捕获 `auth/account-exists-with-different-credential`，用 `GithubAuthProvider.credentialFromError` / `GoogleAuthProvider.credentialFromError` 取出凭证，抛 `AccountExistsWithDifferentCredentialError(email, credential)`。
2. `AuthContext` 捕获后存起来（`pendingLinkEmail` 设为该 email），并**继续抛出**让页面显示讯息。
3. 用户用原本方式登录成功后，`AuthContext` 自动 `linkPendingCredential(user, cred)`，然后清掉 pending。
4. LoginPage 在 `pendingLinkEmail` 不为 null 时显示提示：「{email} 已用其他方式注册，请先用原本的方式登录，完成后会自动绑定新的登录方式」。

## Security Rules 规格（Agent B）

- 未登录：全部拒绝。
- `isAdmin()` = `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'` 且该文档 `disabled == false`。
- 读：本人可读自己的文档（即使 disabled，前端才能显示停用提示）；admin 可读全部（含 list）。
- 建立：只能建立自己的 `users/{request.auth.uid}`；`role == 'user'`、`disabled == false`；`uid` 字段等于文档 ID；只允许 UserProfile 中的字段键。
- 本人更新：不得 disabled；`role`、`disabled`、`uid`、`createdAt` 不得改变；只允许改 `displayName`、`photoURL`、`email`、`providers`、`lastLoginAt`；`displayName` 为 string 且 ≤ 50 字或 null。
- admin 更新他人：只能改 `role`（'admin'|'user'）和 `disabled`（bool）。admin **不能**改自己的 role 或 disabled（防止把自己锁在外面）。
- 删除：全部拒绝。
- 其他集合：全部拒绝。

## 第一个 admin

前端无法自行升为 admin。Emulator：`node scripts/seed-emulator.mjs` 建立测试账号（Agent B 写）。正式环境：在 Firebase Console → Firestore 手动把自己的 `role` 改成 `admin`。

## 停用

`disabled` 只在应用层生效（守卫拦截 + rules 拒绝写入）。真正封锁 Firebase Auth 登录需要 Admin SDK / Cloud Functions，本版不做。
