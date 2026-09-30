const keyPattern = /^0x[a-f0-9]{96}$/;

function config() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

function snapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const item = value;
  const observedAt = new Date(String(item.at || ''));
  const sourceSlot = Number(item.sourceSlot);
  const consensus = Number(item.consensus);
  const wallet = Number(item.wallet);
  const price = Number(item.price);
  if (Number.isNaN(observedAt.getTime()) || !Number.isSafeInteger(sourceSlot) || sourceSlot < 0 || !Number.isFinite(consensus) || consensus < 0 || !Number.isFinite(wallet) || wallet < 0 || !Number.isFinite(price) || price < 0) return null;
  const balances = item.balances && typeof item.balances === 'object' ? Object.fromEntries(Object.entries(item.balances).filter(([pubkey, balance]) => keyPattern.test(pubkey) && Number.isFinite(Number(balance)) && Number(balance) >= 0).slice(0, 20)) : {};
  return { observed_at: observedAt.toISOString(), source_slot: sourceSlot, finalized_epoch: Number.isSafeInteger(Number(item.finalizedEpoch)) ? Number(item.finalizedEpoch) : null, consensus_balance_eth: consensus, execution_wallet_balance_eth: wallet, eth_usd: price || null, validator_snapshots: balances };
}

async function supabase(path, init, settings) {
  const response = await fetch(`${settings.url}/rest/v1/${path}`, { ...init, headers: { apikey: settings.key, Authorization: `Bearer ${settings.key}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export default async function handler(req, res) {
  const settings = config();
  if (!settings) return res.status(200).json({ configured: false, snapshots: [] });
  try {
    if (req.method === 'POST') {
      const value = snapshot(req.body?.snapshot);
      if (!value) return res.status(400).json({ error: 'Invalid snapshot payload.' });
      await supabase('staking_monitor_snapshots?on_conflict=source_slot', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(value) }, settings);
      return res.status(201).json({ configured: true });
    }
    const records = await supabase('staking_monitor_snapshots?select=observed_at,source_slot,finalized_epoch,consensus_balance_eth,execution_wallet_balance_eth,eth_usd,validator_snapshots&order=observed_at.asc&limit=288', { method: 'GET' }, settings);
    const snapshots = (records || []).map(item => ({ at: item.observed_at, sourceSlot: Number(item.source_slot), finalizedEpoch: item.finalized_epoch === null ? null : Number(item.finalized_epoch), consensus: Number(item.consensus_balance_eth), wallet: Number(item.execution_wallet_balance_eth), usd: (Number(item.consensus_balance_eth) + Number(item.execution_wallet_balance_eth)) * Number(item.eth_usd || 0), price: Number(item.eth_usd || 0), balances: item.validator_snapshots || {} }));
    return res.status(200).json({ configured: true, snapshots });
  } catch (error) {
    return res.status(502).json({ configured: true, error: error instanceof Error ? error.message : 'Supabase request failed', snapshots: [] });
  }
}
