/**
 * Empty stub of `server-only` for Vitest.
 *
 * The real `server-only` package throws when imported outside a React-Server
 * environment (Next's bundler resolves it at build, plain Node can't). In
 * Vitest there is no such bundler, so importing any module that does
 * `import 'server-only'` would break resolution. We alias it to this no-op in
 * `vitest.config.ts`. Next's build does NOT use this stub — it keeps the real
 * package, so the server/client boundary still holds in production.
 */
export {}
