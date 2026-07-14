const { ethers } = require('ethers');
const { getSetting } = require('./db');

// Minimal ERC-721 ABI
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function totalSupply() view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

// Known collections
const COLLECTIONS = {
  moze: {
    ca: '0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc',
    name: 'Moze Street Art',
  },
  gremlins: {
    ca: '0x12449b9a29865621be166aaff04dc14a640b4119',
    name: 'Gremlin Cartel',
  },
};

function getProvider() {
  const rpc = getSetting('rh_rpc') || 'https://rpc.mainnet.chain.robinhood.com';
  return new ethers.JsonRpcProvider(rpc);
}

function getContract(providerOrSigner) {
  const ca = getSetting('moze_ca') || '0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc';
  return new ethers.Contract(ca, ERC721_ABI, providerOrSigner);
}

/**
 * Get NFT balance for a wallet address
 */
async function getNftBalance(walletAddress, ca) {
  try {
    const provider = getProvider();
    const contractCa = ca || getSetting('moze_ca') || COLLECTIONS.moze.ca;
    const contract = new ethers.Contract(contractCa, ERC721_ABI, provider);
    const balance = await contract.balanceOf(walletAddress);
    return Number(balance);
  } catch (err) {
    console.error('[chain] balanceOf error:', err.message);
    return 0;
  }
}

/**
 * Get balances for all known collections
 */
async function getAllBalances(walletAddress) {
  const [moze, gremlins] = await Promise.all([
    getNftBalance(walletAddress, COLLECTIONS.moze.ca),
    getNftBalance(walletAddress, COLLECTIONS.gremlins.ca),
  ]);
  return { moze, gremlins };
}

/**
 * Get role name based on NFT count
 */
function getRoleForCount(count, roles) {
  if (!count || count === 0) return null;
  // Sort descending by min to find highest matching role
  const sorted = [...roles].sort((a, b) => b.min_hold - a.min_hold);
  for (const r of sorted) {
    if (count >= r.min_hold) return r.role_name;
  }
  return null;
}

/**
 * Start polling Transfer events (sales tracker).
 * Uses getLogs polling instead of eth_subscribe/filter — public RPC rate-limits
 * filter APIs hard (429) and uncaught errors were killing the whole bot process.
 */
function startSalesListener(onSale) {
  const ZERO = '0x0000000000000000000000000000000000000000';
  const POLL_MS = Number(process.env.SALES_POLL_MS || 45000);
  let lastBlock = null;
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const provider = getProvider();
      const contract = getContract(provider);
      const tip = await provider.getBlockNumber();
      if (lastBlock == null) {
        // First run: only watch forward (skip historical flood)
        lastBlock = Math.max(0, tip - 2);
        return;
      }
      const fromBlock = lastBlock + 1;
      if (fromBlock > tip) return;
      // Cap range so RPC stays happy
      const toBlock = Math.min(tip, fromBlock + 200);
      const filter = {
        address: contract.target || contract.address,
        fromBlock,
        toBlock,
        topics: [ethers.id('Transfer(address,address,uint256)')],
      };
      const logs = await provider.getLogs(filter);
      for (const log of logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (!parsed || parsed.name !== 'Transfer') continue;
          const from = String(parsed.args.from || '');
          const to = String(parsed.args.to || '');
          const tokenId = parsed.args.tokenId?.toString?.() || String(parsed.args[2] || '');
          if (from.toLowerCase() === ZERO) continue;
          await onSale({ from, to, tokenId });
        } catch (err) {
          console.error('[chain] parse/onSale error:', err.message);
        }
      }
      lastBlock = toBlock;
    } catch (err) {
      // Never throw — 429 / RPC blips must not kill the bot
      console.error('[chain] sales poll error:', err.shortMessage || err.message);
    } finally {
      busy = false;
    }
  }

  console.log(`[chain] Sales poller every ${POLL_MS}ms (getLogs, crash-safe)...`);
  tick().catch(() => {});
  setInterval(() => {
    tick().catch(() => {});
  }, POLL_MS);
}

module.exports = { getNftBalance, getAllBalances, getRoleForCount, startSalesListener };
