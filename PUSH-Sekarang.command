#!/bin/bash
cd "$(dirname "$0")"

echo "Pushing Moze to github.com/artnesh06/moze"
echo ""

echo "[1/4] Sync data and assets..."
rsync -a "../VIBE CODE/data/" "./data/"
rsync -a "../VIBE CODE/assets/" "./assets/"
echo "  data files: $(ls data 2>/dev/null | wc -l | tr -d ' ')"
echo "  collection: $(ls assets/collection 2>/dev/null | wc -l | tr -d ' ') images"

echo "[2/4] Git LFS check..."
if command -v git-lfs >/dev/null 2>&1; then
  git lfs install
  git lfs track "assets/collection/*.png"
  git lfs track "assets/traits/**/*.png"
  git lfs track "assets/*.gif"
  git add .gitattributes 2>/dev/null || true
  echo "  LFS ready"
else
  echo "  LFS skipped - OK for PNG under 100MB each"
fi

echo "[3/4] Git commit - wait 2-5 minutes..."
rm -rf .git
git init
git branch -M main
git remote add origin https://github.com/artnesh06/moze.git
echo "  adding files..."
git add .
echo "  committing..."
git commit -m "Moze launchpad - website, collection, trait generator"
echo "  commit done"

echo "[4/4] Git push - wait 5-15 minutes for 1GB upload..."
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "SUCCESS: https://github.com/artnesh06/moze"
else
  echo ""
  echo "Push failed. Run: gh auth login"
  echo "Then run this script again."
fi

read -p "Press Enter to close..."