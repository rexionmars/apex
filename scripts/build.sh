#!/usr/bin/env bash
# Build do app + empacotamento dos pesos de modelo em Resources.
# Uso: scripts/build.sh [plataforma wails]  (default: darwin/universal)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${1:-darwin/universal}"

echo "==> wails build ($PLATFORM)"
wails build -platform "$PLATFORM"

APP="$ROOT/build/bin/carcass-integration.app"
if [ -d "$APP" ]; then
  echo "==> empacotando pesos em Resources"
  DEST="$APP/Contents/Resources/model/weights"
  mkdir -p "$DEST"
  if compgen -G "$ROOT/model/weights/*.pth" > /dev/null; then
    cp "$ROOT/model/weights/"*.pth "$ROOT/model/weights/"*.mat "$DEST/"
    echo "    pesos copiados para $DEST"
  else
    echo "    AVISO: nenhum peso em model/weights/ — veja model/weights/README.md"
  fi
fi

echo "==> concluído."
