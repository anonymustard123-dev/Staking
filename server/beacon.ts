export const MAINNET_GENESIS_ROOT = '0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95';
export const KEY_RE = /^0x[0-9a-fA-F]{96}$/;
export type BeaconObservation = {
  pubkey: string; index: string; status: string; balanceGwei: string;
  effectiveBalanceGwei: string; withdrawalCredentials: string; slashed: boolean;
  activationEligibilityEpoch: string; activationEpoch: string; exitEpoch: string;
  withdrawableEpoch: string; finalized: boolean; executionOptimistic: boolean;
};
export type Lookup = { kind: 'found'; value: BeaconObservation } | { kind: 'missing' };
const base = () => (process.env.BEACON_API_BASE_URL || 'https://ethereum-beacon-api.publicnode.com').replace(/\/$/, '');
export function providerName() { return new URL(base()).host; }
export function redactedBase() { const u = new URL(base()); return `${u.origin}/…`; }
const safeInteger = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v);
export function parseValidator(json: any, expectedKey: string): BeaconObservation {
  const d = json?.data, v = d?.validator;
  if (!d || !v || !KEY_RE.test(v.pubkey) || v.pubkey.toLowerCase() !== expectedKey.toLowerCase() ||
    !safeInteger(d.index) || !safeInteger(d.balance) || !safeInteger(v.effective_balance) ||
    typeof d.status !== 'string' || typeof v.withdrawal_credentials !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(v.withdrawal_credentials) || typeof v.slashed !== 'boolean' ||
    !['activation_eligibility_epoch','activation_epoch','exit_epoch','withdrawable_epoch'].every(k => safeInteger(v[k])) ||
    typeof json.finalized !== 'boolean' || typeof json.execution_optimistic !== 'boolean') throw new Error('Unexpected validator schema');
  return { pubkey: v.pubkey.toLowerCase(), index: d.index, status: d.status,
    balanceGwei: d.balance, effectiveBalanceGwei: v.effective_balance,
    withdrawalCredentials: v.withdrawal_credentials.toLowerCase(), slashed: v.slashed,
    activationEligibilityEpoch: v.activation_eligibility_epoch, activationEpoch: v.activation_epoch,
    exitEpoch: v.exit_epoch, withdrawableEpoch: v.withdrawable_epoch,
    finalized: json.finalized, executionOptimistic: json.execution_optimistic };
}
export async function beaconGet(path: string): Promise<any> {
  let last: Error = new Error('Unknown provider failure');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(base() + path, { headers: { accept: 'application/json', ...(process.env.BEACON_API_AUTH_HEADER ? { authorization: process.env.BEACON_API_AUTH_HEADER } : {}) }, signal: AbortSignal.timeout(10000) });
      if (r.status === 404) return { missing: true };
      if (r.status === 401 || r.status === 403) throw new Error(`Authentication rejected (${r.status})`);
      if (r.status === 429 || r.status >= 500) {
        const after = Number(r.headers.get('retry-after'));
        last = new Error(`Provider HTTP ${r.status}`);
        if (attempt < 2) { await new Promise(resolve => setTimeout(resolve, Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 15000) : 350 * 2 ** attempt + Math.random() * 300)); continue; }
        throw last;
      }
      if (!r.ok) throw new Error(`Provider HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e instanceof Error ? e : new Error('Provider failure');
      if (attempt < 2 && !/Authentication|Unexpected/.test(last.message)) await new Promise(resolve => setTimeout(resolve, 350 * 2 ** attempt + Math.random() * 300));
      else break;
    }
  }
  throw last;
}
export async function verifyMainnet() {
  const j = await beaconGet('/eth/v1/beacon/genesis');
  if (j?.data?.genesis_validators_root !== MAINNET_GENESIS_ROOT || j?.data?.genesis_time !== '1606824023') throw new Error('Beacon provider is not Ethereum mainnet');
}
export async function getState(stateId: 'head'|'finalized'): Promise<{slot:string;stateRoot:string}> {
  const j = await beaconGet(`/eth/v1/beacon/headers/${stateId}`);
  const slot = j?.data?.header?.message?.slot;
  const stateRoot = j?.data?.header?.message?.state_root;
  if (!safeInteger(slot) || typeof stateRoot !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(stateRoot)) throw new Error(`Invalid ${stateId} header`);
  if (stateId === 'finalized' && j.finalized !== true) throw new Error('Provider did not mark finalized header as finalized');
  return {slot,stateRoot};
}
export async function getSlot(stateId: 'head'|'finalized') { return (await getState(stateId)).slot; }
export async function lookup(stateId: 'head'|'finalized'|string, pubkey: string): Promise<Lookup> {
  if (!KEY_RE.test(pubkey)) throw new Error('Invalid validator public key');
  if (!['head','finalized'].includes(stateId) && !/^0x[0-9a-fA-F]{64}$/.test(stateId)) throw new Error('Invalid state identifier');
  const j = await beaconGet(`/eth/v1/beacon/states/${stateId}/validators/${pubkey}`);
  if (j?.missing) return { kind: 'missing' };
  return { kind: 'found', value: parseValidator(j, pubkey) };
}
export function gweiToEth(value: string | bigint): string {
  const n = BigInt(value); const whole = n / 1000000000n; const fraction = (n % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
export function credentialInfo(credentials: string) {
  const kind = credentials.slice(0, 4);
  return { type: kind === '0x01' ? 'Execution address' : kind === '0x02' ? 'Compounding' : kind === '0x00' ? 'BLS' : 'Unknown', address: kind === '0x01' || kind === '0x02' ? '0x' + credentials.slice(-40) : null };
}
