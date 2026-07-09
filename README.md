# Moze

1,000 hand-drawn street art PFPs. Free mint on Robinhood.

Static launchpad — gallery, trait lab, whitelist check, soft stake UI, holders leaderboard.

**Site:** [www.mozestreet.art](https://www.mozestreet.art)  
**OpenSea:** [mozestreetart](https://opensea.io/collection/mozestreetart/overview)  
**X:** [@mozenft_](https://x.com/mozenft_)

## Preview locally

```bash
./start.sh
# http://localhost:8765
```

## Backend API

Separate repo: **[artnesh06/moze-api](https://github.com/artnesh06/moze-api)**

- Domain: `https://api.mozestreet.art`
- Soft stake sync (wallet-signed) + holders leaderboard cache
- Frontend reads `window.MOZE_API` or defaults to `https://api.mozestreet.art`

Local API override:

```js
// browser console or index.html
window.MOZE_API = 'http://localhost:3000';
// or: localStorage.setItem('moze-api', 'http://localhost:3000')
```

## Deploy (Coolify + Docker)

Repo includes `Dockerfile` + `nginx.conf` for static nginx.

### Coolify ([deploy.artnesh.cloud](https://deploy.artnesh.cloud/))

1. **New Resource** → **Public/Private Repository**
2. Connect GitHub → `artnesh06/moze` · branch `main`
3. Build pack: **Dockerfile** (auto-detected)
4. Port: **80**
5. Domains:
   - `www.mozestreet.art`
   - `mozestreet.art` (optional redirect to www)
6. Enable **HTTPS** (Let's Encrypt)
7. Deploy

DNS at your registrar:

| Type | Name | Value |
|------|------|--------|
| A / CNAME | `@` / `www` | point to Coolify VPS IP (or CNAME to Coolify proxy host) |

After first deploy, open `https://www.mozestreet.art` and hard-refresh.

### Docker local smoke test

```bash
docker build -t moze-site .
docker run --rm -p 8080:80 moze-site
# http://localhost:8080
```

## Generate collection (dev)

Layer order (bottom → top): **Background → Base → Skin → Clothes → Eyes → Head → Mouth**

DNA + traits: `data/metadata.csv` and `assets/Traits/`.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Full 1,000 → generated/images + generated/json + generated/metadata.csv
.venv/bin/python3 scripts/generate_moze.py --collection

# One token / range
.venv/bin/python3 scripts/generate_moze.py --token 11
.venv/bin/python3 scripts/generate_moze.py --token 1-20
```

Site gallery uses compressed `assets/Collection/*.webp` (not `generated/`).

## Structure

```
index.html  styles.css  script.js
Dockerfile  nginx.conf          # production static host
data/       collection, traits, whitelist, lore, nicknames
assets/     Collection/*.webp, Traits/, banners, gif
scripts/    generate + build tools
generated/  local regen only (not deployed)
```

## Whitelist snapshot

```bash
.venv/bin/python3 scripts/build_whitelist.py
```

## Links

- [@mozenft_](https://x.com/mozenft_)
- [@artnesh](https://x.com/artnesh)
- [OpenSea](https://opensea.io/collection/mozestreetart/overview)
