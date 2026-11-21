import {icon} from './icons.js';
import {esc,btn,chip,card,line,empty} from './ui.js';

export const requestNames={LEAVE:'Pengajuan Izin',INCIDENT:'Pelaporan Insiden'};
const stages={DRAFT:'DRAF LOKAL',QUEUED:'MENUNGGU PENGIRIMAN',PENDING:'TERKIRIM · MENUNGGU PERSETUJUAN',
  APPROVED:'DISETUJUI',REJECTED:'DITOLAK',CANCELLED:'DIBATALKAN',REVIEWED:'SUDAH DITINJAU',CLOSED:'SELESAI',DENIED:'DITOLAK'};
export function normalizeDraft(d){
  return {...d,kind:d.kind==='INCIDENT'?'INCIDENT':'LEAVE',end:d.end||d.day,status:d.status||'DRAFT'};
}
export function accountAge(from,to){
  if(!from||from>to)return '';
  const [year,month,day]=from.split('-').map(Number);
  const anchor=n=>{
    const start=new Date(Date.UTC(year,month-1+n,1));
    const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
    start.setUTCDate(Math.min(day,last));return start;
  };
  const end=new Date(to+'T00:00:00Z');
  let months=(end.getUTCFullYear()-year)*12+end.getUTCMonth()-month+1;
  if(anchor(months)>end)months--;
  return Math.round((end-anchor(months))/86400000)+' hr '+(months%12)+' bln '+Math.floor(months/12)+' th';
}
export function requestList(items,review=false){
  if(!items.length)return empty('Belum ada permohonan.');
  return items.map(r=>'<button class="request-row" data-act="request:'+esc(encodeURIComponent(r.id))+'"><b>'+
    esc((review?r.employeeId+' · ':'')+requestNames[r.kind])+'</b><small>'+esc(r.day+(r.end&&r.end!==r.day?' – '+r.end:''))+
    '</small><span>'+esc((r.scope==='MOBILE_TEST'?'MODE UJI · ':'')+(stages[r.status]||r.status)+(r.issue?' · Perlu ditinjau':''))+'</span></button>').join('');
}
export function leavePage({data,items,day,registered,fmtDay}){
  return '<h1>'+icon('doc')+' Izin</h1><section class="card request-info"><div>'+icon('calendar')+
    '<small>Izin Bulan Ini</small><b>'+(data?.month===day.slice(0,7)?esc(data.approvedDays)+' hari':'—')+'</b>'+
    '<small>'+esc(fmtDay(day,{month:'long',year:'numeric'}))+'</small></div><div><small>Terdaftar Sejak</small><b>'+
    esc(accountAge(registered,day)||'Belum tersedia')+'</b><small>'+esc(registered?fmtDay(registered):'')+'</small></div></section>'+
    '<div class="two">'+btn('newdraft',requestNames.LEAVE,'primary','doc')+btn('incident',requestNames.INCIDENT,'secondary','shield')+'</div>'+
    card('Riwayat permohonan',requestList(items));
}
export function requestForm(kind,d={},today,test=false){
  const incident=kind==='INCIDENT';
  return '<form id="request-form" data-kind="'+kind+'" data-test="'+(test?'yes':'no')+'" data-id="'+esc(d.id||'')+'"><label class="formlabel">'+
    (incident?'Tanggal mulai shift yang terdampak':'Dari tanggal')+'<input class="control" required type="date" name="day" value="'+esc(d.day||today)+'"></label>'+
    (incident?'':'<label class="formlabel">Sampai tanggal<input class="control" required type="date" name="end" value="'+esc(d.end||d.day||today)+'"></label>')+
    '<label class="formlabel">'+(incident?'Uraian kejadian':'Alasan izin')+'<textarea class="control" rows="3" required maxlength="500" name="reason">'+
    esc(d.reason||'')+'</textarea></label>'+(incident?'<p>'+ (test?'MODE UJI · Laporan ini hanya untuk simulasi.':'Setelah insiden disetujui, kode jadwal tanggal tersebut menjadi I.')+'</p>':'')+
    '<div class="two"><button class="secondary" type="submit" value="draft">Simpan draf</button><button class="primary" type="submit" value="send">Kirim pengajuan</button></div></form>';
}
export function requestDetail(r,review){
  const id=esc(encodeURIComponent(r.id)),pending=r.status==='PENDING';
  const incident=r.kind==='INCIDENT',correction=incident&&['APPROVED','REJECTED'].includes(r.status);
  const decisions=(r.history||[]).map(e=>'<li><b>'+esc(e.prior+' → '+e.decision)+'</b><small>'+
    esc('Revisi '+e.revision+' · '+e.actor+' · '+e.at+' WIB')+'</small><p>'+esc(e.reason||'Tanpa catatan tambahan')+'</p></li>').join('');
  return (r.scope==='MOBILE_TEST'?chip('MODE UJI','yellow'):'')+line('Status',esc(stages[r.status]||r.status))+line('Tanggal',esc(r.day+(r.end!==r.day?' – '+r.end:'')))+
    '<p class="prose-request">'+esc(r.reason)+'</p>'+(incident?line('Jenis',esc(r.requestType||'Insiden')):'')+
    (r.at&&typeof r.at==='string'?line('Diajukan',esc(r.at)+' WIB'):'')+
    (decisions?line('Jumlah koreksi',(r.history||[]).filter(e=>e.prior!=='PENDING').length)+'<h3>Riwayat keputusan</h3><ol class="incident-history">'+decisions+'</ol>':'')+
    (r.issue?'<p>'+esc(r.issue)+'</p>':'')+(r.reviewedBy?line('Keputusan',esc(r.reviewedBy+' · '+r.reviewedAt)):'')+
    (r.notes?'<p class="prose-request">'+esc(r.notes)+'</p>':'')+
    (r.status==='DRAFT'?btn('editRequest:'+id,'Buka draf','primary')+' '+btn('deleteDraft:'+id,'Hapus draf','secondary'):'')+
    (r.status==='QUEUED'?btn('resendRequest','Periksa pengiriman','primary'):'')+
    ((pending||correction)&&review&&(!incident||Number.isInteger(r.revision))?'<form id="request-decision" data-id="'+id+'" data-revision="'+esc(r.revision||0)+'"><label class="formlabel">'+(correction?'Koreksi keputusan':'Keputusan')+'<select name="decision">'+
    (r.status!=='APPROVED'?'<option value="APPROVED">Setujui</option>':'')+(r.status!=='REJECTED'?'<option value="REJECTED">Tolak</option>':'')+
    '</select></label><label class="formlabel">'+(correction?'Alasan koreksi':'Catatan keputusan')+'<textarea name="notes" maxlength="500" rows="2" '+(incident||correction?'required minlength="5"':'')+'></textarea></label><button class="primary full">Simpan keputusan</button></form>':
    pending&&!review?btn('cancelRequest:'+id,'Batalkan permohonan','secondary'):'');
}
export function lateCard(report,month,isVerifier,periodButton){
  const title='Keterlambatan',choose=isVerifier?periodButton():'';
  const head='<div class="between"><h2>'+icon('bars')+' '+title+'</h2>'+choose+'</div>';
  let body;
  if(!report||report.month!==month||report.unavailable)body=empty('Data keterlambatan belum tersedia.');
  else if(!isVerifier){
    const r=report.items[0];
    body=!r||!r.measured&&!r.missing?empty('Belum ada transaksi terverifikasi yang dapat dihitung.'):
      line('Terlambat Check-in',r.checkin==null?'—':esc(r.checkin)+' menit')+line('Selisih Check-out',r.checkout==null?'—':esc(r.checkout)+' menit')+
      line('Klasifikasi',esc(r.classification||'Belum lengkap'))+(r.missing?'<small>'+esc(r.missing)+' transaksi menunggu batas waktu historis.</small>':'');
  }else{
    const top=Math.max(4,4*Math.ceil(Math.max(0,...report.items.map(r=>r.discipline||0))/4));
    body='<small>Menit disiplin dari Check-in · '+esc(month)+'</small><div class="chart-scroll" tabindex="0" aria-label="Grafik menit per pegawai"><div class="late-bars"><div class="chart-axis"><small>Menit</small><div>'+[top,top*3/4,top/2,top/4,0].map(n=>'<span>'+n+'</span>').join('')+'</div></div>'+
      report.items.map(r=>'<div class="late-col" title="'+esc(r.name)+'"><b>'+esc(r.discipline??'—')+'</b><div class="bar-track"><i data-class="'+esc(r.classification)+'" style="height:'+(100*(r.discipline||0)/top)+'%"></i></div><strong>'+esc(r.employeeId)+'</strong><small>'+esc(r.name)+'</small><small>'+esc(r.classification||(r.missing?'Belum lengkap':'Belum ada data'))+'</small></div>').join('')+'</div></div>';
  }
  return '<section class="card">'+head+body+'</section>';
}
export function previewCard(items,date){
  const list=date?items.filter(r=>r.shiftDate===date):items;
  if(!list.length)return '';
  return '<section class="card" data-test-preview><h2>Simulasi presensi '+chip('MODE UJI')+'</h2>'+list.map(r=>'<div class="preview-row"><span>'+esc(r.shiftDate+' · '+(r.type==='CHECK_IN'?'Check-in':'Check-out')+' · '+r.localTime+' WIB'+(r.testRunId?' · Sesi '+r.testRunId.slice(0,8):''))+'</span><b data-state="'+esc(r.finalStatus||(r.verificationStatus==='REJECTED'?'MERAH':'PENDING'))+'">'+
    esc(({VERIFIED:'Disetujui',REJECTED:'Ditolak',PENDING:'Menunggu verifikasi',REVIEW:'Perlu rekonsiliasi',NEEDS_CORRECTION:'Perlu koreksi'})[r.verificationStatus]||r.verificationStatus)+
    esc(r.finalStatus?' · '+r.finalStatus:'')+'</b></div>').join('')+'</section>';
}
