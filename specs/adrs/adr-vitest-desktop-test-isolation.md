# ADR: Vitest desktop test isolation and singleton resets

## Status

Accepted — enforced by `apps/desktop/vitest.setup.ts`, `apps/desktop/vitest.config.ts`, and PR review.

## Context

The desktop app uses Vitest with `happy-dom`, React Testing Library, and several modules that keep **mutable module-scoped state** (caches, Maps, singletons, debounce timers). Without a shared harness, RTL cleanup may not run, `localStorage` bleeds between tests, and singletons make order-dependent flakes.

## Decision

1. **Central setup** (`apps/desktop/vitest.setup.ts`): after each test, run `cleanup()`, real timers, `vi.unstubAllGlobals()` / `unstubAllEnvs()`, clear `localStorage` / `sessionStorage`, reset `document.body`, then call `__resetForTests()` only from modules that **do not** import `@tauri-apps/*` at module scope. Setup runs before test files are loaded; importing Tauri-backed modules in setup binds the real client and breaks `vi.mock('@tauri-apps/...')` in tests. **MediaSession:** use `desktopMediaSessionDom` for `__resetDesktopMediaSessionForTests` in setup (DOM-only); the full metadata helpers are not needed in setup teardown. Tauri-tied caches (`emojiUsageStore`, `rssFeedUrlCacheDesktop`, `podcastPhase1Desktop`, `htmlAudioPlayer`, etc.) still export `__resetForTests` for opt-in use inside tests that mock Tauri.
2. **Vitest flags** (`isolate: true`, `clearMocks`, `restoreMocks: false`, `unstubGlobals`, `unstubEnvs`, `sequence.hooks: 'list'`) — `restoreMocks` stays off so `vi.mock()` module factories are not stripped after each test. Use `vi.spyOn(...).mockRestore()` in-file when you need a real implementation back. Do not disable file isolation without a new ADR.
3. **New mutable module state** must ship with `__resetForTests()` and a one-line wire in `vitest.setup.ts`.
4. **Avoid import-time side effects** that mutate global or persisted state (e.g. hydrating caches from `localStorage` at module load). Prefer lazy init on first use.

## Consequences

- Slightly more boilerplate when adding caches.
- Tests are more deterministic and CI-friendly.
- Do **not** merge `vitest` config with `isolate: false` or `pool: 'threads'` without per-worker isolation unless this ADR is superseded.

## ESLint

`apps/desktop/eslint.config.js` flags `isolate: false` in any `**/vitest.config.ts` to catch accidental regressions.
