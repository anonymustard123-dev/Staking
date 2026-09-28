import test from 'node:test';
import assert from 'node:assert/strict';
import { beaconGet, credentialInfo, gweiToEth, parseValidator } from './beacon.ts';
const key='0x'+'12'.repeat(48);
const fixture={finalized:true,execution_optimistic:false,data:{index:'123',status:'active_ongoing',balance:'32123456789',validator:{pubkey:key,effective_balance:'32000000000',withdrawal_credentials:'0x01'+'00'.repeat(11)+'ab'.repeat(20),slashed:false,activation_eligibility_epoch:'2',activation_epoch:'3',exit_epoch:'18446744073709551615',withdrawable_epoch:'18446744073709551615'}}};
test('parses verified identity and exact Gwei units',()=>{
 const v=parseValidator(fixture,key);
 assert.equal(v.index,'123');assert.equal(gweiToEth(v.balanceGwei),'32.123456789');
 assert.deepEqual(credentialInfo(v.withdrawalCredentials),{type:'Execution address',address:'0x'+'ab'.repeat(20)});
 assert.equal(gweiToEth('32000000000'),'32');
});
test('rejects wrong public key or malformed provider numbers',()=>{
 assert.throws(()=>parseValidator(fixture,'0x'+'34'.repeat(48)));
 assert.throws(()=>parseValidator({...fixture,data:{...fixture.data,balance:32.1}},key));
});
test('returns explicit missing lookup',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('{"code":404}',{status:404});
 try{assert.deepEqual(await beaconGet('/missing'),{missing:true})}finally{globalThis.fetch=old}
});
test('rejects authentication failure without retry',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:401})};
 try{await assert.rejects(beaconGet('/auth'),/Authentication rejected/);assert.equal(calls,1)}finally{globalThis.fetch=old}
});
test('retries rate limit and preserves final response',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return calls===1?new Response('',{status:429}):Response.json({data:'ok'})};
 try{assert.deepEqual(await beaconGet('/rate'),{data:'ok'});assert.equal(calls,2)}finally{globalThis.fetch=old}
});
