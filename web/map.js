'use strict';
(() => {
  const form=document.querySelector('#account-form');
  const field=name=>form.elements.namedItem(name);
  const dialog=document.querySelector('#map-dialog');
  const apply=document.querySelector('#map-apply');
  const readout=document.querySelector('#map-coordinate');
  const status=document.querySelector('#map-status');
  const mapName=document.querySelector('#map-name');
  const source=document.querySelector('#map-provider');
  const keyInput=document.querySelector('#baidu-ak');
  const connect=document.querySelector('#map-connect');
  const keyField=keyInput.closest('label');
  const keyHelp=document.querySelector('.map-source a');
  const container=document.querySelector('#location-map');
  let map,marker,provider,chosen,original,baiduPromise,baiduKey;
  const saved=key=>{try{return localStorage.getItem(key)||'';}catch{return '';}};
  const save=(key,value)=>{try{localStorage.setItem(key,value);}catch{}}
  const valid=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
  const schoolPoint={latitude:30.674521,longitude:104.096295};
  const toGcj=(lat,lng,from)=>{
    const [x,y]=from==='baidu'?coordtransform.bd09togcj02(lng,lat):coordtransform.wgs84togcj02(lng,lat);
    return {latitude:y,longitude:x};
  };
  function fromGcj(lat,lng,to){
    let [x,y]=to==='baidu'?coordtransform.gcj02tobd09(lng,lat):coordtransform.gcj02towgs84(lng,lat);
    // Iterate to keep a saved marker aligned with its exact GCJ-02 coordinates.
    for(let i=0;i<4;i++){const back=toGcj(y,x,to);x+=lng-back.longitude;y+=lat-back.latitude;}
    return {lat:y,lng:x};
  }
  function updateReadout(){readout.textContent=chosen?`GCJ-02 · 纬度 ${chosen.latitude.toFixed(6)} · 经度 ${chosen.longitude.toFixed(6)}`:'尚未选点 · 点击地图设置位置';apply.disabled=!chosen;}
  function showPoint(lat,lng,fromForm=false){
    if(!valid(lat,lng))return;
    chosen=fromForm&&original?{...original}:toGcj(lat,lng,provider);
    if(provider==='baidu'){
      const point=new BMap.Point(lng,lat);
      if(!marker){marker=new BMap.Marker(point);map.addOverlay(marker);marker.enableDragging();marker.addEventListener('dragend',e=>showPoint(e.point.lat,e.point.lng));}
      else marker.setPosition(point);
    }else{
      const point={lat,lng};
      if(!marker){marker=L.marker(point,{draggable:true,icon:L.divIcon({className:'map-pin',html:'<span></span>',iconSize:[30,38],iconAnchor:[15,38]})}).addTo(map);marker.on('dragend',()=>{const p=marker.getLatLng();showPoint(p.lat,p.lng);});}
      else marker.setLatLng(point);
    }
    updateReadout();
  }
  function reset(){
    const lat=Number(field('latitude').value),lng=Number(field('longitude').value);
    original=field('latitude').value!==''&&field('longitude').value!==''&&valid(lat,lng)?{latitude:lat,longitude:lng}:null;
    if(original){const p=fromGcj(lat,lng,provider);if(provider==='baidu')map.centerAndZoom(new BMap.Point(p.lng,p.lat),17);else map.setView([p.lat,p.lng],17);showPoint(p.lat,p.lng,true);}
    else{
      chosen=null;updateReadout();
      if(marker){if(provider==='baidu')map.removeOverlay(marker);else marker.remove();marker=null;}
      const p=fromGcj(schoolPoint.latitude,schoolPoint.longitude,provider);
      if(provider==='baidu')map.centerAndZoom(new BMap.Point(p.lng,p.lat),15);else map.setView([p.lat,p.lng],15);
    }
  }
  function clearMap(){
    if(provider==='osm'&&map)map.remove();
    if(provider==='baidu'&&map)map.clearOverlays();
    map=null;marker=null;provider=null;container.replaceChildren();
  }
  function syncControls(){const baidu=source.value==='baidu';keyField.hidden=!baidu;connect.hidden=!baidu;keyHelp.hidden=!baidu;}
  function initOsm(){
    map=L.map(container,{scrollWheelZoom:true,zoomControl:true});
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'}).addTo(map);
    map.on('click',e=>showPoint(e.latlng.lat,e.latlng.lng));
    tiles.on('tileerror',()=>{status.textContent='备用地图加载较慢或被拒绝。可申请免费的百度浏览器 AK，或手动填写 GCJ-02 坐标。';});
    tiles.on('tileload',()=>{status.textContent='OpenStreetMap 备用地图 · 点选后转换为 GCJ-02。';});
  }
  function loadBaidu(key){
    if(window.BMap&&baiduKey===key)return Promise.resolve();
    if(baiduPromise&&baiduKey===key)return baiduPromise;
    baiduKey=key;
    baiduPromise=new Promise((resolve,reject)=>{
      let complete=false;
      const callback='__goodnightBaiduReady';
      const finish=error=>{if(complete)return;complete=true;clearTimeout(timeout);delete window[callback];error?reject(error):resolve();};
      window[callback]=()=>window.BMap?finish():finish(new Error('百度地图接口未就绪'));
      const script=document.createElement('script');script.async=true;
      script.src=`https://api.map.baidu.com/api?v=3.0&ak=${encodeURIComponent(key)}&callback=${callback}`;
      script.onerror=()=>finish(new Error('百度地图脚本加载失败'));
      const timeout=setTimeout(()=>finish(new Error('百度地图加载超时，请检查 AK 和网络')),15000);
      document.head.appendChild(script);
    }).catch(e=>{baiduPromise=null;throw e;});
    return baiduPromise;
  }
  async function activate(next){
    if(next==='baidu'){
      const key=keyInput.value.trim();
      if(!/^[A-Za-z0-9_-]{5,128}$/.test(key)){status.textContent='请先填写百度地图“浏览器端”AK，再点击加载地图。';keyInput.focus();return;}
      save('goodnight.baiduAk',key);save('goodnight.mapProvider','baidu');
      status.textContent='正在加载百度地图…';connect.disabled=true;
      try{await loadBaidu(key);}catch(e){status.textContent=`${e.message}；可切换到 OpenStreetMap 备用地图。`;connect.disabled=false;return;}
      connect.disabled=false;
    }else save('goodnight.mapProvider','osm');
    if(!dialog.open)return;
    if(provider===next){reset();return;}
    clearMap();provider=next;
    if(next==='baidu'){
      map=new BMap.Map(container,{enableMapClick:false});map.enableScrollWheelZoom(true);
      map.addEventListener('click',e=>showPoint(e.point.lat,e.point.lng));
      status.textContent='百度地图 · 点选后由 BD-09 转换为学校使用的 GCJ-02。';
    }else initOsm();
    requestAnimationFrame(()=>{if(provider==='osm')map.invalidateSize();reset();});
  }
  document.querySelector('#open-map').addEventListener('click',()=>{
    mapName.value=field('locationName').value;
    keyInput.value=saved('goodnight.baiduAk');
    source.value=saved('goodnight.mapProvider')|| (keyInput.value?'baidu':'osm');
    syncControls();
    dialog.showModal();activate(source.value);
  });
  source.addEventListener('change',()=>{syncControls();activate(source.value);});
  connect.addEventListener('click',()=>activate(source.value));
  document.querySelector('#map-reset').addEventListener('click',()=>{if(map)reset();});
  apply.addEventListener('click',()=>{
    if(!chosen)return;
    field('locationMode').value='virtual';field('locationMode').dispatchEvent(new Event('change',{bubbles:true}));
    field('latitude').value=chosen.latitude.toFixed(6);field('longitude').value=chosen.longitude.toFixed(6);
    field('locationName').value=mapName.value.trim();dialog.close();
    document.querySelector('#form-error').textContent='地图位置已填入表单，点击“保存配置”后生效。';
  });
})();
