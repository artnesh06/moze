# Moze

1,000 hand-drawn street art PFPs. Free mint on Robinhood.

Static launchpad — gallery, trait lab generator, whitelist check, staking UI.

## Preview locally

```bash
./start.sh
# http://localhost:8765
```

## Generate new Moze

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python3 scripts/generate_moze.py --random -o moze-new.png
```

## Structure

```
index.html  styles.css  script.js
data/       JSON metadata + whitelist
assets/     collection, traits, banners, gif
scripts/    generate + build tools
```

## Links

- [@mozenft_](https://x.com/mozenft_)
- [@artnesh](https://x.com/artnesh)
- [OpenSea](https://opensea.io/collection/mozestreetart/overview)