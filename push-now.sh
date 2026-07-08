#!/bin/bash
set -e
cd "$(dirname "$0")"

REPO="https://github.com/artnesh06/moze.git"

echo "→ Sync assets..."
if [ ! -d "data" ] && [ -d "../VIBE CODE/data" ]; then
  rsync -a "../VIBE CODE/data/" "./data/"
  rsync -a "../VIBE CODE/assets/" "./assets/"
fi

if command -v git-lfs >/dev/null 2>&1; then
  git lfs install
  git lfs track "assets/collection/*.png"
  git lfs track "assets/traits/**/*.png"
  git lfs track "assets/*.gif"
fi

git init
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO"
git add .
git commit -m "Moze launchpad — website, collection, trait generator"
git push -u origin main

echo ""
echo "✓ Live: https://github.com/artnesh06/moze"