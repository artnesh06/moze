require('dotenv').config();

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
  },
  rpc: process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com',
  mozeCa: process.env.MOZE_CA || '0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc',
  salesWebhook: process.env.SALES_WEBHOOK_URL,
  admin: {
    password: process.env.ADMIN_PASSWORD || 'changeme',
    port: parseInt(process.env.ADMIN_PORT || '4000'),
    sessionSecret: process.env.SESSION_SECRET || 'changeme',
  },

  // Holder roles — configurable via admin dashboard (saved to db)
  defaultRoles: [
    { name: 'Moze +1',     min: 1,  max: 4  },
    { name: 'Fat Moze +5', min: 5,  max: 9  },
    { name: 'Mozeus +10',  min: 10, max: 999 },
  ],

  // General member role (after CAPTCHA) — must match Discord role name exactly
  memberRole: process.env.MEMBER_ROLE || 'Werido',
};
