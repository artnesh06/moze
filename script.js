let collection = [];
let galleryItems = [];
let traitData = null;
let traitLore = null;
let selectedTraits = {};
let activeCategory = 'BACKGROUND';
const COMPOSER_SIZE = 1000;
const traitImageCache = new Map();
let composerDataUrl = null;
let renderComposerToken = 0;
const GALLERY_SIZE_DESKTOP = 15;
const GALLERY_SIZE_MOBILE = 16; // 2-col grid → even rows
const GALLERY_ROTATE_MS = 3000;
let galleryRotateTimer = null;
let gallerySearchActive = false;

function gallerySize() {
  // match styles.css mobile breakpoint (2-col gallery at max-width: 720px)
  return window.matchMedia('(max-width: 720px)').matches
    ? GALLERY_SIZE_MOBILE
    : GALLERY_SIZE_DESKTOP;
}

let whitelist = new Set();

async function loadData() {
  const [wlRes, traitRes, colRes, loreRes] = await Promise.all([
    fetch('data/whitelist.json', { cache: 'no-store' }),
    fetch('data/traits.json', { cache: 'no-store' }),
    fetch('data/collection.json', { cache: 'no-store' }),
    fetch('data/trait-lore.json', { cache: 'no-store' }).catch(() => null),
  ]);

  whitelist = new Set(await wlRes.json());
  traitData = await traitRes.json();
  collection = await colRes.json();
  if (loreRes && loreRes.ok) {
    traitLore = await loreRes.json();
  }

  const traitTotal = document.getElementById('trait-total');
  if (traitTotal) traitTotal.textContent = traitData.total;
  const traitsDesc = document.getElementById('traits-desc');
  if (traitsDesc) traitsDesc.textContent = `${traitData.total} traits across 7 layers.`;

  renderGallery();
  startGalleryRotate();
  initTraits();
  initLightbox();
  initGallerySearch();
  initMintStatsUi();
  refreshMintStats();
}

function fmtInt(n) {
  return Number(n).toLocaleString('en-US');
}

/** This browser only — NOT global collection staked (that's API positions count). */
function countLocalStaked() {
  let stakedCount = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('moze-stake-v2:')) continue;
      const data = JSON.parse(localStorage.getItem(key) || '{}');
      stakedCount += Object.keys(data.positions || {}).length;
    }
  } catch { /* ignore */ }
  return stakedCount;
}

/** Last known global STAKED (NFT positions) from /v1/stats — avoids flashing local-only count. */
const STAKED_CACHE_KEY = 'moze-stats-staked-v1';

function getCachedGlobalStaked() {
  try {
    const n = Number(localStorage.getItem(STAKED_CACHE_KEY));
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function setCachedGlobalStaked(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return;
  try {
    localStorage.setItem(STAKED_CACHE_KEY, String(Math.floor(v)));
  } catch { /* ignore */ }
}

/** Prefer last API total; never flash tiny local-only number over known global. */
function displayStakedHint() {
  const cached = getCachedGlobalStaked();
  if (cached != null) return cached;
  return countLocalStaked();
}

const MINT_SUPPLY_MAX = 1000;

function parseStatNum(text) {
  if (text == null || text === '' || text === '—') return 0;
  const n = Number(String(text).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function updateMintCharts({ minted }) {
  const max = MINT_SUPPLY_MAX;
  const m = Math.min(max, Math.max(0, Number(minted) || 0));
  const pct = max ? Math.round((m / max) * 1000) / 10 : 0;

  const pctEl = document.getElementById('mint-pct');
  if (pctEl) pctEl.textContent = `${pct}%`;

  const progress = document.getElementById('bar-minted');
  if (progress) progress.style.width = `${(m / max) * 100}%`;
}

/**
 * Live stats:
 * 1) moze-api /v1/stats (RPC totalSupply + OpenSea server-side — no browser CORS)
 * 2) static snapshot fallback
 * Status text is intentionally not shown in the UI.
 */
async function refreshMintStats(force = false) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val != null && val !== '') el.textContent = val;
  };

  let minted = 0;
  let holders = 0;
  // Global STAKED = total NFT positions in API DB (not # of leaderboard wallets).
  // Use last cached API value first so we don't flash local-only "3".
  let staked = displayStakedHint();
  if (staked > 0) set('mint-staked', fmtInt(staked));
  set('mint-listed', '—');

  let liveOk = false;
  try {
    if (apiOnline === null) await pingApi();
    if (apiOnline) {
      const q = force ? '?force=1' : '';
      const s = await apiFetch(`/v1/stats${q}`);
      if (s && s.ok !== false) {
        liveOk = true;
        if (s.minted != null) {
          minted = Number(s.minted) || 0;
          set('mint-minted', fmtInt(s.minted));
        }
        if (s.holders != null) {
          holders = Number(s.holders) || 0;
          set('mint-holders', fmtInt(s.holders));
        }
        if (s.offer) set('mint-offer', s.offer);
        else if (s.floor != null) {
          const sym = s.floorSymbol || 'ETH';
          set('mint-offer', Number(s.floor) === 0 ? `0 ${sym}` : `${s.floor} ${sym}`);
        }
        if (s.volumeLabel) set('mint-volume', s.volumeLabel);
        else if (s.volume != null) set('mint-volume', `${s.volume} ETH`);
        if (s.sales != null) set('mint-sales', fmtInt(s.sales));
        if (s.listed != null && s.listed !== '') set('mint-listed', fmtInt(s.listed));
        if (s.staked != null) {
          staked = Number(s.staked) || 0;
          setCachedGlobalStaked(staked);
          set('mint-staked', fmtInt(staked));
        }
        if (s.supplyMax != null) {
          const se = document.getElementById('mint-supply');
          if (se) se.textContent = fmtInt(s.supplyMax);
        }
      }
    }
  } catch (err) {
    console.warn('[stats] api failed', err?.message || err);
  }

  // Snapshot fills gaps only when still blank (API offline / field missing).
  // Never overwrite live zeros (e.g. sales=0, volume=0 ETH).
  const isBlank = (id) => {
    const t = document.getElementById(id)?.textContent?.trim();
    return !t || t === '—' || t === '…' || t === '-';
  };
  try {
    const res = await fetch('data/collection-stats.json', { cache: 'no-store' });
    if (res.ok) {
      const s = await res.json();
      if (!minted && s.minted != null) {
        minted = Number(s.minted) || 0;
        set('mint-minted', fmtInt(s.minted));
      }
      // Don't use snapshot holders if live already set a number (even incomplete was fixed server-side)
      if (isBlank('mint-holders') && s.holders != null) {
        holders = Number(s.holders) || 0;
        set('mint-holders', fmtInt(s.holders));
      }
      if (isBlank('mint-offer') && s.offer) set('mint-offer', s.offer);
      if (isBlank('mint-volume') && s.volume_all) set('mint-volume', s.volume_all);
      if (isBlank('mint-sales') && s.sales != null) set('mint-sales', fmtInt(s.sales));
      if (isBlank('mint-listed') && s.listed != null && s.listed !== '') {
        set('mint-listed', fmtInt(s.listed));
      }
    }
  } catch { /* ignore */ }

  if (!minted) minted = parseStatNum(document.getElementById('mint-minted')?.textContent);
  if (!holders) holders = parseStatNum(document.getElementById('mint-holders')?.textContent);

  updateMintCharts({ minted, holders, staked });
  return { minted, holders, staked, liveOk };
}

function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function setSnapshotStatus(msg, kind = '') {
  const el = document.getElementById('holders-snapshot-status');
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error', 'is-ok');
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('is-error', kind === 'error');
  el.classList.toggle('is-ok', kind === 'ok');
}

/** Download holders snapshot CSV from moze-api (or on-chain fallback). */
async function snapshotHolders() {
  const btn = document.getElementById('holders-snapshot');
  if (btn) btn.disabled = true;
  setSnapshotStatus('Fetching holders…');

  try {
    if (apiOnline === null) await pingApi();
    let wallets = [];
    let supply = MINT_SUPPLY_MAX;
    let updatedAt = Date.now();
    let source = 'api';

    if (apiOnline) {
      // Kick server scan, then poll (long wait=1 often times out behind reverse proxy)
      setSnapshotStatus('Starting holders scan…');
      try {
        await apiFetch('/v1/holders?force=1');
      } catch (e) {
        console.warn('[snapshot] force kick failed', e);
      }

      const maxPoll = 40; // ~2 min @ 3s
      for (let i = 0; i < maxPoll; i += 1) {
        try {
          const data = await apiFetch('/v1/holders');
          let list = Array.isArray(data.wallets) ? data.wallets : [];
          if (!list.length && Array.isArray(data.rows)) list = data.rows;
          supply = data.supply || supply;
          updatedAt = data.updatedAt || updatedAt;
          if (list.length) {
            wallets = list;
            source = 'api';
            break;
          }
          const scanning = !!data.scanning;
          setSnapshotStatus(
            scanning
              ? `Scanning holders… ${i + 1}/${maxPoll} (server)`
              : `Waiting for holders cache… ${i + 1}/${maxPoll}`,
            ''
          );
        } catch (pollErr) {
          console.warn('[snapshot] poll', pollErr);
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (!wallets.length && typeof ethers !== 'undefined') {
      setSnapshotStatus('API empty — scanning from your browser (slow)…');
      source = 'on-chain';
      const map = await buildHoldersMap({ allHolders: true });
      wallets = (map.rows || []).map((r) => ({ addr: r.addr, held: r.held }));
      supply = map.supply || supply;
      updatedAt = map.scannedAt || updatedAt;
    }

    if (!wallets.length) {
      throw new Error('No holders returned. Try again in a minute (scan may still be running).');
    }

    // sort by held desc
    wallets = [...wallets].sort(
      (a, b) => (Number(b.held) || 0) - (Number(a.held) || 0) ||
        String(a.addr).localeCompare(String(b.addr))
    );

    const when = new Date(updatedAt);
    const stamp = when.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const lines = [
      'rank,address,held',
      ...wallets.map((w, i) => `${i + 1},${String(w.addr || '').toLowerCase()},${Number(w.held) || 0}`),
    ];
    // meta as comment header
    const header =
      `# Moze holders snapshot\n` +
      `# source=${source} supply=${supply} wallets=${wallets.length} at=${when.toISOString()}\n` +
      `# site=https://www.mozestreet.art\n`;
    downloadTextFile(`moze-holders-${stamp}.csv`, header + lines.join('\n') + '\n');
    setSnapshotStatus(`Saved ${wallets.length} wallets · CSV downloaded · ${source}`, 'ok');
  } catch (err) {
    console.error(err);
    setSnapshotStatus(err?.message || 'Snapshot failed.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initMintStatsUi() {
  document.getElementById('holders-snapshot')?.addEventListener('click', () => {
    snapshotHolders();
  });
  document.getElementById('stats-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('stats-refresh');
    if (btn) btn.disabled = true;
    try {
      await refreshMintStats(true);
    } catch (err) {
      console.warn('[stats] refresh failed', err?.message || err);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function traitCaption(item) {
  const order = traitLore?.order || traitData?.layerOrder || [
    'BACKGROUND', 'BASE', 'SKIN', 'CLOTHES', 'EYES', 'HEAD', 'MOUTH',
  ];
  return order
    .map(k => item[k] || item[k?.toLowerCase?.()] || '')
    .filter(v => v && !/^blank/i.test(v))
    .join(' · ');
}

function resolveTraitLoreName(category, raw) {
  if (!raw || !traitLore?.traits?.[category]) return raw;
  const table = traitLore.traits[category];
  if (table[raw]) return raw;
  const canvas = `${raw} Canvas`;
  if (table[canvas]) return canvas;
  const lower = raw.toLowerCase();
  for (const key of Object.keys(table)) {
    if (key.toLowerCase() === lower) return key;
    if (key.toLowerCase().replace(/ canvas$/, '') === lower) return key;
  }
  return raw;
}

/** Build continuous story from trait fragments (A→B→C…). */
function buildMozeStory(item) {
  if (!traitLore?.traits) return '';
  const order = traitLore.order || [
    'BACKGROUND', 'BASE', 'SKIN', 'CLOTHES', 'EYES', 'HEAD', 'MOUTH',
  ];
  const parts = [];
  for (const layer of order) {
    const raw = item[layer] || item[layer.toLowerCase()] || '';
    if (!raw || /^blank/i.test(raw)) continue;
    const name = resolveTraitLoreName(layer, raw);
    const frag = traitLore.traits[layer]?.[name];
    if (frag) parts.push(frag);
  }
  return parts.join(' ');
}

function randomGalleryItems(n) {
  const pool = [...collection];
  const picks = [];
  for (let i = 0; i < n && pool.length; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

let galleryCycleIndex = 0;

function paintGalleryGrid(items) {
  galleryItems = items;
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  const imgVer = 'neon1';
  grid.innerHTML = galleryItems.map((item, i) => {
    const src = item.image.includes('?') ? item.image : `${item.image}?v=${imgVer}`;
    const nick = item.nickname || item.name || `Moze #${item.id}`;
    const num = item.tokenLabel || `#${item.id}`;
    return `
    <div class="gallery_item" data-index="${i}">
      <img src="${src}" alt="${nick}" loading="lazy">
      <div class="desc"><span class="nick">${nick}</span><span class="tok">${num}</span></div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.gallery_item').forEach(el => {
    el.addEventListener('click', () => {
      const item = galleryItems[+el.dataset.index];
      if (item) openLightbox(item);
    });
  });
}

function renderGallery() {
  gallerySearchActive = false;
  galleryCycleIndex = 0;
  paintGalleryGrid(randomGalleryItems(gallerySize()));
  const clearBtn = document.getElementById('gallery-clear');
  if (clearBtn) clearBtn.hidden = true;
  const status = document.getElementById('gallery-search-status');
  if (status) status.textContent = '';
}

function startGalleryRotate() {
  if (galleryRotateTimer) clearInterval(galleryRotateTimer);
  galleryRotateTimer = setInterval(rotateGallerySlot, GALLERY_ROTATE_MS);
}

function rotateGallerySlot() {
  if (gallerySearchActive || !galleryItems.length) return;
  const grid = document.getElementById('gallery-grid');
  const slotEl = grid?.children[galleryCycleIndex];
  if (!slotEl) return;

  const [newItem] = randomGalleryItems(1);
  if (!newItem) return;
  galleryItems[galleryCycleIndex] = newItem;
  const rotSrc = newItem.image.includes('?') ? newItem.image : `${newItem.image}?v=neon1`;
  const nick = newItem.nickname || newItem.name || `Moze #${newItem.id}`;
  const num = newItem.tokenLabel || `#${newItem.id}`;
  slotEl.querySelector('img').src = rotSrc;
  slotEl.querySelector('img').alt = nick;
  const desc = slotEl.querySelector('.desc');
  if (desc) {
    desc.innerHTML = `<span class="nick">${nick}</span><span class="tok">${num}</span>`;
  }

  galleryCycleIndex = (galleryCycleIndex + 1) % galleryItems.length;
}

function findTokenByQuery(q) {
  const raw = (q || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/^moze\s*#?/i, '').replace(/#/g, '').trim();
  const id = parseInt(digits, 10);
  if (!Number.isFinite(id)) return null;
  return collection.find(c => Number(c.id) === id) || null;
}

function runGallerySearch(query) {
  const status = document.getElementById('gallery-search-status');
  const clearBtn = document.getElementById('gallery-clear');
  const item = findTokenByQuery(query);
  if (!item) {
    if (status) status.textContent = 'Token not found. Try a number 1–1000.';
    return;
  }
  gallerySearchActive = true;
  paintGalleryGrid([item]);
  if (clearBtn) clearBtn.hidden = false;
  if (status) status.textContent = `Showing ${item.name}`;
  openLightbox(item);
}

function initGallerySearch() {
  const form = document.getElementById('gallery-search-form');
  const input = document.getElementById('gallery-search-input');
  const clearBtn = document.getElementById('gallery-clear');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    runGallerySearch(input?.value || '');
  });
  clearBtn?.addEventListener('click', () => {
    if (input) input.value = '';
    renderGallery();
  });
  // Re-fill gallery count when crossing mobile/desktop (15 ↔ 16)
  let lastGallerySize = gallerySize();
  window.addEventListener('resize', () => {
    const next = gallerySize();
    if (next === lastGallerySize || gallerySearchActive) return;
    lastGallerySize = next;
    renderGallery();
  });
}

function openLightbox(item) {
  const src = item.image.includes('?') ? item.image : `${item.image}?v=neon1`;
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox-img').alt = item.name;
  const nick = item.nickname || item.name || `Moze #${item.id}`;
  const num = item.tokenLabel || `#${item.id}`;
  const traitsLine = traitCaption(item);
  document.getElementById('lightbox-caption').textContent =
    traitsLine ? `${nick} ${num} · ${traitsLine}` : `${nick} ${num}`;

  const storyEl = document.getElementById('lightbox-story');
  let story = buildMozeStory(item);
  // fewer em-dashes in lore text
  if (story) {
    story = story
      .replace(/\s*—\s*/g, '. ')
      .replace(/\.\s*\./g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (storyEl) {
    if (story) {
      storyEl.hidden = false;
      storyEl.innerHTML = `
        <div class="story-label">Story</div>
        <p>${story}</p>`;
    } else {
      storyEl.hidden = true;
      storyEl.innerHTML = '';
    }
  }
  document.getElementById('lightbox').hidden = false;
}

function closeLightbox() {
  document.getElementById('lightbox').hidden = true;
}

function initLightbox() {
  document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
  document.getElementById('lightbox')?.addEventListener('click', e => {
    if (e.target.id === 'lightbox') closeLightbox();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox();
  });
}

let leaderboardVisible = false;
let leaderboardCache = null;
let leaderboardLoading = false;

/* ── moze-api (separate backend) ── */
// Production: https://api.mozestreet.art
// Local: on 127.0.0.1/localhost auto-use :3000 (unless override).
// Override: window.MOZE_API or localStorage.setItem('moze-api','http://localhost:3000')
function resolveApiBase() {
  if (typeof window !== 'undefined' && window.MOZE_API) {
    return String(window.MOZE_API).replace(/\/$/, '');
  }
  try {
    const saved = localStorage.getItem('moze-api');
    if (saved) return String(saved).replace(/\/$/, '');
  } catch { /* ignore */ }
  try {
    const h = typeof location !== 'undefined' ? location.hostname : '';
    if (h === 'localhost' || h === '127.0.0.1') {
      return 'http://127.0.0.1:3000';
    }
  } catch { /* ignore */ }
  return 'https://api.mozestreet.art';
}
let API_BASE = resolveApiBase();

let apiOnline = null; // null unknown, true/false

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || 'API error');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function pingApi() {
  // Explicit override always wins (local raffle/dev testing)
  const override =
    (typeof window !== 'undefined' && window.MOZE_API) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('moze-api'));
  if (override) {
    API_BASE = String(override).replace(/\/$/, '');
  } else {
    // Default: production — real stake/leaderboard data (local empty DB caused hangs/desync)
    API_BASE = 'https://api.mozestreet.art';
  }
  try {
    const h = await apiFetch('/health');
    apiOnline = !!(h && h.ok);
  } catch {
    apiOnline = false;
  }
  return apiOnline;
}

function buildMozeActionMessage({ action, address, tokenIds, nonce, timestamp }) {
  const tokens = (tokenIds || []).map(Number).sort((a, b) => a - b).join(',');
  return [
    'Moze Staking',
    `Action: ${action}`,
    `Tokens: ${tokens || '-'}`,
    `Address: ${String(address).toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');
}

/** Sign + POST stake/unstake/claim to backend. Best-effort; does not throw to UI. */
async function apiSignedAction(action, tokenIds = []) {
  if (!stakeAccount) return null;
  if (apiOnline === false) return null;
  try {
    if (apiOnline === null) await pingApi();
    if (!apiOnline) return null;

    const address = String(stakeAccount).toLowerCase();
    const ids = (tokenIds || []).map(Number);
    const nonceRes = await apiFetch('/v1/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
    const nonce = nonceRes.nonce;
    const timestamp = Date.now();
    const message = buildMozeActionMessage({
      action,
      address,
      tokenIds: action === 'claim' ? [] : ids,
      nonce,
      timestamp,
    });

    const eth = getEthereum();
    if (!eth) throw new Error('No wallet');
    const provider = new ethers.BrowserProvider(eth);
    const signer = await provider.getSigner();
    const signature = await signer.signMessage(message);

    const path =
      action === 'stake' ? '/v1/stake' :
      action === 'unstake' ? '/v1/unstake' :
      '/v1/claim';

    const body = {
      address,
      tokenIds: action === 'claim' ? [] : ids,
      nonce,
      timestamp,
      signature,
    };
    const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
    // Keep localStorage in sync with server after successful signed action
    if (res?.ok && res.state) {
      applyServerStakeToLocal(address, res.state);
    } else if (res?.ok) {
      await hydrateStakeFromApi(address);
    }
    return res;
  } catch (err) {
    console.warn('[moze-api]', action, err?.message || err);
    return { error: err?.message || String(err) };
  }
}

/** Inject/update connected wallet row from local soft-stake state (API may lag). */
function mergeYouIntoLeaderboardRows(rowsIn) {
  const rows = Array.isArray(rowsIn) ? rowsIn.map((r) => ({ ...r })) : [];
  const you = stakeAccount ? String(stakeAccount).toLowerCase() : '';
  if (!you) return rows;

  const localSoft = softStakePointsFor(you);
  const localStaked = stakedCountFor(you);
  if (localSoft <= 0 && localStaked <= 0) return rows;

  const idx = rows.findIndex((r) => String(r.addr || '').toLowerCase() === you);
  if (idx >= 0) {
    rows[idx] = {
      ...rows[idx],
      addr: you,
      softMoze: Math.max(Number(rows[idx].softMoze) || 0, localSoft),
      staked: Math.max(Number(rows[idx].staked) || 0, localStaked),
      held: Number(rows[idx].held) || stakeOwnedIds.length || 0,
    };
  } else {
    rows.push({
      addr: you,
      held: stakeOwnedIds.length || 0,
      staked: localStaked,
      softMoze: localSoft,
    });
  }

  return rows
    .filter((r) => (Number(r.staked) || 0) > 0 || (Number(r.softMoze) || 0) > 0)
    .sort(
      (a, b) =>
        (Number(b.softMoze) || 0) - (Number(a.softMoze) || 0) ||
        (Number(b.staked) || 0) - (Number(a.staked) || 0) ||
        (Number(b.held) || 0) - (Number(a.held) || 0) ||
        String(a.addr).localeCompare(String(b.addr))
    );
}

async function loadLeaderboardFromApi(force) {
  const you = stakeAccount ? String(stakeAccount).toLowerCase() : '';
  const q = new URLSearchParams();
  q.set('top', String(LB_TOP_N));
  if (you) q.set('you', you);
  if (force) q.set('force', '1');
  const data = await apiFetch(`/v1/leaderboard?${q}`);
  const sourceRows = Array.isArray(data.rows) && data.rows.length
    ? data.rows
    : (data.top || []);
  // Stakers only (backend filters; keep client guard)
  let rows = sourceRows
    .map((r) => ({
      addr: String(r.addr || '').toLowerCase(),
      held: Number(r.held) || 0,
      staked: Number(r.staked) || 0,
      softMoze: Number(r.softMoze) || 0,
    }))
    .filter((r) => r.staked > 0 || r.softMoze > 0);

  rows = mergeYouIntoLeaderboardRows(rows);
  return {
    rows,
    supply: data.supply || 1000,
    scannedAt: data.updatedAt || Date.now(),
    source: 'api',
  };
}

/** Count soft-staked Moze for account (local stake state). */
function stakedCountFor(account) {
  if (!account) return 0;
  try {
    const state = loadStakeState(account);
    return Object.keys(state.positions || {}).length;
  } catch {
    return 0;
  }
}

/**
 * Leaderboard is fully hidden until the connected wallet has ≥1 staked Moze.
 * No lock UI — section only mounts into view for stakers.
 */
function syncLeaderboardVisibility() {
  const section = document.getElementById('leaderboard');
  const staked = stakedCountFor(stakeAccount);
  const show = !!(stakeAccount && staked > 0);
  leaderboardVisible = show;
  if (section) {
    section.hidden = !show;
    if (!show) section.setAttribute('aria-hidden', 'true');
    else section.removeAttribute('aria-hidden');
  }
  if (show) {
    // Soft load (no force full chain scan) — "you" merged from local stake
    loadHoldersLeaderboard(false).catch(() => null);
  }
}

function initTraits() {
  selectedTraits = { ...traitData.defaults };
  renderTraitTabs();
  renderTraitItems();
  renderComposer();

  document.getElementById('random-traits')?.addEventListener('click', () => {
    randomizeTraits();
  });
  document.getElementById('download-moze')?.addEventListener('click', () => {
    downloadMoze();
  });
  document.getElementById('lb-refresh')?.addEventListener('click', () => {
    if (!leaderboardVisible) return;
    loadHoldersLeaderboard(true);
  });
  // hidden until user stakes
  syncLeaderboardVisibility();
}

const LB_CACHE_KEY = 'moze-stakers-lb-v4';
const LB_CACHE_TTL = 5 * 60 * 1000; // 5 min
/** How many rows to request for `top` fallback (API also returns full `rows`). */
const LB_TOP_N = 100;
/** First paint: max 20 rows. See More adds LB_LOAD_MORE each click. */
const LB_INITIAL_SHOW = 20;
const LB_LOAD_MORE = 20;
let lbCurrentShown = LB_INITIAL_SHOW;

function softStakePointsFor(addr) {
  try {
    const state = loadStakeState(addr);
    return pendingMoze(state) + (Number(state.claimed) || 0);
  } catch {
    return 0;
  }
}

/**
 * Full collection ownerOf scan in the browser.
 * @param {{ allHolders?: boolean }} opts — allHolders=true for CSV snapshot (default).
 *   false = only wallets with local soft $MOZE (legacy leaderboard fallback).
 */
async function buildHoldersMap({ allHolders = true } = {}) {
  const read = getRobinhoodReadProvider();
  const contract = new ethers.Contract(MOZE_CA, ERC721_ABI, read);
  let supply = 1000;
  try {
    const ts = Number(await contract.totalSupply());
    if (ts > 0) supply = Math.min(1000, ts);
  } catch { /* 1000 */ }

  const counts = new Map();
  const batch = 50;
  const maxId = Math.max(supply, 1);
  for (let start = 1; start <= maxId; start += batch) {
    const chunk = [];
    for (let id = start; id < start + batch && id <= maxId; id += 1) {
      chunk.push(
        contract.ownerOf(id)
          .then((o) => String(o).toLowerCase())
          .catch(() => null)
      );
    }
    const owners = await Promise.all(chunk);
    for (const o of owners) {
      if (!o || o === '0x0000000000000000000000000000000000000000') continue;
      counts.set(o, (counts.get(o) || 0) + 1);
    }
    if (start === 1 || start % 200 === 1) {
      setSnapshotStatus(
        `Scanning on-chain… ${Math.min(start + batch - 1, maxId)}/${maxId}`,
        ''
      );
    }
  }
  // also try token 0
  try {
    const o0 = String(await contract.ownerOf(0)).toLowerCase();
    if (o0 && o0 !== '0x0000000000000000000000000000000000000000') {
      counts.set(o0, (counts.get(o0) || 0) + 1);
    }
  } catch { /* no token 0 */ }

  let rows = [...counts.entries()].map(([addr, held]) => ({
    addr,
    held,
    softMoze: softStakePointsFor(addr),
  }));
  if (!allHolders) {
    rows = rows.filter((r) => r.softMoze > 0);
    rows.sort(
      (a, b) =>
        b.softMoze - a.softMoze || b.held - a.held || a.addr.localeCompare(b.addr)
    );
  } else {
    rows.sort(
      (a, b) => b.held - a.held || a.addr.localeCompare(b.addr)
    );
  }

  return { rows, supply, scannedAt: Date.now() };
}

function renderLeaderboardTable(data, keepShown = false) {
  const tbody = document.getElementById('lb-tbody');
  const meta = document.getElementById('lb-meta');
  if (!tbody) return;

  // Reset to initial 20 on fresh load, keep count on "See More" click
  if (!keepShown) lbCurrentShown = LB_INITIAL_SHOW;

  const you = (stakeAccount || '').toLowerCase();
  // Active Moze only: still hold NFT and/or still have soft-stake positions.
  // Drop "ghost" rows with soft $MOZE left but held=0 and staked=0 (sold everything).
  const stakers = (data.rows || []).filter((r) => {
    const held = Number(r.held) || 0;
    const staked = Number(r.staked) || 0;
    const soft = Number(r.softMoze) || 0;
    if (soft <= 0 && staked <= 0) return false;
    return held > 0 || staked > 0;
  });
  if (!stakers.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">No stakers yet — be the first.</td></tr>';
    if (meta) meta.textContent = '0 stakers';
    return;
  }

  const total = stakers.length;
  const shown = Math.min(lbCurrentShown, total);
  const displayed = stakers.slice(0, shown);
  tbody.innerHTML = displayed.map((row, i) => {
    const isYou = you && row.addr === you;
    const soft = row.softMoze > 0 ? formatMoze(row.softMoze) : '0';
    return (
      `<tr class="${isYou ? 'lb-you' : ''}">` +
      `<td class="lb-rank">${i + 1}</td>` +
      `<td class="lb-wallet">${shortAddr(row.addr)}${isYou ? ' · you' : ''}</td>` +
      `<td class="lb-held">${row.held}</td>` +
      `<td class="lb-staked">${soft}</td>` +
      `</tr>`
    );
  }).join('');

  // If you're a staker but outside currently shown range, append your row
  // (not duplicated once See More reaches your rank)
  if (you) {
    const yourIdx = stakers.findIndex((r) => r.addr === you);
    if (yourIdx >= shown) {
      const row = stakers[yourIdx];
      const soft = row.softMoze > 0 ? formatMoze(row.softMoze) : '0';
      tbody.innerHTML += (
        `<tr class="lb-you">` +
        `<td class="lb-rank">${yourIdx + 1}</td>` +
        `<td class="lb-wallet">${shortAddr(row.addr)} · you</td>` +
        `<td class="lb-held">${row.held}</td>` +
        `<td class="lb-staked">${soft}</td>` +
        `</tr>`
      );
    }
  }

  // See More: reveal next batch until full list
  if (shown < total) {
    const remaining = total - shown;
    const seeMoreRow = document.createElement('tr');
    seeMoreRow.className = 'lb-see-more-row';
    seeMoreRow.innerHTML = `<td colspan="4" style="text-align:center;padding:10px 0 6px;">` +
      `<button type="button" class="lb-see-more-btn">See More (${remaining} left)</button></td>`;
    tbody.appendChild(seeMoreRow);
    const btn = seeMoreRow.querySelector('.lb-see-more-btn');
    btn.addEventListener('click', () => {
      lbCurrentShown = Math.min(lbCurrentShown + LB_LOAD_MORE, total);
      renderLeaderboardTable(data, true);
    });
  }

  if (meta) {
    const when = new Date(data.scannedAt || Date.now()).toLocaleTimeString();
    meta.textContent = `Showing ${shown} of ${total} stakers · ${when}`;
  }
}

function applyLocalStakerToLeaderboardData(data) {
  if (!data) return data;
  const next = {
    ...data,
    rows: mergeYouIntoLeaderboardRows(data.rows || []),
  };
  return next;
}

async function loadHoldersLeaderboard(force) {
  if (!leaderboardVisible) return;
  // Allow forced refresh to supersede a stuck load; otherwise skip concurrent
  if (leaderboardLoading && !force) return;

  const tbody = document.getElementById('lb-tbody');
  const meta = document.getElementById('lb-meta');

  if (force) {
    leaderboardCache = null;
    try { sessionStorage.removeItem(LB_CACHE_KEY); } catch { /* ignore */ }
  }

  // session cache — always re-merge "you"
  if (!force && !leaderboardCache) {
    try {
      const raw = sessionStorage.getItem(LB_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.scannedAt && Date.now() - cached.scannedAt < LB_CACHE_TTL) {
          leaderboardCache = cached;
        }
      }
    } catch { /* ignore */ }
  }

  if (!force && leaderboardCache) {
    const merged = applyLocalStakerToLeaderboardData(leaderboardCache);
    leaderboardCache = merged;
    renderLeaderboardTable(merged);
    return;
  }

  // Instant local skeleton so UI never sits on "Loading…" forever
  const localOnly = applyLocalStakerToLeaderboardData({
    rows: [],
    supply: 1000,
    scannedAt: Date.now(),
    source: 'local',
  });
  if (localOnly.rows.length) {
    renderLeaderboardTable(localOnly);
    if (meta) meta.textContent = 'Updating…';
  } else {
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">Loading leaderboard…</td></tr>';
    if (meta) meta.textContent = 'Loading…';
  }

  leaderboardLoading = true;
  try {
    if (apiOnline === null) await pingApi();
    if (apiOnline) {
      // Never pass force=1 to API (blocks on full holder scan). Client cache is enough.
      const withTimeout = Promise.race([
        loadLeaderboardFromApi(false),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('Leaderboard timeout')), 12000)
        ),
      ]);
      let data = await withTimeout;
      data = applyLocalStakerToLeaderboardData(data);
      leaderboardCache = data;
      try { sessionStorage.setItem(LB_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
      renderLeaderboardTable(data);
      return;
    }

    // API offline: keep local staker rows
    if (localOnly.rows.length) {
      leaderboardCache = localOnly;
      renderLeaderboardTable(localOnly);
      if (meta) meta.textContent = 'Local only (API offline)';
      return;
    }
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="lb-empty">API offline — stake to appear here.</td></tr>';
    }
  } catch (err) {
    console.error(err);
    const fallback = applyLocalStakerToLeaderboardData({
      rows: leaderboardCache?.rows || [],
      supply: 1000,
      scannedAt: Date.now(),
      source: 'local',
    });
    if (fallback.rows.length) {
      leaderboardCache = fallback;
      renderLeaderboardTable(fallback);
      if (meta) meta.textContent = 'Showing local stake';
    } else if (tbody) {
      tbody.innerHTML = `<tr><td colspan="4" class="lb-empty">${err?.message || 'Failed to load leaderboard.'}</td></tr>`;
    }
  } finally {
    leaderboardLoading = false;
  }
}

function renderTraitTabs() {
  const tabs = document.getElementById('trait-tabs');
  tabs.innerHTML = traitData.categories.map(cat => `
    <button class="trait-tab${cat.name === activeCategory ? ' active' : ''}" data-cat="${cat.name}">
      ${cat.name}<span> ${cat.count}</span>
    </button>
  `).join('');

  tabs.querySelectorAll('.trait-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      renderTraitTabs();
      renderTraitItems();
    });
  });
}

function renderTraitItems() {
  const container = document.getElementById('trait-items');
  const cat = traitData.categories.find(c => c.name === activeCategory);
  if (!cat) return;

  container.innerHTML = cat.items.map(item => `
    <button class="trait-item${selectedTraits[activeCategory] === item.name ? ' active' : ''}"
            data-name="${item.name}" title="${item.name}">
      <img src="${item.image}" alt="${item.name}" loading="lazy">
      <span>${item.name}</span>
    </button>
  `).join('');

  container.querySelectorAll('.trait-item').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTraits[activeCategory] = btn.dataset.name;
      renderTraitItems();
      renderComposer();
    });
  });
}

function isBlankTrait(name) {
  return !name || /^blank(#\d+)?$/i.test(name);
}

function getTraitItem(category, name) {
  const cat = traitData.categories.find(c => c.name === category);
  return cat?.items.find(i => i.name === name);
}

function loadTraitImage(src) {
  if (traitImageCache.has(src)) return traitImageCache.get(src);

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });

  traitImageCache.set(src, promise);
  return promise;
}

async function composeMoze(traits) {
  const canvas = document.createElement('canvas');
  canvas.width = COMPOSER_SIZE;
  canvas.height = COMPOSER_SIZE;
  const ctx = canvas.getContext('2d');

  // Load all layers in parallel (much faster than sequential)
  const jobs = [];
  for (const layer of traitData.layerOrder) {
    const name = traits[layer];
    if (isBlankTrait(name)) continue;
    const item = getTraitItem(layer, name);
    if (!item) continue;
    jobs.push(loadTraitImage(item.image));
  }
  const images = await Promise.all(jobs);
  for (const img of images) {
    ctx.drawImage(img, 0, 0, COMPOSER_SIZE, COMPOSER_SIZE);
  }

  return canvas;
}

function traitSummary(traits) {
  return traitData.layerOrder
    .filter(layer => !isBlankTrait(traits[layer]))
    .map(layer => traits[layer])
    .join(' · ');
}

/** Pixel loading FX inside Trait Lab canvas (shows work in progress, not lag). */
let composerPixelAnim = null;

function stopComposerPixelFx() {
  if (composerPixelAnim?.raf) cancelAnimationFrame(composerPixelAnim.raf);
  if (composerPixelAnim?.swapTimer) clearInterval(composerPixelAnim.swapTimer);
  composerPixelAnim = null;
}

function startComposerPixelFx() {
  stopComposerPixelFx();
  const wrap = document.getElementById('composer-canvas');
  if (!wrap) return;

  wrap.classList.add('is-generating');
  const canvas = document.createElement('canvas');
  canvas.className = 'composer-pixel-fx';
  canvas.width = 256;
  canvas.height = 256;
  canvas.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = '';
  wrap.appendChild(canvas);

  const state = {
    canvas,
    img: null,
    t: 0.15,
    raf: 0,
    swapTimer: 0,
    started: performance.now(),
  };
  composerPixelAnim = state;

  const loadRandom = () => {
    const id = 1 + Math.floor(Math.random() * 1000);
    loadImageEl(collectionUrl(id))
      .then((img) => {
        if (composerPixelAnim !== state) return;
        state.img = img;
        state.t = 0.08 + Math.random() * 0.2;
      })
      .catch(() => { /* ignore */ });
  };
  loadRandom();
  // Swap random Moze every ~280ms so it feels alive while layers load
  state.swapTimer = setInterval(loadRandom, 280);

  const tick = (now) => {
    if (composerPixelAnim !== state) return;
    const elapsed = (now - state.started) / 1000;
    // Pulse pixelation 0.15 → 0.55 → 0.2 (never fully clear until real render)
    const pulse = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(elapsed * 4.2));
    if (state.img) drawPixelReveal(state.canvas, state.img, pulse);
    else {
      // noise placeholder until first image loads
      const ctx = state.canvas.getContext('2d');
      if (ctx) {
        const g = ctx.createImageData(32, 32);
        for (let i = 0; i < g.data.length; i += 4) {
          const v = 80 + Math.random() * 120;
          g.data[i] = g.data[i + 1] = g.data[i + 2] = v;
          g.data[i + 3] = 255;
        }
        const off = document.createElement('canvas');
        off.width = 32;
        off.height = 32;
        off.getContext('2d').putImageData(g, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(off, 0, 0, 256, 256);
      }
    }
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

/** Final image: pixel → clear reveal */
async function revealComposerResult(dataUrl, token) {
  const wrap = document.getElementById('composer-canvas');
  if (!wrap) return;
  stopComposerPixelFx();

  const canvas = document.createElement('canvas');
  canvas.className = 'composer-pixel-fx';
  canvas.width = 256;
  canvas.height = 256;
  wrap.innerHTML = '';
  wrap.appendChild(canvas);

  let img;
  try {
    img = await loadImageEl(dataUrl);
  } catch {
    wrap.innerHTML = `<img src="${dataUrl}" alt="Generated Moze" class="composer-preview">`;
    wrap.classList.remove('is-generating');
    return;
  }
  if (token !== renderComposerToken) return;

  const steps = [0.12, 0.22, 0.35, 0.5, 0.68, 0.85, 1];
  for (const t of steps) {
    if (token !== renderComposerToken) return;
    drawPixelReveal(canvas, img, t);
    await sleep(38);
  }
  if (token !== renderComposerToken) return;
  wrap.innerHTML = `<img src="${dataUrl}" alt="Generated Moze" class="composer-preview">`;
  wrap.classList.remove('is-generating');
}

async function renderComposer({ withPixelFx = false } = {}) {
  const wrap = document.getElementById('composer-canvas');
  const caption = document.getElementById('composer-caption');
  const downloadBtn = document.getElementById('download-moze');
  const randomBtn = document.getElementById('random-traits');
  const token = ++renderComposerToken;

  if (downloadBtn) downloadBtn.disabled = true;
  if (randomBtn) randomBtn.disabled = true;

  if (withPixelFx) {
    startComposerPixelFx();
    if (caption) caption.textContent = 'Generating…';
  } else if (!wrap.querySelector('.composer-preview') && !wrap.querySelector('.composer-pixel-fx')) {
    wrap.innerHTML = '<div class="composer-empty">Generating…</div>';
  }

  try {
    const canvas = await composeMoze(selectedTraits);
    if (token !== renderComposerToken) return;

    composerDataUrl = canvas.toDataURL('image/png');

    if (withPixelFx || wrap.querySelector('.composer-pixel-fx')) {
      await revealComposerResult(composerDataUrl, token);
    } else {
      const preview = wrap.querySelector('.composer-preview');
      if (preview) {
        preview.src = composerDataUrl;
      } else {
        wrap.innerHTML = `<img src="${composerDataUrl}" alt="Generated Moze" class="composer-preview">`;
      }
      wrap.classList.remove('is-generating');
    }

    if (token !== renderComposerToken) return;
    if (caption) caption.textContent = traitSummary(selectedTraits);
    if (downloadBtn) downloadBtn.disabled = false;
  } catch {
    if (token !== renderComposerToken) return;
    stopComposerPixelFx();
    composerDataUrl = null;
    wrap.classList.remove('is-generating');
    wrap.innerHTML = '<div class="composer-empty">Could not generate — check trait layers</div>';
    if (caption) caption.textContent = '';
    if (downloadBtn) downloadBtn.disabled = true;
  } finally {
    if (token === renderComposerToken && randomBtn) randomBtn.disabled = false;
  }
}

function randomizeTraits() {
  for (const cat of traitData.categories) {
    const item = cat.items[Math.floor(Math.random() * cat.items.length)];
    selectedTraits[cat.name] = item.name;
  }
  renderTraitTabs();
  renderTraitItems();
  renderComposer({ withPixelFx: true });
}

function downloadMoze() {
  if (!composerDataUrl) return;
  const link = document.createElement('a');
  link.href = composerDataUrl;
  link.download = `moze-${Date.now()}.png`;
  link.click();
}

function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

document.getElementById('wl-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('wallet-input');
  const result = document.getElementById('wl-result');
  const status = document.getElementById('wl-status');
  const detail = document.getElementById('wl-detail');
  const addr = input.value.trim();

  if (!addr) return;

  if (!isValidAddress(addr)) {
    result.hidden = false;
    result.className = 'wl-result fail';
    status.textContent = 'Invalid address';
    detail.textContent = 'Please enter a valid wallet (0x + 40 characters).';
    return;
  }

  const found = whitelist.has(addr.toLowerCase());
  result.hidden = false;
  result.className = `wl-result ${found ? 'success' : 'fail'}`;
  status.textContent = found ? "You're whitelisted!" : 'Not whitelisted';
  detail.textContent = found
    ? 'Your wallet is on the list. Get ready for the free mint.'
    : 'Not on the list yet — drop your wallet on X for a chance.';
});

/* ── Staking (Robinhood + Moze) · $MOZE soft rewards ── */
const MOZE_CA = '0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc';
const MOZE_RATE_PER_DAY = 10;
const MS_PER_DAY = 86400000;
const RH_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const RH_CHAIN = {
  chainId: '0x1237', // 4663
  chainName: 'Robinhood Chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: [RH_RPC],
  blockExplorerUrls: ['https://explorer.mainnet.chain.robinhood.com'],
};
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
];

let stakeAccount = null;
let stakeOwnedIds = [];
let stakeSelected = new Set();
let stakeTickTimer = null;
let connectInFlight = false;
let walletListenersBound = false;
/** User-selected EIP-1193 provider (from wallet modal). */
let preferredWalletProvider = null;
/** EIP-6963 announced wallets: { info, provider }[] */
const eip6963Wallets = [];
/** Client cache of owned token lists (session). */
const ownedTokensClientCache = new Map(); // addr -> { at, tokens }

function getEthereum() {
  if (preferredWalletProvider) return preferredWalletProvider;
  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length) {
    return eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
  }
  return eth;
}

function initEip6963() {
  if (typeof window === 'undefined') return;
  window.addEventListener('eip6963:announceProvider', (event) => {
    const detail = event?.detail;
    if (!detail?.provider || !detail?.info) return;
    const rdns = detail.info.rdns || detail.info.uuid || detail.info.name;
    if (eip6963Wallets.some((w) => (w.info.rdns || w.info.uuid) === rdns)) return;
    eip6963Wallets.push({ info: detail.info, provider: detail.provider });
  });
  try {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  } catch { /* ignore */ }
}
initEip6963();

/** Heuristic: Cosmos-first wallets (may still expose EVM provider). */
function isCosmosStyleWallet(name = '', rdns = '') {
  const s = `${name} ${rdns}`.toLowerCase();
  return (
    s.includes('keplr') ||
    s.includes('leap wallet') ||
    s.includes('cosmostation') ||
    s.includes('station.terra')
  );
}

/**
 * Resolve best EIP-1193 provider for a wallet entry.
 * Keplr often injects window.keplr.ethereum for EVM chains.
 */
function resolveWalletProvider(w) {
  if (w?.provider) return w.provider;
  const name = (w?.name || '').toLowerCase();
  if (name.includes('keplr') || w?.id?.includes('keplr')) {
    try {
      if (window.keplr?.ethereum) return window.keplr.ethereum;
      if (window.keplr?.getOfflineSigner) {
        // Some builds expose ethereum on keplr after enable
        return window.keplr.ethereum || null;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function listAvailableWallets() {
  const list = [];
  const seen = new Set();

  // EIP-6963 (includes Keplr when installed)
  for (const w of eip6963Wallets) {
    const name = w.info.name || 'Wallet';
    const rdns = w.info.rdns || w.info.uuid || '';
    const key = rdns || name;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      id: key,
      name,
      icon: w.info.icon || '',
      provider: w.provider,
      kind: 'eip6963',
      cosmosStyle: isCosmosStyleWallet(name, rdns),
    });
  }

  // window.ethereum multi-inject
  const eth = window.ethereum;
  if (eth) {
    const providers = Array.isArray(eth.providers) && eth.providers.length
      ? eth.providers
      : [eth];
    for (const p of providers) {
      let name = 'Browser wallet';
      let id = 'injected';
      if (p.isMetaMask && !p.isRabby) {
        name = 'MetaMask';
        id = 'metamask';
      } else if (p.isRabby) {
        name = 'Rabby';
        id = 'rabby';
      } else if (p.isCoinbaseWallet || p.isCoinbaseBrowser) {
        name = 'Coinbase Wallet';
        id = 'coinbase';
      } else if (p.isOkxWallet || p.isOKExWallet) {
        name = 'OKX Wallet';
        id = 'okx';
      } else if (p.isBraveWallet) {
        name = 'Brave Wallet';
        id = 'brave';
      } else if (p.isKeplr) {
        name = 'Keplr';
        id = 'keplr-injected';
      }
      if (seen.has(id) || list.some((x) => x.provider === p)) continue;
      if (id === 'metamask' && list.some((x) => /metamask/i.test(x.name))) continue;
      if (id === 'rabby' && list.some((x) => /rabby/i.test(x.name))) continue;
      if (id === 'keplr-injected' && list.some((x) => /keplr/i.test(x.name))) continue;
      if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
      seen.add(id);
      list.push({
        id,
        name,
        icon: '',
        provider: p,
        kind: 'injected',
        cosmosStyle: /keplr/i.test(name),
      });
    }
  }

  // Keplr EVM provider if announced separately
  if (window.keplr?.ethereum && !list.some((x) => /keplr/i.test(x.name))) {
    list.push({
      id: 'keplr-ethereum',
      name: 'Keplr',
      icon: '',
      provider: window.keplr.ethereum,
      kind: 'keplr',
      cosmosStyle: true,
    });
  } else if (window.keplr && !list.some((x) => /keplr/i.test(x.name))) {
    // Still show Keplr entry; resolve provider on click
    list.push({
      id: 'keplr-window',
      name: 'Keplr',
      icon: '',
      provider: window.keplr.ethereum || null,
      kind: 'keplr',
      cosmosStyle: true,
    });
  }

  // Prefer MetaMask / Rabby first; Keplr after common EVM
  list.sort((a, b) => {
    const rank = (n) => {
      const s = n.toLowerCase();
      if (s.includes('metamask')) return 0;
      if (s.includes('rabby')) return 1;
      if (s.includes('okx')) return 2;
      if (s.includes('coinbase')) return 3;
      if (s.includes('keplr')) return 5;
      return 9;
    };
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
  });

  if (!list.length) {
    list.push({
      id: 'none',
      name: 'No wallet detected',
      icon: '',
      provider: null,
      kind: 'empty',
    });
  }
  return list;
}

function openWalletModal() {
  const modal = document.getElementById('wallet-modal');
  const listEl = document.getElementById('wallet-modal-list');
  if (!modal || !listEl) return;
  // Re-request EIP-6963 in case wallets injected late
  try {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  } catch { /* ignore */ }
  // slight delay so late announces land
  window.setTimeout(() => {
    const wallets = listAvailableWallets();
    listEl.innerHTML = wallets
      .map((w) => {
        if (w.kind === 'empty') {
          return `<p class="wallet-modal-empty fine">Install MetaMask, Rabby, or Keplr, then refresh.</p>`;
        }
        const icon = w.icon
          ? `<img src="${w.icon}" alt="" class="wallet-modal-icon" width="32" height="32">`
          : `<span class="wallet-modal-icon-fallback" aria-hidden="true">${/keplr/i.test(w.name) ? 'K' : '◈'}</span>`;
        const note = w.cosmosStyle
          ? `<span class="wallet-modal-item-note">EVM mode · Robinhood</span>`
          : '';
        return `<button type="button" class="wallet-modal-item" data-wallet-id="${w.id}">
          ${icon}
          <span class="wallet-modal-item-text">
            <span class="wallet-modal-item-name">${w.name}</span>
            ${note}
          </span>
        </button>`;
      })
      .join('');

    listEl.querySelectorAll('[data-wallet-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wallet-id');
        const w = wallets.find((x) => x.id === id);
        if (!w) return;
        const provider = resolveWalletProvider(w);
        if (!provider) {
          setStakeStatus(
            /keplr/i.test(w.name || '')
              ? 'Keplr found but no EVM provider. Enable Ethereum in Keplr, or use MetaMask for Robinhood.'
              : 'This wallet has no EVM provider.',
            true
          );
          closeWalletModal();
          return;
        }
        preferredWalletProvider = provider;
        closeWalletModal();
        connectStakeWallet().catch((err) => {
          console.error(err);
          setStakeStatus(err?.message || 'Failed to connect wallet.', true);
        });
      });
    });
  }, 80);

  modal.hidden = false;
  document.body.classList.add('wallet-modal-open');
}

function closeWalletModal() {
  const modal = document.getElementById('wallet-modal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('wallet-modal-open');
}

function initWalletModal() {
  const modal = document.getElementById('wallet-modal');
  if (!modal) return;
  modal.querySelectorAll('[data-close-wallet-modal]').forEach((el) => {
    el.addEventListener('click', closeWalletModal);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeWalletModal();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ask wallet for accounts; prefer currently selected account (eth_accounts). */
async function requestWalletAccounts(eth) {
  // eth_requestAccounts: prompts if needed
  try {
    await eth.request({ method: 'eth_requestAccounts' });
  } catch (err) {
    if (err?.code === 4001) throw new Error('Connection cancelled in wallet.');
    throw err;
  }
  // eth_accounts: selected account is [0] in MetaMask
  let accounts = await eth.request({ method: 'eth_accounts' });
  if (accounts?.length) return accounts;

  // Some wallets need explicit permission request to re-pick account
  try {
    await eth.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    });
  } catch (err) {
    if (err?.code === 4001) throw new Error('Connection cancelled in wallet.');
  }
  accounts = await eth.request({ method: 'eth_accounts' });
  if (!accounts?.length) {
    accounts = await eth.request({ method: 'eth_requestAccounts' });
  }
  return accounts || [];
}

/** Scroll to staking without putting # in the URL. */
function goToStake(e) {
  if (e) e.preventDefault();
  const el = document.getElementById('stake');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // strip hash / fake path from URL bar
  try {
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', clean || '/');
  } catch { /* ignore */ }
  // focus connect for keyboard users
  window.setTimeout(() => {
    document.getElementById('stake-connect')?.focus?.();
  }, 400);
}

function initStakeNav() {
  document.querySelectorAll('[data-go="stake"]').forEach((a) => {
    a.addEventListener('click', goToStake);
  });
  // legacy #stake / /stake links
  if (window.location.hash === '#stake' || /\/stake\/?$/.test(window.location.pathname)) {
    window.setTimeout(() => goToStake(), 100);
  }
}

function stakeStoreKey(addr) {
  return `moze-stake-v2:${(addr || '').toLowerCase()}`;
}

function loadStakeState(addr) {
  try {
    const raw = localStorage.getItem(stakeStoreKey(addr));
    if (!raw) return { positions: {}, claimed: 0, banked: 0 };
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      const now = Date.now();
      const positions = {};
      data.forEach(id => { positions[String(id)] = now; });
      return { positions, claimed: 0, banked: 0 };
    }
    return {
      positions: data.positions || {},
      claimed: Number(data.claimed) || 0,
      banked: Number(data.banked) || 0,
    };
  } catch {
    return { positions: {}, claimed: 0, banked: 0 };
  }
}

function saveStakeState(addr, state) {
  localStorage.setItem(stakeStoreKey(addr), JSON.stringify(state));
}

/**
 * Map API GET /v1/stake/:address into local { positions, claimed, banked }.
 * Server is source of truth when it has activity; local-only positions are kept.
 */
function applyServerStakeToLocal(addr, server) {
  const local = loadStakeState(addr);
  if (!server || server.error) return local;

  const serverPositions = Array.isArray(server.positions) ? server.positions : [];
  const serverClaimed = Number(server.claimed) || 0;
  const serverPending = Number(server.pending) || 0;
  // Only trust server when it has real activity — empty local API must not wipe localStorage stake
  const serverHas =
    serverPositions.length > 0 || serverClaimed > 0 || serverPending > 0;

  if (!serverHas) return local;

  const positions = {};
  for (const p of serverPositions) {
    const id = String(p.tokenId ?? p.token_id ?? '');
    if (!id || id === 'undefined') continue;
    // lastSettleAt: client accrues only after that (server already banked up to then)
    positions[id] = Number(p.lastSettleAt ?? p.last_settle_at ?? p.stakedAt ?? p.staked_at ?? Date.now());
  }
  // Keep local-only positions (staked without successful API sync)
  for (const [id, since] of Object.entries(local.positions || {})) {
    if (positions[id] == null) positions[id] = since;
  }

  const state = {
    positions,
    claimed: Math.max(Number(local.claimed) || 0, serverClaimed),
    // Prefer server pending (source of truth after claim / raffle spend)
    banked: serverPending,
  };
  saveStakeState(addr, state);
  return state;
}

/** Pull shared stake state from moze-api (multi-browser sync). */
async function hydrateStakeFromApi(addr) {
  if (!addr) return loadStakeState(addr);
  try {
    if (apiOnline === null) await pingApi();
    if (!apiOnline) return loadStakeState(addr);
    const data = await apiFetch(`/v1/stake/${encodeURIComponent(addr)}`);
    return applyServerStakeToLocal(addr, data);
  } catch (err) {
    console.warn('[moze-api] hydrate stake failed', err?.message || err);
    return loadStakeState(addr);
  }
}

function stakedIdSet(state) {
  return new Set(Object.keys(state.positions).map(Number));
}

function settleAccrued(state, now = Date.now()) {
  let gained = 0;
  for (const id of Object.keys(state.positions)) {
    const since = state.positions[id];
    if (!since) continue;
    gained += Math.max(0, (now - since) / MS_PER_DAY) * MOZE_RATE_PER_DAY;
    state.positions[id] = now;
  }
  state.banked = (Number(state.banked) || 0) + gained;
  return state;
}

function pendingMoze(state, now = Date.now()) {
  let live = 0;
  for (const id of Object.keys(state.positions)) {
    const since = state.positions[id];
    if (!since) continue;
    live += Math.max(0, (now - since) / MS_PER_DAY) * MOZE_RATE_PER_DAY;
  }
  return (Number(state.banked) || 0) + live;
}

/** Live pending for connected wallet (dashboard). */
function getLivePending(addr = stakeAccount) {
  if (!addr) return 0;
  const st = loadStakeState(addr);
  return pendingMoze(st);
}

/** Total soft $MOZE spendable on raffle = pending + claimed. */
function getLiveSoftMoze(addr = stakeAccount) {
  if (!addr) return 0;
  const st = loadStakeState(addr);
  return pendingMoze(st) + (Number(st.claimed) || 0);
}

/**
 * Settle local accrual into banked and persist — keeps raffle/enter in sync with UI.
 */
function settleAndSaveLocal(addr = stakeAccount) {
  if (!addr) return loadStakeState(addr);
  const st = loadStakeState(addr);
  settleAccrued(st);
  saveStakeState(addr, st);
  return st;
}

/** Refresh stake dashboard + raffle strip + leaderboard after claim/stake/enter. */
async function syncAllStakeUi({
  hydrate = true,
  leaderboard = true,
  raffle = true,
  forceLb = false,
} = {}) {
  if (!stakeAccount) {
    if (raffle) await refreshRaffle().catch(() => null);
    return;
  }
  if (hydrate) {
    await hydrateStakeFromApi(stakeAccount).catch(() => null);
  }
  settleAndSaveLocal(stakeAccount);
  updateDashboard();
  updateRafflePendingStrip();
  renderStakeGrid();
  if (raffle) await refreshRaffle().catch(() => null);
  if (leaderboard) {
    try {
      syncLeaderboardVisibility();
      await loadHoldersLeaderboard(!!forceLb);
    } catch {
      /* optional */
    }
  }
}

/** Keep raffle "Your $MOZE" (pending + claimed) in sync every tick. */
function updateRafflePendingStrip() {
  const el = document.getElementById('raffle-your-moze');
  if (!el) return;
  if (!stakeAccount) {
    el.textContent = '—';
    return;
  }
  el.textContent = formatMoze(getLiveSoftMoze());
}

function formatMoze(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 100) return n.toFixed(1);
  if (n >= 10) return n.toFixed(2);
  if (n >= 1) return n.toFixed(3);
  // small amounts e.g. 0.1 ticket cost — drop trailing zeros
  return String(Number(n.toFixed(4)));
}

/** Build/update slot-machine digit reels inside an element. */
function setSlotNumber(el, nextText, { spin = true } = {}) {
  if (!el) return;
  const text = String(nextText);
  const prev = el.getAttribute('data-slot') || '';
  if (prev === text && el.querySelector('.slot-odometer')) return;

  let odo = el.querySelector('.slot-odometer');
  if (!odo || prev.length !== text.length || /[^\d.]/.test(prev) !== /[^\d.]/.test(text)) {
    el.textContent = '';
    odo = document.createElement('span');
    odo.className = 'slot-odometer';
    el.appendChild(odo);
    for (const ch of text) {
      if (ch >= '0' && ch <= '9') {
        const dig = document.createElement('span');
        dig.className = 'slot-digit';
        const reel = document.createElement('span');
        reel.className = 'slot-reel';
        // 0-9 repeated so multi-turn slot scroll has room
        for (let rep = 0; rep < 4; rep += 1) {
          for (let d = 0; d <= 9; d += 1) {
            const s = document.createElement('span');
            s.textContent = String(d);
            reel.appendChild(s);
          }
        }
        dig.appendChild(reel);
        odo.appendChild(dig);
      } else {
        const dig = document.createElement('span');
        dig.className = 'slot-digit slot-sym';
        dig.innerHTML = `<span class="slot-static">${ch}</span>`;
        odo.appendChild(dig);
      }
    }
  } else {
    // update symbol cells if needed (same length)
    const kids = [...odo.children];
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const cell = kids[i];
      if (!cell) continue;
      if (ch < '0' || ch > '9') {
        if (!cell.classList.contains('slot-sym')) {
          // structure mismatch — rebuild
          el.removeAttribute('data-slot');
          el.innerHTML = '';
          setSlotNumber(el, text, { spin });
          return;
        }
        const st = cell.querySelector('.slot-static');
        if (st) st.textContent = ch;
      } else if (cell.classList.contains('slot-sym')) {
        el.removeAttribute('data-slot');
        el.innerHTML = '';
        setSlotNumber(el, text, { spin });
        return;
      }
    }
  }

  const reels = odo.querySelectorAll('.slot-digit:not(.slot-sym) .slot-reel');
  let ri = 0;
  let di = 0;
  if (spin) odo.classList.add('is-spinning');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch < '0' || ch > '9') continue;
    const reel = reels[ri++];
    if (!reel) continue;
    const digit = Number(ch);
    const prevCh = prev[i];
    const prevDigit = prevCh >= '0' && prevCh <= '9' ? Number(prevCh) : 0;
    // Odometer/slot: roll reel to digit; +1 full turn when digit jumps
    let extra = 0;
    if (spin && prev && prev !== text && digit !== prevDigit) {
      extra = 1;
    }
    di += 1;
    const steps = extra * 10 + digit;
    if (extra > 0) {
      const current = prevDigit;
      reel.style.transition = 'none';
      reel.style.transform = `translateY(-${current * 1.25}em)`;
      void reel.offsetHeight;
      reel.style.transition = '';
    }
    requestAnimationFrame(() => {
      reel.style.transform = `translateY(-${steps * 1.25}em)`;
    });
  }
  el.setAttribute('data-slot', text);
  if (spin) {
    window.setTimeout(() => {
      odo.classList.remove('is-spinning');
      // snap reels back to 0–9 band without visual jump (mod 10)
      let r2 = 0;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch < '0' || ch > '9') continue;
        const reel = reels[r2++];
        if (!reel) continue;
        const digit = Number(ch);
        reel.style.transition = 'none';
        reel.style.transform = `translateY(-${digit * 1.25}em)`;
        void reel.offsetHeight;
        reel.style.transition = '';
      }
    }, 600);
  }
}

function setSlotInt(el, n, opts) {
  setSlotNumber(el, String(Math.max(0, Math.floor(Number(n) || 0))), opts);
}

function setSlotMoze(el, n, opts) {
  setSlotNumber(el, formatMoze(n), opts);
}

function setStakeStatus(msg, isError = false) {
  const el = document.getElementById('stake-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#a00' : '';
}

/* ── Scan atmosphere: random Moze cards pixel → clear while ownership scan runs ── */
let scanAtmosphere = null;

function collectionUrl(id) {
  return `assets/Collection/${id}.webp?v=neon1`;
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('img fail'));
    img.src = src;
  });
}

function pickRandomTokenIds(count = 3) {
  const ids = new Set();
  let guard = 0;
  while (ids.size < count && guard < 40) {
    ids.add(1 + Math.floor(Math.random() * 1000));
    guard += 1;
  }
  return [...ids];
}

function drawPixelReveal(canvas, img, t) {
  // t: 0 = chunky pixels, 1 = full clear
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx || !img) return;
  const levels = [6, 10, 16, 28, 48, 96, size];
  const idx = Math.min(levels.length - 1, Math.floor(t * (levels.length - 1)));
  const px = levels[idx];
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  // draw tiny then upscale
  const off = document.createElement('canvas');
  off.width = px;
  off.height = px;
  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(img, 0, 0, px, px);
  // light noise early on
  if (t < 0.75) {
    const data = octx.getImageData(0, 0, px, px);
    const amount = (1 - t) * 55;
    for (let i = 0; i < data.data.length; i += 4) {
      const n = (Math.random() - 0.5) * amount;
      data.data[i] = Math.max(0, Math.min(255, data.data[i] + n));
      data.data[i + 1] = Math.max(0, Math.min(255, data.data[i + 1] + n));
      data.data[i + 2] = Math.max(0, Math.min(255, data.data[i + 2] + n));
    }
    octx.putImageData(data, 0, 0);
  }
  ctx.drawImage(off, 0, 0, size, size);
}

/** Non-blocking: random Moze art (no token # labels) while ownership loads. */
function startScanAtmosphere(progressHint = '') {
  stopScanAtmosphere();
  const root = document.getElementById('stake-scan-preview');
  const cardsEl = document.getElementById('stake-scan-cards');
  const sub = document.getElementById('stake-scan-sub');
  if (!root || !cardsEl) return;
  root.hidden = false;
  if (sub) sub.textContent = progressHint || 'Finding NFTs on Robinhood';
  cardsEl.innerHTML = '';

  const ids = pickRandomTokenIds(3);
  const cards = [];
  for (const id of ids) {
    const wrap = document.createElement('div');
    wrap.className = 'stake-scan-card';
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    wrap.appendChild(canvas);
    // no #token label — pure random art
    cardsEl.appendChild(wrap);
    const card = { canvas, img: null, t: Math.random() * 0.2 };
    cards.push(card);
    // load in background — do not block wallet scan
    loadImageEl(collectionUrl(id))
      .then((img) => {
        card.img = img;
        drawPixelReveal(canvas, img, card.t);
      })
      .catch(() => { /* ignore missing art */ });
  }

  const started = performance.now();
  const tick = (now) => {
    if (!scanAtmosphere) return;
    const elapsed = (now - started) / 1000;
    for (const c of cards) {
      if (!c.img) continue;
      let t = Math.min(1, elapsed / 0.9);
      if (elapsed > 0.9) {
        t = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(elapsed * 1.8 + c.t * 8));
      }
      drawPixelReveal(c.canvas, c.img, t);
    }
    scanAtmosphere.raf = requestAnimationFrame(tick);
  };
  scanAtmosphere = { raf: requestAnimationFrame(tick), root };
}

function setScanAtmosphereProgress(msg) {
  const sub = document.getElementById('stake-scan-sub');
  if (sub && msg) sub.textContent = msg;
}

function stopScanAtmosphere() {
  if (scanAtmosphere?.raf) cancelAnimationFrame(scanAtmosphere.raf);
  scanAtmosphere = null;
  const root = document.getElementById('stake-scan-preview');
  const cardsEl = document.getElementById('stake-scan-cards');
  if (root) root.hidden = true;
  if (cardsEl) cardsEl.innerHTML = '';
}

function shortAddr(a) {
  if (!a || a.length < 10) return a || '';
  return a.slice(0, 6) + '…' + a.slice(-4);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function initCopyChips() {
  document.querySelectorAll('.addr-chip[data-addr]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const addr = btn.getAttribute('data-addr') || '';
      if (!addr) return;
      try {
        await copyText(addr);
        btn.classList.add('copied');
        const action = btn.querySelector('.addr-chip-action');
        const prev = action?.textContent;
        if (action) action.textContent = 'Copied';
        window.setTimeout(() => {
          btn.classList.remove('copied');
          if (action && prev) action.textContent = prev;
        }, 1400);
      } catch (err) {
        console.error(err);
        alert('Copy failed — select manually: ' + addr);
      }
    });
  });
}

function showStakeChrome(show) {
  const gated = document.getElementById('stake-gated');
  if (gated) gated.hidden = !show;
  // keep children visible when parent is shown
  if (show) {
    ['stake-dashboard', 'stake-toolbar', 'stake-actions', 'stake-details', 'stake-owned'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    });
  }
}

function updateDashboard() {
  if (!stakeAccount) return;
  const state = loadStakeState(stakeAccount);
  const stakedIds = [...stakedIdSet(state)].filter(id => stakeOwnedIds.includes(id));
  const n = stakedIds.length;
  const pending = pendingMoze(state);
  const rate = n * MOZE_RATE_PER_DAY;
  const elS = document.getElementById('stat-staked');
  const elR = document.getElementById('stat-rate');
  const elP = document.getElementById('stat-pending');
  const elC = document.getElementById('stat-claimed');
  // Pending ticks every 1s — soft spin; big jumps (stake/claim) still roll
  setSlotInt(elS, n, { spin: true });
  setSlotMoze(elR, rate, { spin: true });
  setSlotMoze(elP, pending, { spin: true });
  setSlotMoze(elC, state.claimed, { spin: true });
  const claimBtn = document.getElementById('claim-moze');
  if (claimBtn) claimBtn.disabled = pending < 0.0001;
}

let stakeSyncTick = 0;
function startStakeTicker() {
  if (stakeTickTimer) clearInterval(stakeTickTimer);
  stakeSyncTick = 0;
  stakeTickTimer = setInterval(() => {
    if (!stakeAccount) return;
    updateDashboard();
    updateRafflePendingStrip();
    stakeSyncTick += 1;
    // Every ~20s: re-hydrate from API + refresh raffle/leaderboard (claim/stake sync)
    if (stakeSyncTick % 20 === 0) {
      syncAllStakeUi({ hydrate: true, leaderboard: true, raffle: true, forceLb: false }).catch(
        () => null
      );
    }
  }, 1000);
}

async function ensureRobinhoodChain() {
  const eth = getEthereum();
  if (!eth) throw new Error('No wallet detected. Install MetaMask, Rabby, or another EVM wallet.');
  const current = await eth.request({ method: 'eth_chainId' });
  if (current === RH_CHAIN.chainId || current === '0x1237') return eth;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: RH_CHAIN.chainId }] });
  } catch (err) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code === 4902) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [RH_CHAIN] });
    } else if (code === 4001) {
      throw new Error('Network switch cancelled. Please select Robinhood Chain.');
    } else {
      throw err;
    }
  }
  // re-check
  const after = await eth.request({ method: 'eth_chainId' });
  if (after !== RH_CHAIN.chainId && after !== '0x1237') {
    throw new Error('Still not on Robinhood Chain. Add the network manually (chainId 4663).');
  }
  return eth;
}

/** Read-only provider that always hits Robinhood public RPC (reliable for ownerOf). */
function getRobinhoodReadProvider() {
  try {
    const network = ethers.Network.from(4663);
    return new ethers.JsonRpcProvider(RH_RPC, network, { staticNetwork: network });
  } catch {
    return new ethers.JsonRpcProvider(RH_RPC, 4663);
  }
}

async function withRetry(fn, tries = 3, delayMs = 400) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

/** Fetch token list from API (generous timeout — server may scan once). */
async function fetchOwnedViaApiBase(base, owner, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${String(base).replace(/\/$/, '')}/v1/wallet/${encodeURIComponent(owner)}/tokens`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || res.statusText || 'API error');
    return (data?.tokens || []).map(Number).filter((n) => Number.isFinite(n));
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('API timeout — try again');
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function fetchOwnedViaApi(owner) {
  if (apiOnline === null) await pingApi();
  const base = API_BASE || 'https://api.mozestreet.art';
  return fetchOwnedViaApiBase(base, owner, 45000);
}

/**
 * Resolve owned token IDs via RPC.
 * Prefer wallet provider (same as MetaMask network), fall back to public Robinhood RPC.
 */
async function scanOwnedInBrowser(ownerLc, nHint, walletProvider = null) {
  const providers = [];
  if (walletProvider) providers.push(walletProvider);
  providers.push(getRobinhoodReadProvider());

  let lastErr = null;
  for (const prov of providers) {
    try {
      const contract = new ethers.Contract(MOZE_CA, ERC721_ABI, prov);
      let n = nHint;
      if (n == null || !Number.isFinite(n)) {
        n = Number(await withRetry(() => contract.balanceOf(ownerLc), 2, 200));
      }
      if (!n) return [];

      // Enumerable (fast)
      try {
        const ids = await Promise.all(
          Array.from({ length: n }, (_, i) =>
            contract.tokenOfOwnerByIndex(ownerLc, i).then((x) => Number(x))
          )
        );
        if (ids.length === n && ids.every(Number.isFinite)) return ids;
      } catch { /* not enumerable */ }

      let supply = 1000;
      try {
        const ts = Number(await contract.totalSupply());
        if (ts > 0) supply = Math.min(1000, Math.max(ts + 5, ts));
      } catch { /* 1000 */ }

      const found = [];
      const batch = 80;
      const maxId = Math.max(supply, 1000);
      for (let start = 1; start <= maxId && found.length < n; start += batch) {
        const chunk = [];
        for (let id = start; id < start + batch && id <= maxId; id += 1) {
          chunk.push(
            contract
              .ownerOf(id)
              .then((o) => (String(o).toLowerCase() === ownerLc ? id : null))
              .catch(() => null)
          );
        }
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(chunk);
        for (const id of results) {
          if (id != null) found.push(id);
        }
        if (start === 1 || start % 160 === 1) {
          setScanAtmosphereProgress(`Matching ownership · ${found.length}/${n}`);
        }
      }
      if (found.length) return found;
      // balance > 0 but none found — try next provider
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchOwnedTokenIds(walletProvider, owner) {
  const ownerLc = String(owner).toLowerCase();
  const errors = [];
  startScanAtmosphere('Loading your Moze…');
  setStakeStatus('Hang tight — loading your Moze…');

  const cached = ownedTokensClientCache.get(ownerLc);
  if (cached && Date.now() - cached.at < 120_000) {
    setScanAtmosphereProgress('Loaded from cache');
    stopScanAtmosphere();
    return cached.tokens;
  }

  const remember = (tokens) => {
    const list = [...new Set((tokens || []).map(Number).filter(Number.isFinite))].sort(
      (a, b) => a - b
    );
    ownedTokensClientCache.set(ownerLc, { at: Date.now(), tokens: list });
    return list;
  };

  try {
    // 1) balanceOf via wallet provider first (same network as MetaMask), then public RPC
    let n = 0;
    const balProviders = [];
    if (walletProvider) balProviders.push(walletProvider);
    balProviders.push(getRobinhoodReadProvider());
    for (const prov of balProviders) {
      try {
        const contract = new ethers.Contract(MOZE_CA, ERC721_ABI, prov);
        n = Number(await withRetry(() => contract.balanceOf(ownerLc), 2, 250));
        if (Number.isFinite(n)) break;
      } catch (err) {
        errors.push(`balance: ${err?.shortMessage || err?.message || err}`);
      }
    }
    if (!n) {
      setScanAtmosphereProgress('No Moze in this wallet');
      return remember([]);
    }
    setStakeStatus(`Hang tight — loading your Moze… (${n} on-chain)`);

    // 2) Fast path: token IDs already known from soft-stake positions on API (instant)
    try {
      if (apiOnline === null) await pingApi();
      if (apiOnline) {
        const stake = await apiFetch(`/v1/stake/${encodeURIComponent(ownerLc)}`);
        const posIds = (stake?.positions || [])
          .map((p) => Number(p.tokenId ?? p.token_id))
          .filter((x) => Number.isFinite(x));
        if (posIds.length > 0) {
          // If staked count matches balance, we're done (common case: 1 NFT staked)
          if (posIds.length === n) {
            setScanAtmosphereProgress('Loaded from stake state');
            return remember(posIds);
          }
          // Otherwise use as partial — still better than nothing if scan fails
          if (posIds.length >= n) return remember(posIds.slice(0, n));
        }
      }
    } catch (err) {
      errors.push(`stake-api: ${err?.message || err}`);
    }

    // 3) Full on-chain scan (wallet provider + public RPC) — do NOT call hanging /v1/wallet/tokens
    setScanAtmosphereProgress('Scanning on-chain…');
    try {
      const ids = await scanOwnedInBrowser(ownerLc, n, walletProvider);
      if (ids.length) return remember(ids);
    } catch (err) {
      errors.push(`RPC scan: ${err?.shortMessage || err?.message || err}`);
    }

    console.error('fetchOwnedTokenIds failed', errors);
    throw new Error(
      `Found ${n} Moze on-chain but could not list token IDs. Try Disconnect → Connect again.`
    );
  } finally {
    stopScanAtmosphere();
  }
}

/* Coverflow — Originkit-style (card ~410×412, tilt 10, gap 4, opacity 80) */
const CF = {
  cardW: 410,
  cardH: 412,
  tilt: 10,
  sideTilt: 8,
  gap: 4,
  opacity: 80, // inactive visibility %
  scaleStep: 0.16,
  maxVisible: 2,
  depth: 240,
};
let stakeCfActive = 0;
let stakeCfOrdered = [];
let stakeCfLock = false;

function cfLayoutCard(el, rel) {
  const ax = Math.abs(rel);
  const visible = ax <= CF.maxVisible;
  const sc = Math.max(0.4, 1 - ax * CF.scaleStep);
  const tx = rel * (CF.gap * 30);
  const tz = -ax * CF.depth;
  const ry = -rel * CF.tilt;
  const rz = rel * CF.sideTilt;
  const dim = 1 - Math.max(0, Math.min(100, CF.opacity)) / 100;
  el.style.opacity = visible ? '1' : '0';
  el.style.pointerEvents = visible ? 'auto' : 'none';
  el.style.transform =
    `translate(-50%, -50%) translateX(${tx}px) translateZ(${tz}px) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${sc})`;
  const dimEl = el.querySelector('.cf-dim');
  if (dimEl) dimEl.style.opacity = rel === 0 ? '0' : String(dim);
  el.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function updateCoverflowTransforms() {
  const stage = document.getElementById('stake-cf-stage');
  if (!stage) return;
  const n = stakeCfOrdered.length;
  const cards = stage.querySelectorAll('.cf-card');
  cards.forEach((el) => {
    const i = +el.dataset.index;
    let rel = i - stakeCfActive;
    if (n > 1) {
      if (rel > n / 2) rel -= n;
      if (rel < -n / 2) rel += n;
    }
    cfLayoutCard(el, rel);
  });
}

function stakeCfStep(dir) {
  if (stakeCfLock || stakeCfOrdered.length < 2) return;
  stakeCfLock = true;
  const n = stakeCfOrdered.length;
  stakeCfActive = (((stakeCfActive + dir) % n) + n) % n;
  updateCoverflowTransforms();
  window.setTimeout(() => { stakeCfLock = false; }, 620);
}

function getActiveStakeTokenId() {
  if (!stakeCfOrdered.length) return null;
  return stakeCfOrdered[stakeCfActive] ?? null;
}

function setStakeImgStatus(msg, isError = false) {
  const el = document.getElementById('stake-img-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#a00' : '';
}

function activeStakeImageUrl(id) {
  return `assets/Collection/${id}.webp?v=neon1`;
}

async function fetchImageBlob(url) {
  const res = await fetch(url, { cache: 'reload' });
  if (!res.ok) throw new Error('Failed to load image');
  const blob = await res.blob();
  // Prefer PNG for clipboard compatibility
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

async function copyActiveStakeImage() {
  const id = getActiveStakeTokenId();
  if (id == null) {
    setStakeImgStatus('No active NFT.', true);
    return;
  }
  try {
    setStakeImgStatus('Copying…');
    const blob = await fetchImageBlob(activeStakeImageUrl(id));
    if (!navigator.clipboard || !window.ClipboardItem) {
      // fallback: download
      setStakeImgStatus('Image clipboard not supported in this browser. Use Download.', true);
      return;
    }
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type || 'image/png']: blob }),
    ]);
    setStakeImgStatus(`Copied Moze #${id} image.`);
  } catch (err) {
    console.error(err);
    setStakeImgStatus(err?.message || 'Copy image failed. Try Download.', true);
  }
}

async function downloadActiveStakeImage() {
  const id = getActiveStakeTokenId();
  if (id == null) {
    setStakeImgStatus('No active NFT.', true);
    return;
  }
  try {
    setStakeImgStatus('Downloading…');
    const blob = await fetchImageBlob(activeStakeImageUrl(id));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const nick = collection.find(c => Number(c.id) === id)?.nickname || `Moze-${id}`;
    a.href = url;
    a.download = `${String(nick).replace(/[^\w\-]+/g, '_')}_${id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStakeImgStatus(`Downloaded #${id}.`);
  } catch (err) {
    console.error(err);
    setStakeImgStatus(err?.message || 'Download failed.', true);
  }
}

async function shareActiveStakeOnX() {
  const id = getActiveStakeTokenId();
  if (id == null) {
    setStakeImgStatus('No active NFT.', true);
    return;
  }
  const item = collection.find(c => Number(c.id) === id);
  const nick = item?.nickname || `Moze #${id}`;
  const site = 'https://www.mozestreet.art';
  const opensea = `https://opensea.io/item/robinhood/${MOZE_CA}/${id}`;
  const text =
    `Staking ${nick} (#${id}) on Moze 🎨\n` +
    `Soft stake $MOZE · free mint on Robinhood\n` +
    `${site}\n` +
    `${opensea}\n` +
    `@mozenft_`;

  // Always open X compose (intent) — do NOT use OS Web Share sheet (AirDrop/Mail/etc.)
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(intent, '_blank', 'noopener,noreferrer');

  // Best-effort: copy image so user can paste into the X post (X intent can't attach files)
  let copied = false;
  try {
    const blob = await fetchImageBlob(activeStakeImageUrl(id));
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || 'image/png']: blob }),
      ]);
      copied = true;
    }
  } catch { /* ignore */ }

  setStakeImgStatus(
    copied
      ? 'X opened — image copied, paste into the post if you want.'
      : 'X opened — attach the image manually if needed.'
  );
}

function renderStakeGrid() {
  const wrap = document.getElementById('stake-owned');
  const stage = document.getElementById('stake-cf-stage');
  if (!wrap || !stage) return;
  if (!stakeOwnedIds.length) {
    showStakeChrome(false);
    return;
  }
  const state = loadStakeState(stakeAccount);
  const staked = stakedIdSet(state);
  showStakeChrome(true);

  stakeCfOrdered = [...stakeOwnedIds].sort((a, b) => {
    const as = staked.has(a) ? 0 : 1;
    const bs = staked.has(b) ? 0 : 1;
    return as - bs || a - b;
  });
  if (stakeCfActive >= stakeCfOrdered.length) stakeCfActive = 0;

  stage.innerHTML = stakeCfOrdered.map((id, i) => {
    const isStaked = staked.has(id);
    const selected = stakeSelected.has(id);
    return (
      '<button type="button" class="cf-card' +
      (selected ? ' selected' : '') +
      (isStaked ? ' staked' : '') +
      '" data-id="' + id + '" data-index="' + i + '" title="Moze #' + id + '">' +
      '<img src="assets/Collection/' + id + '.webp" alt="Moze #' + id + '" draggable="false">' +
      '<div class="cf-dim"></div>' +
      '<span class="stake-meta"><span>#' + id + '</span>' +
      '<span class="stake-badge">' + (isStaked ? 'STAKED' : 'READY') + '</span></span></button>'
    );
  }).join('');

  stage.querySelectorAll('.cf-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.index;
      const id = +btn.dataset.id;
      if (i !== stakeCfActive) {
        if (stakeCfLock) return;
        stakeCfLock = true;
        stakeCfActive = i;
        updateCoverflowTransforms();
        window.setTimeout(() => { stakeCfLock = false; }, 620);
        return;
      }
      // Active card click = toggle select
      if (stakeSelected.has(id)) stakeSelected.delete(id);
      else stakeSelected.add(id);
      renderStakeGrid();
    });
  });

  updateCoverflowTransforms();
  updateStakeButtons();
  updateDashboard();
  // Do NOT overwrite collection STAKED with this-browser local count
  // (that caused the flash: 3 → 22 after Refresh).
}

function updateStakeButtons() {
  const state = loadStakeState(stakeAccount);
  const staked = stakedIdSet(state);
  const sel = [...stakeSelected];
  const stakeBtn = document.getElementById('stake-selected');
  const unstakeBtn = document.getElementById('unstake-selected');
  if (stakeBtn) stakeBtn.disabled = !sel.some(id => !staked.has(id));
  if (unstakeBtn) unstakeBtn.disabled = !sel.some(id => staked.has(id));
}

/**
 * @param {string} [forcedAddress] — from accountsChanged (already selected)
 */
async function connectStakeWallet(forcedAddress) {
  if (connectInFlight) return;
  connectInFlight = true;
  try {
    if (typeof ethers === 'undefined') {
      setStakeStatus('Wallet library not loaded. Refresh the page.', true);
      return;
    }
    const eth = getEthereum();
    if (!eth) {
      setStakeStatus('No wallet found. Use MetaMask, Rabby, or another EVM wallet.', true);
      return;
    }
    setStakeStatus(
      forcedAddress
        ? `Switching to ${shortAddr(forcedAddress)}… select Robinhood Chain.`
        : 'Connecting… select Robinhood Chain.'
    );
    await ensureRobinhoodChain();
    const provider = new ethers.BrowserProvider(eth);

    let account = forcedAddress ? String(forcedAddress) : null;
    if (!account) {
      const accounts = await requestWalletAccounts(eth);
      if (!accounts?.length) throw new Error('No account connected.');
      account = accounts[0];
    }
    // Re-read selected account (MetaMask selected account is eth_accounts[0])
    try {
      const selected = await eth.request({ method: 'eth_accounts' });
      if (selected?.[0]) account = selected[0];
    } catch { /* keep account */ }

    stakeAccount = account;
    stakeSelected = new Set();
    const label = document.getElementById('stake-wallet');
    const walletText = document.getElementById('stake-wallet-text');
    if (label) {
      label.hidden = false;
      label.setAttribute('data-addr', stakeAccount);
      if (walletText) walletText.textContent = shortAddr(stakeAccount);
    }
    setConnectButtonState(true);
    setStakeStatus(`Connected ${shortAddr(stakeAccount)}. Hang tight — loading your Moze…`);
    stakeOwnedIds = await fetchOwnedTokenIds(provider, stakeAccount);
    if (!stakeOwnedIds.length) {
      stopScanAtmosphere();
      setStakeStatus('This wallet holds no Moze on Robinhood. Mint on OpenSea, or check the network.');
      showStakeChrome(false);
      syncLeaderboardVisibility();
      refreshRaffle().catch(() => {});
      return;
    }
    // Preload first cover image so UI feels solid
    try {
      await fetchImageBlob(activeStakeImageUrl(stakeOwnedIds[0]));
    } catch { /* ignore */ }

    // Multi-browser: load claimed/pending/positions from API, then merge local
    setStakeStatus(`Connected ${shortAddr(stakeAccount)}. Syncing stake…`);
    let state = await hydrateStakeFromApi(stakeAccount);
    settleAccrued(state);
    for (const id of Object.keys(state.positions)) {
      if (!stakeOwnedIds.includes(Number(id))) delete state.positions[id];
    }
    saveStakeState(stakeAccount, state);
    const nStaked = Object.keys(state.positions).length;
    setStakeStatus(
      stakeOwnedIds.length + ' Moze found · ' + nStaked + ' staked · ' +
      formatMoze(pendingMoze(state)) + ' $MOZE pending · ' +
      formatMoze(state.claimed) + ' claimed. Click a card to select.'
    );
    showStakeChrome(true);
    renderStakeGrid();
    startStakeTicker();
    // leaderboard only if already staking
    syncLeaderboardVisibility();
    refreshRaffle().catch(() => {});
  } catch (err) {
    console.error(err);
    stopScanAtmosphere();
    setStakeStatus(err?.message || 'Failed to connect wallet.', true);
    showStakeChrome(false);
  } finally {
    connectInFlight = false;
  }
}

function stakeIds(ids) {
  if (!stakeAccount || !ids.length) return 0;
  const state = loadStakeState(stakeAccount);
  settleAccrued(state);
  const now = Date.now();
  let n = 0;
  for (const id of ids) {
    if (!stakeOwnedIds.includes(id) || state.positions[String(id)]) continue;
    state.positions[String(id)] = now;
    n += 1;
  }
  saveStakeState(stakeAccount, state);
  return n;
}

function unstakeIds(ids) {
  if (!stakeAccount || !ids.length) return 0;
  const state = loadStakeState(stakeAccount);
  settleAccrued(state);
  let n = 0;
  for (const id of ids) {
    if (state.positions[String(id)]) {
      delete state.positions[String(id)];
      n += 1;
    }
  }
  saveStakeState(stakeAccount, state);
  return n;
}

async function stakeSelectedTokens() {
  const ids = [...stakeSelected];
  const n = stakeIds(ids);
  stakeSelected = new Set();
  setStakeStatus(n ? ('+' + n + ' Moze staked · +' + (n * MOZE_RATE_PER_DAY) + ' $MOZE/day') : 'Select READY Moze first.');
  renderStakeGrid();
  syncLeaderboardVisibility();
  if (n) {
    setStakeStatus('+' + n + ' Moze staked locally · syncing to server…');
    const res = await apiSignedAction('stake', ids);
    if (res?.ok) setStakeStatus('+' + n + ' Moze staked · synced to leaderboard.');
    else if (res?.error) setStakeStatus('+' + n + ' staked (local). Server: ' + res.error);
    else setStakeStatus('+' + n + ' Moze staked · +' + (n * MOZE_RATE_PER_DAY) + ' $MOZE/day');
    leaderboardCache = null;
    await syncAllStakeUi({ hydrate: true, leaderboard: true, raffle: true, forceLb: true });
  }
}

async function unstakeSelectedTokens() {
  const ids = [...stakeSelected];
  const n = unstakeIds(ids);
  stakeSelected = new Set();
  setStakeStatus(n ? (n + ' Moze unstaked. Pending $MOZE stays claimable.') : 'Select STAKED Moze first.');
  renderStakeGrid();
  syncLeaderboardVisibility();
  if (n) {
    const res = await apiSignedAction('unstake', ids);
    if (res?.error) setStakeStatus(n + ' unstaked (local). Server: ' + res.error);
    leaderboardCache = null;
    await syncAllStakeUi({ hydrate: true, leaderboard: true, raffle: true, forceLb: true });
  }
}

async function stakeAllTokens() {
  const ids = [...stakeOwnedIds];
  const n = stakeIds(ids);
  stakeSelected = new Set();
  setStakeStatus(n ? ('Stake all: ' + n + ' Moze · rate ' + (n * MOZE_RATE_PER_DAY) + ' $MOZE/day') : 'Everything is already staked.');
  renderStakeGrid();
  syncLeaderboardVisibility();
  if (n) {
    setStakeStatus('Stake all: ' + n + ' · syncing to server…');
    const res = await apiSignedAction('stake', ids);
    if (res?.ok) setStakeStatus('Stake all: ' + n + ' Moze · synced.');
    else if (res?.error) setStakeStatus('Stake all local. Server: ' + res.error);
    leaderboardCache = null;
    await syncAllStakeUi({ hydrate: true, leaderboard: true, raffle: true, forceLb: true });
  }
}

async function unstakeAllTokens() {
  const state = loadStakeState(stakeAccount);
  const ids = Object.keys(state.positions).map(Number);
  const n = unstakeIds(ids);
  stakeSelected = new Set();
  setStakeStatus(n ? ('Unstake all: ' + n + ' Moze. Claim pending anytime.') : 'Nothing staked yet.');
  renderStakeGrid();
  syncLeaderboardVisibility();
  if (n) {
    const res = await apiSignedAction('unstake', ids);
    if (res?.error) setStakeStatus('Unstake all local. Server: ' + res.error);
    leaderboardCache = null;
    await syncAllStakeUi({ hydrate: true, leaderboard: true, raffle: true, forceLb: true });
  }
}

function selectAllTokens() {
  stakeSelected = new Set(stakeOwnedIds);
  renderStakeGrid();
  setStakeStatus('Selected ' + stakeSelected.size + ' Moze.');
}

async function claimMoze() {
  if (!stakeAccount) return;
  const state = settleAndSaveLocal(stakeAccount);
  const amount = Number(state.banked) || 0;
  if (amount < 0.0001) {
    setStakeStatus('No $MOZE to claim yet. Stake first and wait a bit.');
    updateDashboard();
    updateRafflePendingStrip();
    return;
  }
  state.claimed = (Number(state.claimed) || 0) + amount;
  state.banked = 0;
  saveStakeState(stakeAccount, state);
  setStakeStatus('Claimed ' + formatMoze(amount) + ' $MOZE. Total claimed: ' + formatMoze(state.claimed) + ' $MOZE.');
  updateDashboard();
  updateRafflePendingStrip();
  renderStakeGrid();
  const res = await apiSignedAction('claim', []);
  if (res?.error) setStakeStatus('Claimed locally. Server: ' + res.error);
  else if (res?.ok) setStakeStatus('Claimed ' + formatMoze(amount) + ' $MOZE · synced.');
  await syncAllStakeUi({ hydrate: true, leaderboard: true, raffle: true, forceLb: true });
  if (res?.ok) {
    setStakeStatus('Claimed ' + formatMoze(amount) + ' $MOZE · synced. (Still usable for raffle.)');
  }
}

function setConnectButtonState(connected) {
  const btn = document.getElementById('stake-connect');
  if (!btn) return;
  if (connected) {
    btn.classList.add('is-connected');
    btn.setAttribute('aria-label', 'Disconnect wallet');
    btn.title = 'Click to disconnect';
    btn.innerHTML =
      '<span class="stake-conn-label stake-conn-idle">Connected</span>' +
      '<span class="stake-conn-label stake-conn-hover">Disconnect</span>';
  } else {
    btn.classList.remove('is-connected');
    btn.removeAttribute('title');
    btn.setAttribute('aria-label', 'Connect wallet');
    btn.textContent = 'Connect Wallet';
  }
}

async function disconnectStakeWallet() {
  const eth = getEthereum();
  resetStakeUi('Wallet disconnected.');
  // Best-effort revoke so next Connect follows MetaMask's currently selected account
  try {
    if (eth?.request) {
      await eth.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    }
  } catch {
    // Older wallets may not support revoke — still OK
  }
}

function resetStakeUi(statusMsg) {
  stakeAccount = null;
  stakeOwnedIds = [];
  stakeSelected = new Set();
  if (stakeTickTimer) clearInterval(stakeTickTimer);
  stakeTickTimer = null;
  const label = document.getElementById('stake-wallet');
  const walletText = document.getElementById('stake-wallet-text');
  if (label) {
    label.hidden = true;
    label.setAttribute('data-addr', '');
  }
  if (walletText) walletText.textContent = '';
  setConnectButtonState(false);
  showStakeChrome(false);
  setStakeStatus(statusMsg || 'Wallet changed — connect again.');
  leaderboardCache = null;
  syncLeaderboardVisibility();
}

/** MetaMask account switch → auto load new account (or disconnect if none). */
async function onAccountsChanged(accounts) {
  const next = accounts?.[0] ? String(accounts[0]) : '';
  const prev = stakeAccount ? String(stakeAccount) : '';
  if (!next) {
    resetStakeUi('Wallet disconnected in MetaMask.');
    return;
  }
  if (next.toLowerCase() === prev.toLowerCase()) return;
  // Auto-reconnect as the newly selected account
  await connectStakeWallet(next);
}

async function onStakeConnectClick() {
  if (stakeAccount) {
    await disconnectStakeWallet();
    return;
  }
  // Show wallet picker (MetaMask / Rabby / etc.)
  openWalletModal();
}

function bindWalletListeners() {
  if (walletListenersBound) return;
  const eth = getEthereum() || window.ethereum;
  if (!eth?.on) return;
  walletListenersBound = true;
  eth.on('accountsChanged', (accounts) => {
    onAccountsChanged(accounts).catch((err) => {
      console.error(err);
      setStakeStatus(err?.message || 'Failed to switch account.', true);
    });
  });
  eth.on('chainChanged', () => {
    // Reload stake state for new chain without full page refresh
    if (stakeAccount) {
      connectStakeWallet(stakeAccount).catch(() => {
        resetStakeUi('Network changed. Reconnect wallet.');
      });
    }
  });
}

function initStake() {
  showStakeChrome(false);
  initCopyChips();
  initStakeNav();
  initWalletModal();
  pingApi().catch(() => {});
  bindWalletListeners();
  document.getElementById('stake-connect')?.addEventListener('click', onStakeConnectClick);
  document.getElementById('stake-selected')?.addEventListener('click', stakeSelectedTokens);
  document.getElementById('unstake-selected')?.addEventListener('click', unstakeSelectedTokens);
  document.getElementById('stake-all')?.addEventListener('click', stakeAllTokens);
  document.getElementById('unstake-all')?.addEventListener('click', unstakeAllTokens);
  document.getElementById('stake-select-all')?.addEventListener('click', selectAllTokens);
  document.getElementById('claim-moze')?.addEventListener('click', claimMoze);
  document.getElementById('stake-cf-prev')?.addEventListener('click', () => stakeCfStep(-1));
  document.getElementById('stake-cf-next')?.addEventListener('click', () => stakeCfStep(1));
  document.getElementById('stake-img-copy')?.addEventListener('click', copyActiveStakeImage);
  document.getElementById('stake-img-download')?.addEventListener('click', downloadActiveStakeImage);
  document.getElementById('stake-img-share-x')?.addEventListener('click', shareActiveStakeOnX);

  // Keyboard when hovering stake section
  const stakeBox = document.getElementById('stake');
  stakeBox?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); stakeCfStep(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stakeCfStep(1); }
  });
  // Touch swipe on stage
  const stage = document.getElementById('stake-cf-stage');
  let touchX = null;
  stage?.addEventListener('touchstart', (e) => {
    touchX = e.changedTouches[0]?.clientX ?? null;
  }, { passive: true });
  stage?.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
    if (Math.abs(dx) > 40) stakeCfStep(dx < 0 ? 1 : -1);
    touchX = null;
  }, { passive: true });

  initRaffle();
}

/* ── Soft $MOZE Raffle (multi-prize picker) ── */
let raffleState = null;
let raffleList = []; // light list from API
let raffleQty = 1;
let raffleCountdownTimer = null;
/** Selected raffle id (persist so refresh keeps picker). */
const RAFFLE_SEL_KEY = 'moze-raffle-selected-id';
let raffleSelectedId = null;

/** Frontend prize meta by slug (images / OpenSea links). */
const RAFFLE_PRIZE_META = {
  'moze-raffle-1': {
    captionHtml: 'Win <strong>Moze #30</strong> — from the founder’s bag',
    opensea:
      'https://opensea.io/item/robinhood/0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc/30',
    openseaLabel: 'View #30 on OpenSea ↗',
  },
  'moze-raffle-3': {
    captionHtml: 'Win <strong>Gremlin #1902</strong> — Gremlin Cartel collab',
    opensea:
      'https://opensea.io/item/robinhood/0x12449b9a29865621be166aaff04dc14a640b4119/1902',
    openseaLabel: 'View #1902 on OpenSea ↗',
  },
  'moze-raffle-4': {
    captionHtml: 'Win <strong>Robinhood Punks #9115</strong> — collab prize',
    opensea:
      'https://opensea.io/item/robinhood/0xf08c65564eb07d880021105489552080b08e4319/9115',
    openseaLabel: 'View #9115 on OpenSea ↗',
  },
};

function loadRaffleSelectedId() {
  try {
    const n = Number(localStorage.getItem(RAFFLE_SEL_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveRaffleSelectedId(id) {
  raffleSelectedId = id;
  try {
    if (id != null) localStorage.setItem(RAFFLE_SEL_KEY, String(id));
  } catch { /* ignore */ }
}

function applyPrizeMeta(slug) {
  const meta = RAFFLE_PRIZE_META[slug] || null;
  const cap = document.getElementById('raffle-prize-caption');
  const link = document.getElementById('raffle-opensea');
  if (cap && meta) cap.innerHTML = meta.captionHtml;
  else if (cap && raffleState?.prizeLabel) {
    cap.innerHTML = `Win <strong>${raffleState.prizeLabel}</strong>`;
  }
  if (link && meta) {
    link.href = meta.opensea;
    link.textContent = meta.openseaLabel;
  }
}

/** Highlight picker card immediately (before API returns). */
function setPickerActiveSlug(slug) {
  document.querySelectorAll('.raffle-prize-card').forEach((btn) => {
    const s = btn.getAttribute('data-raffle-slug');
    const active = s && s === slug;
    btn.classList.toggle('is-active', !!active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    const row = raffleList.find((r) => r.slug === s);
    const sub = btn.querySelector('.raffle-card-sub');
    if (sub) {
      const base =
        s === 'moze-raffle-1' ? 'Founder' :
        (s === 'moze-raffle-3' || s === 'moze-raffle-4') ? 'Collab' : 'Prize';
      if (row) {
        const t = Number(row.totalTickets) || 0;
        sub.textContent = t > 0 ? `${base} · ${t} tix` : base;
      }
    }
  });
  applyPrizeMeta(slug);
}

function syncRafflePickerUi() {
  const slug = raffleState?.slug || '';
  setPickerActiveSlug(slug);
  // Only persist when API raffle matches what user selected (avoid prod snapping back to #1)
  const id = raffleState?.id;
  const wanted = raffleSelectedId || loadRaffleSelectedId();
  if (id != null && (wanted == null || Number(wanted) === Number(id))) {
    saveRaffleSelectedId(id);
  }
}

function slugToRaffleId(slug) {
  const row = raffleList.find((r) => r.slug === slug);
  if (row?.id) return Number(row.id);
  const fallback = { 'moze-raffle-1': 1, 'moze-raffle-3': 4, 'moze-raffle-4': 5 }[slug];
  return fallback || null;
}

function setRaffleStatus(msg, isError = false) {
  const el = document.getElementById('raffle-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#a00' : '';
}

/** Shake Enter button when click is blocked / failed */
function shakeRaffleEnterBtn() {
  const btn = document.getElementById('raffle-enter');
  if (!btn) return;
  btn.classList.remove('is-shake');
  // reflow so re-trigger works on rapid clicks
  void btn.offsetWidth;
  btn.classList.add('is-shake');
  window.clearTimeout(shakeRaffleEnterBtn._t);
  shakeRaffleEnterBtn._t = window.setTimeout(() => {
    btn.classList.remove('is-shake');
  }, 500);
  try {
    if (navigator.vibrate) navigator.vibrate(40);
  } catch { /* ignore */ }
}

function clampRaffleQty(n) {
  // No default wallet cap — only clamp if API sends maxTicketsPerWallet.
  const max = raffleState?.maxTicketsPerWallet;
  const your = Number(raffleState?.yourTickets) || 0;
  let q = Math.max(1, Math.floor(Number(n) || 1));
  if (max != null && Number(max) > 0) {
    const room = Math.max(1, Number(max) - your);
    q = Math.min(room, q);
  }
  // UI safety for input field (not a wallet purchase cap)
  if (q > 10000) q = 10000;
  return q;
}

/** Normalize epoch to ms (handles seconds accidentally stored). */
function toMs(ts) {
  let n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 1e12) n *= 1000;
  return Math.floor(n);
}

/** Last rendered countdown parts — avoid full slot rebuild/spin spam every second */
let raffleCdPrev = { d: null, h: null, m: null, s: null };

/**
 * Raffle countdown digits: always 2-digit padded (stable width).
 * Full slot spin only when value actually changes (days/hours/mins).
 * Seconds tick gently without multi-turn spin (that made the timer look broken).
 */
function setRaffleCdNum(id, value, { spin = false, pad = 2 } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Math.max(0, Math.floor(Number(value) || 0));
  const text = String(n).padStart(pad, '0');
  setSlotNumber(el, text, { spin: !!spin });
}

/** Live day / hour / min / sec countdown to raffle.endsAt */
function tickRaffleCountdown() {
  let endsAt = toMs(raffleState?.endsAt);
  const startsAt = toMs(raffleState?.startsAt);
  const root = document.getElementById('raffle-countdown');
  const endMsg = document.getElementById('raffle-countdown-end');
  if (!root) return;

  // Fallback: if API missing endsAt, use 14d from startsAt or now
  if (!endsAt) {
    const base = startsAt || Date.now();
    endsAt = base + 14 * 24 * 60 * 60 * 1000;
  }

  const now = Date.now();
  // Not started yet — show zeros quietly
  if (startsAt && now < startsAt) {
    if (raffleCdPrev.d !== 0 || raffleCdPrev.h !== 0 || raffleCdPrev.m !== 0 || raffleCdPrev.s !== 0) {
      setRaffleCdNum('raffle-cd-days', 0, { spin: false });
      setRaffleCdNum('raffle-cd-hours', 0, { spin: false });
      setRaffleCdNum('raffle-cd-mins', 0, { spin: false });
      setRaffleCdNum('raffle-cd-secs', 0, { spin: false });
      raffleCdPrev = { d: 0, h: 0, m: 0, s: 0 };
    }
    return;
  }

  const left = endsAt - now;
  if (left <= 0) {
    if (raffleCdPrev.d !== 0 || raffleCdPrev.h !== 0 || raffleCdPrev.m !== 0 || raffleCdPrev.s !== 0) {
      setRaffleCdNum('raffle-cd-days', 0, { spin: false });
      setRaffleCdNum('raffle-cd-hours', 0, { spin: false });
      setRaffleCdNum('raffle-cd-mins', 0, { spin: false });
      setRaffleCdNum('raffle-cd-secs', 0, { spin: false });
      raffleCdPrev = { d: 0, h: 0, m: 0, s: 0 };
    }
    root.classList.add('is-ended');
    if (endMsg) endMsg.hidden = false;
    if (raffleState) raffleState.open = false;
    const pill = document.getElementById('raffle-status-pill');
    if (pill) {
      pill.textContent = 'Closed';
      pill.classList.remove('is-open');
      pill.classList.add('is-closed');
    }
    document.getElementById('raffle-enter')?.setAttribute('disabled', 'disabled');
    return;
  }

  root.classList.remove('is-ended');
  if (endMsg) endMsg.hidden = true;
  const sec = Math.floor(left / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;

  // First paint: no spin. Later: spin only fields that changed (not secs).
  const first = raffleCdPrev.d === null;
  setRaffleCdNum('raffle-cd-days', days, { spin: !first && raffleCdPrev.d !== days });
  setRaffleCdNum('raffle-cd-hours', hours, { spin: !first && raffleCdPrev.h !== hours });
  setRaffleCdNum('raffle-cd-mins', mins, { spin: !first && raffleCdPrev.m !== mins });
  // Seconds: soft digit roll only (no full slot revolution every tick)
  setRaffleCdNum('raffle-cd-secs', secs, { spin: false });
  raffleCdPrev = { d: days, h: hours, m: mins, s: secs };
}

function startRaffleCountdown() {
  if (raffleCountdownTimer) clearInterval(raffleCountdownTimer);
  // Reset so first paint after API load is clean (no fake spin from stale prev)
  raffleCdPrev = { d: null, h: null, m: null, s: null };
  tickRaffleCountdown();
  raffleCountdownTimer = setInterval(tickRaffleCountdown, 1000);
}

function updateRaffleCostLine() {
  const cost = Number(raffleState?.ticketCost) || 0;
  const line = document.getElementById('raffle-cost-line');
  const qtyEl = document.getElementById('raffle-qty');
  if (qtyEl) qtyEl.value = String(raffleQty);
  if (line) {
    if (!raffleState) {
      line.textContent = '—';
      return;
    }
    line.textContent = `${raffleQty} ticket${raffleQty === 1 ? '' : 's'} · ${formatMoze(cost * raffleQty)} $MOZE`;
  }
}

function renderRaffle(data) {
  raffleList = Array.isArray(data?.raffles) ? data.raffles : [];
  raffleState = data?.raffle || null;
  // Persist only when response matches selection (multi-raffle)
  if (raffleState?.id != null) {
    const wanted = raffleSelectedId || loadRaffleSelectedId();
    if (wanted == null || Number(wanted) === Number(raffleState.id)) {
      saveRaffleSelectedId(raffleState.id);
    }
  }

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  if (!raffleState) {
    setText('raffle-title', 'No active raffle');
    setText('raffle-prize', 'Check back soon.');
    setText('raffle-status-pill', 'Closed');
    document.getElementById('raffle-status-pill')?.classList.remove('is-open');
    document.getElementById('raffle-status-pill')?.classList.add('is-closed');
    setText('raffle-cost-pill', '—');
    setRaffleCdNum('raffle-total-tickets', 0, { spin: false });
    setRaffleCdNum('raffle-entrants', 0, { spin: false });
    setRaffleCdNum('raffle-your-tickets', 0, { spin: false });
    setText('raffle-your-moze', '—');
    document.getElementById('raffle-enter')?.setAttribute('disabled', 'disabled');
    updateRaffleCostLine();
    syncRafflePickerUi();
    return;
  }

  setText('raffle-title', raffleState.title || 'Moze Raffle');
  setText('raffle-prize', raffleState.prizeLabel ? `Prize: ${raffleState.prizeLabel}` : 'Prize: TBD');
  // Description copy hidden in UI (kept on API for metadata only)
  const descEl = document.getElementById('raffle-desc');
  if (descEl) {
    descEl.textContent = '';
    descEl.hidden = true;
  }
  const open = !!raffleState.open;
  const pill = document.getElementById('raffle-status-pill');
  if (pill) {
    pill.textContent = open ? 'Open' : (raffleState.status || 'Closed');
    pill.classList.toggle('is-open', open);
    pill.classList.toggle('is-closed', !open);
  }
  setText('raffle-cost-pill', `${formatMoze(raffleState.ticketCost)} $MOZE / ticket`);
  setRaffleCdNum('raffle-total-tickets', raffleState.totalTickets ?? 0, { spin: true });
  setRaffleCdNum('raffle-entrants', raffleState.entrants ?? 0, { spin: true });
  setRaffleCdNum('raffle-your-tickets', raffleState.yourTickets ?? 0, { spin: true });

  // Total soft $MOZE (pending + claimed) — what you spend on tickets
  let moze = raffleState.yourMoze;
  if (stakeAccount) {
    try {
      moze = getLiveSoftMoze(stakeAccount);
    } catch { /* keep api */ }
  }
  setText('raffle-your-moze', moze == null ? '—' : formatMoze(moze));

  const enterBtn = document.getElementById('raffle-enter');
  if (enterBtn) {
    if (open) enterBtn.removeAttribute('disabled');
    else enterBtn.setAttribute('disabled', 'disabled');
  }

  raffleQty = clampRaffleQty(raffleQty);
  updateRaffleCostLine();
  startRaffleCountdown();
  syncRafflePickerUi();

  // Who entered — always visible so buyers can find the list
  const top = Array.isArray(raffleState.top) ? raffleState.top : [];
  const wrap = document.getElementById('raffle-top-wrap');
  const list = document.getElementById('raffle-top');
  const empty = document.getElementById('raffle-top-empty');
  if (wrap) wrap.hidden = false;
  if (list) {
    if (!top.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
    } else {
      if (empty) empty.hidden = true;
      list.innerHTML = top
        .map((r, i) => {
          const you =
            stakeAccount &&
            String(r.addr || '').toLowerCase() === String(stakeAccount).toLowerCase();
          const t = Number(r.tickets) || 0;
          return (
            `<li>` +
            `<span class="raffle-entry-rank">#${i + 1}</span>` +
            `<span class="raffle-entry-addr">${shortAddr(r.addr)}${you ? ' · you' : ''}</span>` +
            `<span class="raffle-entry-tickets">${t} ticket${t === 1 ? '' : 's'}</span>` +
            `</li>`
          );
        })
        .join('');
    }
  }
}

async function refreshRaffle() {
  try {
    if (apiOnline === null) await pingApi();
    if (!apiOnline) {
      setRaffleStatus('API offline — raffle needs moze-api.', true);
      return null;
    }
    const you = stakeAccount ? String(stakeAccount).toLowerCase() : '';
    const params = new URLSearchParams();
    if (you) params.set('you', you);
    const sel = raffleSelectedId || loadRaffleSelectedId();
    if (sel) params.set('id', String(sel));
    const q = params.toString() ? `?${params}` : '';
    const data = await apiFetch(`/v1/raffle${q}`);
    // If selected id missing, fall back to first open (avoid loop)
    if (!data?.raffle && Array.isArray(data?.raffles) && data.raffles.length) {
      const open = data.raffles.find((r) => r.open) || data.raffles[0];
      if (open?.id && open.id !== sel) {
        saveRaffleSelectedId(open.id);
        return refreshRaffle();
      }
    }
    renderRaffle(data);
    if (!data?.raffle) setRaffleStatus('No raffle configured yet.');
    else if (!data.raffle.open) setRaffleStatus('This raffle is closed.');
    else if (!stakeAccount) setRaffleStatus('Connect wallet above to enter with pending $MOZE.');
    else setRaffleStatus('');
    return data;
  } catch (err) {
    console.warn('[raffle]', err?.message || err);
    setRaffleStatus(err?.message || 'Could not load raffle', true);
    return null;
  }
}

async function selectRaffleBySlug(slug) {
  if (!slug) return;
  // Already showing this prize — still re-fetch (no-op visual)
  const id = slugToRaffleId(slug);
  if (id != null) saveRaffleSelectedId(id);
  // Instant UI feedback so click never feels dead
  setPickerActiveSlug(slug);
  setRaffleStatus('Loading raffle…');
  try {
    await refreshRaffle();
    // If API is old/prod and ignored ?id=, force-correct picker from selection
    if (raffleState?.slug && raffleState.slug !== slug && id != null) {
      // Keep picker on click target if API lag / mismatch
      setPickerActiveSlug(slug);
      const meta = RAFFLE_PRIZE_META[slug];
      if (meta?.captionHtml) {
        const cap = document.getElementById('raffle-prize-caption');
        if (cap) cap.innerHTML = meta.captionHtml;
      }
    }
  } catch (err) {
    setPickerActiveSlug(slug);
    setRaffleStatus(err?.message || 'Could not load raffle', true);
  }
}

function setTextSafe(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

async function enterRaffleWithMoze() {
  if (!stakeAccount) {
    setRaffleStatus('Connect wallet in Staking first.', true);
    shakeRaffleEnterBtn();
    return;
  }
  if (!raffleState?.open) {
    setRaffleStatus('Raffle is not open.', true);
    shakeRaffleEnterBtn();
    return;
  }
  const tickets = clampRaffleQty(document.getElementById('raffle-qty')?.value || raffleQty);
  raffleQty = tickets;
  updateRaffleCostLine();
  const cost = Number(raffleState.ticketCost) * tickets;

  // Sync from API — enter spends total soft $MOZE (pending + claimed)
  setRaffleStatus('Checking your $MOZE…');
  await hydrateStakeFromApi(stakeAccount).catch(() => null);
  const st = settleAndSaveLocal(stakeAccount);
  const soft = (Number(st.banked) || 0) + (Number(st.claimed) || 0);
  updateDashboard();
  updateRafflePendingStrip();

  if (soft + 1e-9 < cost) {
    const needMore = Math.max(0, cost - soft);
    setRaffleStatus(
      `Need ${formatMoze(cost)} $MOZE · you have ${formatMoze(soft)}` +
        (needMore > 0 ? ` · need +${formatMoze(needMore)} more (stake to earn).` : ''),
      true
    );
    shakeRaffleEnterBtn();
    return;
  }

  const btn = document.getElementById('raffle-enter');
  if (btn) btn.disabled = true;
  setRaffleStatus('Sign in wallet to spend $MOZE…');

  try {
    if (apiOnline === null) await pingApi();
    if (!apiOnline) throw new Error('API offline');

    const address = String(stakeAccount).toLowerCase();
    const nonceRes = await apiFetch('/v1/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
    const nonce = nonceRes.nonce;
    const timestamp = Date.now();
    const message = [
      'Moze Raffle',
      'Action: raffle_enter',
      `Raffle: ${Number(raffleState.id)}`,
      `Tickets: ${tickets}`,
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Timestamp: ${timestamp}`,
    ].join('\n');

    const eth = getEthereum();
    if (!eth) throw new Error('No wallet');
    const provider = new ethers.BrowserProvider(eth);
    const signer = await provider.getSigner();
    const signature = await signer.signMessage(message);

    const res = await apiFetch('/v1/raffle/enter', {
      method: 'POST',
      body: JSON.stringify({
        address,
        raffleId: raffleState.id,
        tickets,
        nonce,
        timestamp,
        signature,
      }),
    });

    if (res?.ok) {
      try {
        const local = settleAndSaveLocal(address);
        let left = Number(res.spent || cost);
        const fromB = Math.min(Number(local.banked) || 0, left);
        local.banked = Math.max(0, (Number(local.banked) || 0) - fromB);
        left -= fromB;
        if (left > 0) {
          local.claimed = Math.max(0, (Number(local.claimed) || 0) - left);
        }
        saveStakeState(address, local);
      } catch { /* ignore */ }
      await syncAllStakeUi({ hydrate: true, leaderboard: true, raffle: true, forceLb: true });
      setRaffleStatus(
        `Entered +${tickets} ticket${tickets === 1 ? '' : 's'} · spent ${formatMoze(res.spent || cost)} $MOZE`
      );
    } else {
      shakeRaffleEnterBtn();
    }
  } catch (err) {
    console.warn('[raffle enter]', err);
    const have = err?.data?.have;
    const need = err?.data?.need;
    let msg = err?.data?.error || err?.message || 'Enter failed';
    if (have != null && need != null) {
      msg = `Need ${formatMoze(need)} $MOZE · you have ${formatMoze(Number(have))}. Stake to earn more.`;
    }
    setRaffleStatus(msg, true);
    shakeRaffleEnterBtn();
    await syncAllStakeUi({ hydrate: true, leaderboard: false, raffle: true });
  } finally {
    if (btn && raffleState?.open) btn.disabled = false;
  }
}

function initRaffle() {
  raffleSelectedId = loadRaffleSelectedId();

  // Bind each prize card (more reliable than only delegated click)
  document.querySelectorAll('.raffle-prize-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slug = card.getAttribute('data-raffle-slug');
      if (!slug) return;
      // Allow re-click to refresh; only skip if already selected AND loading not needed
      if (slug === raffleState?.slug && card.classList.contains('is-active')) {
        setPickerActiveSlug(slug);
        return;
      }
      selectRaffleBySlug(slug).catch((err) => {
        console.warn('[raffle select]', err);
        setRaffleStatus(err?.message || 'Could not switch raffle', true);
      });
    });
  });

  document.getElementById('raffle-qty-minus')?.addEventListener('click', () => {
    raffleQty = clampRaffleQty(raffleQty - 1);
    updateRaffleCostLine();
  });
  document.getElementById('raffle-qty-plus')?.addEventListener('click', () => {
    raffleQty = clampRaffleQty(raffleQty + 1);
    updateRaffleCostLine();
  });
  document.getElementById('raffle-qty')?.addEventListener('change', (e) => {
    raffleQty = clampRaffleQty(e.target.value);
    updateRaffleCostLine();
  });
  document.getElementById('raffle-enter')?.addEventListener('click', () => {
    enterRaffleWithMoze().catch(() => {});
  });
  refreshRaffle().catch(() => {});
}

/** Keep fixed graffiti stickers above the green footer (never tucked under it). */
function updateGraffitiAboveFooter() {
  const footer = document.querySelector('.site-footer');
  const imgs = document.querySelectorAll('.graffiti-deco-img');
  if (!footer || !imgs.length) return;
  const fr = footer.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const base = 16; // px resting clearance from viewport bottom
  let bottom = base;
  // When footer enters the viewport, sit just above its top edge
  if (fr.top < vh) {
    bottom = Math.max(base, Math.ceil(vh - fr.top) + 10);
  }
  // Cap so stickers don't fly too high on short screens
  bottom = Math.min(bottom, Math.floor(vh * 0.55));
  for (const img of imgs) {
    img.style.bottom = `${bottom}px`;
  }
}

function initGraffitiFooterGuard() {
  if (!document.querySelector('.graffiti-deco')) return;
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateGraffitiAboveFooter();
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  updateGraffitiAboveFooter();
}

initStake();
initGraffitiFooterGuard();
loadData();
