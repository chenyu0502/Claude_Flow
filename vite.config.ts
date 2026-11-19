import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * 開發伺服器上的室內設計入口（public/interior/）。
 *
 * Vite 不會把 /interior/ 對應到 public/interior/index.html，而是退回 Claude Flow 的首頁。
 * 這裡做和 vercel.json 相同的處理：/interior 補上結尾斜線（室內設計用相對路徑，少了斜線會找不到
 * css/、js/），/interior/ 指向 index.html。只在開發時作用，正式環境由 Vercel 處理。
 */
function interiorDevIndex(): Plugin {
  return {
    name: 'interior-dev-index',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const [path, query = ''] = url.split('?');
        if (path === '/interior') {
          res.statusCode = 302;
          res.setHeader('Location', `/interior/${query ? `?${query}` : ''}`);
          res.end();
          return;
        }
        if (path === '/interior/') req.url = `/interior/index.html${query ? `?${query}` : ''}`;
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
    plugins: [react(), interiorDevIndex()],
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
          // 室內設計（/interior/）的登入檢查，由 scripts/fetch-interior.mjs 插進它的 index.html。
          'interior-gate': resolve(__dirname, 'src/interior-gate.ts'),
        },
        output: {
          // 登入檢查要固定檔名：插進室內設計 index.html 的路徑在建置前就寫死了，不能帶雜湊。
          entryFileNames: (chunk) =>
            chunk.name === 'interior-gate' ? 'assets/interior-gate.js' : 'assets/[name]-[hash].js',
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
