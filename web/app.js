'use strict';
const $=s=>document.querySelector(s);
const icons={grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M9 9h12"/>',account:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',history:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',settings:'<path d="m10 3 4 0 .6 2.3 2 .9 2.1-.8 2 3.5-1.5 1.6V13l1.5 1.6-2 3.5-2.1-.8-2 .9L14 21h-4l-.6-2.8-2-.9-2.1.8-2-3.5L4.8 13v-2.5L3.3 8.9l2-3.5 2.1.8 2-.9L10 3Z"/><circle cx="12" cy="12" r="3"/>',check:'<path d="m5 12 4 4L19 6"/>',alert:'<path d="M12 5v9M12 19v.1"/>',pin:'<circle cx="12" cy="10" r="3"/><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/>',target:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>'};
const icon=(name,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.account}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titles={accounts:'签到计划',activity:'运行记录'};
const results={success:'已确认成功',already_done:'今日已完成',dry_run_ready:'试运行通过',record_read:'读取成功',session_valid:'登录有效',preflight_ready:'预检通过',need_login:'需要重新登录',location_fail:'位置检查未通过',unknown:'结果待核对',window_not_open:'等待学校开放',window_missed:'已超出时段',already_running:'账号正在使用',checkin_rejected:'签到被拒绝',report_rejected:'报告被拒绝'};
const reasons={virtual_checkin_unavailable:'设置的位置不在可用签到范围，或当前无法签到。虚拟模式不会转交报告。',accuracy_insufficient:'定位精度未达到要求',location_unavailable_or_frontend_changed:'无法获取设备定位，或学校前端已变化',actual_location_mismatch:'设备定位与报告位置类型不符',saved_record_not_confirmed:'学校记录尚未确认，请读取今日记录',runtime_error:'运行异常，请检查网络、浏览器和配置',scheduler_error:'调度失败，请检查配置',recovery_cutoff_reached:'已到达你设置的截止时间',checkin_window_ended:'学校签到时段已结束',invalid_schedule:'无法确定学校开放时段'};
const actionNames={check:'读取今日记录','dry-run':'试运行',run:'立即执行',login:'学校登录',locations:'读取签到点',schedule:'自动调度',report:'每日执行',session:'认证检查',preflight:'提前预检',recovery:'补跑检查'};
const eventNames={today:'读取当天记录',prepared:'准备签到 / 报告',verification:'核对学校记录',submit_response:'学校返回响应',submit_response_unknown:'提交结果待核对',result:'运行结果',web_action:'网页操作',daemon_started:'后台调度启动',daemon_tick_error:'调度异常'};
let state=null,token='',view='accounts',logs=[],logAccount='all',loginAccount=null,toastTimer,refreshing=false,locationChoices=[];
const good=r=>['success','already_done','dry_run_ready','record_read','session_valid','preflight_ready'].includes(r);
function toast(message,error=false){clearTimeout(toastTimer);const el=$('#toast');el.textContent=message;el.className=`visible${error?' error':''}`;toastTimer=setTimeout(()=>{el.className='';},4500);}
async function api(path,options={}){
  const res=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json','X-GoodNight-Token':token,...options.headers}});
  let data;try{data=await res.json();}catch{throw new Error('本机服务未返回有效结果');}
  if(!res.ok)throw new Error(data.error||'操作失败');return data;
}
const post=(path,data={})=>api(path,{method:'POST',body:JSON.stringify(data)});
function dateTime(value,short=false){if(!value)return '尚未运行';const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...(short?{}:{month:'2-digit',day:'2-digit'}),hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date);}
function badge(result){return `<span class="badge ${good(result)?'green':result==='window_not_open'?'amber':result?'red':''}">${esc(results[result]||result||'尚未运行')}</span>`;}
function empty(title,description,button=''){return `<div class="empty"><span class="empty-icon">☾</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${button}</div>`;}
function heading(eyebrow,title,description,button=''){return `<section class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${button}</section>`;}
const addButton='<button class="button primary" data-action="add">＋ 添加打卡账号</button>';
function locationText(a){const c=a.config;return c.locationMode==='virtual'&&c.virtualLocation?`虚拟位置 · ${a.locationName?`${a.locationName} · `:''}${c.virtualLocation.latitude.toFixed(6)}, ${c.virtualLocation.longitude.toFixed(6)}`:'设备定位 · 真实位置';}
function statusText(a){if(a.loginOpen)return '浏览器登录窗口已打开，等待你完成认证';if(a.busy)return `正在${actionNames[a.busy]||'执行任务'}…`;if(a.lastAction?.out?.result==='need_login')return '学校登录已失效，请重新登录';if(a.confirmed)return '学校记录已确认今日完成';return a.lastAction?`${actionNames[a.lastAction.action]||'运行'} · ${results[a.lastAction.out.result]||a.lastAction.out.result}`:'尚未运行 · 建议先登录并试运行';}
function accountCard(a){
  const disabled=a.busy?'disabled':'';
  const point=a.config.virtualLocation&&a.config.locationMode==='virtual'?esc(`${a.locationName?`${a.locationName} · `:''}${a.config.virtualLocation.latitude}, ${a.config.virtualLocation.longitude}`):'运行时获取';
  return `<article class="panel account-card"><div class="account-card-head"><span class="account-symbol">${icon('account')}</span><div class="account-info"><strong>${esc(a.name)}</strong><p>${a.confirmed?'今日已确认完成':a.enabled?'自动计划运行中':'自动计划未开启'}</p></div>${a.enabled?'<span class="badge green">自动运行</span>':'<span class="badge">待开启</span>'}</div>
  <div class="keyval"><span>每日时段</span><strong>${esc(a.config.reportTime)} – ${esc(a.config.recoveryCutoff)} · 北京时间</strong></div>
  <div class="keyval"><span>签到位置</span><strong>${point}</strong></div>
  <div class="status-line">${a.busy?icon('refresh','spinning'):icon(a.confirmed?'check':'history')} &nbsp;${esc(statusText(a))}</div>
  <div class="account-card-bottom"><button class="button small ${a.enabled?'subtle':'primary'}" data-action="plan" data-id="${a.id}" ${disabled}>${a.enabled?'暂停计划':'开启自动计划'}</button><button class="button small subtle" data-action="edit" data-id="${a.id}" ${disabled}>编辑配置</button><button class="button small subtle" data-action="${a.loginOpen?'resume-login':'login'}" data-id="${a.id}" ${a.busy&&!a.loginOpen?'disabled':''}>${a.loginOpen?'完成登录':'学校登录'}</button></div>
  <details class="account-more"><summary>检查与管理</summary><div class="more-actions"><button class="button small subtle" data-action="export-mobile" data-id="${a.id}">复制手机配置</button><button class="button small subtle" data-action="check" data-id="${a.id}" ${disabled}>读取今日记录</button><button class="button small subtle" data-action="dry-run" data-id="${a.id}" ${disabled}>试运行</button><button class="button small subtle" data-action="run" data-id="${a.id}" ${disabled}>立即执行</button><button class="button small danger" data-action="delete" data-id="${a.id}" ${disabled}>删除账号</button></div></details></article>`;
}
function accountsView(){
  const accounts=state.accounts,done=accounts.filter(a=>a.confirmed).length,active=accounts.filter(a=>a.enabled).length;
  return heading('DAILY CHECK-IN','签到计划','配置位置与时间，查看学校记录和自动计划。',`<div class="heading-actions"><a class="button subtle" href="/manual">图文指南</a>${addButton}</div>`)+
    `<section class="checkin-summary" aria-label="今日概况"><div><strong>${done}<small> / ${accounts.length}</small></strong><span>今日已确认</span></div><div><strong>${active}</strong><span>自动计划已开启</span></div><p>最终结果以学校保存的记录为准。关闭网页不会停止本机后台任务。</p></section>`+
    `<div class="account-cards">${accounts.map(accountCard).join('')}</div>`+
    (accounts.length?'':`<section class="panel">${empty('先添加打卡账号','然后完成学校登录、地图选点和只读检查。','<a class="button subtle" href="/manual">查看图文步骤 →</a>')}</section>`);
}
function activityView(){return heading('ACTIVITY LOG','运行记录','查看最近七天的运行事件；每个账号最多显示最新 100 条。','<button class="button subtle" data-action="refresh">'+icon('refresh')+' 刷新记录</button>')+`<section class="panel"><div class="panel-head"><div><h2>执行时间线</h2><p>提交成功以学校保存的记录为准</p></div><div class="activity-tools"><select id="log-filter" aria-label="选择账号"><option value="all">全部账号</option>${state.accounts.map(a=>`<option value="${a.id}" ${a.id===logAccount?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div></div>${logs.length?`<div class="table-wrap"><table><thead><tr><th>北京时间</th><th>账号</th><th>事件</th><th>结果 / 说明</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${dateTime(l.at)}</td><td>${esc(l.accountName)}</td><td>${esc(actionNames[l.action]||eventNames[l.event]||l.phase||l.event)}</td><td>${l.result?badge(l.result):esc(l.status||'—')}${l.reason?`<div class="log-reason">${esc(reasons[l.reason]||l.reason)}</div>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('这里会记录每一次运行','完成登录后，执行一次读取记录或试运行。')}</section>`;}
function render(){if(!state)return;view=titles[location.hash.slice(1)]?location.hash.slice(1):'accounts';$('#page-name').textContent=titles[view];$('#avatar').textContent=state.displayName.slice(0,1);$('#nav-count').textContent=state.accounts.length;document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===view));$('#main').innerHTML=({accounts:accountsView,activity:activityView}[view])();}
async function loadLogs(){const selected=state.accounts.filter(a=>logAccount==='all'||a.id===logAccount);const groups=await Promise.all(selected.map(async a=>(await api(`/accounts/${a.id}/logs`)).map(l=>({...l,accountName:a.name}))));logs=groups.flat().sort((a,b)=>(b.at||'').localeCompare(a.at||'')).slice(0,200);}
async function refresh({quiet=false}={}){if(refreshing)return;refreshing=true;try{const next=await api('/state');token=next.token;state=next;$('#connection-state').innerHTML='<i></i> 本机运行';$('#connection-state').classList.remove('offline');if(view==='activity')await loadLogs();if(!document.querySelector('dialog[open]'))render();}catch(e){$('#connection-state').innerHTML='<i></i> 服务未连接';$('#connection-state').classList.add('offline');if(!quiet)toast(e.message,true);}finally{refreshing=false;}}
function field(name){return $('#account-form').elements.namedItem(name);}
function syncLocationFields(){const virtual=field('locationMode').value==='virtual';$('#virtual-fields').hidden=!virtual;for(const name of ['latitude','longitude','accuracy'])field(name).required=virtual;}
function edit(id){const a=state.accounts.find(x=>x.id===id),c=a?.config||{locationMode:'real',reportTime:'21:00',recoveryCutoff:'23:00',browserChannel:'chrome',locationType:'OUTSIDE',keyword:'旅游',remark:'在校外旅游会注意自己安全，导员放心'};$('#account-form').reset();field('id').value=id||'';field('name').value=a?.name||'';field('locationName').value=a?.locationName||'';for(const key of ['locationMode','reportTime','recoveryCutoff','browserChannel','locationType','keyword','remark'])field(key).value=c[key];field('latitude').value=c.virtualLocation?.latitude??'';field('longitude').value=c.virtualLocation?.longitude??'';field('accuracy').value=c.virtualLocation?.accuracy??20;$('#editor-title').textContent=a?'编辑打卡账号':'添加打卡账号';$('#form-error').textContent='';$('#location-options').replaceChildren();$('#load-locations').disabled=!a;$('#load-locations').title=a?'登录后读取学校返回的签到范围':'请先保存账号并完成学校登录';syncLocationFields();$('#editor').showModal();}
async function startLogin(id){loginAccount=id;$('#login-error').textContent='';await post(`/accounts/${id}/login`);$('#login-dialog').showModal();await refresh({quiet:true});}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.close){$('#'+button.dataset.close).close();return;}
  const {action,id}=button.dataset;if(!action)return;
  try{
    if(action==='add'){edit();return;}if(action==='edit'){edit(id);return;}

    if(action==='export-mobile'){const a=state.accounts.find(item=>item.id===id);const p=a?.config.virtualLocation;if(a?.config.locationMode!=='virtual'||!p)throw new Error('请先为该账号保存虚拟签到位置');const data={format:'goodnight-mobile-config',version:1,accountName:a.name,locationName:a.locationName||'',latitude:p.latitude,longitude:p.longitude,start:a.config.reportTime,end:a.config.recoveryCutoff,coordinateSystem:'GCJ-02'};const value=JSON.stringify(data);await navigator.clipboard.writeText(value);toast('手机配置已复制；粘贴导入后请在手机检查学校登录状态');return;}
    if(action==='refresh'){await refresh();toast('已更新最新记录');return;}
    if(action==='resume-login'){loginAccount=id;$('#login-error').textContent='';$('#login-dialog').showModal();return;}
    if(action==='login'){button.disabled=true;await startLogin(id);return;}
    if(action==='finish-login'){button.disabled=true;try{await post(`/accounts/${loginAccount}/login-finish`);$('#login-dialog').close();toast('学校登录验证成功');await refresh();}catch(e){$('#login-error').textContent=e.message;}return;}
    if(action==='cancel-login'){await post(`/accounts/${loginAccount}/login-cancel`);$('#login-dialog').close();await refresh();return;}
    if(action==='delete'){const a=state.accounts.find(x=>x.id===id);if(!confirm(`删除“${a.name}”并停止它的自动计划？账号数据将存档到本机，不再显示在工作台。`))return;button.disabled=true;await api(`/accounts/${id}`,{method:'DELETE'});toast(id==='local'?'已从工作台移除，原命令行数据仍保留':'账号已移除，数据保存在本机存档目录');await refresh();return;}
    if(action==='plan'){const a=state.accounts.find(x=>x.id===id);if(!a.enabled&&!confirm('开启后，将在每天设定的时段自动尝试签到；设备定位模式可能按配置提交报告。请确认位置和配置，并先完成登录与试运行。'))return;button.disabled=true;await post(`/accounts/${id}/plan`,{enabled:!a.enabled});toast(a.enabled?'已暂停自动计划':'自动计划已开启');await refresh();return;}
    if(['check','dry-run','run'].includes(action)){
      if(action==='run'&&!confirm('立即执行会尝试向学校提交真实签到或报告。确定继续？'))return;
      button.disabled=true;await post(`/accounts/${id}/${action}`,{confirm:action==='run'});toast(action==='run'?'执行已启动，请查看账号状态':'检查已启动，不会提交考勤');await refresh();return;
    }
  }catch(e){toast(e.message,true);}finally{button.disabled=false;}
});
$('#account-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;$('#form-error').textContent='';
  try{
    const id=field('id').value,previous=state.accounts.find(a=>a.id===id)?.config;
    const config={};for(const key of ['locationMode','reportTime','recoveryCutoff','browserChannel','locationType','keyword','remark'])config[key]=field(key).value;
    config.virtualLocation=config.locationMode==='virtual'?{latitude:Number(field('latitude').value),longitude:Number(field('longitude').value),accuracy:Number(field('accuracy').value)}:previous?.virtualLocation||null;
    const payload={name:field('name').value,locationName:field('locationName').value,config};
    await api(id?`/accounts/${id}`:'/accounts',{method:id?'PUT':'POST',body:JSON.stringify(payload)});
    $('#editor').close();location.hash='accounts';await refresh();toast(id?'配置已保存，网页调度会读取新配置':'账号已添加，请先完成学校登录');
  }catch(e){$('#form-error').textContent=e.message;}finally{button.disabled=false;}
});
field('locationMode').addEventListener('change',syncLocationFields);
$('#load-locations').addEventListener('click',async()=>{
  const button=$('#load-locations');button.disabled=true;$('#form-error').textContent='';
  try{const out=await post(`/accounts/${field('id').value}/locations`);if(out.result!=='record_read')throw new Error(out.result==='need_login'?'请先保存并关闭配置，然后完成学校登录':'暂时无法读取签到点，请检查登录与网络');locationChoices=out.locations;$('#location-options').innerHTML=locationChoices.length?locationChoices.map((p,i)=>`<button class="location-option" type="button" data-location-index="${i}">${esc(p.name)} <small>纬度 ${p.latitude} · 经度 ${p.longitude} · 范围 ${p.radiusMeter} 米</small></button>`).join(''):'<p class="hint">学校未返回可用签到点。</p>';}catch(e){$('#form-error').textContent=e.message;}finally{button.disabled=false;}
});
$('#location-options').addEventListener('click',event=>{const button=event.target.closest('[data-location-index]');if(!button)return;const p=locationChoices[Number(button.dataset.locationIndex)];field('locationMode').value='virtual';field('locationName').value=p.name;field('latitude').value=p.latitude;field('longitude').value=p.longitude;field('accuracy').value=20;syncLocationFields();toast(`已选择 ${p.name}，保存配置后生效`);});
document.addEventListener('change',async event=>{if(event.target.id==='log-filter'){logAccount=event.target.value;try{await loadLogs();render();}catch(e){toast(e.message,true);}}});
$('#login-dialog').addEventListener('cancel',event=>{event.preventDefault();post(`/accounts/${loginAccount}/login-cancel`).catch(()=>{}).finally(()=>{$('#login-dialog').close();refresh({quiet:true});});});
window.addEventListener('hashchange',async()=>{view=titles[location.hash.slice(1)]?location.hash.slice(1):'accounts';if(view==='activity'&&state)try{await loadLogs();}catch(e){toast(e.message,true);}render();});
function clock(){const now=new Date();$('#clock').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);}
clock();setInterval(clock,15000);refresh();setInterval(()=>refresh({quiet:true}),5000);
