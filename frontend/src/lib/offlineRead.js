// Helper murni untuk "Tahap 1 Offline Read" yang lebih luas: memuat satu
// resource backend dengan fallback cache lokal.
//
// Aturan main:
//  - Request BERHASIL            -> data dipakai + disimpan ke cache (`localStore`).
//  - Request GAGAL karena JARINGAN/offline & ADA cache -> cache dipakai supaya
//    halaman tetap tampil (tanpa pesan gagal jaringan).
//  - Request GAGAL karena server menjawab (4xx/5xx) -> cache TIDAK dipakai,
//    error dikembalikan ke pemanggil.
//  - Request DIBATALKAN (AbortController) -> tidak mengganti state, tidak
//    menyentuh cache.
//
// Modul ini TIDAK menyentuh alur transaksi/checkout, harga, stok, antrean
// offline, backend, maupun skema database.

import { readCache, saveCache } from "./localStore";
import { isNetworkError } from "./api";

/** True bila error berasal dari pembatalan request (AbortController/axios). */
export const isCanceledError = (e) =>
  e?.name === "CanceledError" || e?.name === "AbortError" || e?.code === "ERR_CANCELED";

/**
 * Buat key cache yang spesifik untuk sebuah rentang/filter.
 * Contoh: rangeCacheKey("transactions", { start: "x", end: "y" }) -> "transactions?start=x&end=y".
 *
 * @param {string} base key dasar
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export const rangeCacheKey = (base, params = {}) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? `${base}?${parts.join("&")}` : base;
};

/**
 * Muat data dengan fallback cache lokal.
 *
 * @param {string} cacheKey key cache di `localStore` (boleh null untuk melewati cache)
 * @param {() => Promise<any>} request thunk request; resolve dengan payload data
 * @param {{
 *   read?: (key: string) => Promise<{data: any, updatedAt?: string}|null>,
 *   save?: (key: string, data: any) => Promise<any>,
 *   isNetworkFailure?: (e: any) => boolean,
 * }} [options] override opsional (dipakai untuk pengujian)
 * @returns {Promise<{
 *   data: any, fromCache: boolean, updatedAt: string|null,
 *   error: any, canceled: boolean
 * }>}
 */
export async function loadWithCache(cacheKey, request, options = {}) {
  const read = options.read || readCache;
  const save = options.save || saveCache;
  const isNetworkFailure = options.isNetworkFailure || isNetworkError;

  try {
    const data = await request();
    if (cacheKey && data !== undefined) await save(cacheKey, data);
    return { data, fromCache: false, updatedAt: new Date().toISOString(), error: null, canceled: false };
  } catch (err) {
    if (isCanceledError(err)) {
      return { data: undefined, fromCache: false, updatedAt: null, error: null, canceled: true };
    }
    if (cacheKey && isNetworkFailure(err)) {
      const record = await read(cacheKey);
      if (record) {
        return { data: record.data, fromCache: true, updatedAt: record.updatedAt || null, error: null, canceled: false };
      }
    }
    return { data: undefined, fromCache: false, updatedAt: null, error: err, canceled: false };
  }
}

/**
 * Ringkasan gabungan hasil beberapa `loadWithCache` (dipakai halaman yang
 * memuat lebih dari satu endpoint, mis. `Promise.all`).
 *
 * @param {Array<{fromCache: boolean, error: any}>} results
 * @returns {{ fromCache: boolean, error: any }}
 */
export const combineCacheResults = (results = []) => ({
  fromCache: results.some((r) => r && r.fromCache),
  error: results.find((r) => r && r.error)?.error || null,
});
