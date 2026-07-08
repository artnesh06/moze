# Moze

1,000 hand-drawn street art PFPs. Free mint on Robinhood.

Static launchpad site — gallery, trait lab generator, whitelist check, staking UI.

## Setup

```bash
cd ~/Documents/VIBE\ CODE/Moze
./setup-moze.sh        # sync all assets (first time)
./start.sh             # http://localhost:8765
```

## Generate new Moze

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python3 scripts/generate_moze.py --random -o generated/moze.png
```

## Push to GitHub

Double-click **`PUSH.command`** — or:

```bash
brew install git-lfs gh   # sekali aja
gh auth login
chmod +x PUSH.command && ./PUSH.command
```

Collection ~1.2GB — Git LFS otomatis di-handle oleh script.

## Structure

```
index.html  styles.css  script.js
data/       JSON metadata + whitelist
assets/     collection, traits, banners, gif
scripts/    generate + build tools
source/     raw CSVs
```

## Links

- [@mozenft_](https://x.com/mozenft_)
- [@artnesh](https://x.com/artnesh)
- [OpenSea](https://opensea.io/collection/mozestreetart/overview)