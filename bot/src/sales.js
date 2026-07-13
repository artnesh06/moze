const axios = require('axios');
const { getSetting } = require('./db');
const { startSalesListener } = require('./chain');

/**
 * Post a sale notification to Discord webhook
 */
async function postSaleToDiscord(tokenId, from, to) {
  const webhookUrl = getSetting('sales_webhook');
  if (!webhookUrl) return;

  const nftUrl = `https://opensea.io/assets/robinhood/${getSetting('moze_ca')}/${tokenId}`;
  const imgUrl = `https://www.mozestreet.art/assets/Collection/${tokenId}.webp`;

  const payload = {
    username: 'Moze Sales',
    avatar_url: 'https://www.mozestreet.art/assets/Collection/1.webp',
    embeds: [
      {
        title: `🔔 Moze #${tokenId} Transferred`,
        url: nftUrl,
        color: 0xC6E607,
        thumbnail: { url: imgUrl },
        fields: [
          {
            name: 'From',
            value: `\`${shortAddr(from)}\``,
            inline: true,
          },
          {
            name: 'To',
            value: `\`${shortAddr(to)}\``,
            inline: true,
          },
          {
            name: 'View',
            value: `[OpenSea](${nftUrl})`,
            inline: true,
          },
        ],
        footer: { text: 'Moze Street Art · Robinhood Chain' },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    await axios.post(webhookUrl, payload, { timeout: 5000 });
    console.log(`[sales] Posted sale: Moze #${tokenId}`);
  } catch (err) {
    console.error('[sales] Webhook post error:', err.message);
  }
}

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '?';
}

/**
 * Start the sales tracker
 */
function startSalesTracker() {
  // Prioritize DB setting, fallback to .env
  let webhookUrl = getSetting('sales_webhook');
  if (!webhookUrl && process.env.SALES_WEBHOOK_URL) {
    webhookUrl = process.env.SALES_WEBHOOK_URL;
    // Save to DB so dashboard shows it
    const { setSetting } = require('./db');
    setSetting('sales_webhook', webhookUrl);
  }

  if (!webhookUrl) {
    console.log('[sales] No webhook URL set — sales tracker inactive. Set it in admin dashboard.');
    return;
  }

  console.log('[sales] Starting sales tracker...');
  startSalesListener(async ({ from, to, tokenId }) => {
    await postSaleToDiscord(tokenId, from, to);
  });
}

module.exports = { startSalesTracker, postSaleToDiscord };
