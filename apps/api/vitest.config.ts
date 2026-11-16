import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/repairverse_test', STORAGE_LOCAL_DIR: './storage-test' },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
