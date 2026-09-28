import React, { useEffect, useMemo, useState } from 'react';
import './monitor.css';
import './detail.css';
import './beacon.css';

type Watch = { name: string; pubkey: string; group: 'Your fleet' | 'Demo validators' };
type Validator = Watch & { index: string | null; status: string | null; balance: string | null; effective: string | null; credentials: string | null; slashed: boolean | null; observedAt: string | null; freshness: 'fresh' | 'not_found' | 'failed' | 'loading' };
type Duty = { index: string; slot: string; committeeIndex: string; kind: 'attestation' | 'sync' };
type Chain = { slot: number; epoch: number; finalizedEpoch: number | null; duties: Record<string, Duty[]>; source: string };
type Snapshot = { at: string; balance: number; effective: number; active: number; finalizedEpoch: number | null; balances: Record<string, number> };

const BASE = 'https://ethereum-beacon-api.publicnode.com';
const ROOT = '0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95';
const HISTORY_KEY = 'bny-beacon-snapshot-history-v1';
const WATCHLIST: Watch[] = [
  { name: 'Validator 01', group: 'Your fleet', pubkey: '0x85c959e693d62a09f2b812b262b3666f22de507f308e3e8afed013aff1c3eebbf8a1605f724cc095a19bcb6fe856f19a' },
  { name: 'Validator 02', group: 'Your fleet', pubkey: '0x8d710f3f863da677d10059183dd6b9e50e445f2f68bde6b8b2c31444819fe35493c0303ae2d7126ef2e7b942c3fae970' },
  { name: 'Validator 03', group: 'Your fleet', pubkey: '0x8b9212fd8dbb5b384df6466ec8c4c7693d2f6596bd13fa7d14a8502a9d99baf9cb082708b426b8a210b76ec162df5102' },
  { name: 'Demo validator 01', group: 'Demo validators', pubkey: '0x933ad9491b62059dd065b560d256d8957a8c402cc6e8d8ee7290ae11e8f7329267a8811c397529dac52ae1342ba58c95' },
  { name: 'Demo validator 02', group: 'Demo validators', pubkey: '0xa1d1ad0714035353258038e964ae9675dc0252ee22cea896825c01458e1807bfad2f9969338798548d9858a571f7425c' },
  { name: 'Demo validator 03', group: 'Demo validators', pubkey: '0xb2ff4716ed345b05dd1dfc6a5a9fa70856d8c75dcc9e881dd2f766d5f891326f0d10e96f3a444ce6c912b69c22c6754d' },
];

const empty = (watch: Watch, freshness: Validator['freshness']): Validator => ({ ...watch, index: null, status: freshness === 'loading' ? 'Loading live data' : null, balance: null, effective: null, credentials: null, slashed: null, observedAt: null, freshness });
const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-8)}`;
const numeric = (value: unknown) => typeof value === 'number' ? value : Number(value || 0);
const eth = (value: string | null) => value === null ? '—' : `${numeric(value).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`;
const timestamp = (value: string | null) => value ? new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—';
const gwei = (value: string) => { const raw = BigInt(value); const whole = raw / 1000000000n; const fraction = (raw % 1000000000n).toString().padStart(9, '0').replace(/0+$/, ''); return fraction ? `${whole}.${fraction}` : whole.toString(); };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(BASE + path, { ...init, headers: { accept: 'application/json', ...(init?.headers || {}) }, signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Beacon API returned HTTP ${response.status}`);
  return response.json();
}
async function duties(kind: 'attester' | 'sync', epoch: number, indices: string[]) {
  if (!indices.length) return [] as Duty[];
  const result = await request(`/eth/v1/validator/duties/${kind}/${epoch}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(indices) });
  return (result?.data || []).map((item: Record<string, unknown>) => ({ index: String(item.validator_index), slot: String(item.slot), committeeIndex: String(item.committee_index || ''), kind: kind === 'attester' ? 'attestation' : 'sync' }));
}
async function readBeacon(watch: Watch[]): Promise<{ rows: Validator[]; chain: Chain }> {
  const genesis = await request('/eth/v1/beacon/genesis');
  if (genesis?.data?.genesis_validators_root !== ROOT) throw new Error('Beacon provider did not verify as Ethereum mainnet');
  const header = await request('/eth/v1/beacon/headers/head');
  const slot = numeric(header?.data?.header?.message?.slot), root = header?.data?.header?.message?.state_root;
  if (!slot || typeof root !== 'string') throw new Error('Beacon provider returned no head state');
  const observedAt = new Date().toISOString();
  const rows = await Promise.all(watch.map(async item => {
    try {
      const response = await request(`/eth/v1/beacon/states/${root}/validators/${item.pubkey}`);
      if (!response) return { ...empty(item, 'not_found'), observedAt };
      const data = response.data, validator = data?.validator;
      if (!validator) throw new Error('Unexpected validator response');
      return { ...item, index: String(data.index), status: String(data.status), balance: gwei(String(data.balance)), effective: gwei(String(validator.effective_balance)), credentials: String(validator.withdrawal_credentials), slashed: Boolean(validator.slashed), observedAt, freshness: 'fresh' as const };
    } catch { return empty(item, 'failed'); }
  }));
  const indices = rows.flatMap(row => row.index ? [row.index] : []);
  const epoch = Math.floor(slot / 32);
  const [finality, attester, nextAttester, sync] = await Promise.all([
    request('/eth/v1/beacon/states/head/finality_checkpoints'),
    duties('attester', epoch, indices), duties('attester', epoch + 1, indices), duties('sync', epoch, indices),
  ]);
  const byIndex: Record<string, Duty[]> = {};
  for (const duty of [...attester, ...nextAttester, ...sync]) (byIndex[duty.index] ||= []).push(duty);
  return { rows, chain: { slot, epoch, finalizedEpoch: finality?.data?.finalized?.epoch ? numeric(finality.data.finalized.epoch) : null, duties: byIndex, source: 'PublicNode Beacon API' } };
}

function readHistory(): Snapshot[] { try { const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
function saveHistory(rows: Validator[], chain: Chain) {
  const snapshot: Snapshot = { at: new Date().toISOString(), balance: rows.reduce((sum, row) => sum + numeric(row.balance), 0), effective: rows.reduce((sum, row) => sum + numeric(row.effective), 0), active: rows.filter(row => row.status?.startsWith('active')).length, finalizedEpoch: chain.finalizedEpoch, balances: Object.fromEntries(rows.map(row => [row.pubkey, numeric(row.balance)])) };
  const prior = readHistory(); const newest = prior.at(-1);
  const history = newest && Date.now() - new Date(newest.at).getTime() < 10 * 60_000 ? [...prior.slice(0, -1), snapshot] : [...prior, snapshot];
  const retained = history.slice(-288); localStorage.setItem(HISTORY_KEY, JSON.stringify(retained)); return retained;
}

function Metric({ label, value, note, tone = 'cyan' }: { label: string; value: string; note: string; tone?: string }) { return <article className={`rm-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="rm-empty">Collecting the first two local snapshots for {label.toLowerCase()}.</div>;
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${88 - ((value - low) / span) * 70}`).join(' ');
  return <div className="rm-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${label} history`}><polyline points={points} /></svg><div><span>{low.toFixed(4)} ETH</span><b>{high.toFixed(4)} ETH</b></div></div>;
}
function DutyList({ duties }: { duties: Duty[]; row?: Validator }) { return <div className="rm-duty-list">{duties.length ? duties.map((duty, index) => <div key={`${duty.kind}-${duty.slot}-${index}`}><b>{duty.kind === 'sync' ? 'Sync committee' : 'Attestation'}</b><span>Slot {duty.slot}{duty.committeeIndex ? ` · Committee ${duty.committeeIndex}` : ''}</span></div>) : <span className="rm-muted">No current or next-epoch duties returned for this validator.</span>}</div>; }

export default function Dashboard() {
  const [page, setPage] = useState('Overview'); const [rows, setRows] = useState<Validator[]>(() => WATCHLIST.map(item => empty(item, 'loading'))); const [chain, setChain] = useState<Chain | null>(null); const [history, setHistory] = useState<Snapshot[]>(() => typeof window === 'undefined' ? [] : readHistory()); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Validator | null>(null);
  const load = async () => { setLoading(true); try { const live = await readBeacon(WATCHLIST); setRows(live.rows); setChain(live.chain); setHistory(saveHistory(live.rows, live.chain)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Live data could not be loaded'); } finally { setLoading(false); } };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 120000); return () => window.clearInterval(timer); }, []);
  const active = rows.filter(row => row.status?.startsWith('active')); const found = rows.filter(row => row.freshness === 'fresh'); const total = rows.reduce((sum, row) => sum + numeric(row.balance), 0); const effective = rows.reduce((sum, row) => sum + numeric(row.effective), 0); const userRows = rows.filter(row => row.group === 'Your fleet'), demoRows = rows.filter(row => row.group === 'Demo validators'); const currentDuties = chain ? Object.values(chain.duties).flat().filter(duty => numeric(duty.slot) >= chain.slot).length : 0;
  const fleetTable = (items: Validator[]) => <div className="rm-table"><div className="rm-tr rm-head"><span>Validator</span><span>Index</span><span>Status</span><span>Balance</span><span>Next duty</span><span>Freshness</span></div>{items.map(row => { const duty = row.index ? chain?.duties[row.index]?.find(item => numeric(item.slot) >= (chain?.slot || 0)) : undefined; return <button className="rm-tr" key={row.pubkey} onClick={() => setSelected(row)}><span><b>{row.name}</b><small>{short(row.pubkey)}</small></span><span>{row.index || '—'}</span><span><i className={row.status?.startsWith('active') ? 'good' : 'muted'}>{row.status?.replaceAll('_', ' ') || 'Pending recognition'}</i></span><span>{eth(row.balance)}</span><span>{duty ? `${duty.kind} · ${duty.slot}` : '—'}</span><span className={row.freshness}>{row.freshness.replaceAll('_', ' ')}</span></button>; })}</div>;
  const selectedDuties = selected?.index ? chain?.duties[selected.index] || [] : [];
  return <div className="rm-app"><aside className="rm-side"><div className="rm-logo"><img src="/bny-logo.svg" alt="BNY"/><small>DIGITAL ASSET CUSTODY</small></div><div className="rm-product">STAKING MONITOR <span>ETHEREUM MAINNET</span></div><nav>{['Overview', 'Validators', 'Operations', 'Data sources'].map(item => <button className={page === item ? 'active' : ''} key={item} onClick={() => { setPage(item); setSelected(null); }}><span>{item === 'Overview' ? '◇' : item === 'Validators' ? '▦' : item === 'Operations' ? '⚑' : '◎'}</span>{item}</button>)}</nav><div className="rm-foot">FREE BEACON MONITOR<br/>Local historical snapshots</div></aside><main className="rm-main"><header className="rm-top"><div><small>Digital Asset Custody / Staking</small><strong>{selected ? 'Validator detail' : page}</strong></div><div><span className={error ? 'rm-source down' : 'rm-source'}>{error ? 'SOURCE DEGRADED' : 'LIVE MAINNET'}</span><button onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : '↻ Refresh live data'}</button></div></header><section className="rm-content">{error && <div className="rm-alert"><b>Live data needs attention</b><span>{error}</span></div>}{page === 'Overview' && <><div className="rm-title"><p>VALIDATOR OPERATIONS</p><h1>Fleet command center</h1><span>Free live consensus state, duties and local history from the Ethereum Beacon API.</span></div><div className="rm-metrics"><Metric label="Observed consensus balance" value={`${total.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`} note={`${found.length} of ${rows.length} validators resolved`} /><Metric label="Effective balance" value={`${effective.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`} note="Protocol weight across resolved validators" /><Metric label="Fleet lifecycle" value={`${active.length} active`} note={`${rows.filter(row => row.freshness === 'not_found').length} awaiting recognition`} tone="green" /><Metric label="Upcoming duties" value={chain ? String(currentDuties) : '—'} note={chain ? `Epoch ${chain.epoch} · slot ${chain.slot.toLocaleString()}` : 'Reading Beacon API'} tone="gold" /></div><div className="rm-grid"><section className="rm-panel rm-wide"><div className="rm-panel-title"><div><p>LOCAL HISTORY</p><h2>Consensus balance trend</h2></div><span>{history.length} snapshots · retained in this browser</span></div><Sparkline label="fleet consensus balance" values={history.map(item => item.balance)} /><small className="rm-muted">Snapshots are saved every live refresh (at least 10 minutes apart). This chart grows from real reads; it does not invent historical data.</small></section><section className="rm-panel"><p>CHAIN HEALTH</p><h2>Finality & duty posture</h2><div className="rm-state"><b>{chain?.finalizedEpoch ?? '—'}</b><span>last finalized epoch</span></div><div className="rm-state"><b>{currentDuties}</b><span>current / next duties</span></div><div className="rm-state"><b>{rows.filter(row => row.slashed).length}</b><span>slashed validators</span></div><small className="rm-muted">Last Beacon read: {timestamp(found[0]?.observedAt || null)}</small></section></div><section className="rm-panel"><div className="rm-panel-title"><div><p>FLEET WATCHLIST</p><h2>Live validator state</h2></div><button className="rm-link" onClick={() => setPage('Validators')}>Open validator register →</button></div>{fleetTable(rows)}</section></>}{page === 'Validators' && <><div className="rm-title"><p>VALIDATOR REGISTER</p><h1>Fleet inventory</h1><span>Your pending validators remain distinct from the public live-data reference set.</span></div><section className="rm-panel"><div className="rm-panel-title"><div><p>YOUR FLEET</p><h2>Custody watchlist</h2></div><span>{userRows.length} validators</span></div>{fleetTable(userRows)}</section><section className="rm-panel"><div className="rm-panel-title"><div><p>DEMO VALIDATORS</p><h2>Public mainnet reference set</h2></div><span>Real live Beacon data</span></div>{fleetTable(demoRows)}</section></>}{page === 'Operations' && <><div className="rm-title"><p>OPERATIONS</p><h1>Exceptions and controls</h1><span>Beacon-native visibility without a paid performance indexer.</span></div><div className="rm-grid"><section className="rm-panel"><p>EXCEPTIONS</p><h2>Current signals</h2><div className="rm-empty">{rows.some(row => row.freshness === 'failed') ? 'A Beacon lookup failed. Use Refresh live data to retry.' : rows.some(row => row.slashed) ? 'A slashing signal is present. Open the validator record for chain details.' : 'No Beacon API failures or slashing events are currently detected.'}</div></section><section className="rm-panel"><p>FREE COVERAGE</p><h2>What is available now</h2><div className="rm-empty">Lifecycle, balances, finality, withdrawal credentials, slashing status and scheduled attestation or sync duties are read live. Historical reward and inclusion-quality analytics require an indexed provider or a collector with durable storage.</div></section></div></>}{page === 'Data sources' && <><div className="rm-title"><p>DATA GOVERNANCE</p><h1>Sources and coverage</h1><span>Metrics identify the free protocol source and the limits of its coverage.</span></div><div className="rm-grid"><section className="rm-panel"><p>CONSENSUS & DUTIES</p><h2>PublicNode Beacon API</h2><dl><dt>Coverage</dt><dd>Lifecycle, balances, credentials, slashing, finality and duties</dd><dt>Read mode</dt><dd>Browser live read every two minutes and on refresh</dd><dt>Status</dt><dd><i className={error ? 'bad' : 'good'}>{error ? 'Degraded' : 'Healthy'}</i></dd></dl></section><section className="rm-panel"><p>LOCAL HISTORY</p><h2>Browser snapshot store</h2><dl><dt>Coverage</dt><dd>Fleet and per-validator balance history from live reads</dd><dt>Retention</dt><dd>288 snapshots in this browser</dd><dt>Limit</dt><dd>History is not shared between browsers or devices</dd></dl></section></div></>}{selected && <section className="rm-drawer"><button onClick={() => setSelected(null)}>×</button><p>VALIDATOR DETAIL</p><h2>{selected.name}</h2><code>{selected.pubkey}</code><div className="rm-detail-grid"><span>Index<b>{selected.index || 'Awaiting recognition'}</b></span><span>Lifecycle<b>{selected.status?.replaceAll('_', ' ') || 'Not found'}</b></span><span>Consensus balance<b>{eth(selected.balance)}</b></span><span>Effective balance<b>{eth(selected.effective)}</b></span><span>Slashed<b>{selected.slashed === null ? 'Unknown' : selected.slashed ? 'Yes' : 'No'}</b></span><span>Finalized epoch<b>{chain?.finalizedEpoch ?? 'Unavailable'}</b></span></div><section className="rm-detail-section"><p>UPCOMING DUTIES</p><h2>Beacon schedule</h2><DutyList row={selected} duties={selectedDuties} /></section><section className="rm-detail-section"><p>LOCAL BALANCE HISTORY</p><h2>Observed consensus balance</h2><Sparkline label={selected.name} values={history.map(item => item.balances[selected.pubkey] || 0).filter(Boolean)} /></section></section>}</section></main></div>;
}
