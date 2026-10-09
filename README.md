# Simulator Praktikum Gayaberat

Simulator akuisisi data gayaberat untuk Praktikum Metode Gayaberat dan Magnetik (Modul 1: Pengenalan CG-5 dan Akuisisi Metode Gayaberat). Mahasiswa bisa berlatih memakai alat sebelum turun ke lapangan. Data hasil simulasi bisa langsung dipakai untuk Modul 2 (Pengolahan Data Gayaberat).

Cara membuka: klik dua kali `index.html` (Edge atau Chrome). Tidak perlu internet atau server.

## Dipakai bersama lewat Wi-Fi (laptop & HP)

1. Klik dua kali **`Jalankan Server.bat`** (perlu Python). Jendela server menampilkan alamat seperti `http://10.4.206.105:8000/` dan kode QR, lalu membuka halaman QR di laptop ini.
2. Laptop atau HP lain yang terhubung ke **Wi-Fi yang sama** cukup memindai QR atau mengetik alamat itu di browser.
3. Bila Windows Firewall bertanya, izinkan untuk **Private networks**.
4. Biarkan jendela server terbuka selama simulator dipakai. Tekan Ctrl+C atau tutup jendela untuk berhenti.

Catatan:
- Wi-Fi kampus atau publik kadang memblokir koneksi antarperangkat (client isolation). Bila HP tidak bisa membuka alamatnya, pakai hotspot dari HP atau laptop.
- IP bisa berubah setiap kali terhubung ulang ke Wi-Fi; alamat terbaru selalu tampil di jendela server.
- Data tetap tersimpan di browser masing-masing perangkat.
- **Gyro di HP perlu HTTPS.** Browser hanya memberi data sensor gerak ke halaman `https://` atau `localhost`; lewat `http://IP:8000` API-nya tidak tersedia sama sekali. Jalankan **`Jalankan Server HTTPS.bat`** dan buka alamat `https://IP:8443/`.
  - Sertifikatnya dibuat otomatis (self-signed, disimpan di folder `.cert`), jadi browser memberi peringatan sekali. Di Chrome: **Lanjutan → Lanjutkan ke … (tidak aman)**. Di Safari: **Tampilkan Detail → kunjungi situs web ini**.
  - Setelah itu tekan **Aktifkan sensor gerak**. Di iPhone, browser akan meminta izin "Motion & Orientation".
  - Server HTTP dan HTTPS boleh berjalan bersamaan.

## Sumber acuan

- **CG-5 Operation Manual**, Scintrex part 867700 Rev. 8 (2012): konsol, menu, leveling, pengukuran, format dump, dan file raw `*.smp`.
- **SOP Gravimeter lab**: urutan kerja CG-5, tinggi alat, dan ikon senyum saat level.
- **File dump asli alat lab** (`CG-5_KALCG5_100924.TXT`, S/N 41223): format baris dan parameter alat (Gcal1, tilt, Drift). Format baris hasil simulator sama persis dengan file ini (diuji pada 50/50 baris).
- **Instruction Manual Model G & D Gravity Meters**, LaCoste & Romberg (3-2001): tata letak tutup alat, garis baca, cara membaca counter dan dial, arrestment, serta tabel kalibrasi.
- **USGS Techniques and Methods 2-D4** dan panduan praktikum Univ. Edinburgh: urutan leveling, kaki referensi, pendekatan dial dari bawah, dan backlash.

## Isi folder

| File | Isi |
|---|---|
| `index.html` | Beranda untuk memilih alat |
| `cg5.html` | Simulator **Scintrex CG-5 Autograv** |
| `lacoste.html` | Simulator **LaCoste & Romberg Model G** |
| `css/sim.css` | Tampilan bersama |
| `js/core.js` | Model fisika: skenario, peta buatan sendiri, gayaberat normal, pasang surut Longman, ekspor Excel |
| `js/field.js` | Kerangka bersama: jam, peta, tinggi alat, buku lapangan, panduan, kunci asisten |
| `js/cg5.js` | Konsol, layar, dan cara kerja CG-5 |
| `js/lacoste.js` | Tutup alat, okuler, dial, dan tabel kalibrasi LaCoste |
| `img/logo.png` | Logo lab |

## Memulai

1. Isi **kode skenario** kelompok (mis. `GPA-K1`). Kode yang sama selalu menghasilkan benda anomali, densitas, dan kondisi titik yang sama.
2. Pilih **mode**:
   - **Latihan**: panduan langkah dan peringatan ditampilkan.
   - **Ujian**: tanpa panduan dan tanpa peringatan; kesalahan tetap dicatat untuk asisten.
3. Pilih **waktu**:
   - **Ikuti jam perangkat (waktu nyata)**, pilihan bawaan. Jam, tanggal, dan zona waktu (WIB/WITA/WIT) mengikuti laptop/HP. Pembacaan CG-5 berjalan 1:1 dengan waktu nyata: Read Time 60 s dengan 3 cycle berarti ±3,5 menit sungguhan. Perpindahan stasiun berlangsung langsung tanpa memajukan jam, dan tombol Tunggu disembunyikan; untuk mengamati apungan, tunggu sungguhan. Pasang surut dan apungan dihitung pada jam sebenarnya. Bila sesi dibuka lagi esok hari, jam ikut melompat seperti di dunia nyata. Jam alat CG-5 mengikuti zona perangkat, jadi GMT Diff = −7 (WIB), −8 (WITA), atau −9 (WIT).
   - **Atur tanggal & jam sendiri** (WIB). Perjalanan dan tombol Tunggu memajukan jam, dan pembacaan CG-5 dipercepat.
4. Pilih **peta pengukuran**:
   - **Otomatis**: Base Station + S01–S15, jarak 100 m.
   - **Buat sendiri**: tempel daftar stasiun dari Excel (blok kolom, Ctrl+C, lalu Ctrl+V di kotak) atau unggah CSV. Kolom: `ID, Lintang, Bujur, Elevasi`. Elevasi boleh kosong; nilainya diisi dari stasiun terdekat. Stasiun ber-ID `BS` menjadi base; bila tidak ada, baris pertama. Desimal koma juga terbaca. Tombol **Unduh template** memberi contoh berkas Excel. Maksimal 60 stasiun.

Di lapangan, klik titik di peta untuk berpindah. Jarak sampai 800 m ditempuh dengan berjalan; lebih jauh dari itu dengan kendaraan. Di setiap titik, tekan **Ukur dengan meteran** untuk mencatat tinggi alat (SOP langkah 2). Tinggi alat memengaruhi bacaan dan ikut tercatat di buku lapangan. Akhiri survei dengan kembali ke **BS** (looping).

Jam simulasi berjalan seperti jam biasa selama halaman terbuka. Tombol **Tunggu** dipakai untuk mengamati apungan. Data tersimpan di browser masing-masing; **Mulai ulang** menghapus sesi.

## CG-5 Autograv

**Konsol** mengikuti foto di manual (Fig. 1-10): ON/OFF dan N/S/E/W di kiri, F1–F5 di kanan layar, tombol angka 1–0 (SETUP, RECALL, DISPLAY, INFO, NOTE, ESC), ENTER, • (HELP), MEASURE/CLR, dan panah.

Urutan kerja (SOP lab + manual):

1. **ON/OFF** → SETUP MENU (ikon Survey, Autograv, Options, Clock, Dump, Memory, Service).
2. **Survey** → F5. Tekan **F3** untuk mode EDIT. Isi SurveyID (F2 = CLEAR ALL), Customer, Operator, Latitude, Longitude, dan GMT Diff.
   - Angka ditutup dengan tombol arah, mis. `6.235` lalu **S**.
   - GMT Diff untuk WIB = **−7**: titik di timur Greenwich bernilai negatif, sesuai manual.
   - Teks diketik dengan tombol huruf yang ditekan berulang (2 → 2, d, e, f) atau dengan papan ketik komputer.
   - F1 PARAMS memilih sistem stasiun: NSEWm, XYm, atau LAT/LONG.
3. **Autograv**: Tide Correct., Cont.Tilt.Corr, Auto Reject, Terrain Corr., Seismic Filter, Save Raw Data → F5 RECORD. F1 NEXT PAGE menampilkan parameter alat (Gcal1, TiltX/Y Sens/Offs, Tempco, Drift). Manual melarang mengubahnya; bila diubah, efeknya ikut disimulasikan dan dicatat sebagai kesalahan.
4. **Options**: Read Time, #Of Cycles, Start Delay, Line/Station separation, Auto station inc., Measurement (NUMERIC/GRAPHIC), FINAL KEY.
5. **MEASURE/CLR** → STATION DESIGNATION: isi Station/Line (atau Longit./Latit./Line ID untuk LAT/LONG) dan Elevation → **F5 LEVEL**.
6. **LEVELING**: putar sekrup kaki **F** (sumbu Y) lalu **L/R** (sumbu X) mengikuti ikon arah di pojok layar. Garis silang bergerak mengikuti kemiringan. **Ikon senyum** muncul saat |X| dan |Y| ≤ 10″ (SOP: idealnya −2 sampai 2).
7. **F5 READ GRAV** → layar NUMERIC (lima bacaan sebelumnya, angka besar, Err/SD, Tilt, Temperature) atau GRAPHIC (grafik 6 Hz, SCALE). F5 STOP menghentikan pembacaan.
8. **F5 FINAL DATA** (kolom Preceding/Current: Grav., S.D., TiltX/Y, Temp., E.T.C., Dur., #Rej., Time, Line, Stat.) → **F5 RECORD** atau F4 CANCEL. Bila #Of Cycles > 1, setiap siklus langsung tersimpan seperti mode auto-repeat.
9. SETUP → **Dump**: F1/F2 = data final `.TXT`, F4 = data mentah `.SMP`.

Tombol lain: **RECALL** (5) untuk parameter survei, daftar data per line, dan plot profil; **INFO** (7) untuk info sistem; **HELP** (•) untuk bantuan berbahasa Indonesia; **DISPLAY** (6) untuk kontras; **NOTE** (8) untuk catatan pada record berikutnya; **Memory** → CLEAR MEMORY (konfirmasi 9/5); **Clock** untuk jam alat. Bila jam alat diatur ke UTC, GMT Diff harus 0. GPS tidak terpasang, sehingga READ GPS dan CHECK GPS menampilkan "GPS NOT CONNECTED"; koordinat diambil dari GPS genggam di panel stasiun.

### Output data CG-5

- **`.TXT` (DUMP DATA)**: sama dengan dump asli. Berisi header SURVEY / SETUP PARAMETERS / OPTIONS, blok `Line`, dan kolom LAT, LONG (atau STATION), ALT., GRAV., SD., TILTX, TILTY, TEMP, TIDE, DUR, REJ, TIME, DEC.TIME+DATE, TERRAIN, DATE.
  - Sistem stasiun default **LAT/LONG**, seperti dump alat lab (KALCG5, BIG, PATGL).
  - Setiap kali **Line ID berganti**, alat menulis blok baru: baris `Line	   1.000S` (angka lebar 8) disusul kepala kolom. Karena itu beri Line ID berbeda untuk tiap stasiun (mis. BS = 9000, S01 = 1, S02 = 2). Kembali ke BS dengan Line ID 9000 juga membuka blok baru, sama seperti file asli.
  - Sesi yang dibuat sebelum perubahan ini masih memakai NSEWm. Ganti lewat Survey → F1 PARAMS → LAT/LONG, atau tekan **Mulai ulang**.
- **`.SMP` (DUMP RAW)**: sampel mentah **6 Hz** dalam satuan A/D, empat kolom: grav, tilt X, tilt Y, temp. Rumus konversi mengikuti manual hal. 3-49/3-50 dan tertulis di kepala file. Hanya tersedia untuk bacaan yang diambil dengan **Save Raw Data = YES**.
- **Excel**: sheet Buku Lapangan, Stasiun, Info, dan sheet **Raw 6 Hz** (sampel mentah beserta nilai terkonversi) bila ada data raw.

Yang disimulasikan: pasang surut (Longman) dan koreksi alat dari lintang/bujur/GMT Diff/jam alat, sisa apungan setelah koreksi Drift, kemiringan dan koreksi tilt, noise per titik dengan lonjakan (Auto Reject 4σ, atau 6σ bila Seismic Filter), suhu, dan tinggi alat.

## LaCoste & Romberg Model G

Tutup alat digambar sesuai diagram manual: tiga kenop kaki (kaki referensi, CROSS LEVEL ADJ., LONG LEVEL ADJ.), level panjang dan level silang, plakat **READING LINE 2.3**, nulling dial, counter, eyepiece, arrestment, sakelar lampu, termometer, dan lampu pemanas.

1. Nyalakan **lampu baca & level**.
2. Pusatkan **level silang** dulu (CROSS LEVEL ADJ. juga menggeser level panjang), lalu **level panjang** (LONG LEVEL ADJ.). Jangan memutar **kaki referensi**.
3. Ukur **tinggi alat**.
4. Buka kunci: putar **ARRESTMENT berlawanan jarum jam** sampai mentok.
5. Lihat okuler. Putar nulling dial **searah jarum jam** (benang bergerak ke kanan) sampai **sisi kiri benang** tepat di garis baca 2.3. Benang bergerak lambat karena periodenya panjang. Bila terlewat, putar balik ±¼ putaran lalu dekati lagi dari kiri; pendekatan dari arah sebaliknya memberi kesalahan backlash.
6. Baca counter dan dial:
   - 4 digit pertama counter = satuan.
   - Digit ke-5 (merah) = persepuluhan, dan harus sama dengan angka dial di bawah segitiga.
   - Garis kecil dial = perseratusan.
   - Contoh: counter `1523`**`4`** dan dial lewat 4 garis 7 → **1523.47**.
   - Cek level lagi, lalu tulis bacaan di buku lapangan.
7. Kunci: putar **ARRESTMENT searah jarum jam** ±3 putaran. Memindah alat dengan beam terbuka menimbulkan **tare** dan menaikkan apungan.
8. Ubah ke mGal dengan **tabel kalibrasi**: mGal = Value in Milligals + (bacaan − Counter Reading) × Factor for Interval.

1 putaran dial ≈ 1 mGal dan menggeser benang sekitar 10 garis kecil. Gerak benang dibatasi stop (14 garis). Saat beam terkunci, benang ada di stop bawah (kiri). Kemiringan level panjang mengubah kepekaan. Alat yang terlalu miring membuat beam menggesek. Alat **G-1036** dan tabel kalibrasinya **fiktif**; bacaan di lintang Jakarta ±1490, sesuai tabel perkiraan di manual.

## Getaran dari sentuhan laptop dan sensor gerak (gyro)

Panel **Gangguan & sensor** ada di bawah info stasiun.

- **Sentuhan laptop = getaran** (aktif sebagai bawaan). Setiap gerakan touchpad/mouse, klik, ketikan, gulir, atau sentuhan layar *di luar panel alat* dianggap menyenggol alat. Klik dan ketik pada panel alat tidak dihitung, begitu juga klik READ GRAV.
  - **CG-5** yang sedang membaca mendapat osilasi teredam pada sinyal 6 Hz: SD naik, REJ bertambah (Auto Reject membuang detik yang terganggu), dan tripod bisa sedikit miring. Gangguan ini ikut tersimpan di data raw `.SMP` dan dicatat sebagai kesalahan prosedur.
  - **LaCoste** dengan beam terbuka: benang tersentak dan butuh waktu untuk tenang kembali. Senggolan keras menggeser gelembung level.
  - Bilah warna menunjukkan tingkat getaran.
- **Sensor gerak (gyro)**: tekan *Aktifkan sensor gerak*. Di perangkat bersensor (HP, tablet, laptop 2-in-1), memiringkan perangkat 1° memiringkan alat 40″. Layar LEVELING CG-5 dan gelembung LaCoste bergerak mengikuti, dan guncangan perangkat menjadi getaran. Tombol **Nolkan** menjadikan posisi perangkat sekarang sebagai datar.
  - Laptop biasa umumnya tidak punya sensor ini; panel akan menampilkan "Sensor tidak ditemukan".
  - Di iPhone/iPad, browser meminta izin terlebih dulu.
  - Browser hanya memberi data sensor pada halaman yang dianggap aman. Bila sensor tidak terbaca di HP, buka folder simulator dari hosting `https://`.

## Kunci asisten

Tombol **Kunci asisten** meminta PIN asisten (tanyakan ke koordinator lab). Di kode hanya tersimpan hash SHA-256-nya (`PIN_HASH` di `js/field.js`), karena kode ini publik di GitHub. Untuk mengganti PIN, hitung hash PIN baru (`printf 'PIN_BARU' | sha256sum` di Git Bash) lalu tempel ke `PIN_HASH`.

Isi kunci:
- model lapangan;
- nilai benar per stasiun (g absolut, anomali udara bebas, anomali Bouguer sederhana, efek benda);
- pemeriksaan tiap bacaan dibanding bacaan ideal;
- daftar kesalahan prosedur.

Kunci juga bisa diunduh sebagai Excel.

## Model fisika (ringkas)

- g = γ(φ) − 0,3086·h + 0,04193·ρ·h + anomali latar + regional + efek benda. γ memakai GRS80; ρ antara 2,10–2,60 g/cc per skenario.
- Bacaan alat dikurangi 0,3086 × tinggi alat.
- Benda: bola padat, silinder horizontal bermassa rendah, atau patahan. Ukurannya diskalakan dengan panjang lintasan (juga untuk peta buatan sendiri) sehingga efeknya sekitar 0,5–1,5 mGal.
- Pasang surut: Longman (1959), sekitar ±0,15 mGal di lintang Jakarta.

## Batasan

- Menu Service, terrain correction (Hammer), GPS, dan RF remote CG-5 tidak disimulasikan.
- Format blok NSEWm/XYm pada dump disusun mengikuti pola LAT/LONG dari file asli.
- Koordinat LAT/LONG di CG-5 diisi dalam derajat desimal.
- Kolom per baris file `.SMP` asli tidak didokumentasikan di manual. Simulator menulis empat kolom sesuai urutan dan rumus di manual, dengan kepala berkomentar `/`.
