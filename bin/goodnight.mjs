#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { chromium } from 'playwright';
import { DEFAULTS, defaultDataDir, validateConfig, loadConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { launchBrowser } from '../src/browser.mjs';
import { createUestcAdapter, PORTAL } from '../src/adapters/uestc.mjs';
import { inspect, runWithRetries } from '../src/runner.mjs';
import { daemon } from '../src/daemon.mjs';
import { installService, uninstallService } from '../src/service.mjs';
const HELP = `GoodNight — 晚安成电自动填报（纯脚本，不调用 LLM）
用法：node bin/goodnight.mjs <命令> [选项]
 init                  设置说明；留空默认校外旅游说明
 login                 打开独立浏览器，首次/恢复登录由本人完成
 doctor [--online]     本地环境检查，可选业务登录检查
 check                 只读查询今日记录，不提交
 run [--dry-run]       优先打卡，无法打卡再填报；dry-run不提交
 daemon                上海时间常驻调度（每天填报、周期会话检查）
 status                显示最近结果、预检、失败记录及会话状态
 service install       安装当前用户的系统服务
 service remove        卸载服务，保留配置/登录数据
 service install --write-only  只生成文件，不装载服务
全局：--data-dir <路径> 或 GOODNIGHT_HOME，数据默认在用户系统目录
init选项：--remark <真实说明10–200字> --keyword <情况类别>
          --time HH:mm --browser chrome|msedge|chromium --force
服务须在本人的桌面登录会话安装。移动仓库或Node后请重新安装服务。
`;
function output(out) { console.log(JSON.stringify(out, null, 2)); }
const good = new Set(['success','already_done','dry_run_ready','record_read','session_valid']);
function browserInstalled(c) {
  if(c.browserChannel==='chromium') return fs.existsSync(chromium.executablePath());
  const edge=c.browserChannel==='msedge', candidates=[];
  if(process.platform==='darwin') {
    const app=edge?'Microsoft Edge.app/Contents/MacOS/Microsoft Edge':'Google Chrome.app/Contents/MacOS/Google Chrome';
    candidates.push(path.join('/Applications',app),path.join(os.homedir(),'Applications',app));
  } else if(process.platform==='win32') {
    const rel=edge?'Microsoft/Edge/Application/msedge.exe':'Google/Chrome/Application/chrome.exe';
    for(const root of [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA])if(root)candidates.push(path.join(root,rel));
  } else {
    for(const dir of (process.env.PATH||'').split(path.delimiter))for(const name of edge?['microsoft-edge','microsoft-edge-stable']:['google-chrome','google-chrome-stable'])candidates.push(path.join(dir,name));
  }
  return candidates.some(p=>fs.existsSync(p));
}
async function initialize(store,v) {
  if(fs.existsSync(store.file('config.json'))&&!v.force)throw new Error('配置已存在；需要覆盖时使用 init --force（不会删除浏览器登录态）');
  let remark=v.remark,keyword=v.keyword||DEFAULTS.keyword,time=v.time||DEFAULTS.reportTime,browser=v.browser||DEFAULTS.browserChannel;
  if(remark===undefined && process.stdin.isTTY) {
    const rl=createInterface({input:process.stdin,output:process.stdout});
    try {
      remark=await rl.question('自定义请假理由（10–200字，留空使用默认校外旅游说明）：');
      keyword=(await rl.question(`情况类别（必须与学校选项相同，默认${keyword}）：`)).trim()||keyword;
      time=(await rl.question(`每日时间（上海时间，默认${time}）：`)).trim()||time;
      browser=(await rl.question(`浏览器 chrome|msedge|chromium（默认${browser}）：`)).trim()||browser;
    }finally{rl.close();}
  }
  const config=validateConfig({...DEFAULTS,remark:remark||DEFAULTS.remark,keyword,reportTime:time,browserChannel:browser});
  store.write('config.json',config);
  output({result:'configured',dataDir:store.dir,next:'login → doctor --online → run --dry-run → service install'});
}
async function login(config,store) {
  if(!process.stdin.isTTY)throw new Error('login需要本人的图形桌面与交互终端');
  const unlock=store.acquire();if(!unlock)throw new Error('浏览器正被任务使用，请暂停服务后再登录');
  let ctx,rl;
  try {
    ctx=await launchBrowser(config,store.dir,{visible:true});
    const page=ctx.pages()[0]||await ctx.newPage();await page.goto(PORTAL,{waitUntil:'domcontentloaded',timeout:45000});
    console.log('请在打开的浏览器完成统一认证，再点「晚安成电」。验证码/手机确认由本人完成。');
    rl=createInterface({input:process.stdin,output:process.stdout});await rl.question('完成后按 Enter 检查业务登录：');
    await createUestcAdapter(ctx,config).authenticate();output({result:'session_valid'});
  }finally{rl?.close();if(ctx)await ctx.close().catch(()=>{});unlock();}
}
async function main() {
  const {values:v,positionals:p}=parseArgs({allowPositionals:true,options:{'data-dir':{type:'string'},help:{type:'boolean',short:'h'},remark:{type:'string'},keyword:{type:'string'},time:{type:'string'},browser:{type:'string'},force:{type:'boolean'},online:{type:'boolean'},'dry-run':{type:'boolean'},'write-only':{type:'boolean'}}});
  if(v.help||!p.length){console.log(HELP);return;}
  const cmd=p[0];if(!['init','login','doctor','check','run','daemon','status','service'].includes(cmd))throw new Error('未知命令；用 --help 查看');
  if((cmd==='service'&&(!['install','remove'].includes(p[1])||p.length!==2))||(cmd!=='service'&&p.length!==1))throw new Error('命令参数不正确；用 --help 查看');
  const dataDir=path.resolve(v['data-dir']||defaultDataDir());
  if(dataDir===path.parse(dataDir).root)throw new Error('数据目录不能是文件系统根目录');
  const store=new Store(dataDir);
  if(cmd==='init'){await initialize(store,v);return;}
  if(cmd==='status'){output({dataDir,lastReport:store.read('last-result.json'),lastSession:store.read('last-session.json'),lastPreflight:store.read('last-preflight.json'),lastFailure:store.read('last-failure.json'),scheduler:store.read('scheduler.json')});return;}
  if(cmd==='service'&&p[1]==='remove') {output(await uninstallService({dataDir,apply:!v['write-only']}));return;}
  if(cmd==='doctor') {
    let config,configError;try{config=loadConfig(dataDir);}catch(e){configError=e.message;}
    const result={node:process.version,nodeSupported:Number(process.versions.node.split('.')[0])>=22,platform:process.platform,dataDir,configValid:!!config,configError,browser:config?.browserChannel,browserFound:config?browserInstalled(config):false};
    if(v.online&&config){result.online=await inspect({config,store,mode:'session'});}
    output(result);process.exitCode=result.nodeSupported&&result.configValid&&result.browserFound&&(!v.online||result.online?.result==='session_valid')?0:3;return;
  }
  const config=loadConfig(dataDir);
  if(cmd==='service') {output(await installService({dataDir,entrypoint:fileURLToPath(import.meta.url),node:process.execPath,apply:!v['write-only']}));return;}
  if(cmd==='login'){await login(config,store);return;}
  if(cmd==='daemon') {
    const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
    await daemon({config,store,signal:abort.signal});return;
  }
  const out=cmd==='check'?await inspect({config,store}):await runWithRetries({config,store,dryRun:!!v['dry-run']});
  output(out);process.exitCode=good.has(out.result)?0:3;
}
main().catch(e=>{console.error(JSON.stringify({result:'error',message:e instanceof Error?e.message:'运行失败'}));process.exitCode=3;});
