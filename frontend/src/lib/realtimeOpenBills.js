import { supabase } from "../supabaseClient";

// Sinkronisasi real-time jumlah open bill via Supabase Realtime.
// Perangkat lain yang membuka aplikasi langsung melihat jumlah open bill terbaru
// (bill baru, digabung, di-void, atau dibayar) tanpa refresh manual.
// Best-effort: bila Supabase belum dikonfigurasi atau tabel belum dipublikasikan
// ke Realtime, hook pemanggil akan jatuh ke polling berkala.
export const OPEN_BILLS_REALTIME_CHANNEL = "open-bills-realtime";

/**
 * Berlangganan perubahan tabel `public.open_bills` (postgres_changes).
 * Mengembalikan fungsi unsubscribe, atau no-op bila Supabase belum dikonfigurasi.
 *
 * @param {(payload?: object) => void} onChange dipanggil setiap ada perubahan baris pada tabel open_bills
 * @param {{
 *   client?: object,
 *   channelName?: string,
 *   onStatus?: (status: "subscribed"|"error"|"unavailable", error?: unknown) => void,
 * }} [options]
 * @returns {() => void} unsubscribe
 */
export const subscribeToOpenBillsRealtime = (onChange, options = {}) => {
  // `client` boleh di-override eksplisit (termasuk null) untuk pengujian/reuse.
  const client = "client" in options ? options.client : supabase;
  const channelName = options.channelName || OPEN_BILLS_REALTIME_CHANNEL;
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
      { event: "*", schema: "public", table: "open_bills" },
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
