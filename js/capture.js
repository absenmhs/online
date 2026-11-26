import {loadLandmarker,readPose,poseMatches,directions} from './liveness.js';
import {drawOfficeMap,distanceTo} from './office-map.js';

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
  if(e.name==='NotAllowedError')return 'Izinkan kamera untuk situs ini, kemudian buka kembali perekaman.';
  if(e.name==='NotReadableError')return 'Kamera sedang dipakai. Tutup aplikasi kamera lain dan coba lagi.';
  return 'Kamera depan belum tersedia. Periksa izin dan perangkat kamera.';
}
export async function recordAttendance({dialog,title,type,call,send,checkReceipt,alive,describe,onAccepted,onDisabled}){
  const panel=dialog.querySelector('#panel');
  panel.innerHTML='<section class="capture" data-view="location"><div class="camera-box"><video muted autoplay playsinline></video>'+
    '<img class="proof-preview" alt="Foto presensi untuk ditinjau" hidden></div><header class="camera-header"><h2 id="capture-title"></h2>'+
    '<small class="mobile-test-banner" hidden></small></header><div class="face-guide" aria-hidden="true"></div>'+
    '<div class="capture-dock"><div class="capture-geo"><b class="office-name">Lokasi presensi</b>'+
    '<div class="office-map" aria-label="Peta kantor dan perangkat"></div><small class="map-key">● Kantor dan radius &nbsp; <b>● Perangkat</b></small><div class="capture-location-loading" aria-hidden="true"><span class="capture-location-spinner"></span></div><p class="fix" role="status" aria-live="polite"></p></div>'+
    '<ol class="challenge-list" aria-label="Tiga tantangan wajah" hidden></ol><div class="capture-status" role="status"></div>'+
    '<p class="countdown" hidden></p><div class="capture-actions"><button class="primary" data-c="lock" disabled>Kunci Lokasi</button>'+
    '<button class="primary" data-c="send" hidden>Kirim Presensi</button><button class="secondary" data-c="retake" hidden>Ambil Ulang Foto</button></div></div></section>';
  panel.querySelector('h2').textContent=title;
  dialog.classList.add('recording');dialog.setAttribute('aria-labelledby','capture-title');
  if(!dialog.open)dialog.showModal();
  const $=s=>panel.querySelector(s),video=$('video'),photo=$('.proof-preview'),status=$('.capture-status'),geo=$('.capture-geo'),
    clock=$('.countdown'),fixText=$('.fix'),gpsLoader=$('.capture-location-loading'),map=$('.office-map'),banner=$('.mobile-test-banner'),lock=$('[data-c=lock]'),submit=$('[data-c=send]'),retake=$('[data-c=retake]');
  const capture=$('.capture'),list=$('.challenge-list');
  const locationFailure='Proses Memuat Lokasi Gagal. Pastikan koneksi internet stabil, GPS perangkat aktif, dan izin akses lokasi telah diberikan. Silakan ulangi proses absensi.';
  function highlight(index){
    Array.from(list.children).forEach((el,i)=>{
      el.dataset.step=i<index?'done':i===index?'current':'next';
      if(i===index)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
      el.firstChild.textContent=i<index?'✓':String(i+1);
    });
  }
  const abort=new AbortController(),events={signal:abort.signal};
  let phase='setup',stream,model,watch=null,frame=0,pulse=null,office,info,fix,lockState,image='',steps=[],digest='',
    frontReady=false,infoAt=0,expiresPerf=0,expiresWall=0,disposed=false,challengeEnd=0;
  let gpsSamples=[],gpsStartedAt=0,gpsPollAt=0,gpsPolling=false;
  function gpsSettings(){return info?.gpsPrecheck||{minSamples:8,minDistinct:4,minSpanMs:3000,
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
  function samplesReady(){
    if(info?.mobileTest||info?.gpsProtectionMode==='INACTIVE')return true;
    const cfg=gpsSettings();
    return gpsSamples.length>=cfg.minSamples&&distinctInside()>=cfg.minDistinct&&
      gpsSamples.at(-1).at-gpsSamples[0].at>=cfg.minSpanMs&&
      Date.now()-gpsSamples.at(-1).at<=15000;
  }
  function collectPosition(position){
    if(!current()||!['setup','location'].includes(phase))return;
    const c=position.coords,at=position.timestamp;
    if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||!Number.isFinite(c.accuracy)||
      Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||c.accuracy<=0||
      !Number.isFinite(at)||at>Date.now()+1000||Date.now()-at>15000)return;
    if(gpsSamples.length&&at<=gpsSamples.at(-1).at)return; // repeated cached timestamp is not new data
    const sample={latitude:c.latitude,longitude:c.longitude,gpsAccuracy:c.accuracy,at};
    gpsSamples.push(sample);
    const recent=at-(gpsSettings().maxWaitMs+10000);
    gpsSamples=gpsSamples.filter(p=>p.at>=recent).slice(-gpsSettings().maxSamples);
    fix=sample;
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
    closeButton.disabled=retake.disabled=false;lock.hidden=submit.hidden=true;retake.hidden=false;retake.textContent='Rekam ulang';status.textContent=message;
  }
  function handleError(e){
    if(e.code==='POC_WRITE_DISABLED'||e.code==='SIMULATION_PANEL_ONLY')onDisabled();
    fail(describe(e));
  }
  function updateFix(){
    if(!current()||!['setup','location'].includes(phase)||!office)return;
    if(info?.mobileTest && fix)fix.at=Date.now(); // Synthetic GPS never ages while the test screen is open.
    const good=fix&&Date.now()-fix.at<=15000&&Date.now()>=fix.at-1000;
    const ready=samplesReady(),elapsed=gpsStartedAt?Date.now()-gpsStartedAt:0;
    if(!info.mobileTest&&gpsStartedAt&&elapsed>=gpsSettings().maxWaitMs&&
       (info.gpsProtectionMode==='INACTIVE'?!good:!ready)){
      fail(locationFailure);return;
    }
    const inside=good&&gpsInside(fix);
    lock.disabled=!(phase==='location'&&inside&&ready&&model&&frontReady&&video.readyState>=2);
    gpsLoader.hidden=!!info.mobileTest||(inside&&ready);
    const gpsMessage=info.mobileTest?'MODE UJI · Lokasi simulasi':
      !good||!ready?(elapsed>=gpsSettings().initialWaitMs?
        'Proses memuat lokasi masih berlangsung. Pastikan GPS aktif dan koneksi internet stabil. Tidak perlu menekan tombol berulang kali.':
        'Memuat lokasi saat ini...'):
      inside?'Lokasi siap. Silakan kunci lokasi.':'Lokasi belum sesuai area kerja. Coba berada lebih dekat ke kantor.';
    if(fixText.textContent!==gpsMessage)fixText.textContent=gpsMessage;
    drawOfficeMap(map,office,good?fix:null);
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
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Browser memerlukan akses kamera melalui HTTPS.');
    status.textContent='Memeriksa jadwal dan lokasi kantor…';
    info=await timedCall('CAPTURE_INFO',{type});if(!current())return;
    if(!info.mobileTest&&!navigator.geolocation)throw Error('Browser memerlukan akses lokasi melalui HTTPS.');
    infoAt=performance.now();office=info.office;$('.office-name').textContent=office.name;
    banner.hidden=info.mobileTest!==true;
    if(info.mobileTest){
      banner.textContent='MODE UJI · GPS simulasi'+(info.testRunId?' · '+info.testRunId.slice(0,8):'');
      if(!info.testFix)throw Error('Pembaruan kamera memerlukan backend 2.1.0.');
      fix={...info.testFix,at:Date.now()};
      fixText.textContent='GPS SIMULASI (bukan lokasi ponsel)';gpsLoader.hidden=true;
    }
    updateFix();
    status.textContent='Menyiapkan kamera dan deteksi wajah…';
    if(!info.mobileTest)fixText.textContent='Memuat lokasi saat ini...';
    if(!info.mobileTest){
      gpsStartedAt=Date.now();
      watch=navigator.geolocation.watchPosition(collectPosition,
        e=>{if(e.code===1){fail(locationFailure);return;}fix=null;fixText.textContent='Memuat lokasi saat ini...';updateFix();},
    {enableHighAccuracy:true,maximumAge:0,timeout:15000});
    }
    const device=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:640}},audio:false})
      .catch(e=>{throw Error(cameraError(e));});
    if(!current()||phase!=='setup'){device.getTracks().forEach(t=>t.stop());return;}
    stream=device;video.srcObject=stream;await video.play();
    if(!current()||phase!=='setup')return;
    const detector=await loadLandmarker().catch(()=>{throw Error('Pemeriksaan wajah belum siap. Periksa koneksi internet lalu rekam ulang.');});
    if(!current()||phase!=='setup'){detector.close();return;}
    model=detector;phase='location';status.textContent='Hadapkan wajah ke kamera, lalu kunci lokasi.';
    let stable=0,lastInference=-1000,lastTime=-1;
    function align(t){
      if(!current()||phase!=='location')return;
      try{
        if(video.readyState>=2&&video.currentTime!==lastTime&&t-lastInference>=80){
          lastTime=video.currentTime;lastInference=t;
          const pose=readPose(model.detectForVideo(video,t));
          stable=poseMatches('neutral',pose)?stable+1:0;
          frontReady=stable>=3;
          updateFix();
        }
        frame=requestAnimationFrame(align);
      }catch(error){fail(describe(error));}
    }
    frame=requestAnimationFrame(align);
  }
  async function begin(){
    updateFix();if(lock.disabled||phase!=='location')return;
    phase='locking';busyButton(lock,'Mengunci lokasi…',true);status.textContent='Menyiapkan langkah berikutnya…';
    if(info.mobileTest)fix.at=Date.now();
    const measuredAt=Math.round(info.serverNow+(performance.now()-infoAt)-(Date.now()-fix.at));
    const alignedSamples=info.mobileTest?[]:gpsSamples.map(s=>({latitude:s.latitude,longitude:s.longitude,
      gpsAccuracy:s.gpsAccuracy,measuredAt:measuredAt-(fix.at-s.at)}));
    const reply=await timedCall('CAPTURE_LOCK',{type,testRunId:info.testRunId,scheduleId:info.scheduleId,shiftDate:info.shiftDate,
      officeId:office.id,gpsProtectionMode:info.gpsProtectionMode||'ACTIVE',fix:{...fix,measuredAt},
      samples:info.gpsProtectionMode==='INACTIVE'?[]:alignedSamples});
    if(!current()||phase!=='locking')return;
    lockState=reply;challengeEnd=performance.now()+reply.challengeEnds-reply.serverNow;
    if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}
    gpsLoader.hidden=true;geo.hidden=true;lock.hidden=true;phase='challenge';capture.dataset.view='challenge';
    reply.order.forEach(action=>{
      const li=document.createElement('li'),num=document.createElement('span');
      li.append(num,document.createTextNode(directions[action]));list.append(li);
    });
    list.hidden=false;highlight(0);
    let stageStart=performance.now(),frames=0,lastTime=-1,lastInference=-1000;
    function detect(t){
      if(!current()||phase!=='challenge')return;
      try{
        if(t>=challengeEnd||t-stageStart>reply.stepSeconds*1000)throw Error('Waktu tantangan habis. Mulai lagi dari Kunci Lokasi.');
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
    if(document.hidden&&['setup','location','locking','challenge'].includes(phase))fail('Perekaman terjeda. Buka kembali kamera dan kunci lokasi.');
    else updateClock();
  },events);
  panel.addEventListener('click',e=>{
    const key=e.target.closest('[data-c]')?.dataset.c;
    if(key==='lock')begin().catch(handleError);
    if(key==='send')deliver().catch(handleError);
    if(key==='retake'&&!retake.hidden&&!retake.disabled){again=true;dialog.close();}
  },events);
  let again=false;
  pulse=setInterval(()=>{if(!alive()){dispose();return;}requestExtraPosition();updateFix();updateClock();},500);
  setup().catch(handleError);await closed;return again;
}
