import { useEffect, useState } from "react";
import { ensureConnectivityMonitor, getConnectivitySnapshot, subscribeConnectivity } from "@/lib/connectivity";

// Status koneksi untuk indikator di UI (label "Terhubung"/"Offline").
//
// Sumber kebenaran TUNGGAL ada di `lib/connectivity.js`: gabungan
// `navigator.onLine` + event `online`/`offline` DENGAN bukti nyata dari
// permintaan HTTP (kegagalan fetch/timeout vs ada respons dari server).
//
// Ini penting karena di WebView Android/Capacitor `navigator.onLine` sering
// tetap `true` walau server tidak terjangkau — sehingga indikator bisa keliru
// menampilkan "Terhubung" padahal halaman sedang menampilkan data cache
// ("Mode offline: menampilkan data tersimpan").
export function useOnlineStatus() {
  const [snapshot, setSnapshot] = useState(() => getConnectivitySnapshot());

  useEffect(() => {
    ensureConnectivityMonitor();
    setSnapshot(getConnectivitySnapshot());
    return subscribeConnectivity(setSnapshot);
  }, []);

  return snapshot.online;
}

export default useOnlineStatus;
