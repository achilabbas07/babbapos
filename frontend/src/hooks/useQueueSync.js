import { useEffect } from "react";
import { syncTransactionQueue } from "@/lib/queueSync";
import { ensureConnectivityMonitor, isOnline, subscribeConnectivity } from "@/lib/connectivity";

// Pemicu sinkronisasi antrean transaksi lokal (Tahap 2 "Offline Queue").
//
// Memicu `syncTransactionQueue()` saat:
//   1. aplikasi masuk/mount (bila perangkat sedang online),
//   2. koneksi kembali online (event `online`),
//   3. interval ringan sebagai jaring pengaman (mis. sinyal sempat putus tanpa
//      event `offline`).
//
// Hook ini HANYA memanggil sinkronisasi; ia tidak mengubah alur checkout
// (`pay()`), kalkulasi apa pun, backend, atau skema DB. Bila `enabled` false
// (mis. belum login) tidak ada yang dijalankan.

export const QUEUE_SYNC_INTERVAL_MS = 60_000;

export function useQueueSync(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === "undefined") return undefined;

    // Sync saat dibuka / kembali online.
    const trigger = () => {
      syncTransactionQueue().catch(() => {});
    };

    // Segera saat mount bila sedang online.
    ensureConnectivityMonitor();
    if (isOnline()) {
      trigger();
    }

    window.addEventListener("online", trigger);
    // Status dari sumber kebenaran tunggal: mencakup pemulihan lewat probe
    // (bukan hanya event `online` yang bisa tidak muncul di WebView Android).
    const unsubscribe = subscribeConnectivity(({ online }) => {
      if (online) trigger();
    });
    const interval = window.setInterval(() => {
      if (isOnline()) trigger();
    }, QUEUE_SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", trigger);
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [enabled]);
}

export default useQueueSync;
