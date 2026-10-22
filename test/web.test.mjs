import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startWeb } from '../src/web.mjs';
import { Store } from '../src/store.mjs';
import { DEFAULTS, loadConfig } from '../src/config.mjs';

async function setup(t,options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goodnight-web-'));
  const app=await startWeb({dataDir:dir,port:0,schedule:false,...options});
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  const state=await (await fetch(app.url+'/api/state')).json();
  const request=async(url,method='GET',data,headers={})=>{
    const response=await fetch(app.url+url,{method,headers:{'Content-Type':'application/json','X-GoodNight-Token':state.token,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:response.status,data:await response.json()};
  };
  return {app,dir,request,state};
}
test('web setup works without init and preserves isolated account configuration across restarts',async t=>{
  const f=await setup(t);assert.equal(f.state.accounts.length,0);
  const first=await f.request('/api/accounts','POST',{name:'学校账号一',config:{locationMode:'virtual',virtualLocation:{latitude:30,longitude:104,accuracy:20},reportTime:'21:00',recoveryCutoff:'23:00'}});
  assert.equal(first.status,201);assert.equal(first.data.enabled,false);
  assert.equal(first.data.config.catchUpMinutes,120);
  const second=await f.request('/api/accounts','POST',{name:'学校账号二',config:{}});
  assert.equal(second.status,201);assert.notEqual(first.data.id,second.data.id);
  const updated=await f.request(`/api/accounts/${first.data.id}`,'PUT',{name:'新名称',config:{reportTime:'22:00'}});
  assert.equal(updated.status,200);assert.equal(updated.data.config.reportTime,'22:00');
  assert.equal(loadConfig(path.join(f.dir,'accounts',second.data.id)).reportTime,DEFAULTS.reportTime);
  await f.app.close();
  const restarted=await startWeb({dataDir:f.dir,port:0,schedule:false});t.after(()=>restarted.close());
  const state=await (await fetch(restarted.url+'/api/state')).json();assert.equal(state.accounts.length,2);assert.equal(state.accounts[0].name,'新名称');
});
test('web rejects cross-origin writes, forged hosts, missing tokens and unsupported config keys',async t=>{
  const f=await setup(t);
  for(const headers of [{'Origin':'https://foreign.invalid'},{'X-GoodNight-Token':'bad'}])assert.equal((await f.request('/api/accounts','POST',{name:'test'},headers)).status,403);
  const forged=await new Promise((resolve,reject)=>{const req=http.request(f.app.url+'/api/state',{headers:{Host:'foreign.invalid'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  assert.equal(forged,403);
  assert.equal((await f.request('/api/accounts','POST',{name:'test',config:{headless:false}})).status,400);
  assert.equal((await f.request('/api/accounts','POST',{name:'test',config:{locationMode:'virtual',virtualLocation:null}})).status,400);
  assert.equal((await f.request('/api/accounts/../../config.json')).status,404);
  const page=await fetch(f.app.url);assert.equal(page.status,200);assert.ok((await page.text()).includes('晚安成电'));assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('web imports existing local profile without enabling submission and locks duplicate servers',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goodnight-web-import-'));new Store(dir).write('config.json',DEFAULTS);
  const f=await setup(t,{dataDir:dir});t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.equal(f.state.accounts[0].id,'local');assert.equal(f.state.accounts[0].enabled,false);
  assert.equal(fs.existsSync(path.join(dir,'accounts','local')),false);
  await assert.rejects(startWeb({dataDir:dir,port:0,schedule:false}),/已在运行/);
});
test('web login validates the same profile, holds locks and strips school data from location response',async t=>{
  let closed=0,submitted=0;
  const ctx={close:async()=>{closed++;},pages:()=>[{goto:async()=>{}}]};
  const adapter={authenticate:async()=>{},getCheckinLocations:async()=>({code:0,data:[{locationName:'测试宿舍',latitude:30,longitude:104,radiusMeter:100,creatorPhone:'private'}]}),submit:async()=>{submitted++;}};
  const f=await setup(t,{open:async()=>ctx,adapterFactory:()=>adapter});
  const added=await f.request('/api/accounts','POST',{name:'test',config:{}}),id=added.data.id;
  assert.equal((await f.request(`/api/accounts/${id}/login`,'POST',{})).status,200);
  assert.equal((await f.request(`/api/accounts/${id}/check`,'POST',{})).status,409);
  assert.equal((await f.request(`/api/accounts/${id}/login-finish`,'POST',{})).data.result,'session_valid');
  assert.equal(closed,1);
  const places=await f.request(`/api/accounts/${id}/locations`,'POST',{});
  assert.equal(places.data.locations[0].name,'测试宿舍');assert.equal(JSON.stringify(places.data).includes('private'),false);assert.equal(submitted,0);
  assert.equal((await f.request(`/api/accounts/${id}/run`,'POST',{})).status,400);
  assert.equal((await f.request(`/api/accounts/${id}/plan`,'POST',{enabled:true})).data.enabled,true);
});
