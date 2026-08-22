import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Plain-node project for frontend/unit tests (vue, pinia, pure utils).
// These cannot run inside the Miniflare workers pool, so they run in a
// separate vitest invocation: `npm test:unit` (see package.json).
export default defineConfig(({ mode }) => ({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
    env: loadEnv(mode, process.cwd(), ''),
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./app', import.meta.url)),
        '#shared/': fileURLToPath(new URL('./shared/', import.meta.url)),
        '#imports': fileURLToPath(new URL('./tests/mocks/imports.ts', import.meta.url)),
      },
    },
  },
}))
