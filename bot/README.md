# Moze Bot

Discord bot untuk Moze Street Art — Holder Verify + CAPTCHA + Sales Tracker + Admin Dashboard.

## Features

- `/captcha` — General member verify (anti-bot, SVG CAPTCHA)
- `/verify` — Generate unique code untuk holder verify via OpenSea bio
- `/checkwallet <address>` — Submit wallet, bot cek bio + on-chain balance, assign role otomatis
- **Sales Tracker** — Listen Transfer events dari Robinhood RPC, post ke Discord webhook
- **Admin Dashboard** — Web UI di port 4000

## Setup

```bash
cd bot
npm install
cp .env.example .env
# Edit .env dengan token & config kamu
node src/index.js
```

## .env

```
DISCORD_TOKEN=         # Bot token dari discord.dev
DISCORD_CLIENT_ID=     # Application ID
DISCORD_GUILD_ID=      # Server ID kamu (klik kanan server → Copy Server ID)
ADMIN_PASSWORD=        # Password admin dashboard
ADMIN_PORT=4000
SESSION_SECRET=        # Random string panjang
OPENSEA_API_KEY=       # Optional, untuk cek bio OpenSea
```

## Discord Setup

1. Buka [discord.dev](https://discord.com/developers/applications)
2. Pilih app → **Bot** → Reset Token → copy ke `.env`
3. Aktifkan **Server Members Intent** + **Message Content Intent**
4. OAuth2 → URL Generator → scope: `bot`, `applications.commands`
5. Bot permissions: `Manage Roles`, `Send Messages`, `Read Messages`
6. Invite bot ke server kamu

## Admin Dashboard

Buka `http://localhost:4000` setelah bot running.

Di sini kamu bisa:
- Ganti CA, RPC, webhook URL
- Set role tiers (nama role + min/max hold)
- Set member role (CAPTCHA verify)
- Lihat semua verified holders

## Holder Roles (default)

| Role | Min | Max |
|------|-----|-----|
| Moze +1 | 1 | 4 |
| Fat Moze +5 | 5 | 9 |
| Mozeus +10 | 10 | 999 |

General member role (setelah CAPTCHA): **Werido**
