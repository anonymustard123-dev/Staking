import { pool } from './db.ts';
import { getState, lookup, providerName, verifyMainnet } from './beacon.ts';
const interval = Math.max(60000, Number(process.env.POLL_INTERVAL_MS || 120000));
let running = false;
export async function collectOnce() {
  if (running) return { outcome: 'busy' };
  running = true;
  let client;
  try { client = await pool.connect(); } catch (e) { running = false; throw e; }
  let lock = false;
  try {
    lock = (await client.query('SELECT pg_try_advisory_lock(944281) AS locked')).rows[0].locked;
    if (!lock) return { outcome: 'busy' };
    const source = providerName();
    const last = await client.query('SELECT finished_at FROM collection_runs WHERE source=$1 AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1',[source]);
    if (last.rows[0] && Date.now()-new Date(last.rows[0].finished_at).getTime()>interval*2) await client.query('INSERT INTO collection_gaps(start_at,end_at,source,reason) VALUES($1,now(),$2,$3) ON CONFLICT DO NOTHING',[last.rows[0].finished_at,source,'Collector absent beyond two polling intervals; Beacon state history not backfilled']);
    const run = await client.query('INSERT INTO collection_runs(source,outcome) VALUES($1,$2) RETURNING id', [source, 'running']);
    const runId = run.rows[0].id;
    let found = 0, missing = 0; const failures: string[] = [];
    try {
      await verifyMainnet();
      const keys = (await client.query('SELECT pubkey FROM watchlist ORDER BY created_at')).rows.map(r => r.pubkey as string);
      for (const state of ['finalized', 'head'] as const) {
        const {slot,stateRoot} = await getState(state);
        for (const key of keys) {
          try {
            const result = await lookup(stateRoot, key);
            if (result.kind === 'missing') { missing++; continue; }
            const v = result.value;
            if (state === 'finalized' && !v.finalized) throw new Error('Provider did not mark finalized response as finalized');
            await client.query(`INSERT INTO observations(pubkey,source,state_id,observed_at,slot,epoch,finalized,execution_optimistic,validator_index,lifecycle_status,balance_gwei,effective_balance_gwei,withdrawal_credentials,slashed,activation_eligibility_epoch,activation_epoch,exit_epoch,withdrawable_epoch)
              VALUES($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
              ON CONFLICT(pubkey,source,state_id,slot) DO UPDATE SET observed_at=excluded.observed_at,finalized=excluded.finalized,execution_optimistic=excluded.execution_optimistic,balance_gwei=excluded.balance_gwei,effective_balance_gwei=excluded.effective_balance_gwei,lifecycle_status=excluded.lifecycle_status,slashed=excluded.slashed`,
              [key,source,state,slot,(BigInt(slot)/32n).toString(),v.finalized,v.executionOptimistic,v.index,v.status,v.balanceGwei,v.effectiveBalanceGwei,v.withdrawalCredentials,v.slashed,v.activationEligibilityEpoch,v.activationEpoch,v.exitEpoch,v.withdrawableEpoch]);
            found++;
            if (v.slashed) await upsertIncident(client, `slashing:${key}`, key, 'critical', 'Observed slashing', `${state} Beacon state reports slashed=true.`, `slot ${slot}; ${source}`);
            if (state === 'finalized') {
              const configured = await client.query('SELECT approved_destination FROM watchlist WHERE pubkey=$1',[key]);
              const approved = configured.rows[0]?.approved_destination as string|null;
              const actual = ['0x01','0x02'].includes(v.withdrawalCredentials.slice(0,4)) ? '0x'+v.withdrawalCredentials.slice(-40) : null;
              if (approved && actual && actual !== approved) await upsertIncident(client,`destination:${key}`,key,'critical','Withdrawal destination mismatch',`Observed ${actual}; approved ${approved}. Review configuration and chain evidence.`,`finalized slot ${slot}; ${source}`);
              else if (approved && actual) await client.query('UPDATE incidents SET resolved_at=now() WHERE incident_key=$1 AND resolved_at IS NULL',[`destination:${key}`]);
              const previous = await client.query("SELECT lifecycle_status FROM observations WHERE pubkey=$1 AND state_id='finalized' AND slot<$2 ORDER BY slot DESC LIMIT 1",[key,slot]);
              if (previous.rows[0] && previous.rows[0].lifecycle_status !== v.status) await upsertIncident(client, `lifecycle:${key}:${v.status}`, key, 'info', 'Lifecycle changed', `${previous.rows[0].lifecycle_status} → ${v.status}`, `finalized slot ${slot}; ${source}`);
            }
          } catch (e) { failures.push(`${key.slice(0,10)}… ${state}: ${e instanceof Error ? e.message : 'lookup failed'}`); }
        }
      }
    } catch (e) { failures.push(e instanceof Error ? e.message : 'Collection failed'); }
    const outcome = failures.length ? (found ? 'partial' : 'failed') : missing ? 'not_found' : 'success';
    await client.query('UPDATE collection_runs SET finished_at=now(),outcome=$2,detail=$3,found_count=$4,missing_count=$5 WHERE id=$1',[runId,outcome,failures.join('; ').slice(0,1000) || null,found,missing]);
    if (outcome === 'failed' || outcome === 'partial') await upsertIncident(client,'feed:beacon',null,'warning','Beacon data feed issue',failures.join('; ').slice(0,500),'Collection run '+runId);
    else await client.query("UPDATE incidents SET resolved_at=now() WHERE incident_key='feed:beacon' AND resolved_at IS NULL");
    const staleMs = Math.max(60000,Number(process.env.STALE_AFTER_MS||600000));
    const latest = await client.query('SELECT max(observed_at) AS at FROM observations WHERE source=$1',[source]);
    const at=latest.rows[0]?.at;
    if (at && Date.now()-new Date(at).getTime()>staleMs) await upsertIncident(client,'feed:stale',null,'warning','Saved Beacon data is stale',`No new validator observation for more than ${Math.round(staleMs/60000)} minutes. Check collector and source.`,`Last observation ${new Date(at).toISOString()}`);
    else if (at) await client.query("UPDATE incidents SET resolved_at=now() WHERE incident_key='feed:stale' AND resolved_at IS NULL");
    return { outcome, found, missing, failures };
  } finally { if (lock) await client.query('SELECT pg_advisory_unlock(944281)'); client.release(); running = false; }
}
async function upsertIncident(client: any, key: string, pubkey: string|null, severity: string, title: string, detail: string, evidence: string) {
  await client.query(`INSERT INTO incidents(incident_key,pubkey,severity,title,detail,evidence) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(incident_key) DO UPDATE SET last_observed_at=now(),detail=excluded.detail,evidence=excluded.evidence,resolved_at=NULL`,[key,pubkey,severity,title,detail,evidence]);
}
if (process.argv[1]?.replace(/\\/g,'/').endsWith('/collector.ts')) {
  const tick = async () => { try { console.log(new Date().toISOString(), await collectOnce()); } catch (e) { console.error(new Date().toISOString(), e instanceof Error ? e.message : 'Collection failed'); } };
  await tick(); setInterval(tick, interval);
}
