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

Utilitas `src/lib/bluetoothThermalPrinter.js` mengirim struk kitchen/payment dalam perintah ESC/POS langsung ke printer, tanpa `window.print()`. Tombol contoh tersedia di `src/components/BluetoothReceiptButton.jsx`.

Web Bluetooth memerlukan browser yang mendukungnya (umumnya Chrome/Edge) dan halaman HTTPS atau localhost. Pemilihan perangkat dan koneksi GATT dimulai langsung dari klik pengguna; setelah printer tersambung, perangkat disimpan di memori halaman dan koneksi dapat dipakai ulang lintas role. Simpan order meminta izin/pilihan printer bila belum dipilih; setelah save berhasil, tiket dapur otomatis mencetak hanya item baru yang belum `is_printed`. Dialog dapur juga memisahkan cetak item baru dari tombol **Cetak Ulang Item Tercetak**; penanda DUPLIKAT hanya dipakai untuk cetak ulang manual. Bila koneksi putus, modul mencoba menyambungkan ulang perangkat yang sama. Default layanan RPP02 adalah UUID `000018f0-0000-1000-8000-00805f9b34fb`, dengan karakteristik tulis `00002af1-0000-1000-8000-00805f9b34fb`; jika printer memakai UUID lain, berikan `serviceUuid` dan `characteristicUuid` ke komponen. Tombol Tutup Shift otomatis mencetak laporan thermal jika printer kasir sudah terhubung; bila terputus, laporan tetap tersimpan dan kegagalan cetak ditampilkan. Riwayat Shift menyediakan cetak ulang Bluetooth bertanda **CETAK ULANG**. Header waktu struk memakai waktu awal pesanan (`orderTime`/`createdAt`); bagian terbayar memakai waktu pembayaran (`paidAt`). Nomor urut dicetak dari `queueNumber`, metode pembayaran mengikuti transaksi, dan baris kembalian hanya dicetak untuk Cash/Tunai. Data `kitchen` menerima detail pesanan dan `items`/`items_json`; `payment` menerima detail transaksi, `items`/`items_json`, `total`, dan `profile` (`nama_usaha`, `alamat`, `kota`, `telepon`, `logo_url`). Logo dimuat melalui canvas; server logo lintas-origin harus mengizinkan CORS agar bisa dicetak, jika tidak struk tetap dicetak tanpa logo. `bill` mencetak open bill yang belum lunas melalui Bluetooth.

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

Menu **Daftar Akun** mengambil data Chart of Accounts dari `GET /api/finance/account-balances` melalui backend FastAPI. Endpoint khusus admin ini membaca kode, nama, kategori, dan `saldo_terupdate` dari tabel `chart_of_accounts`, mengurutkan berdasarkan kode akun, dan menampilkan saldo dalam Rupiah. Endpoint ini hanya membaca saldo tersimpan; pembaruan saldo tetap mengikuti alur transaksi dan trigger database yang sudah ada.

Variabel Supabase di atas masih digunakan fitur POS lain yang memanggil RPC Supabase, tetapi tidak diperlukan untuk login. Nilai anon/publishable key memang digunakan di browser; keamanan database harus ditegakkan dengan RLS. Jangan pernah gunakan `service_role` key di frontend.

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

Menu keuangan hanya ditampilkan untuk role POS `admin`. Route dan endpoint keuangan memverifikasi role dari sesi backend POS; akses non-admin ke halaman keuangan dialihkan ke `/pos` dengan pesan **Akses Ditolak**. Dashboard gabungan kas dan neraca mengambil ringkasan dari `GET /api/v1/finance/dashboard-summary`; halaman finance lain menggunakan endpoint `/api/finance/*`. Login POS saat ini tidak membuat sesi Supabase Auth, sehingga operasi akuntansi menggunakan API backend dan koneksi PostgreSQL server-side (bukan anon key di browser).

Terapkan skema akuntansi dan posting transaksi dengan menjalankan `alembic upgrade head` dari folder `backend`. Jika memakai Supabase SQL Editor, jalankan [`backend/supabase/migrate_finance_module.sql`](../backend/supabase/migrate_finance_module.sql), [`backend/supabase/migrate_finance_postings.sql`](../backend/supabase/migrate_finance_postings.sql), lalu [`backend/supabase/migrate_general_ledger_account_name_fallback.sql`](../backend/supabase/migrate_general_ledger_account_name_fallback.sql), berurutan. Migrasi posting mengisi buku besar dari transaksi penjualan, pembelian, dan pengeluaran yang sudah ada; penjualan tunai dipasangkan ke akun Kas Tunai `1-10001` dan Pendapatan `4-40000`, termasuk UUID akun dari `chart_of_accounts`. Trigger di migrasi terakhir mengisi nama akun dari kode atau ID chart of accounts jika pemanggil mengirim nilai kosong, dan memiliki fallback untuk akun kas/pendapatan POS. Jika migrasi ini sudah pernah dijalankan, jalankan ulang setelah perubahan agar fungsi trigger diperbarui. Pastikan semua kode akun yang digunakan tersedia di chart of accounts; data baru akan diposting otomatis saat transaksi disimpan. Tabel dan view keuangan menolak akses langsung dari role `anon`/`authenticated`; backend POS membaca dan menulisnya setelah validasi role admin.

Jurnal harus berisi sedikitnya dua baris, setiap baris hanya debit atau kredit, dan jumlah debit harus sama dengan jumlah kredit. Dashboard kas dan neraca dapat diperbarui melalui tombol **Perbarui**; laporan laba rugi dapat diekspor sebagai Excel atau dicetak ke PDF.
