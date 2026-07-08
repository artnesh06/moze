#!/bin/bash
cd "$(dirname "$0")"
SRC="../VIBE CODE"
MOZE="$(pwd)"

echo "Syncing Moze website files..."
echo "From: $SRC"
echo "To:   $MOZE"
echo ""

if [ ! -d "$SRC" ]; then
  SRC="/Users/user/Documents/VIBE CODE/VIBE CODE"
fi

rsync -a --progress "$SRC/data/" "$MOZE/data/"
rsync -a --progress "$SRC/assets/" "$MOZE/assets/"
cp -f "$SRC/index.html" "$SRC/script.js" "$SRC/styles.css" "$SRC/start.sh" "$MOZE/" 2>/dev/null

# Archive old launchpad folder
if [ -d "$MOZE/24. LAUNCHPAD MOZETWO" ]; then
  mkdir -p "$MOZE/source"
  if [ ! -d "$MOZE/source/launchpad-original" ]; then
    mv "$MOZE/24. LAUNCHPAD MOZETWO" "$MOZE/source/launchpad-original"
    echo "Moved old launchpad → source/launchpad-original"
  fi
fi

echo ""
echo "Done! Files in Moze root:"
ls -la "$MOZE" | grep -v "^total"
echo ""
test -f "$MOZE/index.html" && echo "✓ index.html"
test -d "$MOZE/data" && echo "✓ data/ ($(ls "$MOZE/data" | wc -l | tr -d ' ') files)"
test -d "$MOZE/assets/collection" && echo "✓ assets/collection/ ($(ls "$MOZE/assets/collection" | wc -l | tr -d ' ') images)"
echo ""
echo "Preview: ./start.sh → http://localhost:8765"
read -p "Press Enter to close..."