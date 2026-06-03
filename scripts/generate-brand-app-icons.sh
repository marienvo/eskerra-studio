#!/usr/bin/env bash
# Regenerate desktop/Tauri app icons and Android mipmaps from brand assets.
# Run from the notebox repo root: ./scripts/generate-brand-app-icons.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND_DIR="$ROOT/assets/brand"
SOURCE="$BRAND_DIR/eskerra-logo.png"
DESKTOP_MASTER="$BRAND_DIR/eskerra-logo-desktop-icon.png"
ANDROID_MASTER="$BRAND_DIR/eskerra-logo-app-icon.png"
MANIFEST="$BRAND_DIR/eskerra-icon-manifest.json"
DESKTOP_DIR="$ROOT/apps/desktop"
ICONS_DIR="$DESKTOP_DIR/src-tauri/icons"
ANDROID_SRC="$ICONS_DIR/android"
MOBILE_RES="$ROOT/apps/mobile/android/app/src/main/res"

CANVAS=1024
DESKTOP_SCALE_PCT=100
ANDROID_SCALE_PCT=68

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

generate_square_masters() {
  require_command magick
  require_command identify
  if [[ ! -f "$SOURCE" ]]; then
    echo "error: missing source raster: $SOURCE" >&2
    exit 1
  fi

  local desktop_logo_size android_logo_size
  desktop_logo_size=$((CANVAS * DESKTOP_SCALE_PCT / 100))
  android_logo_size=$((CANVAS * ANDROID_SCALE_PCT / 100))

  echo "Generating desktop master: $DESKTOP_MASTER"
  magick "$SOURCE" -resize "${desktop_logo_size}x${desktop_logo_size}" \
    -gravity center -background none -extent "${CANVAS}x${CANVAS}" \
    -depth 8 -strip \
    "$DESKTOP_MASTER"

  echo "Generating Android master: $ANDROID_MASTER"
  magick -size "${CANVAS}x${CANVAS}" xc:none \
    \( "$SOURCE" -resize "${android_logo_size}x${android_logo_size}" \) \
    -gravity center -composite \
    -depth 8 -strip \
    "$ANDROID_MASTER"
}

generate_tauri_icons() {
  if [[ ! -x "$ROOT/node_modules/.bin/tauri" ]]; then
    echo "error: local tauri CLI not found: $ROOT/node_modules/.bin/tauri" >&2
    exit 1
  fi

  echo "Running tauri icon..."
  (cd "$ROOT" && ./node_modules/.bin/tauri icon -o "$ICONS_DIR" "$MANIFEST")
}

LAUNCHER_BG="#031226"

write_launcher_background() {
  local dest_dir="$1"
  mkdir -p "$dest_dir"
  cat >"$dest_dir/ic_launcher_background.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">${LAUNCHER_BG}</color>
</resources>
EOF
}

sync_mobile_android_icons() {
  if [[ ! -d "$MOBILE_RES" ]]; then
    echo "Skipping mobile Android res sync (path not found: $MOBILE_RES)"
    return
  fi

  echo "Syncing Android mipmaps to React Native app..."
  for sub in mipmap-hdpi mipmap-mdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi mipmap-anydpi-v26; do
    if [[ -d "$ANDROID_SRC/$sub" ]]; then
      mkdir -p "$MOBILE_RES/$sub"
      cp -f "$ANDROID_SRC/$sub/"* "$MOBILE_RES/$sub/"
    fi
  done
  write_launcher_background "$MOBILE_RES/values"
  write_launcher_background "$ANDROID_SRC/values"
}

main() {
  generate_square_masters
  generate_tauri_icons
  sync_mobile_android_icons
  echo "Done. Tauri icons: $ICONS_DIR"
  echo "For eskerra-go:"
  echo "  cp -r $ANDROID_SRC/* /path/to/eskerra-go/app/src/main/res/"
  echo "  Set splash_background to ${LAUNCHER_BG} in eskerra-go app/src/main/res/values/colors.xml"
}

main "$@"
