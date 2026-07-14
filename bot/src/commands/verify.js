const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const axios = require('axios');
const { ethers } = require('ethers');
const { generateCaptcha } = require('../captcha');
const {
  saveCode, saveCaptcha, getCaptcha, deleteCaptcha,
  getCode, markCodeUsed, saveHolder, getRoles, getSetting,
} = require('../db');
const { getAllBalances, getRoleForCount } = require('../chain');

/** Numeric code only (no MOZE- prefix) — easy to paste in OpenSea bio */
function makeVerifyCode() {
  // 6 digits, avoid leading zeros looking weird
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Pending status line with progress (Discord ephemeral “animation”) */
function statusMsg(step, total, title, detail = '') {
  const bar = Array.from({ length: total }, (_, i) => (i < step ? '●' : '○')).join(' ');
  return [
    `⏳ **${title}**`,
    `\`${bar}\`  step ${step}/${total}`,
    detail ? `\n${detail}` : '',
  ].join('\n');
}

/** Exact message user must personal_sign */
function buildSignMessage(code, wallet) {
  return [
    'Moze Holder Verify',
    `Code: ${code}`,
    `Address: ${String(wallet).toLowerCase()}`,
  ].join('\n');
}

function verifyWalletSignature(code, wallet, signature) {
  const msg = buildSignMessage(code, wallet);
  const recovered = ethers.verifyMessage(msg, signature.trim());
  return recovered.toLowerCase() === String(wallet).toLowerCase();
}

// ── Commands ──────────────────────────────────────────────────────────────────

const captchaCommand = new SlashCommandBuilder()
  .setName('captcha')
  .setDescription('Verify you are human to access the server');

const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your NFT holdings to get a holder role');

const checkCommand = new SlashCommandBuilder()
  .setName('checkwallet')
  .setDescription('Submit your wallet address to complete holder verification')
  .addStringOption(opt =>
    opt.setName('wallet').setDescription('Your wallet address (0x...)').setRequired(true)
  );

const setupVerifyCommand = new SlashCommandBuilder()
  .setName('setup-verify')
  .setDescription('Post the verification panel (admin only)');

const setupHolderCommand = new SlashCommandBuilder()
  .setName('setup-holder')
  .setDescription('Post the holder verification panel (admin only)');

// ── CAPTCHA ───────────────────────────────────────────────────────────────────

async function handleCaptcha(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const { code, pngBuffer } = await generateCaptcha();
  saveCaptcha(interaction.user.id, code);

  const attachment = new AttachmentBuilder(pngBuffer, { name: 'captcha.png' });
  const embed = new EmbedBuilder()
    .setTitle('Captcha')
    .setDescription('Type the letters you see in the image.')
    .setImage('attachment://captcha.png')
    .setColor(0xC6E607)
    .setFooter({ text: 'Expires in 5 minutes' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_captcha_answer')
      .setLabel('Enter answer')
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.editReply({ embeds: [embed], files: [attachment], components: [row] });
}

async function handleCaptchaAnswer(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_captcha')
    .setTitle('Enter captcha');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('captcha_input')
        .setLabel('Letters from the image')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. FD93X')
        .setMinLength(4).setMaxLength(6).setRequired(true)
    )
  );
  await interaction.showModal(modal);
}

async function handleCaptchaModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const pending = getCaptcha(interaction.user.id);
  if (!pending) return interaction.editReply({ content: 'No active captcha. Hit **Verify Access** again.' });
  if (Date.now() - pending.created_at > 5 * 60 * 1000) {
    deleteCaptcha(interaction.user.id);
    return interaction.editReply({ content: 'That captcha expired. Hit **Verify Access** again.' });
  }

  const answer = interaction.fields.getTextInputValue('captcha_input').trim().toUpperCase();
  const correct = answer === pending.answer.toUpperCase();
  deleteCaptcha(interaction.user.id);

  if (correct) {
    const memberRoleName = getSetting('member_role') || 'Verified';
    const role = interaction.guild.roles.cache.find(r => r.name === memberRoleName);
    if (role) await interaction.member.roles.add(role).catch(() => {});
    await interaction.editReply({ content: `You're in. Role **${memberRoleName}** is on.` });
  } else {
    await interaction.editReply({ content: 'Wrong letters. Hit **Verify Access** and try again.' });
  }
}

// ── Holder Verify ─────────────────────────────────────────────────────────────

async function handleVerify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const code = makeVerifyCode();
  saveCode(interaction.user.id, code);

  const embed = new EmbedBuilder()
    .setTitle('Holder verify')
    .setDescription([
      '1. Copy your code below',
      '2. Paste it in your [OpenSea bio](https://opensea.io/settings/profile) → **Save**',
      '3. Wait a few seconds, then hit **Check wallet**',
      '4. Enter your wallet address (`0x…`)',
      '',
      'We’ll show each step while it runs (bio → match code → NFTs → role).',
      '',
      'Code lasts **10 minutes**. Moze & Gremlin Cartel supported.',
    ].join('\n'))
    .addFields({ name: 'Your code', value: `\`\`\`${code}\`\`\`` })
    .setColor(0xC6E607)
    .setFooter({ text: 'mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_check_wallet')
      .setLabel('Check wallet')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setLabel('OpenSea profile ↗')
      .setStyle(ButtonStyle.Link)
      .setURL('https://opensea.io/settings/profile'),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleCheckWalletModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_check_wallet')
    .setTitle('Check wallet');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('wallet_input')
        .setLabel('Wallet address')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('0x...')
        .setMinLength(10).setMaxLength(100).setRequired(true)
    ),
  );
  await interaction.showModal(modal);
}

async function handleCheckModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const wallet = interaction.fields.getTextInputValue('wallet_input').trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return interaction.editReply({ content: 'That wallet address looks invalid.' });
  }

  const pending = getCode(interaction.user.id);
  if (!pending) return interaction.editReply({ content: 'No active code. Hit **Holder Verify** again.' });
  if (Date.now() - pending.created_at > 10 * 60 * 1000) {
    return interaction.editReply({ content: 'Code expired. Hit **Holder Verify** again.' });
  }

  const TOTAL = 4;
  const setStep = (step, title, detail) =>
    interaction.editReply({ content: statusMsg(step, TOTAL, title, detail) });

  // ── Step 1: OpenSea bio ───────────────────────────────────────────────────
  await setStep(
    1,
    'Reading OpenSea bio…',
    `Wallet \`${wallet}\`\nLooking up profile / bio on OpenSea.`
  );

  let proven = false;
  try {
    proven = await checkOpenSeaBio(wallet, pending.code);
  } catch (err) {
    console.error('[verify] OpenSea check error:', err.message);
    return interaction.editReply({
      content: [
        '**Stuck at step 1 — OpenSea bio**',
        `Couldn’t read the profile: ${err.message}`,
        '',
        'Save the code on OpenSea, wait ~15s, try **Check wallet** again.',
      ].join('\n'),
    });
  }

  // ── Step 2: match code ────────────────────────────────────────────────────
  await setStep(
    2,
    'Matching your code…',
    `Looking for code \`${pending.code}\` in the bio.`
  );

  // tiny delay so user can see the step
  await new Promise((r) => setTimeout(r, 400));

  if (!proven) {
    return interaction.editReply({
      content: [
        '**Stuck at step 2 — code not found**',
        `Code \`${pending.code}\` is not in the OpenSea bio for \`${wallet}\`.`,
        '',
        '1. Paste **only that number** in your bio',
        '2. Click **Save** on OpenSea',
        '3. Wait ~15 seconds',
        '4. **Check wallet** again',
      ].join('\n'),
    });
  }

  // ── Step 3: on-chain balances ─────────────────────────────────────────────
  await setStep(
    3,
    'Checking NFTs on-chain…',
    'Querying Moze + Gremlin balances on Robinhood RPC.'
  );

  const { moze: mozeBalance, gremlins: gremlinsBalance } = await getAllBalances(wallet);
  const roles = getRoles();
  const mozeRoleName = getRoleForCount(mozeBalance, roles);

  markCodeUsed(pending.code);
  saveHolder(interaction.user.id, wallet, mozeBalance, mozeRoleName);

  // ── Step 4: roles ─────────────────────────────────────────────────────────
  await setStep(
    4,
    'Assigning roles…',
    `Moze: **${mozeBalance}** · Gremlins: **${gremlinsBalance}**`
  );

  const assigned = [];

  if (mozeBalance > 0 && mozeRoleName) {
    const holderRoleNames = roles.map(r => r.role_name);
    const toRemove = interaction.member.roles.cache.filter(r => holderRoleNames.includes(r.name));
    for (const [, r] of toRemove) await interaction.member.roles.remove(r).catch(() => {});
    const role = interaction.guild.roles.cache.find(r => r.name === mozeRoleName);
    if (role) { await interaction.member.roles.add(role).catch(() => {}); assigned.push(`**${mozeRoleName}** (${mozeBalance} Moze)`); }
  }

  if (gremlinsBalance > 0) {
    const gremlinsRole = interaction.guild.roles.cache.find(r => r.name === 'Gremlins');
    if (gremlinsRole) { await interaction.member.roles.add(gremlinsRole).catch(() => {}); assigned.push(`**Gremlins** (${gremlinsBalance} NFTs)`); }
  }

  if (!assigned.length) {
    return interaction.editReply({
      content: [
        '**Done — wallet linked, no holder role**',
        `Wallet: \`${wallet}\``,
        `Code matched. On-chain: Moze **${mozeBalance}** · Gremlins **${gremlinsBalance}**`,
        '',
        'No supported NFTs on this address.',
        '• [Moze](https://opensea.io/collection/mozestreetart)',
        '• [Gremlin Cartel](https://opensea.io/collection/gremlin-cartel)',
      ].join('\n'),
    });
  }

  await interaction.editReply({
    content: [
      '**Holder verified** ✓',
      `\`● ● ● ●\`  step ${TOTAL}/${TOTAL}`,
      '',
      `Wallet: \`${wallet}\``,
      `Roles: ${assigned.join(', ')}`,
    ].join('\n'),
  });
}

// ── /checkwallet slash (fallback) ─────────────────────────────────────────────

async function handleCheck(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const wallet = interaction.options.getString('wallet').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return interaction.editReply({ content: 'That wallet address looks invalid.' });
  const pending = getCode(interaction.user.id);
  if (!pending) return interaction.editReply({ content: 'No active code. Run **Holder Verify** first.' });
  if (Date.now() - pending.created_at > 10 * 60 * 1000) return interaction.editReply({ content: 'Code expired. Start again.' });
  // Reuse modal submit logic by simulating the fields
  interaction.fields = {
    getTextInputValue: (id) => (id === 'wallet_input' ? wallet : ''),
  };
  // skip double defer
  interaction.deferReply = async () => ({});
  return handleCheckModalSubmit(interaction);
}

// ── Setup panels ──────────────────────────────────────────────────────────────

async function handleSetupVerify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('Moze Gang Verification')
    .setDescription([
      'Welcome to Moze Gang!',
      '• **Get in** — prove you’re human (no bot spam).',
      '• **Holder** — proof of your hold and claim your role.',
    ].join('\n'))
    .setColor(0xC6E607)
    .setThumbnail('https://www.mozestreet.art/assets/Collection/1.webp')
    .setFooter({ text: 'mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_captcha').setLabel('Verify Access').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('btn_get_code').setLabel('Holder Verify').setStyle(ButtonStyle.Success),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: 'Panel posted.' });
}

async function handleSetupHolder(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('Holder role')
    .setDescription([
      'Got Moze in your wallet? Claim your role here.',
      '',
      '· [Moze Street Art](https://opensea.io/collection/mozestreetart) — Moze +1 / Fat Moze / Mozeus',
      '· [Gremlin Cartel](https://opensea.io/collection/gremlin-cartel) — Gremlins',
      '',
      'Hit the button and follow the steps.',
    ].join('\n'))
    .setColor(0xC6E607)
    .setFooter({ text: 'mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_get_code').setLabel('Holder Verify').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setLabel('OpenSea ↗').setStyle(ButtonStyle.Link).setURL('https://opensea.io/settings/profile'),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: 'Holder panel posted.' });
}

// ── Interaction routers ───────────────────────────────────────────────────────

async function handleButtonInteraction(interaction) {
  const id = interaction.customId;
  if (id === 'btn_captcha') return handleCaptcha(interaction);
  if (id === 'btn_captcha_answer') return handleCaptchaAnswer(interaction);
  if (id === 'btn_get_code') return handleVerify(interaction);
  if (id === 'btn_check_wallet') return handleCheckWalletModal(interaction);
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === 'modal_captcha') return handleCaptchaModalSubmit(interaction);
  if (interaction.customId === 'modal_check_wallet') return handleCheckModalSubmit(interaction);
}

// ── OpenSea bio check ─────────────────────────────────────────────────────────

function bioContainsCode(bio, code) {
  if (!bio || !code) return false;
  return String(bio).toUpperCase().includes(String(code).toUpperCase());
}

/** Official API (needs OPENSEA_API_KEY). */
async function fetchBioViaApi(wallet) {
  const headers = { Accept: 'application/json' };
  if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;
  const res = await axios.get(`https://api.opensea.io/api/v2/accounts/${wallet}`, {
    headers,
    timeout: 10000,
    validateStatus: () => true,
  });
  if (res.status === 200 && res.data) {
    return res.data.bio || res.data.account?.bio || '';
  }
  // missing key / rate limit
  const err = new Error(res.data?.errors?.[0] || `OpenSea API ${res.status}`);
  err.status = res.status;
  throw err;
}

/**
 * Fallback: scrape public profile HTML for "bio":"..." or the code itself.
 * OpenSea v2 accounts API now requires a key; HTML still embeds profile JSON.
 */
async function fetchBioViaPage(wallet) {
  const urls = [
    `https://opensea.io/${wallet}`,
    `https://opensea.io/${wallet.toLowerCase()}`,
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        timeout: 12000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        validateStatus: () => true,
        maxRedirects: 5,
      });
      if (res.status !== 200 || typeof res.data !== 'string') {
        lastErr = new Error(`profile page ${res.status}`);
        continue;
      }
      const html = res.data;
      // Prefer explicit bio JSON field
      const bioMatch =
        html.match(/"bio"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
        html.match(/\\"bio\\"\s*:\s*\\"((?:\\.|[^"\\])*)\\"/);
      if (bioMatch) {
        try {
          return JSON.parse(`"${bioMatch[1]}"`);
        } catch {
          return bioMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
      }
      // Last resort: page body contains the code string
      return html;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('OpenSea profile unavailable');
}

/**
 * Returns true if code is in OpenSea bio.
 * Throws only when we cannot read profile at all (so UI can show API error).
 */
async function checkOpenSeaBio(wallet, code) {
  // 1) API (best if key configured)
  try {
    const bio = await fetchBioViaApi(wallet);
    if (bioContainsCode(bio, code)) return true;
    // API worked but code missing — still try page (cache lag)
  } catch (err) {
    console.warn('[verify] OpenSea API:', err.message);
  }

  // 2) Public profile scrape
  try {
    const bioOrHtml = await fetchBioViaPage(wallet);
    return bioContainsCode(bioOrHtml, code);
  } catch (err) {
    console.error('[verify] OpenSea page scrape failed:', err.message);
    throw new Error('OpenSea profile unavailable — try again in a few seconds');
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  captchaCommand, verifyCommand, checkCommand, setupVerifyCommand, setupHolderCommand,
  handleCaptcha, handleVerify, handleCheck,
  handleSetupVerify, handleSetupHolder,
  handleButtonInteraction, handleModalSubmit,
};
