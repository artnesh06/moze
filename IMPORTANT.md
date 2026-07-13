# Moze — Important Info

## NFT Collection

- **Name:** Moze Street Art
- **OpenSea:** https://opensea.io/collection/mozestreetart
- **Contract Address (CA):** `0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc`
- **Chain:** Robinhood (RH) Mainnet
- **RPC:** `https://rpc.mainnet.chain.robinhood.com`
- **Supply:** 1,000

## Discord Roles

| Role | Threshold |
|------|-----------|
| Werido | General member (passed CAPTCHA verify) |
| Gremlins | — |
| Moze +1 | Hold 1+ Moze NFT |
| Fat Moze +5 | Hold 5+ Moze NFT |
| Mozeus +10 | Hold 10+ Moze NFT |
| Mod | Moderator (manual assign) |

## Staking Reward Rate

- **10 $MOZE per NFT per day** (while staked)
- Configured in `script.js`: `const MOZE_RATE_PER_DAY = 10;`

## Bot Architecture

### Bot 1 — Holder Verify
- Flow: `/verify` → bot DM unique code → user paste ke bio OpenSea → bot cek bio → cek on-chain balance → assign role
- Role assignment based on NFT count (see table above)

### Bot 2 — Sales Tracker
- Source: Robinhood RPC (listen Transfer events from CA)
- Output: Discord Webhook → #sales channel
- Post format: "🔔 Moze #X sold!" (with image + price if available)

### Admin Dashboard
- Web UI untuk config: CA, roles, thresholds, webhook URLs, channels
- Host: Coolify (same server as moze-api)

## Webhook

- **Captain Hook** — channel: #verification (created Jul 11 2026)

## Links

- **Site:** https://www.mozestreet.art
- **API:** https://api.mozestreet.art (repo: artnesh06/moze-api)
- **Discord Dev Portal App ID:** 1525496869491441814
- **X:** @mozenft_
