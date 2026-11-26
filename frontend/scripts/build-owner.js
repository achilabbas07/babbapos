#!/usr/bin/env node
/**
 * Build varian **Mode Owner** (APK pemilik).
 *
 * Skrip ini hanya menyalakan variabel build `REACT_APP_OWNER_MODE=1` lalu
 * menjalankan `craco build` seperti biasa. Tidak ada kode, backend, atau
 * database yang berbeda: varian Owner memakai basis kode & API yang SAMA,
 * hanya menu yang disaring menjadi halaman baca-saja.
 *
 * Pemakaian:
 *   node scripts/build-owner.js                 # build produksi Mode Owner
 *   node scripts/build-owner.js -- <arg craco>  # argumen tambahan diteruskan
 *
 * Setelah build selesai WAJIB jalankan `npm run cap:sync:owner` (menyalin hasil
 * build web ke proyek Android + menulis nama aplikasi Owner), lalu build APK
 * dengan Gradle (lihat frontend/README.md bagian "Membangun APK Android Mode Owner").
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const frontendDir = path.resolve(__dirname, "..");
const extraArgs = process.argv.slice(2);

const stringsPath = path.join(
  frontendDir,
  "android",
  "app",
  "src",
  "main",
  "res",
  "values",
  "strings.xml",
);

const env = {
  ...process.env,
  REACT_APP_OWNER_MODE: "1",
};

const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";

// Peringatan dini: nama aplikasi Android masih operasional → kemungkinan
// `cap:sync:owner` belum dijalankan, sehingga APK akan berlabel operasional.
try {
  const xml = fs.readFileSync(stringsPath, "utf8");
  const match = xml.match(/<string name="app_name">([^<]*)<\/string>/);
  const currentName = match ? match[1] : "(tidak ditemukan)";
  if (!/owner/i.test(currentName)) {
    console.warn(
      `[owner] PERINGATAN: app_name saat ini "${currentName}". ` +
        "Setelah build ini, jalankan `npm run cap:sync:owner` agar APK berlabel Owner.",
    );
  }
} catch {
  // Abaikan bila berkas belum ada (mis. proyek Android belum di-generate).
}

console.log("[owner] Membangun varian Mode Owner (REACT_APP_OWNER_MODE=1)...");

const result = spawnSync(npx, ["craco", "build", ...extraArgs], {
  cwd: frontendDir,
  env,
  stdio: "inherit",
  // Windows: `npx.cmd` tidak bisa di-spawn tanpa shell (EINVAL).
  shell: isWindows,
});

if (result.error) {
  console.error("[owner] Gagal menjalankan craco build:", result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[owner] Build gagal dengan kode keluar ${result.status}.`);
  process.exit(result.status ?? 1);
}

console.log("[owner] Build Mode Owner selesai.");
console.log("[owner] Lanjutkan: npm run cap:sync:owner  →  cd android; .\\gradlew assembleRelease");
