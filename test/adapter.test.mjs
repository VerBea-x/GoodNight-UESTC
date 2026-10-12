import test from 'node:test';
import assert from 'node:assert/strict';
import { createUestcAdapter, ORIGIN } from '../src/adapters/uestc.mjs';
import { DEFAULTS } from '../src/config.mjs';
function adapter(response,options={}) {
  const calls=[];
  const ctx={request:{fetch:async(url,opts)=>{calls.push({url,opts});if(options.throw)throw new Error('private transport details');return {status:()=>options.status||200,json:async()=>response};}},cookies:async()=>[],addCookies:async()=>{}};
  return {api:createUestcAdapter(ctx,DEFAULTS),calls,ctx};
}
test('adapter fails closed on malformed envelope, auth expiry, redirects and transport errors',async()=>{
  for(const [response,options,code] of [[{}, {},'invalid_api_response'],[null,{},'invalid_api_response'],[{code:0,ok:'true'}, {},'invalid_api_response'],[{code:5000},{},'need_login'],[{code:0},{status:302},'http_error'],[null,{throw:true},'transport_error']]) {
    const {api}=adapter(response,options);await assert.rejects(api.getToday(),e=>e.code===code&&!e.message.includes('private'));
  }
});
test('request uses same authenticated context, fixed school origin and no redirect following',async()=>{
  const {api,calls}=adapter({code:0,data:null});const body={synthetic:'fixture'};
  await api.submit(body);assert.equal(calls[0].url,ORIGIN+'/daily-checkin/api/student-checkin-record/report');
  assert.equal(calls[0].opts.maxRedirects,0);assert.equal(calls[0].opts.headers.platform,'h5');assert.equal(calls[0].opts.data,body);
});
test('local cookie retention changes only the school SESSION after successful auth',async()=>{
  const {api,ctx}=adapter({code:0,ok:true,data:{synthetic:true}});let added;
  ctx.cookies=async()=>[{name:'SESSION',domain:'jzsz.uestc.edu.cn',value:'synthetic-not-a-token',path:'/',expires:-1}];
  ctx.addCookies=async cookies=>{added=cookies;};
  await api.authenticate();assert.equal(added.length,1);assert.ok(added[0].expires>Date.now()/1000);assert.equal(added[0].name,'SESSION');
});
test('adapter ignores stale alias configuration and resolves the observed location call',async()=>{
  const entryUrl=ORIGIN+'/daily-checkin-h5/assets/index-test.js';
  const entry='const old=()=>{},gps=()=>{};const route="./pages-student-report-today-home-index.test.js";export{old as bk,gps as bl};';
  const student='import{bl as W}from"./index-test.js";W({type:"gcj02",success(x){},fail(e){}});';
  let calls=0,binding,closed=false,permissions=false;
  const ctx={grantPermissions:async()=>{permissions=true;},newPage:async()=>page,request:{get:async url=>({status:()=>200,url:()=>url,text:async()=>url===entryUrl?entry:student,dispose:async()=>{}})}};
  const page={url:()=>ORIGIN+'/daily-checkin-h5/index.html?appId=294',context:()=>ctx,goto:async()=>{assert.equal(permissions,true);},close:async()=>{closed=true;},evaluate:async(_fn,arg)=>{
    if(arg){binding=arg.binding;return {latitude:10,longitude:10,accuracy:20};}return ++calls===1?false:entryUrl;
  }};
  const r=await createUestcAdapter(ctx,{...DEFAULTS,frontendLocationExport:'bk'}).getLocation();
  assert.equal(binding.exportName,'bl');assert.equal(r.accuracy,20);assert.equal(closed,true);
});
