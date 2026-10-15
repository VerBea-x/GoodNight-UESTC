import test from 'node:test';
import assert from 'node:assert/strict';
import { createUestcAdapter,CLIENT_SESSION_RETENTION_SECONDS } from '../src/adapters/uestc.mjs';

test('successful validation preserves local session credentials across a day-long outage',async()=>{
  const before=Math.floor(Date.now()/1000),writes=[];
  const cookie={name:'SESSION',value:'synthetic-only',domain:'jzsz.uestc.edu.cn',path:'/',expires:before+3600,httpOnly:true,secure:true,sameSite:'Lax'};
  const ctx={request:{fetch:async()=>({status:()=>200,json:async()=>({code:0,ok:true,data:{}})})},cookies:async()=>[cookie],addCookies:async c=>writes.push(c)};
  const adapter=createUestcAdapter(ctx,{});
  await adapter.authenticate();
  assert.equal(writes[0][0].expires>=before+CLIENT_SESSION_RETENTION_SECONDS,true);
  assert.equal(writes[0][0].expires>before+24*3600,true);
  assert.deepEqual({...writes[0][0],expires:cookie.expires},cookie);
  cookie.expires=before+14*24*3600;
  await adapter.authenticate();
  assert.equal(writes[1][0].expires,cookie.expires);
});

test('server rejection and transport errors never extend client retention or become authenticated',async()=>{
  let writes=0;
  const ctx={request:{fetch:async()=>({status:()=>200,json:async()=>({code:5000,ok:false,data:null})})},cookies:async()=>{throw Error('must not read cookies');},addCookies:async()=>{writes++;}};
  const adapter=createUestcAdapter(ctx,{});
  await assert.rejects(adapter.authenticate(),{code:'need_login'});assert.equal(writes,0);
  ctx.request.fetch=async()=>{throw new Error('synthetic TLS failure');};
  await assert.rejects(adapter.authenticate(),{code:'transport_error'});assert.equal(writes,0);
});
