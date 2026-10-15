import { defineConfig } from 'vitest/config';
// Engine tests run many Newton solves; CI runners are several times slower than a laptop.
export default defineConfig({ test: { include: ['src/**/*.test.{ts,tsx}'], testTimeout: 120_000, hookTimeout: 60_000 } });
