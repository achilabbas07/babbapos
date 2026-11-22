import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTransactionQueue } from "@/hooks/useTransactionQueue";
import { syncTransactionQueue } from "@/lib/queueSync";
import {
  QUEUE_BADGE_STATE,
  formatQueueTime,
  queueBadgeTooltip,
  queueItemStatusLabel,
  queueItemSummary,
} from "@/lib/queueStatus";

// Badge status antrean transaksi offline (Tahap 2 UI) — MURNI TAMPILAN.
//
// Menempel di samping indikator koneksi di header. Hanya MEMBACA antrean
// (`getTransactionQueue`) dan bendera sync dari `queueSync.js`; satu-satunya
// aksi adalah memanggil `syncTransactionQueue()` yang sudah ada ketika kasir
// menekan "Sinkronkan Sekarang". Tidak ada perubahan pada alur `pay()`,
// kalkulasi harga/diskon/pembayaran/HPP, backend, atau skema DB.
//
//   - syncing -> "Menyinkronkan..." (biru, ikon berputar)
//   - failed  -> "Gagal: N"          (merah, butuh perhatian)
//   - pending -> "Antrean: N"        (kuning)
//   - kosong & tidak sync -> badge disembunyikan
export function OfflineQueueBadge({ className = "" }) {
  const { items, summary, refresh } = useTransactionQueue(true);
  const [open, setOpen] = useState(false);
  const [manualSync, setManualSync] = useState(false);

  if (!summary.visible) return null;

  const tone = {
    [QUEUE_BADGE_STATE.SYNCING]: "border-sky-500/40 bg-sky-500/10 text-sky-600",
    [QUEUE_BADGE_STATE.FAILED]: "border-destructive/40 bg-destructive/10 text-destructive",
    [QUEUE_BADGE_STATE.PENDING]: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  }[summary.state];

  // Urutkan tampilan daftar: paling lama di atas (sesuai urutan kirim FIFO).
  const rows = [...items].sort((a, b) => (Date.parse(a?.createdAt || 0) || 0) - (Date.parse(b?.createdAt || 0) || 0));

  const runManualSync = async () => {
    setManualSync(true);
    try {
      await syncTransactionQueue();
    } catch {
      // Best-effort: kegagalan sync tidak boleh menggagalkan UI.
    } finally {
      setManualSync(false);
      refresh();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="offline-queue-badge"
          data-state-queue={summary.state}
          title={queueBadgeTooltip(summary)}
          aria-label={summary.label}
          className={`inline-flex touch-manipulation items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium leading-none tabular-nums transition-colors ${tone} ${className}`}
        >
          {summary.state === QUEUE_BADGE_STATE.SYNCING ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : summary.state === QUEUE_BADGE_STATE.FAILED ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <UploadCloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="whitespace-nowrap">{summary.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" data-testid="offline-queue-popover" className="w-80 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Antrean Transaksi Offline</p>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {summary.total} item · {summary.pending} menunggu
            {summary.failed > 0 ? ` · ${summary.failed} gagal` : ""}
          </span>
        </div>

        {rows.length === 0 ? (
          <p data-testid="offline-queue-empty" className="py-3 text-center text-xs text-muted-foreground">
            Antrean kosong.
          </p>
        ) : (
          <ul data-testid="offline-queue-list" className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
            {rows.map((item) => {
              const info = queueItemSummary(item);
              const failed = item.status === "failed";
              return (
                <li
                  key={item.client_request_id}
                  data-testid="offline-queue-item"
                  data-status={item.status || "pending"}
                  className="rounded-md border border-border p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      {formatQueueTime(item.createdAt)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        failed
                          ? "bg-destructive/10 text-destructive"
                          : item.status === "syncing"
                            ? "bg-sky-500/10 text-sky-600"
                            : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {item.status === "syncing" ? (
                        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : failed ? (
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      )}
                      {queueItemStatusLabel(item.status)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-xs">{info.summary}</span>
                    {info.amountLabel && (
                      <span className="font-mono text-xs font-semibold tabular-nums">{info.amountLabel}</span>
                    )}
                  </div>
                  {failed && item.lastError && (
                    <p data-testid="offline-queue-item-error" className="mt-1 text-[11px] leading-snug text-destructive">
                      {item.lastError}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Button
          type="button"
          data-testid="offline-queue-sync-button"
          size="sm"
          variant="outline"
          disabled={manualSync || summary.state === QUEUE_BADGE_STATE.SYNCING}
          onClick={runManualSync}
          className="mt-2 w-full"
        >
          <RefreshCw className={`h-4 w-4 ${manualSync || summary.state === QUEUE_BADGE_STATE.SYNCING ? "animate-spin motion-reduce:animate-none" : ""}`} />
          {manualSync || summary.state === QUEUE_BADGE_STATE.SYNCING ? "Menyinkronkan..." : "Sinkronkan Sekarang"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export default OfflineQueueBadge;
