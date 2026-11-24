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
  return '<h1 class="request-page-heading">'+icon('doc')+' <span>Pelaporan Izin dan Insiden</span></h1><section class="card request-info"><div>'+icon('calendar')+
    '<small>Izin Bulan Ini</small><b>'+(data?.month===day.slice(0,7)?esc(data.approvedDays)+' hari':'—')+'</b>'+
    '<small>'+esc(fmtDay(day,{month:'long',year:'numeric'}))+'</small></div><div><small>Terdaftar Sejak</small><b>'+
    esc(accountAge(registered,day)||'Belum tersedia')+'</b><small>'+esc(registered?fmtDay(registered):'')+'</small></div></section>'+
    '<div class="two request-entry-actions">'+btn('newdraft','IZIN','primary request-entry-button','doc')+btn('incident','INSIDEN','danger request-entry-button request-incident-button','shield')+'</div>'+
    card('Riwayat permohonan',requestList(items));
}
export function requestForm(kind,d={},today,test=false){
  const incident=kind==='INCIDENT';
  return '<form id="request-form" data-kind="'+kind+'" data-test="'+(test?'yes':'no')+'" data-id="'+esc(d.id||'')+'"><label class="formlabel">'+
    (incident?'Tanggal mulai shift yang terdampak':'Dari tanggal')+'<input class="control" required type="date" name="day" value="'+esc(d.day||today)+'"></label>'+
    (incident?'':'<label class="formlabel">Sampai tanggal<input class="control" required type="date" name="end" value="'+esc(d.end||d.day||today)+'"></label>')+
    '<label class="formlabel">'+(incident?'Uraian kejadian':'Alasan izin')+'<textarea class="control" rows="3" required maxlength="500" name="reason">'+
    esc(d.reason||'')+'</textarea></label>'+(incident?'<p>'+ (test?'MODE UJI · Laporan ini hanya untuk simulasi.':'Setelah insiden disetujui, kode jadwal tanggal tersebut menjadi I.')+'</p>':'')+
    '<div class="request-form-actions"><button class="primary" type="submit" value="send">Kirim Pengajuan</button><button class="secondary" type="submit" value="draft">Simpan Draf</button></div></form>';
}
export function requestDetail(r,review){
  const id=esc(encodeURIComponent(r.id)),pending=r.status==='PENDING';
  const incident=r.kind==='INCIDENT',correction=['APPROVED','REJECTED'].includes(r.status);
  const decisions=(r.history||[]).map(e=>'<li><b>'+esc(e.prior+' → '+e.decision)+'</b><small>'+
    esc('Revisi '+e.revision+' · '+e.actor+' · '+e.at+' WIB')+'</small><p>'+esc((incident&&e.decision==='APPROVED'?({DAY:'Seluruh shift',CHECK_IN:'Check-in',CHECK_OUT:'Check-out'}[e.coverage||'DAY'])+' · ':'')+(e.reason||'Tanpa catatan tambahan'))+'</p></li>').join('');
  return (r.scope==='MOBILE_TEST'?chip('MODE UJI','yellow'):'')+line('Status',esc(stages[r.status]||r.status))+line('Tanggal',esc(r.day+(r.end!==r.day?' – '+r.end:'')))+
    '<p class="prose-request">'+esc(r.reason)+'</p>'+(incident?line('Jenis',esc(r.requestType||'Insiden')):'')+
    (r.at&&typeof r.at==='string'?line('Diajukan',esc(r.at)+' WIB'):'')+
    (decisions?line('Jumlah koreksi',(r.history||[]).filter(e=>e.prior!=='PENDING').length)+'<h3>Riwayat keputusan</h3><ol class="incident-history">'+decisions+'</ol>':'')+
    (r.issue?'<p>'+esc(r.issue)+'</p>':'')+(r.reviewedBy?line('Keputusan',esc(r.reviewedBy+' · '+r.reviewedAt)):'')+
    (r.notes?'<p class="prose-request">'+esc(r.notes)+'</p>':'')+
    (r.status==='DRAFT'?btn('editRequest:'+id,'Buka draf','primary')+' '+btn('deleteDraft:'+id,'Hapus draf','secondary'):'')+
    (r.status==='QUEUED'?btn('resendRequest','Periksa pengiriman','primary'):'')+
    ((pending||correction)&&review&&(!incident||Number.isInteger(r.revision))?'<form id="request-decision" data-id="'+id+'" data-revision="'+esc(r.revision||0)+'"><label class="formlabel">'+(correction?'Koreksi keputusan':'Keputusan')+'<select name="decision">'+
    (r.status!=='APPROVED'||incident?'<option value="APPROVED">Setujui</option>':'')+(r.status!=='REJECTED'?'<option value="REJECTED">Tolak</option>':'')+
    '</select></label>'+(incident?'<label class="formlabel">Cakupan jika disetujui<select name="coverage">'+
    [['DAY','Seluruh shift'],['CHECK_IN','Hanya Check-in'],['CHECK_OUT','Hanya Check-out']].map(([value,label])=>'<option value="'+value+'"'+((r.history||[]).slice(-1)[0]?.coverage===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label>':'')+'<label class="formlabel">'+(correction?'Alasan koreksi':'Catatan keputusan')+'<textarea name="notes" maxlength="500" rows="2" '+(incident||correction?'required minlength="5"':'')+'></textarea></label><button class="primary full">Simpan keputusan</button></form>':
    pending&&!review?btn('cancelRequest:'+id,'Batalkan permohonan','secondary'):'');
}
// HF6 — two views over the SAME authenticated Late_Count / Discipline_Audit projection.
const lateClasses=['KUNING','MERAH','HITAM'];
function lateNumber(n){return n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString('id-ID');}
function lateMinutes(n){return n==null?'—':lateNumber(n)+' menit';}
function lateClass(n){return n==null?'MISSING':n>=450?'HITAM':n>=180?'MERAH':n>=60?'KUNING':'NETRAL';}
function lateMonthLabel(m){
  if(!/^\d{4}-\d{2}$/.test(String(m)))return m||'—';
  return new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T00:00:00Z'));
}
function lateSwitch(options,active){return '<div class="late-switch" role="group" aria-label="Pilihan grafik">'+
  options.map(([key,text])=>'<button type="button" data-act="lateMode:'+key+'" aria-pressed="'+(active===key)+'" class="'+(active===key?'chosen':'')+'">'+text+'</button>').join('')+'</div>';}
function latePeriod(month,yearOnly){return '<div class="late-period">'+
  '<button type="button" data-act="'+(yearOnly?'lateYearMove':'monthMove')+':-1" aria-label="'+(yearOnly?'Tahun':'Bulan')+' sebelumnya">‹</button>'+ 
  '<strong>'+esc(yearOnly?month.slice(0,4):lateMonthLabel(month))+'</strong>'+ 
  '<button type="button" data-act="'+(yearOnly?'lateYearMove':'monthMove')+':1" aria-label="'+(yearOnly?'Tahun':'Bulan')+' berikutnya">›</button></div>';}
function lateStat(name,value,sub=''){return '<div class="late-kpi"><small>'+esc(name)+'</small><strong>'+esc(value)+'</strong>'+ (sub?'<small>'+esc(sub)+'</small>':'')+'</div>';}
function lateLegend(){return '<div class="late-legend" aria-label="Kategori nilai disiplin">'+
  [['KUNING','60–179'],['MERAH','180–449'],['HITAM','≥450']].map(([c,v])=>
    '<span><i data-class="'+c+'"></i>'+c[0]+c.slice(1).toLowerCase()+' '+v+'</span>').join('')+
  '<small>Di bawah 60 menit: belum masuk kategori</small></div>';}
function lateNote(r){
  if(r.missing)return 'Sebagian bukti waktu lama belum dapat dihitung.';
  if(r.waiting)return r.waiting+' tanggal masih menunggu hasil akhir.';
  if(!r.isFinal)return 'Angka sementara. Periode atau pemeriksaan presensi belum selesai.';
  return 'Rekap periode sudah final.';
}
function lateCheckinMeasured(d){
  if(d.checkin==null||!['FINAL','ARSIP'].includes(d.stage))return false;
  return !/^(ABSENT_|PARTIAL_NO_VALID_CHECKIN|LEAVE_|INCIDENT_)/.test(d.basis||'');
}
function lateMiniStats(r){
  const measured=(r.days||[]).filter(lateCheckinMeasured),late=measured.filter(d=>d.checkin>0);
  const punctual=measured.length-late.length,pct=measured.length?Math.round(punctual/measured.length*100):null;
  return '<div class="late-kpis">'+lateStat('Hari terlambat',measured.length?late.length+' hari':'—')+
    lateStat('Terlambat masuk',lateMinutes(r.checkin))+lateStat('Tepat waktu',measured.length?punctual+' hari':'—')+
    lateStat('Ketepatan waktu',pct===null?'—':pct+'%')+'</div>';
}
function lateDaysChart(r,month){
  const map=new Map((r.days||[]).map(d=>[d.date,d])),year=Number(month.slice(0,4)),mm=Number(month.slice(5,7)),
    count=new Date(Date.UTC(year,mm,0)).getUTCDate(),dates=Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0')),
    values=dates.map(date=>{const d=map.get(date);return d&&lateCheckinMeasured(d)?d.checkin:null;});
  const max=Math.max(10,...values.map(n=>n||0));let cumulative=0;
  const columns=dates.map((date,i)=>{
    const d=map.get(date),v=values[i],valid=v!==null;
    if(d?.final&&d.discipline!==null)cumulative+=d.discipline;
    const kind=d?.source==='POLICY'&&d.final?lateClass(cumulative):'NETRAL',
      flag=d?.final&&d.equivalence>0?(d.basis?.startsWith('ABSENT_')?'A':'P'):'',
      height=valid&&v>0?Math.max(5,Math.round(v/max*116)):0,
      description=!d?'Belum ada rincian':!valid?'Belum terukur':v?'Terlambat '+lateMinutes(v):'Tepat waktu';
    return '<button type="button" class="late-day" data-act="lateDay:'+date+'" title="'+esc(date+' · '+description)+'" aria-label="'+esc(date+' · '+description)+'">'+
      '<span class="late-day-track">'+(valid?(v>0?'<i data-class="'+kind+'" style="height:'+height+'px"></i>':'<em class="late-zero"></em>'):
      '<em class="late-unknown">·</em>')+(flag?'<strong class="late-day-flag" data-class="'+kind+'">'+flag+'</strong>':'')+'</span><small>'+(i===0||i%3===0||i===count-1?i+1:'')+'</small></button>';
  }).join('');
  const available=values.some(v=>v!==null)||(r.days||[]).some(d=>d.final),audited=(r.days||[]).some(d=>d.source==='POLICY');
  return '<div class="late-chart-head"><b>Grafik keterlambatan harian</b><small>Menit terlambat masuk</small></div>'+ 
    '<div class="late-chart-scroll" tabindex="0" role="region" aria-label="Grafik keterlambatan tanggal 1 sampai '+count+'">'+
    '<div class="late-daily-chart">'+columns+'</div></div>'+ 
    (available?'<small class="late-explain">Ketuk tanggal untuk rincian. '+(audited?'Warna mengikuti akumulasi nilai disiplin hingga hari itu. A = tidak hadir, P = absen sebagian.':'Data arsip hanya menampilkan transaksi yang batas waktunya terverifikasi.')+'</small>':
      '<p class="late-empty">Belum ada rincian harian yang dapat ditampilkan. Angka kosong bukan berarti tepat waktu.</p>');
}
function lateYearChart(report,person){
  const trend=person?.trend||report.trend||[];if(!trend.length)return empty('Rekap tahun ini belum tersedia.');
  const max=Math.max(1,...trend.map(d=>d.total||0));
  const nodes=trend.map(t=>{
    const val=t.total,kind=t.provisional?'PROVISIONAL':lateClass(val),height=val===null?0:Math.max(val?5:0,Math.round(val/max*125));
    return '<button type="button" data-act="lateMonth:'+esc(t.month)+'" class="late-year-col" title="'+
      esc(lateMonthLabel(t.month)+' · '+lateMinutes(val)+(t.provisional?' · sementara':''))+'" aria-label="'+esc(lateMonthLabel(t.month)+' · '+lateMinutes(val)+(t.provisional?' · sementara':''))+'">'+
      '<b>'+lateNumber(val)+'</b><span class="late-year-track">'+(val!==null?'<i data-class="'+kind+'" style="height:'+height+'px"></i>':'<em>·</em>')+
      '</span><small>'+esc(lateMonthLabel(t.month).split(' ')[0].slice(0,3))+'</small></button>';
  }).join('');
  return '<div class="late-chart-head"><b>Riwayat nilai disiplin</b><small>Total per bulan · ketuk batang untuk membuka harian</small></div>'+ 
    '<div class="late-chart-scroll" role="region" tabindex="0" aria-label="Grafik bulanan">'+
    '<div class="late-year-chart">'+nodes+'</div></div>'+lateLegend();
}
function latePersonal(report,month,r,mode,drill=false){
  const year=mode==='bulanan';
  return (drill?'<div class="late-selected-head"><b>'+esc(r.name)+'</b><button type="button" data-act="lateBack">Kembali ke 13 pegawai</button></div>':'')+
    lateSwitch([['harian','Harian'],['bulanan','Bulanan']],mode)+latePeriod(month,year)+
    lateMiniStats(r)+
    '<div class="late-value-strip"><div><small>Nilai disiplin bulan ini</small><strong>'+lateMinutes(r.discipline)+'</strong></div>'+ 
    '<span class="late-class" data-class="'+esc(r.classification||'MISSING')+'">'+esc(r.classification||'Belum lengkap')+'</span></div>'+ 
    (year?lateYearChart(report,r):lateDaysChart(r,month)+lateLegend())+
    '<p class="late-explain">'+esc(lateNote(r))+' Persentase dihitung dari Check-in sah yang waktunya dapat diukur.</p>'+ 
    '<details class="late-details"><summary>Rincian perhitungan</summary>'+ 
    line('Terlambat masuk',lateMinutes(r.checkin))+line('Selisih waktu pulang',lateMinutes(r.checkout))+
    line('Nilai alpa / absen sebagian',lateMinutes(r.equivalence))+line('Total nilai disiplin',lateMinutes(r.discipline))+
    '<small>Selisih waktu pulang dicatat terpisah dan tidak otomatis menjadi penalti.</small></details>';
}
function lateFiltered(items,filter){return filter==='SEMUA'?items:items.filter(x=>x.profession===filter);}
function lateVerifierBars(report,filter){
  const all=report.items||[],items=lateFiltered(all,filter).slice().sort((a,b)=>
    (b.discipline===null?-1:b.discipline)-(a.discipline===null?-1:a.discipline)||String(a.name).localeCompare(String(b.name),'id')),
    max=Math.max(1,...items.map(x=>x.discipline||0));
  const filters=['SEMUA',...new Set(all.map(x=>x.profession).filter(Boolean))];
  const controls='<div class="late-filters" role="group" aria-label="Filter profesi">'+filters.map(f=>
    '<button type="button" data-act="lateFilter:'+esc(encodeURIComponent(f))+'" aria-pressed="'+(filter===f)+'" class="'+(filter===f?'chosen':'')+'">'+
      esc(f==='SEMUA'?'Semua':f)+'</button>').join('')+'</div>';
  return controls+'<div class="late-chart-head"><b>Perbandingan pegawai</b><small>Total nilai disiplin · tertinggi di atas</small></div>'+ 
    '<div class="late-compare" role="list">'+items.map(r=>{
      const value=r.discipline,kind=r.classification||'MISSING',width=value===null?0:Math.max(value?1:0,100*value/max);
      return '<button type="button" class="late-person" role="listitem" data-act="latePick:'+esc(encodeURIComponent(r.employeeId))+'" aria-label="'+
      esc(r.name+' · '+lateMinutes(value)+' · '+(r.classification||'belum lengkap'))+'">'+ 
      '<span class="late-person-name"><b>'+esc(r.name)+'</b><small>'+esc(r.profession||r.employeeId)+'</small></span>'+ 
      '<span class="late-hbar"><i data-class="'+esc(kind)+'" style="width:'+width+'%"></i></span>'+ 
      '<span class="late-person-min">'+lateNumber(value)+'<small> menit</small></span></button>';
    }).join('')+'</div>'+(items.length?'':'<p class="late-empty">Tidak ada pegawai pada filter ini.</p>')+
    '<small class="late-explain">Ketuk nama atau batang untuk melihat detail per pegawai. “—” berarti data belum tersedia.</small>'+lateLegend();
}
function lateVerifierTrend(report){
  const trends=report.trend||[],max=Math.max(1,...trends.map(t=>t.available||0));
  return '<div class="late-chart-head"><b>Tren kategori kedisiplinan</b><small>Jumlah pegawai per bulan · tidak termasuk data belum lengkap</small></div>'+ 
    '<div class="late-chart-scroll" tabindex="0" role="region" aria-label="Tren kategori tahun ini"><div class="late-trend-chart">'+
    trends.map(t=>'<button type="button" data-act="lateMonth:'+esc(t.month)+'" class="late-trend-col" title="'+
      esc(lateMonthLabel(t.month)+' · '+t.available+' pegawai punya klasifikasi')+'" aria-label="'+
      esc(lateMonthLabel(t.month)+' · '+t.available+' data final, '+t.missing+' belum tersedia')+'">'+
      '<b>'+t.available+'</b><span class="late-trend-track">'+
      ['HITAM','MERAH','KUNING','NETRAL'].map(k=>t.classes?.[k]?'<i data-class="'+k+'" style="height:'+Math.max(2,t.classes[k]/max*125)+'px"></i>':'').join('')+
      '</span><small>'+esc(lateMonthLabel(t.month).split(' ')[0].slice(0,3))+'</small></button>').join('')+
    '</div></div>'+lateLegend()+'<small class="late-explain">Setiap batang menunjukkan jumlah pegawai yang memiliki klasifikasi final. Ketuk bulan untuk melihat perbandingan pegawai.</small>';
}
export function lateCard(report,month,isVerifier,periodButton,options={}){
  const mode=options.mode||(isVerifier?'pegawai':'harian'),filter=options.filter||'SEMUA',chosen=options.selected||'';
  const title=isVerifier?'Statistik Kedisiplinan':'Kedisiplinan Saya';
  const header='<div class="between late-title"><h2>'+icon('bars')+' '+title+'</h2><small>'+(isVerifier?'Monitoring pegawai':'Ringkasan pribadi')+'</small></div>';
  let body='';
  if(!report||report.month!==month||report.unavailable)body=empty('Data belum dapat diperbarui. Coba lagi saat koneksi tersedia.');
  else if(!isVerifier){
    const r=report.items?.[0];body=r?latePersonal(report,month,r,mode):empty('Belum ada data untuk bulan ini.');
  }else{
    const selected=report.items?.find(r=>r.employeeId===chosen);
    if(selected)body=latePersonal(report,month,selected,mode==='bulanan'?'bulanan':'harian',true);
    else{
      const all=report.items||[],pending=all.filter(r=>r.discipline===null||!r.classification).length,
        attention=all.filter(r=>lateClasses.includes(r.classification)).length,
        range=mode==='tren';
      body=lateSwitch([['pegawai','13 Pegawai'],['tren','Tren Bulanan']],mode)+latePeriod(month,range)+
        '<div class="late-kpis late-kpis-three">'+lateStat('Pegawai dipantau',String(all.length))+
        lateStat('Perlu perhatian',String(attention))+lateStat('Belum final',String(pending))+'</div>'+ 
        (range?lateVerifierTrend(report):lateVerifierBars(report,filter));
    }
  }
  return '<section class="card late-widget">'+header+body+
    (report?.rollupEnabled===false?'<small class="late-alert">Sinkronisasi rekap belum diaktifkan; angka bisa belum lengkap.</small>':'')+'</section>';
}
export function lateDayDetail(report,id,date){
  const r=report?.items?.find(x=>x.employeeId===id),d=r?.days?.find(x=>x.date===date);
  if(!r||!d)return '<p>Rincian tanggal ini belum tersedia. Tidak berarti keterlambatan nol.</p>';
  const basis={COMPLETE:'Hadir lengkap',PARTIAL_NO_CHECKOUT:'Tidak absen pulang',PARTIAL_REJECTED:'Absen pulang ditolak',
    ABSENT_NO_ACTIVITY:'Tidak hadir tanpa keterangan',ABSENT_CHECKIN_REJECTED:'Absen masuk ditolak',
    LEAVE_APPROVED:'Izin disetujui',MEASURED_ARCHIVE:'Transaksi arsip terukur'};
  return line('Pegawai',esc(r.name))+line('Tanggal',esc(date))+line('Hasil hari',esc(basis[d.basis]||
    (d.stage==='FINAL'?'Sudah dihitung':'Masih menunggu pemeriksaan')))+
    line('Terlambat masuk',lateMinutes(d.checkin))+line('Selisih waktu pulang',lateMinutes(d.checkout))+
    line('Nilai alpa / absen sebagian',lateMinutes(d.equivalence))+line('Total nilai disiplin',lateMinutes(d.discipline))+
    '<small>'+(d.source==='ARCHIVE'?'Data arsip: hanya keterlambatan transaksi yang dapat diukur, tanpa asumsi alpa/parsial.':
      d.final?'Perhitungan hari ini final.':'Perhitungan hari ini belum final.')+'</small>';
}
export function previewCard(items,date){
  const list=date?items.filter(r=>r.shiftDate===date):items;
  if(!list.length)return '';
  return '<section class="card" data-test-preview><h2>Simulasi presensi '+chip('MODE UJI')+'</h2>'+list.map(r=>'<div class="preview-row"><span>'+esc(r.shiftDate+' · '+(r.type==='CHECK_IN'?'Check-in':'Check-out')+' · '+r.localTime+' WIB'+(r.testRunId?' · Sesi '+r.testRunId.slice(0,8):''))+'</span><b data-state="'+esc(r.finalStatus||(r.verificationStatus==='REJECTED'?'MERAH':'PENDING'))+'">'+
    esc(({VERIFIED:'Disetujui',REJECTED:'Ditolak',PENDING:'Menunggu verifikasi',REVIEW:'Perlu rekonsiliasi',NEEDS_CORRECTION:'Perlu koreksi'})[r.verificationStatus]||r.verificationStatus)+
    esc(r.finalStatus?' · '+r.finalStatus:'')+'</b></div>').join('')+'</section>';
}
