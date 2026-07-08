#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f index.html ]; then
  echo "Run ./setup-moze.sh first"
  exit 1
fi

if ! command -v git >/dev/null; then
  echo "git not found"
  exit 1
fi

# Git LFS for large PNG assets (~1.2GB total)
if command -v git-lfs >/dev/null || git lfs version >/dev/null 2>&1; then
  git lfs install
  git lfs track "assets/collection/*.png"
  git lfs track "assets/traits/**/*.png"
  git add .gitattributes
  echo "✓ Git LFS configured for PNG assets"
else
  echo "⚠ Install Git LFS first: brew install git-lfs"
  echo "  Or push without collection/traits (site code only)"
fi

[ -d .git ] || git init
git add .
git status --short | head -20
echo ""
echo "Next:"
echo "  git commit -m \"Moze launchpad\""
echo "  git remote add origin https://github.com/YOUR_USER/moze.git"
echo "  git branch -M main"
echo "  git push -u origin main"