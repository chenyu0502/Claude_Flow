import { defineConfig } from 'vitest/config';

// Firestore Security Rules 测试：需在 Firestore Emulator 内执行（npm run test:rules）
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
