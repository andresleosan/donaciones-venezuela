import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // App Check falla cerrado por defecto (produccion). Las pruebas unitarias lo
    // apagan y cada handler tiene su propia prueba de enforcement explicita.
    env: { APP_CHECK_MODE: 'disabled' },
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ['tests/**/*.test.{js,ts}'],
  },
});
