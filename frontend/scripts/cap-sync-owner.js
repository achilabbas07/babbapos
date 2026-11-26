#!/usr/bin/env node
/**
 * Sinkronisasi aset web Mode Owner ke proyek Android + ganti nama aplikasi.
 *
 * Perilaku default (PERSISTEN):
 *   1. Set `app_name` & `title_activity_main` di
 *      `android/app/src/main/res/values/strings.xml` menjadi
 *      "Warkop Babba POS — Owner".
 *   2. Jalankan `npx cap sync android` (menyalin hasil build web ke proyek Android).
 *   3. Nama Owner DIBIARKAN tertulis di `strings.xml` supaya APK yang dibangun
 *      Gradle benar-benar memakai nama Owner.
 *
 * PENTING: setelah APK Owner selesai dibangun, kembalikan nama operasional
 * sebelum membangun APK operasional:
 *   npm run cap:sync:owner -- --restore
 *
 * Pemakaian:
 *   npm run build:owner
 *   npm run cap:sync:owner                       # label "Warkop Babba POS — Owner"
 *   npm run cap:sync:owner -- --label "Warkop Owner"
 *   npm run cap:sync:owner -- --restore          # kembali ke nama operasional
 *   npm run cap:sync:owner -- --temporary        # perilaku lama (nama dikembalikan)
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const frontendDir = path.resolve(__dirname, "..");
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

const argv = process.argv.slice(2);
// Default: nama Owner DIBIARKAN di strings.xml (persisten) supaya APK Owner
// benar-benar memakai nama Owner. `--restore` mengembalikan nama operasional,
// `--temporary` memakai perilaku lama (ganti saat sync lalu kembalikan).
const restoreOnly = argv.includes("--restore");
const temporary = argv.includes("--temporary");
const labelIndex = argv.indexOf("--label");
const ownerLabel = labelIndex >= 0 && argv[labelIndex + 1]
  ? argv[labelIndex + 1]
  : (process.env.REACT_APP_OWNER_LABEL || "Warkop Babba POS — Owner");

// Nama operasional dipakai untuk mode `--restore`.
const OPERATIONAL_LABEL = "Warkop Babba POS";

const withLabel = (xml, label) =>
  xml
    .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${label}$2`)
    .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${label}$2`);

// Nama aplikasi yang saat ini tertulis di strings.xml (untuk pelaporan).
const readAppName = (xml) => {
  const match = xml.match(/<string name="app_name">([^<]*)<\/string>/);
  return match ? match[1] : "(tidak ditemukan)";
};

const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";

if (!fs.existsSync(stringsPath)) {
  console.error(`[owner] Berkas tidak ditemukan: ${stringsPath}`);
  process.exit(1);
}

const original = fs.readFileSync(stringsPath, "utf8");

// Mode `--restore`: hanya kembalikan nama operasional, tanpa menjalankan sync.
if (restoreOnly) {
  const before = readAppName(original);
  fs.writeFileSync(stringsPath, withLabel(original, OPERATIONAL_LABEL), "utf8");
  console.log(`[owner] strings.xml dikembalikan: "${before}" -> "${OPERATIONAL_LABEL}".`);
  process.exit(0);
}

let exitCode = 0;
let appliedLabel = ownerLabel;

try {
  fs.writeFileSync(stringsPath, withLabel(original, ownerLabel), "utf8");
  console.log(`[owner] Nama aplikasi disetel ke "${ownerLabel}".`);

  const result = spawnSync(npx, ["cap", "sync", "android"], {
    cwd: frontendDir,
    env: { ...process.env, REACT_APP_OWNER_MODE: "1" },
    stdio: "inherit",
    // Windows: `npx.cmd` tidak bisa di-spawn tanpa shell (EINVAL).
    shell: isWindows,
  });

  if (result.error) {
    console.error("[owner] Gagal menjalankan cap sync:", result.error.message);
    exitCode = 1;
  } else if (result.status !== 0) {
    console.error(`[owner] cap sync gagal dengan kode keluar ${result.status}.`);
    exitCode = result.status ?? 1;
  } else {
    console.log("[owner] Aset Mode Owner tersinkron ke proyek Android.");
    console.log("[owner] Build APK: cd android; .\\gradlew assembleRelease");
  }
} finally {
  if (temporary) {
    fs.writeFileSync(stringsPath, original, "utf8");
    appliedLabel = readAppName(original);
    console.log(`[owner] --temporary: strings.xml dikembalikan ke "${appliedLabel}".`);
  } else {
    appliedLabel = readAppName(fs.readFileSync(stringsPath, "utf8"));
    console.log(`[owner] strings.xml dipertahankan dengan nama "${appliedLabel}".`);
    console.log("[owner] Setelah APK Owner selesai: npm run cap:sync:owner -- --restore");
  }
}

console.log(`[owner] Label aplikasi aktif: "${appliedLabel}".`);

process.exit(exitCode);
