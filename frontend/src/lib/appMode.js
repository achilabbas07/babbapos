// Penentu mode aplikasi.
//
// Aplikasi ini bisa dibangun sebagai dua varian dari basis kode yang sama:
//
// 1. **Mode operasional** (default) — APK kasir/pelayan seperti biasa.
// 2. **Mode Owner** — APK khusus pemilik yang HANYA menampilkan halaman
//    pantauan baca-saja (`/owner`), memakai backend & database yang sama.
//
// Varian dipilih lewat variabel build `REACT_APP_OWNER_MODE` sehingga tidak ada
// kode operasional yang perlu diubah/diduplikasi. Modul ini murni: tidak
// menyentuh autentikasi, shift gate, antrean offline, HPP, maupun jurnal.

export const OWNER_HOME = "/owner";
export const OPERATIONAL_HOME = "/pos";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** True bila build ini adalah varian khusus pemilik (Mode Owner). */
export const isOwnerMode = (raw = process.env.REACT_APP_OWNER_MODE) =>
  TRUTHY.has(String(raw ?? "").trim().toLowerCase());

/**
 * Halaman awal untuk pengguna yang sudah masuk.
 *
 * Pada build Mode Owner SEMUA sesi diarahkan ke Pantauan Pemilik tanpa dipaksa
 * membuka shift kasir. Akun yang bukan pemilik akan ditolak oleh penjaga rute
 * (layar "hanya untuk Pemilik"), bukan dibawa ke kasir.
 */
export const homePathFor = (user, ownerMode = isOwnerMode()) =>
  ownerMode && user ? OWNER_HOME : OPERATIONAL_HOME;

/** Akun Owner memakai peran `admin`, jadi dipastikan peran admin. */
export const isOwnerAccount = (user) => user?.role === "admin";

/**
 * True bila sebuah nilai peran (`role`) adalah peran pemilik (`admin`).
 * Perbandingan case-insensitive dan mengabaikan spasi tepi, sehingga nilai
 * seperti "Admin", " admin ", atau "ADMIN" tetap dianggap peran pemilik.
 */
export const isOwnerRole = (role) => String(role ?? "").trim().toLowerCase() === "admin";

/**
 * Saring daftar pengguna untuk layar Login.
 *
 * Pada build **Mode Owner**, daftar pengguna di layar masuk HANYA menampilkan
 * akun pemilik (peran `admin`) supaya kasir/pelayan tidak muncul. Pada build
 * **operasional**, fungsi ini mengembalikan daftar apa adanya sehingga perilaku
 * APK kasir/pelayan tidak berubah sama sekali.
 *
 * Murni (tanpa efek samping) dan tidak menyentuh autentikasi/sesi/token.
 */
export const filterOwnerModeLoginUsers = (users, ownerMode = isOwnerMode()) => {
  const list = Array.isArray(users) ? users : [];
  if (!ownerMode) return list;
  return list.filter((candidate) => isOwnerRole(candidate?.role));
};
