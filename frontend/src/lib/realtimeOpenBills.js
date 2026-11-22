import { supabase } from "../supabaseClient";

// Sinkronisasi real-time jumlah open bill via Supabase Realtime.
// Perangkat lain yang membuka aplikasi langsung melihat jumlah open bill terbaru
// (bill baru, digabung, di-void, atau dibayar) tanpa refresh manual.
// Best-effort: bila Supabase belum dikonfigurasi atau tabel belum dipublikasikan
// ke Realtime, hook pemanggil akan jatuh ke polling berkala.
export const OPEN_BILLS_REALTIME_CHANNEL = "open-bills-realtime";

// Penghitung untuk menjamin setiap langganan memakai topik channel yang UNIK.
// Lihat penjelasan pada `subscribeToOpenBillsRealtime` (mencegah reuse channel).
let channelTopicSequence = 0;
const uniqueChannelTopic = (base) => `${base}-${++channelTopicSequence}`;

/**
 * Berlangganan perubahan tabel `public.open_bills` (postgres_changes).
 * Mengembalikan fungsi unsubscribe, atau no-op bila Supabase belum dikonfigurasi.
 *
 * Catatan penting: setiap pemanggilan memakai TOPIK CHANNEL YANG UNIK.
 * Supabase Realtime (`RealtimeClient.channel(topic)`) mengembalikan channel
 * yang sudah ada untuk topik yang sama selama channel itu belum benar-benar
 * ditutup (`client.removeChannel` bersifat async). Memanggil `.on('postgres_changes',...)`
 * pada channel yang sedang/sudah join akan melempar:
 *   "cannot add `postgres_changes` callbacks for realtime:<topic> after `subscribe()`".
 * Kondisi ini mudah terjadi pada React StrictMode / re-render / reconnect karena
 * cleanup unmount berjalan sebelum channel lama selesai ditutup. Dengan topik
 * unik, `client.channel()` selalu membuat channel baru sehingga bindings selalu
 * dipasang sebelum `subscribe()`.
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
  const baseChannelName = options.channelName || OPEN_BILLS_REALTIME_CHANNEL;
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

  // Topik unik per langganan: channel lama yang belum selesai ditutup nunca
  // dipakai ulang, sehingga semua `.on(...)` selalu dipasang pada channel baru
  // SEBELUM `.subscribe()`.
  const channelName = uniqueChannelTopic(baseChannelName);

  let channel;
  try {
    channel = client
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
  } catch {
    // Jaring pengaman: bila pembuatan langganan gagal (mis. klien belum siap),
    // laporkan `unavailable` agar pemanggil memakai fallback (mis. polling).
    report("unavailable");
    return () => {};
  }

  // Cleanup idempoten + aman dipanggil berulang kali.
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    try {
      client.removeChannel(channel);
    } catch {
      // Abaikan: channel mungkin sudah ditutup saat komponen unmount.
    }
  };
};
