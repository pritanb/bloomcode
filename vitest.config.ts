import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/**/*.test.{ts,tsx}'],exclude:['tests/e2e/**'],environment:'node',testTimeout:15000}});
