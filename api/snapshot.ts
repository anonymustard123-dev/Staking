import { credentialInfo, gweiToEth, getState, KEY_RE, lookup, providerName, redactedBase, verifyMainnet } from '../server/beacon.ts';

type RequestLike = { query: Record<string, string | string[] | undefined> };
type ResponseLike = { status: (status: number) => ResponseLike; json: (body: unknown) => void };
type WatchItem = { pubkey: string; friendly_name: string };

const DEFAULT_WATCHLIST: WatchItem[] = [
  { friendly_name: 'Validator 01', pubkey: '0x85c959e693d62a09f2b812b262b3666f22de507f308e3e8afed013aff1c3eebbf8a1605f724cc095a19bcb6fe856f19a' },
  { friendly_name: 'Validator 02', pubkey: '0x8d710f3f863da677d10059183dd6b9e50e445f2f68bde6b8b2c31444819fe35493c0303ae2d7126ef2e7b942c3fae970' },
  { friendly_name: 'Validator 03', pubkey: '0x8b9212fd8dbb5b384df6466ec8c4c7693d2f6596bd13fa7d14a8502a9d99baf9cb082708b426b8a210b76ec162df5102' },
];

function suppliedWatchlist(value: string | string[] | undefined): WatchItem[] {
  if (typeof value !== 'string') return DEFAULT_WATCHLIST;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20) return DEFAULT_WATCHLIST;
    const seen = new Set<string>();
    const items = parsed.map((item, index) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid watchlist item');
      const candidate = item as Record<string, unknown>;
      const pubkey = String(candidate.pubkey || '').toLowerCase();
      const friendly_name = String(candidate.friendly_name || `Validator ${String(index + 1).padStart(2, '0')}`).trim();
      if (!KEY_RE.test(pubkey) || friendly_name.length < 1 || friendly_name.length > 80 || seen.has(pubkey)) throw new Error('Invalid watchlist');
      seen.add(pubkey);
      return { pubkey, friendly_name };
    });
    return items;
  } catch { return DEFAULT_WATCHLIST; }
}

// Vercel Hobby-compatible current-state endpoint. It deliberately has no database,
// scheduler, or secret requirement; every request is a new read-only Beacon lookup.
export default async function handler(req: RequestLike, res: ResponseLike) {
  const watchlist = suppliedWatchlist(req.query.watchlist);
  const startedAt = new Date().toISOString();
  try {
    await verifyMainnet();
    const state = await getState('head');
    const results = await Promise.all(watchlist.map(async item => {
      try {
        const record = await lookup(state.stateRoot, item.pubkey);
        if (record.kind === 'missing') return { ...item, validator_index: null, lifecycle_status: null, balanceEth: null, effectiveBalanceEth: null, credentials: null, withdrawal_credentials: null, slashed: null, activation_epoch: null, exit_epoch: null, withdrawable_epoch: null, observed_at: startedAt, slot: state.slot, source: providerName(), finalized: false, freshness: 'not_found' };
        const v = record.value;
        return { ...item, validator_index: v.index, lifecycle_status: v.status, balanceEth: gweiToEth(v.balanceGwei), effectiveBalanceEth: gweiToEth(v.effectiveBalanceGwei), credentials: credentialInfo(v.withdrawalCredentials), withdrawal_credentials: v.withdrawalCredentials, slashed: v.slashed, activation_epoch: v.activationEpoch, exit_epoch: v.exitEpoch, withdrawable_epoch: v.withdrawableEpoch, observed_at: startedAt, slot: state.slot, source: providerName(), finalized: v.finalized, freshness: 'fresh' };
      } catch (error) {
        return { ...item, validator_index: null, lifecycle_status: null, balanceEth: null, effectiveBalanceEth: null, credentials: null, withdrawal_credentials: null, slashed: null, activation_epoch: null, exit_epoch: null, withdrawable_epoch: null, observed_at: null, slot: state.slot, source: providerName(), finalized: false, freshness: 'failed', lookup_error: error instanceof Error ? error.message : 'Lookup failed' };
      }
    }));
    const found = results.filter(v => v.freshness === 'fresh').length;
    const failed = results.filter(v => v.freshness === 'failed').length;
    return res.status(200).json({ mode: 'live-current', source: providerName(), provider: redactedBase(), fetchedAt: startedAt, run: { started_at: startedAt, outcome: failed ? (found ? 'partial' : 'failed') : found ? 'success' : 'not_found', found_count: found, missing_count: results.length - found - failed, detail: 'Live head-state lookup; no history is stored on Vercel Hobby.' }, validators: results, incidents: [], capabilities: { lifecycle: 'supported', balances: 'supported', credentials: 'supported', slashing: 'supported', duties: 'unsupported', participation: 'unsupported', rewards: 'unsupported', proposals: 'unsupported', withdrawals: 'unsupported', history: 'not stored in Vercel Hobby mode' } });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Beacon lookup failed' });
  }
}
