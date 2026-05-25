# Desktop Vite bundle baseline (App.tsx refactor guardrail)

Recorded after the App.tsx lazy-split post-fix build. Use this during `App.tsx` orchestration extractions; re-run `npm run build -w @eskerra/desktop` after each larger step and compare.

## Command

```bash
npm run build -w @eskerra/desktop
```

## Guardrail (2026-05-25)

| Chunk | Size (minified) | gzip |
| --- | ---: | ---: |
| `index-*.js` | **1,299.56 kB** | 385.51 kB |
| `vendor-cm-*.js` | **818.32 kB** | 292.98 kB |
| `vendor-react-*.js` | 377.39 kB | 116.37 kB |
| `vendor-md-*.js` | 128.83 kB | 37.66 kB |

Lazy route chunks (on demand, not in initial `index` graph when palettes/settings stay closed):

| Chunk | Size (minified) | gzip |
| --- | ---: | ---: |
| `SettingsPage-*.js` | 13.91 kB | 4.30 kB |
| `VaultSearchPalette-*.js` | 7.34 kB | 2.58 kB |
| `QuickOpenNotePalette-*.js` | 2.23 kB | 1.00 kB |

## Chunk size warnings

`chunkSizeWarningLimit` is **2048 kB** (`apps/desktop/vite.config.ts`). Baseline build must **not** emit:

`Some chunks are larger than 2048 kB after minification`

Baseline build on 2026-05-25: **no warning** (largest chunk `index` at ~1.30 MB).

## Regression checks during refactor

- `index` must not grow materially without an explained import-boundary change.
- `vendor-cm`, `vendor-react`, and `vendor-md` should stay stable unless dependencies or CodeMirror/editor imports change.
- Lazy chunks must remain separate; do not eager-import `SettingsPage`, `QuickOpenNotePalette`, or `VaultSearchPalette` from `App.tsx` or barrel files.
- Optional if `index` grows: `npm run build:analyze -w @eskerra/desktop` (if configured) and inspect the entry graph.
