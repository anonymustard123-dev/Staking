import { getSlot, lookup, providerName, redactedBase, verifyMainnet } from './beacon.ts';
import { pool } from './db.ts';
import { readFile } from 'node:fs/promises';
const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
const keys = [...sql.matchAll(/'0x[0-9a-f]{96}'/g)].map(x => x[0].slice(1,-1));
console.log(`Provider: ${providerName()} (${redactedBase()})`);
try { await pool.query('SELECT 1'); console.log('Database: reachable'); } catch { console.log('Database: unavailable; run docker compose up -d and npm run migrate'); }
try {
  await verifyMainnet(); console.log('Network: Ethereum mainnet genesis verified');
  for (const state of ['finalized','head'] as const) {
    try { console.log(`${state} slot: ${await getSlot(state)}`); } catch (e) { console.log(`${state} header: ${e instanceof Error ? e.message : 'failed'}`); }
  }
  for (let i=0;i<keys.length;i++) {
    try { const r=await lookup('head',keys[i]); console.log(`Validator ${String(i+1).padStart(2,'0')}: ${r.kind === 'missing' ? 'not found' : `index ${r.value.index}, ${r.value.status}, schema valid`}`); }
    catch(e) { console.log(`Validator ${String(i+1).padStart(2,'0')}: ${e instanceof Error ? e.message : 'lookup failed'}`); }
  }
} catch(e) { console.log(`Provider: ${e instanceof Error ? e.message : 'failed'}`); }
console.log('Capabilities: lifecycle/balance/credentials/slashing available when validator found; observed duties, rewards, proposals, withdrawals and archive history unsupported by this adapter.');
await pool.end();
