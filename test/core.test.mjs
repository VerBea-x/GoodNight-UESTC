import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, DEFAULT_REASON, validateConfig, defaultDataDir } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { runDaily, runWithRetries } from '../src/runner.mjs';
import { BusinessError } from '../src/adapters/uestc.mjs';
import { reportWindow, checkinWindow, geometryContains, locationType, findDorm } from '../src/policy.mjs';
import { dueReport, tick } from '../src/daemon.mjs';

const DATE='2026-10-10', NOW=new Date(`${DATE}T22:30:00+08:00`);
const ok=data=>({code:0,ok:true,data});
const pending=()=>ok({businessDate:DATE,recordStatusCode:'PENDING'});
const saved=()=>ok({businessDate:DATE,recordStatusCode:'STUDENT_REPORTED',reportedLocationTypeCode:'OUTSIDE',caseKeyword:'旅游',caseRemark:DEFAULT_REASON});
const schedule=()=>ok({studentCheckinStartOffsetMinute:1320,studentCheckinEndOffsetMinute:1410,studentSubmissionStartOffsetMinute:1320,studentSubmissionEndOffsetMinute:1410,studentReportStartOffsetMinute:1410,studentReportEndOffsetMinute:2760});
const square={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]};
const geo={latitude:10,longitude:10,accuracy:20};
function setup(t, overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'goodnight-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),calls=[],ctx={close:async()=>calls.push('close')};
  let record=pending();
  const adapter={
    authenticate:async()=>calls.push('auth'), getToday:async()=>{calls.push('today');return record;},
    getSchedule:async()=>schedule(),getLocation:async()=>geo,getAddress:async()=>'',getUserAgent:async()=>'synthetic-test-agent',
    getCheckinLocations:async()=>ok([]),getFences:async()=>ok([{fenceGeojson:JSON.stringify(square)}]),
    getKeywords:async()=>ok([{id:'synthetic-option',keyword:'旅游',situationTypeCode:'OUTSIDE',statusCode:'ACTIVE'}]),
    submit:async body=>{calls.push(['report',body]);record=saved();return ok(null);},
    submitCheckin:async body=>{calls.push(['checkin',body]);record=ok({businessDate:DATE,recordStatusCode:'CHECKED_IN'});return ok(null);},
    ...overrides,
  };
  const options={config:DEFAULTS,store,now:()=>NOW,open:async()=>ctx,adapterFactory:()=>adapter,sleep:async()=>{}};
  return {options,store,calls,adapter,setRecord:r=>{record=r;}};
}
const posts=calls=>calls.filter(x=>Array.isArray(x));

test('blank reason defaults; custom reason and configuration are validated',()=>{
  assert.equal(validateConfig({remark:'   '}).remark,DEFAULT_REASON);
  assert.equal(validateConfig({}).keyword,'旅游');
  assert.throws(()=>validateConfig({remark:'太短'}));
  assert.throws(()=>validateConfig({reportTime:'24:00'}));
  assert.throws(()=>validateConfig({sessionIntervalMinutes:0}));
  assert.throws(()=>validateConfig({typo:true}));
  assert.equal(validateConfig({remark:'这是一份十个字以上的自定义说明'}).remark,'这是一份十个字以上的自定义说明');
});
test('state paths remain independent of checkout',()=>{
  assert.equal(defaultDataDir({platform:'linux',home:'/home/test',env:{}}),'/home/test/.local/state/goodnight');
  assert.equal(defaultDataDir({platform:'win32',home:'C:\\Users\\test',env:{}}),'C:\\Users\\test\\AppData\\Local\\GoodNight');
});
test('check-in is preferred in a real available dormitory circle',async t=>{
  const f=setup(t,{getCheckinLocations:async()=>ok([{...geo,radiusMeter:100}])});
  f.adapter.getFences=async()=>{throw new Error('report path must not execute');};
  const out=await runDaily(f.options);
  assert.equal(out.result,'success');assert.equal(out.operation,'checkin');
  assert.equal(posts(f.calls).length,1);assert.equal(posts(f.calls)[0][0],'checkin');
  assert.equal(posts(f.calls)[0][1].latitude,geo.latitude);
  assert.equal(posts(f.calls)[0][1].clientTime,`${DATE} 22:30:00`);
});
test('outside dormitory uses dynamic active option and verifies exact saved report',async t=>{
  const f=setup(t);const out=await runDaily(f.options);
  assert.equal(out.result,'success');assert.equal(out.operation,'report');
  assert.equal(posts(f.calls).length,1);
  const body=posts(f.calls)[0][1];assert.equal(body.caseRemark,DEFAULT_REASON);assert.equal(body.caseKeywordId,'synthetic-option');assert.equal(body.coordinateSystemCode,'gcj02');
});
test('explicit check-in rejection and confirmed PENDING allow report fallback',async t=>{
  const f=setup(t,{getCheckinLocations:async()=>ok([{...geo,radiusMeter:100}]),submitCheckin:async body=>{f.calls.push(['checkin',body]);return {code:4001,ok:false};}});
  const out=await runDaily(f.options);assert.equal(out.result,'success');assert.deepEqual(posts(f.calls).map(x=>x[0]),['checkin','report']);
  assert.equal(f.store.read(`submission-checkin-${DATE}.json`).state,'checkin_rejected');
});
test('unknown check-in POST reconciles and never falls through to report or repeats after restart',async t=>{
  const f=setup(t,{getCheckinLocations:async()=>ok([{...geo,radiusMeter:100}]),submitCheckin:async body=>{f.calls.push(['checkin',body]);throw new BusinessError('transport_error');}});
  let out=await runWithRetries(f.options);assert.equal(out.result,'unknown');assert.equal(out.submitted,true);
  out=await runDaily(f.options);assert.equal(out.result,'unknown');assert.equal(posts(f.calls).length,1);
});
test('missing or unrecognized POST rejection code cannot authorize report fallback',async t=>{
  for(const response of [{},{code:200,ok:false},{code:4001,ok:true}]) {
    const f=setup(t,{getCheckinLocations:async()=>ok([{...geo,radiusMeter:100}]),submitCheckin:async body=>{f.calls.push(['checkin',body]);return response;}});
    assert.equal((await runDaily(f.options)).result,'unknown');assert.equal(posts(f.calls).length,1);
  }
});
test('lost report response can succeed through saved-record verification',async t=>{
  const f=setup(t,{submit:async body=>{f.calls.push(['report',body]);f.setRecord(saved());throw new BusinessError('transport_error');}});
  const out=await runDaily(f.options);assert.equal(out.result,'success');assert.equal(posts(f.calls).length,1);
});
test('saved report with different reason does not pass verification',async t=>{
  const f=setup(t,{submit:async()=>{f.setRecord(ok({...saved().data,caseRemark:'另一个不匹配的十字以上说明文本'}));return ok(null);}});
  const out=await runDaily(f.options);assert.equal(out.result,'unknown');assert.equal(out.reason,'saved_report_mismatch');
});
test('ambiguous report remains unresolved without a second POST',async t=>{
  const f=setup(t,{submit:async body=>{f.calls.push(['report',body]);throw new BusinessError('transport_error');}});
  assert.equal((await runWithRetries(f.options)).result,'unknown');
  assert.equal((await runWithRetries(f.options)).result,'unknown');assert.equal(posts(f.calls).length,1);
});
test('explicit rejected check-in with unavailable verification cannot submit a report',async t=>{
  let failed=false;
  const f=setup(t,{getCheckinLocations:async()=>ok([{...geo,radiusMeter:100}]),submitCheckin:async body=>{f.calls.push(['checkin',body]);failed=true;return {code:4001,ok:false};}});
  const original=f.adapter.getToday;f.adapter.getToday=async()=>{if(failed)throw new BusinessError('transport_error');return original();};
  assert.equal((await runDaily(f.options)).result,'unknown');assert.equal(posts(f.calls).length,1);
});
test('expired login, stale date, accuracy and actual campus mismatch block all POSTs',async t=>{
  for(const [overrides,result] of [
    [{authenticate:async()=>{throw new BusinessError('need_login');}},'need_login'],
    [{getToday:async()=>ok({businessDate:'2026-10-09',recordStatusCode:'PENDING'})},'unknown'],
    [{getLocation:async()=>({...geo,accuracy:201})},'location_fail'],
    [{getLocation:async()=>({latitude:0.5,longitude:0.5,accuracy:10})},'location_fail'],
  ]){const f=setup(t,overrides);assert.equal((await runDaily(f.options)).result,result);assert.equal(posts(f.calls).length,0);assert.equal(f.calls.at(-1),'close');}
});
test('already terminal and dry run do not submit',async t=>{
  const f=setup(t);f.setRecord(saved());assert.equal((await runDaily(f.options)).result,'already_done');
  assert.equal((await runDaily({...f.options,dryRun:true})).result,'dry_run_ready');assert.equal(posts(f.calls).length,0);
  assert.equal(f.store.read(`submission-report-${DATE}.json`),null);
});
test('fresh record change after preparation prevents submitting',async t=>{
  let reads=0;const f=setup(t,{getToday:async()=>++reads===1?pending():saved()});
  assert.equal((await runDaily(f.options)).result,'already_done');assert.equal(posts(f.calls).length,0);
});
test('logs and journals omit personal reason, precise location and option id',async t=>{
  const f=setup(t);await runDaily(f.options);
  const journal=fs.readFileSync(f.store.file(`submission-report-${DATE}.json`),'utf8');
  const logs=fs.readdirSync(path.join(f.store.dir,'logs')).map(x=>fs.readFileSync(path.join(f.store.dir,'logs',x),'utf8')).join('');
  for(const text of [journal,logs]){assert.ok(!text.includes(DEFAULT_REASON));assert.ok(!text.includes('synthetic-option'));assert.ok(!text.includes('latitude'));assert.ok(!text.includes('longitude'));}
});
test('Shanghai business day and merged windows cap at midnight with safety margin',()=>{
  assert.equal(reportWindow(schedule(),DATE,NOW).result,'open');
  assert.equal(reportWindow(schedule(),DATE,new Date(`${DATE}T23:30:00+08:00`)).result,'open');
  assert.equal(reportWindow(schedule(),DATE,new Date(`${DATE}T23:55:00+08:00`)).result,'window_missed');
  assert.equal(checkinWindow(schedule(),DATE,new Date(`${DATE}T23:26:00+08:00`)).result,'window_missed');
  assert.equal(reportWindow(schedule(),DATE,new Date('2026-10-10T16:00:00Z')).result,'window_missed');
});
test('polygons respect holes and malformed extra geometry fails closed',()=>{
  const polygon={...square,coordinates:[...square.coordinates,[[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8],[0.2,0.2]]]};
  assert.equal(geometryContains({latitude:0.5,longitude:0.5},polygon),false);
  assert.equal(geometryContains({latitude:0.1,longitude:0.1},polygon),true);
  assert.throws(()=>locationType(geo,ok([{fenceGeojson:'broken'}])));
  assert.throws(()=>findDorm(geo,ok([{...geo,radiusMeter:100},{latitude:0,longitude:0,radiusMeter:-1}])));
});
test('atomic claims and locks prevent concurrent local submission',t=>{
  const {store}=setup(t);const release=store.acquire();assert.equal(store.acquire(),null);release();assert.ok(store.acquire());
  assert.equal(store.claimSubmission(DATE,'hash'),true);assert.equal(store.claimSubmission(DATE,'other'),false);
  assert.equal(store.claimSubmission(DATE,'hash','checkin'),true);assert.throws(()=>store.file('../secret'));
});
test('scheduler uses Shanghai time, catch-up, daily marker, deferred windows and session interval',async t=>{
  const {store}=setup(t);
  assert.equal(dueReport(DEFAULTS,{},new Date(`${DATE}T22:29:00+08:00`)),false);
  assert.equal(dueReport(DEFAULTS,{},NOW),true);
  assert.equal(dueReport(DEFAULTS,{},new Date(`${DATE}T23:00:00+08:00`)),false);
  let reportCalls=0;
  const report=async()=>{reportCalls++;return reportCalls===1?{result:'window_not_open',businessDate:DATE,nextAttemptAt:`${DATE}T15:30:00Z`}:{result:'success'};};
  assert.equal((await tick({config:DEFAULTS,store,now:NOW,report})).action,'report');
  assert.equal(dueReport(DEFAULTS,store.read('scheduler.json'),new Date(`${DATE}T23:29:00+08:00`)),false);
  assert.equal((await tick({config:DEFAULTS,store,now:new Date(`${DATE}T23:30:00+08:00`),report})).result.result,'success');
  assert.equal(dueReport(DEFAULTS,store.read('scheduler.json'),NOW),false);
  const session=async()=>({result:'session_valid'});
  assert.equal((await tick({config:DEFAULTS,store,now:NOW,session})).action,'session');
  assert.equal((await tick({config:DEFAULTS,store,now:NOW,session})).action,'idle');
});
test('scheduler retries a pre-POST transient failure within the bounded catch-up interval',async t=>{
  const {store}=setup(t);let calls=0;
  const report=async()=>++calls===1?{result:'location_fail',submitted:false}:{result:'success',submitted:true};
  await tick({config:DEFAULTS,store,now:NOW,report});assert.equal(store.read('scheduler.json').lastReportDate,undefined);
  await tick({config:DEFAULTS,store,now:new Date(`${DATE}T22:32:00+08:00`),report});assert.equal(calls,2);assert.equal(store.read('scheduler.json').lastReportDate,DATE);
});
test('scheduler never retries ambiguous submitted outcomes',async t=>{
  const {store}=setup(t);let calls=0;
  const report=async()=>{calls++;return {result:'unknown',submitted:true};};
  await tick({config:DEFAULTS,store,now:NOW,report});
  await tick({config:DEFAULTS,store,now:new Date(`${DATE}T22:32:00+08:00`),report,session:async()=>({result:'session_valid'})});
  assert.equal(calls,1);
});
test('sleep or restart past the retry deadline does not resume a daily attempt',async t=>{
  const {store}=setup(t);let calls=0;
  const report=async()=>{calls++;return {result:'location_fail',submitted:false};};
  await tick({config:DEFAULTS,store,now:NOW,report});
  await tick({config:DEFAULTS,store,now:new Date(`${DATE}T23:30:00+08:00`),report,session:async()=>({result:'session_valid'})});
  assert.equal(calls,1);
});
test('before both windows the earliest check-in start is selected',async t=>{
  const f=setup(t,{getSchedule:async()=>ok({...schedule().data,studentSubmissionStartOffsetMinute:1380,studentSubmissionEndOffsetMinute:1410})});
  const out=await runDaily({...f.options,now:()=>new Date(`${DATE}T21:00:00+08:00`)});
  assert.equal(out.result,'window_not_open');assert.equal(out.nextAttemptAt,`${DATE}T14:00:00.000Z`);assert.equal(posts(f.calls).length,0);
});
