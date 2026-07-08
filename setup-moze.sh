#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PARENT="$(dirname "$ROOT")"
VIBE_NESTED="$PARENT/VIBE CODE"
LOWER_MOZE="$PARENT/moze"
MOZE_WEB="/Users/user/moze-website"
COL_SRC="/Users/user/Documents/ANESH/PERSONAL/24. LAUNCHPAD MOZETWO/Moze (1)/images"
TRAIT_SRC="/Users/user/Documents/ANESH/PERSONAL/24. LAUNCHPAD MOZETWO/drive-download-20250810T072356Z-1-001"
META_SRC="/Users/user/Documents/ANESH/PERSONAL/24. LAUNCHPAD MOZETWO/Moze (1)/metadata.csv"
WL_SRC="/Users/user/Documents/ANESH/PERSONAL/24. LAUNCHPAD MOZETWO/moze snapshot.csv"

echo "→ Setting up Moze at $ROOT"

# Archive old launchpad folder if sitting in Moze root
if [ -d "$ROOT/24. LAUNCHPAD MOZETWO" ]; then
  mkdir -p "$ROOT/source"
  if [ ! -d "$ROOT/source/launchpad-original" ]; then
    mv "$ROOT/24. LAUNCHPAD MOZETWO" "$ROOT/source/launchpad-original"
    echo "  archived launchpad-original"
  fi
fi

sync_from() {
  local src="$1"
  [ -d "$src" ] || return 1
  rsync -a --exclude '.venv' --exclude '.git' "$src/" "$ROOT/"
  echo "  synced from $src"
  return 0
}

# Prefer complete nested copy
sync_from "$VIBE_NESTED" || sync_from "$LOWER_MOZE" || sync_from "$MOZE_WEB" || true

mkdir -p "$ROOT"/{data,assets,scripts,source,generated}

# Source CSVs
[ -f "$META_SRC" ] && cp "$META_SRC" "$ROOT/source/metadata.csv"
[ -f "$WL_SRC" ] && cp "$WL_SRC" "$ROOT/source/moze snapshot.csv"

# Large assets
if [ ! -d "$ROOT/assets/collection" ] || [ "$(ls "$ROOT/assets/collection" 2>/dev/null | wc -l | tr -d ' ')" -lt 100 ]; then
  echo "  copying collection images..."
  mkdir -p "$ROOT/assets/collection"
  rsync -a "$COL_SRC/" "$ROOT/assets/collection/"
fi

if [ ! -d "$ROOT/assets/traits/BACKGROUND" ]; then
  echo "  copying trait layers..."
  mkdir -p "$ROOT/assets/traits"
  rsync -a "$TRAIT_SRC/" "$ROOT/assets/traits/"
fi

# Cleanup duplicate folders
rm -rf "$VIBE_NESTED" "$LOWER_MOZE" 2>/dev/null || true

chmod +x "$ROOT/start.sh" "$ROOT/setup-moze.sh" "$ROOT/scripts/"*.py 2>/dev/null || true

echo ""
echo "✓ Moze ready at $ROOT"
echo "  collection: $(ls "$ROOT/assets/collection" 2>/dev/null | wc -l | tr -d ' ') images"
echo "  index.html: $([ -f "$ROOT/index.html" ] && echo OK || echo MISSING)"
echo ""
echo "Preview:  cd \"$ROOT\" && ./start.sh"
echo "GitHub:   cd \"$ROOT\" && ./init-github.sh"