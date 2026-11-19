import {recordAttendance} from './capture.js';
import {post,probe,getTimings} from './api.js';
import {put,get,remove,owned} from './store.js';
import {icon} from './icons.js';
import {summarizeDaily,dayExplanation} from './daily.js';
import {createRefreshScheduler} from './refresh.js';
import {avatarKind, photoURL, preparePhoto, savePhoto, deletePhoto} from './photo.js';

const $=s=>document.querySelector(s), app=$('#app'), dialog=$('#dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ns='mhs:'+location.pathname.replace(/index\.html$/,'')+':'+window.MHS_CONFIG.apiUrl+':';
const prefs=localStorage, temporary=sessionStorage;
let session=null, tab='home', rows=[], dailyRows=[], dailyMonth='', dailyLoaded=false, queue=[], drafts=[], lastSync=0, verifier=[], loaded=false;
let period='', filter='Semua', gpsAt=0, synchronizing=false, capturing=false, toastTimer, reconnectTimer, installEvent, epoch=0;
let profilePhoto = '', photoGeneration = 0, refreshError = '', refreshDeferred = false;
let expiredRows=[],todayRows=[],calendarDays=[], category='', dayReturn='';
let audit=null, auditEmployee='', reviewOpen=false, deciding=false;
let verifierNetwork=Promise.resolve();
const refreshScope=()=>session?.role==='VERIFIER'?(tab==='audit'?'audit':'queue'):period;
let foregroundOffline = !navigator.onLine;
const refreshScheduler = createRefreshScheduler(
  manual => synchronize(manual),
  () => !!session && !session.mustChangePassword && navigator.onLine && !document.hidden && !reviewOpen && !deciding,
  180000,refreshScope
);
const pending='Menunggu verifikasi', titles={home:'Beranda',history:'Riwayat',calendar:'Shift',audit:'Riwayat Verifikasi',doc:'Izin',user:'Profil',verify:'Verifikasi'};
const labels={PENDING:pending,VERIFIED:'Disetujui',REJECTED:'Ditolak',NEEDS_CORRECTION:'Perlu koreksi',CONFIRMED:'Terkirim',CHECK_IN:'Check-in',CHECK_OUT:'Check-out',CHECKIN:'Check-in',CHECKOUT:'Check-out'};
const errors={CORRECTION_CONFLICT:'Keputusan sudah berubah atau catatan belum selaras. Buka kembali Riwayat Verifikasi.',CORRECTION_WINDOW_CLOSED:'Keputusan sudah di luar periode koreksi tujuh hari.',POC_WRITE_DISABLED:'Presensi sementara belum dibuka oleh pengelola.',EVIDENCE_EXPIRED:'Bukti sudah kedaluwarsa. Rekam ulang presensi.',CHALLENGE_EXPIRED:'Waktu tantangan habis. Rekam ulang presensi.',CAPTURE_INVALID:'Sesi perekaman berakhir. Rekam ulang presensi.',LIVENESS_INCOMPLETE:'Hasil tantangan tidak lengkap atau melewati batas waktu. Rekam ulang presensi.',PHOTO_UNAVAILABLE:'Foto belum tersedia atau telah melewati masa simpan.',DUPLICATE_SHIFT_ACTION:'Transaksi ini sudah tercatat untuk shift yang sama.',PHOTO_MISMATCH:'Foto berbeda dari bukti yang dikonfirmasi.',GEOFENCE_REJECTED:'Lokasi atau akurasi belum memenuhi batas kantor.',EVIDENCE_REQUIRED:'Sesi bukti berakhir. Rekam ulang presensi.',INVALID_CREDENTIALS:'Username atau password tidak cocok.',API_DISABLED:'Pengelola perlu mengaktifkan API PoC.',SIMULATION_PANEL_ONLY:'Mode simulasi sidebar masih aktif.',MOBILE_TEST_CONFIG_INVALID:'Konfigurasi Mobile Test belum lengkap. Periksa Script Properties.',MOBILE_TEST_MODE_CHANGED:'Mode uji berubah saat perekaman. Rekam ulang.',TIME_WINDOW_CLOSED:'Jendela waktu absensi sudah tutup.',CHECKIN_REQUIRED_FOR_CHECKOUT:'Server belum menerima Check-in untuk shift ini.',SESSION_EXPIRED:'Sesi berakhir. Masuk kembali dengan akun yang sama.',REASON_REQUIRED:'Isi alasan minimal lima karakter.',PASSWORD_LENGTH:'Panjang password belum sesuai kebijakan yang ditampilkan.',PASSWORD_COMPLEXITY:'Gunakan minimal satu huruf, satu angka, dan satu simbol.',PASSWORD_CHANGE_REQUIRED:'Ganti password awal terlebih dahulu.',SCHEDULE_NOT_PUBLISHED:'Jadwal belum disetujui untuk absensi.',DEPENDENCY_UNAVAILABLE:'Modul aturan jadwal tidak tersedia di proyek Apps Script.'};
const label=v=>labels[v]||v||'—';
const wib=(d,opts)=>new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',...opts}).format(d);
const dateKey=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const now=()=>Date.now()+(session?.offset||0);
const own=()=>ns+session.employeeId;
function dateISO(s){
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  const m=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  return m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):'';
}
const fmtDay=(s,opts={day:'numeric',month:'short',year:'numeric'})=>dateISO(s)?wib(new Date(dateISO(s)+'T12:00:00+07:00'),opts):s;
const describe=e=>errors[e.code]||e.message||'Permintaan gagal.';
const btn=(action,txt,cls='secondary',ic='')=>'<button type="button" data-act="'+action+'" class="'+cls+'">'+(ic?icon(ic)+' ':'')+txt+'</button>';
const chip=(s,cls='')=>'<span class="chip '+cls+'">'+esc(s)+'</span>';
const msg=t=>'<p class="message" role="status">'+esc(t)+'</p>';
const card=(title,body)=>'<section class="card"><h2>'+title+'</h2>'+body+'</section>';
const line=(a,b)=>'<div class="line"><span>'+a+'</span><b>'+b+'</b></div>';
const empty=t=>'<div class="empty">'+esc(t)+'</div>';
const actNames=['CHECKIN','CHECKOUT'];
function toast(t){$('#notice').textContent=t;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#notice').textContent='',6500)}
function modal(title,body){$('#panel').innerHTML='<h2>'+esc(title)+'</h2>'+body+'<div id="feedback" role="status"></div>';if(!dialog.open)dialog.showModal()}
function report(e){const t=describe(e)+(e.code&&!['CONFIG','TRANSPORT'].includes(e.code)?' ('+e.code+')':'');if(dialog.open&&$('#feedback'))$('#feedback').innerHTML=msg(t);else if($('#form-error'))$('#form-error').innerHTML=msg(t);else toast(t)}
function saveSession(){temporary.setItem(ns+'session',JSON.stringify(session))}
function clearSession(){audit=null;auditEmployee='';reviewOpen=false;deciding=false;category='';dayReturn='';calendarDays=[];todayRows=[];expiredRows=[];epoch++;refreshScheduler.reset();photoGeneration++;setPhotoURL('');refreshError='';refreshDeferred=false;session=null;temporary.removeItem(ns+'session');rows=[];dailyRows=[];dailyMonth='';dailyLoaded=false;queue=[];drafts=[];verifier=[];loaded=false;lastSync=0;gpsAt=0;period='';filter='Semua';tab='home';if(dialog.open)dialog.close();render()}
function valid(){return session&&Date.now()<session.expires}
async function api(action,body={}){
  const current=session;
  try{
    const send=()=>{
      if(session!==current)throw Error('Sesi telah berganti.');
      return post(action,{token:current.token,...body});
    };
    if(current.role!=='VERIFIER')return await send();
    // Review and refresh share a single network lane, including photo retries.
    const task=verifierNetwork.then(send);
    verifierNetwork=task.catch(()=>{});
    return await task;
  }
  catch(e){if(session===current&&['SESSION_INVALID','SESSION_EXPIRED','SESSION_REVOKED'].includes(e.code))clearSession();throw e}
}
function applyContext(result) {
  const current = session;
  if (result.employeeId !== current.employeeId || result.role !== current.role) {
    clearSession();
    throw Error('Identitas sesi berubah. Silakan masuk kembali.');
  }
  Object.assign(current, {
    name:result.name || result.username || current.username,
    profession:result.profession, locationId:result.locationId, unit:result.unit,
    gender:result.gender || '', passwordPolicy:result.passwordPolicy || current.passwordPolicy,
    mustChangePassword:!!result.mustChangePassword,
    contextDay:dateKey(result.serverEpoch || Date.now()),
    offset:result.serverEpoch ? result.serverEpoch-Date.now() : current.offset || 0,
    clockSynced:!!result.serverEpoch
  });
  if (typeof result.writeOpen==='boolean') current.writeOpen=result.writeOpen;
  if (result.shifts) current.shifts = result.shifts;
  saveSession();
}
function setPhotoURL(url) {
  if (profilePhoto) URL.revokeObjectURL(profilePhoto);
  profilePhoto = url;
}
async function loadPhoto() {
  const current = session, generation = ++photoGeneration;
  const url = await photoURL(own());
  if (session !== current || photoGeneration !== generation) {
    if (url) URL.revokeObjectURL(url);
    return;
  }
  setPhotoURL(url);
}
function avatar() {
  if (profilePhoto)
    return '<img class="avatar" src="'+esc(profilePhoto)+'" alt="Foto profil lokal">';
  const kind = avatarKind(session.gender);
  const name = kind === 'male' ? 'pria' : kind === 'female' ? 'wanita' : 'netral';
  return '<span class="avatar default-avatar '+kind+'" role="img" aria-label="Avatar '+name+'">'+
    '<span class="avatar-hair"></span><span class="avatar-body"></span>'+
    '<span class="avatar-head"><span class="avatar-eyes"></span><span class="avatar-smile"></span></span></span>';
}
function refreshText() {
  if (!navigator.onLine) return 'Offline · data terakhir tetap tersedia';
  if (refreshError) return 'Pembaruan tertunda · '+esc(refreshError);
  return lastSync ? 'Terakhir '+esc(wib(lastSync,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))+' WIB' : 'Belum diperbarui';
}
function updateRefreshIndicator(manual = false) {
  document.querySelectorAll('[data-refresh-status]').forEach(node => {
    node.textContent = manual && synchronizing ? 'Memperbarui data…' :
      refreshText().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  });
  document.querySelectorAll('[data-act="sync"]').forEach(button => {
    button.disabled = synchronizing || !navigator.onLine;
    button.setAttribute('aria-busy', String(synchronizing));
    if(button.classList.contains('clock-refresh'))button.title=synchronizing?'Memperbarui data…':'Perbarui data · '+refreshText();
  });
}
function refreshNotice(){
  return refreshError?msg('Pembaruan tertunda · '+refreshError):'';
}
function renderRefreshedData() {
  if (!session || session.mustChangePassword) return;
  const active = document.activeElement;
  if (dialog.open || capturing || active?.matches('input,textarea') || active?.closest('form')) {
    refreshDeferred = true;
    return;
  }
  const page = $('#page');
  if (!page) return;
  const action = active?.dataset?.act;
  const scroll = window.scrollY;
  page.innerHTML = refreshNotice()+({home:dashboard,history,calendar,doc:leave,user:profile,verify:verification,audit:auditPage}[tab])();
  if (action) Array.from(page.querySelectorAll('[data-act]'))
    .find(node => node.dataset.act === action)?.focus({preventScroll:true});
  window.scrollTo(0, scroll);
  refreshDeferred = false;
  tick();
  updateRefreshIndicator();
}
async function local(){
  const stamp=epoch, owner=own(), month=period;
  const [cached,q,d]=await Promise.all([get('status',owner),owned('queue',owner),owned('drafts',owner)]);
  if(stamp!==epoch||period!==month)return;
  const receipts=new Map(q.filter(x=>x.confirmed).map(x=>[x.receipt,x]));
  const cachedQueue=cached?.verifier;
  loaded=Array.isArray(cachedQueue)&&cachedQueue.every(r=>typeof r.mobileTest==='boolean');
  verifier=loaded?cachedQueue:[];
  const monthCache=cached?.dailyMonths?.[period];
  calendarDays=monthCache?.calendar||[];
  const daily=monthCache?.items||[];
  const effective=new Set(daily.flatMap(d=>[d.checkInRecordId,d.checkOutRecordId]).filter(Boolean));
  // Older cache entries can contain unlabeled Mobile Test rows. Only the daily
  // record IDs can corroborate them offline until this month is refreshed.
  todayRows=cached?.scope190?cached.todayRows||[]:[];
  const transactions=monthCache?.transactions||[];
  rows=(monthCache?.scope190?transactions:transactions.filter(r=>effective.has(r.recordId))).map(r=>({...r,capturedAt:receipts.get(r.recordId)?.at}));
  dailyRows=monthCache?.items||[];dailyLoaded=!!monthCache;dailyMonth=period;
  expiredRows=q.filter(q=>q.retired&&Date.now()-q.retiredAt<86400000);
  lastSync=cached?.at||0;queue=q.filter(x=>!x.confirmed&&!x.retired);drafts=d;
}
function tick(){
  if(session&&!valid()){clearSession();toast('Sesi berakhir. Antrean tersimpan untuk login berikutnya.');return}
  const cd=$('#clock-date');if(cd)cd.textContent=wib(now(),{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const clock=$('#clock');if(clock)clock.textContent=wib(now(),{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).replaceAll('.',':');
}
function login(){
  app.className='login';
  app.innerHTML='<div class="identity"><img src="./assets/brand.png" alt="Logo MHS"><h1>Absensi Kehadiran Outsourcing</h1><p>Kecamatan Mentaya Hilir Selatan</p></div><form class="loginbox" id="login"><h2>Selamat Datang!</h2><p>Platform ini adalah sistem terintegrasi untuk mengelola presensi pegawai Kecamatan Mentaya Hilir Selatan.</p><div class="fields"><label class="field">'+icon('user')+'<input name="username" aria-label="Username" placeholder="Username" autocomplete="username" required maxlength="40" value="'+esc(prefs.getItem(ns+'username')||'')+'"></label><label class="field">'+icon('lock')+'<input type="password" name="password" aria-label="Password" placeholder="Password" autocomplete="current-password" required maxlength="256"><button data-act="eye" type="button" aria-label="Tampilkan password">'+icon('eye')+'</button></label></div><div class="loginopts"><label><input type="checkbox" name="remember" '+(prefs.getItem(ns+'username')?'checked':'')+'> Ingat Saya</label>'+btn('forgot','Lupa Password?','link')+'</div><div id="form-error"></div><button class="primary full">'+icon('enter')+' Masuk</button></form>';
}
function passwordForm() {
  const policy = session?.passwordPolicy || {minLength:8,maxLength:128};
  return '<form id="password"><label class="formlabel">Password saat ini'+
    '<input class="control" required name="oldPassword" type="password" autocomplete="current-password"></label>'+
    '<label class="formlabel">Password baru · '+policy.minLength+'–'+policy.maxLength+' karakter'+
    '<input class="control" required minlength="'+policy.minLength+'" maxlength="'+policy.maxLength+
    '" name="newPassword" type="password" autocomplete="new-password"></label>'+
    '<small>Minimal satu huruf, satu angka, dan satu simbol. Huruf besar/kecil tetap dibedakan saat masuk.</small>'+
    '<label class="formlabel">Ulangi password baru<input class="control" required name="confirm" type="password" autocomplete="new-password"></label>'+
    '<button class="primary full">Simpan password</button></form>';
}
function periodButton(){return btn('period',icon('calendar')+' '+esc(fmtDay(period+'-01',{month:'short',year:'numeric'}))+' ⌄','period')}
// Rekap harian hanya dihitung dari MY_DAILY, bukan dari transaksi yang diverifikasi satu per satu.
function summary(){return summarizeDaily(dailyMonth===period?dailyRows:[])}
const colours=['HIJAU','KUNING','MERAH','BIRU','COKELAT'],colourText=['Hadir lengkap','Hadir sebagian','Tidak hadir/gagal','Izin resmi','Insiden'];
const stat=(name,num,color,mark)=>'<div class="stat"><i style="--c:'+color+'">'+mark+'</i><b>'+num+'</b>'+name+'</div>';
const byPeriod=()=>rows.filter(r=>dateISO(r.shiftDate||r.localDate).startsWith(period));
const localTime=t=>wib(t,{hour:'2-digit',minute:'2-digit'}).replace('.',':');
function entries(list){return list.map(r=>{
 const code=r.verificationStatus, mood=code==='VERIFIED'?'green':code==='REJECTED'?'red':'yellow';
 return '<button class="card entry" data-record="'+esc(r.recordId)+'"><span class="datebox"><small>'+esc(fmtDay(r.localDate,{weekday:'short'}))+'</small><b>'+esc(dateISO(r.localDate).slice(-2)||'—')+'</b><small>'+esc(fmtDay(r.localDate,{month:'short'}))+'</small></span><span><b>'+esc(label(r.type))+'</b><small>'+esc(label(r.deliveryStatus))+'</small></span>'+chip(label(code),mood)+'</button>';
}).join('')}
function queueText(q){
 if(q.receipt)return 'Diterima server · status belum lengkap';
 if(!q.v180)return 'Rekaman versi lama · memeriksa tanda terima';
 if(session.writeOpen===false)return 'Presensi sementara belum dibuka oleh pengelola. Tanda terima akan diperiksa.';
 return q.issue||'Penerimaan server belum terkonfirmasi';
}
function backlog(){
 if(!queue.length)return '';
 return card(icon('refresh')+' Status pengiriman',queue.map(q=>'<div class="line"><span><b>'+esc(label(q.action))+
   '</b><br><small>'+esc(queueText(q))+'</small></span>'+btn('detail:'+q.id,'Detail','link')+'</div>').join(''));
}
const statusColours=['#12ac75','#ffb923','#f25162','#2489e0','#b5693c'];
const marks=['✓','◷','×','i','!'];
function dashboard(){
 const hr=Number(wib(now(),{hour:'2-digit',hourCycle:'h23'})),today=dateKey(now()),totals=summary();
 const actions=actNames.map((a,i)=>'<button data-act="'+a+'" class="'+(i?'success':'primary')+'" '+
   (session.writeOpen===false?'disabled':'')+'>'+icon('enter')+' '+label(a)+'</button>').join('');
 const counts=colours.map((c,i)=>'<button class="stat" data-act="category:'+c+'" aria-label="'+colourText[i]+', '+totals[c]+' hari">'+
   '<i style="--c:'+statusColours[i]+'">'+marks[i]+'</i><b>'+(dailyLoaded?totals[c]:'—')+'</b><span>'+colourText[i]+'</span></button>').join('');
 const todayLines=actNames.map((a,i)=>{
   const type=i?'CHECK_OUT':'CHECK_IN',shift=session.shifts?.[a]?.shiftDate||today;
   const r=todayRows.find(x=>x.type===type&&dateISO(x.shiftDate||x.localDate)===shift);
   const q=queue.find(x=>x.action===a&&(x.shiftDate||x.payload?.shiftDate)===shift);
   return line('<span class="dot '+(r?'on':'')+'"></span>'+label(a)+(shift!==today?' · '+esc(fmtDay(shift)):''),esc(r?label(r.verificationStatus):q?'Menunggu konfirmasi':lastSync?'Belum tercatat':'Belum dimuat'));
 }).join('');
 return '<h1>Selamat '+(hr<11?'Pagi':hr<15?'Siang':hr<18?'Sore':'Malam')+' 👋</h1><section class="account">'+avatar()+'<div class="details"><b>'+
   esc(session.name||session.username)+'</b><small>'+esc(session.employeeId)+'</small><small>'+icon('work')+' '+esc(session.unit||session.profession||'Outsourcing')+'</small></div>'+periodButton()+'</section>'+
   '<section class="card wave clock">'+icon('time')+'<div><b id="clock-date">'+esc(wib(now(),{weekday:'long',day:'numeric',month:'long',year:'numeric'}))+'</b>'+
   '<strong><span id="clock"></span> <small>WIB</small></strong></div><button data-act="sync" class="clock-refresh" aria-label="Perbarui data" title="Perbarui data">'+icon('refresh')+'</button></section>'+
   '<div class="badges">'+chip(navigator.onLine?'◈ Internet terhubung':'◈ Offline',navigator.onLine?'':'yellow')+btn('gps',icon('pin')+' '+(Date.now()-gpsAt<60000?'GPS aktif':'Cek GPS'),'chip green')+'</div>'+
   '<div class="two">'+actions+'</div>'+(session.writeOpen===false?msg('Presensi sementara belum dibuka oleh pengelola.'):'')+
   card(icon('calendar')+' Status Absensi Hari Ini',todayLines)+backlog()+
   card(icon('bars')+' Ringkasan Status','<div class="five">'+counts+'</div>')+
   '<div class="three">'+btn('history','Riwayat<br>Absensi','tile','history')+btn('doc','Pengajuan<br>Izin','tile','doc')+btn('incident','Laporan<br>Insiden','tile','shield')+'</div>'+
   card(icon('history')+' Riwayat Terakhir',byPeriod().slice(0,2).map(r=>line(esc(fmtDay(r.localDate))+' · '+esc(label(r.type)),esc(label(r.verificationStatus)))).join('')||empty('Belum ada transaksi pada periode ini.'));
}
function history(){
 const days=category?dailyRows.filter(d=>d.finalStatus===category):dailyRows;
 const allowed=new Set(days.map(d=>d.workDate));
 const all=byPeriod().filter(r=>!category||allowed.has(dateISO(r.shiftDate)));
 const filters=['Semua','Disetujui','Tertunda','Ditolak','Perlu koreksi'],keys=['','VERIFIED','PENDING','REJECTED','NEEDS_CORRECTION'];
 const list=all.filter(r=>filter==='Semua'||r.verificationStatus===keys[filters.indexOf(filter)]);
 return '<div class="between"><h1>Riwayat Absensi</h1>'+periodButton()+'</div>'+
   (category?'<div class="between">'+chip(colourText[colours.indexOf(category)])+btn('history','Semua kategori','link')+'</div>':'')+
   '<section class="card wave four">'+['Transaksi','Disetujui','Tertunda','Ditolak'].map((n,i)=>stat(n,i?all.filter(r=>r.verificationStatus===keys[i]).length:all.length,['#167be0','#18ac6b','#f7b116','#f0525a'][i],['▦','✓','◷','×'][i])).join('')+'</section>'+
   '<div class="filters">'+filters.map(v=>btn('filter:'+v,v,filter===v?'chosen':'')).join('')+'</div>'+
   (category?'':backlog()+expiredRows.map(q=>msg(label(q.action)+' · '+q.issue)).join(''))+card('Rekap Kehadiran Harian',days.length?days.slice().reverse().map(d=>line(btn('day:'+d.workDate,esc(fmtDay(d.workDate)),'link'),esc(dayExplanation(d)))).join(''):empty(dailyLoaded?'Belum ada hari dalam kategori ini.':'Rekap belum dimuat.'))+
   (entries(list)||card('Transaksi',empty('Belum ada transaksi yang cocok.')))+btn('home','Kembali ke Beranda','secondary full back-home','home');
}
const states={HOLIDAY:'Libur',UNSCHEDULED:'Belum terjadwal',UPCOMING:'Terjadwal',UNFINALIZED:'Belum final',IN_PROGRESS:'Shift berjalan',PENDING:'Menunggu verifikasi',REVIEW:'Perlu ditinjau'};
const stateName=state=>states[state]||colourText[colours.indexOf(state)]||'Belum dimuat';
function calendar(){
 const first=new Date(period+'-01T12:00:00Z'),indent=(first.getUTCDay()+6)%7,today=dateKey(now());
 const heading='<div class="month-heading"><h2>'+esc(fmtDay(period+'-01',{month:'long',year:'numeric'}))+'</h2>'+
   '<button data-act="monthMove:-1" aria-label="Bulan sebelumnya">‹</button><button data-act="monthMove:1" aria-label="Bulan berikutnya">›</button></div>';
 const dailyByDate=new Map(dailyRows.map(d=>[d.workDate,d]));
 const byId=new Map(rows.map(r=>[r.recordId,r]));
 const cells=calendarDays.map(d=>{
   const day=dailyByDate.get(d.workDate);
   function legacyTime(id,type){
     const r=byId.get(id);
     if(!r||r.type!==type||r.shiftDate!==d.workDate||day?.partialReason==='DATA_CONFLICT'||r.scheduleId!==day?.scheduleId)return '';
     const match=/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?$/.exec(r.localTime||'');
     return match?match[1].padStart(2,'0')+':'+match[2]:'';
   }
   const times=[d.checkInTime??legacyTime(day?.checkInRecordId,'CHECK_IN'),
     d.checkOutTime??legacyTime(day?.checkOutRecordId,'CHECK_OUT')];
   const shift=({NORMAL:'N',PAGI:'P',SORE:'S',MALAM:'M',LIBUR:'L'})[d.shift]||String(d.shift||'').slice(0,3);
   const description=[fmtDay(d.workDate),d.shift,stateName(d.state),'Check-in '+(times[0]||'—'),'Check-out '+(times[1]||'—')].filter(Boolean).join(' · ');
   return '<button class="cal-day" data-state="'+esc(d.state)+'" data-act="day:'+esc(d.workDate)+'" title="'+esc(description)+'" aria-label="'+
     esc(description)+'" '+(d.workDate===today?'aria-current="date"':'')+'><b>'+Number(d.workDate.slice(-2))+'</b>'+
     times.map(t=>'<small>'+esc(t||'—')+'</small>').join('')+'<em>'+esc(shift||'·')+'</em></button>';
 }).join('');
 return '<h1>'+icon('calendar')+' Shift</h1><section class="card calendar-card">'+heading+
   (cells?'<div class="month-grid">'+['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(d=>'<span>'+d+'</span>').join('')+
     '<i></i>'.repeat(indent)+cells+'</div>':empty('Kalender bulan ini belum dimuat.'))+'</section>';
}
function showDay(date){
 const d=calendarDays.find(x=>x.workDate===date);
 if(!d){modal('Detail Presensi Harian',empty('Perbarui data untuk melihat detail tanggal ini.'));return;}
 const daily=dailyRows.find(x=>x.workDate===date);dayReturn=date;
 const blocks=['CHECK_IN','CHECK_OUT'].map(t=>{
   const records=rows.filter(r=>r.shiftDate===date&&r.type===t);
   return '<section class="day-block"><h3>'+label(t)+'</h3>'+(records.length?entries(records):'<small>Belum ada transaksi</small>')+'</section>';
 }).join('');
 modal('Detail Presensi Harian',line('Tanggal shift',esc(fmtDay(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})))+
   line('Jenis shift',esc(d.shift||'Belum terjadwal'))+line('Jadwal masuk–pulang',esc(d.start&&d.end?d.start+' – '+d.end+(d.nextDay?' (+1 hari)':''):'—'))+
   line('Status harian',esc(daily&&d.state!=='REVIEW'?dayExplanation(daily):stateName(d.state)))+blocks);
}
function leave(){
 return '<h1>'+icon('doc')+' Izin</h1><p class="subhead">Ajukan izin dan pantau status permohonan Anda.</p><section class="card wave between quota">'+icon('calendar')+'<span><small>Sisa cuti tahunan</small><b>—</b> hari</span><span><small>Sisa izin khusus</small><b>—</b> hari</span></section><div class="three">'+btn('newdraft','Ajukan Izin<small>Draf lokal</small>','tile','calendar')+btn('draftlist','Riwayat Izin<small>Lihat semua</small>','tile','history')+btn('rules','Ketentuan Izin<small>Informasi</small>','tile','info')+'</div>'+card(icon('doc')+' Riwayat Permohonan',drafts.length?drafts.slice().reverse().map(d=>line(esc(d.kind)+'<br><small>'+esc(fmtDay(d.day))+'</small>',btn('draft:'+d.id,'Draf lokal','chip yellow'))).join(''):empty('Belum ada draf permohonan.'))+'<div class="card info">'+icon('info')+' Draf tersimpan di perangkat. Pengajuan ke pengelola dan saldo cuti belum tersedia melalui API pilot.</div>';
}
function menu(act,ic,title,sub){return btn(act,'<span><b>'+title+'</b><small>'+sub+'</small></span>','card menu',ic)}
function profile(){
 return '<h1>'+icon('user')+' Profil Saya</h1><section class="account profile wave">'+avatar()+'<div class="details"><b>'+esc(session.name||session.username)+'</b><small>'+esc(session.employeeId)+'</small><small>'+icon('work')+' '+esc(session.unit||session.profession||session.role)+'</small>'+chip(session.role==='VERIFIER'?'Verifikator':'Pegawai aktif','green')+'</div></section>'+menu('photo','user','Foto Profil','Ganti atau hapus foto di perangkat ini')+menu('account','user','Informasi '+(session.role==='VERIFIER'?'Verifikator':'Pegawai'),'Data akun dan unit kerja')+(session.role==='EMPLOYEE'?menu('schedule','calendar','Jadwal Kerja','Jadwal terakhir dari server'):'')+menu('settings','settings','Pengaturan Aplikasi','Pemasangan dan keamanan akun')+menu('about','info','Tentang Aplikasi','Absensi Kehadiran Outsourcing · Pilot')+menu('help','info','Bantuan & Panduan','Panduan penggunaan aplikasi')+menu('logout','enter','Keluar','Keluar dari aplikasi')+'<p class="foot">Absensi Kehadiran Outsourcing<br>Kecamatan Mentaya Hilir Selatan</p>';
}
function verification(){return '<h1>'+icon('shield')+' Verifikasi Absensi</h1><p class="subhead">Tinjau transaksi pilot yang menunggu keputusan.</p><div class="card wave between"><b>'+verifier.length+' transaksi dalam antrean</b><button data-act="sync" class="clock-refresh" aria-label="Perbarui antrean" title="Perbarui antrean">'+icon('refresh')+'</button></div>'+(!navigator.onLine?msg('Koneksi diperlukan untuk memuat dan memutuskan transaksi.'):'')+(verifier.map(r=>'<button class="card entry" data-review="'+esc(r.recordId)+'">'+icon('calendar')+'<span><b>'+esc(r.employeeName||'Nama pegawai belum tersedia')+' · '+esc(label(r.type))+'</b><small>'+esc(fmtDay(r.localDate))+(r.mobileTest?' · MODE UJI · GPS dan waktu simulasi':'')+'</small></span>'+chip('Tinjau','yellow')+'</button>').join('')||card('Antrean verifikator',empty(loaded?'Tidak ada transaksi yang menunggu keputusan.':'Antrean pusat belum dimuat.')))}
function render(){
 if(!session){login();return}
 app.className='';
 if(session.mustChangePassword){app.innerHTML='<div class="shell"><div class="card"><h1>Ganti password awal</h1><p>Tetapkan password pribadi untuk melanjutkan.</p>'+passwordForm()+'<div id="form-error"></div>'+btn('logout','Keluar','link')+'</div></div>';return}
 const isV=session.role==='VERIFIER', pages=isV?['verify','audit','user']:['home','calendar','doc','user'];
 if(!pages.includes(tab)&&(isV||tab!=='history'))tab=pages[0];
 app.innerHTML='<div class="shell"><header class="top"><img src="./assets/brand.png" alt=""><div><strong>Absensi Kehadiran Outsourcing</strong><small>Kecamatan Mentaya Hilir Selatan</small></div><button aria-label="Status sinkronisasi" data-act="updates">'+icon('bell')+'</button></header><div id="page">'+refreshNotice()+({home:dashboard,history,calendar,doc:leave,user:profile,verify:verification,audit:auditPage}[tab])()+'</div></div><nav class="nav" aria-label="Navigasi utama">'+pages.map(n=>'<button data-act="'+n+'" '+((tab===n||(tab==='history'&&n==='home'))?'class="active" aria-current="page"':'')+'>'+icon(n==='verify'?'shield':n==='audit'?'history':n)+titles[n]+'</button>').join('')+'</nav>';tick();updateRefreshIndicator();
}
async function synchronize(manual=false){
 if(!session||session.mustChangePassword||synchronizing||!navigator.onLine)return;
 const s=session, owner=own(), requestedMonth=period,withAudit=s.role==='VERIFIER'&&tab==='audit';synchronizing=true;
 updateRefreshIndicator(manual);
 try{
  if(s.role==='EMPLOYEE'){
   for(const q of await owned('queue',owner)){
    if(session!==s||!navigator.onLine)return;
    if(q.confirmed||q.retired)continue;
    // Sampai v1.7.1 queue dapat berisi payload lama. Hanya tanyakan tanda terimanya.
    let response;
    try{response=await api('RECEIPT',{payload:{submissionId:q.id}});}
    catch(e){if(e.code==='TRANSPORT'||session!==s)throw e;continue;}
    if(session!==s)return;
    if(response.recordId){
      await put('queue',receiptRow(q,response));
    }else if(response.code==='RECEIPT_NOT_FOUND' && (!q.v180 || Date.now()-q.at>600000)){
      await put('queue',{id:q.id,owner,at:q.at,action:q.action,shiftDate:q.shiftDate||q.payload?.shiftDate,
        retired:true,retiredAt:Date.now(),issue:'Bukti lama berakhir. Rekam ulang jika transaksi masih diperlukan.'});
    }

   }
   if(session!==s)return;
  }
  if (!navigator.onLine || session !== s) return;
  const result = await api('REFRESH', {month:requestedMonth,verifierHistory:withAudit});
  if (session !== s) return;
  if (result.code !== 'REFRESH_READY' || !result.context) throw Error('Format pembaruan tidak valid.');
  applyContext(result.context);
  if (s.role === 'VERIFIER') {
    if (!Array.isArray(result.queue?.items)) throw Error('Format antrean tidak valid.');
    if(withAudit){
      if(!Array.isArray(result.history?.items)||!Array.isArray(result.history?.employees))
        throw Error('Riwayat Verifikasi memerlukan backend v1.9.0.');
      audit=result.history;
    }
    await put('status',{owner,verifier:result.queue.items,at:Date.now()});
  } else {
    const daily = result.daily, status = result.status;
    if (daily?.month !== requestedMonth || !Array.isArray(daily.items) ||
        !Array.isArray(status?.items)) throw Error('Format rekap harian server tidak valid.');
    const previous = await get('status',owner), months = {...(previous?.dailyMonths || {})};
    if(!Array.isArray(daily.calendar))throw Error('Backend Kalender Shift belum diperbarui ke v1.8.0.');
    months[requestedMonth] = {scope190:true,items:daily.items,calendar:daily.calendar,transactions:status.items,at:Date.now()};
    await put('status',{owner,scope190:true,todayRows:status.todayRows||[],items:status.items,at:Date.now(),dailyMonths:months});
  }
  if (session !== s) return;
  refreshError = '';
  if(manual&&session===s)toast(s.role==='EMPLOYEE'&&queue.length?'Antrean belum tuntas. Buka detail untuk melihat alasannya.':'Data pusat diperbarui.');
 } catch(e) {
   if (session === s) refreshError = describe(e);
   if (manual) report(e);
 } finally {
   synchronizing = false;
   if (session === s) {
     try { await local(); } catch(e) { refreshError = describe(e); }
     renderRefreshedData();
     updateRefreshIndicator();
   }
 }
}
function scheduleSync(force = false, queueAfter = false) {
  return refreshScheduler.refresh(false, force, queueAfter);
}
async function start(loginResult) {
  const current = session;
  period = period || dateKey(now()).slice(0,7);
  if (loginResult) applyContext(loginResult);
  await local();
  try { await loadPhoto(); } catch { setPhotoURL(''); }
  if (session !== current) return;
  render();
  if (!current.mustChangePassword) scheduleSync(true);
}
function locate(timeout=20000){
 if(!navigator.geolocation)throw Error('GPS tidak tersedia di browser ini.');
 return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>{
   if(!Number.isFinite(p.coords.accuracy)||Date.now()-p.timestamp>60000){reject(Error('Sampel GPS tidak segar. Ambil ulang di area terbuka.'));return}
   gpsAt=Date.now();resolve(p);
 },e=>reject(Error(['','Izin lokasi ditolak. Izinkan lokasi untuk situs ini.','Lokasi belum tersedia. Coba di area terbuka.','GPS belum memperoleh lokasi. Coba lagi.'][e.code]||'GPS gagal.')),{enableHighAccuracy:true,maximumAge:0,timeout}));
}
function receiptRow(q,r){
 const repair=!!r.needsStatusRepair||['ALREADY_ACCEPTED_STATUS_PENDING','RECORDED_STATUS_SYNC_PENDING'].includes(r.code);
 return {id:q.id,owner:q.owner,at:q.at,action:q.action,shiftDate:q.shiftDate||q.payload?.shiftDate,
   v180:true,confirmed:!repair,receipt:r.recordId,issue:repair?'Diterima server · menunggu pembaruan status':''};
}
async function capture(action){
 if(capturing||!valid())return;
 const s=session,owner=own();capturing=true;
 try{
  let again;
  do{
   again=await recordAttendance({dialog,title:label(action),type:action,call:api,describe,
    alive:()=>session===s&&valid(),onDisabled:()=>{if(session===s){s.writeOpen=false;saveSession();}},
    onAccepted:r=>toast(r.mobileTest?'MODE UJI: transaksi simulasi diterima. Tidak masuk rekap kehadiran.':
      r.needsStatusRepair?'Diterima server. Status sedang diselaraskan.':'Presensi diterima server. Menunggu verifikasi.'),
    send:async (data,maySend)=>{
      const q={id:data.id,owner,at:data.at,shiftDate:data.shiftDate,action,v180:true,issue:'Menunggu konfirmasi penerimaan'};
      await put('queue',q);
      if(!maySend())throw Object.assign(Error('Perekaman berakhir.'),{code:'EVIDENCE_EXPIRED'});
      let r;
      try{r=await api(action,{payload:{submissionId:q.id,shiftDate:data.shiftDate,scheduleId:data.scheduleId,photo:data.photo}});}
      catch(e){
        if(!['TRANSPORT','SERVICE_ERROR','LOCK_BUSY_RETRY','RAW_COMMIT_UNCERTAIN_RETRY_SAME_UUID','GET_NOT_AVAILABLE','STATUS_SYNC_CONFLICT','SERVICE_INVALID_RESPONSE'].includes(e.code))
          await put('queue',{...q,retired:true,retiredAt:Date.now(),issue:describe(e)});
        throw e;
      }
      if(!r.recordId||!['RECORDED_PENDING','ALREADY_ACCEPTED','RECORDED_STATUS_SYNC_PENDING','ALREADY_ACCEPTED_STATUS_PENDING'].includes(r.code))
        throw Object.assign(Error('Tanda terima server belum pasti.'),{code:'TRANSPORT'});
      await put('queue',receiptRow(q,r));return r;
    }});
  }while(again&&s===session&&valid()&&s.writeOpen!==false);
 }finally{capturing=false;if(s===session){await local();render();scheduleSync(true,true);}}
}
function auditPage(){
 const from=dateKey(now()-6*86400000),to=dateKey(now());
 const people=(audit?.employees||[]).slice().sort((a,b)=>a.name.localeCompare(b.name,'id'));
 const items=(audit?.items||[]).filter(r=>(!auditEmployee||r.employeeId===auditEmployee)&&
   r.decisions.some(d=>d.day>=from&&d.day<=to));
 return '<h1>'+icon('history')+' Riwayat Verifikasi</h1><p class="subhead">'+
   esc(fmtDay(from)+' – '+fmtDay(to))+' · tanggal keputusan (WIB)</p>'+
   '<label class="formlabel">Pegawai<select id="audit-employee" class="control"><option value="">Semua pegawai</option>'+
   people.map(p=>'<option value="'+esc(p.employeeId)+'" '+(p.employeeId===auditEmployee?'selected':'')+'>'+
     esc(p.name+' · '+p.employeeId)+'</option>').join('')+'</select></label>'+
   (items.map(r=>'<button class="card entry" data-act="auditRecord:'+esc(r.recordId)+'">'+icon('history')+
     '<span><b>'+esc(r.employeeName||r.employeeId)+'</b><small>'+esc(label(r.type)+' · '+r.decisions[0].at)+
     (r.mobileTest?' · MODE UJI':'')+'</small></span>'+chip(label(r.verificationStatus),r.verificationStatus==='VERIFIED'?'green':'yellow')+'</button>').join('')||
     empty(!audit?(navigator.onLine?'Menunggu data riwayat verifikasi.':'Hubungkan internet untuk memuat riwayat verifikasi.'):'Belum ada keputusan dalam tujuh hari ini.'));
}
function reviewIntro(r){
 return '<p><b>'+esc(r.employeeName||r.employeeId)+' · '+esc(label(r.type))+'</b><br>Tanggal shift '+esc(fmtDay(r.shiftDate||r.localDate))+'</p>'+
   (r.mobileTest?'<p><b>MODE UJI · GPS dan waktu simulasi</b></p>':'')+
   (r.hasPhoto?'<div id="review-proof" role="status"></div>':'<small>Transaksi ini memakai alur presensi lama tanpa foto.</small>');
}
function openReview(title,r,body){
 reviewOpen=true;
 refreshScheduler.pause();
 modal(title,reviewIntro(r)+body);
 if(r.hasPhoto)loadProof(r.recordId);
}
async function loadProof(id){
 const target=$('#review-proof'),current=session;
 if(!target||target.getAttribute('aria-busy')==='true')return;
 const visible=()=>dialog.open&&target.isConnected&&session===current;
 target.setAttribute('aria-busy','true');target.textContent='Memuat foto bukti…';
 try{
   const r=await api('REVIEW_PHOTO',{payload:{recordId:id}});
   if(!visible())return;
   if(r.code!=='PHOTO_READY'||!r.jpeg)throw Error('Data foto belum tersedia.');
   const img=new Image();img.className='review-image';img.alt='Foto bukti presensi';
   img.src='data:image/jpeg;base64,'+r.jpeg;
   await img.decode();
   if(visible())target.replaceChildren(img,document.createTextNode((r.mobileTest?'GPS simulasi ':'GPS ')+r.location+' · ±'+r.accuracy+' m'));
 }catch(error){
   if(visible())target.innerHTML=msg(describe(error))+btn('proof:'+esc(id),'Muat ulang foto','secondary','refresh');
 }finally{target.removeAttribute('aria-busy');}
}
function decisionForm(r,opposite=''){
 const choices=opposite?[opposite]:['VERIFIED','REJECTED','NEEDS_CORRECTION'];
 const reject=opposite==='REJECTED';
 return '<form id="decision" data-id="'+esc(r.recordId)+'" '+(opposite?'data-base="'+esc(r.baseDecisionId)+'"':'')+'>'+
   '<label class="formlabel">Keputusan<select name="verdict">'+choices.map(v=>'<option value="'+v+'">'+esc(label(v))+'</option>').join('')+
   '</select></label><label class="formlabel" id="colorlabel" '+(reject?'hidden':'')+'>Status akhir<select name="color">'+
   colours.map((c,i)=>'<option value="'+c+'">'+c+' · '+colourText[i]+'</option>').join('')+'</select></label>'+
   '<label class="formlabel">'+(opposite?'Alasan koreksi':'Catatan')+'<textarea rows="3" name="notes" maxlength="500" '+
   (opposite?'required minlength="5"':'')+'></textarea></label>'+
   '<button class="primary full">'+(opposite?'Simpan koreksi':'Simpan keputusan')+'</button></form>';
}
function showReview(id){
 const r=verifier.find(x=>x.recordId===id);
 if(r)openReview('Tinjau absensi',r,decisionForm(r));
}
function showAudit(id){
 const r=audit?.items.find(x=>x.recordId===id);
 if(!r)return;
 const from=dateKey(now()-6*86400000),to=dateKey(now());
 const decisions=r.decisions.filter(d=>d.day>=from&&d.day<=to);
 if(!decisions.length){render();return;}
 const timeline='<h3>Catatan keputusan</h3>'+decisions.map(d=>'<section class="audit-log"><b>'+
   esc((d.correction?'Koreksi · ':'')+label(d.decision)+(d.color?' · '+d.color:''))+'</b><small>'+
   esc(d.actor+' · '+d.at+' WIB')+'</small>'+(d.notes?'<p>'+esc(d.notes)+'</p>':'')+'</section>').join('');
 const amend=r.correctable?decisionForm(r,r.verificationStatus==='VERIFIED'?'REJECTED':'VERIFIED'):
   !r.synchronized?msg('Keputusan log dan Status_View perlu diselaraskan.')+(r.repairBaseId?
     '<form id="repair" data-id="'+esc(id)+'"><button class="secondary full">Selaraskan keputusan tersimpan</button></form>':''):'';
 openReview('Detail verifikasi',r,timeline+amend);
}
/** v1.7.1: reconcile an uncertain response without ever replaying VERIFY. */
async function commitVerifierDecision(request,mayRepair=true) {
  try {
    const result=await api('VERIFY',{payload:request});
    if(!['VERIFICATION_RECORDED','ALREADY_DECIDED','STATUS_REPAIRED'].includes(result.code))
      throw Error('Server tidak mengembalikan tanda terima verifikasi yang dikenal.');
    return {reconciled:false};
  } catch (error) {
    // Definite authorization, validation and conflict errors remain definite.
    const uncertain=['GET_NOT_AVAILABLE','TRANSPORT','SERVICE_ERROR','SERVICE_INVALID_RESPONSE',
      'LOG_COMMIT_UNCERTAIN_RETRY_SAME_REQUEST','LOG_SAVED_STATUS_REPAIR_REQUIRED',
      'LOCK_BUSY_RETRY'];
    if(!uncertain.includes(error.code))throw error;
    let state;
    try {state=await api('VERIFY_RESULT',{payload:request});}
    catch (_) {
      throw Error('Respons verifikasi tidak pasti dan pemeriksaan ulang gagal. Jangan menekan Simpan lagi sebelum memeriksa status di Sheet.');
    }
    if(state.code==='VERIFY_RESULT_CONFIRMED'&&state.matched===true)
      return {reconciled:true};
    if(state.code==='VERIFY_RESULT_PARTIAL'&&request.baseDecisionId&&mayRepair)
      return commitVerifierDecision(request,false);
    if(state.code==='VERIFY_RESULT_PARTIAL')
      throw Error('Keputusan sudah ada di Verification_Log, tetapi Status_View belum sinkron. Jangan mengirim keputusan baru; hubungi pengelola.');
    if(state.code==='VERIFY_RESULT_CONFLICT')
      throw Error('Server menemukan keputusan lain atau keputusan yang tidak cocok. Jangan mengirim ulang; perbarui antrean dan periksa Sheet.');
    if(state.code==='VERIFY_RESULT_PENDING')
      throw Error('Keputusan belum tampak tersimpan saat pemeriksaan. Jangan mengirim ulang sebelum memastikan status terbaru di Sheet.');
    throw Error('Hasil verifikasi belum dapat dipastikan. Jangan mengirim ulang sebelum memeriksa Verification_Log dan Status_View.');
  }
}
function showDraft(){
 modal('Ajukan izin','<p>Draf ini hanya tersimpan di perangkat. Sampaikan permohonan kepada pengelola melalui jalur yang berlaku.</p><form id="draft"><label class="formlabel">Jenis permohonan<select name="kind"><option>Izin sakit</option><option>Cuti tahunan</option><option>Izin mendadak</option></select></label><label class="formlabel">Tanggal<input class="control" type="date" name="day" required></label><label class="formlabel">Alasan<textarea rows="3" name="reason" required maxlength="500"></textarea></label><button class="primary full">Simpan draf</button></form>');
}
function details(r){
 const shift=r.shiftDate,day=shift&&dailyRows.find(d=>d.workDate===dateISO(shift));
 modal('Detail '+label(r.type),line('Tanggal shift',r.shiftDate?esc(fmtDay(shift)):'Belum tersedia')+
   line('Waktu kejadian',esc(fmtDay(r.localDate))+' · '+esc(r.localTime||'—')+' WIB')+
   line('Diterima server',esc(r.receivedAt||'Belum tersedia'))+
   line('Pengiriman',esc(label(r.deliveryStatus)))+line('Keputusan verifikator',esc(label(r.verificationStatus)))+
   (r.verifiedAt?line('Waktu keputusan',esc(r.verifiedAt)): '')+
   line('Status transaksi',esc(r.finalStatus||'Belum final'))+(day?line('Status harian',esc(dayExplanation(day))):'')+
   (r.latitude!==undefined&&r.latitude!==''?line('Koordinat',esc(r.latitude)+', '+esc(r.longitude))+line('Akurasi GPS','±'+esc(r.accuracy)+' m'):'')+
   '<small class="mono">'+esc(r.recordId)+'</small>'+(dayReturn?btn('day:'+dayReturn,'Kembali ke detail harian','secondary full'):''));
}
async function act(a){
 const [key,arg]=a.split(':');
 if(['home','history','calendar','doc','user','verify','audit'].includes(key)){const entering=tab!==key;category='';filter='Semua';dayReturn='';tab=key;render();window.scrollTo(0,0);if(entering&&['history','calendar','verify','audit'].includes(key))scheduleSync(true);return}
 switch(key){
 case 'eye':{const p=$('[name=password]');p.type=p.type==='password'?'text':'password';$('[data-act=eye]').setAttribute('aria-label',p.type==='text'?'Sembunyikan password':'Tampilkan password');break}
 case 'forgot':modal('Lupa password?','<p>Hubungi operator Kecamatan Mentaya Hilir Selatan untuk verifikasi identitas dan pengaturan ulang password akun.</p>');break;
 case 'sync':await refreshScheduler.refresh(true);break;
 case 'category':category=arg;tab='history';dayReturn='';filter='Semua';render();window.scrollTo(0,0);scheduleSync(true);break;
 case 'monthMove':{
   const d=new Date(period+'-15T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(arg));
   period=d.toISOString().slice(0,7);await local();render();scheduleSync(true);break;
 }
 case 'day':showDay(arg);break;
 case 'proof':await loadProof(arg);break;
 case 'auditRecord':showAudit(arg);break;
 case 'filter':filter=arg;render();break;
 case 'period':modal('Periode riwayat','<form id="month"><label class="formlabel">Bulan<input class="control" type="month" required name="month" value="'+esc(period)+'"></label><button class="primary full">Tampilkan</button></form>');break;
 case 'gps':{const s=session, pos=await locate();if(s===session){render();toast('Lokasi diperoleh · akurasi ±'+Math.round(pos.coords.accuracy)+' m.')}break}
 case 'CHECKIN':case 'CHECKOUT':await capture(key);break;
 case 'detail':{
   const q=queue.find(x=>x.id===arg);if(q)modal('Status '+label(q.action),
     line('Tanggal shift',esc(q.shiftDate||q.payload?.shiftDate||'—'))+line('Pengiriman',esc(queueText(q)))+
     '<small class="mono">'+esc(q.id)+'</small>');break;
 }
 case 'newdraft':showDraft();break;
 case 'draftlist':modal('Riwayat izin',drafts.length?drafts.map(d=>line(esc(d.kind),esc(fmtDay(d.day)))).join(''):empty('Belum ada draf izin.'));break;
 case 'draft':{const d=drafts.find(x=>x.id===arg);if(d)modal(d.kind,line('Tanggal',esc(fmtDay(d.day)))+'<p>'+esc(d.reason)+'</p>'+chip('Draf lokal','yellow')+' '+btn('deleteDraft:'+arg,'Hapus draf','danger'));break}
 case 'deleteDraft':await remove('drafts',arg);await local();dialog.close();render();break;
 case 'rules':modal('Ketentuan izin','<p>Hubungi pengelola untuk kuota dan persetujuan izin. API pilot belum menyediakan saldo cuti atau pengiriman permohonan.</p>');break;
 case 'incident':modal('Laporan insiden','<p>Laporkan insiden langsung kepada pengelola. Gateway pilot belum menerima laporan insiden.</p>');break;
 case 'updates':modal('Status sinkronisasi','<p>'+esc(session.role==='VERIFIER'?'Antrean verifikasi diperbarui saat aplikasi aktif.':queue.length+' transaksi lokal menunggu sinkronisasi.')+'</p>'+btn('sync','Perbarui dari server','primary','refresh'));break;
 case 'account':modal('Informasi akun',line('Identitas',esc(session.employeeId))+line('Username',esc(session.username))+line('Nama',esc(session.name||'—'))+line('Profesi',esc(session.profession||'—'))+line('Unit',esc(session.unit||'—')));break;
 case 'schedule':modal('Jadwal kerja','<p>Referensi terakhir yang dikembalikan validator jadwal.</p>'+actNames.map(x=>{const r=session.shifts?.[x];return line(label(x),r?.scheduleId?esc([r.shiftDate,r.shiftCode,r.scheduleId].filter(Boolean).join(' · ')):'Belum tersedia')}).join(''));break;
 case 'photo':
   modal('Foto profil lokal','<p>Foto disimpan untuk akun ini di perangkat ini. Foto tidak otomatis tersedia di perangkat lain dan hanya digunakan untuk tampilan profil.</p>'+
     '<form id="photo-form"><label class="formlabel">Pilih foto JPG, PNG, WebP · maksimal 5 MB'+
     '<input class="control" type="file" name="photo" accept="image/jpeg,image/png,image/webp" required></label>'+
     '<small>Foto dipotong persegi dan disimpan dalam ukuran 256 × 256 piksel.</small>'+
     '<button class="primary full">Simpan foto</button></form>'+btn('delete-photo','Hapus foto lokal','secondary'));break;
 case 'delete-photo': {
   const current = session, owner = own();photoGeneration++;
   await deletePhoto(owner);
   if (current !== session) return;
   setPhotoURL('');dialog.close();render();toast('Avatar default digunakan.');break;
 }
 case 'performance':
   modal('Pengukuran performa',getTimings().length ?
     '<p>Durasi permintaan mencakup jaringan dan server. Satuan milidetik.</p>'+
     getTimings().map(sample=>'<p>'+esc(JSON.stringify(sample))+'</p>').join('') :
     '<p>Pengelola dapat mengaktifkan MHS_POC_PROFILE_ENABLED=YES, lalu menguji login ulang.</p>');break;
 case 'settings':modal('Pengaturan aplikasi','<div class="inline">'+btn('install','Pasang aplikasi','primary')+btn('password','Ubah password','secondary')+btn('probe','Uji koneksi API','secondary')+btn('performance','Durasi permintaan','secondary')+'</div>');break;
 case 'probe':await probe();modal('Uji koneksi API','<p>✓ GET health terbaca.</p><p>✓ POST tanpa token menghasilkan SESSION_REQUIRED.</p><p>Transport siap diuji dengan akun pilot.</p>');break;
 case 'install':if(installEvent){await installEvent.prompt();installEvent=null}else toast('Buka menu browser → Instal aplikasi / Tambahkan ke layar utama.');break;
 case 'password':modal('Ubah password',passwordForm());break;
 case 'about':modal('Tentang aplikasi','<p>Absensi Kehadiran Outsourcing<br>Kecamatan Mentaya Hilir Selatan</p><p>Pilot PWA 1.9.0</p>');break;
 case 'help':modal('Bantuan & panduan','<p>Masuk saat online untuk memuat jadwal. Izinkan kamera dan GPS, kunci lokasi, lalu selesaikan tiga tantangan. Tinjau foto dan kirim dalam lima menit.</p><p>Buka tab Shift untuk detail harian atau tekan warna di Ringkasan Status untuk melihat riwayat.</p>');break;
 case 'logout':modal('Keluar dari aplikasi?','<p>Foto presensi yang belum dikirim akan dihapus saat perekaman ditutup.</p>'+btn('confirmLogout','Keluar','danger'));break;
 case 'confirmLogout':{let revoked=false;try{if(navigator.onLine){await api('LOGOUT');revoked=true}}finally{clearSession();toast(revoked?'Anda telah keluar.':'Sesi lokal ditutup. Sesi server berakhir sesuai masa berlakunya.')}break}
 }
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||b.disabled)return;
 if(b.id==='close'){dialog.close();return}
 if(b.dataset.record){if(!dialog.open)dayReturn='';const r=rows.find(x=>x.recordId===b.dataset.record);if(r)details(r);return}
 if(b.dataset.review){showReview(b.dataset.review);return}
 if(!b.dataset.act)return;
 b.disabled=true;
 try{await act(b.dataset.act)}catch(err){report(err)}finally{b.disabled=false}
});
document.addEventListener('change',e=>{
 if(e.target.id==='audit-employee'){auditEmployee=e.target.value;render();return;}
 if(e.target.name==='verdict'){
 const hide=e.target.value!=='VERIFIED',required=hide||!!e.target.form.dataset.base;$('#colorlabel').hidden=hide;const notes=e.target.form.elements.notes;notes.required=required;notes.minLength=required?5:0;
}});
document.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.target, input=Object.fromEntries(new FormData(f)), b=f.querySelector('button:not([type=button])');
 if(!b||b.disabled)return;b.disabled=true;const initial=b.textContent;b.textContent=f.id==='login'?'Memeriksa akun…':'Memproses…';
 try{
  switch(f.id){
  case 'login':{
    if(!navigator.onLine)throw Error('Login memerlukan internet.');
    const r=await post('LOGIN',{username:input.username.trim(),password:input.password});
    if(!r.token||!['EMPLOYEE','VERIFIER'].includes(r.role)||!r.employeeId)throw Error('Identitas respons login tidak lengkap.');
    const expires=Date.parse(r.expiresAtWIB.replace(' ','T')+'+07:00');
    if(!Number.isFinite(expires)||expires<=Date.now())throw Error('Waktu sesi tidak valid. Periksa jam perangkat.');
    prefs.removeItem(ns+'username');if(input.remember)prefs.setItem(ns+'username',input.username.trim());
    f.elements.password.value='';session={token:r.token,expires,employeeId:r.employeeId,role:r.role,username:input.username.trim(),profession:r.profession,mustChangePassword:!!r.mustChangePassword};epoch++;saveSession();
    try{await start(r)}catch(err){clearSession();throw err}break}
  case 'photo-form': {
    const current = session, owner = own(), generation = ++photoGeneration;
    const blob = await preparePhoto(f.elements.photo.files[0]);
    if (current !== session || generation !== photoGeneration) break;
    await savePhoto(owner, blob);
    if (current !== session || generation !== photoGeneration) break;
    await loadPhoto();
    if (current !== session) break;
    dialog.close();render();toast('Foto disimpan di perangkat ini.');break;
  }
  case 'password':
   if (!/[A-Za-z]/.test(input.newPassword) || !/[0-9]/.test(input.newPassword) ||
       !/[^A-Za-z0-9\s]/.test(input.newPassword))
     throw Error('Gunakan minimal satu huruf, satu angka, dan satu simbol.');
   if(input.newPassword!==input.confirm)throw Error('Konfirmasi password belum sesuai.');await api('CHANGE_PASSWORD',{oldPassword:input.oldPassword,newPassword:input.newPassword});clearSession();toast('Password tersimpan. Masuk kembali dengan password baru.');break;
  case 'repair':case 'decision':{
    const current=session;
    if(deciding||!navigator.onLine)throw Error('Sambungkan internet untuk menyimpan keputusan.');
    let request={recordId:f.dataset.id,verificationStatus:input.verdict,
      finalStatus:input.verdict==='VERIFIED'?input.color:'',notes:(input.notes||'').trim()};
    if(f.dataset.base)request.baseDecisionId=f.dataset.base;
    if(f.id==='repair'){
      const row=audit?.items.find(r=>r.recordId===f.dataset.id),head=row?.decisions[0];
      if(!row?.repairBaseId||!head)throw Error('Muat ulang riwayat untuk memeriksa keputusan.');
      request={recordId:row.recordId,baseDecisionId:row.repairBaseId,verificationStatus:head.decision,finalStatus:head.color,notes:head.notes};
    }
    deciding=true;$('#close').disabled=true;
    let result;
    try{result=await commitVerifierDecision(request);}
    finally{deciding=false;$('#close').disabled=false;}
    if(session!==current||!f.isConnected)break;
    reviewOpen=false;dialog.close();verifier=verifier.filter(x=>x.recordId!==request.recordId);
    toast(result.reconciled?'Keputusan dikonfirmasi dari catatan server.':'Keputusan dicatat server.');
    if(request.baseDecisionId)audit=null;
    render();await scheduleSync(true,true);break;
  }
  case 'month':period=input.month;dialog.close();await local();render();scheduleSync(true);break;
  case 'draft':if(!input.reason.trim())throw Error('Isi alasan permohonan.');await put('drafts',{id:crypto.randomUUID(),owner:own(),at:Date.now(),kind:input.kind,day:input.day,reason:input.reason.trim()});await local();dialog.close();render();toast('Draf izin tersimpan di perangkat.');break;
  }
 }catch(err){report(err)}finally{b.disabled=false;b.textContent=initial}
});
window.addEventListener('online', () => {
  const wasOffline = foregroundOffline;
  foregroundOffline = false;
  updateRefreshIndicator();
  if (session) scheduleSync(wasOffline, false);
});
window.addEventListener('offline', () => {
  foregroundOffline = true;
  refreshScheduler.pause();
  updateRefreshIndicator();
});
window.addEventListener('beforeinstallprompt', e => {e.preventDefault();installEvent=e});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) refreshScheduler.pause();
  else if (session) scheduleSync();
});
dialog.addEventListener('cancel',e=>{if(deciding)e.preventDefault();});
dialog.addEventListener('close', () => {
  if(!dialog.open&&reviewOpen){reviewOpen=false;scheduleSync();}
  if (!dialog.open){const proof=$('#review-proof');if(proof)proof.replaceChildren();}
  if (refreshDeferred) renderRefreshedData();
});
document.addEventListener('focusout', () => {
  if (refreshDeferred) setTimeout(renderRefreshedData,0);
});
document.addEventListener('error', event => {
  if (event.target.matches?.('img.avatar') && profilePhoto) {
    setPhotoURL('');
    renderRefreshedData();
  }
}, true);
setInterval(tick,1000);
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>toast('Cache offline belum siap. Buka kembali saat online.'));
try{session=JSON.parse(temporary.getItem(ns+'session'));if(valid()){await start()}else clearSession()}catch(e){if(session)render();else login();report(e)}
