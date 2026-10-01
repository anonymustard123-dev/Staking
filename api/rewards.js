const base = 'https://ethereum-beacon-api.publicnode.com';
const beaconchaBase = 'https://beaconcha.in/api/v1';

function indices(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').filter(item => /^\d+$/.test(item) && Number.isSafeInteger(Number(item))))].slice(0, 50);
}

async function beaconchaPerformance(ids) {
  const key = process.env.BEACONCHA_API_KEY;
  if (!key) return { available: false, reason: 'Indexed reward source is not configured.', validators: {} };
  try {
    const query = `apikey=${encodeURIComponent(key)}`, indexList = ids.join(',');
    const request = path => fetch(`${beaconchaBase}${path}${path.includes('?') ? '&' : '?'}${query}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    const [performanceResponse, proposalsResponse, syncResponse] = await Promise.all([request(`/validator/${indexList}/performance`), request(`/validator/${indexList}/proposals`), request('/sync_committee/latest')]);
    if (!performanceResponse.ok) throw new Error(`Indexed reward source returned HTTP ${performanceResponse.status}`);
    const performance = await performanceResponse.json(), proposals = proposalsResponse.ok ? await proposalsResponse.json() : { data: [] }, sync = syncResponse.ok ? await syncResponse.json() : { data: { validators: [] } };
    const proposalCount = Object.fromEntries(ids.map(id => [id, (proposals?.data || []).filter(item => String(item?.proposer) === id).length]));
    const committee = new Set((sync?.data?.validators || []).map(String));
    const validators = Object.fromEntries((performance?.data || []).map(item => {
      const index = String(item?.validatorindex ?? item?.validator_index ?? '');
      return [index, { consensus1dEth: Number(item?.performance1d || 0) / 1e9, proposalCount: proposalCount[index] || 0, syncAssigned: committee.has(index) }];
    }).filter(([index]) => /^\d+$/.test(index)));
    return { available: true, validators };
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
