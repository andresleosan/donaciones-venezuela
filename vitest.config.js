import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ['tests/**/*.test.{js,ts}'],
  },
});
