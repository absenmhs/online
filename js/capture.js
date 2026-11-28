import {loadLandmarker,readPose,poseMatches,directions} from './liveness.js';
import {distanceTo} from './office-map.js';
import {drawCaptureOfficeMap} from './capture-office-map14.js';

function snapshot(video){
  const canvas=document.createElement('canvas'),scale=Math.min(1,512/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,canvas.width,canvas.height);
  for(const quality of [0.77,0.60,0.45]){
    const url=canvas.toDataURL('image/jpeg',quality);
    if(url.startsWith('data:image/jpeg;base64,')&&url.length-23<=160000)return url;
  }
  throw Error('Foto terlalu besar untuk dikirim. Ulangi perekaman.');
}
async function digestPhoto(url){
  const bytes=Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
function cameraError(e){
  if(e.name==='NotAllowedError')return 'Kamera belum mendapat izin. Izinkan kamera untuk situs ini, kemudian rekam ulang.';
  if(e.name==='NotReadableError')return 'Kamera sedang dipakai. Tutup aplikasi kamera lain dan coba lagi.';
  return 'Kamera depan belum tersedia. Periksa izin dan perangkat kamera.';
}
export async function recordAttendance({dialog,title,type,call,send,checkReceipt,alive,describe,onAccepted,onDisabled}){
  const panel=dialog.querySelector('#panel');
  panel.innerHTML='<section class="capture" data-view="location"><div class="camera-box"><video muted autoplay playsinline></video>'+
    '<img class="proof-preview" alt="Foto presensi untuk ditinjau" hidden></div><header class="camera-header"><h2 id="capture-title"></h2>'+
    '<small class="mobile-test-banner" hidden></small></header><div class="face-guide" aria-hidden="true"></div>'+
    '<div class="capture-dock"><div class="capture-geo"><h3 class="capture-geo-title">Memeriksa lokasi</h3><b class="office-name">Lokasi presensi</b>'+
    '<div class="office-map hf14-map" aria-label="Peta target presensi dan lokasi perangkat"></div><div class="hf14-map-legend"><span><i class="hf14-swatch hf14-swatch-office"></i> Titik kantor</span><span><i class="hf14-swatch hf14-swatch-device"></i> Perangkat Anda</span></div><p class="capture-distance" role="status"></p><div class="capture-location-status"><div class="capture-location-loading" aria-hidden="true"><span class="capture-location-spinner"></span></div><p class="fix" role="status" aria-live="polite"></p></div></div>'+
    '<ol class="challenge-list" aria-label="Tiga tantangan wajah" hidden></ol><div class="capture-camera-state"><span class="capture-camera-label">Kamera</span><div class="capture-status" role="status"></div></div>'+
    '<div class="capture-failure" role="alert" hidden><h3 class="capture-failure-heading"></h3><p class="capture-failure-detail"></p></div>'+
    '<p class="countdown" hidden></p><div class="capture-actions"><button class="primary" data-c="lock" disabled>Kunci Lokasi</button>'+
    '<button class="primary" data-c="start" hidden disabled>Mulai Tantangan</button>'+
    '<button class="primary" data-c="send" hidden>Kirim Presensi</button><button class="secondary" data-c="retake" hidden>Ambil Ulang Foto</button></div></div></section>';
  panel.querySelector('h2').textContent=title;
  dialog.classList.add('recording');dialog.setAttribute('aria-labelledby','capture-title');
  if(!dialog.open)dialog.showModal();
  const $=s=>panel.querySelector(s),video=$('video'),photo=$('.proof-preview'),status=$('.capture-status'),geo=$('.capture-geo'),
    clock=$('.countdown'),fixText=$('.fix'),gpsLoader=$('.capture-location-loading'),map=$('.office-map'),banner=$('.mobile-test-banner'),lock=$('[data-c=lock]'),start=$('[data-c=start]'),submit=$('[data-c=send]'),retake=$('[data-c=retake]'),distanceText=$('.capture-distance');
  const capture=$('.capture'),list=$('.challenge-list'),gpsFailure=$('.capture-failure'),gpsFailureTitle=$('.capture-failure-heading'),gpsFailureDetail=$('.capture-failure-detail');
  // HF12-R4: four user-facing outcomes, with internal codes never printed.
  // Security thresholds, raw counts, and pattern flags stay in operator logs.
  const gpsFailures={
    A:{classification:'A',title:'Proses Memuat Lokasi Gagal',
      message:'Sistem belum berhasil memperoleh informasi lokasi perangkat Anda. Pastikan GPS aktif, izin lokasi telah diberikan, dan koneksi internet stabil. Silakan ulangi proses absensi.'},
    B:{classification:'B',title:'Pemeriksaan Lokasi Tidak Berhasil',
      message:'Terdeteksi pola lokasi yang sangat tidak wajar pada perangkat Anda. Aplikasi pengubah lokasi (fake GPS atau sejenisnya) dapat menyebabkan kondisi ini. Jika aplikasi tersebut terpasang, harap nonaktifkan atau hapus terlebih dahulu, lalu ulangi proses absensi.'},
    C:{classification:'C',title:'Lokasi Belum Dapat Dipastikan',
      message:'Sistem telah menerima informasi lokasi, tetapi hasil pemeriksaan belum dapat dipastikan. Pastikan GPS aktif dan koneksi internet stabil, kemudian ulangi proses absensi. Anda tidak perlu berpindah tempat.'},
    D:{classification:'D',title:'Lokasi Belum Memenuhi Persyaratan',
      message:'Sistem belum dapat mengonfirmasi lokasi perangkat di area kerja yang ditentukan. Pastikan Anda berada di lokasi bertugas, lalu ulangi pemeriksaan. Jika sudah berada di kantor, hubungi petugas untuk mendapatkan bantuan.'}
  };
  const locationFailure=gpsFailures.A;
  const locationLoading='Memeriksa lokasi perangkat. Pastikan GPS aktif dan koneksi internet stabil.';
  const locationWaiting='Pemeriksaan lokasi masih berlangsung. Pastikan GPS tetap aktif dan koneksi internet stabil.';
  function highlight(index){
    Array.from(list.children).forEach((el,i)=>{
      el.dataset.step=i<index?'done':i===index?'current':'next';
      if(i===index)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
      el.firstChild.textContent=i<index?'✓':String(i+1);
    });
  }
  const abort=new AbortController(),events={signal:abort.signal};
  let phase='setup',stream,model,watch=null,frame=0,pulse=null,office,info,fix,lockState,image='',steps=[],digest='',
    frontReady=false,infoAt=0,expiresPerf=0,expiresWall=0,disposed=false,challengeEnd=0,facePrepUntil=0;
  let gpsSamples=[],gpsHistory=[],gpsStartedAt=0,gpsPollAt=0,gpsPolling=false,gpsReportSent=false,gpsPatternAdvisory=false;
  let gpsRawCount=0,gpsDuplicateTimestampCount=0,gpsInvalidCount=0,faceWaitAt=0;
  const gpsAttemptId=crypto.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=crypto.getRandomValues(new Uint8Array(1))[0]&15;return (c==='x'?n:((n&3)|8)).toString(16);});
  function gpsSettings(){return info?.gpsPrecheck||{minSamples:8,minDistinct:3,minSpanMs:3000,
    initialWaitMs:60000,maxWaitMs:120000,maxSamples:15};}
  function gpsInside(sample){
    return office&&sample&&sample.gpsAccuracy>0&&sample.gpsAccuracy<=office.maxAccuracy&&
      distanceTo(office,sample)+sample.gpsAccuracy<=office.radius;
  }
  function distinctInside(){
    const unique=[];
    for(const sample of gpsSamples){
      if(!gpsInside(sample))continue;
      if(!unique.some(p=>distanceTo({lat:p.latitude,lon:p.longitude},sample)<=0.01))unique.push(sample);
    }
    return unique.length;
  }
  // Coordinate-pattern signal is updated on each accepted sample. It is
  // advisory only, and never vetoes an otherwise healthy Dynamic GPS reading.
  // JS numeric coordinates do not preserve trailing zeros from Android.
  function gpsStrongNumericPattern(sample){
    const digits=n=>(Math.abs(n)%1).toFixed(8).slice(2).replace(/0+$/,'');
    const lat=digits(sample.latitude),lon=digits(sample.longitude);
    const repeated=v=>/^(\d)\1{3,}$/.test(v);
    return (lat.length<=3&&lon.length<=3)||(repeated(lat)&&repeated(lon));
  }
  function gpsPatternConcern(){
    const unique=[];
    for(const s of temporalEvidence()){
      if(!gpsInside(s))continue;
      if(!unique.some(p=>distanceTo({lat:p.latitude,lon:p.longitude},s)<=0.01))unique.push(s);
    }
    return unique.length>0&&unique.every(gpsStrongNumericPattern);
  }
  function temporalEvidence(){
    // Keep normal lock samples capped at 15. Separately select up to 15
    // representative fresh fixes across the full monitoring interval.
    // This preserves elapsed-time evidence when the browser emits ~1Hz fixes.
    if(gpsHistory.length<=gpsSettings().maxSamples)return gpsHistory;
    const n=gpsHistory.length-1,limit=gpsSettings().maxSamples;
    return Array.from({length:limit},(_,i)=>gpsHistory[Math.floor(i*n/(limit-1))]);
  }
  function gpsPrelockClassification(){
    // A = missing/old data; D = latest fix out of geofence/accuracy;
    // C = enough readings but too little variation; B = corroborated high risk.
    // Only classify after the normal chance to collect fresh fixes has elapsed.
    if(info?.mobileTest)return '';
    const cfg=gpsSettings(),last=gpsSamples.at(-1);
    if(info?.gpsProtectionMode==='INACTIVE')
      return last&&Date.now()-last.at<=15000&&!gpsInside(last)?'D':'A';
    if(gpsSamples.length<cfg.minSamples||!last||Date.now()-last.at>15000)return 'A';
    if(!gpsInside(last))return 'D';
    if(last.at-gpsSamples[0].at<cfg.minSpanMs)return 'A';
    if(distinctInside()>=cfg.minDistinct)return '';
    const allInside=gpsSamples.every(gpsInside);
    const history=temporalEvidence();
    return allInside&&history.length>=cfg.minSamples&&history.at(-1).at-history[0].at>=45000&&gpsPatternAdvisory?'B':'C';
  }
  function serverAligned(){
    const newest=gpsSamples.at(-1);
    if(!newest)return {fix:null,samples:[]};
    const measuredAt=Math.round(info.serverNow+(performance.now()-infoAt)-(Date.now()-newest.at));
    const mapSample=s=>({latitude:s.latitude,longitude:s.longitude,
      gpsAccuracy:s.gpsAccuracy,measuredAt:measuredAt-(newest.at-s.at)});
    const samples=gpsSamples.map(mapSample),history=temporalEvidence().map(mapSample);
    return {fix:{latitude:newest.latitude,longitude:newest.longitude,gpsAccuracy:newest.gpsAccuracy,measuredAt},samples,history};
  }
  async function reportPrelock(){
    if(gpsReportSent||!current()||phase!=='location'||info?.mobileTest)return;
    const localClass=gpsPrelockClassification()||'A';
    if(info?.gpsProtectionMode==='INACTIVE'){fail(gpsFailures[localClass]||locationFailure);return;}
    gpsReportSent=true;phase='reporting';lock.disabled=true;lock.textContent='Memeriksa lokasi…';
    status.textContent='';fixText.textContent='Pemeriksaan lokasi belum berhasil. Menyiapkan hasil pemeriksaan…';
    let logged=false,classification=localClass;
    try{
      const reply=await api('CAPTURE_GPS_REPORT',{type,testRunId:info.testRunId,
        scheduleId:info.scheduleId,shiftDate:info.shiftDate,officeId:office.id,
        gpsProtectionMode:info.gpsProtectionMode||'ACTIVE',attemptId:gpsAttemptId,
        diagnostics:{received:gpsRawCount,duplicateTimestamp:gpsDuplicateTimestampCount,
          invalid:gpsInvalidCount,elapsedMs:Math.max(0,Date.now()-gpsStartedAt)},
        ...serverAligned()});
      logged=reply?.logged===true&&reply.code==='GPS_REPORT_RECORDED';
      if(logged&&['A','B','C','D'].includes(reply.classification))classification=reply.classification;
      else if(localClass==='B')classification='A'; // never accuse based on local-only pattern
    }catch(e){
      console.warn('GPS_PRECHECK_REPORT_UNAVAILABLE');
      if(localClass==='B')classification='A';
    }
    if(!current()||phase!=='reporting')return;
    const base=gpsFailures[classification]||locationFailure;
    fail(classification==='B'&&logged?{...base,
      message:base.message+' Hasil pemeriksaan telah dicatat untuk ditinjau Operator.'}:base);
  }
  function samplesReady(){
    if(info?.mobileTest||info?.gpsProtectionMode==='INACTIVE')return true;
    const cfg=gpsSettings();
    return gpsSamples.length>=cfg.minSamples&&distinctInside()>=cfg.minDistinct&&
      gpsSamples.at(-1).at-gpsSamples[0].at>=cfg.minSpanMs&&
      Date.now()-gpsSamples.at(-1).at<=15000;
  }
  function collectPosition(position){
    if(!current()||!['setup','location'].includes(phase))return;
    gpsRawCount++;
    const c=position.coords,at=position.timestamp;
    if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||!Number.isFinite(c.accuracy)||
      Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||c.accuracy<=0||
      !Number.isFinite(at)||at>Date.now()+1000||Date.now()-at>15000){gpsInvalidCount++;return;}
    if(gpsSamples.length&&at<=gpsSamples.at(-1).at){gpsDuplicateTimestampCount++;return;} // cached timestamp is not new data
    const sample={latitude:c.latitude,longitude:c.longitude,gpsAccuracy:c.accuracy,at};
    gpsSamples.push(sample);gpsHistory.push(sample);
    const recent=at-(gpsSettings().maxWaitMs+10000);
    gpsSamples=gpsSamples.filter(p=>p.at>=recent).slice(-gpsSettings().maxSamples);
    gpsHistory=gpsHistory.filter(p=>p.at>=recent).slice(-180);
    fix=sample;
    // Pattern runs from the first available fixes; advisory only. Backend
    // recomputes it when location is locked, never trusting this boolean.
    gpsPatternAdvisory=gpsPatternConcern();
    updateFix();
  }
  const closeButton=dialog.querySelector('#close');
  // A server timestamp is sampled after its request starts. Use the tightest
  // upper bound across the three replies so transit cannot extend the deadline.
  let serverOffsetUpper=Infinity;
  async function timedCall(route,payload){
    const start=performance.now(),reply=await api(route,payload);
    if(!Number.isFinite(reply.serverNow))throw Error('Sesi belum dapat dimulai. Silakan rekam ulang presensi.');
    serverOffsetUpper=Math.min(serverOffsetUpper,reply.serverNow-start);
    return reply;
  }
  function busyButton(button,caption,loading){
    button.textContent=caption;
    button.setAttribute('aria-busy',String(loading));
    button.disabled=loading;
  }
  const current=()=>!disposed&&dialog.open&&alive();
  const api=(route,payload)=>call(route,{payload});
  // Camera acquisition and MediaPipe loading can hang independently of GPS.
  // Late resolutions are cleaned up so a timed-out camera/model is not leaked.
  function boundedCamera(promise,ms,message,cleanup){
    let timer,expired=false;
    const task=Promise.resolve(promise).then(value=>{
      if(expired){try{cleanup?.(value);}catch(_){/* already disposed */}throw Error(message);}
      return value;
    });
    return Promise.race([task,new Promise((_,reject)=>{
      timer=setTimeout(()=>{expired=true;reject(Error(message));},ms);
    })]).finally(()=>clearTimeout(timer));
  }
  const cameraOff=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;};
  function halt(){
    cancelAnimationFrame(frame);cameraOff();
    if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}
    model?.close();model=null;
  }
  function forget(){image='';photo.removeAttribute('src');photo.hidden=true;digest='';}
  let finish;
  const closed=new Promise(resolve=>{finish=resolve;});
  function dispose(){
    if(disposed)return;disposed=true;closeButton.disabled=false;halt();forget();clearInterval(pulse);abort.abort();dialog.classList.remove('recording');dialog.removeAttribute('aria-labelledby');finish();
  }
  function fail(message){
    if(!current())return;
    phase='failed';capture.dataset.view='failed';list.hidden=true;gpsLoader.hidden=true;status.classList.remove('capture-working');halt();forget();video.hidden=true;geo.hidden=true;clock.hidden=true;
    closeButton.disabled=retake.disabled=false;lock.hidden=start.hidden=submit.hidden=true;retake.hidden=false;retake.textContent='Rekam ulang';
    // HF12-R3: title and explanatory text occupy separate visual panels.
    // A/B/C/D codes remain internal and never appear in employee-facing text.
    if(message&&typeof message==='object'&&['A','B','C','D'].includes(message.classification)&&
       typeof message.title==='string'&&typeof message.message==='string'){
      status.textContent='';status.hidden=true;gpsFailureTitle.textContent=message.title;
      gpsFailureDetail.textContent=message.message;gpsFailure.dataset.classification=message.classification;
      gpsFailure.hidden=false;
    }else{
      // Apply the same separate title/detail hierarchy to camera and network
      // errors; hiding the camera readiness card must never hide error text.
      const detail=String(message||'Perekaman belum berhasil. Silakan coba kembali.');
      status.textContent='';status.hidden=true;
      gpsFailure.removeAttribute('data-classification');
      gpsFailureTitle.textContent=/^(Kamera|Gambar kamera)/i.test(detail)?'Kamera Belum Siap':'Perekaman Belum Berhasil';
      gpsFailureDetail.textContent=detail;gpsFailure.hidden=false;
    }
  }
  function handleError(e){
    if(e.code==='POC_WRITE_DISABLED'||e.code==='SIMULATION_PANEL_ONLY')onDisabled();
    fail(describe(e));
  }
  function updateFix(){
    if(!current()||phase!=='location'||!office)return;
    if(info?.mobileTest&&fix)fix.at=Date.now();
    const good=fix&&Date.now()-fix.at<=15000&&Date.now()>=fix.at-1000;
    const ready=samplesReady(),elapsed=gpsStartedAt?Date.now()-gpsStartedAt:0;
    const inside=good&&gpsInside(fix);
    if(!info.mobileTest&&info.gpsProtectionMode!=='INACTIVE'&&elapsed>=90000&&
       gpsPrelockClassification()==='B'){
      reportPrelock().catch(()=>fail(locationFailure));return;
    }
    if(!info.mobileTest&&gpsStartedAt&&elapsed>=gpsSettings().maxWaitMs&&
       (!good||!inside||!ready)){
      reportPrelock().catch(()=>fail(locationFailure));return;
    }
    const gpsReady=!!(inside&&ready);
    lock.disabled=!gpsReady;
    lock.textContent=gpsReady?'Kunci Lokasi':'Menunggu lokasi';
    gpsLoader.hidden=!!info.mobileTest||gpsReady;
    const gpsMessage=info.mobileTest?'MODE UJI · Lokasi simulasi':
      !good||!ready?(elapsed>=gpsSettings().initialWaitMs?
        (gpsSamples.length>=gpsSettings().minSamples&&distinctInside()<=1?
          'Sedang memuat pola lokasi. Pastikan GPS aktif dan koneksi internet stabil.':locationWaiting):locationLoading):
      inside?'Lokasi memenuhi persyaratan. Silakan kunci lokasi.':
        'Lokasi belum sesuai area kerja. Pastikan posisi perangkat berada dekat titik kantor.';
    if(fixText.textContent!==gpsMessage)fixText.textContent=gpsMessage;
    const meters=good?distanceTo(office,fix):null;
    distanceText.textContent=meters===null?
      'Titik ungu menunjukkan pusat kantor. Titik biru akan muncul saat GPS tersedia.':
      `Perkiraan jarak: ${Math.round(meters)} m · Radius kantor: ${Math.round(office.radius)} m. `+
      (gpsReady?'Lokasi siap.':'Akurasi GPS juga diperhitungkan.');
    drawCaptureOfficeMap(map,office,good?fix:null);
  }
  // Some browsers emit watchPosition only when movement is detected. Request
  // additional fresh fixes without inventing motion or reusing timestamps.
  function requestExtraPosition(){
    if(!gpsStartedAt||!navigator.geolocation||info?.mobileTest||info?.gpsProtectionMode==='INACTIVE'||
       (samplesReady()&&gpsInside(fix))||gpsPolling||
       !['setup','location'].includes(phase)||Date.now()-gpsPollAt<4500)return;
    gpsPolling=true;gpsPollAt=Date.now();
    navigator.geolocation.getCurrentPosition(p=>{gpsPolling=false;collectPosition(p);},()=>{gpsPolling=false;},
      {enableHighAccuracy:true,maximumAge:0,timeout:12000});
  }
  async function setup(){
    if(!navigator.onLine)throw Error('Hubungkan internet untuk memulai sesi perekaman.');
    status.textContent='Memeriksa jadwal dan lokasi kantor.';
    info=await timedCall('CAPTURE_INFO',{type});if(!current())return;
    if(!info.mobileTest&&!navigator.geolocation)throw Error('Browser memerlukan akses lokasi melalui HTTPS.');
    infoAt=performance.now();office=info.office;$('.office-name').textContent=office.name;
    banner.hidden=info.mobileTest!==true;
    if(info.mobileTest){
      banner.textContent='MODE UJI · GPS simulasi'+(info.testRunId?' · '+info.testRunId.slice(0,8):'');
      if(!info.testFix)throw Error('Mode uji GPS belum tersedia di backend.');
      fix={...info.testFix,at:Date.now()};gpsLoader.hidden=true;
    }
    // HF14: GPS is window one. No camera permission, MediaPipe download,
    // or face-readiness requirement can block locking a valid location.
    phase='location';gpsStartedAt=info.mobileTest?0:Date.now();
    status.textContent='';
    if(!info.mobileTest){
      watch=navigator.geolocation.watchPosition(collectPosition,
        e=>{if(e.code===1){fail(locationFailure);return;}fix=null;updateFix();},
        {enableHighAccuracy:true,maximumAge:0,timeout:15000});
    }
    updateFix();
  }
  async function begin(){
    updateFix();if(lock.disabled||phase!=='location')return;
    phase='locking';busyButton(lock,'Mengunci lokasi…',true);
    if(info.mobileTest)fix.at=Date.now();
    const aligned=info.mobileTest?null:serverAligned();
    const measuredAt=info.mobileTest?
      Math.round(info.serverNow+(performance.now()-infoAt)-(Date.now()-fix.at)):
      aligned.fix.measuredAt;
    const reply=await timedCall('CAPTURE_LOCK',{type,testRunId:info.testRunId,
      scheduleId:info.scheduleId,shiftDate:info.shiftDate,officeId:office.id,
      flow:'STAGED_HF14',gpsProtectionMode:info.gpsProtectionMode||'ACTIVE',
      fix:{...fix,measuredAt},samples:info.gpsProtectionMode==='INACTIVE'?[]:aligned.samples});
    if(!current()||phase!=='locking')return;
    if(reply.code!=='LOCATION_LOCKED_PENDING_FACE'||!reply.submissionId||
       !Number.isFinite(reply.facePrepEnds))throw Error('Alur pemeriksaan wajah HF14 belum aktif di backend. Perbarui deployment Apps Script.');
    lockState=reply;
    facePrepUntil=performance.now()+Math.max(0,reply.facePrepEnds-reply.serverNow-2000);
    if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}
    gpsLoader.hidden=true;geo.hidden=true;lock.hidden=true;
    phase='faceSetup';capture.dataset.view='face';
    start.hidden=false;start.disabled=true;start.textContent='Menyiapkan kamera';
    status.hidden=false;status.textContent='Menyiapkan kamera untuk pemeriksaan wajah.';
    await prepareFace();
  }
  async function prepareFace(){
    if(!current()||phase!=='faceSetup')return;
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Kamera memerlukan izin dan koneksi aman HTTPS.');
    let device;
    try{
      device=await boundedCamera(navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},
        width:{ideal:640},height:{ideal:640}},audio:false}),25000,
        'Kamera belum merespons. Periksa izin kamera, lalu rekam ulang.',
        late=>late?.getTracks().forEach(t=>t.stop()));
    }catch(e){throw Error(e.name==='NotAllowedError'||e.name==='NotReadableError'?cameraError(e):e.message||cameraError(e));}
    if(!current()||phase!=='faceSetup'){device.getTracks().forEach(t=>t.stop());return;}
    stream=device;video.srcObject=stream;video.hidden=false;
    await boundedCamera(video.play(),12000,'Kamera belum menampilkan gambar. Silakan rekam ulang.');
    if(!current()||phase!=='faceSetup')return;
    let detector;
    for(let attempt=0;attempt<2;attempt++){
      if(!current()||phase!=='faceSetup')return;
      status.textContent=attempt?'Mencoba menyiapkan kamera kembali.':'Menyiapkan pemeriksaan wajah.';
      try{
        detector=await boundedCamera(loadLandmarker(),25000,
          'Kamera belum siap untuk pemeriksaan wajah. Periksa koneksi internet, lalu rekam ulang.',
          late=>late?.close());break;
      }catch(e){
        if(!current()||phase!=='faceSetup')return;
        if(attempt===1)throw Error('Kamera belum siap untuk pemeriksaan wajah. Periksa koneksi internet, lalu rekam ulang.');
      }
    }
    if(!current()||phase!=='faceSetup'){detector?.close();return;}
    model=detector;phase='faceReady';
    status.textContent='Hadapkan wajah ke kamera dan pastikan pencahayaan cukup.';
    start.textContent='Menunggu wajah siap';
    let stable=0,lastInference=-1000,lastTime=-1,lastFrameAt=performance.now();
    function align(t){
      if(!current()||phase!=='faceReady')return;
      try{
        if(t>=facePrepUntil)throw Error('Waktu persiapan wajah habis. Silakan rekam ulang.');
        if(video.readyState>=2&&video.currentTime!==lastTime&&t-lastInference>=80){
          lastTime=video.currentTime;lastInference=t;lastFrameAt=t;
          const pose=readPose(model.detectForVideo(video,t));
          stable=poseMatches('neutral',pose)?stable+1:0;
          frontReady=stable>=3;
          start.disabled=!frontReady;
          const hint=frontReady?'Wajah siap. Tekan Mulai Tantangan.':
            'Pastikan satu wajah terlihat jelas dan menghadap kamera.';
          if(status.textContent!==hint)status.textContent=hint;
          start.textContent=frontReady?'Mulai Tantangan':'Menunggu wajah siap';
        }
        if(t-lastFrameAt>12000)throw Error('Gambar kamera terhenti. Silakan rekam ulang.');
        frame=requestAnimationFrame(align);
      }catch(e){fail(e.message||describe(e));}
    }
    frame=requestAnimationFrame(align);
  }
  async function startChallenge(){
    if(phase!=='faceReady'||!frontReady||start.disabled||!lockState?.submissionId)return;
    cancelAnimationFrame(frame);
    phase='startingChallenge';busyButton(start,'Memulai tantangan…',true);
    status.textContent='Menyiapkan instruksi pemeriksaan wajah.';
    const reply=await timedCall('CAPTURE_START_CHALLENGE',{submissionId:lockState.submissionId});
    if(!current()||phase!=='startingChallenge')return;
    if(reply.code!=='CHALLENGE_STARTED'||!Array.isArray(reply.order)||reply.order.length!==3)
      throw Error('Tantangan wajah belum dapat dimulai. Silakan rekam ulang.');
    lockState={...lockState,...reply};
    challengeEnd=performance.now()+Math.max(0,reply.challengeEnds-reply.serverNow-2000);
    start.hidden=true;phase='challenge';capture.dataset.view='challenge';
    list.replaceChildren();steps=[];
    reply.order.forEach(action=>{
      const li=document.createElement('li'),num=document.createElement('span');
      li.append(num,document.createTextNode(directions[action]));list.append(li);
    });
    list.hidden=false;highlight(0);
    let stageStart=performance.now(),frames=0,lastTime=-1,lastInference=-1000;
    function detect(t){
      if(!current()||phase!=='challenge')return;
      try{
        if(t>=challengeEnd||t-stageStart>reply.stepSeconds*1000)
          throw Error('Waktu tantangan habis. Silakan rekam ulang.');
        if(video.currentTime!==lastTime&&video.readyState>=2&&t-lastInference>=80){
          lastTime=video.currentTime;lastInference=t;
          const pose=readPose(model.detectForVideo(video,t)),action=reply.order[steps.length];
          const hint='Langkah '+(steps.length+1)+'/3 · '+(pose?directions[action]:'Tampilkan tepat satu wajah');
          if(status.textContent!==hint)status.textContent=hint;
          frames=poseMatches(action,pose)?frames+1:0;
          if(frames>=3){
            if(action==='SMILE')image=snapshot(video);
            steps.push({action,seconds:Math.max(0.001,Math.round(t-stageStart)/1000),frames});
            if(steps.length===reply.order.length){review().catch(handleError);return;}
            highlight(steps.length);frames=0;stageStart=t;
          }
        }
        frame=requestAnimationFrame(detect);
      }catch(e){fail(describe(e));}
    }
    frame=requestAnimationFrame(detect);
  }
  const remaining=()=>Math.min(expiresPerf-performance.now(),expiresWall-Date.now());
  function updateClock(){
    if(!current()||!expiresPerf)return;
    if(phase==='receiptPending')submit.disabled=!navigator.onLine;
    // The evidence countdown owns expiration only while the user is reviewing
    // the photo. Once sending starts, the write/receipt outcome owns cleanup:
    // do not discard the preview during sending, checking, or receiptPending.
    if(phase!=='review')return;
    const left=Math.ceil(remaining()/1000);
    if(left<=0){fail('Bukti kedaluwarsa. Rekam ulang untuk mengirim presensi.');return;}
    clock.textContent='Bukti berlaku '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0');
    submit.disabled=!navigator.onLine;
  }
  async function review(){
    if(!image)throw Error('Foto senyum belum terekam. Ulangi perekaman.');
    phase='sealing';capture.dataset.view='proof';list.hidden=true;photo.src=image;photo.hidden=false;video.hidden=true;halt();
    status.classList.add('capture-working');status.textContent='Memverifikasi foto…';
    digest=await digestPhoto(image);if(!current()||phase!=='sealing')return;
    const reply=await timedCall('CAPTURE_SEAL',{submissionId:lockState.submissionId,digest,steps,faceCount:1});
    if(!current()||phase!=='sealing')return;
    if(reply.code!=='PROOF_SEALED'||!Number.isFinite(reply.expires))throw Error('Konfirmasi bukti belum lengkap. Rekam ulang presensi.');
    expiresPerf=reply.expires-serverOffsetUpper;
    expiresWall=Date.now()+expiresPerf-performance.now();
    status.classList.remove('capture-working');
    phase='review';status.textContent='Semua tantangan lulus. Periksa foto sebelum mengirim.';
    updateClock();
    if(phase==='review')clock.hidden=retake.hidden=submit.hidden=false;
  }
  function accepted(result){
    phase='done';dispose();dialog.close();onAccepted(result);
  }
  async function reconcile(){
    if(!current())return;
    phase='checking';clock.hidden=true;retake.hidden=retake.disabled=closeButton.disabled=true;
    busyButton(submit,'Memeriksa tanda terima…',true);
    status.textContent='Memeriksa transaksi yang sama di server…';
    let receipt;
    try{receipt=await checkReceipt(lockState.submissionId);}
    catch(e){
      if(!current())return;
      phase='receiptPending';closeButton.disabled=false;
      busyButton(submit,'Periksa tanda terima',false);updateClock();
      status.textContent='Tanda terima belum dapat dipastikan. '+describe(e)+' Periksa kembali atau lihat status di Beranda.';
      return;
    }
    if(!current())return;
    if(receipt){accepted(receipt);return;}
    if(remaining()<=0){fail('Tanda terima belum ditemukan dan bukti kedaluwarsa. Periksa Beranda sebelum merekam ulang.');return;}
    phase='review';retake.disabled=retake.hidden=closeButton.disabled=clock.hidden=false;
    busyButton(submit,'Kirim ulang presensi',false);
    status.textContent='Tanda terima belum ditemukan. Kamu bisa mengirim ulang dengan ID transaksi yang sama.';
    updateClock();
  }
  async function deliver(){
    if(!navigator.onLine)return;
    if(phase==='receiptPending'){await reconcile();return;}
    if(phase!=='review')return;
    updateClock();if(phase!=='review')return;
    phase='sending';clock.hidden=retake.hidden=true;retake.disabled=closeButton.disabled=true;
    busyButton(submit,'Mengirim presensi…',true);status.textContent='Menunggu tanda terima dari server…';
    try{
      const result=await send({id:lockState.submissionId,action:type,shiftDate:info.shiftDate,scheduleId:info.scheduleId,
        testRunId:info.testRunId,at:Date.now(),photo:image.split(',')[1]},()=>current()&&phase==='sending'&&remaining()>0);
      if(current())accepted(result);
    }catch(e){
      if(!current())return;
      if(e.code==='RECEIPT_REQUIRED'){await reconcile();return;}
      handleError(e);
    }
  }
  dialog.addEventListener('cancel',e=>{if(closeButton.disabled)e.preventDefault();},events);
  dialog.addEventListener('close',()=>{if(!dialog.open)dispose();},events);
  window.addEventListener('pagehide',()=>{dispose();if(dialog.open)dialog.close();},{once:true,signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&['setup','location','locking','faceSetup','faceReady','startingChallenge','challenge'].includes(phase))fail('Perekaman terjeda. Buka kembali kamera dan kunci lokasi.');
    else updateClock();
  },events);
  panel.addEventListener('click',e=>{
    const key=e.target.closest('[data-c]')?.dataset.c;
    if(key==='lock')begin().catch(handleError);
    if(key==='start')startChallenge().catch(handleError);
    if(key==='send')deliver().catch(handleError);
    if(key==='retake'&&!retake.hidden&&!retake.disabled){again=true;dialog.close();}
  },events);
  let again=false;
  pulse=setInterval(()=>{if(!alive()){dispose();return;}
    requestExtraPosition();updateFix();updateClock();
    if(['faceSetup','faceReady'].includes(phase)&&facePrepUntil&&performance.now()>=facePrepUntil)
      fail('Waktu persiapan wajah habis. Silakan rekam ulang.');
  },500);
  setup().catch(handleError);await closed;return again;
}
