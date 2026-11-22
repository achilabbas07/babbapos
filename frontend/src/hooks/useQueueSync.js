import { useEffect } from "react";
import { syncTransactionQueue } from "@/lib/queueSync";

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
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      trigger();
    }

    window.addEventListener("online", trigger);
    const interval = window.setInterval(() => {
      if (typeof navigator === "undefined" || navigator.onLine !== false) trigger();
    }, QUEUE_SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", trigger);
      window.clearInterval(interval);
    };
  }, [enabled]);
}

export default useQueueSync;
