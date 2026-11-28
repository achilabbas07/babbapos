/* global __APP_VERSION__, __APP_BUILD__ */
// Satu sumber kebenaran teks versi aplikasi yang tampil di UI (mis. footer
// "Profil Usaha", pojok kanan bawah).
//
// Nilai asli di-inject saat BUILD oleh craco (webpack DefinePlugin) dari sumber
// konfigurasi versi yang aktif:
//   - `frontend/package.json` "version"       -> versi produk (ditampilkan "v<versi>")
//   - `frontend/android/app/build.gradle` versionCode -> "Build <n>"
// Lihat `craco.config.js` (blok readAppVersions + DefinePlugin).
//
// Konstanta *FALLBACK di bawah hanya dipakai bila injeksi tidak tersedia
// (mis. saat jest / dev tanpa definisi global). Nilainya WAJIB disamakan dengan
// versi aktif; `appVersion.test.js` menjaganya agar tidak pernah basi.

export const APP_VERSION_FALLBACK = "1.0.11";
export const APP_BUILD_FALLBACK = "12";

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// `typeof` dipakai agar tak melempar ReferenceError ketika global build-time
// belum didefinisikan (jest / dev).
const versionFromBuild = clean(
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : null,
);
const buildFromBuild = clean(
  typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : null,
);

export const APP_VERSION = versionFromBuild || APP_VERSION_FALLBACK;
export const APP_BUILD = buildFromBuild || APP_BUILD_FALLBACK;

// Menyusun label tampilan. Struktur teks dipertahankan persis:
// "v<versi> / Build <build>".
export function formatAppVersionLabel(version = APP_VERSION, build = APP_BUILD) {
  const v = clean(version) || APP_VERSION_FALLBACK;
  const b = clean(String(build ?? "")) || APP_BUILD_FALLBACK;
  return `v${v} / Build ${b}`;
}

export const APP_VERSION_LABEL = formatAppVersionLabel();
