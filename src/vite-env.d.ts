/// <reference types="vite/client" />

/** 建置識別碼（vite-plugin-version.ts），與伺服器上的 /version.json 比對以偵測新版 */
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_USE_EMULATOR?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
