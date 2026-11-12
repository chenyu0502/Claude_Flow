// vite.config.ts 引用的兩個 JS 外掛（沿用自台股分析）的型別宣告。
declare module '*/vite-plugin-local-api.js' {
  import type { Plugin } from 'vite';
  export default function localApiPlugin(env?: Record<string, string>): Plugin;
}

declare module '*/vite-plugin-version.js' {
  import type { Plugin } from 'vite';
  export function resolveBuildId(): string;
  export default function versionPlugin(buildId: string): Plugin;
}
