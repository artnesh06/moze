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
const GALLERY_SIZE = 15;
const GALLERY_ROTATE_MS = 3000;
let galleryRotateTimer = null;
let gallerySearchActive = false;

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
  refreshMintStats();
}

function fmtInt(n) {
  return Number(n).toLocaleString('en-US');
}

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

/** Fill mint panel from data/collection-stats.json (+ live OpenSea when browser allows). */
async function refreshMintStats() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val != null && val !== '') el.textContent = val;
  };

  set('mint-staked', String(countLocalStaked()));

  // 1) Same-origin snapshot (always works offline/CORS)
  try {
    const res = await fetch('data/collection-stats.json', { cache: 'no-store' });
    if (res.ok) {
      const s = await res.json();
      if (s.minted != null) set('mint-minted', fmtInt(s.minted));
      if (s.holders != null) set('mint-holders', fmtInt(s.holders));
      if (s.offer) set('mint-offer', s.offer);
      if (s.volume_all) set('mint-volume', s.volume_all);
      if (s.sales != null) set('mint-sales', fmtInt(s.sales));
      if (s.listed != null && s.listed !== '') set('mint-listed', fmtInt(s.listed));
      else set('mint-listed', '—');
    }
  } catch { /* ignore */ }

  // 2) Live OpenSea v2 (works if CORS open; overwrites snapshot)
  try {
    const [statsRes, colRes] = await Promise.all([
      fetch('https://api.opensea.io/api/v2/collections/mozestreetart/stats', {
        headers: { Accept: 'application/json' },
      }),
      fetch('https://api.opensea.io/api/v2/collections/mozestreetart', {
        headers: { Accept: 'application/json' },
      }),
    ]);
    if (statsRes.ok) {
      const json = await statsRes.json();
      const total = json.total || json;
      if (total.num_owners != null) set('mint-holders', fmtInt(total.num_owners));
      if (total.floor_price != null) {
        const fp = Number(total.floor_price);
        const sym = total.floor_price_symbol || 'ETH';
        set('mint-offer', fp === 0 ? `0 ${sym}` : `${fp} ${sym}`);
      }
      if (total.volume != null) {
        const v = Number(total.volume);
        set('mint-volume', v === 0 ? '0 ETH' : `${v} ETH`);
      }
      if (total.sales != null) set('mint-sales', fmtInt(total.sales));
    }
    if (colRes.ok) {
      const col = await colRes.json();
      const minted = col.total_supply ?? col.unique_item_count;
      if (minted != null) set('mint-minted', fmtInt(minted));
    }
  } catch {
    /* CORS blocked in browser — snapshot already applied */
  }

  set('mint-staked', String(countLocalStaked()));
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
  paintGalleryGrid(randomGalleryItems(GALLERY_SIZE));
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
// Local override: localStorage.setItem('moze-api','http://localhost:3000') or window.MOZE_API
const API_BASE = String(
  (typeof window !== 'undefined' && window.MOZE_API) ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('moze-api')) ||
  'https://api.mozestreet.art'
).replace(/\/$/, '');

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
    return await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    console.warn('[moze-api]', action, err?.message || err);
    return { error: err?.message || String(err) };
  }
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
  return {
    rows: sourceRows.map((r) => ({
      addr: r.addr,
      held: r.held,
      softMoze: Number(r.softMoze) || 0,
    })),
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
    loadHoldersLeaderboard(false);
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

const LB_CACHE_KEY = 'moze-holders-lb-v1';
const LB_CACHE_TTL = 5 * 60 * 1000; // 5 min
const LB_TOP_N = 25;

function softStakePointsFor(addr) {
  try {
    const state = loadStakeState(addr);
    return pendingMoze(state) + (Number(state.claimed) || 0);
  } catch {
    return 0;
  }
}

async function buildHoldersMap() {
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
  }
  // also try token 0
  try {
    const o0 = String(await contract.ownerOf(0)).toLowerCase();
    if (o0 && o0 !== '0x0000000000000000000000000000000000000000') {
      counts.set(o0, (counts.get(o0) || 0) + 1);
    }
  } catch { /* no token 0 */ }

  const rows = [...counts.entries()]
    .map(([addr, held]) => ({
      addr,
      held,
      softMoze: softStakePointsFor(addr),
    }))
    .sort((a, b) => b.held - a.held || b.softMoze - a.softMoze || a.addr.localeCompare(b.addr));

  return { rows, supply, scannedAt: Date.now() };
}

function renderLeaderboardTable(data) {
  const tbody = document.getElementById('lb-tbody');
  const meta = document.getElementById('lb-meta');
  if (!tbody) return;
  const you = (stakeAccount || '').toLowerCase();
  const top = data.rows.slice(0, LB_TOP_N);
  if (!top.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">No holders found yet.</td></tr>';
    return;
  }
  tbody.innerHTML = top.map((row, i) => {
    const isYou = you && row.addr === you;
    const soft = row.softMoze > 0 ? formatMoze(row.softMoze) : '—';
    return (
      `<tr class="${isYou ? 'lb-you' : ''}">` +
      `<td class="lb-rank">${i + 1}</td>` +
      `<td class="lb-wallet">${shortAddr(row.addr)}${isYou ? ' · you' : ''}</td>` +
      `<td class="lb-held">${row.held}</td>` +
      `<td class="lb-staked">${soft}</td>` +
      `</tr>`
    );
  }).join('');

  // If you're a holder but outside top N, append your row
  if (you) {
    const yourIdx = data.rows.findIndex((r) => r.addr === you);
    if (yourIdx >= LB_TOP_N) {
      const row = data.rows[yourIdx];
      const soft = row.softMoze > 0 ? formatMoze(row.softMoze) : '—';
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

  if (meta) {
    const when = new Date(data.scannedAt).toLocaleTimeString();
    meta.textContent = `Top ${Math.min(LB_TOP_N, data.rows.length)} · ${data.rows.length} wallets · supply ~${data.supply} · ${when}`;
  }
}

async function loadHoldersLeaderboard(force) {
  if (!leaderboardVisible || leaderboardLoading) return;
  const tbody = document.getElementById('lb-tbody');
  const meta = document.getElementById('lb-meta');

  // session cache
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
    // merge local soft points if offline source
    if (leaderboardCache.source !== 'api') {
      leaderboardCache.rows = leaderboardCache.rows.map((r) => ({
        ...r,
        softMoze: softStakePointsFor(r.addr),
      }));
    }
    renderLeaderboardTable(leaderboardCache);
    return;
  }

  leaderboardLoading = true;
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">Loading leaderboard…</td></tr>';
  if (meta) meta.textContent = 'Loading…';

  try {
    // Prefer backend (shared stake points + cached holders)
    if (apiOnline === null) await pingApi();
    if (apiOnline) {
      const data = await loadLeaderboardFromApi(force);
      leaderboardCache = data;
      try { sessionStorage.setItem(LB_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
      renderLeaderboardTable(data);
      if (meta) {
        const when = new Date(data.scannedAt).toLocaleTimeString();
        meta.textContent = `API · top ${Math.min(LB_TOP_N, data.rows.length)} · ~${data.supply} supply · ${when}`;
      }
      return;
    }

    // Fallback: browser on-chain scan
    if (typeof ethers === 'undefined') {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">Wallet library not loaded.</td></tr>';
      return;
    }
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">Scanning holders on-chain…</td></tr>';
    const data = await buildHoldersMap();
    data.source = 'client';
    leaderboardCache = data;
    try { sessionStorage.setItem(LB_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
    renderLeaderboardTable(data);
  } catch (err) {
    console.error(err);
    if (tbody) {
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

  for (const layer of traitData.layerOrder) {
    const name = traits[layer];
    if (isBlankTrait(name)) continue;

    const item = getTraitItem(layer, name);
    if (!item) continue;

    const img = await loadTraitImage(item.image);
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

async function renderComposer() {
  const wrap = document.getElementById('composer-canvas');
  const caption = document.getElementById('composer-caption');
  const downloadBtn = document.getElementById('download-moze');
  const token = ++renderComposerToken;
  const hasPreview = !!wrap.querySelector('.composer-preview');

  if (!hasPreview) {
    wrap.innerHTML = '<div class="composer-empty">Generating…</div>';
    if (downloadBtn) downloadBtn.disabled = true;
  }

  try {
    const canvas = await composeMoze(selectedTraits);
    if (token !== renderComposerToken) return;

    composerDataUrl = canvas.toDataURL('image/png');
    const preview = wrap.querySelector('.composer-preview');

    if (preview) {
      preview.src = composerDataUrl;
    } else {
      wrap.innerHTML = `<img src="${composerDataUrl}" alt="Generated Moze" class="composer-preview">`;
    }

    if (caption) caption.textContent = traitSummary(selectedTraits);
    if (downloadBtn) downloadBtn.disabled = false;
  } catch {
    if (token !== renderComposerToken) return;
    composerDataUrl = null;
    wrap.innerHTML = '<div class="composer-empty">Could not generate — check trait layers</div>';
    if (caption) caption.textContent = '';
    if (downloadBtn) downloadBtn.disabled = true;
  }
}

function randomizeTraits() {
  for (const cat of traitData.categories) {
    const item = cat.items[Math.floor(Math.random() * cat.items.length)];
    selectedTraits[cat.name] = item.name;
  }
  renderTraitTabs();
  renderTraitItems();
  renderComposer();
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

function getEthereum() {
  const eth = window.ethereum;
  if (!eth) return null;
  // Multi-wallet injectors (MetaMask + others)
  if (Array.isArray(eth.providers) && eth.providers.length) {
    return eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
  }
  return eth;
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

function formatMoze(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 100) return n.toFixed(1);
  if (n >= 10) return n.toFixed(2);
  return n.toFixed(3);
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

function startStakeTicker() {
  if (stakeTickTimer) clearInterval(stakeTickTimer);
  stakeTickTimer = setInterval(() => {
    if (stakeAccount) updateDashboard();
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
  return new ethers.JsonRpcProvider(RH_RPC, 4663);
}

async function fetchOwnedTokenIds(walletProvider, owner) {
  const ownerLc = owner.toLowerCase();
  // Prefer public RPC for reads — wallet RPCs sometimes lag / wrong chain mid-switch
  const read = getRobinhoodReadProvider();
  const contract = new ethers.Contract(MOZE_CA, ERC721_ABI, read);

  let n = 0;
  try {
    n = Number(await contract.balanceOf(owner));
  } catch (err) {
    // fallback wallet provider
    try {
      const wContract = new ethers.Contract(MOZE_CA, ERC721_ABI, walletProvider);
      n = Number(await wContract.balanceOf(owner));
    } catch (e2) {
      console.error(err, e2);
      throw new Error('Could not read NFT balance. Make sure you are on Robinhood Chain.');
    }
  }

  if (!n) return [];

  // 1) Enumerable (if contract supports it)
  try {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      ids.push(Number(await contract.tokenOfOwnerByIndex(owner, i)));
    }
    if (ids.length === n) return [...new Set(ids)].sort((a, b) => a - b);
  } catch { /* not enumerable */ }

  // 2) Scan token ids (OpenSea drops usually 1..supply; also try 0)
  let supply = 1000;
  try {
    const ts = Number(await contract.totalSupply());
    if (ts > 0) supply = Math.min(1000, Math.max(ts + 5, ts));
  } catch { /* use 1000 */ }

  setStakeStatus(`Checking Moze ownership… (${n} NFTs in wallet). Hang tight.`);
  const found = [];
  const batch = 50;
  const maxId = Math.max(supply, 1000);

  for (let start = 0; start <= maxId && found.length < n; start += batch) {
    const chunk = [];
    for (let id = start; id < start + batch && id <= maxId; id += 1) {
      chunk.push(
        contract.ownerOf(id)
          .then((o) => (String(o).toLowerCase() === ownerLc ? id : null))
          .catch(() => null)
      );
    }
    const results = await Promise.all(chunk);
    for (const id of results) {
      if (id != null) found.push(id);
    }
    if (start > 0 && start % 200 === 0) {
      setStakeStatus(`Still scanning… found ${found.length}/${n} · id ${start}/${maxId}`);
    }
  }

  if (found.length < n) {
    console.warn(`Found ${found.length}/${n} tokens for ${owner}`);
  }
  return [...new Set(found)].sort((a, b) => a - b);
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
  const opensea = `https://opensea.io/item/robinhood/${MOZE_CA}/${id}`;
  const text =
    `Staking ${nick} (#${id}) on Moze 🎨\n` +
    `Soft rewards $MOZE · Robinhood Chain\n` +
    `${opensea}\n` +
    `@mozenft_`;

  try {
    // Try Web Share with file (mobile / some browsers)
    if (navigator.share && navigator.canShare) {
      const blob = await fetchImageBlob(activeStakeImageUrl(id));
      const file = new File([blob], `moze-${id}.png`, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: nick,
          text,
        });
        setStakeImgStatus('Shared.');
        return;
      }
    }
  } catch (err) {
    // user cancel or unsupported — fall through to X intent
    if (err?.name === 'AbortError') {
      setStakeImgStatus('');
      return;
    }
  }

  // X/Twitter web intent (text + url; image must be attached manually or via OS share)
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(intent, '_blank', 'noopener,noreferrer');
  setStakeImgStatus('X opened. Image copied too (if supported) — paste into the post.');
  // best-effort also copy image so user can paste into compose
  try {
    const blob = await fetchImageBlob(activeStakeImageUrl(id));
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || 'image/png']: blob }),
      ]);
    }
  } catch { /* ignore */ }
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
  const stEl = document.getElementById('mint-staked');
  if (stEl) stEl.textContent = String(countLocalStaked());
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

async function connectStakeWallet() {
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
    setStakeStatus('Connecting… select Robinhood Chain.');
    await ensureRobinhoodChain();
    const provider = new ethers.BrowserProvider(eth);
    const accounts = await provider.send('eth_requestAccounts', []);
    if (!accounts?.length) throw new Error('No account connected.');
    stakeAccount = accounts[0];
    stakeSelected = new Set();
    const label = document.getElementById('stake-wallet');
    const walletText = document.getElementById('stake-wallet-text');
    const btn = document.getElementById('stake-connect');
    if (label) {
      label.hidden = false;
      label.setAttribute('data-addr', stakeAccount);
      if (walletText) walletText.textContent = shortAddr(stakeAccount);
    }
    if (btn) btn.textContent = 'Connected';
    setStakeStatus('Connected. Loading Moze from the blockchain…');
    stakeOwnedIds = await fetchOwnedTokenIds(provider, stakeAccount);
    if (!stakeOwnedIds.length) {
      setStakeStatus('This wallet holds no Moze on Robinhood. Mint on OpenSea, or check the network.');
      showStakeChrome(false);
      syncLeaderboardVisibility();
      return;
    }
    // Preload first cover image so UI feels solid
    try {
      await fetchImageBlob(activeStakeImageUrl(stakeOwnedIds[0]));
    } catch { /* ignore */ }

    const state = loadStakeState(stakeAccount);
    settleAccrued(state);
    for (const id of Object.keys(state.positions)) {
      if (!stakeOwnedIds.includes(Number(id))) delete state.positions[id];
    }
    saveStakeState(stakeAccount, state);
    const nStaked = Object.keys(state.positions).length;
    setStakeStatus(
      stakeOwnedIds.length + ' Moze found · ' + nStaked + ' staked · ' +
      formatMoze(pendingMoze(state)) + ' $MOZE pending. Click a card to select.'
    );
    showStakeChrome(true);
    renderStakeGrid();
    startStakeTicker();
    // leaderboard only if already staking
    syncLeaderboardVisibility();
  } catch (err) {
    console.error(err);
    setStakeStatus(err?.message || 'Failed to connect wallet.', true);
    showStakeChrome(false);
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
    syncLeaderboardVisibility();
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
    syncLeaderboardVisibility();
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
    syncLeaderboardVisibility();
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
    syncLeaderboardVisibility();
  }
}

function selectAllTokens() {
  stakeSelected = new Set(stakeOwnedIds);
  renderStakeGrid();
  setStakeStatus('Selected ' + stakeSelected.size + ' Moze.');
}

async function claimMoze() {
  if (!stakeAccount) return;
  const state = loadStakeState(stakeAccount);
  settleAccrued(state);
  const amount = Number(state.banked) || 0;
  if (amount < 0.0001) {
    setStakeStatus('No $MOZE to claim yet. Stake first and wait a bit.');
    updateDashboard();
    return;
  }
  state.claimed = (Number(state.claimed) || 0) + amount;
  state.banked = 0;
  saveStakeState(stakeAccount, state);
  setStakeStatus('Claimed ' + formatMoze(amount) + ' $MOZE. Total claimed: ' + formatMoze(state.claimed) + ' $MOZE.');
  updateDashboard();
  renderStakeGrid();
  const res = await apiSignedAction('claim', []);
  if (res?.error) setStakeStatus('Claimed locally. Server: ' + res.error);
  else if (res?.ok) setStakeStatus('Claimed ' + formatMoze(amount) + ' $MOZE · synced.');
}

function resetStakeUi() {
  stakeAccount = null;
  stakeOwnedIds = [];
  stakeSelected = new Set();
  if (stakeTickTimer) clearInterval(stakeTickTimer);
  const label = document.getElementById('stake-wallet');
  const walletText = document.getElementById('stake-wallet-text');
  const btn = document.getElementById('stake-connect');
  if (label) {
    label.hidden = true;
    label.setAttribute('data-addr', '');
  }
  if (walletText) walletText.textContent = '';
  if (btn) btn.textContent = 'Connect Wallet';
  showStakeChrome(false);
  setStakeStatus('Wallet changed — connect again.');
  leaderboardCache = null;
  syncLeaderboardVisibility();
}

function initStake() {
  showStakeChrome(false);
  initCopyChips();
  initStakeNav();
  pingApi().catch(() => {});
  document.getElementById('stake-connect')?.addEventListener('click', connectStakeWallet);
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

  if (window.ethereum) window.ethereum.on?.('accountsChanged', resetStakeUi);
}

initStake();
loadData();
