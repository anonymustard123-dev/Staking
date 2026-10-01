const base = 'https://ethereum-beacon-api.publicnode.com';

function indices(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').filter(item => /^\d+$/.test(item) && Number.isSafeInteger(Number(item))))].slice(0, 50);
}

export default async function handler(req, res) {
  const ids = indices(req.query?.indices), epoch = Number(req.query?.epoch);
  if (!ids.length || !Number.isSafeInteger(epoch) || epoch < 0) return res.status(400).json({ error: 'Valid validator indices and an epoch are required.' });
  try {
    const response = await fetch(`${base}/eth/v1/beacon/rewards/attestations/${epoch}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(ids), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Beacon rewards returned HTTP ${response.status}`);
    const payload = await response.json();
    const rewards = Object.fromEntries((payload?.data?.total_rewards || []).map(item => { const attestationGwei = ['head', 'target', 'source', 'inactivity'].reduce((sum, key) => sum + Number(item[key] || 0), 0); return [String(item.validator_index), { attestationEth: attestationGwei / 1e9 }]; }));
    return res.status(200).json({ available: true, epoch, finalized: Boolean(payload?.finalized), rewards });
  } catch (error) {
    return res.status(502).json({ available: false, error: error instanceof Error ? error.message : 'Beacon reward request failed', rewards: {} });
  }
}
