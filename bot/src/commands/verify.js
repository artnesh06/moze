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

  const signTemplate = [
    'Moze Holder Verify',
    `Code: ${code}`,
    'Address: 0xYOUR_WALLET',
  ].join('\n');

  // OpenSea bio is unreliable without OPENSEA_API_KEY — signature is the reliable path.
  const embed = new EmbedBuilder()
    .setTitle('Holder verify')
    .setDescription([
      'Prove the wallet is yours, then we check your NFTs.',
      '',
      '**How:**',
      '1. Copy the **exact** 3-line message below',
      '2. Replace `0xYOUR_WALLET` with your address (**lowercase**)',
      '3. Sign it in MetaMask / Rabby / [MyCrypto](https://app.mycrypto.com/sign-message)',
      '4. Hit **Check wallet**',
      '   • Field 1 = your **wallet address** (~42 chars)',
      '   • Field 2 = the **signature** from step 3 (~130+ chars) — **not** your address again',
      '',
      'Code lasts **10 minutes**. Moze & Gremlin Cartel supported.',
    ].join('\n'))
    .addFields(
      { name: 'Your code', value: `\`\`\`${code}\`\`\`` },
      { name: 'Message to sign (exact)', value: `\`\`\`${signTemplate}\`\`\`` },
    )
    .setColor(0xC6E607)
    .setFooter({ text: 'mozestreet.art' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_check_wallet')
      .setLabel('Check wallet')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setLabel('Sign message help ↗')
      .setStyle(ButtonStyle.Link)
      .setURL('https://app.mycrypto.com/sign-message'),
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
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('sig_input')
        .setLabel('Signature from wallet (NOT address)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Long 0x… from Sign Message (~130 chars). NOT your wallet address.')
        .setRequired(true)
        .setMaxLength(400)
    ),
  );
  await interaction.showModal(modal);
}

/** True if user pasted a 20-byte address into the signature field by mistake */
function looksLikeWalletAddress(hex) {
  return /^0x[0-9a-fA-F]{40}$/.test((hex || '').trim());
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
    return interaction.editReply({ content: 'That wallet address looks invalid.' });
  }
  if (!signature || !signature.startsWith('0x')) {
    return interaction.editReply({
      content: 'Signature required. Sign the 3-line message, then paste the `0x…` signature here.',
    });
  }
  const pending = getCode(interaction.user.id);
  if (!pending) return interaction.editReply({ content: 'No active code. Hit **Holder Verify** again.' });
  if (Date.now() - pending.created_at > 10 * 60 * 1000) {
    return interaction.editReply({ content: 'Code expired. Hit **Holder Verify** again.' });
  }

  // Common mistake: paste wallet address into Signature field
  if (looksLikeWalletAddress(signature)) {
    return interaction.editReply({
      content: [
        '**Stuck at step 1 — you pasted a wallet address, not a signature**',
        '',
        'Field **Signature** needs the long string from **Sign Message** in your wallet (~130+ characters).',
        'What you pasted looks like an **address** (~42 characters) — same as Field 1.',
        '',
        '**Do this:**',
        '1. Open MetaMask / Rabby → Sign Message (or [MyCrypto](https://app.mycrypto.com/sign-message))',
        '2. Paste the 3-line message, sign with this wallet',
        '3. Copy the **signature** result (long `0x…`)',
        '4. **Check wallet** again: address in field 1, signature in field 2',
        '',
        'Sign **exactly** this (address lowercase):',
        '```',
        buildSignMessage(pending.code, wallet),
        '```',
      ].join('\n'),
    });
  }

  const TOTAL = 3;
  const setStep = (step, title, detail) =>
    interaction.editReply({ content: statusMsg(step, TOTAL, title, detail) });

  // ── Step 1: signature ─────────────────────────────────────────────────────
  await setStep(
    1,
    'Checking signature…',
    `Wallet \`${wallet}\`\nVerifying you signed the code message.`
  );

  let proven = false;
  try {
    proven = verifyWalletSignature(pending.code, wallet, signature);
  } catch (err) {
    return interaction.editReply({
      content: [
        '**Stuck at step 1 — bad signature**',
        err.message,
        '',
        'Tip: signature is a **long** `0x…` from Sign Message — not your wallet address.',
        '',
        'Sign **exactly** this (address lowercase):',
        '```',
        buildSignMessage(pending.code, wallet),
        '```',
      ].join('\n'),
    });
  }

  if (!proven) {
    return interaction.editReply({
      content: [
        '**Stuck at step 1 — signature mismatch**',
        'Wallet or code doesn’t match the signature.',
        '',
        'Sign **exactly** this (address must be lowercase):',
        '```',
        buildSignMessage(pending.code, wallet),
        '```',
        'Then **Check wallet** again with the new signature.',
      ].join('\n'),
    });
  }

  // ── Step 2: on-chain balances ─────────────────────────────────────────────
  await setStep(
    2,
    'Checking NFTs on-chain…',
    'Querying Moze + Gremlin balances on Robinhood RPC.'
  );

  const { moze: mozeBalance, gremlins: gremlinsBalance } = await getAllBalances(wallet);
  const roles = getRoles();
  const mozeRoleName = getRoleForCount(mozeBalance, roles);

  markCodeUsed(pending.code);
  saveHolder(interaction.user.id, wallet, mozeBalance, mozeRoleName);

  // ── Step 3: roles ─────────────────────────────────────────────────────────
  await setStep(
    3,
    'Assigning roles…',
    `Moze: **${mozeBalance}** · Gremlins: **${gremlinsBalance}**`
  );

  const assigned = [];

  if (mozeBalance > 0 && mozeRoleName) {
    const holderRoleNames = roles.map(r => r.role_name);
    const toRemove = interaction.member.roles.cache.filter(r => holderRoleNames.includes(r.name));
    for (const [, r] of toRemove) await interaction.member.roles.remove(r).catch(() => {});
    const role = interaction.guild.roles.cache.find(r => r.name === mozeRoleName);
    if (role) {
      try {
        await interaction.member.roles.add(role);
        assigned.push(`**${mozeRoleName}** (${mozeBalance} Moze)`);
      } catch (err) {
        assigned.push(`⚠️ role **${mozeRoleName}** found but add failed: ${err.message}`);
      }
    } else {
      assigned.push(
        `⚠️ config wants **${mozeRoleName}** but that Discord role is missing (rename role or fix Roles in admin dashboard)`
      );
    }
  } else if (mozeBalance > 0 && !mozeRoleName) {
    assigned.push(
      `⚠️ Moze **${mozeBalance}** on-chain but no roles_config tier matches (check admin → Roles)`
    );
  }

  if (gremlinsBalance > 0) {
    const gremlinsRole = interaction.guild.roles.cache.find(r => r.name === 'Gremlins');
    if (gremlinsRole) {
      try {
        await interaction.member.roles.add(gremlinsRole);
        assigned.push(`**Gremlins** (${gremlinsBalance} NFTs)`);
      } catch (err) {
        assigned.push(`⚠️ **Gremlins** add failed: ${err.message}`);
      }
    } else {
      assigned.push('⚠️ Gremlins balance > 0 but Discord role **Gremlins** missing');
    }
  }

  const realRoles = assigned.filter((a) => a.startsWith('**'));
  const warnings = assigned.filter((a) => a.startsWith('⚠️'));

  if (!realRoles.length) {
    const zeroNft = mozeBalance === 0 && gremlinsBalance === 0;
    return interaction.editReply({
      content: [
        zeroNft
          ? '**Done — wallet linked, no holder role**'
          : '**Done — wallet linked, holder role not applied**',
        `Wallet: \`${wallet}\``,
        `Signature OK. On-chain: Moze **${mozeBalance}** · Gremlins **${gremlinsBalance}**`,
        '',
        zeroNft
          ? 'No Moze / Gremlin NFTs on this address.'
          : 'NFTs detected but role was not assigned:',
        ...warnings.map((w) => `• ${w.replace(/^⚠️ /, '')}`),
        zeroNft
          ? [
              '• [Moze](https://opensea.io/collection/mozestreetart)',
              '• [Gremlin Cartel](https://opensea.io/collection/gremlin-cartel)',
            ].join('\n')
          : 'Fix role names in **admin dashboard → Roles** so they match Discord exactly (e.g. `Moze (+1)`).',
      ].filter(Boolean).join('\n'),
    });
  }

  // Prefer clean success when at least one real role applied; still show warnings if any
  if (warnings.length) {
    // fall through with realRoles only in success message; warnings appended below
  }
  // rewrite assigned for success line
  const successAssigned = realRoles;

  await interaction.editReply({
    content: [
      '**Holder verified** ✓',
      `\`● ● ●\`  step ${TOTAL}/${TOTAL}`,
      '',
      `Wallet: \`${wallet}\``,
      `Roles: ${successAssigned.join(', ')}`,
      ...(warnings.length ? ['', ...warnings] : []),
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

function bioContainsCode(text, code) {
  if (!text || !code) return false;
  const t = String(text);
  const c = String(code).trim();
  // exact / substring (case-insensitive)
  if (t.toUpperCase().includes(c.toUpperCase())) return true;
  // whole-token match for pure numbers (avoid random digit noise)
  if (/^\d+$/.test(c)) {
    const re = new RegExp(`(?:^|[^0-9])${c}(?:[^0-9]|$)`);
    if (re.test(t)) return true;
  }
  return false;
}

function extractBiosFromHtml(html) {
  const found = [];
  if (!html || typeof html !== 'string') return found;
  const patterns = [
    /"bio"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /\\"bio\\"\s*:\s*\\"((?:\\.|[^"\\])*)\\"/g,
    /"bio"\s*:\s*'((?:\\.|[^'\\])*)'/g,
    /bio["']?\s*[:=]\s*["']([^"']{1,500})["']/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let raw = m[1];
      try {
        raw = JSON.parse(`"${raw}"`);
      } catch {
        raw = raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\u([\dA-Fa-f]{4})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16))
        );
      }
      if (raw && String(raw).trim() && String(raw).toLowerCase() !== 'bio') {
        found.push(String(raw));
      }
    }
  }
  return found;
}

const OS_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

/** Official API (best with OPENSEA_API_KEY). */
async function fetchBioViaApi(wallet) {
  const headers = { ...OS_HEADERS, Accept: 'application/json' };
  if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;
  const addr = String(wallet).toLowerCase();
  const res = await axios.get(`https://api.opensea.io/api/v2/accounts/${addr}`, {
    headers,
    timeout: 12000,
    validateStatus: () => true,
  });
  if (res.status === 200 && res.data) {
    return res.data.bio || res.data.account?.bio || res.data.profile?.bio || '';
  }
  const msg =
    (Array.isArray(res.data?.errors) && res.data.errors[0]) ||
    res.data?.message ||
    `OpenSea API ${res.status}`;
  const err = new Error(msg);
  err.status = res.status;
  throw err;
}

/** Public profile page scrape (fallback when API key missing). */
async function fetchBioViaPage(wallet) {
  const addr = String(wallet);
  const urls = [
    `https://opensea.io/${addr}`,
    `https://opensea.io/${addr.toLowerCase()}`,
  ];
  let lastErr;
  let lastHtml = '';
  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        headers: OS_HEADERS,
        validateStatus: () => true,
        maxRedirects: 5,
      });
      if (res.status !== 200 || typeof res.data !== 'string') {
        lastErr = new Error(`profile page ${res.status}`);
        continue;
      }
      lastHtml = res.data;
      const bios = extractBiosFromHtml(lastHtml);
      if (bios.length) {
        // longest non-empty bio-ish string
        return bios.sort((a, b) => b.length - a.length)[0];
      }
      // return full HTML so code search still works
      return lastHtml;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastHtml) return lastHtml;
  throw lastErr || new Error('OpenSea profile unavailable');
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns true if code is in OpenSea bio.
 * Retries (OpenSea cache lag after Save is common).
 * Throws only when we cannot read profile at all.
 */
async function checkOpenSeaBio(wallet, code) {
  const attempts = 3;
  let pageOk = false; // got some HTML/API response we could inspect
  let lastHardError = null;

  for (let i = 1; i <= attempts; i++) {
    // 1) Official API
    try {
      const bio = await fetchBioViaApi(wallet);
      pageOk = true;
      console.log(`[verify] API attempt ${i}: bioLen=${(bio || '').length}`);
      if (bioContainsCode(bio, code)) return true;
    } catch (err) {
      // 401 without key is expected — not a hard failure if page works
      console.warn(`[verify] OpenSea API attempt ${i}:`, err.message);
      if (err.status && err.status !== 401) lastHardError = err;
    }

    // 2) Public page
    try {
      const page = await fetchBioViaPage(wallet);
      pageOk = true;
      const bios = extractBiosFromHtml(typeof page === 'string' ? page : '');
      console.log(
        `[verify] page attempt ${i}: pageLen=${String(page || '').length} bios=${bios.length}`
      );
      if (bioContainsCode(page, code)) return true;
      for (const b of bios) {
        if (bioContainsCode(b, code)) return true;
      }
    } catch (err) {
      lastHardError = err;
      console.error(`[verify] OpenSea page attempt ${i}:`, err.message);
    }

    if (i < attempts) await sleep(1500 * i);
  }

  // We could read something but code wasn't there
  if (pageOk) return false;

  throw new Error(
    lastHardError?.message || 'OpenSea profile unavailable — try again in a few seconds'
  );
}

/** Exported for admin self-test */
async function debugOpenSeaLookup(wallet, code) {
  const result = { wallet, code, api: null, page: null, match: false };
  try {
    result.api = { bio: await fetchBioViaApi(wallet) };
  } catch (e) {
    result.api = { error: e.message, status: e.status };
  }
  try {
    const page = await fetchBioViaPage(wallet);
    result.page = {
      len: String(page).length,
      bios: extractBiosFromHtml(String(page)),
      hasCode: bioContainsCode(page, code),
    };
  } catch (e) {
    result.page = { error: e.message };
  }
  try {
    result.match = await checkOpenSeaBio(wallet, code);
  } catch (e) {
    result.match = false;
    result.matchError = e.message;
  }
  return result;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  captchaCommand, verifyCommand, checkCommand, setupVerifyCommand, setupHolderCommand,
  handleCaptcha, handleVerify, handleCheck,
  handleSetupVerify, handleSetupHolder,
  handleButtonInteraction, handleModalSubmit,
  checkOpenSeaBio, debugOpenSeaLookup,
};
