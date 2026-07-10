import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Vitest config.
 *
 * Default environment is jsdom so React Testing Library works out of the box.
 * Pure-logic tests (webhooks, helpers) opt out with a `@vitest-environment node`
 * pragma at the top of the file — the cost of running them under jsdom is ~100ms
 * but it keeps the config simple and avoids the deprecated environmentMatchGlobs.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` throws outside a React-Server bundler (Next resolves it
      // at build; Node/Vitest can't). Alias to an empty stub so server-only
      // modules can be unit-tested. Next's build still uses the real package.
      'server-only': path.resolve(__dirname, './src/test/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Payments is now an off-by-default paid add-on (FEATURE_PAYMENTS). The
    // payment route/e2e suites exercise the checkout + webhook flows, which
    // are inert (404) when the flag is off — run the test env with the
    // add-on enabled so those contract tests keep covering the real logic.
    env: { FEATURE_PAYMENTS: 'true' },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'packages/*/src/**/*.test.ts'],
    // NOTE: the exclude is scoped to a top-level `e2e/` dir (Playwright-style
    // browser specs live there). Vitest integration suites under
    // `src/test/e2e/` are deliberately NOT excluded — they run in the node
    // environment via the standard include globs.
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
