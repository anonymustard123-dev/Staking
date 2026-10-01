const base = 'https://ethereum-beacon-api.publicnode.com';
const beaconchaBase = 'https://api.beaconcha.in/v2';

function indices(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').filter(item => /^\d+$/.test(item) && Number.isSafeInteger(Number(item))))].slice(0, 50);
}

function score(value) { const numeric = Number(value); return Number.isFinite(numeric) ? numeric : null; }
function performanceRows(payload) {
  const candidates = [payload?.data, payload?.validators, payload?.data?.validators, payload?.data?.data];
  const items = candidates.find(Array.isArray) || [];
  return Object.fromEntries(items.map(item => {
    const index = String(item?.validator_index ?? item?.index ?? item?.validator?.index ?? '');
    const details = item?.beaconscore ?? item?.beacon_score ?? item?.performance?.beaconscore ?? item?.performance ?? {};
    return [index, { syncScore: score(details?.sync_committee ?? details?.sync), proposalScore: score(details?.proposal ?? details?.proposals) }];
  }).filter(([index]) => /^\d+$/.test(index)));
}

async function beaconchaPerformance(ids) {
  const key = process.env.BEACONCHA_API_KEY;
  if (!key) return { available: false, reason: 'Indexed reward source is not configured.', validators: {} };
  try {
    const response = await fetch(`${beaconchaBase}/validators/performance-list`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-api-key': key },
      body: JSON.stringify({ validator: { validator_identifiers: ids.map(Number) } }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`Indexed reward source returned HTTP ${response.status}`);
    return { available: true, validators: performanceRows(await response.json()) };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : 'Indexed reward source failed.', validators: {} };
  }
}

export default async function handler(req, res) {
  const ids = indices(req.query?.indices), epoch = Number(req.query?.epoch);
  if (!ids.length || !Number.isSafeInteger(epoch) || epoch < 0) return res.status(400).json({ error: 'Valid validator indices and an epoch are required.' });
  try {
    const [response, indexed] = await Promise.all([fetch(`${base}/eth/v1/beacon/rewards/attestations/${epoch}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(ids), signal: AbortSignal.timeout(12000) }), beaconchaPerformance(ids)]);
    if (!response.ok) throw new Error(`Beacon rewards returned HTTP ${response.status}`);
    const payload = await response.json();
    const rewards = Object.fromEntries((payload?.data?.total_rewards || []).map(item => { const attestationGwei = ['head', 'target', 'source', 'inactivity'].reduce((sum, key) => sum + Number(item[key] || 0), 0); return [String(item.validator_index), { attestationEth: attestationGwei / 1e9 }]; }));
    return res.status(200).json({ available: true, epoch, finalized: Boolean(payload?.finalized), rewards, indexed });
  } catch (error) {
    return res.status(502).json({ available: false, error: error instanceof Error ? error.message : 'Beacon reward request failed', rewards: {} });
  }
}
