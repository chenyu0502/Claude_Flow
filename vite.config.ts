import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import localApi from './vite-plugin-local-api.js';
import version, { resolveBuildId } from './vite-plugin-version.js';

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
  // 第三個參數傳空字串代表載入全部環境變數，包含沒有 VITE_ 前綴的伺服器端變數
  // （FINMIND_TOKEN、GEMINI_API_KEY）。它們只交給 api/ 中介層使用，不會進到前端 bundle。
  const env = loadEnv(mode, process.cwd(), '');
  const buildId = resolveBuildId();

  return {
    // Tailwind 只作用在 import 了 tailwindcss 的樣式檔，也就是台股頁（src/stock/index.css）。
    plugins: [react(), tailwindcss(), localApi(env), version(buildId), interiorDevIndex()],
    // 台股頁的新版偵測：編譯進 bundle 的版本識別碼，與伺服器上的 version.json 比對。
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    server: { port: 5173 },
    build: {
      rollupOptions: {
        // 兩個獨立頁面：Claude Flow 本體（/）與台股分析（/stock/）。
        // 分開的頁面讓兩邊的全域樣式（Tailwind preflight）與 Redux store 互不干擾。
        input: {
          main: resolve(__dirname, 'index.html'),
          stock: resolve(__dirname, 'stock/index.html'),
          // 室內設計（/interior/）的登入檢查，由 scripts/fetch-interior.mjs 插進它的 index.html。
          'interior-gate': resolve(__dirname, 'src/interior-gate.ts'),
        },
        output: {
          // 登入檢查要固定檔名：插進室內設計 index.html 的路徑在建置前就寫死了，不能帶雜湊。
          entryFileNames: (chunk) =>
            chunk.name === 'interior-gate' ? 'assets/interior-gate.js' : 'assets/[name]-[hash].js',
          // 兩個頁面共用 react，台股頁另外用到圖表與 Excel 等大型函式庫。
          //
          // react 必須「每個檔案」都明確指定到自己的 chunk：Rollup 會把手動 chunk 的相依
          // 模組一起拉進去，recharts 依賴 react，沒先佔住的話 react 會被併進圖表 chunk，
          // 連 Claude Flow 首頁都得先下載整包圖表才能啟動（實際發生過）。
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (/[\\/]node_modules[\\/]xlsx[\\/]/.test(id)) return 'xlsx';
            if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(id)) return 'charts';
            if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) return 'firebase';
            return undefined;
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.js', 'scripts/**/*.test.mjs'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
