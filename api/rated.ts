type RequestLike = { query?: Record<string, string | string[] | undefined> };
type ResponseLike = { status: (status: number) => ResponseLike; json: (body: unknown) => void };

const INDEX_RE = /^\d+$/;

function indices(value: string | string[] | undefined) {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(String).filter(index => INDEX_RE.test(index)))].slice(0, 20);
  } catch { return []; }
}

function recordFrom(response: unknown): Record<string, unknown> | null {
  const stack: unknown[] = [response];
  while (stack.length) {
    const current = stack.shift();
    if (Array.isArray(current)) { stack.push(...current); continue; }
    if (current && typeof current === 'object') {
      const item = current as Record<string, unknown>;
      if ('validator_index' in item || 'uptime' in item || 'attester_effectiveness' in item) return item;
      if (Array.isArray(item.results)) stack.push(...item.results);
    }
  }
  return null;
}

async function ratedGet(index: string, token: string) {
  const response = await fetch(`https://api.rated.network/v1/eth/validators/${index}/attestations?granularity=day&limit=1&sortOrder=desc`, {
    headers: { authorization: `Bearer ${token}`, 'x-rated-network': 'mainnet', accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Rated returned HTTP ${response.status}`);
  return recordFrom(await response.json());
}

// This function intentionally exposes normalized performance data only. The API
// key is read solely from Vercel's server environment and never returned.
export default async function handler(req: RequestLike, res: ResponseLike) {
  const token = process.env.RATED_API_KEY;
  const requested = indices(req.query?.indices);
  if (!token) return res.status(200).json({ available: false, reason: 'RATED_API_KEY is not configured', metrics: {} });
  if (!requested.length) return res.status(400).json({ error: 'Provide one or more validator indices.' });
  const entries = await Promise.all(requested.map(async index => {
    try { return [index, { available: true, data: await ratedGet(index, token) }] as const; }
    catch (error) { return [index, { available: false, error: error instanceof Error ? error.message : 'Rated lookup failed' }] as const; }
  }));
  return res.status(200).json({ available: entries.some(([, value]) => value.available), fetchedAt: new Date().toISOString(), metrics: Object.fromEntries(entries) });
}
