import { supabase } from "../supabaseClient";

// Sinkronisasi real-time denah meja via Supabase Realtime.
// Perangkat lain yang membuka halaman Meja akan langsung melihat perubahan
// status meja (occupied/available/paid/reserved) tanpa refresh manual.
export const TABLES_REALTIME_CHANNEL = "tables-realtime";

// Interval fallback (ms) bila realtime Supabase tidak tersedia/bermasalah.
export const TABLES_FALLBACK_POLL_MS = 10000;

/**
 * Berlangganan perubahan tabel `public.tables` (postgres_changes).
 * Mengembalikan fungsi unsubscribe, atau no-op bila Supabase belum dikonfigurasi.
 *
 * @param {(payload?: object) => void} onChange dipanggil setiap ada perubahan baris pada tabel meja
 * @param {{
 *   client?: object,
 *   channelName?: string,
 *   onStatus?: (status: "subscribed"|"error"|"unavailable", error?: unknown) => void,
 * }} [options]
 *        client: klien Supabase (untuk memudahkan pengujian / reuse)
 *        onStatus: menerima status langganan, dipakai untuk mengaktifkan fallback
 * @returns {() => void} unsubscribe
 */
export const subscribeToTablesRealtime = (onChange, options = {}) => {
  // `client` boleh di-override eksplisit (termasuk null) untuk pengujian/reuse.
  const client = "client" in options ? options.client : supabase;
  const channelName = options.channelName || TABLES_REALTIME_CHANNEL;
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};

  if (!client || typeof onChange !== "function") {
    onStatus("unavailable");
    return () => {};
  }

  // Status akhir (subscribed/error) hanya dilaporkan sekali agar fallback stabil.
  let finalStatus = null;
  const report = (status, error) => {
    if (finalStatus) return;
    finalStatus = status;
    if (error === undefined) onStatus(status);
    else onStatus(status, error);
  };

  const channel = client
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tables" },
      () => onChange(),
    )
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") report("subscribed");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") report("error", error);
    });

  return () => {
    try {
      client.removeChannel(channel);
    } catch {
      // Abaikan: channel mungkin sudah ditutup saat komponen unmount.
    }
  };
};

/**
 * Debounce muat-ulang data meja (memakai endpoint yang sama seperti pemuatan
 * awal), agar rentetan perubahan realtime hanya memicu satu reload.
 *
 * @param {AbortController} controller
 * @param {(signal: AbortSignal) => Promise<any>} reload
 * @param {number} [delayMs]
 * @returns {{ schedule: () => void, cancel: () => void }}
 */
export const createTablesReloadScheduler = (controller, reload, delayMs = 200) => {
  let timer = null;
  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const schedule = () => {
    if (!controller || controller.signal.aborted || typeof reload !== "function") return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (!controller.signal.aborted) reload(controller.signal);
    }, delayMs);
  };
  return { schedule, cancel };
};
