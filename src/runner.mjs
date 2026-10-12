import crypto from 'node:crypto';
import { launchBrowser } from './browser.mjs';
import { createUestcAdapter, BusinessError } from './adapters/uestc.mjs';
import { validateConfig } from './config.mjs';
import { apiSucceeded, todayState, summary, reportWindow, checkinWindow, checkinVerified, findDorm, selectKeyword, locationType, reportVerified } from './policy.mjs';
const sleepDefault = ms => new Promise(r => setTimeout(r, ms));
const fingerprint = (c,kind) => crypto.createHash('sha256').update(JSON.stringify([kind,c.remark,c.keyword,c.locationType])).digest('hex');
const failure = e => e?.code === 'need_login' ? 'need_login' : 'unknown';
export async function reconcile(adapter, date, config, { kind='report',sleep = sleepDefault, emit = () => {} } = {}) {
  let confirmedPending=false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(1500 * attempt);
    let record; try { record = await adapter.getToday(); }
    catch (e) { confirmedPending=false;if (e.code === 'need_login') return { result:'need_login',businessDate:date,operation:kind,submitted:true }; continue; }
    emit('verification', { operation:kind,attempt,...summary(record) });
    const verified=kind==='checkin'?checkinVerified(record,date):reportVerified(record,date,config);
    if (verified) return { result:'success',businessDate:date,status:record.data.recordStatusCode,operation:kind,submitted:true };
    if(kind==='report'&&apiSucceeded(record)&&record.data?.businessDate===date&&record.data.recordStatusCode==='STUDENT_REPORTED')return {result:'unknown',reason:'saved_report_mismatch',businessDate:date,operation:kind,submitted:true};
    if(apiSucceeded(record)&&record.data?.businessDate===date&&todayState(record,new Date(`${date}T22:30:00+08:00`))==='done')return {result:'already_done',...summary(record),operation:kind,submitted:true};
    if (record.data?.businessDate && record.data.businessDate !== date) return { result:'unknown',reason:'business_date_changed',operation:kind,submitted:true };
    confirmedPending=apiSucceeded(record)&&record.data?.businessDate===date&&record.data.recordStatusCode==='PENDING';
  }
  return { result:'unknown',reason:'saved_record_not_confirmed',businessDate:date,operation:kind,submitted:true,confirmedPending };
}
async function submitAndVerify(adapter, date, config, store, body, kind, options) {
  const name=`submission-${kind}-${date}.json`;
  if (!store.claimSubmission(date,fingerprint(config,kind),kind)) return reconcile(adapter,date,config,{...options,kind});
  let response,postError;
  try {response=await (kind==='checkin'?adapter.submitCheckin(body):adapter.submit(body));options.emit('submit_response',{operation:kind,code:response.code,ok:response.ok});}
  catch(e){postError=e;options.emit('submit_response_unknown',{operation:kind});}
  let out=await reconcile(adapter,date,config,{...options,kind});
  if(out.result==='unknown'&&(postError?.code==='need_login'||response?.code===5000))out={...out,result:'need_login'};
  else if(out.result==='unknown'&&response?.code===4001&&response.ok!==true&&out.confirmedPending)out={...out,result:kind==='checkin'?'checkin_rejected':'report_rejected'};
  store.write(name,{businessDate:date,kind,fingerprint:fingerprint(config,kind),state:out.result,at:new Date().toISOString()});
  return out;
}
export async function runDaily({ config, store, dryRun=false, now=()=>new Date(), open=launchBrowser, adapterFactory=createUestcAdapter, sleep=sleepDefault }) {
  config=validateConfig(config);
  const unlock=store.acquire();if(!unlock)return {result:'already_running'};
  let ctx,submitted=false;
  const emit=(event,detail)=>store.log(event,detail);
  try {
    ctx=await open(config,store.dir);
    const adapter=adapterFactory(ctx,config);await adapter.authenticate();
    const record=await adapter.getToday();emit('today',summary(record));
    const state=todayState(record,now());
    if(state==='unknown')return {result:'unknown',reason:'today_unavailable_or_date_changed'};
    const date=record.data.businessDate;
    if(state==='done'&&!dryRun)return {result:'already_done',...summary(record)};
    const pastCutoff=()=>now().getTime()>=Date.parse(`${date}T${config.recoveryCutoff}:00+08:00`);
    if(pastCutoff())return {result:'window_missed',reason:'recovery_cutoff_reached'};
    const reportJournal=store.read(`submission-report-${date}.json`),checkinJournal=store.read(`submission-checkin-${date}.json`);
    if(reportJournal&&!dryRun)return await reconcile(adapter,date,config,{sleep,emit});
    if(checkinJournal&&checkinJournal.state!=='checkin_rejected'&&!dryRun)return await reconcile(adapter,date,config,{kind:'checkin',sleep,emit});
    const schedule=await adapter.getSchedule(),signWindow=checkinWindow(schedule,date,now()),fillWindow=reportWindow(schedule,date,now());
    if(signWindow.reason==='invalid_schedule')return {result:'unknown',reason:'invalid_checkin_schedule'};
    if(signWindow.result!=='open'&&fillWindow.result!=='open') {
      const future=[signWindow,fillWindow].filter(w=>w.result==='window_not_open').sort((a,b)=>Date.parse(a.nextAttemptAt)-Date.parse(b.nextAttemptAt));
      return future[0]||fillWindow;
    }
    let geo;
    try {geo=await adapter.getLocation();if(!Number.isFinite(geo?.accuracy)||geo.accuracy<0||geo.accuracy>config.maxAccuracyMeters)return {result:'location_fail',reason:'accuracy_insufficient'};}
    catch(e){return {result:e.code==='need_login'?'need_login':'location_fail',reason:'location_unavailable_or_frontend_changed'};}
    const address=await adapter.getAddress(geo);
    const dorm=findDorm(geo,await adapter.getCheckinLocations());
    if(dorm&&signWindow.result==='open'&&!checkinJournal) {
      emit('prepared',{operation:'checkin',businessDate:date,accuracyMeter:Math.round(geo.accuracy)});
      if(dryRun)return {result:'dry_run_ready',operation:'checkin',businessDate:date,alreadyRecorded:state==='done'};
      const fresh=await adapter.getToday();
      if(fresh.data?.businessDate!==date)return {result:'window_missed',reason:'business_date_changed'};
      const freshState=todayState(fresh,now());
      if(freshState==='done')return {result:'already_done',...summary(fresh)};
      if(freshState!=='pending')return {result:'unknown',reason:'record_changed'};
      const current=checkinWindow(await adapter.getSchedule(),date,now());
      if(current.result==='open') {
        const ua=await adapter.getUserAgent();
        const clientTime=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now());
        if(pastCutoff())return {result:'window_missed',reason:'recovery_cutoff_reached'};
        submitted=true;
        const out=await submitAndVerify(adapter,date,config,store,{latitude:geo.latitude,longitude:geo.longitude,reverseGeocode:address,userAgent:ua,clientTime,accuracy:geo.accuracy},'checkin',{sleep,emit});
        // Only an explicit rejection + authenticated, current PENDING record allows report fallback.
        if(out.result!=='checkin_rejected'||!out.confirmedPending)return out;
      }
    }
    // No valid dorm location / checkin window ended / explicit rejection: use the form.
    const finalReportWindow=reportWindow(await adapter.getSchedule(),date,now());
    if(finalReportWindow.result!=='open')return {...finalReportWindow,submitted};
    let actualType;try{actualType=locationType(geo,await adapter.getFences());}catch(e){if(e.code==='need_login')throw e;return {result:'location_fail',reason:'campus_fences_invalid',submitted};}
    if(actualType!==config.locationType)return {result:'location_fail',reason:'actual_location_mismatch',submitted};
    const choice=selectKeyword(await adapter.getKeywords(),config);
    const body={reportedLocationTypeCode:actualType,...choice,caseRemark:config.remark,latitude:geo.latitude,longitude:geo.longitude,gpsAccuracyMeter:geo.accuracy,reverseGeocode:address,coordinateSystemCode:'gcj02'};
    emit('prepared',{operation:'report',businessDate:date,locationType:actualType,accuracyMeter:Math.round(geo.accuracy)});
    if(dryRun)return {result:'dry_run_ready',operation:'report',businessDate:date,alreadyRecorded:state==='done',locationType:actualType};
    const fresh=await adapter.getToday(),freshState=todayState(fresh,now());
    if(fresh.data?.businessDate!==date)return {result:'window_missed',reason:'business_date_changed',submitted};
    if(freshState==='done')return {result:'already_done',...summary(fresh),submitted};
    if(freshState!=='pending')return {result:'unknown',reason:'record_changed',submitted};
    const lastWindow=reportWindow(await adapter.getSchedule(),date,now());
    if(lastWindow.result!=='open')return {...lastWindow,submitted};
    if(pastCutoff())return {result:'window_missed',reason:'recovery_cutoff_reached',submitted};
    submitted=true;return await submitAndVerify(adapter,date,config,store,body,'report',{sleep,emit});
  }catch(e){return {result:failure(e),reason:e instanceof BusinessError?e.code:'runtime_error',submitted};}
  finally{if(ctx)await ctx.close().catch(()=>{});unlock();}
}
export async function runWithRetries(options) {
  let out;
  for(let attempt=0;attempt<3;attempt++) {
    out=await runDaily(options);
    if(out.submitted||!['unknown','already_running'].includes(out.result)||attempt===2)break;
    await (options.sleep||sleepDefault)(30000);
  }
  options.store.write('last-result.json',{at:new Date().toISOString(),...out});options.store.log('result',out);return out;
}
export async function inspect({config,store,mode='check',open=launchBrowser,adapterFactory=createUestcAdapter}) {
  const unlock=store.acquire();if(!unlock)return {result:'already_running'};
  let ctx;
  try {
    ctx=await open(config,store.dir);const adapter=adapterFactory(ctx,config);await adapter.authenticate();
    if(mode==='session')return {result:'session_valid'};
    if(mode==='preflight') {
      let geo;try {geo=await adapter.getLocation();}catch(e){return {result:e.code==='need_login'?'need_login':'location_fail',reason:'location_unavailable_or_frontend_changed'};}
      if(!Number.isFinite(geo?.accuracy)||geo.accuracy<0||geo.accuracy>config.maxAccuracyMeters)return {result:'location_fail',reason:'accuracy_insufficient'};
      return {result:'preflight_ready',accuracyMeter:Math.round(geo.accuracy)};
    }
    const r=await adapter.getToday();if(!apiSucceeded(r)||!r.data)return {result:'unknown',reason:'today_unavailable'};
    return {result:'record_read',...summary(r),locationType:r.data.reportedLocationTypeCode,keywordMatches:r.data.caseKeyword===config.keyword,remarkMatches:r.data.caseRemark===config.remark};
  }catch(e){return {result:failure(e),reason:e instanceof BusinessError?e.code:'runtime_error'};}
  finally{if(ctx)await ctx.close().catch(()=>{});unlock();}
}
