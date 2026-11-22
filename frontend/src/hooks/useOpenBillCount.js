import { useCallback, useEffect, useRef, useState } from "react";
import { api, isNetworkError } from "@/lib/api";
import { CACHE_KEYS, readCache } from "@/lib/localStore";
import {
  OPEN_BILLS_POLL_MS,
  parseOpenBillCount,
  subscribeToOpenBillsChanged,
} from "@/lib/openBillCount";
import { subscribeToOpenBillsRealtime } from "@/lib/realtimeOpenBills";

/**
 * Pantau jumlah open bill aktif untuk badge sidebar.
 *
 * Strategi (semua best-effort, tidak pernah melempar error ke UI):
 *  1. Muat sekali saat mount + setiap kali event lokal "open bill berubah" dipancarkan.
 *  2. Berlangganan Supabase Realtime (`public.open_bills`) bila tersedia.
 *  3. Polling ringan tiap `pollMs` sebagai cadangan (perangkat lain / tanpa Realtime).
 *
 * Kegagalan fetch diabaikan (silent fallback): jumlah dipertahankan, bukan di-reset,
 * supaya badge tidak berkedip menjadi 0 hanya karena gangguan jaringan sesaat.
 *
 * @param {boolean} [enabled] set false untuk menonaktifkan (mis. sebelum login)
 * @returns {{ count: number, refresh: () => void }}
 */
export const useOpenBillCount = (enabled = true) => {
  const [count, setCount] = useState(0);
  const controllerRef = useRef(null);
  const requestRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refresh = useCallback(() => {
    if (!enabledRef.current) return;
    const requestId = ++requestRef.current;
    const signal = controllerRef.current?.signal;
    api.get("/open-bills", signal ? { signal } : undefined)
      .then(({ data }) => {
        if (signal?.aborted || requestId !== requestRef.current) return;
        setCount(parseOpenBillCount(data));
      })
      // Silent fallback: jangan ganggu tampilan sidebar saat fetch gagal.
      // Saat error jaringan/offline, pakai jumlah dari cache baca terakhir
      // (bila ada) supaya badge tidak menampilkan 0 palsu.
      .catch((error) => {
        if (!isNetworkError(error)) return;
        readCache(CACHE_KEYS.OPEN_BILLS)
          .then((cached) => {
            if (signal?.aborted || requestId !== requestRef.current) return;
            if (!cached) return;
            setCount(parseOpenBillCount(cached.data));
          })
          .catch(() => {});
      });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return undefined;
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    refresh();

    // Sinkronisasi realtime (Supabase). Bila tersedia, interval polling tetap
    // dibiarkan sebagai jaring pemulihan yang murah dan aman.
    const unsubscribeRealtime = subscribeToOpenBillsRealtime(refresh);
    const unsubscribeLocal = subscribeToOpenBillsChanged(refresh);
    const pollId = setInterval(refresh, OPEN_BILLS_POLL_MS);

    return () => {
      controller.abort();
      controllerRef.current = null;
      unsubscribeRealtime();
      unsubscribeLocal();
      clearInterval(pollId);
    };
  }, [enabled, refresh]);

  return { count, refresh };
};
