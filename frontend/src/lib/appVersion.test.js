import fs from "fs";
import path from "path";
import {
  APP_BUILD,
  APP_BUILD_FALLBACK,
  APP_VERSION,
  APP_VERSION_FALLBACK,
  APP_VERSION_LABEL,
  formatAppVersionLabel,
} from "./appVersion";

// Uji ini menjaga agar konstanta FALLBACK tidak pernah tertinggal dari sumber
// konfigurasi versi aktif (package.json + android/app/build.gradle). Saat build
// produksi, nilai asli datang dari DefinePlugin (lihat craco.config.js), tetapi
// fallback dipakai oleh jest/dev sehingga harus tetap sinkron.

const FRONTEND_ROOT = path.resolve(__dirname, "..", "..");

function readPackageVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(FRONTEND_ROOT, "package.json"), "utf8"),
  );
  return pkg.version;
}

function readGradleVersionCode() {
  const gradle = fs.readFileSync(
    path.join(FRONTEND_ROOT, "android", "app", "build.gradle"),
    "utf8",
  );
  const match = gradle.match(/versionCode\s+(\d+)/);
  return match ? match[1] : null;
}

describe("appVersion — label versi UI", () => {
  it("menyusun label dengan format 'v<versi> / Build <build>'", () => {
    expect(formatAppVersionLabel("1.2.3", "7")).toBe("v1.2.3 / Build 7");
  });

  it("memakai fallback bila argumen kosong/null", () => {
    expect(formatAppVersionLabel("", "")).toBe(
      `v${APP_VERSION_FALLBACK} / Build ${APP_BUILD_FALLBACK}`,
    );
    expect(formatAppVersionLabel(null, null)).toBe(
      `v${APP_VERSION_FALLBACK} / Build ${APP_BUILD_FALLBACK}`,
    );
  });

  it("label ekspor default terformat dengan benar", () => {
    expect(APP_VERSION_LABEL).toBe(
      `v${APP_VERSION} / Build ${APP_BUILD}`,
    );
  });

  it("fallback versi SAMA dengan version di package.json", () => {
    expect(APP_VERSION_FALLBACK).toBe(readPackageVersion());
  });

  it("fallback build SAMA dengan versionCode di build.gradle", () => {
    expect(APP_BUILD_FALLBACK).toBe(readGradleVersionCode());
  });
});
