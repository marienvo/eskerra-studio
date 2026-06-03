# Brand assets

Canonical Eskerra logo files for product UI (desktop title bar, marketing, app icons, etc.):

- `logo-eskerra.svg` — source artwork (Inkscape)
- `eskerra-logo.png` — raster export for README/marketing (non-square is fine)
- `eskerra-logo-desktop-icon.png` — square desktop/Tauri master with the logo scaled to the full canvas
- `eskerra-logo-app-icon.png` — square Android adaptive foreground master with ~68% safe-zone padding
- `eskerra-icon-manifest.json` — `tauri icon` manifest that keeps desktop and Android inputs separate

Regenerate all icon outputs with `../../scripts/generate-brand-app-icons.sh` from the repo root. The script derives both square masters from `eskerra-logo.png`, then refreshes Tauri outputs and synced Android mipmaps.
