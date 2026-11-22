import { CloudOff } from "lucide-react";
import { fmtDate } from "@/lib/api";

/**
 * Penanda ringkas bahwa data di halaman berasal dari cache lokal (mode offline).
 * Hanya tampil bila `fromCache` true, sehingga tidak mengubah tampilan normal.
 */
export default function CachedDataNotice({ fromCache, updatedAt, className = "" }) {
  if (!fromCache) return null;
  const when = updatedAt ? fmtDate(updatedAt) : null;
  return (
    <div
      data-testid="cached-data-notice"
      className={`mb-4 flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800 ${className}`}
    >
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Mode offline: menampilkan data tersimpan{when ? ` (${when})` : ""}. Perubahan belum terkirim ke server.
      </span>
    </div>
  );
}
