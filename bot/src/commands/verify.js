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

function makeVerifyCode() {
  return 'MOZE-' + Math.random().toString(36).substring(2, 8).toUpperCase();
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
    .setDescription('Baca huruf di gambar, terus submit. Jangan salah ngetik.')
    .setImage('attachment://captcha.png')
    .setColor(0xC6E607)
    .setFooter({ text: 'habis 5 menit · coba lagi kalau expired' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_captcha_answer')
      .setLabel('Ketik jawabannya')
      .setStyle(ButtonStyle.Primary),
  );

  await interaction.editReply({ embeds: [embed], files: [attachment], components: [row] });
}

async function handleCaptchaAnswer(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_captcha')
    .setTitle('🧩 Type the CAPTCHA');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('captcha_input')
        .setLabel('Characters in the image')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. CHMVZ')
        .setMinLength(4).setMaxLength(6).setRequired(true)
    )
  );
  await interaction.showModal(modal);
}

async function handleCaptchaModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const pending = getCaptcha(interaction.user.id);
  if (!pending) return interaction.editReply({ content: '❌ No active CAPTCHA. Click **Verify Access** again.' });
  if (Date.now() - pending.created_at > 5 * 60 * 1000) {
    deleteCaptcha(interaction.user.id);
    return interaction.editReply({ content: '⏱️ Expired. Click **Verify Access** again.' });
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
    await interaction.editReply({ content: '❌ Wrong answer. Click **Verify Access** again to retry.' });
  }
}

// ── Holder Verify ─────────────────────────────────────────────────────────────

async function handleVerify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const code = makeVerifyCode();
  saveCode(interaction.user.id, code);

  const signTemplate = [
    'Moze Holder Verify',
    `Code: ${code}`,
    'Address: 0xYOUR_WALLET',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setTitle('Claim holder role')
    .setDescription([
      '**Cara paling gampang: sign wallet**',
      '1. Copy pesan 3 baris di bawah — ganti `0xYOUR_WALLET` pake address lo (huruf kecil)',
      '2. Sign di MetaMask / Rabby / [MyCrypto](https://app.mycrypto.com/sign-message)',
      '3. Klik **Lanjut** → paste address + signature',
      '',
      '**Plan B:** taruh code doang di [OpenSea bio](https://opensea.io/settings/profile) → Save → Lanjut (signature kosongin).',
      '',
      'Code hangus **10 menit**. Moze & Gremlin Cartel didukung.',
    ].join('\n'))
    .addFields(
      { name: 'Code lo', value: `\`\`\`${code}\`\`\`` },
      { name: 'Pesan buat di-sign (harus persis)', value: `\`\`\`${signTemplate}\`\`\`` },
    )
    .setColor(0xC6E607)
    .setFooter({ text: 'mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_check_wallet')
      .setLabel('Lanjut')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleCheckWalletModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('modal_check_wallet')
    .setTitle('Wallet + signature');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('wallet_input')
        .setLabel('Address wallet (0x...)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('0x...')
        .setMinLength(10).setMaxLength(100).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('sig_input')
        .setLabel('Signature (0x...) — kosongin kalau pakai bio')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('0x... hasil personal_sign')
        .setRequired(false)
        .setMaxLength(200)
    ),
  );
  await interaction.showModal(modal);
}

async function handleCheckModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const wallet = interaction.fields.getTextInputValue('wallet_input').trim();
  let signature = '';
  try {
    signature = (interaction.fields.getTextInputValue('sig_input') || '').trim();
  } catch {
    signature = '';
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return interaction.editReply({ content: '❌ Invalid wallet address.' });
  }

  const pending = getCode(interaction.user.id);
  if (!pending) return interaction.editReply({ content: '❌ No active code. Click **Holder Verify** again.' });
  if (Date.now() - pending.created_at > 10 * 60 * 1000) {
    return interaction.editReply({ content: '⏱️ Code expired. Click **Holder Verify** again.' });
  }

  let proven = false;

  // 1) Preferred: EIP-191 personal_sign
  if (signature) {
    await interaction.editReply({ content: `🔏 Checking signature for \`${wallet}\`...` });
    try {
      proven = verifyWalletSignature(pending.code, wallet, signature);
      if (!proven) {
        return interaction.editReply({
          content: [
            '❌ Signature does not match this wallet + code.',
            'Sign **exactly**:',
            '```',
            buildSignMessage(pending.code, wallet),
            '```',
            'Address line must be lowercase `0x...` matching the wallet field.',
          ].join('\n'),
        });
      }
    } catch (err) {
      return interaction.editReply({
        content: `❌ Invalid signature: ${err.message}\nMake sure you signed the exact 3-line message.`,
      });
    }
  } else {
    // 2) Fallback: OpenSea bio
    await interaction.editReply({ content: `🔍 No signature — checking OpenSea bio for \`${wallet}\`...` });
    try {
      proven = await checkOpenSeaBio(wallet, pending.code);
    } catch (err) {
      console.error('[verify] OpenSea check error:', err.message);
      return interaction.editReply({
        content: [
          '⚠️ OpenSea bio check failed (API/page unavailable).',
          '**Use wallet signature instead** (recommended):',
          '```',
          buildSignMessage(pending.code, wallet),
          '```',
          'Sign in MetaMask / Rabby / MyCrypto → Check Wallet again with signature filled.',
        ].join('\n'),
      });
    }
    if (!proven) {
      return interaction.editReply({
        content: [
          `❌ Code \`${pending.code}\` not found in OpenSea bio of \`${wallet}\`.`,
          '',
          '**Easiest fix — sign instead of bio:**',
          '```',
          buildSignMessage(pending.code, wallet),
          '```',
          'Or put this **exact** code in bio → Save → wait 15s → retry.',
        ].join('\n'),
      });
    }
  }

  await interaction.editReply({ content: '✅ Ownership confirmed! Checking NFT balances...' });

  const { moze: mozeBalance, gremlins: gremlinsBalance } = await getAllBalances(wallet);
  const roles = getRoles();
  const mozeRoleName = getRoleForCount(mozeBalance, roles);

  markCodeUsed(pending.code);
  saveHolder(interaction.user.id, wallet, mozeBalance, mozeRoleName);

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
      content: `✅ Wallet verified: \`${wallet}\`\n\nNo NFTs found from supported collections.\n• [Moze](https://opensea.io/collection/mozestreetart)\n• [Gremlin Cartel](https://opensea.io/collection/gremlin-cartel)`,
    });
  }

  await interaction.editReply({
    content: [`✅ **Holder verified!**`, `Wallet: \`${wallet}\``, `Roles: ${assigned.join(', ')}`].join('\n'),
  });
}

// ── /checkwallet slash (fallback) ─────────────────────────────────────────────

async function handleCheck(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const wallet = interaction.options.getString('wallet').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return interaction.editReply({ content: '❌ Invalid wallet address.' });
  const pending = getCode(interaction.user.id);
  if (!pending) return interaction.editReply({ content: '❌ No active code. Run `/verify` first.' });
  if (Date.now() - pending.created_at > 10 * 60 * 1000) return interaction.editReply({ content: '⏱️ Code expired.' });
  // Reuse modal submit logic by simulating the fields
  interaction.fields = { getTextInputValue: () => wallet };
  return handleCheckModalSubmit(interaction);
}

// ── Setup panels ──────────────────────────────────────────────────────────────

async function handleSetupVerify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('Moze Gang')
    .setDescription([
      'Masuk dulu, baru ngobrol.',
      '',
      '**Masuk server** — buktikan lo manusia (bukan bot spam).',
      '**Holder** — pegang Moze / Gremlin? claim role bag lo.',
      '',
      'Klik salah satu tombol di bawah.',
    ].join('\n'))
    .setColor(0xC6E607)
    .setThumbnail('https://www.mozestreet.art/assets/Collection/1.webp')
    .setFooter({ text: 'mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_captcha').setLabel('Masuk server').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('btn_get_code').setLabel('Claim holder role').setStyle(ButtonStyle.Success),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: 'Panel posted.' });
}

async function handleSetupHolder(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('Holder role')
    .setDescription([
      'Punya Moze di wallet? claim role di sini.',
      '',
      '· [Moze Street Art](https://opensea.io/collection/mozestreetart) — Moze +1 / Fat Moze / Mozeus',
      '· [Gremlin Cartel](https://opensea.io/collection/gremlin-cartel) — Gremlins',
      '',
      'Klik tombol → ikutin step-nya. Gampang.',
    ].join('\n'))
    .setColor(0xC6E607)
    .setFooter({ text: 'mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_get_code').setLabel('Mulai verify').setStyle(ButtonStyle.Success),
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
