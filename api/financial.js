const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const weiToEth = value => {
  try { return Number(BigInt(value || '0')) / 1e18; } catch { return 0; }
};

function addresses(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').map(item => item.trim().toLowerCase()).filter(item => addressPattern.test(item)))].slice(0, 20);
}

async function coinGecko(key) {
  if (!key) return { available: false, reason: 'COINGECKO_DEMO_API_KEY is not configured' };
  const headers = { 'x-cg-demo-api-key': key };
  const [spot, chart] = await Promise.all([
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true', { headers }),
    fetch('https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=7&interval=hourly', { headers }),
  ]);
  if (!spot.ok) return { available: false, reason: `CoinGecko returned HTTP ${spot.status}` };
  const current = await spot.json();
  const history = chart.ok ? await chart.json() : { prices: [] };
  return { available: true, usd: Number(current?.ethereum?.usd || 0), change24h: Number(current?.ethereum?.usd_24h_change || 0), prices: Array.isArray(history.prices) ? history.prices.slice(-168) : [] };
}

async function etherscanRequest(params, key) {
  const url = new URL('https://api.etherscan.io/v2/api');
  url.search = new URLSearchParams({ chainid: '1', ...params, apikey: key }).toString();
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Etherscan returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status === '0' && !/no transactions/i.test(String(payload.message || '') + String(payload.result || ''))) throw new Error(String(payload.result || payload.message || 'Etherscan rejected the request'));
  return payload.result;
}

async function wallet(address, key) {
  const [balance, transactions] = await Promise.all([
    etherscanRequest({ module: 'account', action: 'balance', address, tag: 'latest' }, key),
    etherscanRequest({ module: 'account', action: 'txlist', address, startblock: '0', endblock: '99999999', page: '1', offset: '8', sort: 'desc' }, key),
  ]);
  return { balanceEth: weiToEth(balance), transactions: Array.isArray(transactions) ? transactions.map(item => ({ hash: String(item.hash), at: Number(item.timeStamp || 0) * 1000, from: String(item.from || '').toLowerCase(), to: String(item.to || '').toLowerCase(), valueEth: weiToEth(item.value), isError: String(item.isError || '0') !== '0' })).filter(item => !item.isError) : [] };
}

export default async function handler(req, res) {
  const requested = addresses(req.query?.addresses);
  const coinGeckoKey = process.env.COINGECKO_DEMO_API_KEY?.trim() || process.env.COINGECKO_API_KEY?.trim();
  const etherscanKey = process.env.ETHERSCAN_API_KEY?.trim();
  const [price, wallets] = await Promise.all([
    coinGecko(coinGeckoKey).catch(error => ({ available: false, reason: error instanceof Error ? error.message : 'CoinGecko request failed' })),
    !etherscanKey ? Promise.resolve({ available: false, reason: 'ETHERSCAN_API_KEY is not configured', items: {} }) : Promise.all(requested.map(async address => [address, await wallet(address, etherscanKey)] )).then(entries => ({ available: true, items: Object.fromEntries(entries) })).catch(error => ({ available: false, reason: error instanceof Error ? error.message : 'Etherscan request failed', items: {} })),
  ]);
  return res.status(200).json({ fetchedAt: new Date().toISOString(), price, wallets });
}
