let timings = [];
export const getTimings = () => timings.map(item => ({...item}));
export class ApiError extends Error {
  constructor(code,message){super(message || code);this.code=code}
}
export function endpoint() {
  const s=window.MHS_CONFIG.apiUrl.trim();
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(s))
    throw new ApiError('CONFIG','URL /exec belum diatur. Hubungi pengelola untuk mengisi js/config.js.');
  return s;
}
async function read(url,options){
  const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),95000);
  try {
    const res=await fetch(url,{...options,credentials:'omit',redirect:'follow',cache:'no-store',referrerPolicy:'no-referrer',signal:ctl.signal});
    if(!res.ok)throw Error();
    const data=await res.json();
    if(typeof data.ok!=='boolean'||typeof data.code!=='string'||!data.apiVersion) throw Error();
    return data;
  }catch{throw new ApiError('TRANSPORT','Respons JSON tidak terbaca. Periksa jaringan, akses deployment /exec dan izin lintas domain.')}
  finally{clearTimeout(timer)}
}
export async function post(action,body={}) {
  const started = performance.now();
  const r=await read(endpoint(),{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({...body,action})});
  if (r.timings) {
    const durations = Object.fromEntries(Object.entries(r.timings)
      .filter(([key,value]) => /^[a-zA-Z]+Ms$/.test(key) && Number.isFinite(value)));
    timings.push({action, clientRequestMs:Math.round(performance.now()-started), ...durations});
    timings = timings.slice(-12);
  }
  if(!r.ok) throw new ApiError(r.code,r.message);
  return r;
}
export async function probe(){
  const health=await read(endpoint()+'?action=health',{method:'GET'});
  if(!health.ok||health.code!=='HEALTH_ONLY')throw new ApiError('HEALTH','Respons health tidak sesuai.');
  try{await post('ME')}catch(e){if(e.code==='SESSION_REQUIRED')return;throw e}
  throw new ApiError('PROBE','Respons uji POST tidak sesuai.');
}
