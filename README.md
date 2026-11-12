# Claude Flow

带用户管理与 OAuth 认证的全栈应用：React 18 + Vite + TypeScript + Firebase（Auth + Firestore）。

- 登录方式：Google、GitHub、Email/密码；同一 email 用不同方式登录时自动绑定
- 个人资料：编辑显示名称与头像、绑定/解除登录方式
- 管理员后台（`/admin/users`）：搜索、筛选、调整角色、停用账号
- 权限由 Firestore Security Rules 把关（见 `firestore.rules`，规格见 `CONTRACTS.md`）

## 本地开发（Emulator，不需要真的 Firebase 项目）

需要 Node 20+ 与 **Java 21+**（Firestore Emulator 需要）。

```bash
npm install
cp .env.example .env.local      # 保留 VITE_USE_EMULATOR=true
npm run emulators               # 终端 1：Auth :9099、Firestore :8080、UI :4000
node scripts/seed-emulator.mjs  # 终端 2：建立 admin@example.com / user@example.com（密码 password123）
npm run dev                     # 终端 3：http://localhost:5173
```

Emulator 下点 Google / GitHub 登录会弹出 Emulator 的假登录窗口，可以随意输入 email 测试。

## 测试

```bash
npm test             # 单元 / 组件测试（Vitest + Testing Library）
npm run test:rules   # Security Rules 测试（会自动启动 Firestore Emulator，需要 Java）
npm run typecheck
```

## 部署到正式 Firebase 项目

1. Firebase Console 建立项目，加入一个 Web 应用，把配置填进 `.env.local`，并设 `VITE_USE_EMULATOR=false`。
2. Authentication → Sign-in method 启用：
   - **Email/密码**
   - **Google**
   - **GitHub**：先到 GitHub → Settings → Developer settings → OAuth Apps 新建，Callback URL 填 Console 给的 `https://<project>.firebaseapp.com/__/auth/handler`，再把 Client ID / Secret 填回 Console。
3. Authentication → Settings → Authorized domains 加入你的部署网域。
4. 建立 Firestore 数据库，部署规则：`npx firebase deploy --only firestore:rules --project <project-id>`
5. 第一个管理员：自己先登录一次，到 Firestore 控制台把 `users/{你的 uid}` 的 `role` 改为 `admin`。
6. `npm run build && npx firebase deploy --only hosting --project <project-id>`

## 已知限制

- **停用只在应用层生效**：被停用的人仍能通过 Firebase Auth 登录，但会被守卫拦在停用提示页，也无法写入数据。要真正封锁登录需 Admin SDK（Cloud Functions，需 Blaze 方案）。
- Firebase 默认「一个 email 一个账号」：先用 Email/密码注册、后用同 email 的 Google 登录时，Google 作为可信提供方会取代未验证的密码登录方式（Firebase 本身的行为）。
- 打包后单一 JS chunk 超过 500 kB（主要是 Firebase SDK），之后可按路由做 code-split。
