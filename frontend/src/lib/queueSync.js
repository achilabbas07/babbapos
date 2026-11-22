// Sinkronisasi otomatis antrean transaksi lokal (Tahap 2 "Offline Queue").
//
// Modul ini HANYA membaca antrean yang sudah tersimpan (via `getTransactionQueue`)
// dan mengirim ulang item yang belum terkirim ke `POST /transactions` memakai
// payload + `client_request_id` yang tersimpan. Ia TIDAK mengubah:
//   - alur checkout `pay()` di POS.jsx,
//   - kalkulasi harga/diskon/pembayaran/HPP,
//   - backend (`server.py`), skema database, `ShiftGate.jsx`, `AuthContext.jsx`.
//
// Aturan pengiriman:
//   - FIFO: item diurutkan sesuai `createdAt` lalu dikirim berurutan.
//   - Berhenti pada error JARINGAN/TIMEOUT: `incrementQueueRetry()` dinaikkan dan
//     loop batch dihentikan supaya tidak membanjiri server saat offline.
//   - Error 4xx (validasi/bisnis): item ditandai `failed` + `lastError` dicatat
//     (bukan diulang selamanya, jadi tidak mengganjal item di belakangnya).
//   - Item dengan `nextAttemptAt` yang belum tiba (backoff) dilewati di batch ini.
//
// Semua operasi best-effort: kegagalan sync tidak boleh menggagalkan aplikasi.

import { api, isNetworkError, errMsg } from "@/lib/api";
import {
  getTransactionQueue,
  removeTransactionQueueItem,
  incrementQueueRetry,
  updateTransactionQueueItem,
  QUEUE_STATUS,
} from "@/lib/localStore";

// Jeda backoff antar percobaan ulang (dalam milidetik). Indeks >= panjang array
// memakai nilai terakhir (retry makin jarang saat terus gagal).
export const QUEUE_SYNC_BACKOFF_MS = Object.freeze([
  15_000, // ~15 detik
  60_000, // 1 menit
  5 * 60_000, // 5 menit
  15 * 60_000, // 15 menit
  60 * 60_000, // 1 jam
]);

export const backoffDelayMs = (retryCount = 0) => {
  const idx = Math.min(Math.max(Number(retryCount) || 0, 0), QUEUE_SYNC_BACKOFF_MS.length - 1);
  return QUEUE_SYNC_BACKOFF_MS[idx];
};

// Item yang layak dikirim: status `pending`/`failed` dan sudah lewat waktu
// backoff (bila ada). Item lain (mis. sedang `syncing`) dilewati.
const isDue = (item, now) => {
  if (!item) return false;
  const status = item.status || QUEUE_STATUS.PENDING;
  if (status !== QUEUE_STATUS.PENDING && status !== QUEUE_STATUS.FAILED) return false;
  if (!item.nextAttemptAt) return true;
  const at = Date.parse(item.nextAttemptAt);
  return Number.isNaN(at) || at <= now;
};

// Urutkan FIFO (paling lama dibuat lebih dulu) agar nomor transaksi tidak
// terbalik saat semua item sukses.
const byCreatedAt = (a, b) => {
  const ta = Date.parse(a?.createdAt || 0) || 0;
  const tb = Date.parse(b?.createdAt || 0) || 0;
  if (ta !== tb) return ta - tb;
  return String(a?.client_request_id || "").localeCompare(String(b?.client_request_id || ""));
};

// Event ringan agar UI (mis. badge notifikasi) bisa menampilkan progres sync.
export const QUEUE_SYNC_EVENT = "babbapos:queue-sync";

const emitSyncEvent = (detail) => {
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(QUEUE_SYNC_EVENT, { detail }));
    }
  } catch {
    // CustomEvent tidak tersedia / diblokir -> abaikan (murni notifikasi UI).
  }
};

// Cegah dua batch sync berjalan bersamaan (mis. event `online` + interval).
let syncing = false;

export const isQueueSyncing = () => syncing;

/**
 * Kirim satu siklus antrean ke server.
 *
 * @returns {Promise<{sent:number,failed:number,deferred:number,stopped:boolean,total:number}>}
 *   - `sent`: item sukses terkirim (sudah dihapus dari antrean),
 *   - `failed`: item ditandai `failed` karena error non-jaringan (4xx/validasi),
 *   - `deferred`: item yang belum jatuh tempo backoff / belum dicoba batch ini,
 *   - `stopped`: true bila batch dihentikan karena error jaringan.
 */
export async function syncTransactionQueue() {
  if (syncing) {
    return { sent: 0, failed: 0, deferred: 0, stopped: false, total: 0, skipped: true };
  }
  syncing = true;

  const result = { sent: 0, failed: 0, deferred: 0, stopped: false, total: 0 };

  try {
    const queue = await getTransactionQueue();
    result.total = queue.length;

    if (!queue.length) return result;

    const now = Date.now();
    const due = queue.filter((item) => isDue(item, now)).sort(byCreatedAt);
    result.deferred = queue.length - due.length;

    // Tidak ada koneksi jaringan -> jangan coba-coba (hemat baterai/request).
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      result.deferred += due.length;
      result.stopped = true;
      return result;
    }

    for (const item of due) {
      const clientRequestId = item.client_request_id;
      if (!clientRequestId || !item.payload) {
        // Item rusak / tanpa payload -> tandai failed agar tidak mengganjal.
        await updateTransactionQueueItem(clientRequestId, {
          status: QUEUE_STATUS.FAILED,
          lastError: "Item antrean tanpa payload yang bisa dikirim.",
        });
        result.failed += 1;
        continue;
      }

      try {
        const body = { ...item.payload, client_request_id: clientRequestId };
        await api.post("/transactions", body);
        await removeTransactionQueueItem(clientRequestId);
        result.sent += 1;
      } catch (error) {
        if (isNetworkError(error)) {
          // Masih offline / timeout -> mundurkan percobaan, HENTIKAN batch.
          const delay = backoffDelayMs(item.retryCount);
          await incrementQueueRetry(clientRequestId, {
            error: errMsg(error),
            nextAttemptAt: new Date(Date.now() + delay).toISOString(),
          });
          result.deferred += 1;
          result.stopped = true;
          break;
        }
        // Error 4xx/validasi dari server -> tandai failed, lanjut ke item berikut.
        await updateTransactionQueueItem(clientRequestId, {
          status: QUEUE_STATUS.FAILED,
          retryCount: (Number(item.retryCount) || 0) + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: errMsg(error),
        });
        result.failed += 1;
      }
    }

    return result;
  } finally {
    syncing = false;
    emitSyncEvent(result);
  }
}

export default syncTransactionQueue;
