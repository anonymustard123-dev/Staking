const base = 'https://ethereum-beacon-api.publicnode.com';
const beaconchaBase = 'https://api.beaconcha.in/v2';

function indices(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').filter(item => /^\d+$/.test(item) && Number.isSafeInteger(Number(item))))].slice(0, 50);
}

async function beaconchaPerformance(ids) {
  const key = process.env.BEACONCHA_API_KEY || process.env.BEACONCHAIN_API_KEY || process.env.BEACONCHA_KEY;
  if (!key) return { available: false, reason: 'Indexed reward source is not configured.', validators: {} };
  try {
    // Console-issued keys are JWT bearer tokens for Beaconcha's current v2 API.
    // The earlier v1 endpoints use a different legacy key format and reject them.
    const performanceResponse = await fetch(`${beaconchaBase}/validators/performance-list`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ validator: { validator_identifiers: ids.map(Number) } }),
      signal: AbortSignal.timeout(9000)
    });
    if (!performanceResponse.ok) throw new Error(performanceResponse.status === 401 || performanceResponse.status === 403 ? 'Indexed provider rejected its API key.' : `Indexed provider returned HTTP ${performanceResponse.status}`);
    const performance = await performanceResponse.json();
    const records = [performance?.data, performance?.results, performance?.validators, performance?.items, performance?.data?.validators, performance?.data?.results].find(Array.isArray) || [];
    const validators = Object.fromEntries(records.map((item, position) => {
      // The v2 list response is ordered by the requested identifiers. Keep
      // that stable fallback for response variants that omit a duplicate index.
      const index = String(item?.validator_index ?? item?.validatorIndex ?? item?.index ?? item?.validator?.index ?? ids[position] ?? '');
      const score = item?.beaconscore ?? item?.beacon_score ?? item?.performance?.beaconscore ?? {};
      const income = item?.performance1d ?? item?.performance_1d ?? item?.rewards?.consensus_1d;
      const proposals = item?.proposal_count ?? item?.proposals;
      return [index, {
        consensus1dEth: Number.isFinite(Number(income)) ? Number(income) / 1e9 : null,
        proposalCount: Number.isFinite(Number(proposals)) ? Number(proposals) : null,
        syncAssigned: item?.sync_assigned ?? item?.syncAssigned ?? null,
        beaconScore: Number(score?.total ?? score ?? NaN),
        attestationScore: Number(score?.attestation ?? NaN),
        proposalScore: Number(score?.proposal ?? NaN),
        syncScore: Number(score?.sync_committee ?? score?.syncCommittee ?? NaN)
      }];
    }).filter(([index]) => /^\d+$/.test(index)));
    return { available: true, validators };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'Indexed provider rejected its API key.' || /^Indexed provider returned HTTP \d+$/.test(message)) return { available: false, reason: message, validators: {} };
    if (/timed out|timeout/i.test(message)) return { available: false, reason: 'Indexed provider timed out.', validators: {} };
    return { available: false, reason: 'Indexed provider connection failed.', validators: {} };
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
