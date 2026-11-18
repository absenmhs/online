# PWA ABSEN MHS · Pilot 1.0

Paket statis untuk GitHub Pages. Berkas index.html berada di akar. Tidak memerlukan npm atau proses build.

## 1. Hubungkan proyek Apps Script yang sudah lulus uji

Gunakan proyek aktif yang terikat ke Google Sheets. Simpan versi saat ini sebelum menyiapkan deployment. Pertahankan AuthService, AttendanceWriter, VerificationService, PWA_API, validator dan tab Sheet yang sudah bekerja.

1. Tambahkan isi `setup/WebAppSupport.gs` sebagai file baru di editor Apps Script. Pada **PWA_API**, ubah isi fungsi doPost yang sudah ada menjadi baris di bawah ini. Pertahankan doGet asli dan hanya satu doPost.

   ```js
   function doPost(e) { return mhsWebPost_(e); }
   ```

2. Pada modul server **yang dipanggil oleh web app** (AuthService, PWA_API, AttendanceWriter, VerificationService, aturan jadwal aktif dan dependensinya), ganti panggilan `SpreadsheetApp.getActiveSpreadsheet()` atau `SpreadsheetApp.getActive()` yang mengambil database menjadi `mhsWebSpreadsheet_()`. Jangan ganti di WebAppSupport.gs sendiri. Helper memakai spreadsheet aktif di sidebar dan membuka database berdasarkan ID saat konteks web app tidak memiliki spreadsheet aktif. ID diatur sekali pada **Project Settings → Script Properties → MHS_SPREADSHEET_ID**, dengan nilai di antara /d/ dan /edit pada URL spreadsheet. ID dan secret proyek tetap di server.

3. Periksa konfigurasi pilot yang sudah ada. Pertahankan allowlist pegawai uji pada `MHS_POC_ALLOWED_EMPLOYEES`. Gunakan `MHS_POC_API_ENABLED=YES`, `MHS_POC_WRITE_ENABLED=YES` dan `MHS_POC_VERIFY_ENABLED=YES` untuk uji lengkap. **Jalur browser memerlukan MHS_POC_SIMULATION_ENABLED=NO.** Dengan nilai YES, Writer mengembalikan SIMULATION_PANEL_ONLY. Gunakan jadwal aktif atau pengecualian draft yang memang sudah disetujui pilot. Jalankan `apiTestPoCReadiness()` dan `awTestPoCReadiness()` di editor. Periksa skema, auth, writer, verifier dan timeRulesAvailable.

   **Penting untuk arsip sumber:** AttendanceRules.gs di lampiran identik dengan ScheduleManager.gs. Definisi arEvaluateAttendance tidak terdapat di arsip, padahal Writer memerlukannya. Pertahankan versi validator dari proyek aktif yang lulus uji. Jangan menimpa proyek aktif dengan seluruh folder dari arsip. Bila timeRulesAvailable bernilai false, pulihkan modul aturan waktu aktif sebelum menguji transaksi.

4. **Deploy → New deployment → Web app** (atau edit deployment yang sudah ada dan pilih versi baru). Jalankan sebagai pemilik proyek. Untuk jalur fetch langsung ini, gunakan akses yang mengizinkan browser pilot memanggil /exec tanpa login Google. Hak akses pegawai tetap diperiksa AuthService. Spreadsheet tetap privat. Jika organisasi mewajibkan login Google untuk setiap pemanggilan, jalur langsung ini belum kompatibel dengan kebijakan tersebut. Salin URL deployment berakhiran `/exec`.

## 2. Unggah ke GitHub

1. Ekstrak ZIP. Isi `apiUrl` di `js/config.js` dengan URL /exec dari langkah sebelumnya. Cukup isi URL publik. Password, token, daftar pegawai dan properti server tidak dimasukkan ke repo.
2. Upload **isi folder hasil ekstrak** ke akar repository. Pastikan index.html berada sejajar dengan css/, js/, assets/, manifest.webmanifest dan sw.js. Folder setup/ hanya diperlukan saat pemasangan backend.
3. Di **Settings → Pages → Build and deployment**, pilih **Deploy from a branch**, branch yang berisi file, lalu **/(root)** dan **Save**. Buka URL HTTPS hasil deployment. Di ponsel, kunjungi sekali saat online, lalu pilih **Instal aplikasi** di menu browser atau **Bagikan → Tambah ke Layar Utama** di Safari.

## 3. Uji dari alamat GitHub Pages

| Langkah | Hasil yang perlu terlihat |
| --- | --- |
| Sebelum login, tekan **Uji koneksi API → Mulai pengujian** | GET mengembalikan HEALTH_ONLY. POST ME tanpa token menghasilkan SESSION_REQUIRED. Keduanya harus dapat dibaca sebagai JSON. |
| Login dengan akun pegawai pilot | Password awal memicu ganti password, lalu login ulang. Identitas, profil dan referensi shift berasal dari sesi server. “Ingat Saya” menyimpan username. |
| Pada jendela jadwal yang berlaku, Check-in lalu izinkan lokasi | Satu UUID masuk ke antrean lokal sebelum POST. Raw_Attendance mendapat satu baris POC_TEST dan Status_View menampilkan PENDING. |
| Setelah sesi dan jadwal dimuat, putuskan jaringan, rekam tindakan yang sesuai (misalnya Check-out), lalu muat ulang tab yang sama | Shell aplikasi dan antrean dapat dibuka kembali. Rekaman lokal menampilkan waktu rekam dan akurasi GPS. |
| Sambungkan jaringan saat aplikasi terbuka | Antrean dikirim dengan UUID yang sama. Periksa satu baris per transaksi. Waktu resmi mengikuti waktu server saat menerima. Jendela tertutup atau shift berbeda tetap ditolak. |
| Login sebagai verifikator di perangkat/browser terpisah | Antrean menampilkan record PENDING. Setujui Check-in dengan HIJAU atau tolak Check-out dengan alasan minimal lima karakter. |
| Pegawai membuka Riwayat → Perbarui | Hasil VERIFIED/REJECTED cocok dengan Status_View. Keputusan sudah keluar dari antrean verifikator. |
| Buka aplikasi dari ikon ponsel, coba 320 px dan lanskap | Navigasi dapat dijangkau, konten bergulir vertikal dan seluruh kontrol tetap dapat digunakan. |

## Batas pilot dan pemecahan masalah

- **GET berhasil, POST gagal.** Periksa versi deployment, akses /exec serta respons pengalihan Google. POST memakai JSON dalam text/plain, mengikuti redirect dan membutuhkan respons JSON yang dapat dibaca. Respons HTML/login, permintaan timeout dan kegagalan CORS tidak dianggap sukses. Jangan memakai mode no-cors untuk menyimpulkan data terkirim.
- **Antrean tertahan.** Buka detail untuk kode server. Login kembali dengan akun yang sama bila sesi berakhir. Periksa jadwal, izin simulasi, skema serta waktu penerimaan sebelum menekan Sinkronkan sekarang. Retry selalu mempertahankan UUID. Penolakan aturan disimpan dan membutuhkan pemeriksaan. Transaksi dengan tanda terima tetapi Status_View belum lengkap tetap berada di antrean perbaikan.
- **Offline.** Login awal memerlukan internet. Perekaman offline memakai sesi tab yang masih berlaku dan referensi jadwal yang terakhir dimuat pada tanggal WIB yang sama. Perangkat menyimpan antrean di IndexedDB, dipisahkan per deployment dan akun. Setelah tab ditutup, login ulang untuk melanjutkan. Sinkronisasi berjalan saat aplikasi aktif. Menghapus data situs akan menghapus antrean lokal.
- **GPS dan wajah.** PWA memakai GPS aktual, membatasi usia sampel dan mencoba ulang akurasi di atas 75 m. Ambang dapat disesuaikan di config.js. Writer asli mempertahankan GPS_CLIENT_UNVERIFIED dan LIVENESS_NOT_VERIFIED. Deteksi wajah/gerakan, bukti foto, proteksi fake GPS penuh serta putusan geofence belum diaktifkan untuk jalur pilot ini.
- **Menu pegawai.** Izin menyediakan draf lokal per akun. API belum menyediakan kuota, pengajuan izin atau laporan insiden. Operator menangani permintaan tersebut melalui jalur yang berlaku. Riwayat menggunakan maksimal 50 transaksi terakhir dari gateway. Angka ringkasan berasal dari data tersebut.
- **Transport.** Uji kontrak lokal tidak membuktikan deployment Google milik instansi. Uji pada tabel di atas diperlukan sebelum memakai hasil ini sebagai bukti integrasi lapangan.

Dokumentasi platform: [Apps Script terikat ke spreadsheet](https://developers.google.com/apps-script/guides/bound), [pengalihan Content Service](https://developers.google.com/apps-script/guides/content), [sumber publikasi GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
