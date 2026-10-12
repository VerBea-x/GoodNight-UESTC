import { shanghaiDate } from './policy.mjs';
import { inspect, runWithRetries } from './runner.mjs';
import { preflightDue, recoveryDue, recordOutcome } from './resilience.mjs';
export function localMinute(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(now);
  return Number(parts.find(x=>x.type==='hour').value)*60+Number(parts.find(x=>x.type==='minute').value);
}
export function dueReport(config, state, now = new Date()) {
  const date = shanghaiDate(now);
  if(now.getTime()>=Date.parse(`${date}T${config.recoveryCutoff??'23:55'}:00+08:00`))return false;
  if (state.lastReportDate === date) return false;
  if (state.nextReportDate === date && state.nextReportAt) return (!state.retryUntil||now.getTime()<Date.parse(state.retryUntil))&&now.getTime() >= Date.parse(state.nextReportAt);
  const [h,m] = config.reportTime.split(':').map(Number), minute=localMinute(now);
  return minute>=h*60+m && minute<h*60+m+config.catchUpMinutes;
}
export async function tick({config,store,now = new Date(),report = runWithRetries,session = inspect,preflight = inspect,notify}) {
  const state=store.read('scheduler.json',{}), date=shanghaiDate(now);
  const waitingForWindow=state.nextReportDate===date&&now.getTime()<Date.parse(state.nextReportAt);
  const normalDue=dueReport(config,state,now);
  const backupDue=!normalDue&&!waitingForWindow&&recoveryDue(config,state,now);
  if (normalDue||backupDue) {
    state.lastAttemptAt=now.toISOString();
    if(backupDue)state.lastRecoveryAt=now.toISOString();
    store.write('scheduler.json',state);
    let out=await report({config,store});
    if(['success','already_done'].includes(out.result)&&out.businessDate!==date)out={...out,result:'unknown',reason:'completion_date_mismatch',submitted:true};
    if(['success','already_done'].includes(out.result)&&out.businessDate===date)state.completionDate=date;
    if(out.result==='window_not_open' && out.businessDate===date && out.nextAttemptAt && shanghaiDate(new Date(out.nextAttemptAt))===date) {
      state.nextReportDate=date;state.nextReportAt=out.nextAttemptAt;
      state.retryUntil=new Date(Math.min(Date.parse(out.nextAttemptAt)+config.catchUpMinutes*60000,Date.parse(`${date}T23:55:00+08:00`))).toISOString();
    } else if(!out.submitted&&['need_login','location_fail','unknown'].includes(out.result)) {
      const [h,m]=config.reportTime.split(':').map(Number);
      const deadline=state.nextReportDate===date&&state.retryUntil?Date.parse(state.retryUntil):Date.parse(`${date}T00:00:00+08:00`)+(h*60+m+config.catchUpMinutes)*60000;
      const next=now.getTime()+120000;
      if(next<deadline){state.nextReportDate=date;state.nextReportAt=new Date(next).toISOString();state.retryUntil=new Date(deadline).toISOString();}
      else {state.lastReportDate=date;delete state.nextReportDate;delete state.nextReportAt;delete state.retryUntil;}
    } else if(out.result!=='already_running') {
      state.lastReportDate=date;delete state.nextReportDate;delete state.nextReportAt;delete state.retryUntil;
    }
    store.write('scheduler.json',state);
    await recordOutcome({store,out,phase:backupDue?'recovery':'daily',now,notify,notifications:config.notifications});
    return {action:backupDue?'recovery':'report',result:out};
  }
  if(preflightDue(config,state,now)) {
    const out=await preflight({config,store,mode:'preflight'});
    if(out.result!=='already_running')state.lastPreflightDate=date;
    state.lastSessionAt=now.toISOString();store.write('scheduler.json',state);
    store.write('last-preflight.json',{at:now.toISOString(),...out});store.log('preflight',out);
    await recordOutcome({store,out,phase:'preflight',now,notify,notifications:config.notifications});
    return {action:'preflight',result:out};
  }
  if(!state.lastSessionAt || now.getTime()-Date.parse(state.lastSessionAt)>=config.sessionIntervalMinutes*60000) {
    const out=await session({config,store,mode:'session'});
    state.lastSessionAt=now.toISOString();store.write('scheduler.json',state);
    store.write('last-session.json',{at:now.toISOString(),...out});store.log('session',out);
    await recordOutcome({store,out,phase:'session',now,notify,notifications:config.notifications});
    return {action:'session',result:out};
  }
  return {action:'idle'};
}
export async function daemon({config,store,signal}) {
  store.log('daemon_started',{reportTime:config.reportTime,timeZone:'Asia/Shanghai'});
  while(!signal?.aborted) {
    try {await tick({config,store});}
    catch {try{store.log('daemon_tick_error',{reason:'runtime_error'});}catch{}}
    if(signal?.aborted)break;
    await new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};
      const timer=setTimeout(finish,30000);signal?.addEventListener('abort',finish,{once:true});
    });
  }
  store.log('daemon_stopped');
}
