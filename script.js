let whitelist = new Set();
let gallery = [];
let collection = [];
let traitData = null;
let selectedTraits = {};
let activeCategory = 'BACKGROUND';
const COMPOSER_SIZE = 1000;
const traitImageCache = new Map();
let composerDataUrl = null;
let renderComposerToken = 0;
const HERO_GIF = 'assets/moze-hero.gif';
let heroLocked = false;

const STAKE_CONTRACT = '0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc';
const MOZE_NFT_CONTRACT = ''; // set after mint deploy

const SELECTORS = {
  balanceOf: '0x70a08231',
  tokenOfOwnerByIndex: '0x2f745c59',
};

const BANNERS = [
  'assets/banner-1.png',
  'assets/banner-2.png',
  'assets/banner-3.png',
];
let bannerIndex = 0;

const topBanner = document.getElementById('top-banner');
const heroImg = document.getElementById('hero-img');
const heroName = document.getElementById('hero-name');
const heroTrait = document.getElementById('hero-trait');

async function loadData() {
  const [wlRes, galRes, traitRes, colRes] = await Promise.all([
    fetch('data/whitelist.json'),
    fetch('data/gallery.json'),
    fetch('data/traits.json'),
    fetch('data/collection.json'),
  ]);

  whitelist = new Set(await wlRes.json());
  gallery = (await galRes.json()).map(fixImagePath);
  traitData = await traitRes.json();
  collection = await colRes.json();

  document.getElementById('trait-total').textContent = traitData.total;
  const traitsDesc = document.getElementById('traits-desc');
  if (traitsDesc) traitsDesc.textContent = `${traitData.total} traits across 7 layers.`;

  renderGallery();
  initTraits();
  startBannerRotation();
  initStake();
  initCopyButtons();
}

function fixImagePath(item) {
  if (item.image && !item.image.startsWith('assets/')) {
    item.image = `assets/${item.image}`;
  }
  return item;
}

function traitCaption(item) {
  const bg = item.BACKGROUND || item.background || '';
  const skin = item.SKIN || item.skin || '';
  return `${bg} · ${skin}`;
}

function resetHeroGif() {
  heroLocked = false;
  heroImg.src = HERO_GIF;
  heroImg.alt = 'Moze collection preview';
  heroName.textContent = '1,000 unique Moze';
  heroTrait.textContent = 'Hand-drawn street art PFPs';
}

function showMoze(item) {
  if (!item) return;

  const preload = new Image();
  preload.onload = () => {
    heroImg.src = item.image;
    heroImg.alt = item.name;
    heroName.textContent = item.name;
    heroTrait.textContent = traitCaption(item);
  };
  preload.src = item.image;
}

function startBannerRotation() {
  if (!topBanner) return;
  setInterval(() => {
    bannerIndex = (bannerIndex + 1) % BANNERS.length;
    topBanner.style.opacity = '0';
    setTimeout(() => {
      topBanner.src = BANNERS[bannerIndex];
      topBanner.style.opacity = '1';
    }, 300);
  }, 3000);
}

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = gallery.map(item => `
    <div class="gallery_item" data-id="${item.id}">
      <img src="${item.image}" alt="${item.name}" loading="lazy">
      <div class="desc">${item.name}</div>
    </div>
  `).join('');

  grid.querySelectorAll('.gallery_item').forEach(el => {
    el.addEventListener('click', () => {
      const item = gallery.find(g => g.id === +el.dataset.id)
        || collection.find(c => c.id === +el.dataset.id);
      if (item) {
        heroLocked = true;
        showMoze(item);
        document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

function initTraits() {
  selectedTraits = { ...traitData.defaults };
  renderTraitTabs();
  renderTraitItems();
  renderComposer();

  document.getElementById('random-traits')?.addEventListener('click', randomizeTraits);
  document.getElementById('download-moze')?.addEventListener('click', downloadMoze);
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

let connectedAccount = null;
let ownedNfts = [];
let selectedStakeId = null;

function padAddress(addr) {
  return addr.slice(2).toLowerCase().padStart(64, '0');
}

function decodeUint(hex) {
  if (!hex || hex === '0x') return 0;
  return parseInt(hex, 16);
}

async function ethCall(contract, data) {
  return window.ethereum.request({
    method: 'eth_call',
    params: [{ to: contract, data }, 'latest'],
  });
}

async function fetchOwnedNfts(address) {
  if (!MOZE_NFT_CONTRACT || !/^0x[a-fA-F0-9]{40}$/.test(MOZE_NFT_CONTRACT)) {
    return [];
  }

  try {
    const balanceHex = await ethCall(
      MOZE_NFT_CONTRACT,
      SELECTORS.balanceOf + padAddress(address),
    );
    const balance = decodeUint(balanceHex);
    const tokenIds = [];

    for (let i = 0; i < balance; i += 1) {
      const index = i.toString(16).padStart(64, '0');
      const tokenHex = await ethCall(
        MOZE_NFT_CONTRACT,
        SELECTORS.tokenOfOwnerByIndex + padAddress(address) + index,
      );
      tokenIds.push(decodeUint(tokenHex));
    }

    return tokenIds;
  } catch {
    return [];
  }
}

function mozeById(id) {
  return collection.find(m => m.id === id) || {
    id,
    name: `Moze #${id}`,
    image: `assets/collection/${id}.png`,
    BACKGROUND: '',
    SKIN: '',
  };
}

function renderStakePreview(moze) {
  const img = document.getElementById('stake-preview-img');
  const name = document.getElementById('stake-preview-name');
  const detail = document.getElementById('stake-preview-detail');
  if (!img || !name || !detail) return;

  const preload = new Image();
  preload.onload = () => {
    img.src = moze.image;
    img.alt = moze.name;
  };
  preload.src = moze.image;

  name.textContent = moze.name;
  detail.textContent = traitCaption(moze);
}

function renderStakeGrid() {
  const grid = document.getElementById('stake-nft-grid');
  const ownedCount = document.getElementById('stake-owned-count');
  if (!grid) return;

  ownedCount.textContent = connectedAccount ? String(ownedNfts.length) : '—';

  if (!connectedAccount) {
    grid.innerHTML = '<div class="stake-nft-empty">Your Moze NFTs will appear here after connecting wallet.</div>';
    return;
  }

  if (!ownedNfts.length) {
    grid.innerHTML = '<div class="stake-nft-empty">No Moze found in this wallet yet. Mint coming soon on Robinhood.</div>';
    return;
  }

  grid.innerHTML = ownedNfts.map(id => {
    const moze = mozeById(id);
    return `
      <button type="button" class="stake-nft-card${selectedStakeId === id ? ' active' : ''}" data-id="${id}">
        <img src="${moze.image}" alt="${moze.name}" loading="lazy">
        <span class="stake-nft-id">#${id}</span>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.stake-nft-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedStakeId = +card.dataset.id;
      renderStakeGrid();
      renderStakePreview(mozeById(selectedStakeId));
      document.getElementById('stake-btn').disabled = false;
    });
  });

  if (!selectedStakeId || !ownedNfts.includes(selectedStakeId)) {
    selectedStakeId = ownedNfts[0];
    renderStakePreview(mozeById(selectedStakeId));
    grid.querySelector('.stake-nft-card')?.classList.add('active');
    document.getElementById('stake-btn').disabled = false;
  }
}

function showcaseIdsForWallet(address) {
  const seed = parseInt(address.slice(2, 10), 16);
  const picks = new Set();
  while (picks.size < 6) {
    picks.add((seed + picks.size * 137) % 1000 + 1);
  }
  return [...picks];
}

async function loadWalletNfts() {
  const status = document.getElementById('wallet-status');
  status.textContent = 'Loading your Moze vault…';
  ownedNfts = await fetchOwnedNfts(connectedAccount);
  selectedStakeId = null;

  if (!ownedNfts.length && !MOZE_NFT_CONTRACT && connectedAccount) {
    ownedNfts = showcaseIdsForWallet(connectedAccount);
    status.textContent = `${connectedAccount.slice(0, 6)}…${connectedAccount.slice(-4)} · vault preview (mint soon)`;
  } else if (ownedNfts.length) {
    status.textContent = `${connectedAccount.slice(0, 6)}…${connectedAccount.slice(-4)} · ${ownedNfts.length} Moze in vault`;
  } else {
    status.textContent = `${connectedAccount.slice(0, 6)}…${connectedAccount.slice(-4)} connected · no Moze found`;
  }

  renderStakeGrid();
}

function initStake() {
  const connectBtn = document.getElementById('connect-wallet');
  const stakeBtn = document.getElementById('stake-btn');
  const unstakeBtn = document.getElementById('unstake-btn');
  const status = document.getElementById('wallet-status');

  renderStakeGrid();

  connectBtn?.addEventListener('click', async () => {
    if (!window.ethereum) {
      status.textContent = 'No wallet detected — use Robinhood Wallet or MetaMask';
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      connectedAccount = accounts[0];
      connectBtn.textContent = 'Connected ✓';
      connectBtn.disabled = true;
      unstakeBtn.disabled = false;
      await loadWalletNfts();
    } catch {
      status.textContent = 'Connection cancelled';
    }
  });

  stakeBtn?.addEventListener('click', () => {
    if (!connectedAccount || !selectedStakeId) return;
    status.textContent = `Ready to stake Moze #${selectedStakeId} — contract ${STAKE_CONTRACT.slice(0, 8)}…`;
  });

  unstakeBtn?.addEventListener('click', () => {
    if (!connectedAccount) return;
    status.textContent = 'Unstake via staking contract';
  });

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', accounts => {
      connectedAccount = accounts[0] || null;
      if (!connectedAccount) {
        connectBtn.textContent = 'Connect Wallet';
        connectBtn.disabled = false;
        ownedNfts = [];
        selectedStakeId = null;
        stakeBtn.disabled = true;
        unstakeBtn.disabled = true;
        status.textContent = 'Connect wallet to load your Moze vault';
        renderStakePreview(mozeById(54));
        renderStakeGrid();
        return;
      }
      loadWalletNfts();
    });
  }
}

function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = 'copied!';
      setTimeout(() => { btn.textContent = 'copy'; }, 1500);
    });
  });
}

loadData();