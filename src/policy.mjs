export const apiSucceeded = r => r?.code === 0 && r.ok !== false;
export const shanghaiDate = (now = new Date()) => now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
export function summary(r) { return { code:r?.code, businessDate:r?.data?.businessDate, status:r?.data?.recordStatusCode }; }
const TERMINAL = new Set(['STUDENT_REPORTED','INSTRUCTOR_REPORTED','CHECKED_IN','EXEMPT']);
export function todayState(r, now = new Date()) {
 if (!apiSucceeded(r) || r.data?.businessDate !== shanghaiDate(now)) return 'unknown';
 if(r.data.recordStatusCode==='PENDING')return 'pending';
 return TERMINAL.has(r.data.recordStatusCode)?'done':'unknown';
}
export function selectKeyword(response, config) {
 if(!apiSucceeded(response)||!Array.isArray(response.data))throw new Error('case_keywords_unavailable');
 const items=response.data.filter(x=>x.keyword===config.keyword&&x.situationTypeCode===config.locationType&&x.statusCode==='ACTIVE');
 if(items.length!==1||!items[0].id)throw new Error('report_option_changed');
 return {caseKeywordId:items[0].id,caseKeyword:items[0].keyword};
}
export function reportVerified(response,date,config) {
 return apiSucceeded(response)&&response.data?.businessDate===date&&response.data.recordStatusCode==='STUDENT_REPORTED'
  &&response.data.reportedLocationTypeCode===config.locationType&&response.data.caseKeyword===config.keyword&&response.data.caseRemark===config.remark;
}
export function reportWindow(schedule, businessDate, now = new Date()) {
  if (!apiSucceeded(schedule) || businessDate !== shanghaiDate(now)) return {result:'window_missed',reason:'invalid_business_date_or_schedule'};
  const d=schedule.data;
  const offsets=d && [d.studentSubmissionStartOffsetMinute,d.studentSubmissionEndOffsetMinute,d.studentReportStartOffsetMinute,d.studentReportEndOffsetMinute];
  if (!offsets || offsets.some(x=>!Number.isFinite(x) || x<0) || offsets[0]>=offsets[1] || offsets[2]>=offsets[3]) return {result:'window_missed',reason:'invalid_schedule'};
  const midnight=Date.parse(`${businessDate}T00:00:00+08:00`);
  const windows=[[offsets[0],offsets[1]],[offsets[2],offsets[3]]].map(([s,e])=>[midnight+s*60000,Math.min(midnight+e*60000,midnight+86400000)]).sort((a,b)=>a[0]-b[0]);
  // Merge touching windows; safety margin applies to the end, not their common boundary.
  const merged=[];
  for (const [s,e] of windows) {const last=merged.at(-1);if(last && s<=last[1])last[1]=Math.max(last[1],e);else merged.push([s,e]);}
  const t=now.getTime();
  if(merged.some(([s,e])=>t>=s && t<e-300000)) return {result:'open',businessDate};
  const next=merged.find(([s,e])=>t<s && s<e-300000);
  return next ? {result:'window_not_open',businessDate,nextAttemptAt:new Date(next[0]).toISOString()} : {result:'window_missed',reason:'too_close_to_end'};
}
function ringContains(p, ring) {
  if(!Array.isArray(ring) || ring.length<3 || ring.some(x=>!Array.isArray(x)||x.length<2||!Number.isFinite(x[0])||!Number.isFinite(x[1])||Math.abs(x[0])>180||Math.abs(x[1])>90))throw new Error('invalid_campus_polygon');
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [x,y]=ring[i], [xx,yy]=ring[j], dx=xx-x,dy=yy-y,len=dx*dx+dy*dy;
    const t=len?Math.max(0,Math.min(1,((p.longitude-x)*dx+(p.latitude-y)*dy)/len)):0;
    if(Math.hypot(p.longitude-x-dx*t,p.latitude-y-dy*t)<=5e-5)return true;
    if((y>p.latitude)!==(yy>p.latitude) && p.longitude<(xx-x)*(p.latitude-y)/(yy-y)+x)inside=!inside;
  }
  return inside;
}
export function geometryContains(p,g) {
  if(!g)throw new Error('missing_campus_geometry');
  if(g.type==='Feature')return geometryContains(p,g.geometry);
  if(g.type==='FeatureCollection'){if(!Array.isArray(g.features)||!g.features.length)throw new Error('empty_campus_geometry');return g.features.map(x=>geometryContains(p,x)).some(Boolean);}
  if(g.type==='Polygon') {if(!g.coordinates?.length)throw new Error('empty_campus_polygon');const inside=g.coordinates.map(r=>ringContains(p,r));return inside[0]&&!inside.slice(1).some(Boolean);}
  if(g.type==='MultiPolygon'){if(!Array.isArray(g.coordinates)||!g.coordinates.length)throw new Error('empty_campus_geometry');return g.coordinates.map(c=>geometryContains(p,{type:'Polygon',coordinates:c})).some(Boolean);}
  throw new Error('unsupported_campus_geometry');
}
export function locationType(location, response) {
  if(![location?.latitude,location?.longitude,location?.accuracy].every(Number.isFinite)||location.accuracy<0||Math.abs(location.latitude)>90||Math.abs(location.longitude)>180)throw new Error('invalid_location');
  if(!apiSucceeded(response)||!Array.isArray(response.data)||!response.data.length)throw new Error('campus_fences_unavailable');
  return response.data.map(f=>geometryContains(location,JSON.parse(f.fenceGeojson))).some(Boolean)?'CAMPUS':'OUTSIDE';
}
export function checkinWindow(schedule,date,now=new Date()) {
 const d=schedule?.data;
 if(!apiSucceeded(schedule)||date!==shanghaiDate(now)||!Number.isFinite(d?.studentCheckinStartOffsetMinute)||!Number.isFinite(d?.studentCheckinEndOffsetMinute))return {result:'window_missed',reason:'invalid_schedule'};
 const midnight=Date.parse(`${date}T00:00:00+08:00`),start=midnight+d.studentCheckinStartOffsetMinute*60000,end=Math.min(midnight+d.studentCheckinEndOffsetMinute*60000,midnight+86400000)-300000;
 if(start<midnight||start>=end)return {result:'window_missed',reason:'invalid_schedule'};
 if(now.getTime()<start)return {result:'window_not_open',businessDate:date,nextAttemptAt:new Date(start).toISOString()};
 return now.getTime()<end?{result:'open',businessDate:date}:{result:'window_missed',reason:'checkin_window_ended'};
}
export function checkinVerified(r,date) {return apiSucceeded(r)&&r.data?.businessDate===date&&r.data.recordStatusCode==='CHECKED_IN';}
export function findDorm(geo,response) {
 if(!apiSucceeded(response)||!Array.isArray(response.data))throw new Error('dorm_fences_unavailable');
 if(![geo?.latitude,geo?.longitude].every(Number.isFinite)||Math.abs(geo.latitude)>90||Math.abs(geo.longitude)>180)throw new Error('invalid_location');
 const toRad=x=>x*Math.PI/180;
 return response.data.map(f=>{
  if(![f.latitude,f.longitude,f.radiusMeter].every(Number.isFinite)||Math.abs(f.latitude)>90||Math.abs(f.longitude)>180||f.radiusMeter<=0)throw new Error('invalid_dorm_fence');
  const dlat=toRad(geo.latitude-f.latitude),dlon=toRad(geo.longitude-f.longitude);
  const hav=Math.sin(dlat/2)**2+Math.cos(toRad(geo.latitude))*Math.cos(toRad(f.latitude))*Math.sin(dlon/2)**2;
  return {f,inside:2*Math.asin(Math.sqrt(Math.min(1,hav)))*6378137<=f.radiusMeter};
 }).find(x=>x.inside)?.f||null;
}
