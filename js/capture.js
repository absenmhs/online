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
export async function recordAttendance({dialog,title,type,call,send,alive,describe,onAccepted,onDisabled}){
  const panel=dialog.querySelector('#panel');
  panel.innerHTML='<h2></h2><section class="capture"><div class="camera-box"><video muted autoplay playsinline></video><img class="proof-preview" alt="Foto presensi untuk ditinjau" hidden></div>'+
    '<div class="capture-status" role="status"></div><div class="capture-geo"><b class="office-name"></b><div class="office-map" aria-label="Peta kantor dan perangkat"></div>'+
    '<small class="map-key">● Kantor dan radius &nbsp; <b>● Perangkat</b></small><p class="fix"></p></div>'+
    '<p class="countdown" hidden></p><div class="capture-actions"><button class="primary" data-c="lock" disabled>Kunci Lokasi</button>'+
    '<button class="primary" data-c="send" hidden>Kirim Presensi</button><button class="secondary" data-c="retake" hidden>Ambil Ulang Foto</button></div></section>';
  panel.querySelector('h2').textContent=title;
  dialog.classList.add('recording');if(!dialog.open)dialog.showModal();
  const $=s=>panel.querySelector(s),video=$('video'),photo=$('.proof-preview'),status=$('.capture-status'),geo=$('.capture-geo'),
    clock=$('.countdown'),fixText=$('.fix'),map=$('.office-map'),lock=$('[data-c=lock]'),submit=$('[data-c=send]'),retake=$('[data-c=retake]');
  const abort=new AbortController(),events={signal:abort.signal};
  let phase='setup',stream,model,watch=null,frame=0,pulse=null,office,info,fix,lockState,image='',steps=[],digest='',
    infoAt=0,expiresPerf=0,expiresWall=0,disposed=false,challengeEnd=0,sendStarted=false;
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
    if(disposed)return;disposed=true;halt();forget();clearInterval(pulse);abort.abort();dialog.classList.remove('recording');finish();
  }
  function fail(message){
    if(!current())return;
    phase='failed';halt();forget();video.hidden=true;geo.hidden=true;clock.hidden=true;
    lock.hidden=submit.hidden=true;retake.hidden=false;retake.textContent='Rekam ulang';status.textContent=message;
  }
  function handleError(e){
    if(e.code==='POC_WRITE_DISABLED'||e.code==='SIMULATION_PANEL_ONLY')onDisabled();
    fail(describe(e));
  }
  function updateFix(){
    if(!current()||!['setup','location'].includes(phase)||!office)return;
    const good=fix&&Date.now()-fix.at<=15000&&Date.now()>=fix.at-1000;
    const distance=fix?distanceTo(office,fix):0;
    const inside=good&&fix.gpsAccuracy>0&&fix.gpsAccuracy<=office.maxAccuracy&&distance+fix.gpsAccuracy<=office.radius;
    lock.disabled=!(phase==='location'&&inside&&model&&video.readyState>=2);
    if(fix)fixText.textContent=(good?'':'Sampel GPS kedaluwarsa · ')+
      'Jarak '+Math.round(distance)+' m · Akurasi ±'+Math.ceil(fix.gpsAccuracy)+' m · Radius '+office.radius+' m'+
      (inside?' · Dalam area':' · Tunggu posisi yang memenuhi batas');
    drawOfficeMap(map,office,good?fix:null);
  }
  async function setup(){
    if(!navigator.onLine)throw Error('Hubungkan internet untuk memulai sesi perekaman.');
    if(!navigator.mediaDevices?.getUserMedia||!navigator.geolocation)throw Error('Browser memerlukan akses kamera dan lokasi melalui HTTPS.');
    status.textContent='Memeriksa jadwal dan lokasi kantor…';
    info=await api('CAPTURE_INFO',{type});if(!current())return;
    infoAt=performance.now();office=info.office;$('.office-name').textContent=office.name;updateFix();
    status.textContent='Menyiapkan kamera dan deteksi wajah…';fixText.textContent='Mencari posisi perangkat…';
    watch=navigator.geolocation.watchPosition(p=>{
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
    model=detector;phase='location';status.textContent='Posisikan wajah di kamera, lalu kunci lokasi.';updateFix();
  }
  async function begin(){
    updateFix();if(lock.disabled||phase!=='location')return;
    phase='locking';lock.disabled=true;status.textContent='Memvalidasi posisi dengan server…';
    const measuredAt=Math.round(info.serverNow+(performance.now()-infoAt)-(Date.now()-fix.at));
    const reply=await api('CAPTURE_LOCK',{type,scheduleId:info.scheduleId,shiftDate:info.shiftDate,
      officeId:office.id,fix:{...fix,measuredAt}});
    if(!current()||phase!=='locking')return;
    lockState=reply;challengeEnd=performance.now()+reply.challengeEnds-reply.serverNow;
    navigator.geolocation.clearWatch(watch);watch=null;geo.hidden=true;lock.hidden=true;phase='challenge';
    let stageStart=performance.now(),frames=0,neutral=false,lastTime=-1,lastInference=-1000;
    function detect(t){
      if(!current()||phase!=='challenge')return;
      try{
        if(t>=challengeEnd||t-stageStart>reply.stepSeconds*1000)throw Error('Waktu tantangan habis. Mulai lagi dari Kunci Lokasi.');
        if(video.currentTime!==lastTime&&video.readyState>=2&&t-lastInference>=80){
          lastTime=video.currentTime;lastInference=t;
          const pose=readPose(model.detectForVideo(video,t)),action=reply.order[steps.length];
          status.textContent='Langkah '+(steps.length+1)+'/3 · '+(!pose?'Tampilkan tepat satu wajah':neutral?directions[action]:'Tatap kamera dengan ekspresi netral');
          if(!pose){neutral=false;frames=0;}
          else if(poseMatches(neutral?action:'neutral',pose)){
            frames++;
            if(frames>=3){
              if(!neutral){neutral=true;frames=0;}
              else{
                steps.push({action,seconds:Math.max(0.001,Math.round(t-stageStart)/1000),frames});
                if(steps.length===reply.order.length){review().catch(handleError);return;}
                neutral=false;frames=0;stageStart=t;
              }
            }
          }else frames=0;
        }
        frame=requestAnimationFrame(detect);
      }catch(e){fail(e.message);}
    }
    frame=requestAnimationFrame(detect);
  }
  const remaining=()=>Math.min(expiresPerf-performance.now(),expiresWall-Date.now());
  function updateClock(){
    if(!current()||!expiresPerf)return;
    const left=Math.max(0,Math.ceil(remaining()/1000));
    clock.textContent='Bukti berlaku '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0');
    if(!left&&!['failed','expired','done'].includes(phase)){
      const sent=phase==='sending'&&sendStarted;
      fail(sent?'Bukti telah dihapus. Menunggu konfirmasi pengiriman yang sedang berjalan.':'Bukti kedaluwarsa. Rekam ulang untuk mengirim presensi.');
      phase='expired';if(sent)retake.hidden=true;
    }else if(phase==='review')submit.disabled=!navigator.onLine;
  }
  async function review(){
    image=snapshot(video);phase='sealing';expiresPerf=performance.now()+300000;expiresWall=Date.now()+300000;
    photo.src=image;photo.hidden=false;video.hidden=true;halt();clock.hidden=false;updateClock();
    retake.hidden=false;status.textContent='Tantangan selesai. Mengonfirmasi waktu bukti…';
    digest=await digestPhoto(image);if(!current()||phase!=='sealing')return;
    const reply=await api('CAPTURE_SEAL',{submissionId:lockState.submissionId,digest,steps,faceCount:1});
    if(!current()||phase!=='sealing')return;
    const ttl=reply.expires-reply.serverNow;
    expiresPerf=Math.min(expiresPerf,performance.now()+ttl);expiresWall=Math.min(expiresWall,Date.now()+ttl);
    phase='review';retake.hidden=submit.hidden=false;status.textContent='Periksa foto sebelum mengirim.';updateClock();
  }
  async function deliver(){
    if(phase!=='review'||!navigator.onLine)return;updateClock();if(phase!=='review')return;
    phase='sending';submit.disabled=true;retake.hidden=true;sendStarted=true;status.textContent='Mengirim presensi…';
    try{
      const r=await send({id:lockState.submissionId,action:type,shiftDate:info.shiftDate,scheduleId:info.scheduleId,
        at:Date.now(),photo:image.split(',')[1]},()=>current()&&phase==='sending'&&remaining()>0);
      if(!current())return;
      phase='done';dispose();dialog.close();onAccepted(r);
    }catch(e){
      if(!current())return;
      if(e.code==='POC_WRITE_DISABLED'||e.code==='SIMULATION_PANEL_ONLY')onDisabled();
      if(!remaining()||remaining()<=0||phase==='expired'){fail('Bukti kedaluwarsa. Status pengiriman dapat diperiksa di Beranda.');return;}
      if(['TRANSPORT','SERVICE_ERROR','LOCK_BUSY_RETRY','RAW_COMMIT_UNCERTAIN_RETRY_SAME_UUID','GET_NOT_AVAILABLE','STATUS_SYNC_CONFLICT','SERVICE_INVALID_RESPONSE'].includes(e.code)){
        phase='review';retake.hidden=true;status.textContent='Penerimaan belum pasti. Kirim ulang dengan nomor transaksi yang sama atau periksa Beranda.';updateClock();
      }else handleError(e);
    }
  }
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
    if(key==='retake')dialog.close();
  },events);
  let again=false;
  retake.addEventListener('click',()=>{again=true;},events);
  pulse=setInterval(()=>{if(!alive()){dispose();return;}updateFix();updateClock();},500);
  setup().catch(handleError);await closed;return again;
}
