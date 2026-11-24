import {esc,btn,chip,msg,card,line,empty} from './ui.js';
import {requestNames,normalizeDraft,requestList,leavePage,requestForm,requestDetail,lateCard,previewCard} from './views200.js';
import {recordAttendance} from './capture.js';
import {post,probe,getTimings} from './api.js';
import {put,get,remove,owned} from './store.js';
import {icon} from './icons.js';
import {summarizeDaily,dayExplanation} from './daily.js';
import {createRefreshScheduler} from './refresh.js';
import {avatarKind, photoURL, preparePhoto, savePhoto, deletePhoto} from './photo.js';

const $=s=>document.querySelector(s), app=$('#app'), dialog=$('#dialog');
const ns='mhs:'+location.pathname.replace(/index\.html$/,'')+':'+window.MHS_CONFIG.apiUrl+':';
const prefs=localStorage, temporary=sessionStorage;
let session=null, tab='home', rows=[], dailyRows=[], dailyMonth='', dailyLoaded=false, queue=[], drafts=[], lastSync=0, verifier=[], loaded=false;
let period='', filter='Semua', gpsAt=0, synchronizing=false, capturing=false, toastTimer, reconnectTimer, installEvent, epoch=0;
let profilePhoto = '', photoGeneration = 0, refreshError = '', refreshDeferred = false;
let expiredRows=[],todayRows=[],calendarDays=[], category='', dayReturn='';
let audit=null, auditEmployee='', reviewOpen=false, deciding=false;
let requestData=null, lateness=null, preview=[], previewMonth='';
const mobilePreview=()=>navigator.onLine&&previewMonth===period?preview:[];
function clearPreview(){preview=[];previewMonth='';document.querySelectorAll('[data-test-preview]').forEach(el=>el.remove());}
const requestItems=()=>{
 const byId=new Map(drafts.map(d=>[d.id,normalizeDraft(d)]));
 for(const r of requestData?.items||[])byId.set(r.id,r);
 return [...byId.values()].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
};
let recoverySession=null, recoveryAlerts=null;
let verifierNetwork=Promise.resolve();
const refreshScope=()=>session?.role==='VERIFIER'?((tab==='audit'?'audit':'queue')+period):period;
let foregroundOffline = !navigator.onLine;
const refreshScheduler = createRefreshScheduler(
  manual => synchronize(manual),
  () => !!session && !session.mustChangePassword && navigator.onLine && !document.hidden && !reviewOpen && !deciding,
  180000,refreshScope
);
const pending='Menunggu verifikasi', titles={home:'Beranda',history:'Riwayat',calendar:'Shift',audit:'Riwayat',doc:'Izin',user:'Profil',verify:'Verifikasi',stats:'Statistik'};
const labels={PENDING:pending,VERIFIED:'Disetujui',REJECTED:'Ditolak',NEEDS_CORRECTION:'Perlu koreksi',CONFIRMED:'Terkirim',CHECK_IN:'Check-in',CHECK_OUT:'Check-out',CHECKIN:'Check-in',CHECKOUT:'Check-out'};
const errors={TEST_RUN_CHANGED:'Sesi uji telah berganti. Buka ulang perekaman atau pengaturan.',DEVELOPER_FORBIDDEN:'Mode developer sudah ditutup untuk akun ini.',CORRECTION_CONFLICT:'Keputusan sudah berubah atau catatan belum selaras. Buka kembali Riwayat Verifikasi.',CORRECTION_WINDOW_CLOSED:'Keputusan sudah di luar periode koreksi tujuh hari.',POC_WRITE_DISABLED:'Presensi sementara belum dibuka oleh pengelola.',EVIDENCE_EXPIRED:'Bukti sudah kedaluwarsa. Rekam ulang presensi.',CHALLENGE_EXPIRED:'Waktu tantangan habis. Rekam ulang presensi.',CAPTURE_INVALID:'Sesi perekaman berakhir. Rekam ulang presensi.',LIVENESS_INCOMPLETE:'Hasil tantangan tidak lengkap atau melewati batas waktu. Rekam ulang presensi.',PHOTO_UNAVAILABLE:'Foto belum tersedia atau telah melewati masa simpan.',DUPLICATE_SHIFT_ACTION:'Transaksi ini sudah tercatat untuk shift yang sama.',PHOTO_MISMATCH:'Foto berbeda dari bukti yang dikonfirmasi.',GEOFENCE_REJECTED:'Lokasi atau akurasi belum memenuhi batas kantor.',EVIDENCE_REQUIRED:'Sesi bukti berakhir. Rekam ulang presensi.',INVALID_CREDENTIALS:'Username atau password tidak cocok.',API_DISABLED:'Pengelola perlu mengaktifkan API PoC.',SIMULATION_PANEL_ONLY:'Mode simulasi sidebar masih aktif.',MOBILE_TEST_CONFIG_INVALID:'Konfigurasi Mobile Test belum lengkap. Periksa Script Properties.',MOBILE_TEST_MODE_CHANGED:'Mode uji berubah saat perekaman. Rekam ulang.',TIME_WINDOW_CLOSED:'Jendela waktu absensi sudah tutup.',CHECKIN_REQUIRED_FOR_CHECKOUT:'Server belum menerima Check-in untuk shift ini.',SESSION_EXPIRED:'Sesi berakhir. Masuk kembali dengan akun yang sama.',REASON_REQUIRED:'Isi alasan minimal lima karakter.',PASSWORD_LENGTH:'Panjang password belum sesuai kebijakan yang ditampilkan.',PASSWORD_COMPLEXITY:'Gunakan minimal satu huruf, satu angka, dan satu simbol.',PASSWORD_CHANGE_REQUIRED:'Ganti password awal terlebih dahulu.',SCHEDULE_NOT_PUBLISHED:'Jadwal belum disetujui untuk absensi.',DEPENDENCY_UNAVAILABLE:'Modul aturan jadwal tidak tersedia di proyek Apps Script.'};
Object.assign(errors,{
  TOO_MANY_ATTEMPTS:'Batas percobaan tercapai. Coba lagi setelah 15 menit.',
  RECOVERY_CONFLICT:'Status permintaan telah berubah. Tutup dialog dan perbarui antrean.',
  RECOVERY_SETUP_REQUIRED:'Pemulihan belum siap. Hubungi Operator untuk memeriksa konfigurasi akun.',
  RECOVERY_SERVICE_REQUIRED:'Hubungi Operator untuk mengaktifkan Google Sheets API pada proyek Apps Script.',
  RECOVERY_EXPIRED:'Sesi pemulihan berakhir. Masuk kembali dengan kode aktif.',
  PASSWORD_REUSED:'Pilih password baru yang berbeda dari password lama dan kode pemulihan.',
  AUTH_RETRY_REQUIRED:'Layanan sedang sibuk. Coba kembali.'
});
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
const actNames=['CHECKIN','CHECKOUT'];
function toast(t){$('#notice').textContent=t;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#notice').textContent='',6500)}
function modal(title,body){delete $('#panel').dataset.privateRecovery;$('#panel').innerHTML='<h2>'+esc(title)+'</h2>'+body+'<div id="feedback" role="status"></div>';if(!dialog.open)dialog.showModal()}
function report(e){const t=describe(e)+(e.code&&!['CONFIG','TRANSPORT'].includes(e.code)?' ('+e.code+')':'');if(dialog.open&&$('#feedback'))$('#feedback').innerHTML=msg(t);else if($('#form-error'))$('#form-error').innerHTML=msg(t);else toast(t)}
function saveSession(){temporary.setItem(ns+'session',JSON.stringify(session))}
function clearSession(){recoverySession=null;recoveryAlerts=null;requestData=null;lateness=null;clearPreview();audit=null;auditEmployee='';reviewOpen=false;deciding=false;category='';dayReturn='';calendarDays=[];todayRows=[];expiredRows=[];epoch++;refreshScheduler.reset();photoGeneration++;setPhotoURL('');refreshError='';refreshDeferred=false;session=null;temporary.removeItem(ns+'session');rows=[];dailyRows=[];dailyMonth='';dailyLoaded=false;queue=[];drafts=[];verifier=[];loaded=false;lastSync=0;gpsAt=0;period='';filter='Semua';tab='home';if(dialog.open)dialog.close();render()}
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
    registeredAt:result.registeredAt??current.registeredAt??'',gender:result.gender || '', passwordPolicy:result.passwordPolicy || current.passwordPolicy,
    mustChangePassword:!!result.mustChangePassword,
    contextDay:dateKey(result.serverEpoch || Date.now()),
    offset:result.serverEpoch ? result.serverEpoch-Date.now() : current.offset || 0,
    clockSynced:!!result.serverEpoch
  });
  if (typeof result.incidentTest==='boolean')current.incidentTest=result.incidentTest;
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
  page.innerHTML = refreshNotice()+({home:dashboard,history,calendar,doc:leave,user:profile,verify:verification,audit:auditPage,stats:statisticsPage}[tab])();
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
  if(session.role==='EMPLOYEE')requestData=cached?.requests||null;
  if(session.role==='EMPLOYEE')lateness=cached?.dailyMonths?.[period]?.scope250?cached.dailyMonths[period].lateness:null;
  const cachedQueue=cached?.verifier;
  loaded=Array.isArray(cachedQueue)&&cachedQueue.every(r=>typeof r.mobileTest==='boolean');
  verifier=loaded?cachedQueue:[];
  const monthCache=cached?.dailyMonths?.[period];
  const trusted=monthCache?.scope200===true;
  calendarDays=trusted?monthCache.calendar||[]:[];
  // Refill older status projections online; keep all queues, drafts and profile data.
  todayRows=cached?.scope200?cached.todayRows||[]:[];
  rows=(trusted?monthCache.transactions||[]:[]).map(r=>({...r,capturedAt:receipts.get(r.recordId)?.at}));
  dailyRows=trusted?monthCache.items||[]:[];dailyLoaded=trusted;dailyMonth=period;
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
  app.innerHTML='<div class="identity"><img src="./assets/icon-512.png" alt="Lambang Kabupaten Kotawaringin Timur"><h1>Absensi Kehadiran Outsourcing</h1><p>Kabupaten Kotawaringin Timur</p></div><form class="loginbox" id="login"><h2>Selamat Datang!</h2><p>Platform ini adalah sistem terintegrasi untuk mengelola presensi pegawai Kabupaten Kotawaringin Timur.</p><div class="fields"><label class="field">'+icon('user')+'<input name="username" aria-label="Username" placeholder="Username" autocomplete="username" required maxlength="40" value="'+esc(prefs.getItem(ns+'username')||'')+'"></label><label class="field">'+icon('lock')+'<input type="password" name="password" aria-label="Password" placeholder="Password" autocomplete="current-password" required maxlength="256"><button data-act="eye" type="button" aria-label="Tampilkan password">'+icon('eye')+'</button></label></div><div class="loginopts"><label><input type="checkbox" name="remember" '+(prefs.getItem(ns+'username')?'checked':'')+'> Ingat Saya</label>'+btn('forgot','Lupa Password?','link')+'</div><div id="form-error"></div><button class="primary full">'+icon('enter')+' Masuk</button></form>';
}
function passwordForm(reset=false) {
  const policy = (reset?recoverySession:session)?.passwordPolicy || {minLength:8,maxLength:128};
  return '<form id="'+(reset?'finish-recovery':'password')+'">'+(reset?'':'<label class="formlabel">Password saat ini'+
    '<input class="control" required name="oldPassword" type="password" autocomplete="current-password"></label>')+
    '<label class="formlabel">Password baru · '+policy.minLength+'–'+policy.maxLength+' karakter'+
    '<input class="control" required minlength="'+policy.minLength+'" maxlength="'+policy.maxLength+
    '" name="newPassword" type="password" autocomplete="new-password"></label>'+
    '<small>Minimal satu huruf, satu angka, dan satu simbol. Huruf besar/kecil tetap dibedakan saat masuk.</small>'+
    '<label class="formlabel">Ulangi password baru<input class="control" required name="confirm" type="password" autocomplete="new-password"></label>'+
    '<button class="primary full">'+(reset?'Ganti Password':'Simpan password')+'</button></form>';
}
function periodButton(){return btn('period',icon('calendar')+' '+esc(fmtDay(period+'-01',{month:'short',year:'numeric'}))+' ⌄','period')}
// Rekap harian hanya dihitung dari MY_DAILY, bukan dari transaksi yang diverifikasi satu per satu.
function summary(){return summarizeDaily(dailyMonth===period?dailyRows:[])}
// Backend retains MERAH for legacy Daily_Attendance and verifier contracts.
// Calendar/dashboard use the six-color UI palette; do not reuse Late Count colors.
const colours=['HIJAU','KUNING','MERAH','BIRU','COKELAT'],colourText=['Hadir lengkap','Hadir sebagian','Tidak hadir','Izin resmi','Insiden'];
const calendarVisualState=state=>state==='MERAH'?'GRAY':state;
const calendarPalette=[
 ['HIJAU','Hadir lengkap'],['KUNING','Parsial A/B'],['GRAY','Tidak hadir A/B'],
 ['BIRU','Izin'],['COKELAT','Insiden'],['HOLIDAY','Libur / cuti bersama']
];
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
const statusColours=['#12ac75','#ffb923','#414b56','#2489e0','#b5693c'];
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
   const q=queue.find(x=>!x.testRunId&&x.action===a&&(x.shiftDate||x.payload?.shiftDate)===shift);
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
   '<div class="three">'+btn('history','Riwayat<br>Absensi','tile','history')+btn('newdraft','Pengajuan<br>Izin','tile','doc')+btn('incident','Laporan<br>Insiden','tile','shield')+'</div>'+
   lateCard(lateness,period,false,periodButton)+card(icon('history')+' Riwayat Terakhir',byPeriod().slice(0,2).map(r=>line(esc(fmtDay(r.localDate))+' · '+esc(label(r.type)),esc(label(r.verificationStatus)))).join('')||empty('Belum ada transaksi pada periode ini.'));
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
   (category?'':previewCard(mobilePreview()))+(entries(list)||card('Transaksi',empty('Belum ada transaksi yang cocok.')))+btn('home','Kembali ke Beranda','secondary full back-home','home');
}
const states={HOLIDAY:'Libur / cuti bersama',GRAY:'Tidak hadir',UNSCHEDULED:'Belum terjadwal',UPCOMING:'Terjadwal',UNFINALIZED:'Belum final',IN_PROGRESS:'Shift berjalan',PENDING:'Menunggu verifikasi',REVIEW:'Perlu ditinjau'};
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
   const shift=({NORMAL:'P',PAGI:'P',SORE:'S',MALAM:'M',LIBUR:'L'})[d.shift]||String(d.shift||'').slice(0,3);
   const visualState=calendarVisualState(d.state);
   const description=[fmtDay(d.workDate),d.shift,stateName(visualState),'Check-in '+(times[0]||'—'),'Check-out '+(times[1]||'—')].filter(Boolean).join(' · ');
   return '<button class="cal-day" data-state="'+esc(visualState)+'" data-act="day:'+esc(d.workDate)+'" title="'+esc(description)+'" aria-label="'+
     esc(description)+'" '+(d.workDate===today?'aria-current="date"':'')+'><b>'+Number(d.workDate.slice(-2))+'</b>'+
     times.map(t=>'<small>'+esc(t||'—')+'</small>').join('')+'<em>'+esc(shift||'·')+'</em></button>';
 }).join('');
 return '<h1>'+icon('calendar')+' Shift</h1><section class="card calendar-card">'+heading+
   (cells?'<div class="month-grid">'+['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(d=>'<span>'+d+'</span>').join('')+
     '<i></i>'.repeat(indent)+cells+'</div>':empty('Kalender bulan ini belum dimuat.'))+
   '<div class="cal-palette" role="list" aria-label="Legenda warna Kalender Shift">'+
     calendarPalette.map(([state,description])=>'<span class="cal-palette-item" role="listitem">'+
       '<i class="cal-palette-swatch" data-state="'+state+'" aria-hidden="true"></i>'+description+'</span>').join('')+
   '</div></section>'+previewCard(mobilePreview());
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
   line('Jenis shift',esc(d.shift==='I'?'I · Insiden disetujui':d.shift||'Belum terjadwal'))+(d.shift==='I'?line('Shift asli',esc(d.originalShift||'Belum terjadwal')):'')+line('Jadwal masuk–pulang',esc(d.start&&d.end?d.start+' – '+d.end+(d.nextDay?' (+1 hari)':''):'—'))+
   line('Status harian',esc(daily&&d.state!=='REVIEW'?dayExplanation(daily):stateName(d.state)))+blocks+previewCard(mobilePreview(),date));
}
function leave(){
 return leavePage({data:requestData,items:requestItems(),day:dateKey(now()),registered:session.registeredAt,fmtDay});
}
function menu(act,ic,title,sub=''){return btn(act,'<span><b>'+title+'</b>'+(sub?'<small>'+sub+'</small>':'')+'</span>','card menu',ic)}
function profile(){
 const role=session.role==='VERIFIER'?'Verifikator':'Pegawai';
 const group=(title,items)=>'<section class="profile-group"><h2>'+title.toLocaleUpperCase('id-ID')+'</h2>'+items+'</section>';
 return '<h1>'+icon('user')+' Profil Saya</h1><section class="account profile wave"><div class="profile-picture">'+avatar()+
   '<button type="button" class="avatar-plus" data-act="photo" aria-label="Ganti atau hapus foto profil">+</button></div><div class="details"><b>'+
   esc(session.name||session.username)+'</b><small>'+esc(session.employeeId)+'</small><small>'+icon('work')+' '+
   esc(session.unit||session.profession||role)+'</small>'+chip(role+' aktif','green')+'</div></section>'+
   group('Informasi '+role,menu('account','user','Informasi '+role)+
     (role==='Pegawai'?menu('schedule','calendar','Jadwal Kerja') : ''))+
   group('Akun dan Koneksi',menu('security','lock','Keamanan Akun')+
     menu('settings','refresh','Koneksi &amp; Sinkronisasi'))+
   group('Aplikasi',menu('install','enter','Pasang Aplikasi')+
     menu('about','info','Tentang')+menu('help','doc','Bantuan &amp; Panduan'))+
   '<div class="profile-signout">'+menu('logout','enter','Log Out')+'</div>';
}
function recoveryQueueCard(){
 if(!navigator.onLine) return card('Pemulihan password',empty('Hubungkan internet untuk melihat permintaan pemulihan.'));
 if(!Array.isArray(recoveryAlerts)) return card('Pemulihan password',empty('Antrean pemulihan belum tersedia.'));
 if(!recoveryAlerts.length) return card('Pemulihan password',empty('Tidak ada permintaan aktif.'));
 return card('Permintaan pemulihan password',recoveryAlerts.map(r=>
   '<div class="line"><span>Username <b>'+esc(r.username)+'</b><br>'+chip(r.status,r.ownApproval?'green':'yellow')+'</span>'+
   (r.status==='MENUNGGU'||r.ownApproval?btn('reviewRecovery:'+esc(r.id),r.ownApproval?'Lihat kode':'Tinjau'):'')+'</div>').join(''));
}
function verification(){return '<h1>'+icon('shield')+' Verifikasi Absensi</h1><p class="subhead">Tinjau transaksi pilot yang menunggu keputusan.</p><div class="card wave between"><b>'+verifier.length+' transaksi dalam antrean</b><button data-act="sync" class="clock-refresh" aria-label="Perbarui antrean" title="Perbarui antrean">'+icon('refresh')+'</button></div>'+(!navigator.onLine?msg('Koneksi diperlukan untuk memuat dan memutuskan transaksi.'):'')+(verifier.map(r=>'<button class="card entry" data-review="'+esc(r.recordId)+'">'+icon('calendar')+'<span><b>'+esc(r.employeeName||'Nama pegawai belum tersedia')+' · '+esc(label(r.type))+'</b><small>'+esc(fmtDay(r.localDate))+(r.mobileTest?' · MODE UJI'+(r.testRunId?' · Sesi '+esc(r.testRunId.slice(0,8)):'')+' · GPS simulasi':'')+'</small></span>'+chip('Tinjau','yellow')+'</button>').join('')||card('Antrean verifikator',empty(loaded?'Tidak ada transaksi yang menunggu keputusan.':'Antrean pusat belum dimuat.')))+
   recoveryQueueCard()+(requestData?.reviewer?card('Permohonan pegawai',requestList(requestData.items,true)):'')}
function statisticsPage(){return '<h1>'+icon('bars')+' Statistik</h1>'+lateCard(lateness,period,true,periodButton)}
function render(){
 if(recoverySession){
   app.className='login';
   app.innerHTML='<section class="loginbox"><h1>Buat Password Baru</h1>'+passwordForm(true)+
     '<div id="form-error" role="status"></div>'+btn('cancelRecovery','Kembali ke login','link')+'</section>';
   return;
 }
 if(!session){login();return}
 app.className='';
 if(session.mustChangePassword){app.innerHTML='<div class="shell"><div class="card"><h1>Ganti password awal</h1><p>Tetapkan password pribadi untuk melanjutkan.</p>'+passwordForm()+'<div id="form-error"></div>'+btn('logout','Log Out','link')+'</div></div>';return}
 const isV=session.role==='VERIFIER', pages=isV?['verify','audit','stats','user']:['home','calendar','doc','user'];
 if(!pages.includes(tab)&&(isV||tab!=='history'))tab=pages[0];
 app.innerHTML='<div class="shell"><header class="top"><img src="./assets/brand.png" alt=""><div><strong>Absensi Kehadiran Outsourcing</strong><small>Kabupaten Kotawaringin Timur</small></div><button aria-label="Status sinkronisasi" data-act="updates">'+icon('bell')+'</button></header><div id="page">'+refreshNotice()+({home:dashboard,history,calendar,doc:leave,user:profile,verify:verification,audit:auditPage,stats:statisticsPage}[tab])()+'</div></div><nav class="nav" aria-label="Navigasi utama">'+pages.map(n=>'<button data-act="'+n+'" '+((tab===n||(tab==='history'&&n==='home'))?'class="active" aria-current="page"':'')+'>'+icon(n==='verify'?'shield':n==='audit'?'history':n==='stats'?'bars':n)+titles[n]+'</button>').join('')+'</nav>';tick();updateRefreshIndicator();
}
async function synchronize(manual=false){
 if(!session||session.mustChangePassword||synchronizing||!navigator.onLine)return;
 const s=session, owner=own(), requestedMonth=period,withAudit=s.role==='VERIFIER'&&tab==='audit';synchronizing=true;
 updateRefreshIndicator(manual);
 try{
  if(s.role==='EMPLOYEE'){
   await sendQueuedRequests(s,owner);
   for(const q of await owned('queue',owner)){
    if(session!==s||!navigator.onLine)return;
    if(capturing)break;
    if(q.confirmed||q.retired)continue;
    // Sampai v1.7.1 queue dapat berisi payload lama. Hanya tanyakan tanda terimanya.
    let response;
    try{response=await api('RECEIPT',{payload:{submissionId:q.id}});}
    catch(e){if(e.code==='TRANSPORT'||session!==s)throw e;continue;}
    if(session!==s)return;
    if(capturing)break;
    if(response.recordId){
      await put('queue',receiptRow(q,response));
    }else if(response.code==='RECEIPT_NOT_FOUND' && (!q.v180 || Date.now()-q.at>600000)){
      await put('queue',{id:q.id,owner,at:q.at,action:q.action,shiftDate:q.shiftDate||q.payload?.shiftDate,
        testRunId:q.testRunId,retired:true,retiredAt:Date.now(),issue:'Bukti lama berakhir. Rekam ulang jika transaksi masih diperlukan.'});
    }

   }
   if(session!==s)return;
  }
  if (!navigator.onLine || session !== s) return;
  const result = await api('REFRESH', {clientApiVersion:'2.5.1',month:requestedMonth,verifierHistory:withAudit});
  if (session !== s) return;
  if (result.code !== 'REFRESH_READY' || !result.context) throw Error('Format pembaruan tidak valid.');
  applyContext(result.context);
  if(result.apiVersion!=='2.5.1'||!result.requests)throw Error('Perbarui backend ke v2.5.1.');
  requestData=result.requests;lateness=result.lateness;
  if(requestedMonth===period&&navigator.onLine){
    clearPreview();preview=result.mobileTestPreview||[];previewMonth=requestedMonth;
    if(dialog.open&&dayReturn&&$('#panel .day-block'))showDay(dayReturn);
  }
  if (s.role === 'VERIFIER') {
    recoveryAlerts=result.passwordRecovery??null;
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
    months[requestedMonth] = {scope200:true,scope250:true,lateness:result.lateness,items:daily.items,calendar:daily.calendar,transactions:status.items,at:Date.now()};
    await put('status',{owner,requests:result.requests,scope200:true,todayRows:status.todayRows||[],items:status.items,at:Date.now(),dailyMonths:months});
  }
  if (session !== s) return;
  refreshError = '';
  if(manual&&session===s)toast(s.role==='EMPLOYEE'&&queue.length?'Antrean belum tuntas. Buka detail untuk melihat alasannya.':'Data pusat diperbarui.');
 } catch(e) {
   if (session === s){clearPreview();if(s.role==='VERIFIER'){recoveryAlerts=null;requestData=null;lateness=null;}refreshError = describe(e);}
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
async function sendQueuedRequests(s,owner){
 for(const d of await owned('drafts',owner)){
   if(d.status!=='QUEUED'||s!==session||!navigator.onLine)continue;
   try{
     const result=await api('REQUEST_SUBMIT',{payload:{id:d.id,kind:d.kind,day:d.day,end:d.end,reason:d.reason,adjustment:!!d.adjustment,testDraft:d.testDraft===true}});
     if(result.code!=='REQUEST_SAVED'||result.item?.id!==d.id)throw Error('Tanda terima pengajuan belum valid.');
     await put('drafts',{...d,...result.item,owner,issue:''});
   }catch(e){
     const definite=['REQUEST_OVERLAP','REQUEST_CONFLICT','INVALID_REQUEST'].includes(e.code);
     await put('drafts',{...d,status:definite?'DRAFT':'QUEUED',issue:describe(e)});
     if(e.code==='TRANSPORT'||s!==session)throw e;
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
   testRunId:q.testRunId,v180:true,confirmed:!repair,receipt:r.recordId,issue:repair?'Diterima server · menunggu pembaruan status':''};
}
async function capture(action){
 if(capturing||!valid())return;
 const s=session,owner=own();capturing=true;
 try{
  let again;
  do{
   let pendingRow,previousWriteUncertain=false;
   async function rememberReceipt(r){
     // The pending UUID is already durable. A later sync can repair the cache.
     try{await put('queue',receiptRow(pendingRow,r));}catch{}
     return r;
   }
   again=await recordAttendance({dialog,title:label(action),type:action,call:api,describe,
    alive:()=>session===s&&valid(),onDisabled:()=>{if(session===s){s.writeOpen=false;saveSession();}},
    onAccepted:r=>toast(r.mobileTest?'MODE UJI: transaksi simulasi diterima. Tidak masuk rekap kehadiran.':
      r.needsStatusRepair?'Diterima server. Status sedang diselaraskan.':'Presensi diterima server. Menunggu verifikasi.'),
    send:async (data,maySend)=>{
      if(!pendingRow){
        pendingRow={id:data.id,owner,at:data.at,shiftDate:data.shiftDate,testRunId:data.testRunId,action,v180:true,issue:'Menunggu konfirmasi penerimaan'};
        await put('queue',pendingRow);
      }
      let r;
      try{
        if(!maySend())throw Object.assign(Error('Perekaman berakhir.'),{code:'EVIDENCE_EXPIRED'});
        r=await api(action,{payload:{submissionId:pendingRow.id,shiftDate:data.shiftDate,scheduleId:data.scheduleId,photo:data.photo}});
        if(!r.recordId||!['RECORDED_PENDING','ALREADY_ACCEPTED','RECORDED_STATUS_SYNC_PENDING','ALREADY_ACCEPTED_STATUS_PENDING'].includes(r.code))
          throw Object.assign(Error('Tanda terima server belum pasti.'),{code:'SERVICE_INVALID_RESPONSE'});
      }catch(e){
        if(['TRANSPORT','SERVICE_ERROR','LOCK_BUSY_RETRY','RAW_COMMIT_UNCERTAIN_RETRY_SAME_UUID','GET_NOT_AVAILABLE','STATUS_SYNC_CONFLICT','SERVICE_INVALID_RESPONSE'].includes(e.code)){
          previousWriteUncertain=true;
          throw Object.assign(Error('Periksa tanda terima transaksi.'),{code:'RECEIPT_REQUIRED'});
        }
        if(!previousWriteUncertain)await put('queue',{...pendingRow,retired:true,retiredAt:Date.now(),issue:describe(e)});
        throw e;
      }
      return rememberReceipt(r);
    },
    checkReceipt:async id=>{
      const r=await api('RECEIPT',{payload:{submissionId:id}});
      if(r.code==='RECEIPT_NOT_FOUND')return null;
      if(!r.recordId||!['ALREADY_ACCEPTED','ALREADY_ACCEPTED_STATUS_PENDING'].includes(r.code))
        throw Error('Respons tanda terima belum lengkap.');
      return rememberReceipt(r);
    }});
  }while(again&&s===session&&valid()&&s.writeOpen!==false);
 }finally{capturing=false;if(s===session){await local();render();scheduleSync(true,true);}}
}
function auditPage(){
 const reports=requestData?.reviewer?requestData.items.filter(r=>r.kind==='INCIDENT'&&(!auditEmployee||r.employeeId===auditEmployee)):[];
 const incidentReport=requestData?.reviewer?card('Laporan insiden',line('Jumlah laporan resmi',reports.filter(r=>r.scope!=='MOBILE_TEST').length)+requestList(reports,true)):'';
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
     '<span><b>'+esc(r.employeeName||r.employeeId)+'</b><small>'+esc(label(r.type)+' · Keputusan '+r.decisions[0].at+' WIB')+
     (r.mobileTest?' · MODE UJI'+(r.testRunId?' · Sesi '+esc(r.testRunId.slice(0,8)):''):'')+'</small></span>'+chip(label(r.verificationStatus),r.verificationStatus==='VERIFIED'?'green':'yellow')+'</button>').join('')||
     empty(!audit?(navigator.onLine?'Menunggu data riwayat verifikasi.':'Hubungkan internet untuk memuat riwayat verifikasi.'):'Belum ada keputusan dalam tujuh hari ini.'))+incidentReport;
}
function reviewIntro(r){
 const captureTime=r.localTime?esc(r.localTime)+' WIB':'Belum tersedia';
 const otherDay=r.localDate&&r.shiftDate&&dateISO(r.localDate)!==dateISO(r.shiftDate);
 return '<p><b>'+esc(r.employeeName||r.employeeId)+' · '+esc(label(r.type))+'</b></p>'+
   line('Tanggal shift',esc(fmtDay(r.shiftDate)||'Belum tersedia'))+
   line('Waktu presensi',captureTime+(otherDay?' · '+esc(fmtDay(r.localDate)):''))+
   (r.receivedTime?line('Waktu diterima server',esc(r.receivedTime)+' WIB'):'')+
   (r.mobileTest?'<span class="test-mark">MODE UJI'+(r.testRunId?' · Sesi '+esc(r.testRunId.slice(0,8)):'')+'</span>':'')+
   (r.hasPhoto?'<div id="review-proof" role="status"></div>':'<small>Transaksi ini memakai alur presensi lama tanpa foto.</small>');
}
function openReview(title,r,body){
 reviewOpen=true;
 refreshScheduler.pause();
 modal(title,reviewIntro(r)+body);dialog.classList.add('review-modal');dialog.dataset.record=r.recordId;
 if(r.hasPhoto)loadProof(r.recordId);
}
async function loadProof(id){
 const target=$('#review-proof'),current=session;
 if(!target||target.getAttribute('aria-busy')==='true')return;
 const visible=()=>dialog.open&&target.isConnected&&session===current&&dialog.dataset.record===id;
 target.setAttribute('aria-live','polite');target.setAttribute('aria-busy','true');
 target.innerHTML='<div class="photo-loader"><i aria-hidden="true"></i>Memuat foto bukti…</div>';
 let timeout;
 try{
   const fetchPhoto=async()=>{
     const r=await api('REVIEW_PHOTO',{payload:{recordId:id}});
     if(!visible())return null;
     if(r.code!=='PHOTO_READY'||r.recordId!==id||!r.jpeg)throw Error('Foto transaksi belum tersedia.');
     const img=new Image();img.className='review-image';img.alt='Foto bukti presensi';
     img.src='data:image/jpeg;base64,'+r.jpeg;await img.decode();return {r,img};
   };
   const proof=await Promise.race([fetchPhoto(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Foto belum selesai dimuat. Periksa koneksi lalu coba lagi.')),35000);})]);
   if(visible()&&proof){const {r,img}=proof;target.replaceChildren(img,document.createTextNode((r.mobileTest?'GPS simulasi ':'GPS ')+r.location+' · ±'+r.accuracy+' m'));}
 }catch(error){
   if(visible())target.innerHTML=msg(describe(error))+btn('proof:'+esc(id),'Muat ulang foto','secondary','refresh');
 }finally{clearTimeout(timeout);target.removeAttribute('aria-busy');}
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
   esc(d.actor+' · Waktu keputusan '+d.at+' WIB')+'</small>'+(d.notes?'<p>'+esc(d.notes)+'</p>':'')+'</section>').join('');
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
function showDraft(kind='LEAVE',d={}){modal(requestNames[kind],requestForm(kind,d,dateKey(now()),d.testDraft||session.incidentTest!==false));}
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
async function decideRequest(id,route,data){
 const current=session,r=requestItems().find(x=>x.id===id);
 if(!r||!navigator.onLine)throw Error('Hubungkan internet untuk menyimpan keputusan.');
 const result=await api(route,{payload:{id,kind:r.kind,...data}});
 if(current!==session)return;
 if(result.code!=='REQUEST_SAVED'||result.item?.id!==id)throw Error('Tanda terima tidak sesuai.');
 if(requestData)requestData.items=requestData.items.map(x=>x.id===id?result.item:x);
 if(current.role==='EMPLOYEE')await put('drafts',{...result.item,owner:own()});
 dialog.close();render();toast(result.rollup==='RETRY_REQUIRED'?'Keputusan tercatat. Rekap menunggu rekonsiliasi pengelola.':'Status permohonan diperbarui.');await scheduleSync(true,true);
}
async function act(a){
 const [key,arg]=a.split(':');
 if(['home','history','calendar','doc','user','verify','audit','stats'].includes(key)){const entering=tab!==key;category='';filter='Semua';dayReturn='';tab=key;render();window.scrollTo(0,0);if(entering&&['history','calendar','verify','audit','stats'].includes(key))scheduleSync(true);return}
 switch(key){
 case 'eye':{const p=$('[name=password]');p.type=p.type==='password'?'text':'password';$('[data-act=eye]').setAttribute('aria-label',p.type==='text'?'Sembunyikan password':'Tampilkan password');break}
 case 'forgot':{
   const username=$('#login [name=username]')?.value||'';
   modal('Lupa Password?', '<form id="request-recovery"><label class="formlabel">Username pegawai'+
     '<input class="control" name="username" required maxlength="40" autocomplete="username" value="'+esc(username)+'"></label>'+
     '<button class="primary full">Kirim permintaan</button></form><p>Verifikator akan memeriksa identitas Anda dan menyampaikan kode secara pribadi. Anda juga bisa meminta kode langsung kepada Operator.</p>'+
     '<p>Sudah punya kode? Tutup halaman ini dan masukkan kode di kolom Password saat login.</p>');
   break;
 }
 case 'cancelRecovery':recoverySession=null;render();break;
 case 'reviewRecovery':{
   const r=recoveryAlerts?.find(item=>item.id===arg);
   if(!r||!navigator.onLine)throw Error('Perbarui antrean saat online.');
   modal('Pemulihan password',line('Username pegawai',esc(r.username))+
     '<form id="review-recovery" data-id="'+esc(r.id)+'" data-username="'+esc(r.username)+'">'+
     (r.ownApproval?'<p>Permintaan ini sudah Anda setujui.</p><button class="primary" value="REVEAL">Lihat kode aktif</button>':
       '<p>Periksa identitas pemohon sebelum menyetujui penyerahan kode.</p>'+
       '<button class="primary" value="APPROVE">Identitas sesuai · Setujui</button> <button class="secondary" value="REJECT">Tolak</button>')+'</form>');
   break;
 }
 case 'sync':await refreshScheduler.refresh(true);break;
 case 'category':category=arg;tab='history';dayReturn='';filter='Semua';render();window.scrollTo(0,0);scheduleSync(true);break;
 case 'monthMove':{
   const d=new Date(period+'-15T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(arg));
   clearPreview();period=d.toISOString().slice(0,7);await local();render();scheduleSync(true);break;
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
 case 'incident':showDraft('INCIDENT');break;
 case 'request':{const r=requestItems().find(x=>x.id===decodeURIComponent(arg));if(r)modal(requestNames[r.kind],requestDetail(r,requestData?.reviewer===true));break;}
 case 'editRequest':{const r=drafts.map(normalizeDraft).find(x=>x.id===decodeURIComponent(arg)&&x.status==='DRAFT');if(r)showDraft(r.kind,r);break;}
 case 'deleteDraft':{const id=decodeURIComponent(arg);if(!drafts.some(x=>x.id===id&&(!x.status||x.status==='DRAFT')))break;
   await remove('drafts',id);await local();dialog.close();render();break;}
 case 'cancelRequest':{const r=requestItems().find(x=>x.id===decodeURIComponent(arg));if(r)modal('Batalkan permohonan?',line('Tanggal',esc(r.day))+btn('confirmCancel:'+arg,'Ya, batalkan','danger'));break;}
 case 'confirmCancel':await decideRequest(decodeURIComponent(arg),'REQUEST_CANCEL',{});break;
 case 'resendRequest':dialog.close();await scheduleSync(true,true);break;
 case 'updates':modal('Status sinkronisasi','<p>'+esc(session.role==='VERIFIER'?'Antrean verifikasi diperbarui saat aplikasi aktif.':queue.length+' transaksi lokal menunggu sinkronisasi.')+'</p>'+btn('sync','Perbarui dari server','primary','refresh'));break;
 case 'account':modal('Informasi akun',line('Identitas',esc(session.employeeId))+line('Username',esc(session.username))+line('Nama',esc(session.name||'—'))+line('Profesi',esc(session.profession||'—'))+line('Unit',esc(session.unit||'—')));break;
 case 'schedule':modal('Jadwal kerja',btn('openCalendar','Buka Kalender Shift','primary')+'<p>Referensi terakhir yang dikembalikan validator jadwal.</p>'+actNames.map(x=>{const r=session.shifts?.[x];return line(label(x),r?.scheduleId?esc([r.shiftDate,requestData?.items.some(i=>i.kind==='INCIDENT'&&i.status==='APPROVED'&&i.scope!=='MOBILE_TEST'&&i.day===r.shiftDate)?'I · Insiden disetujui':r.shiftCode,r.scheduleId].filter(Boolean).join(' · ')):'Belum tersedia')}).join(''));break;
 case 'openCalendar':dialog.close();await act('calendar');break;
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
 case 'security':
   modal('Keamanan Akun','<div class="security-symbol">'+icon('shield')+'</div>'+
     menu('password','lock','Ubah Password','Ganti password akun Anda')+
     menu('recovery','shield','Lupa Password','Pengajuan dan kode pemulihan')+btn('backProfile','Kembali ke Profil','secondary'));break;
 case 'recovery':
   modal('Lupa Password','<p>Di halaman login, pilih Lupa Password? atau hubungi Operator. Setelah identitas Anda diperiksa, masukkan kode yang diterima di kolom Password untuk membuat password baru.</p>'+btn('security','Kembali ke Keamanan Akun','secondary'));break;
 case 'backProfile':dialog.close();break;
 case 'settings':{
   const current=session;
   const buttons=btn('sync','Perbarui dari server','primary')+btn('probe','Uji koneksi API','secondary');
   modal('Koneksi & Sinkronisasi','<p>'+esc(navigator.onLine?'Internet terhubung':'Offline')+' · '+esc(current.role==='EMPLOYEE'?queue.length+' presensi dan '+drafts.filter(d=>d.status==='QUEUED').length+' permohonan dalam antrean':'Antrean Verifikator')+'</p><div class="inline" id="settings-actions">'+buttons+'</div>');
   const controls=$('#settings-actions');
   if(!navigator.onLine||current.role!=='EMPLOYEE')break;
   const state=await api('TEST_SETTINGS');
   if(current===session&&dialog.open&&controls.isConnected&&state.code==='TEST_READY')
     controls.insertAdjacentHTML('beforeend',btn('resetTest:'+state.testRunId,'Reset Mobile Test','secondary')+btn('performance','Durasi permintaan','secondary'));
   break;
 }
 case 'resetTest':
   modal('Mulai sesi uji baru?','<p>Sesi '+esc(arg.slice(0,8))+' akan ditutup. Foto yang belum terkirim perlu direkam ulang. Catatan yang sudah diterima server tetap tersimpan.</p>'+btn('confirmReset:'+arg,'Ya, mulai sesi baru','primary')+btn('settings','Batal','secondary'));break;
 case 'confirmReset':{
   const current=session,owner=own();
   const next=await api('RESET_MOBILE_TEST',{payload:{testRunId:arg}});
   if(session!==current)break;
   let pending=0;
   for(const q of await owned('queue',owner)){
     if(q.testRunId!==arg||q.confirmed||q.retired)continue;
     if(session!==current)return;
     try{
       const receipt=await api('RECEIPT',{payload:{submissionId:q.id}});
       if(receipt.recordId)await put('queue',receiptRow(q,receipt));
       else if(receipt.code==='RECEIPT_NOT_FOUND')await remove('queue',q.id);
       else pending++;
     }catch{pending++;}
   }
   if(session!==current)break;
   await local();render();
   modal('Sesi uji baru siap','<p>Sesi '+esc(next.testRunId.slice(0,8))+' sudah aktif. Kamu bisa Check-in lagi hari ini.</p>'+(pending?'<p>Ada tanda terima yang masih menunggu pemeriksaan saat sinkronisasi.</p>':''));
   scheduleSync(true,true);break;
 }
 case 'probe':await probe();modal('Uji koneksi API','<p>✓ GET health terbaca.</p><p>✓ POST tanpa token menghasilkan SESSION_REQUIRED.</p><p>Transport siap diuji dengan akun pilot.</p>');break;
 case 'install':if(installEvent){await installEvent.prompt();installEvent=null}else toast('Buka menu browser → Instal aplikasi / Tambahkan ke layar utama.');break;
 case 'password':modal('Ubah Password',passwordForm()+btn('security','Kembali ke Keamanan Akun','secondary'));break;
 case 'about':modal('Tentang aplikasi','<p>Absensi Kehadiran Outsourcing<br>Kabupaten Kotawaringin Timur</p><p>Pilot PWA 2.5.1</p>');break;
 case 'help':modal('Bantuan & panduan','<p>Masuk saat online untuk memuat jadwal. Izinkan kamera dan GPS, kunci lokasi, lalu selesaikan tiga tantangan. Tinjau foto dan kirim dalam lima menit.</p><p>Buka tab Shift untuk detail harian atau tekan warna di Ringkasan Status untuk melihat riwayat.</p>');break;
 case 'logout':modal('Log Out dari aplikasi?','<p>Foto presensi yang belum dikirim akan dihapus saat perekaman ditutup.</p>'+btn('confirmLogout','Log Out','danger'));break;
 case 'confirmLogout':{let revoked=false;try{if(navigator.onLine){await api('LOGOUT');revoked=true}}finally{clearSession();toast(revoked?'Anda berhasil Log Out.':'Sesi lokal ditutup. Sesi server berakhir sesuai masa berlakunya.')}break}
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
 e.preventDefault();const f=e.target, input=Object.fromEntries(new FormData(f)), b=e.submitter||f.querySelector('button:not([type=button])');
 if(!b||b.disabled)return;b.disabled=true;const initial=b.textContent;b.textContent=f.id==='login'?'Memeriksa akun…':'Memproses…';
 try{
  switch(f.id){
  case 'login':{
    if(!navigator.onLine)throw Error('Login memerlukan internet.');
    const r=await post('LOGIN',{username:input.username.trim(),password:input.password});
    if(r.code==='RECOVERY_PASSWORD_REQUIRED'){
      if(!r.recoveryToken)throw Error('Respons pemulihan tidak lengkap.');
      f.elements.password.value='';
      recoverySession={token:r.recoveryToken,passwordPolicy:r.passwordPolicy};
      if(dialog.open)dialog.close();
      render();break;
    }
    if(!r.token||!['EMPLOYEE','VERIFIER'].includes(r.role)||!r.employeeId)throw Error('Identitas respons login tidak lengkap.');
    const expires=Date.parse(r.expiresAtWIB.replace(' ','T')+'+07:00');
    if(!Number.isFinite(expires)||expires<=Date.now())throw Error('Waktu sesi tidak valid. Periksa jam perangkat.');
    prefs.removeItem(ns+'username');if(input.remember)prefs.setItem(ns+'username',input.username.trim());
    f.elements.password.value='';session={token:r.token,expires,employeeId:r.employeeId,role:r.role,username:input.username.trim(),profession:r.profession,mustChangePassword:!!r.mustChangePassword};epoch++;saveSession();
    try{await start(r)}catch(err){clearSession();throw err}break}
  case 'request-recovery':{
    if(!navigator.onLine)throw Error('Sambungkan internet untuk mengirim permintaan, atau hubungi Operator.');
    await post('RECOVERY_REQUEST',{username:input.username.trim()});
    if(dialog.open && f.isConnected)modal('Permintaan diterima','<p>Jika akun memenuhi syarat, permintaan tersedia bagi Verifikator. Hubungi Verifikator untuk pemeriksaan identitas.</p>');
    break;
  }
  case 'finish-recovery':{
    const current=recoverySession;
    if(!current)break;
    if(input.newPassword!==input.confirm)throw Error('Konfirmasi password belum sesuai.');
    if(!navigator.onLine)throw Error('Sambungkan internet sebelum menyimpan password baru.');
    try{
      await post('RECOVERY_FINISH',{recoveryToken:current.token,newPassword:input.newPassword});
    }catch(err){
      if(current!==recoverySession)break;
      if(err.code==='RECOVERY_EXPIRED'){recoverySession=null;render();}
      if(err.code==='TRANSPORT'||err.code==='SERVICE_ERROR'||err.code==='RECOVERY_EXPIRED')
        throw Error('Hasil penyimpanan belum dapat dipastikan. Kembali ke login dan coba password baru. Jika belum diterima, gunakan kode aktif kembali.');
      throw err;
    }
    if(current===recoverySession){recoverySession=null;render();toast('Password tersimpan. Masuk kembali dengan password baru.');}
    break;
  }
  case 'review-recovery':{
    if(f.dataset.busy)break;
    const actor=session, decision=e.submitter?.value;
    if(!decision || !navigator.onLine)throw Error('Pilih keputusan saat online.');
    f.dataset.busy='1';
    try{
      const r=await api('RECOVERY_REVIEW',{username:f.dataset.username,id:f.dataset.id,decision});
      if(actor!==session)break;
      if(dialog.open && f.isConnected && !document.hidden){
        if(r.code==='RECOVERY_APPROVED'){
          modal('Kode pemulihan aktif',line('Username',esc(r.username))+line('Recovery Code',esc(r.recoveryCode))+
            '<p>Sampaikan kode ini secara pribadi kepada pegawai yang identitasnya sudah Anda periksa.</p>');
          $('#panel').dataset.privateRecovery='1';
        }else{dialog.close();toast('Permintaan pemulihan ditolak.');}
      }
    }finally{
      delete f.dataset.busy;
      if(actor===session)scheduleSync(true,true);
    }
    break;
  }
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
  case 'month':clearPreview();period=input.month;dialog.close();await local();render();scheduleSync(true);break;
  case 'request-decision':await decideRequest(decodeURIComponent(f.dataset.id),'REQUEST_DECIDE',{...input,baseRevision:Number(f.dataset.revision)});break;
  case 'request-form':{
    const s=session,owner=own(),kind=f.dataset.kind,reason=input.reason.trim(),end=kind==='LEAVE'?input.end:input.day;
    if(!reason||end<input.day)throw Error('Periksa uraian dan urutan tanggal.');
    const send=e.submitter?.value==='send',id=f.dataset.id||crypto.randomUUID();
    f.dataset.id=id;
    await put('drafts',{id,owner,kind,day:input.day,end,reason,adjustment:drafts.find(d=>d.id===id)?.adjustment===true,testDraft:kind==='INCIDENT'&&f.dataset.test==='yes',at:Date.now(),status:send?'QUEUED':'DRAFT'});
    if(session!==s)break;
    await local();dialog.close();tab='doc';render();
    toast(send?'Pengajuan masuk antrean pengiriman.':'Draf tersimpan di perangkat.');
    if(send&&navigator.onLine)await scheduleSync(true,true);break;
  }
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
  foregroundOffline = true;clearPreview();renderRefreshedData();
  refreshScheduler.pause();
  updateRefreshIndicator();
});
window.addEventListener('beforeinstallprompt', e => {e.preventDefault();installEvent=e});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {if(dialog.open && $('#panel').dataset.privateRecovery)dialog.close();refreshScheduler.pause();}
  else if (session) scheduleSync();
});
dialog.addEventListener('cancel',e=>{if(deciding)e.preventDefault();});
dialog.addEventListener('close', () => {
  if(!dialog.open && $('#panel').dataset.privateRecovery){$('#panel').replaceChildren();delete $('#panel').dataset.privateRecovery;}
  if(!dialog.open){dialog.classList.remove('review-modal');delete dialog.dataset.record;}
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
