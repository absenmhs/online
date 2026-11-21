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
  panel.innerHTML='<h2></h2><section class="capture"><div class="camera-box"><video muted autoplay playsinline></video><img class="proof-preview" alt="Foto presensi untuk ditinjau" hidden></div>'+
    '<div class="mobile-test-banner" role="status" hidden style="padding:10px;background:#fff0c2;border:1px solid #d49e19;border-radius:8px;color:#5b4000;font-weight:bold"></div>'+
    '<div class="capture-status" role="status"></div><div class="capture-geo"><b class="office-name"></b><div class="office-map" aria-label="Peta kantor dan perangkat"></div>'+
    '<small class="map-key">● Kantor dan radius &nbsp; <b>● Perangkat</b></small><p class="fix"></p></div>'+
    '<p class="countdown" hidden></p><div class="capture-actions"><button class="primary" data-c="lock" disabled>Kunci Lokasi</button>'+
    '<button class="primary" data-c="send" hidden>Kirim Presensi</button><button class="secondary" data-c="retake" hidden>Ambil Ulang Foto</button></div></section>';
  panel.querySelector('h2').textContent=title;
  dialog.classList.add('recording');if(!dialog.open)dialog.showModal();
  const $=s=>panel.querySelector(s),video=$('video'),photo=$('.proof-preview'),status=$('.capture-status'),geo=$('.capture-geo'),
    clock=$('.countdown'),fixText=$('.fix'),map=$('.office-map'),banner=$('.mobile-test-banner'),lock=$('[data-c=lock]'),submit=$('[data-c=send]'),retake=$('[data-c=retake]');
  const abort=new AbortController(),events={signal:abort.signal};
  let phase='setup',stream,model,watch=null,frame=0,pulse=null,office,info,fix,lockState,image='',steps=[],digest='',
    frontReady=false,infoAt=0,expiresPerf=0,expiresWall=0,disposed=false,challengeEnd=0;
  const closeButton=dialog.querySelector('#close');
  // A server timestamp is sampled after its request starts. Use the tightest
  // upper bound across the three replies so transit cannot extend the deadline.
  let serverOffsetUpper=Infinity;
  async function timedCall(route,payload){
    const start=performance.now(),reply=await api(route,payload);
    if(!Number.isFinite(reply.serverNow))throw Error('Waktu server belum tersedia. Rekam ulang presensi.');
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
    if(disposed)return;disposed=true;closeButton.disabled=false;halt();forget();clearInterval(pulse);abort.abort();dialog.classList.remove('recording');finish();
  }
  function fail(message){
    if(!current())return;
    phase='failed';status.classList.remove('capture-working');halt();forget();video.hidden=true;geo.hidden=true;clock.hidden=true;
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
    const distance=fix?distanceTo(office,fix):0;
    const inside=good&&fix.gpsAccuracy>0&&fix.gpsAccuracy<=office.maxAccuracy&&distance+fix.gpsAccuracy<=office.radius;
    lock.disabled=!(phase==='location'&&inside&&model&&frontReady&&video.readyState>=2);
    if(fix)fixText.textContent=(good?'':'Sampel GPS kedaluwarsa · ')+
      'Jarak '+Math.round(distance)+' m · Akurasi ±'+Math.ceil(fix.gpsAccuracy)+' m · Radius '+office.radius+' m'+
      (inside?' · Dalam area':' · Tunggu posisi yang memenuhi batas');
    drawOfficeMap(map,office,good?fix:null);
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
      banner.textContent=info.testRunId?'Uji developer · sesi '+info.testRunId.slice(0,8)+' · Jadwal virtual dan GPS simulasi. Selesaikan tiga tantangan kamera.':'Mobile Test · GPS simulasi. Jam presensi mengikuti jadwal kerja.';
      if(!info.testFix)throw Error('Pembaruan kamera memerlukan backend 2.1.0.');
      fix={...info.testFix,at:Date.now()};
      fixText.textContent='GPS SIMULASI (bukan lokasi ponsel)';
    }
    updateFix();
    status.textContent='Menyiapkan kamera dan deteksi wajah…';
    if(!info.mobileTest)fixText.textContent='Mencari posisi perangkat…';
    if(!info.mobileTest)watch=navigator.geolocation.watchPosition(p=>{
      fix={latitude:p.coords.latitude,longitude:p.coords.longitude,gpsAccuracy:p.coords.accuracy,at:p.timestamp};
      updateFix();
    },e=>{fix=null;fixText.textContent=e.code===1?'Izinkan lokasi untuk mengunci posisi.':'Posisi belum tersedia. Coba di area terbuka.';updateFix();},
    {enableHighAccuracy:true,maximumAge:0,timeout:15000});
    const device=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:640}},audio:false})
      .catch(e=>{throw Error(cameraError(e));});
    if(!current()||phase!=='setup'){device.getTracks().forEach(t=>t.stop());return;}
    stream=device;video.srcObject=stream;await video.play();
    if(!current()||phase!=='setup')return;
    const detector=await loadLandmarker().catch(()=>{throw Error('Model wajah belum dapat dimuat. Periksa internet dan dukungan WebAssembly browser, lalu rekam ulang.');});
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
    phase='locking';busyButton(lock,'Mengunci lokasi…',true);status.textContent='Memvalidasi posisi dengan server…';
    if(info.mobileTest)fix.at=Date.now();
    const measuredAt=Math.round(info.serverNow+(performance.now()-infoAt)-(Date.now()-fix.at));
    const reply=await timedCall('CAPTURE_LOCK',{type,testRunId:info.testRunId,scheduleId:info.scheduleId,shiftDate:info.shiftDate,
      officeId:office.id,fix:{...fix,measuredAt}});
    if(!current()||phase!=='locking')return;
    lockState=reply;challengeEnd=performance.now()+reply.challengeEnds-reply.serverNow;
    if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}
    geo.hidden=true;lock.hidden=true;phase='challenge';
    let stageStart=performance.now(),frames=0,lastTime=-1,lastInference=-1000;
    function detect(t){
      if(!current()||phase!=='challenge')return;
      try{
        if(t>=challengeEnd||t-stageStart>reply.stepSeconds*1000)throw Error('Waktu tantangan habis. Mulai lagi dari Kunci Lokasi.');
        if(video.currentTime!==lastTime&&video.readyState>=2&&t-lastInference>=80){
          lastTime=video.currentTime;lastInference=t;
          const pose=readPose(model.detectForVideo(video,t)),action=reply.order[steps.length];
          status.textContent='Langkah '+(steps.length+1)+'/3 · '+directions[action]+(!pose?' · Tampilkan tepat satu wajah':'');
          frames=poseMatches(action,pose)?frames+1:0;
          if(frames>=3){
            if(action==='SMILE')image=snapshot(video);
            steps.push({action,seconds:Math.max(0.001,Math.round(t-stageStart)/1000),frames});
            if(steps.length===reply.order.length){review().catch(handleError);return;}
            frames=0;stageStart=t;
          }
        }
        frame=requestAnimationFrame(detect);
      }catch(e){fail(e.message);}
    }
    frame=requestAnimationFrame(detect);
  }
  const remaining=()=>Math.min(expiresPerf-performance.now(),expiresWall-Date.now());
  function updateClock(){
    if(!current()||!expiresPerf)return;
    if(phase==='receiptPending')submit.disabled=!navigator.onLine;
    if(phase!=='review'){
      if(image&&remaining()<=0)forget();
      return;
    }
    const left=Math.ceil(remaining()/1000);
    if(left<=0){fail('Bukti kedaluwarsa. Rekam ulang untuk mengirim presensi.');return;}
    clock.textContent='Bukti berlaku '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0');
    submit.disabled=!navigator.onLine;
  }
  async function review(){
    if(!image)throw Error('Foto senyum belum terekam. Ulangi perekaman.');
    phase='sealing';photo.src=image;photo.hidden=false;video.hidden=true;halt();
    status.classList.add('capture-working');status.textContent='Memverifikasi foto…';
    digest=await digestPhoto(image);if(!current()||phase!=='sealing')return;
    const reply=await timedCall('CAPTURE_SEAL',{submissionId:lockState.submissionId,digest,steps,faceCount:1});
    if(!current()||phase!=='sealing')return;
    if(reply.code!=='PROOF_SEALED'||!Number.isFinite(reply.expires))throw Error('Konfirmasi bukti belum lengkap. Rekam ulang presensi.');
    expiresPerf=reply.expires-serverOffsetUpper;
    expiresWall=Date.now()+expiresPerf-performance.now();
    status.classList.remove('capture-working');
    phase='review';status.textContent='Periksa foto sebelum mengirim.';
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
    phase='review';closeButton.disabled=false;clock.hidden=false;
    busyButton(submit,'Kirim ulang presensi',false);
    status.textContent='Tanda terima belum ditemukan. Kamu bisa mengirim ulang dengan ID transaksi yang sama.';
    updateClock();
  }
  async function deliver(){
    if(!navigator.onLine)return;
    if(phase==='receiptPending'){await reconcile();return;}
    if(phase!=='review')return;
    updateClock();if(phase!=='review')return;
    phase='sending';clock.hidden=true;retake.disabled=closeButton.disabled=true;
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
    if(document.hidden&&['location','locking','challenge'].includes(phase))fail('Perekaman terjeda. Buka kembali kamera dan kunci lokasi.');
    else updateClock();
  },events);
  panel.addEventListener('click',e=>{
    const key=e.target.closest('[data-c]')?.dataset.c;
    if(key==='lock')begin().catch(handleError);
    if(key==='send')deliver().catch(handleError);
    if(key==='retake'&&!retake.hidden&&!retake.disabled){again=true;dialog.close();}
  },events);
  let again=false;
  pulse=setInterval(()=>{if(!alive()){dispose();return;}updateFix();updateClock();},500);
  setup().catch(handleError);await closed;return again;
}
