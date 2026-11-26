# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run build:owner`

Builds the **Owner mode** bundle (`REACT_APP_OWNER_MODE=1`) into the same `build`
folder. The Owner build reuses the exact same backend, database, and codebase as
the operational app; it only restricts the UI to the read-only monitoring pages.
See [Mode Owner (APK Pemilik)](#mode-owner-apk-pemilik) below.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

## Cetak langsung via Bluetooth

Utilitas `src/lib/bluetoothThermalPrinter.js` mengirim struk kitchen/payment dalam perintah ESC/POS langsung ke printer, tanpa `window.print()`.

Transport printer dipilih otomatis lewat `src/lib/printerTransport.js`: **Web Bluetooth** saat berjalan di browser (`src/lib/transports/webBluetoothTransport.js`) dan **Bluetooth native** saat berjalan sebagai aplikasi Android lewat plugin `@capacitor-community/bluetooth-le` (`src/lib/transports/nativeBluetoothTransport.js`). Alur cetak, antrean/retry, ESC/POS builder, dan pesan error tetap sama di kedua platform.

Web Bluetooth memerlukan browser yang mendukungnya (umumnya Chrome/Edge) dan halaman HTTPS atau localhost. Dialog pemilihan perangkat **hanya** muncul saat pairing awal dari menu Pengaturan Printer (Dapur/Kasir); identitas perangkat disimpan di `localStorage` (`babba_printer_kitchen` / `babba_printer_cashier`) sebagai record `{ v, t, id, name }` (format string lama tetap terbaca sebagai perangkat web). Semua cetak otomatis berikutnya mencari perangkat tanpa memunculkan picker lagi; jika perangkat tersimpan tidak ditemukan, modul menampilkan pesan agar pengguna menghubungkan ulang melalui Pengaturan Printer. Cetak ke Dapur dan Kasir diantrekan berurutan dengan jeda singkat, dan koneksi ditutup setelah tiap dokumen agar kedua printer tidak bentrok. Setelah save berhasil, tiket dapur otomatis mencetak hanya item baru yang belum `is_printed`. Dialog dapur juga memisahkan cetak item baru dari tombol **Cetak Ulang Item Tercetak**; penanda DUPLIKAT hanya dipakai untuk cetak ulang manual. Default layanan RPP02 adalah UUID `000018f0-0000-1000-8000-00805f9b34fb`, dengan karakteristik tulis `00002af1-0000-1000-8000-00805f9b34fb`. Tombol Tutup Shift otomatis mencetak laporan thermal ke printer kasir; bila printer belum diatur, laporan tetap tersimpan dan kegagalan cetak ditampilkan. Riwayat Shift menyediakan cetak ulang Bluetooth bertanda **CETAK ULANG**. Header waktu struk memakai waktu awal pesanan (`orderTime`/`createdAt`); bagian terbayar memakai waktu pembayaran (`paidAt`). Nomor urut dicetak dari `queueNumber`, metode pembayaran mengikuti transaksi, dan baris kembalian hanya dicetak untuk Cash/Tunai. Data `kitchen` menerima detail pesanan dan `items`/`items_json`; `payment` menerima detail transaksi, `items`/`items_json`, `total`, dan `profile` (`nama_usaha`, `alamat`, `kota`, `telepon`, `logo_url`). Logo dimuat melalui canvas; server logo lintas-origin harus mengizinkan CORS agar bisa dicetak, jika tidak struk tetap dicetak tanpa logo. `bill` mencetak open bill yang belum lunas melalui Bluetooth.

Untuk build Android, jalankan `npx cap sync android` setelah `npm install` agar plugin Bluetooth LE terdaftar. `android/app/src/main/AndroidManifest.xml` sudah memuat izin `BLUETOOTH_SCAN` (dengan `neverForLocation`), `BLUETOOTH_CONNECT`, serta izin lama `BLUETOOTH`/`BLUETOOTH_ADMIN`/`ACCESS_FINE_LOCATION` (`maxSdkVersion="30"`) untuk Android 11 ke bawah.

## Login POS nama dan PIN

Frontend ini memakai Create React App (`react-scripts` melalui CRACO), jadi nama variabel browser harus diawali `REACT_APP_` — bukan `NEXT_PUBLIC_`. File `.env` harus berada di folder `frontend`, sejajar dengan `package.json`. Salin template dari folder `frontend`:

```powershell
Copy-Item .env.example .env
```

Isi `frontend/.env` dengan URL project dan anon/publishable key dari Supabase Dashboard -> Project Settings -> API, serta alamat backend POS:

```dotenv
REACT_APP_BACKEND_URL=http://localhost:8001
REACT_APP_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
REACT_APP_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

`REACT_APP_BACKEND_URL` adalah origin backend tanpa akhiran `/api` (contoh lokal di atas memakai port yang digunakan tes backend proyek ini). Pastikan backend benar-benar berjalan pada alamat tersebut. Jika backend berada di port/host lain, gunakan alamat yang sesuai. Simpan `.env` di `frontend/.env`, bukan di root repository. Setelah mengubahnya, hentikan dan jalankan ulang dev server (`npm start`); CRA hanya membaca environment ketika proses dimulai.

Untuk deployment Vercel, atur `REACT_APP_BACKEND_URL` di **Project Settings -> Environment Variables** ke origin backend produksi (tanpa `/api` dan bukan `localhost`), untuk environment Production dan Preview sesuai kebutuhan. Perubahan environment memerlukan deployment ulang karena CRA menyematkan nilainya ke bundle saat build. Frontend pada host publik akan menolak konfigurasi backend `localhost` dan menampilkan pesan konfigurasi alih-alih mengirim request ke komputer pengguna.

Login POS menampilkan grid pengguna dari `GET /api/auth/users`. Setelah pengguna dipilih, frontend mengirim ID pengguna dan PIN 4-6 digit ke `POST /api/auth/login`. Backend memverifikasi PIN terhadap hash bcrypt dan mengembalikan token serta data pengguna. Token disimpan di `localStorage` dan dikirim untuk otorisasi request POS; pemeriksaan akses tetap dilakukan backend. `POST /api/login` juga tersedia untuk klien yang mengirim nama dan PIN.

Menu **Daftar Akun** mengambil data Chart of Accounts dari `GET /api/finance/account-balances` melalui backend FastAPI. Endpoint khusus admin ini membaca kode, nama, kategori, dan `current_balance` dari tabel `chart_of_accounts`, mengurutkan berdasarkan kode akun, dan menampilkan saldo dalam Rupiah. Backend mengonversi nilai saldo ke `Decimal` dan mengembalikan `current_balance` (serta alias `saldo_terupdate` untuk kompatibilitas klien lama). Kesalahan query atau konversi dicatat oleh logger backend dan dilemparkan, bukan diganti diam-diam dengan nol.

Variabel Supabase di atas masih digunakan fitur POS lain yang memanggil RPC Supabase, tetapi tidak diperlukan untuk login. Nilai anon/publishable key memang digunakan di browser; keamanan database harus ditegakkan dengan RLS. Jangan pernah gunakan `service_role` key di frontend. Pembacaan akuntansi dilakukan backend melalui koneksi PostgreSQL server-side (`DATABASE_URL`), bukan SDK Supabase browser. Jika koneksi database tidak dapat membaca tabel/view yang dibutuhkan, gunakan kredensial database backend yang memang berwenang dan tinjau grant/RLS di Supabase; jangan mengekspos service-role key pada bundle klien.

Contoh client yang dipakai proyek:

```js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);
```

Nama, peran, dan PIN pengguna POS dikelola melalui menu **Pengguna & PIN** oleh admin. Password Supabase Auth dan akun yang dibuat lewat [`admin-scripts/provision_users.js`](../admin-scripts/provision_users.js) tidak digunakan untuk login POS.

## Sistem Akuntansi & Laporan Keuangan

Menu keuangan hanya ditampilkan untuk role POS `admin`. Route dan endpoint keuangan memverifikasi role dari sesi backend POS; akses non-admin ke halaman keuangan dialihkan ke `/pos` dengan pesan **Akses Ditolak**. Halaman **Dashboard & Laporan Posisi Keuangan (Neraca)** menampilkan saldo akhir kumulatif (ending balance) dari awal usaha hingga tanggal akhir filter melalui `GET /api/v1/finance/position-summary?end_date=YYYY-MM-DD`; laba berjalan kumulatif (pendapatan − beban) dimasukkan ke ekuitas sehingga Aset = Liabilitas + Ekuitas. Ringkasan view kas tetap tersedia di `GET /api/v1/finance/dashboard-summary`, dan halaman finance lain menggunakan endpoint `/api/finance/*`. Tombol **Download PDF** mengekspor ringkasan neraca beserta tabel riwayat jurnal menggunakan `jsPDF` + `jspdf-autotable` ([`src/lib/financePositionPdf.js`](src/lib/financePositionPdf.js)). Login POS saat ini tidak membuat sesi Supabase Auth, sehingga operasi akuntansi menggunakan API backend dan koneksi PostgreSQL server-side (bukan anon key di browser).

Terapkan skema akuntansi dan posting transaksi dengan menjalankan `alembic upgrade head` dari folder `backend`. Jika memakai Supabase SQL Editor, jalankan [`backend/supabase/migrate_finance_module.sql`](../backend/supabase/migrate_finance_module.sql), [`backend/supabase/migrate_finance_postings.sql`](../backend/supabase/migrate_finance_postings.sql), lalu [`backend/supabase/migrate_general_ledger_account_name_fallback.sql`](../backend/supabase/migrate_general_ledger_account_name_fallback.sql), berurutan. Migrasi posting mengisi buku besar dari transaksi penjualan, pembelian, dan pengeluaran yang sudah ada; penjualan tunai dipasangkan ke akun Kas Tunai `1-10001` dan Pendapatan `4-40000`, termasuk UUID akun dari `chart_of_accounts`. Trigger di migrasi terakhir mengisi nama akun dari kode atau ID chart of accounts jika pemanggil mengirim nilai kosong, dan memiliki fallback untuk akun kas/pendapatan POS. Jika migrasi ini sudah pernah dijalankan, jalankan ulang setelah perubahan agar fungsi trigger diperbarui. Pastikan semua kode akun yang digunakan tersedia di chart of accounts; data baru akan diposting otomatis saat transaksi disimpan. Tabel dan view keuangan menolak akses langsung dari role `anon`/`authenticated`; backend POS membaca dan menulisnya setelah validasi role admin.

Jurnal harus berisi sedikitnya dua baris, setiap baris hanya debit atau kredit, dan jumlah debit harus sama dengan jumlah kredit. Dashboard kas dan neraca dapat diperbarui melalui tombol **Perbarui**; laporan laba rugi dapat diekspor sebagai Excel atau dicetak ke PDF.

## Mode Owner (APK Pemilik)

Mode Owner adalah varian aplikasi **baca-saja** untuk pemilik. Varian ini memakai
**backend, database, dan basis kode yang sama** dengan aplikasi POS operasional —
tidak ada endpoint, tabel, atau alur data baru. Yang berbeda hanyalah tampilan:
sidebar dan rute disaring sehingga hanya halaman pantauan/laporan yang tersedia,
dan seluruh halaman tersebut tidak memiliki aksi ubah data.

### Mengaktifkan Mode Owner

Mode dipilih saat **build** melalui variabel `REACT_APP_OWNER_MODE`:

```dotenv
REACT_APP_OWNER_MODE=1
```

Bila variabel ini kosong (default), aplikasi berjalan sebagai POS operasional
seperti biasa. Penanda mode dibaca modul [`src/lib/appMode.js`](src/lib/appMode.js).

Perilaku saat Mode Owner aktif (hanya bila `user.role === "admin"`):

- Login langsung diarahkan ke halaman **Pantauan Pemilik** (`/owner`) **tanpa
  dipaksa membuka shift kasir** (akun `admin` memang sudah melewati `ShiftGate`).
- Sidebar diganti daftar baca-saja (`OWNER_MODE_GROUPS`) sehingga tidak ada menu
  kasir, meja, open bill, pengeluaran, jurnal, pengguna, atau promo.
- Rute di luar daftar baca-saja (`OWNER_MODE_ALLOWED_PATHS`) dialihkan kembali ke
  `/owner`.
- Akun non-pemilik yang masuk pada build Owner ditolak dengan layar
  “Aplikasi ini hanya untuk Pemilik”.
- Tombol pengaturan printer disembunyikan (tidak relevan untuk pemantauan).

### Akun khusus Pemilik

Akun Owner adalah akun POS biasa dengan peran **admin**, dibuat dari menu
**Pengguna & PIN** (`POST /api/users`) memakai **nama dan PIN sendiri**, mis.
nama `Pemilik` dan PIN 6 digit yang tidak dipakai akun lain. Tidak ada tabel atau
alur autentikasi baru, sehingga pengecekan izin tetap konsisten dengan aplikasi
operasional.

### Bagian pantauan (baca-saja)

Halaman `/owner` membaca satu endpoint agregat baca-saja
`GET /api/reports/owner-monitor` (`backend/reports.py`) berisi lima bagian:

| # | Bagian | Isi |
|---|--------|-----|
| 1 | **Omzet** | Total omzet, jumlah nota, total item, rata-rata per nota. Filter **Bulan** / **Tanggal**. |
| 2 | **Total Open Bill** | Jumlah dan nilai total open bill aktif beserta daftar bill. |
| 3 | **Stok Bahan** | Jumlah bahan, bahan menipis, nilai persediaan, dan daftar stok. |
| 4 | **Shift Aktif** | Per pelayan: **Nama Pelayan**, **Total Item Terjual**, **Total Void**, **Penggunaan Promo**, **Redeem Point**. |
| 5 | **Laporan Laba-Rugi** | **Total Pendapatan**, **Potongan Penjualan**, **HPP**, **Total Beban**, **Laba Bersih**. Filter **Bulan** / **Tanggal**. |

Endpoint ini hanya menjalankan operasi baca (`find`) dan **tidak** menulis ke
database; perilaku tersebut dikunci oleh [`backend/tests/test_owner_readonly.py`](../backend/tests/test_owner_readonly.py)
dan [`src/lib/ownerData.test.js`](src/lib/ownerData.test.js).

### Membangun APK Android Mode Owner

APK Owner dibangun dari basis kode yang sama dan memakai backend/database yang
sama. Langkah lengkap dari folder `frontend`:

```powershell
# 1. Build bundle Mode Owner (REACT_APP_OWNER_MODE=1)
npm run build:owner

# 2. Sinkronkan aset web + tulis nama aplikasi "Warkop Babba POS — Owner"
#    (nama Owner DIBIARKAN tertulis di strings.xml agar APK ikut berlabel Owner)
npm run cap:sync:owner

# 3. Build APK
cd android
.\gradlew assembleRelease        # atau assembleDebug untuk APK uji

# 4. Setelah APK Owner selesai, kembalikan nama operasional
cd ..
npm run cap:sync:owner -- --restore
```

Hasil APK:

- Rilis: `android/app/build/outputs/apk/release/app-release-unsigned.apk`
- Uji: `android/app/build/outputs/apk/debug/app-debug.apk`

Skrip `scripts/build-owner.js` hanya menyalakan `REACT_APP_OWNER_MODE=1` di
lingkungan build lalu memanggil `craco build`, sehingga bundle web benar-benar
memuat Mode Owner (bukan `undefined`/`false`). Skrip `scripts/cap-sync-owner.js`
menulis `app_name`/`title_activity_main` di
`android/app/src/main/res/values/strings.xml` menjadi nama Owner, menjalankan
`npx cap sync android`, dan **membiarkan nama Owner tertulis** (persisten) supaya
APK hasil `gradlew assembleRelease` benar-benar berlabel Owner.

Pilihan argumen `cap:sync:owner`:

- `-- --label "Nama Lain"` → pakai nama aplikasi khusus.
- `-- --restore` → kembalikan `strings.xml` ke nama operasional (tanpa sync).
- `-- --temporary` → perilaku lama (nama diganti saat sync lalu dikembalikan).

Agar APK Owner mudah dibedakan dari APK operasional, gunakan salah satu cara:

- Nama launcher lewat label pada langkah 2 di atas, dan/atau
- `applicationId` khusus (mis. `com.warkopbabba.pos.owner`) pada
  `android/app/build.gradle` bila kedua APK perlu terpasang berdampingan di
  perangkat yang sama, dan/atau
- Naikkan `versionCode` setiap kali `versionName` berubah (sumber versi ada di
  `android/app/build.gradle` `defaultConfig`).
