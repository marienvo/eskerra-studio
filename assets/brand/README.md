# Brand assets

Canonical Eskerra logo files for product UI (desktop title bar, marketing, app icons, etc.):

- `logo-eskerra.svg` — source artwork (Inkscape)
- `eskerra-logo.png` — raster export for README/marketing (non-square is fine)
- `eskerra-logo-app-icon.png` — **square 1024×1024** master for `tauri icon` / Android adaptive icons (~68% safe-zone padding, transparent background). Regenerate with `../../scripts/generate-brand-app-icons.sh` from the repo root (uses `eskerra-logo.png` when ImageMagick is available).

Do not point `desktop:icons` at `eskerra-logo.png` directly — Tauri requires a square source.
