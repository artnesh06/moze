#!/bin/bash
set -e
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     MOZE → GITHUB (buat repo baru)   ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Sync dulu kalau data/assets belum ada
if [ ! -d "data" ] && [ -d "../VIBE CODE/data" ]; then
  echo "→ Syncing data + assets..."
  rsync -a "../VIBE CODE/data/" "./data/"
  rsync -a "../VIBE CODE/assets/" "./assets/"
  echo "  ✓ done"
fi

# Git LFS untuk gambar besar (~1.2GB)
if command -v git-lfs >/dev/null 2>&1; then
  git lfs install
  git lfs track "assets/collection/*.png"
  git lfs track "assets/traits/**/*.png"
  git lfs track "assets/*.gif"
  git add .gitattributes 2>/dev/null || true
  echo "→ Git LFS ready"
else
  echo "⚠ Install Git LFS dulu: brew install git-lfs"
fi

[ -d .git ] || git init
git add .
git commit -m "Moze launchpad — website, collection, trait generator" 2>/dev/null || echo "→ sudah committed"
git branch -M main

echo ""
echo "Pilih cara buat repo:"
echo ""
echo "  [A] OTOMATIS — pakai GitHub CLI (gh)"
echo "      Butuh: brew install gh && gh auth login"
echo ""
echo "  [B] MANUAL — buat di browser dulu"
echo "      1. Buka https://github.com/new"
echo "      2. Repository name: moze"
echo "      3. Public, JANGAN centang README/license"
echo "      4. Create repository"
echo "      5. Copy URL repo kamu"
echo ""

read -p "Pilih A atau B [A/B]: " PILIH

if [ "$PILIH" = "A" ] || [ "$PILIH" = "a" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh belum install. Jalankan: brew install gh && gh auth login"
    read -p "Press Enter..."
    exit 1
  fi
  gh auth login --web 2>/dev/null || gh auth status
  USER=$(gh api user -q .login)
  echo "→ Buat repo github.com/$USER/moze ..."
  gh repo create moze --public --source=. --remote=origin --push
  echo ""
  echo "✓ LIVE: https://github.com/$USER/moze"

elif [ "$PILIH" = "B" ] || [ "$PILIH" = "b" ]; then
  echo ""
  read -p "Paste URL repo (contoh: https://github.com/artnesh/moze.git): " REPO_URL
  git remote remove origin 2>/dev/null || true
  git remote add origin "$REPO_URL"
  echo "→ Pushing..."
  git push -u origin main
  echo ""
  echo "✓ Pushed ke $REPO_URL"
else
  echo "Pilih A atau B"
fi

echo ""
read -p "Press Enter to close..."