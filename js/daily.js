/** Rekap harian PoC. Sumber hanya MY_DAILY dari backend, BUKAN jumlah transaksi. */
const codes=['HIJAU','KUNING','MERAH','BIRU','COKELAT'];
export function summarizeDaily(days){
 const totals={HIJAU:0,KUNING:0,MERAH:0,BIRU:0,COKELAT:0,unverified:0,partialA:0,partialB:0,absenceA:0,absenceB:0};
 for(const d of (Array.isArray(days)?days:[])){
  if(codes.includes(d.finalStatus))totals[d.finalStatus]++;
  else totals.unverified++;
  if(d.partialReason==='PARTIAL_NO_CHECKOUT'&&d.finalStatus==='KUNING')totals.partialA++;
  if(d.partialReason==='PARTIAL_REJECTED'&&d.finalStatus==='KUNING')totals.partialB++;
  if(d.absenceReason==='ABSENT_NO_ACTIVITY'&&d.finalStatus==='MERAH')totals.absenceA++;
  if(d.absenceReason==='ABSENT_CHECKIN_REJECTED'&&d.finalStatus==='MERAH')totals.absenceB++;
 }
 return totals;
}
export function dayExplanation(day){
 if(!day)return 'Belum tercatat';
 if(day.partialReason==='PARTIAL_NO_CHECKOUT')return 'Hadir sebagian A · Tidak Check-out';
 if(day.partialReason==='PARTIAL_REJECTED')return 'Hadir sebagian B · Ditolak verifikator';
 if(day.partialReason==='PARTIAL_VERIFIER_ASSESSED')return 'Hadir sebagian · Penilaian verifikator';
 if(day.absenceReason==='ABSENT_NO_ACTIVITY')return 'Tidak hadir A · Tidak melakukan absensi';
 if(day.absenceReason==='ABSENT_CHECKIN_REJECTED')return 'Tidak hadir B · Check-in ditolak verifikator';
 if(day.finalStatus==='HIJAU')return 'Hadir lengkap · Kedua aktivitas disetujui';
 if(day.finalStatus==='MERAH')return 'Tidak hadir/gagal · Tidak ada Check-in yang disetujui';
 if(day.finalStatus==='BIRU')return 'Izin resmi';
 if(day.finalStatus==='COKELAT')return 'Insiden';
 if(day.stage==='IN_PROGRESS')return 'Masih dalam jendela Check-out';
 if(day.stage==='REVIEW')return 'Perlu peninjauan data';
 return 'Menunggu verifikasi';
}
