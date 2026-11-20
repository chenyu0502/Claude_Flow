import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/** 由 Claude Flow 一起發布的靜態子網站（public/<名稱>/），建置時由 scripts/fetch-*.mjs 抓取 */
const STATIC_SUBSITES = ['interior', 'travel'];
/** 各子網站的登入檢查入口（src/<名稱>-gate.ts），建置後輸出為固定檔名 assets/<名稱>-gate.js */
const GATE_ENTRIES = STATIC_SUBSITES.map((name) => `${name}-gate`);

/**
 * 開發伺服器上的子網站入口（public/interior/、public/travel/）。
 *
 * Vite 不會把 /interior/ 對應到 public/interior/index.html，而是退回 Claude Flow 的首頁。
 * 這裡做和 vercel.json 相同的處理：/interior 補上結尾斜線（子網站用相對路徑，少了斜線會找不到
 * css/、js/），/interior/ 指向 index.html。/travel 同理。只在開發時作用，正式環境由 Vercel 處理。
 */
function subsiteDevIndex(): Plugin {
  return {
    name: 'subsite-dev-index',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const [path, query = ''] = url.split('?');
        const qs = query ? `?${query}` : '';
        for (const name of STATIC_SUBSITES) {
          if (path === `/${name}`) {
            res.statusCode = 302;
            res.setHeader('Location', `/${name}/${qs}`);
            res.end();
            return;
          }
          if (path === `/${name}/`) req.url = `/${name}/index.html${qs}`;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 台股分析在獨立 repo（tw-stock-analysis）開發與部署，正式環境由 vercel.json 把 /stock、/api 轉送過去。
  // 本機開發時同樣轉送到台股的開發伺服器，兩邊同網域、共用登入狀態，和正式環境一致。
  const stockDevUrl = env.STOCK_DEV_URL || 'http://localhost:5174';

  return {
    plugins: [react(), subsiteDevIndex()],
    server: {
      port: 5173,
      proxy: {
        '/stock': { target: stockDevUrl, changeOrigin: true, ws: true },
        '/api': { target: stockDevUrl, changeOrigin: true },
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          // 子網站（/interior/、/travel/）的登入檢查，由 scripts/fetch-*.mjs 插進它們的 index.html。
          ...Object.fromEntries(GATE_ENTRIES.map((name) => [name, resolve(__dirname, `src/${name}.ts`)])),
        },
        output: {
          // 登入檢查要固定檔名：插進子網站 index.html 的路徑在建置前就寫死了，不能帶雜湊。
          entryFileNames: (chunk) =>
            GATE_ENTRIES.includes(chunk.name) ? `assets/${chunk.name}.js` : 'assets/[name]-[hash].js',
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) return 'firebase';
            return undefined;
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx,js}', 'scripts/**/*.test.mjs'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
