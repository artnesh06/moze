const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

const MOZE_API = (process.env.MOZE_API_URL || 'https://api.mozestreet.art').replace(/\/$/, '');
const MOZE_ADMIN_SECRET = process.env.MOZE_ADMIN_SECRET || process.env.ADMIN_SECRET || '';
const SITE = 'https://www.mozestreet.art';

// ── Commands ──────────────────────────────────────────────────────────────────

const raffleStatusCommand = new SlashCommandBuilder()
  .setName('raffle-status')
  .setDescription('Show live Moze website raffles (tickets & entrants)');

const setupRaffleCommand = new SlashCommandBuilder()
  .setName('setup-raffle')
  .setDescription('Post raffle / giveaway panel to this channel (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const drawRaffleCommand = new SlashCommandBuilder()
  .setName('draw-raffle')
  .setDescription('Draw a weighted winner for a website raffle (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption((opt) =>
    opt.setName('id').setDescription('Raffle id (1, 2, …)').setRequired(true)
  )
  .addBooleanOption((opt) =>
    opt.setName('force').setDescription('Redraw even if already drawn').setRequired(false)
  );

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchPublicRaffles() {
  const res = await fetch(`${MOZE_API}/v1/raffle`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function adminDraw(id, force) {
  if (!MOZE_ADMIN_SECRET) throw new Error('MOZE_ADMIN_SECRET not set on bot');
  const q = force ? '?force=1' : '';
  const res = await fetch(`${MOZE_API}/v1/admin/raffles/${id}/draw${q}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': MOZE_ADMIN_SECRET,
    },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Draw failed (${res.status})`);
  return data;
}

function short(addr) {
  if (!addr) return '—';
  const a = String(addr);
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function formatEnds(ms) {
  if (!ms) return '—';
  const t = Number(ms);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toUTCString().replace('GMT', 'UTC');
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleRaffleStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const data = await fetchPublicRaffles();
    const list = data.raffles || [];
    if (!list.length) {
      return interaction.editReply({ content: 'No raffles configured yet.' });
    }

    const lines = list.map((r) => {
      const badge = r.open ? '🟢 OPEN' : r.status === 'drawn' ? '🏆 DRAWN' : '⚪ CLOSED';
      return (
        `**#${r.id}** ${r.title || r.slug}\n` +
        `↳ ${badge} · **${r.totalTickets || 0}** tix · **${r.entrants || 0}** wallets · cost ${r.ticketCost ?? '?'} $MOZE`
      );
    });

    const embed = new EmbedBuilder()
      .setTitle('🎟️ Moze Raffles (live)')
      .setDescription(lines.join('\n\n') + `\n\nEnter on the site → [mozestreet.art](${SITE}#raffle)`)
      .setColor(0xc6e607)
      .setFooter({ text: 'Moze Street Art · soft $MOZE tickets' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: `❌ Failed to load raffles: ${err.message}` });
  }
}

async function handleSetupRaffle(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const data = await fetchPublicRaffles();
    const list = data.raffles || [];
    const openOnes = list.filter((r) => r.open);

    const desc = [
      'Spend soft **$MOZE** from staking for raffle tickets.',
      '',
      openOnes.length
        ? openOnes
            .map(
              (r) =>
                `• **${r.title || r.prizeLabel}** — ${r.totalTickets || 0} tickets · ${r.entrants || 0} entrants`
            )
            .join('\n')
        : '_No open raffles right now — check back soon._',
      '',
      'Connect wallet on the site → Stake → enter raffles.',
    ].join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🎟️ Moze Raffle Giveaway')
      .setDescription(desc)
      .setColor(0xc6e607)
      .setThumbnail('https://www.mozestreet.art/assets/Collection/1.webp')
      .setFooter({ text: 'Moze Street Art · mozestreet.art' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Enter on website ↗')
        .setStyle(ButtonStyle.Link)
        .setURL(`${SITE}/#raffle`),
      new ButtonBuilder()
        .setLabel('OpenSea collection ↗')
        .setStyle(ButtonStyle.Link)
        .setURL('https://opensea.io/collection/mozestreetart')
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.editReply({ content: '✅ Raffle panel posted!' });
  } catch (err) {
    await interaction.editReply({ content: `❌ ${err.message}` });
  }
}

async function handleDrawRaffle(interaction) {
  await interaction.deferReply({ ephemeral: false });
  const id = interaction.options.getInteger('id', true);
  const force = interaction.options.getBoolean('force') || false;

  try {
    const result = await adminDraw(id, force);
    const embed = new EmbedBuilder()
      .setTitle('🏆 Raffle drawn!')
      .setDescription(
        [
          `**${result.title || result.slug}**`,
          `Prize: **${result.prizeLabel || '—'}**`,
          '',
          `Winner wallet: \`${result.winnerAddress}\``,
          `Winner tickets: **${result.winnerTickets}** / ${result.totalTickets} total`,
          `Entrants: **${result.entrants}**`,
          '',
          `_Weighted random by ticket count. Contact winner for prize delivery._`,
        ].join('\n')
      )
      .setColor(0xc6e607)
      .setFooter({ text: `Raffle #${result.raffleId} · ${short(result.winnerAddress)}` })
      .setTimestamp(result.drawnAt ? new Date(result.drawnAt) : new Date());

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: `❌ Draw failed: ${err.message}` });
  }
}

module.exports = {
  raffleStatusCommand,
  setupRaffleCommand,
  drawRaffleCommand,
  handleRaffleStatus,
  handleSetupRaffle,
  handleDrawRaffle,
};
