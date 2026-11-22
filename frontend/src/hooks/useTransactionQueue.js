import { useCallback, useEffect, useRef, useState } from "react";
import { getTransactionQueue } from "@/lib/localStore";
import { QUEUE_SYNC_EVENT, isQueueSyncing } from "@/lib/queueSync";
import { QUEUE_BADGE_POLL_MS, summarizeTransactionQueue } from "@/lib/queueStatus";

// Hook pembaca antrean transaksi offline untuk badge header (Tahap 2 UI).
//
// Hanya MEMBACA antrean (`getTransactionQueue`) + bendera `isQueueSyncing()`
// dari `queueSync.js`. Tidak memodifikasi antrean, tidak memanggil ulang sync,
// dan tidak menyentuh alur checkout/backend/skema DB.
//
// Pembaruan dipicu oleh:
//   - mount,
//   - event `babbapos:queue-sync` (dipancarkan `queueSync.js` tiap akhir batch),
//   - event `online`/`offline`,
//   - kembalinya tab ke depan (`visibilitychange`),
//   - polling ringan `QUEUE_BADGE_POLL_MS` sebagai jaring pengaman.
export function useTransactionQueue(enabled = true) {
  const [items, setItems] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    let list = [];
    try {
      list = await getTransactionQueue();
    } catch {
      list = [];
    }
    if (!aliveRef.current) return;
    setItems(Array.isArray(list) ? list : []);
    setSyncing(isQueueSyncing());
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled || typeof window === "undefined") {
      setItems([]);
      setSyncing(false);
      return undefined;
    }

    refresh();

    const onSync = () => { refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };

    window.addEventListener(QUEUE_SYNC_EVENT, onSync);
    window.addEventListener("online", onSync);
    window.addEventListener("offline", onSync);
    document.addEventListener("visibilitychange", onVisibility);
    const pollId = window.setInterval(refresh, QUEUE_BADGE_POLL_MS);

    return () => {
      aliveRef.current = false;
      window.removeEventListener(QUEUE_SYNC_EVENT, onSync);
      window.removeEventListener("online", onSync);
      window.removeEventListener("offline", onSync);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(pollId);
    };
  }, [enabled, refresh]);

  return {
    items,
    syncing,
    summary: summarizeTransactionQueue(items, { syncing }),
    refresh,
  };
}

export default useTransactionQueue;
