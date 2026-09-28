import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from './db.ts';
import { collectOnce } from './collector.ts';
import { credentialInfo, gweiToEth, KEY_RE, providerName, redactedBase } from './beacon.ts';
const app = express(); app.use(express.json({ limit: '20kb' }));
let lastRefresh = 0;
const fail = (res: express.Response, e: unknown) => res.status(500).json({ error: e instanceof Error ? e.message.replace(/https?:\/\/\S+/g,'[provider]') : 'Server error' });
app.get('/api/snapshot', async (_req,res) => {
  try {
    const [watch, runs, incidents, gaps] = await Promise.all([
      pool.query(`SELECT w.pubkey,w.friendly_name,w.approved_destination,
       o.validator_index,o.lifecycle_status,o.balance_gwei::text,o.effective_balance_gwei::text,o.withdrawal_credentials,o.slashed,
       o.activation_eligibility_epoch,o.activation_epoch,o.exit_epoch,o.withdrawable_epoch,
       o.observed_at,o.slot,o.epoch,o.source,o.finalized,o.execution_optimistic
       FROM watchlist w LEFT JOIN LATERAL (SELECT * FROM observations WHERE pubkey=w.pubkey ORDER BY observed_at DESC, finalized DESC LIMIT 1) o ON true ORDER BY w.created_at`),
      pool.query('SELECT started_at,finished_at,outcome,detail,found_count,missing_count FROM collection_runs ORDER BY id DESC LIMIT 1'),
      pool.query('SELECT id,incident_key,pubkey,severity,title,detail,evidence,first_observed_at,last_observed_at,acknowledged_at,note,resolved_at FROM incidents ORDER BY resolved_at NULLS FIRST,last_observed_at DESC LIMIT 50'),
      pool.query('SELECT start_at,end_at,reason FROM collection_gaps ORDER BY id DESC LIMIT 10')
    ]);
    res.json({ mode:'live', source:providerName(), provider:redactedBase(), fetchedAt:new Date().toISOString(), run:runs.rows[0]||null,
      validators:watch.rows.map(v=>({ ...v, balanceEth:v.balance_gwei == null ? null : gweiToEth(v.balance_gwei), effectiveBalanceEth:v.effective_balance_gwei == null ? null : gweiToEth(v.effective_balance_gwei), credentials:v.withdrawal_credentials ? credentialInfo(v.withdrawal_credentials) : null, freshness:v.observed_at ? Date.now()-new Date(v.observed_at).getTime()>Math.max(60000,Number(process.env.STALE_AFTER_MS||600000)) ? 'stale' : 'fresh' : 'no_observations' })),
      incidents:incidents.rows, gaps:gaps.rows, capabilities:{ lifecycle:'supported', balances:'supported', credentials:'supported', slashing:'supported', duties:'unsupported', participation:'unsupported', rewards:'unsupported', proposals:'unsupported', withdrawals:'unsupported', history:'collected_since_first_observation' } });
  } catch(e) { fail(res,e); }
});
app.get('/api/history/:pubkey', async (req,res) => {
  if (!KEY_RE.test(req.params.pubkey)) return res.status(400).json({error:'Invalid public key'});
  try { const rows=await pool.query("SELECT observed_at,slot,balance_gwei::text,effective_balance_gwei::text,finalized,source FROM observations WHERE pubkey=$1 AND state_id='finalized' ORDER BY observed_at DESC LIMIT 500",[req.params.pubkey.toLowerCase()]);
    res.json(rows.rows.reverse().map(r=>({...r,balanceEth:gweiToEth(r.balance_gwei),effectiveBalanceEth:gweiToEth(r.effective_balance_gwei)})));
  } catch(e) { fail(res,e); }
});
app.post('/api/watchlist', async(req,res)=>{
  const key=String(req.body.pubkey||'').toLowerCase(), name=String(req.body.friendlyName||'').trim();
  if(!KEY_RE.test(key)||name.length<1||name.length>80) return res.status(400).json({error:'Enter a 48-byte public key and a name of 1–80 characters.'});
  try { await pool.query('INSERT INTO watchlist(pubkey,friendly_name) VALUES($1,$2)',[key,name]); res.status(201).json({ok:true}); }
  catch(e:any) { if(e.code==='23505') res.status(409).json({error:'Validator already watched'}); else fail(res,e); }
});
app.patch('/api/watchlist/:pubkey', async(req,res)=>{
  if(!KEY_RE.test(req.params.pubkey)) return res.status(400).json({error:'Invalid public key'});
  const name=req.body.friendlyName===undefined?null:String(req.body.friendlyName).trim();
  const destination=req.body.approvedDestination===undefined?undefined:String(req.body.approvedDestination).toLowerCase().trim();
  if(name!==null&&(name.length<1||name.length>80)) return res.status(400).json({error:'Name must be 1–80 characters'});
  if(destination!==undefined&&destination!==''&&!/^0x[0-9a-f]{40}$/.test(destination)) return res.status(400).json({error:'Destination must be a 20-byte Ethereum address'});
  if(name===null&&destination===undefined) return res.status(400).json({error:'No update supplied'});
  try { const r=await pool.query('UPDATE watchlist SET friendly_name=COALESCE($2,friendly_name), approved_destination=CASE WHEN $3::boolean THEN $4 ELSE approved_destination END WHERE pubkey=$1 RETURNING pubkey',[req.params.pubkey.toLowerCase(),name,destination!==undefined,destination||null]); res.status(r.rowCount?200:404).json({ok:!!r.rowCount}); } catch(e) { fail(res,e); }
});
app.post('/api/refresh', async(_req,res)=>{
  if(Date.now()-lastRefresh<60000) return res.status(429).json({error:'Refresh available once per minute'});
  lastRefresh=Date.now();
  try { const result=await collectOnce(); res.json(result); } catch(e) { fail(res,e); }
});
app.patch('/api/incidents/:id',async(req,res)=>{
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)) return res.status(400).json({error:'Invalid incident ID'});
  const note=String(req.body.note||'').slice(0,1000);
  try { const r=await pool.query('UPDATE incidents SET acknowledged_at=now(),note=$2 WHERE id=$1 RETURNING id',[id,note]); res.status(r.rowCount?200:404).json({ok:!!r.rowCount}); } catch(e) { fail(res,e); }
});
const built = resolve('dist');
if (existsSync(built)) { app.use(express.static(built)); app.get('/{*path}',(_req,res)=>res.sendFile(resolve(built,'index.html'))); }
app.listen(Number(process.env.PORT||3001),'127.0.0.1',()=>console.log(`Staking preview on http://127.0.0.1:${process.env.PORT||3001}`));
