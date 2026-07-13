require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');
const {
  captchaCommand, verifyCommand, checkCommand,
  setupVerifyCommand, setupHolderCommand,
  handleCaptcha, handleVerify, handleCheck,
  handleSetupVerify, handleSetupHolder,
  handleButtonInteraction, handleModalSubmit,
} = require('./commands/verify');
const { startSalesTracker } = require('./sales');
const config = require('./config');

// Ensure data dir exists
const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── Discord Client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── Register slash commands ───────────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  try {
    console.log('[bot] Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      {
        body: [
          captchaCommand.toJSON(),
          verifyCommand.toJSON(),
          checkCommand.toJSON(),
          setupVerifyCommand.toJSON(),
          setupHolderCommand.toJSON(),
        ],
      }
    );
    console.log('[bot] Slash commands registered.');
  } catch (err) {
    console.error('[bot] Failed to register commands:', err.message);
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}`);
  await registerCommands();
  startSalesTracker();
  // Start admin dashboard
  require('./dashboard/server');
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Modal submissions
    if (interaction.isModalSubmit()) {
      return await handleModalSubmit(interaction);
    }

    // Button interactions
    if (interaction.isButton()) {
      return await handleButtonInteraction(interaction);
    }

    // Slash commands
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'captcha')       return await handleCaptcha(interaction);
    if (interaction.commandName === 'verify')         return await handleVerify(interaction);
    if (interaction.commandName === 'checkwallet')    return await handleCheck(interaction);
    if (interaction.commandName === 'setup-verify')   return await handleSetupVerify(interaction);
    if (interaction.commandName === 'setup-holder')   return await handleSetupHolder(interaction);

  } catch (err) {
    console.error(`[bot] Interaction error:`, err);
    const reply = { content: '❌ An error occurred. Please try again.', ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(reply);
      else await interaction.reply(reply);
    } catch {}
  }
});

// ── New member — prompt captcha ───────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  const { getSetting } = require('./db');
  const channelId = getSetting('verify_channel_id');
  if (!channelId) return;
  const channel = member.guild.channels.cache.get(channelId);
  if (!channel) return;
  try {
    await channel.send({
      content: `👋 Welcome <@${member.id}>! Click the **Verify Access** button above to get access to the server.`,
    });
  } catch (err) {
    console.error('[bot] GuildMemberAdd error:', err.message);
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
if (!config.discord.token) {
  console.error('[bot] DISCORD_TOKEN not set in .env!');
  process.exit(1);
}

client.login(config.discord.token);
