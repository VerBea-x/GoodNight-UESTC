import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, loadConfig, validateConfig } from './config.mjs';
import { Store } from './store.mjs';
import { launchBrowser } from './browser.mjs';
import { createUestcAdapter, PORTAL } from './adapters/uestc.mjs';
import { inspect, runWithRetries } from './runner.mjs';
import { tick, localMinute } from './daemon.mjs';
import { notifyReview } from './resilience.mjs';
import { shanghaiDate } from './policy.mjs';

const publicDir = fileURLToPath(new URL('../web/', import.meta.url));
const files = { '/':['index.html','text/html; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'], '/style.css':['style.css','text/css; charset=utf-8'] };
Object.assign(files, {
  '/map.js':['map.js','text/javascript; charset=utf-8'],
  '/manual':['manual.html','text/html; charset=utf-8'],
  '/manual.css':['manual.css','text/css; charset=utf-8'],
  '/disclaimer':['disclaimer.html','text/html; charset=utf-8'],
  '/vendor/leaflet.js':['../node_modules/leaflet/dist/leaflet.js','text/javascript; charset=utf-8'],
  '/vendor/leaflet.css':['../node_modules/leaflet/dist/leaflet.css','text/css; charset=utf-8'],
  '/vendor/coordtransform.js':['../node_modules/coordtransform/index.js','text/javascript; charset=utf-8']
});
const healthy = new Set(['success','already_done','record_read','dry_run_ready','preflight_ready','session_valid']);
const safeRead = (store, name, fallback = null) => { try { return store.read(name, fallback); } catch { return fallback; } };
const fail = (status, message) => Object.assign(new Error(message), { status });
function json(res, status, value) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); }
async function body(req) {
  let size=0; const chunks=[];
  for await (const chunk of req) { size+=chunk.length; if (size>65536) throw fail(413,'请求内容过大'); chunks.push(chunk); }
  try { const data=JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data!=='object' || Array.isArray(data)) throw 0; return data; }
  catch { throw fail(400,'请求必须是 JSON 对象'); }
}
function accountName(value) { if (typeof value!=='string' || !value.trim() || value.trim().length>40) throw fail(400,'账号名称须为 1–40 字'); return value.trim(); }
function placeName(value='') { if (typeof value!=='string' || value.length>60) throw fail(400,'地点名称最多 60 字'); return value.trim(); }
function configPatch(previous, patch={}) {
  const editable = ['locationMode','virtualLocation','reportTime','recoveryCutoff','maxAccuracyMeters','browserChannel','remark','keyword','locationType','notifications'];
  if (!patch || typeof patch!=='object' || Array.isArray(patch) || Object.keys(patch).some(k=>!editable.includes(k))) throw fail(400,'配置字段不受支持');
  const merged={...previous,...patch};
  const minutes=s=>{const [h,m]=String(s).split(':').map(Number);return h*60+m;};
  const span=minutes(merged.recoveryCutoff)-minutes(merged.reportTime);
  merged.catchUpMinutes=Number.isFinite(span)?Math.max(1,Math.min(120,span)):previous.catchUpMinutes;
  try { return validateConfig(merged); } catch (e) { throw fail(400,e.message); }
}

export async function startWeb({ dataDir, port=3210, signal, schedule=true, open=launchBrowser, adapterFactory=createUestcAdapter, intervalMs=30000 }={}) {
  if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('网页端口须为 1–65535');
  const root=new Store(dataDir), lockStore=new Store(path.join(root.dir,'web-control'));
  const releaseServer=lockStore.acquire(); if (!releaseServer) throw new Error('该数据目录的网页控制台已在运行');
  let registry, server, timer, pulseRunning=false, stopped=false, csrf=crypto.randomBytes(32).toString('hex');
  const busy=new Map(), login=new Map();
  try {
    registry=root.read('web-accounts.json');
    if (!registry) {
      registry={version:1,displayName:'同学',accounts:[]};
      if (fs.existsSync(root.file('config.json'))) { loadConfig(root.dir); registry.accounts.push({id:'local',name:'我的账号',enabled:false,createdAt:new Date().toISOString()}); }
      root.write('web-accounts.json',registry);
    }
    if (registry.version!==1 || !Array.isArray(registry.accounts) || registry.accounts.some(a=>!/^(local|[a-f0-9-]{36})$/.test(a.id))) throw new Error('网页账号索引格式无效');
    const persist=()=>root.write('web-accounts.json',registry);
    const find=id=>{const a=registry.accounts.find(x=>x.id===id);if(!a)throw fail(404,'账号不存在');return a;};
    const storeFor=a=>new Store(a.id==='local'?root.dir:path.join(root.dir,'accounts',a.id));
    const snapshot=a=>{
      const store=storeFor(a), lastAction=safeRead(store,'web-last-action.json');
      const state=safeRead(store,'scheduler.json',{}), lastRecord=safeRead(store,'web-today.json');
      const result=lastAction?.out?.result;
      const confirmed=state.completionDate===shanghaiDate() || (lastRecord?.businessDate===shanghaiDate() && ['CHECKED_IN','STUDENT_REPORTED','INSTRUCTOR_REPORTED','EXEMPT'].includes(lastRecord.status));
      return {...a,config:loadConfig(store.dir),busy:busy.get(a.id)||null,loginOpen:login.has(a.id),confirmed,lastAction,lastRecord,lastFailure:safeRead(store,'last-failure.json'),scheduler:state,needsAttention:!!result&&!healthy.has(result)&&!['window_not_open','already_running'].includes(result)};
    };
    const remember=(a,action,out)=>{
      const store=storeFor(a);
      store.write('web-last-action.json',{at:new Date().toISOString(),action,out});
      if (out.businessDate && out.status) store.write('web-today.json',{businessDate:out.businessDate,status:out.status});
      store.log('web_action',{action,result:out.result,reason:out.reason,operation:out.operation});
    };
    const execute=async(a,action,fn)=>{
      if(busy.has(a.id))throw fail(409,'此账号有任务正在运行，请稍后重试');
      busy.set(a.id,action);
      try {const out=await fn();remember(a,action,out);return out;}
      catch {const out={result:'unknown',reason:'runtime_error'};remember(a,action,out);return out;}
      finally {busy.delete(a.id);}
    };
    const closeLogin=async id=>{const session=login.get(id);if(!session)return;login.delete(id);clearTimeout(session.timer);try{await session.ctx.close();}catch{}finally{session.release();busy.delete(id);}};
    const pulse=async()=>{
      if(pulseRunning||stopped)return;pulseRunning=true;
      try {
        for(const a of [...registry.accounts]) {
          if(stopped)break;
          if(!a.enabled||busy.has(a.id))continue;
          busy.set(a.id,'schedule');
          try {
            const store=storeFor(a),config=loadConfig(store.dir);
            const minute=localMinute(new Date());
            const start=Number(config.reportTime.slice(0,2))*60+Number(config.reportTime.slice(3))-config.preflightLeadMinutes;
            const cutoff=Number(config.recoveryCutoff.slice(0,2))*60+Number(config.recoveryCutoff.slice(3));
            if(minute<Math.max(0,start)||minute>=cutoff)continue;
            const result=await tick({config,store});
            if(result.action!=='idle')remember(a,result.action,result.result);
            if(config.notifications&&['report','recovery'].includes(result.action)&&['success','already_done'].includes(result.result?.result)&&result.result.businessDate===shanghaiDate()){
              const date=shanghaiDate(),prior=safeRead(store,'web-review-notification.json',{});
              if(prior?.date!==date){
                store.write('web-review-notification.json',{date,result:result.result.result,at:new Date().toISOString()});
                notifyReview().catch(()=>{try{store.log('notification_failed',{phase:'review'});}catch{}});
              }
            }
          }catch{try{remember(a,'schedule',{result:'unknown',reason:'scheduler_error'});}catch{}}
          finally{busy.delete(a.id);}
        }
      }finally{pulseRunning=false;}
    };
    server=http.createServer(async(req,res)=>{
      const host=req.headers.host, address=server.address();
      const allowed=new Set([`127.0.0.1:${address.port}`,`localhost:${address.port}`]);
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://*.baidu.com https://*.bdimg.com https://*.bdstatic.com; style-src 'self' 'unsafe-inline' https://*.baidu.com https://*.bdimg.com https://*.bdstatic.com; img-src 'self' data: https://tile.openstreetmap.org https://*.baidu.com https://*.bdimg.com https://*.bdstatic.com; connect-src 'self' https://*.baidu.com https://*.bdimg.com https://*.bdstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      try {
        if(!allowed.has(host)||req.headers['sec-fetch-site']==='cross-site')throw fail(403,'仅接受本机网页请求');
        const url=new URL(req.url,`http://${host}`), pathname=url.pathname;
        if(req.headers.origin && req.headers.origin!==`http://${host}`)throw fail(403,'请求来源无效');
        if(!['GET','POST','PUT','DELETE'].includes(req.method))throw fail(405,'不支持的请求方式');
        if(req.method!=='GET' && req.headers['x-goodnight-token']!==csrf)throw fail(403,'页面已失效，请刷新后重试');
        if(req.method==='GET'&&files[pathname]){const [name,type]=files[pathname];res.writeHead(200,{'Content-Type':type});res.end(fs.readFileSync(path.join(publicDir,name)));return;}
        if(req.method==='GET'&&pathname==='/api/state') {
          json(res,200,{token:csrf,displayName:registry.displayName,accounts:registry.accounts.map(snapshot),today:shanghaiDate(),dataDir:root.dir,version:'0.3.0',scheduler:schedule});return;
        }
        if(req.method==='PUT'&&pathname==='/api/settings') {const data=await body(req);registry.displayName=accountName(data.displayName);persist();json(res,200,{ok:true});return;}
        if(req.method==='POST'&&pathname==='/api/accounts') {
          if(registry.accounts.length>=10)throw fail(400,'本机最多添加 10 个账号');
          const data=await body(req),name=accountName(data.name),config=configPatch(DEFAULTS,data.config);
          const a={id:crypto.randomUUID(),name,locationName:placeName(data.locationName),enabled:false,createdAt:new Date().toISOString()};
          storeFor(a).write('config.json',config);registry.accounts.push(a);persist();json(res,201,snapshot(a));return;
        }
        const match=/^\/api\/accounts\/(local|[a-f0-9-]{36})(?:\/(logs|check|dry-run|run|login|login-finish|login-cancel|locations|plan))?$/.exec(pathname);
        if(!match)throw fail(404,'页面或接口不存在');
        const a=find(match[1]),action=match[2],store=storeFor(a);
        if(req.method==='DELETE'&&!action){
          if(busy.has(a.id)||login.has(a.id))throw fail(409,'账号正在运行，请稍后再删除');
          if(a.id!=='local'){
            const release=store.acquire();if(!release)throw fail(409,'账号正被其他进程使用');release();
            const archiveDir=path.join(root.dir,'archived-accounts');
            fs.mkdirSync(archiveDir,{recursive:true});
            fs.renameSync(store.dir,path.join(archiveDir,`${a.id}-${Date.now()}`));
          }
          registry.accounts=registry.accounts.filter(item=>item.id!==a.id);persist();
          json(res,200,{ok:true,archived:a.id!=='local'});return;
        }
        if(req.method==='PUT'&&!action){
          if(busy.has(a.id))throw fail(409,'任务运行中，请稍后保存');
          const data=await body(req),name=accountName(data.name),locationName=placeName(data.locationName??a.locationName??''),config=configPatch(loadConfig(store.dir),data.config);
          const release=store.acquire();if(!release)throw fail(409,'账号正被其他进程使用');
          try{
            store.write('config.json',config);
            const state=safeRead(store,'scheduler.json',{});
            for(const key of ['nextReportDate','nextReportAt','retryUntil','lastReportDate','lastPreflightDate'])delete state[key];
            store.write('scheduler.json',state);
            a.name=name;a.locationName=locationName;persist();
          }finally{release();}
          json(res,200,snapshot(a));return;
        }
        if(req.method==='POST'&&action==='plan'){
          const data=await body(req);if(typeof data.enabled!=='boolean')throw fail(400,'计划开关无效');
          loadConfig(store.dir);a.enabled=data.enabled;persist();json(res,200,{ok:true,enabled:a.enabled});return;
        }
        if(req.method==='GET'&&action==='logs'){
          const folder=path.join(store.dir,'logs');
          const names=fs.existsSync(folder)?fs.readdirSync(folder).filter(x=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort().slice(-7):[];
          const rows=[];
          for(const name of names){const file=path.join(folder,name),size=fs.statSync(file).size,handle=fs.openSync(file,'r');
            try{const length=Math.min(size,128*1024),buf=Buffer.alloc(length);fs.readSync(handle,buf,0,length,size-length);const lines=buf.toString('utf8').split('\n');if(size>length)lines.shift();
              for(const line of lines)try{const r=JSON.parse(line);rows.push(Object.fromEntries(['at','event','action','result','reason','operation','status','businessDate','phase'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));}catch{}
            }finally{fs.closeSync(handle);}}
          json(res,200,rows.slice(-100).reverse());return;
        }
        if(req.method!=='POST')throw fail(405,'不支持的请求方式');
        if(action==='login-cancel'){await closeLogin(a.id);json(res,200,{ok:true});return;}
        if(action==='login'){
          if(busy.has(a.id))throw fail(409,'此账号有任务正在运行');
          if(login.size>=2)throw fail(409,'请先完成已经打开的登录窗口');
          const release=store.acquire();if(!release)throw fail(409,'账号正被其他进程使用');
          busy.set(a.id,'login');let ctx;
          try{
            ctx=await open(loadConfig(store.dir),store.dir,{visible:true});
            const page=ctx.pages()[0]||await ctx.newPage();await page.goto(PORTAL,{waitUntil:'domcontentloaded',timeout:45000});
            const timer=setTimeout(()=>{closeLogin(a.id).catch(()=>{});},10*60000);timer.unref();
            login.set(a.id,{ctx,release,timer});json(res,200,{result:'login_open'});
          }catch{if(ctx)await ctx.close().catch(()=>{});release();busy.delete(a.id);throw fail(400,'无法打开登录窗口，请检查浏览器安装及网络');}
          return;
        }
        if(action==='login-finish'){
          const session=login.get(a.id);if(!session)throw fail(400,'请先打开学校登录窗口');
          if(session.finishing)throw fail(409,'正在验证登录');session.finishing=true;
          try{await adapterFactory(session.ctx,loadConfig(store.dir)).authenticate();await closeLogin(a.id);const out={result:'session_valid'};remember(a,'login',out);json(res,200,out);}
          catch{session.finishing=false;throw fail(400,'尚未完成业务登录，请在浏览器中登录并点击“晚安成电”');}return;
        }
        if(action==='locations'){
          const out=await execute(a,'locations',async()=>{
            const release=store.acquire();if(!release)return {result:'already_running'};let ctx;
            try{
              const config=loadConfig(store.dir);ctx=await open(config,store.dir);const api=adapterFactory(ctx,config);await api.authenticate();
              const r=await api.getCheckinLocations();if(r.code!==0||r.ok===false||!Array.isArray(r.data))return {result:'unknown',reason:'locations_unavailable'};
              const locations=r.data.filter(x=>Number.isFinite(x.latitude)&&Number.isFinite(x.longitude)&&Number.isFinite(x.radiusMeter)&&x.radiusMeter>0).map(x=>({name:String(x.locationName||'签到点'),latitude:x.latitude,longitude:x.longitude,radiusMeter:x.radiusMeter}));
              return {result:'record_read',locations};
            }catch(e){return {result:e.code==='need_login'?'need_login':'unknown'};}finally{if(ctx)await ctx.close().catch(()=>{});release();}
          });json(res,200,out);return;
        }
        if(['check','dry-run','run'].includes(action)){
          if(action==='run'){const data=await body(req);if(data.confirm!==true)throw fail(400,'请确认真实提交');}
          if(busy.has(a.id))throw fail(409,'此账号有任务正在运行');
          const config=loadConfig(store.dir);
          const job=execute(a,action,()=>action==='check'?inspect({config,store,open,adapterFactory}):runWithRetries({config,store,open,adapterFactory,dryRun:action==='dry-run'}));
          job.catch(()=>{});json(res,202,{result:'started'});return;
        }
        throw fail(404,'接口不存在');
      }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'本地服务出错，请检查配置或重启服务'});else res.end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    if(schedule){timer=setInterval(()=>{pulse().catch(()=>{});},intervalMs);timer.unref();setTimeout(()=>{pulse().catch(()=>{});},1500).unref();}
    const close=async()=>{
      if(stopped)return;stopped=true;clearInterval(timer);signal?.removeEventListener('abort',onAbort);
      for(const id of [...login.keys()])await closeLogin(id);
      await new Promise(resolve=>server.close(resolve));
      // In-flight account jobs keep their profile locks until they finish.
      releaseServer();
    };
    const onAbort=()=>{close().catch(()=>{});};signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)await close();
    return {server,url:`http://127.0.0.1:${server.address()?.port||port}`,close,pulse};
  }catch(e){releaseServer();throw e;}
}
