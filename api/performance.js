const indexPattern = /^\d+$/;

function ratedToken(value) {
  if (typeof value !== 'string') return '';
  let token = value.trim().replace(/^Bearer\s+/i, '');
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
  return token.replace(/[\r\n]/g, '').trim();
}

function requestedIndices(value) {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(String).filter(index => indexPattern.test(index)))].slice(0, 20);
  } catch { return []; }
}

function metricRecord(payload) {
  const queue = [payload];
  while (queue.length) {
    const current = queue.shift();
    if (Array.isArray(current)) { queue.push(...current); continue; }
    if (current && typeof current === 'object') {
      if ('validator_index' in current || 'uptime' in current || 'attester_effectiveness' in current) return current;
      if (Array.isArray(current.results)) queue.push(...current.results);
    }
  }
  return null;
}

async function fetchAttestations(index, token) {
  const response = await fetch(`https://api.rated.network/v1/eth/validators/${index}/attestations?granularity=day&limit=1&sortOrder=desc`, {
    headers: { authorization: `Bearer ${token}`, 'x-rated-network': 'mainnet', accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Rated returned HTTP ${response.status}`);
  return metricRecord(await response.json());
}

export default async function handler(req, res) {
  try {
    const token = ratedToken(process.env.RATED_API_KEY);
    const indices = requestedIndices(req.query?.indices);
    if (!token) return res.status(200).json({ available: false, reason: 'RATED_API_KEY is not configured', metrics: {} });
    if (!indices.length) return res.status(400).json({ available: false, reason: 'No validator indices were supplied', metrics: {} });
    const entries = await Promise.all(indices.map(async index => {
      try { return [index, { available: true, data: await fetchAttestations(index, token) }]; }
      catch (error) { return [index, { available: false, error: error instanceof Error ? error.message : 'Rated lookup failed' }]; }
    }));
    const available = entries.some(([, value]) => value.available);
    const firstFailure = entries.find(([, value]) => !value.available)?.[1];
    return res.status(200).json({ available, reason: available ? undefined : (firstFailure?.error || 'Rated returned no performance records'), fetchedAt: new Date().toISOString(), metrics: Object.fromEntries(entries) });
  } catch (error) {
    return res.status(502).json({ available: false, reason: error instanceof Error ? error.message : 'Performance service failed', metrics: {} });
  }
}
