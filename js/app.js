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
let foregroundOffline = !navigator.onLine;
const refreshScheduler = createRefreshScheduler(
  manual => synchronize(manual),
  () => !!session && !session.mustChangePassword && navigator.onLine && !document.hidden
);
const pending='Menunggu verifikasi', titles={home:'Beranda',history:'Riwayat',doc:'Izin',user:'Profil',verify:'Verifikasi'};
const labels={PENDING:pending,VERIFIED:'Disetujui',REJECTED:'Ditolak',NEEDS_CORRECTION:'Perlu koreksi',CONFIRMED:'Terkirim',CHECK_IN:'Check-in',CHECK_OUT:'Check-out',CHECKIN:'Check-in',CHECKOUT:'Check-out'};
const errors={INVALID_CREDENTIALS:'Username atau password tidak cocok.',API_DISABLED:'Pengelola perlu mengaktifkan API PoC.',SIMULATION_PANEL_ONLY:'Mode simulasi sidebar masih aktif.',TIME_WINDOW_CLOSED:'Jendela waktu absensi sudah tutup.',CHECKIN_REQUIRED_FOR_CHECKOUT:'Server belum menerima Check-in untuk shift ini.',SESSION_EXPIRED:'Sesi berakhir. Masuk kembali dengan akun yang sama.',REASON_REQUIRED:'Isi alasan minimal lima karakter.',PASSWORD_LENGTH:'Panjang password belum sesuai kebijakan yang ditampilkan.',PASSWORD_COMPLEXITY:'Gunakan minimal satu huruf, satu angka, dan satu simbol.',PASSWORD_CHANGE_REQUIRED:'Ganti password awal terlebih dahulu.',SCHEDULE_NOT_PUBLISHED:'Jadwal belum disetujui untuk absensi.',DEPENDENCY_UNAVAILABLE:'Modul aturan jadwal tidak tersedia di proyek Apps Script.'};
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
function clearSession(){epoch++;refreshScheduler.reset();photoGeneration++;setPhotoURL('');refreshError='';refreshDeferred=false;session=null;temporary.removeItem(ns+'session');rows=[];dailyRows=[];dailyMonth='';dailyLoaded=false;queue=[];drafts=[];verifier=[];loaded=false;lastSync=0;gpsAt=0;period='';filter='Semua';tab='home';if(dialog.open)dialog.close();render()}
function valid(){return session&&Date.now()<session.expires}
async function api(action,body={}){
  const current=session;
  try{return await post(action,{token:current.token,...body})}
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
  if (result.shifts) current.shifts = result.shifts;
  saveSession();
}
async function context() {
  const current = session;
  const result = await api('ME');
  if (current === session) applyContext(result);
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
function refreshControls() {
  return '<section class="card refresh-controls">'+btn('sync','Perbarui Data','secondary','refresh')+
    '<small data-refresh-status>'+refreshText()+'</small></section>';
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
    button.setAttribute('aria-busy', String(manual && synchronizing));
  });
}
function renderRefreshedData() {
  if (!session || session.mustChangePassword) return;
  const active = document.activeElement;
  if (dialog.open || capturing || active?.matches('input,textarea,select') || active?.closest('form')) {
    refreshDeferred = true;
    return;
  }
  const page = $('#page');
  if (!page) return;
  const action = active?.dataset?.act;
  const scroll = window.scrollY;
  page.innerHTML = ({home:dashboard,history,doc:leave,user:profile,verify:verification}[tab])();
  if (action) Array.from(page.querySelectorAll('[data-act]'))
    .find(node => node.dataset.act === action)?.focus({preventScroll:true});
  window.scrollTo(0, scroll);
  refreshDeferred = false;
  tick();
  updateRefreshIndicator();
}
async function local(){
  const stamp=epoch, owner=own();
  const [cached,q,d]=await Promise.all([get('status',owner),owned('queue',owner),owned('drafts',owner)]);
  if(stamp!==epoch)return;
  const receipts=new Map(q.filter(x=>x.confirmed).map(x=>[x.receipt,x]));
  verifier=cached?.verifier||[];loaded=!!cached?.verifier;
  rows=(cached?.items||[]).map(r=>({...r,capturedAt:receipts.get(r.recordId)?.at}));
  const monthCache=cached?.dailyMonths?.[period];dailyRows=monthCache?.items||[];dailyLoaded=!!monthCache;dailyMonth=period;
  lastSync=cached?.at||0;queue=q.filter(x=>!x.confirmed);drafts=d;
}
function tick(){
  if(session&&!valid()){clearSession();toast('Sesi berakhir. Antrean tersimpan untuk login berikutnya.');return}
  const clock=$('#clock');if(clock)clock.textContent=wib(now(),{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).replaceAll('.',':');
}
function login(){
  app.className='login';
  app.innerHTML='<div class="identity"><img src="./assets/brand.png" alt="Logo MHS"><h1>Absensi Kehadiran Outsourcing</h1><p>Kecamatan Mentaya Hilir Selatan</p></div><form class="loginbox" id="login"><h2>Selamat Datang!</h2><p>Silakan masuk untuk melakukan absensi kehadiran outsourcing.</p><div class="fields"><label class="field">'+icon('user')+'<input name="username" aria-label="Username" placeholder="Username" autocomplete="username" required maxlength="40" value="'+esc(prefs.getItem(ns+'username')||'')+'"></label><label class="field">'+icon('lock')+'<input type="password" name="password" aria-label="Password" placeholder="Password" autocomplete="current-password" required maxlength="256"><button data-act="eye" type="button" aria-label="Tampilkan password">'+icon('eye')+'</button></label></div><div class="loginopts"><label><input type="checkbox" name="remember" '+(prefs.getItem(ns+'username')?'checked':'')+'> Ingat Saya</label>'+btn('forgot','Lupa Password?','link')+'</div><div id="form-error"></div><button class="primary full">'+icon('enter')+' Masuk</button></form><button type="button" data-act="diagnostic" class="diag">Uji koneksi API</button>';
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
const byPeriod=()=>rows.filter(r=>dateISO(r.localDate).startsWith(period));
const localTime=t=>wib(t,{hour:'2-digit',minute:'2-digit'}).replace('.',':');
function entries(list){return list.map(r=>{
 const code=r.verificationStatus, mood=code==='VERIFIED'?'green':code==='REJECTED'?'red':'yellow';
 return '<button class="card entry" data-record="'+esc(r.recordId)+'"><span class="datebox"><small>'+esc(fmtDay(r.localDate,{weekday:'short'}))+'</small><b>'+esc(dateISO(r.localDate).slice(-2)||'—')+'</b><small>'+esc(fmtDay(r.localDate,{month:'short'}))+'</small></span><span><b>'+esc(label(r.type))+'</b><small>'+esc(label(r.deliveryStatus))+'</small></span>'+chip(label(code),mood)+'</button>';
}).join('')}
function backlog(){return queue.length?card(icon('refresh')+' Antrean perangkat',queue.map(q=>'<div class="line"><span><b>'+esc(label(q.action))+'</b> · '+localTime(q.at)+'<br><small>'+esc(q.issue||'Menunggu pengiriman')+'</small></span>'+btn('detail:'+q.id,'Detail','link')+'</div>').join('')+btn('sync','Sinkronkan sekarang','link','refresh')):''}
function dashboard(){
 const hr=Number(wib(now(),{hour:'2-digit',hourCycle:'h23'})), today=dateKey(now()), todays=rows.filter(r=>dateISO(r.localDate)===today);
 const status=a=>{const r=todays.find(x=>x.type===a);return r?label(r.verificationStatus):queue.some(q=>q.action===a.replace('_','')&&dateKey(q.at)===today)?'Dalam antrean':lastSync?'Belum tercatat':'Belum disinkronkan'};
 const stats=summary();
 return '<h1>Selamat '+(hr<11?'Pagi':hr<15?'Siang':hr<18?'Sore':'Malam')+' 👋</h1><section class="account">'+avatar()+'<div class="details"><b>'+esc(session.name||session.username)+'</b><small>'+esc(session.employeeId)+'</small><small>'+icon('work')+' '+esc(session.unit||session.profession||'Outsourcing')+'</small></div>'+periodButton()+'</section>'+refreshControls()+'<section class="card wave clock">'+icon('time')+'<div><strong><span id="clock"></span> <small>WIB</small></strong><b>'+esc(wib(now(),{weekday:'long',day:'numeric',month:'long',year:'numeric'}))+'</b>'+chip(session.clockSynced?'Acuan waktu server':'Waktu perangkat',session.clockSynced?'green':'yellow')+'</div></section><div class="badges">'+chip(navigator.onLine?'◈ Internet terhubung':'◈ Offline',navigator.onLine?'':'yellow')+btn('gps',icon('pin')+' '+(Date.now()-gpsAt<60000?'GPS aktif':'Cek GPS'),'chip green')+'</div><div class="two">'+btn('CHECKIN','Check-in','primary','enter')+btn('CHECKOUT','Check-out','success','enter')+'</div>'+card(icon('calendar')+' Status Absensi Hari Ini',actNames.map((_,i)=>{const a=['CHECK_IN','CHECK_OUT'][i];return line('<span class="dot '+(todays.some(r=>r.type===a)?'on':'')+'"></span>'+label(a),esc(status(a)))}).join(''))+backlog()+card(icon('bars')+' Ringkasan Status','<div class="five">'+colourText.map((c,i)=>stat(c,stats[colours[i]],['#0ca779','#f2ad18','#ee5358','#0785e9','#b05e2f'][i],['✓','◷','×','i','!'][i])).join('')+'</div><p class="subhead">'+(dailyLoaded?'Berdasarkan keputusan kedua aktivitas per tanggal shift. Parsial A: '+stats.partialA+' · Parsial B: '+stats.partialB+' · Tidak hadir A: '+stats.absenceA+' · Tidak hadir B: '+stats.absenceB+' · Belum final: '+stats.unverified:'Rekap harian belum dimuat dari server. Tekan Riwayat atau Perbarui.')+'</p>')+'<div class="three">'+btn('history','Riwayat<br>Absensi','tile','history')+btn('doc','Pengajuan<br>Izin','tile','doc')+btn('incident','Laporan<br>Insiden','tile','shield')+'</div>'+card(icon('history')+' Riwayat Terakhir',byPeriod().slice(0,2).map(r=>line(esc(fmtDay(r.localDate))+' · '+esc(label(r.type)),esc(label(r.verificationStatus)))).join('')||empty('Belum ada transaksi pada periode ini.'));
}
function history(){
 const all=byPeriod(), filters=['Semua','Disetujui','Tertunda','Ditolak'], keys=['','VERIFIED','PENDING','REJECTED'];
 const list=all.filter(r=>filter==='Semua'||r.verificationStatus===keys[filters.indexOf(filter)]);
 return '<div class="between"><h1>'+icon('history')+' Riwayat Absensi</h1>'+periodButton()+'</div><section class="card wave four">'+['Transaksi','Disetujui','Tertunda','Ditolak'].map((n,i)=>stat(n,i?all.filter(r=>r.verificationStatus===keys[i]).length:all.length,['#167be0','#18ac6b','#f7b116','#f0525a'][i],['▦','✓','◷','×'][i])).join('')+'</section><div class="filters">'+filters.map(v=>btn('filter:'+v,v,filter===v?'chosen':'')).join('')+'</div>'+backlog()+card('Rekap Kehadiran Harian',dailyLoaded?(dailyRows.length?dailyRows.slice().reverse().map(d=>line(esc(fmtDay(d.workDate)),esc(dayExplanation(d)))).join(''):empty('Belum ada status harian pada periode ini.')):empty('Rekap harian belum dimuat dari server.'))+(entries(list)||card('Riwayat pusat',empty('Belum ada transaksi yang cocok.')))+'<div class="card info">'+icon('info')+' '+(lastSync?'Pembaruan terakhir '+esc(wib(lastSync,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))+' WIB.':'Data pusat belum dimuat.')+' Maksimal 50 transaksi terakhir. '+btn('sync','Perbarui','link')+'</div>';
}
function leave(){
 return '<h1>'+icon('doc')+' Izin</h1><p class="subhead">Ajukan izin dan pantau status permohonan Anda.</p><section class="card wave between quota">'+icon('calendar')+'<span><small>Sisa cuti tahunan</small><b>—</b> hari</span><span><small>Sisa izin khusus</small><b>—</b> hari</span></section><div class="three">'+btn('newdraft','Ajukan Izin<small>Draf lokal</small>','tile','calendar')+btn('draftlist','Riwayat Izin<small>Lihat semua</small>','tile','history')+btn('rules','Ketentuan Izin<small>Informasi</small>','tile','info')+'</div>'+card(icon('doc')+' Riwayat Permohonan',drafts.length?drafts.slice().reverse().map(d=>line(esc(d.kind)+'<br><small>'+esc(fmtDay(d.day))+'</small>',btn('draft:'+d.id,'Draf lokal','chip yellow'))).join(''):empty('Belum ada draf permohonan.'))+'<div class="card info">'+icon('info')+' Draf tersimpan di perangkat. Pengajuan ke pengelola dan saldo cuti belum tersedia melalui API pilot.</div>';
}
function menu(act,ic,title,sub){return btn(act,'<span><b>'+title+'</b><small>'+sub+'</small></span>','card menu',ic)}
function profile(){
 return '<h1>'+icon('user')+' Profil Saya</h1><section class="account profile wave">'+avatar()+'<div class="details"><b>'+esc(session.name||session.username)+'</b><small>'+esc(session.employeeId)+'</small><small>'+icon('work')+' '+esc(session.unit||session.profession||session.role)+'</small>'+chip(session.role==='VERIFIER'?'Verifikator':'Pegawai aktif','green')+'</div></section>'+menu('photo','user','Foto Profil','Ganti atau hapus foto di perangkat ini')+menu('account','user','Informasi '+(session.role==='VERIFIER'?'Verifikator':'Pegawai'),'Data akun dan unit kerja')+(session.role==='EMPLOYEE'?menu('schedule','calendar','Jadwal Kerja','Jadwal terakhir dari server'):'')+menu('settings','settings','Pengaturan Aplikasi','Pemasangan dan keamanan akun')+menu('about','info','Tentang Aplikasi','Absensi Kehadiran Outsourcing · Pilot')+menu('help','info','Bantuan & Panduan','Panduan penggunaan aplikasi')+menu('logout','enter','Keluar','Keluar dari aplikasi')+'<p class="foot">Absensi Kehadiran Outsourcing<br>Kecamatan Mentaya Hilir Selatan</p>';
}
function verification(){return '<h1>'+icon('shield')+' Verifikasi Absensi</h1><p class="subhead">Tinjau transaksi pilot yang menunggu keputusan.</p>'+refreshControls()+'<div class="card wave between"><b>'+verifier.length+' transaksi dalam antrean</b>'+btn('sync','Perbarui','secondary','refresh')+'</div>'+(!navigator.onLine?msg('Koneksi diperlukan untuk memuat dan memutuskan transaksi.'):'')+(verifier.map(r=>'<button class="card entry" data-review="'+esc(r.recordId)+'">'+icon('calendar')+'<span><b>'+esc(r.employeeId)+' · '+esc(label(r.type))+'</b><small>'+esc(fmtDay(r.localDate))+'</small></span>'+chip('Tinjau','yellow')+'</button>').join('')||card('Antrean verifikator',empty(loaded?'Tidak ada transaksi yang menunggu keputusan.':'Antrean pusat belum dimuat.')))}
function render(){
 if(!session){login();return}
 app.className='';
 if(session.mustChangePassword){app.innerHTML='<div class="shell"><div class="card"><h1>Ganti password awal</h1><p>Tetapkan password pribadi untuk melanjutkan.</p>'+passwordForm()+'<div id="form-error"></div>'+btn('logout','Keluar','link')+'</div></div>';return}
 const isV=session.role==='VERIFIER', pages=isV?['verify','user']:['home','history','doc','user'];
 if(!pages.includes(tab))tab=pages[0];
 app.innerHTML='<div class="shell"><header class="top"><img src="./assets/brand.png" alt=""><div><strong>Absensi Kehadiran Outsourcing</strong><small>Kecamatan Mentaya Hilir Selatan</small></div><button aria-label="Status sinkronisasi" data-act="updates">'+icon('bell')+'</button></header><div id="page">'+({home:dashboard,history,doc:leave,user:profile,verify:verification}[tab])()+'</div></div><nav class="nav" aria-label="Navigasi utama">'+pages.map(n=>'<button data-act="'+n+'" '+(tab===n?'class="active" aria-current="page"':'')+'>'+icon(n==='verify'?'shield':n)+titles[n]+'</button>').join('')+'</nav>';tick();updateRefreshIndicator();
}
async function synchronize(manual=false){
 if(!session||session.mustChangePassword||synchronizing||!navigator.onLine)return;
 const s=session, owner=own(), requestedMonth=period;synchronizing=true;
 updateRefreshIndicator(manual);
 try{
  if(s.role==='EMPLOYEE'){
   for(const q of await owned('queue',owner)){
    if(session!==s||!navigator.onLine)return;
    if(q.confirmed||(q.paused&&!manual))continue;
    try{
     const r=await api(q.action,{payload:q.payload});
     if(!r.recordId||!['RECORDED_PENDING','ALREADY_ACCEPTED','ALREADY_ACCEPTED_STATUS_PENDING','RECORDED_STATUS_SYNC_PENDING'].includes(r.code))throw Error('Tanda terima server tidak lengkap.');
     if(r.needsStatusRepair||['ALREADY_ACCEPTED_STATUS_PENDING','RECORDED_STATUS_SYNC_PENDING'].includes(r.code)){
       q.issue='Diterima server · menunggu perbaikan Status_View';q.receipt=r.recordId;await put('queue',q);
     }else {
       // Keep the local capture time and receipt together after an acknowledged write.
       await put('queue',{...q,confirmed:true,receipt:r.recordId,issue:'',paused:false});
     }
    }catch(e){
     q.issue=describe(e)+(e.code?' · '+e.code:'');q.paused=!['TRANSPORT','LOCK_BUSY_RETRY','SERVICE_ERROR','RAW_COMMIT_UNCERTAIN_RETRY_SAME_UUID','STATUS_SYNC_CONFLICT'].includes(e.code);
     if(session!==s)return;
     await put('queue',q);
     if(e.code==='TRANSPORT')throw e;
    }
   }
   if(session!==s)return;
  }
  if (!navigator.onLine || session !== s) return;
  const result = await api('REFRESH', {month:requestedMonth});
  if (session !== s) return;
  if (result.code !== 'REFRESH_READY' || !result.context) throw Error('Format pembaruan tidak valid.');
  applyContext(result.context);
  if (s.role === 'VERIFIER') {
    if (!Array.isArray(result.queue?.items)) throw Error('Format antrean tidak valid.');
    await put('status',{owner,verifier:result.queue.items,at:Date.now()});
  } else {
    const daily = result.daily, status = result.status;
    if (daily?.month !== requestedMonth || !Array.isArray(daily.items) ||
        !Array.isArray(status?.items)) throw Error('Format rekap harian server tidak valid.');
    const previous = await get('status',owner), months = {...(previous?.dailyMonths || {})};
    months[requestedMonth] = {items:daily.items,at:Date.now()};
    await put('status',{owner,items:status.items,at:Date.now(),dailyMonths:months});
  }
  if (session !== s) return;
  await local();
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
function scheduleSync(force = false, queueAfter = force) {
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
async function capture(action){
 if(capturing)return;capturing=true;
 const s=session,owner=own();
 try{
  if(!valid())throw Error('Masuk kembali untuk merekam absensi.');
  if(navigator.onLine){try{await context()}catch(e){if(e.code!=='TRANSPORT')throw e}}
  if(s!==session)return;
  const shift=s.shifts?.[action];
  if(s.contextDay!==dateKey(now())||!shift?.shiftDate||!shift.scheduleId)
    throw Error('Jadwal shift belum tersedia. Hubungkan perangkat ke server dan periksa jadwal pegawai sebelum merekam.');
  const existing=(await owned('queue',owner)).find(q=>q.action===action&&q.payload.shiftDate===shift.shiftDate);
  if(existing)throw Error(existing.confirmed?'Transaksi shift ini sudah diterima server.':'Transaksi shift ini sudah ada di antrean. Gunakan Sinkronkan sekarang.');
  const samples=[], until=Date.now()+30000;
  let pos;
  for(let tryNo=0;tryNo<3 && Date.now()<until;tryNo++){
    pos=await locate(Math.max(1,until-Date.now()));
    samples.push({at:pos.timestamp,accuracy:pos.coords.accuracy});
    if(pos.coords.accuracy<=window.MHS_CONFIG.gpsMaxAccuracy)break;
    toast('Akurasi GPS ±'+Math.round(pos.coords.accuracy)+' m. Mengambil ulang lokasi…');
  }
  if(!pos||pos.coords.accuracy>window.MHS_CONFIG.gpsMaxAccuracy)throw Error('Akurasi GPS belum memadai. Coba lagi di area terbuka.');
  if(s!==session||!valid())throw Error('Sesi berubah. Ulangi perekaman.');
  const id=crypto.randomUUID(), at=Date.now();
  await put('queue',{id,owner,action,at,samples,payload:{submissionId:id,latitude:pos.coords.latitude,longitude:pos.coords.longitude,gpsAccuracy:Math.round(pos.coords.accuracy),shiftDate:shift.shiftDate,scheduleId:shift.scheduleId}});
  await local();if(s!==session)return;
  dialog.close();render();toast(label(action)+' tersimpan di perangkat.');scheduleSync(true);
 }finally{capturing=false}
}
function showReview(id){
 const r=verifier.find(x=>x.recordId===id);if(!r)return;
 modal('Tinjau absensi','<p><b>'+esc(r.employeeId)+' · '+esc(label(r.type))+'</b><br>'+esc(fmtDay(r.localDate))+'</p><small class="mono">'+esc(id)+'</small><p>Periksa bukti di Sheet sebelum menetapkan keputusan.</p><form id="decision" data-id="'+esc(id)+'"><label class="formlabel">Keputusan<select name="verdict"><option value="VERIFIED">Setujui</option><option value="REJECTED">Tolak</option><option value="NEEDS_CORRECTION">Minta koreksi</option></select></label><label class="formlabel" id="colorlabel">Status akhir<select name="color">'+colours.map((c,i)=>'<option value="'+c+'">'+c+' · '+colourText[i]+'</option>').join('')+'</select></label><label class="formlabel">Catatan<textarea rows="3" name="notes" maxlength="500"></textarea></label><button class="primary full">Simpan keputusan</button></form>');
}
function showDraft(){
 modal('Ajukan izin','<p>Draf ini hanya tersimpan di perangkat. Sampaikan permohonan kepada pengelola melalui jalur yang berlaku.</p><form id="draft"><label class="formlabel">Jenis permohonan<select name="kind"><option>Izin sakit</option><option>Cuti tahunan</option><option>Izin mendadak</option></select></label><label class="formlabel">Tanggal<input class="control" type="date" name="day" required></label><label class="formlabel">Alasan<textarea rows="3" name="reason" required maxlength="500"></textarea></label><button class="primary full">Simpan draf</button></form>');
}
function details(r){
 modal('Detail absensi',line('Transaksi',esc(label(r.type)))+line('Tanggal',esc(fmtDay(r.localDate)))+(r.capturedAt?line('Waktu rekam perangkat',esc(localTime(r.capturedAt))+' WIB'):'')+line('Pengiriman',esc(label(r.deliveryStatus)))+line('Verifikasi',esc(label(r.verificationStatus)))+line('Status akhir',esc(r.finalStatus||'—'))+line('Revisi',esc(r.revision||'—'))+(dailyRows.find(d=>d.workDate===dateISO(r.localDate))?line('Status harian',esc(dayExplanation(dailyRows.find(d=>d.workDate===dateISO(r.localDate))))):'')+'<small class="mono">'+esc(r.recordId)+'</small>');
}
async function act(a){
 const [key,arg]=a.split(':');
 if(['home','history','doc','user','verify'].includes(key)){tab=key;render();window.scrollTo(0,0);if(['history','verify'].includes(key))scheduleSync();return}
 switch(key){
 case 'eye':{const p=$('[name=password]');p.type=p.type==='password'?'text':'password';$('[data-act=eye]').setAttribute('aria-label',p.type==='text'?'Sembunyikan password':'Tampilkan password');break}
 case 'forgot':modal('Lupa password?','<p>Hubungi operator Kecamatan Mentaya Hilir Selatan untuk verifikasi identitas dan pengaturan ulang password akun.</p>');break;
 case 'sync':await refreshScheduler.refresh(true);break;
 case 'filter':filter=arg;render();break;
 case 'period':modal('Periode riwayat','<form id="month"><label class="formlabel">Bulan<input class="control" type="month" required name="month" value="'+esc(period)+'"></label><button class="primary full">Tampilkan</button></form>');break;
 case 'gps':{const s=session, pos=await locate();if(s===session){render();toast('Lokasi diperoleh · akurasi ±'+Math.round(pos.coords.accuracy)+' m.')}break}
 case 'CHECKIN':case 'CHECKOUT':modal(label(key),'<p>Rekam lokasi saat ini untuk '+label(key)+'. Transaksi pilot disimpan dahulu di perangkat. Server memeriksa jadwal dan waktu ketika transaksi diterima.</p><p class="eyebrow">POC_TEST · GPS perangkat · Verifikasi manual</p>'+btn('record:'+key,'Rekam '+label(key),'primary full','pin'));break;
 case 'record':await capture(arg);break;
 case 'detail':{const q=queue.find(x=>x.id===arg);if(!q)return;modal('Antrean '+label(q.action),line('Tanggal shift',esc(q.payload.shiftDate))+line('Rekam lokal',esc(wib(q.at,{dateStyle:'short',timeStyle:'short'}))+' WIB')+line('Akurasi GPS','±'+q.payload.gpsAccuracy+' m')+'<p>'+esc(q.issue||'Menunggu pengiriman')+'</p><small class="mono">'+esc(q.id)+'</small>');break}
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
 case 'diagnostic':modal('Uji koneksi API','<p>Periksa apakah browser ini dapat membaca respons GET dan POST dari deployment. Pengujian tidak memerlukan akun.</p>'+btn('probe','Mulai pengujian','primary','refresh'));break;
 case 'probe':await probe();modal('Uji koneksi API','<p>✓ GET health terbaca.</p><p>✓ POST tanpa token menghasilkan SESSION_REQUIRED.</p><p>Transport siap diuji dengan akun pilot.</p>');break;
 case 'install':if(installEvent){await installEvent.prompt();installEvent=null}else toast('Buka menu browser → Instal aplikasi / Tambahkan ke layar utama.');break;
 case 'password':modal('Ubah password',passwordForm());break;
 case 'about':modal('Tentang aplikasi','<p>Absensi Kehadiran Outsourcing<br>Kecamatan Mentaya Hilir Selatan</p><p>Pilot PWA 1.7.0</p>');break;
 case 'help':modal('Bantuan & panduan','<p>Masuk saat online untuk memuat jadwal. Tekan Check-in atau Check-out, lalu izinkan GPS. Buka Riwayat untuk memeriksa antrean dan hasil verifikasi.</p><p>Jika sesi berakhir, masuk kembali dengan akun yang sama. Antrean akan dicoba kembali saat aplikasi terbuka dan terhubung.</p>');break;
 case 'logout':modal('Keluar dari aplikasi?','<p>Antrean yang tersimpan dapat dilanjutkan saat akun yang sama masuk kembali.</p>'+btn('confirmLogout','Keluar','danger'));break;
 case 'confirmLogout':{let revoked=false;try{if(navigator.onLine){await api('LOGOUT');revoked=true}}finally{clearSession();toast(revoked?'Anda telah keluar.':'Sesi lokal ditutup. Sesi server berakhir sesuai masa berlakunya.')}break}
 }
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||b.disabled)return;
 if(b.id==='close'){dialog.close();return}
 if(b.dataset.record){const r=rows.find(x=>x.recordId===b.dataset.record);if(r)details(r);return}
 if(b.dataset.review){showReview(b.dataset.review);return}
 if(!b.dataset.act)return;
 b.disabled=true;
 try{await act(b.dataset.act)}catch(err){report(err)}finally{b.disabled=false}
});
document.addEventListener('change',e=>{if(e.target.name==='verdict'){
 const required=e.target.value!=='VERIFIED';$('#colorlabel').style.display=required?'none':'grid';const notes=e.target.form.elements.notes;notes.required=required;notes.minLength=required?5:0;
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
  case 'decision':await api('VERIFY',{payload:{recordId:f.dataset.id,verificationStatus:input.verdict,finalStatus:input.verdict==='VERIFIED'?input.color:'',notes:input.notes.trim()}});dialog.close();verifier=verifier.filter(x=>x.recordId!==f.dataset.id);render();toast('Keputusan dicatat server.');await refreshScheduler.refresh(false,true,true);break;
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
dialog.addEventListener('close', () => {
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
