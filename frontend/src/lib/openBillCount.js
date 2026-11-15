// Helper murni (tanpa dependensi React/Supabase) untuk badge jumlah "Open Bill"
// di sidebar: normalisasi respons API, event bus lokal, dan konstanta polling.

// Nama event global yang dipancarkan setiap kali daftar open bill berubah
// (bill dibuat, digabung, di-void, atau dibayar). Sidebar mendengarkan event ini
// agar angka badge langsung terbarui di perangkat yang melakukan aksi.
export const OPEN_BILLS_CHANGED_EVENT = "babbapos:open-bills-changed";

// Interval polling cadangan (ms) supaya badge tetap akurat di perangkat lain,
// termasuk saat Supabase Realtime tidak dikonfigurasi / migration belum dijalankan.
export const OPEN_BILLS_POLL_MS = 30000;

/**
 * Normalisasi respons `GET /open-bills` menjadi jumlah open bill aktif.
 * Endpoint saat ini mengembalikan daftar bill (array), tetapi helper ini juga
 * menerima bentuk ringkasan `{ count }`/`{ total }` agar tetap aman bila
 * backend kelak mengembalikan bentuk objek.
 *
 * @param {unknown} data
 * @returns {number} jumlah open bill (>= 0)
 */
export const parseOpenBillCount = (data) => {
  if (Array.isArray(data)) return data.length;
  const raw = data?.count ?? data?.total ?? data?.open_count ?? data?.openBillCount;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
};

/** Pancarkan sinyal perubahan open bill (best-effort, aman di luar browser). */
export const notifyOpenBillsChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_BILLS_CHANGED_EVENT));
};

/**
 * Berlangganan sinyal perubahan open bill.
 *
 * @param {() => void} handler
 * @returns {() => void} fungsi unsubscribe
 */
export const subscribeToOpenBillsChanged = (handler) => {
  if (typeof window === "undefined" || typeof handler !== "function") return () => {};
  window.addEventListener(OPEN_BILLS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(OPEN_BILLS_CHANGED_EVENT, handler);
};
