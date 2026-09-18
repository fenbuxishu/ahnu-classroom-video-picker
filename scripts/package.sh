#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/dist}"
ASSET_NAME="ahnu-classroom-video-picker-chrome-mv3.zip"
STAGE_DIR="$(mktemp -d)"
PACKAGE_DIR="$STAGE_DIR/ahnu-classroom-video-picker"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR" "$PACKAGE_DIR"
cp \
  "$ROOT_DIR/manifest.json" \
  "$ROOT_DIR/background.js" \
  "$ROOT_DIR/content.js" \
  "$ROOT_DIR/panel.css" \
  "$ROOT_DIR/LICENSE" \
  "$PACKAGE_DIR/"

rm -f "$OUTPUT_DIR/$ASSET_NAME" "$OUTPUT_DIR/$ASSET_NAME.sha256"
(
  cd "$STAGE_DIR"
  zip -qr "$OUTPUT_DIR/$ASSET_NAME" ahnu-classroom-video-picker
)

(
  cd "$OUTPUT_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$ASSET_NAME" > "$ASSET_NAME.sha256"
  else
    shasum -a 256 "$ASSET_NAME" > "$ASSET_NAME.sha256"
  fi
)

echo "$OUTPUT_DIR/$ASSET_NAME"
echo "$OUTPUT_DIR/$ASSET_NAME.sha256"
