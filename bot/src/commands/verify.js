const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const axios = require('axios');
const { generateCaptcha } = require('../captcha');
const {
  saveCode, saveCaptcha, getCaptcha, deleteCaptcha,
  getCode, markCodeUsed, saveHolder, getRoles, getSetting,
} = require('../db');
const { getNftBalance, getRoleForCount } = require('../chain');

function makeVerifyCode() {
  return 'MOZE-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Command definitions ───────────────────────────────────────────────────────

const captchaCommand = new SlashCommandBuilder()
  .setName('captcha')
  .setDescription('Verify you are human to access the server');

const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your Moze NFT holdings to get a holder role');

const checkCommand = new SlashCommandBuilder()
  .setName('checkwallet')
  .setDescription('Submit your wallet address to complete holder verification')
  .addStringOption(opt =>
    opt.setName('wallet')
      .setDescription('Your Ethereum wallet address (0x...)')
      .setRequired(true)
  );

const setupVerifyCommand = new SlashCommandBuilder()
  .setName('setup-verify')
  .setDescription('Post the general verification panel with buttons (admin only)');

const setupHolderCommand = new SlashCommandBuilder()
  .setName('setup-holder')
  .setDescription('Post the holder verification panel (admin only)');

// ── /captcha handler ──────────────────────────────────────────────────────────

async function handleCaptcha(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const { code, pngBuffer } = await generateCaptcha();
  saveCaptcha(interaction.user.id, code);

  const attachment = new AttachmentBuilder(pngBuffer, { name: 'captcha.png' });
  const embed = new EmbedBuilder()
    .setTitle('🧩 Captcha Verification')
    .setDescription('Look at the image below, then click **Submit Answer** to type your answer.')
    .setImage('attachment://captcha.png')
    .setColor(0xC6E607)
    .setFooter({ text: 'Moze Bot · expires in 5 minutes' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_captcha_answer')
      .setLabel('✏️ Submit Answer')
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.editReply({ embeds: [embed], files: [attachment], components: [row] });
}

async function handleCaptchaAnswer(interaction) {
  // Show modal popup
  const modal = new ModalBuilder()
    .setCustomId('modal_captcha')
    .setTitle('🧩 Type the CAPTCHA');

  const input = new TextInputBuilder()
    .setCustomId('captcha_input')
    .setLabel('Characters in the image')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. CHMVZ')
    .setMinLength(4)
    .setMaxLength(6)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleCaptchaModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const pending = getCaptcha(interaction.user.id);
  if (!pending) {
    return interaction.editReply({ content: '❌ No active CAPTCHA. Click **Verify Access** again.' });
  }
  if (Date.now() - pending.created_at > 5 * 60 * 1000) {
    deleteCaptcha(interaction.user.id);
    return interaction.editReply({ content: '⏱️ CAPTCHA expired. Click **Verify Access** again.' });
  }

  const answer = interaction.fields.getTextInputValue('captcha_input').trim().toUpperCase();
  const correct = answer === pending.answer.toUpperCase();
  deleteCaptcha(interaction.user.id);

  if (correct) {
    const memberRoleName = getSetting('member_role') || 'Verified';
    const role = interaction.guild.roles.cache.find(r => r.name === memberRoleName);
    if (role) await interaction.member.roles.add(role).catch(() => {});
    await interaction.editReply({ content: `✅ Correct! You now have the **${memberRoleName}** role. Welcome to Moze Gang! 🎨` });
  } else {
    await interaction.editReply({ content: '❌ Wrong answer. Click **Verify Access** again to get a new CAPTCHA.' });
  }
}

// ── /verify handler ───────────────────────────────────────────────────────────

async function handleVerify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const code = makeVerifyCode();
  saveCode(interaction.user.id, code);

  const embed = new EmbedBuilder()
    .setTitle('🔍 Moze Holder Verification')
    .setDescription([
      '**Step 1:** Copy your unique code below',
      '**Step 2:** Paste it into your **OpenSea bio**',
      '↳ [opensea.io/account/settings](https://opensea.io/account/settings) → Profile → Bio',
      '**Step 3:** Click **Check Wallet** below and enter your wallet address',
      '',
      '⏱️ Code expires in **10 minutes**',
    ].join('\n'))
    .addFields({ name: '🔑 Your Code', value: `\`\`\`${code}\`\`\`` })
    .setColor(0xC6E607)
    .setFooter({ text: 'Moze Street Art · mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_check_wallet')
      .setLabel('✅ Check Wallet')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ── /checkwallet handler ──────────────────────────────────────────────────────

async function handleCheck(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const wallet = interaction.options.getString('wallet').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return interaction.editReply({ content: '❌ Invalid wallet address.' });
  }

  const pending = getCode(interaction.user.id);
  if (!pending) {
    return interaction.editReply({ content: '❌ No active code. Run `/verify` or click Get Code first.' });
  }
  if (Date.now() - pending.created_at > 10 * 60 * 1000) {
    return interaction.editReply({ content: '⏱️ Code expired. Get a new one.' });
  }

  await interaction.editReply({ content: `🔍 Checking OpenSea bio for \`${wallet}\`...` });

  let bioHasCode = false;
  try {
    bioHasCode = await checkOpenSeaBio(wallet, pending.code);
  } catch (err) {
    console.error('[verify] OpenSea check error:', err.message);
  }

  if (!bioHasCode) {
    return interaction.editReply({
      content: [
        `❌ Code \`${pending.code}\` not found in bio of \`${wallet}\`.`,
        '1. Paste the code in your OpenSea bio (Settings → Profile)',
        '2. Click Save',
        '3. Wait a few seconds then try again',
      ].join('\n'),
    });
  }

  await interaction.editReply({ content: '✅ Code confirmed! Checking Moze NFT balance...' });

  const balance = await getNftBalance(wallet);
  const roles = getRoles();
  const roleName = getRoleForCount(balance, roles);

  markCodeUsed(pending.code);
  saveHolder(interaction.user.id, wallet, balance, roleName);

  if (balance === 0) {
    return interaction.editReply({
      content: `✅ Wallet verified: \`${wallet}\`\n\nYou hold **0 Moze NFTs** — no holder role.\nPick one up on [OpenSea](https://opensea.io/collection/mozestreetart)!`,
    });
  }

  // Remove old holder roles, assign new one
  const holderRoleNames = roles.map(r => r.role_name);
  const toRemove = interaction.member.roles.cache.filter(r => holderRoleNames.includes(r.name));
  for (const [, r] of toRemove) await interaction.member.roles.remove(r).catch(() => {});
  if (roleName) {
    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
    if (role) await interaction.member.roles.add(role).catch(() => {});
  }

  await interaction.editReply({
    content: [`✅ **Holder verified!**`, `Wallet: \`${wallet}\``, `Moze held: **${balance}**`, `Role: **${roleName || 'None'}**`].join('\n'),
  });
}

// ── /setup-verify handler ─────────────────────────────────────────────────────

async function handleSetupVerify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('💎 Moze Gang — Verification')
    .setDescription([
      'Welcome to **Moze Gang**!',
      '',
      '🧩 **Get Access** — Solve a quick CAPTCHA to unlock the server.',
      '🔍 **Holder Verify** — Already hold a Moze NFT? Verify your wallet for a holder role.',
    ].join('\n'))
    .setColor(0xC6E607)
    .setThumbnail('https://www.mozestreet.art/assets/Collection/1.webp')
    .setFooter({ text: 'Moze Street Art · mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_captcha')
      .setLabel('✅ Verify Access')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_get_code')
      .setLabel('🔍 Holder Verify')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: '✅ Verification panel posted!' });
}

async function handleSetupHolder(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('🏆 Moze Holder Verification')
    .setDescription([
      'Verify your Moze NFT holdings to unlock your holder role.',
      '',
      '**Steps:**',
      '1. Click **Get Code** → copy the code',
      '2. Paste it in your [OpenSea bio](https://opensea.io/account/settings)',
      '3. Run `/checkwallet <your_wallet_address>`',
      '',
      '**Holder Roles:**',
      '• Moze (+1) — 1-2 NFTs',
      '• Mozeeker (+3) — 3-4 NFTs',
      '• Mozarrior (+5) — 5-9 NFTs',
      '• Mozemperor (+10) — 10-14 NFTs',
      '• Mozeus (+15) — 15-19 NFTs',
      '• Mozelord (+20) — 20+ NFTs',
    ].join('\n'))
    .setColor(0xC6E607)
    .setFooter({ text: 'Moze Street Art · mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_get_code')
      .setLabel('🔑 Get Code')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('OpenSea Settings ↗')
      .setStyle(ButtonStyle.Link)
      .setURL('https://opensea.io/account/settings'),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: '✅ Holder panel posted!' });
}

// ── Button interaction handler ────────────────────────────────────────────────

async function handleButtonInteraction(interaction) {
  const id = interaction.customId;
  if (id === 'btn_captcha') return handleCaptcha(interaction);
  if (id === 'btn_captcha_answer') return handleCaptchaAnswer(interaction);
  if (id === 'btn_get_code') return handleVerify(interaction);
  if (id === 'btn_check_wallet') return handleCheckWalletModal(interaction);
}

async function handleCheckWalletModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_check_wallet')
    .setTitle('🔍 Check Wallet');

  const input = new TextInputBuilder()
    .setCustomId('wallet_input')
    .setLabel('Your wallet address')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('0x...')
    .setMinLength(42)
    .setMaxLength(42)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === 'modal_captcha') return handleCaptchaModalSubmit(interaction);
  if (interaction.customId === 'modal_check_wallet') return handleCheckModalSubmit(interaction);
}

async function handleCheckModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const wallet = interaction.fields.getTextInputValue('wallet_input').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return interaction.editReply({ content: '❌ Invalid wallet address. Must be a valid `0x...` address.' });
  }

  const pending = getCode(interaction.user.id);
  if (!pending) {
    return interaction.editReply({ content: '❌ No active code. Click **Holder Verify** again to get a new code.' });
  }
  if (Date.now() - pending.created_at > 10 * 60 * 1000) {
    return interaction.editReply({ content: '⏱️ Code expired. Click **Holder Verify** again.' });
  }

  await interaction.editReply({ content: `🔍 Checking OpenSea bio for \`${wallet}\`...` });

  let bioHasCode = false;
  try {
    bioHasCode = await checkOpenSeaBio(wallet, pending.code);
  } catch (err) {
    console.error('[verify] OpenSea check error:', err.message);
  }

  if (!bioHasCode) {
    return interaction.editReply({
      content: [
        `❌ Code \`${pending.code}\` not found in bio of \`${wallet}\`.`,
        '',
        '1. Paste the code in your [OpenSea bio](https://opensea.io/account/settings)',
        '2. Click **Save**',
        '3. Wait a few seconds then click **Check Wallet** again',
      ].join('\n'),
    });
  }

  await interaction.editReply({ content: '✅ Code confirmed! Checking Moze NFT balance...' });

  const balance = await getNftBalance(wallet);
  const roles = getRoles();
  const roleName = getRoleForCount(balance, roles);

  markCodeUsed(pending.code);
  saveHolder(interaction.user.id, wallet, balance, roleName);

  if (balance === 0) {
    return interaction.editReply({
      content: `✅ Wallet verified: \`${wallet}\`\n\nYou hold **0 Moze NFTs** — no holder role.\nPick one up on [OpenSea](https://opensea.io/collection/mozestreetart)!`,
    });
  }

  // Remove old holder roles, assign new one
  const holderRoleNames = roles.map(r => r.role_name);
  const toRemove = interaction.member.roles.cache.filter(r => holderRoleNames.includes(r.name));
  for (const [, r] of toRemove) await interaction.member.roles.remove(r).catch(() => {});
  if (roleName) {
    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
    if (role) await interaction.member.roles.add(role).catch(() => {});
  }

  await interaction.editReply({
    content: [`✅ **Holder verified!**`, `Wallet: \`${wallet}\``, `Moze held: **${balance}**`, `Role: **${roleName || 'None'}**`].join('\n'),
  });
}

// ── OpenSea bio check ─────────────────────────────────────────────────────────

async function checkOpenSeaBio(wallet, code) {
  try {
    const res = await axios.get(
      `https://api.opensea.io/api/v2/accounts/${wallet}`,
      { headers: { 'X-API-KEY': process.env.OPENSEA_API_KEY || '' }, timeout: 8000 }
    );
    return (res.data?.bio || '').includes(code);
  } catch {
    try {
      const res = await axios.get(
        `https://api.opensea.io/api/v2/accounts/${wallet}`,
        { timeout: 8000 }
      );
      return (res.data?.bio || '').includes(code);
    } catch {
      throw new Error('OpenSea API unavailable');
    }
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  captchaCommand,
  verifyCommand,
  checkCommand,
  setupVerifyCommand,
  setupHolderCommand,
  handleCaptcha,
  handleVerify,
  handleCheck,
  handleSetupVerify,
  handleSetupHolder,
  handleButtonInteraction,
  handleModalSubmit,
};
