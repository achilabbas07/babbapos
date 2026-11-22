import { useEffect, useState } from "react";

// Pemantau status koneksi berbasis `navigator.onLine` + event `online`/`offline`.
//
// Dipakai HANYA untuk indikator status di UI (Tahap 1). Nilai `navigator.onLine`
// bersifat heuristik: true berarti "ada interface jaringan", bukan jaminan server
// kita terjangkau. Karena itu indikator diberi label "Terhubung"/"Offline" dan
// tidak pernah dipakai untuk memblokir alur transaksi.
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => {
    if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") {
      return true; // Asumsi online bila API tidak tersedia (mis. SSR/tes).
    }
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Sinkronkan sekali saat mount (event bisa terlewat sebelum listener aktif).
    if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
      setOnline(navigator.onLine);
    }
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

export default useOnlineStatus;
