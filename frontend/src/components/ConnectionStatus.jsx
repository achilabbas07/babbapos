import { Wifi, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

// Indikator status koneksi ringkas (Tahap 1). Sengaja dibuat compact & inline
// (bukan position:fixed/absolute) agar tidak mengubah tata letak dan aman di
// `.app-native-android`. Hanya informasi; tidak memblokir aksi apa pun.
//
// - Online  : pil netral abu-abu, ikon Wi-Fi, label "Terhubung".
// - Offline : pil merah, ikon Wi-Fi mati, label "Offline".
export function ConnectionStatus({ className = "" }) {
  const online = useOnlineStatus();

  const base = "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium leading-none tabular-nums";
  const tone = online
    ? "border-border text-muted-foreground"
    : "border-destructive/40 bg-destructive/10 text-destructive";

  return (
    <span
      data-testid="connection-status"
      data-status={online ? "online" : "offline"}
      role="status"
      aria-live="polite"
      title={online ? "Terhubung ke jaringan" : "Tidak ada koneksi jaringan"}
      className={`${base} ${tone} ${className}`}
    >
      {online ? <Wifi className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="hidden whitespace-nowrap sm:inline">{online ? "Terhubung" : "Offline"}</span>
    </span>
  );
}

export default ConnectionStatus;
