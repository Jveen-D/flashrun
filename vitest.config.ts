import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', include: ['tests/**/*.test.{ts,js}'], clearMocks: true, restoreMocks: true } });
