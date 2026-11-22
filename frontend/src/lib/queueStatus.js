// Helper murni (tanpa React) untuk badge status antrean transaksi offline.
//
// Modul ini HANYA membaca/menghitung tampilan dari data antrean yang sudah ada
// (`localStore.getTransactionQueue()` -> array item) dan bendera "sedang sync"
// dari `queueSync.isQueueSyncing()`. Ia TIDAK mengubah antrean, alur checkout
// (`pay()` di POS.jsx), `queueSync.js`, `useQueueSync.js`, backend, atau skema DB.
//
// Bagian ini sengaja dipisah dari komponen supaya bisa diuji tanpa DOM.

import { rp } from "./api";
import { QUEUE_STATUS } from "./localStore";

// Interval ringan pembacaan antrean (ms) untuk memperbarui badge. Selain poll
// ini, badge juga diperbarui oleh event `babbapos:queue-sync` (dari queueSync),
// event `online`/`offline`, dan perubahan visibilitas tab.
export const QUEUE_BADGE_POLL_MS = 4000;

// Status turunan yang ditampilkan badge.
export const QUEUE_BADGE_STATE = Object.freeze({
  IDLE: "idle",
  SYNCING: "syncing",
  PENDING: "pending",
  FAILED: "failed",
});

// Label status per item antrean (Bahasa Indonesia).
export const QUEUE_ITEM_STATUS_LABEL = Object.freeze({
  [QUEUE_STATUS.PENDING]: "Menunggu",
  [QUEUE_STATUS.SYNCING]: "Menyinkronkan",
  [QUEUE_STATUS.FAILED]: "Gagal",
});

export const queueItemStatusLabel = (status) =>
  QUEUE_ITEM_STATUS_LABEL[status] || QUEUE_ITEM_STATUS_LABEL[QUEUE_STATUS.PENDING];

const toList = (items) => (Array.isArray(items) ? items : []);

/**
 * Ringkas isi antrean menjadi data badge.
 *
 * Prioritas tampilan:
 *   1. `syncing`  -> "Menyinkronkan..." (bila ada item berstatus `syncing` ATAU
 *      `queueSync.isQueueSyncing()` sedang true),
 *   2. `failed`   -> "Gagal: N" (butuh perhatian; N = jumlah item gagal),
 *   3. `pending`  -> "Antrean: N" (N = jumlah item menunggu),
 *   4. `idle`     -> badge disembunyikan (antrean kosong & tidak sedang sync).
 *
 * @param {unknown} items daftar item dari `getTransactionQueue()`
 * @param {{syncing?: boolean}} [options]
 */
export function summarizeTransactionQueue(items, options = {}) {
  const list = toList(items);
  const counts = { total: list.length, pending: 0, syncing: 0, failed: 0 };

  for (const item of list) {
    const status = item?.status || QUEUE_STATUS.PENDING;
    if (status === QUEUE_STATUS.FAILED) counts.failed += 1;
    else if (status === QUEUE_STATUS.SYNCING) counts.syncing += 1;
    else counts.pending += 1;
  }

  const active = Boolean(options.syncing) || counts.syncing > 0;

  let state = QUEUE_BADGE_STATE.IDLE;
  let label = "";
  if (active) {
    state = QUEUE_BADGE_STATE.SYNCING;
    label = "Menyinkronkan...";
  } else if (counts.failed > 0) {
    state = QUEUE_BADGE_STATE.FAILED;
    label = `Gagal: ${counts.failed}`;
  } else if (counts.pending > 0) {
    state = QUEUE_BADGE_STATE.PENDING;
    label = `Antrean: ${counts.pending}`;
  }

  return {
    ...counts,
    active,
    state,
    label,
    // Badge hanya muncul bila ada antrean (> 0) atau sedang menyinkronkan.
    visible: state !== QUEUE_BADGE_STATE.IDLE,
  };
}

/**
 * Ringkasan isi satu item antrean (untuk daftar di popover).
 *
 * Catatan: payload antrean TIDAK menyimpan `total` (dihitung server-side saat
 * checkout), jadi nominal hanya ditampilkan bila item membawa rincian
 * `payments` (split payment). Selain itu dipakai ringkasan jumlah item + metode.
 */
export function queueItemSummary(item) {
  const payload = item?.payload || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const qty = items.reduce((sum, row) => sum + (Number(row?.qty) || 0), 0);
  const method = typeof payload.method === "string" ? payload.method.trim() : "";
  const type = typeof payload.type === "string" ? payload.type.trim() : "";

  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const paidTotal = payments.length
    ? payments.reduce((sum, leg) => sum + (Number(leg?.amount) || 0), 0)
    : null;

  const parts = [];
  if (type) parts.push(type);
  if (items.length) parts.push(`${qty || items.length} item`);
  if (method) parts.push(method);

  return {
    count: items.length,
    qty,
    type,
    method,
    paidTotal,
    amountLabel: paidTotal == null ? "" : rp(paidTotal),
    summary: parts.join(" · ") || "Transaksi",
  };
}

/** Waktu item antrean: `HH:MM`, atau `DD Mmm HH:MM` bila bukan hari ini. */
export function formatQueueTime(iso, now = new Date()) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  const time = date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return time;
  const day = date.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
  return `${day} ${time}`;
}

/** Status ringkas keseluruhan antrean untuk teks tooltip/aria. */
export function queueBadgeTooltip(summary) {
  if (!summary || summary.state === QUEUE_BADGE_STATE.IDLE) return "";
  if (summary.state === QUEUE_BADGE_STATE.SYNCING) {
    return "Menyinkronkan transaksi offline ke server...";
  }
  if (summary.state === QUEUE_BADGE_STATE.FAILED) {
    return `${summary.failed} transaksi gagal dikirim. Klik untuk melihat detail.`;
  }
  return `${summary.pending} transaksi menunggu dikirim. Klik untuk melihat detail.`;
}
