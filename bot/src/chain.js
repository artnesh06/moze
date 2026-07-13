const { ethers } = require('ethers');
const { getSetting } = require('./db');

// Minimal ERC-721 ABI
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function totalSupply() view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

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
async function getNftBalance(walletAddress) {
  try {
    const provider = getProvider();
    const contract = getContract(provider);
    const balance = await contract.balanceOf(walletAddress);
    return Number(balance);
  } catch (err) {
    console.error('[chain] balanceOf error:', err.message);
    return 0;
  }
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
 * Start listening for Transfer events (sales tracker)
 */
function startSalesListener(onSale) {
  const provider = getProvider();
  const contract = getContract(provider);

  const ZERO = '0x0000000000000000000000000000000000000000';

  contract.on('Transfer', async (from, to, tokenId) => {
    // Ignore mints (from zero address)
    if (from.toLowerCase() === ZERO) return;

    try {
      await onSale({
        from,
        to,
        tokenId: tokenId.toString(),
      });
    } catch (err) {
      console.error('[chain] onSale handler error:', err.message);
    }
  });

  console.log('[chain] Listening for Transfer events on Moze contract...');

  // Reconnect on provider error
  provider.on('error', (err) => {
    console.error('[chain] Provider error, reconnecting in 10s:', err.message);
    setTimeout(() => startSalesListener(onSale), 10000);
  });
}

module.exports = { getNftBalance, getRoleForCount, startSalesListener };
