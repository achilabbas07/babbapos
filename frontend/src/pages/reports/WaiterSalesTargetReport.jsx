import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { api, errMsg, fmtDate } from "@/lib/api";
import { PageHeader, Empty } from "@/components/PageHeader";
import { WaiterShiftPrintDialog } from "@/components/WaiterShiftPrintDialog";
import { targetBadge } from "@/lib/waiterShiftHistoryData";
import { targetBadgeText } from "@/lib/targetTypes";

// Sub-laporan "Laporan Sales Target": menampilkan riwayat shift pelayan (yang
// sebelumnya berada di halaman Target Sales Pelayan) beserta tombol cetak ulang
// laporan tutup shift. Read-only — tidak mengubah logika transaksional apa pun.
export default function WaiterSalesTargetReport() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/waiter-shifts");
      setHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Laporan Sales Target"
        subtitle="Riwayat shift pelayan beserta pencapaian target. Gunakan Cetak Ulang untuk mencetak laporan tutup shift yang sudah tersimpan."
      />
      {loading ? (
        <p data-testid="sales-target-loading" className="py-10 text-center text-sm text-muted-foreground">Memuat riwayat shift...</p>
      ) : history.length === 0 ? (
        <Empty testid="sales-target-empty" text="Belum ada shift pelayan yang ditutup." />
      ) : (
        <div data-testid="sales-target-history" className="divide-y divide-border rounded-2xl border border-border bg-card">
          {history.map((h) => (
            <div key={h.id} data-testid={`sales-target-shift-${h.id}`} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="font-semibold">{h.userName}</p>
                <p className="font-mono text-xs text-muted-foreground">{fmtDate(h.openedAt)} → {fmtDate(h.closedAt)}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {(Array.isArray(h.results) ? h.results : []).length === 0 && (
                    <span className="text-xs text-muted-foreground">Tanpa target</span>
                  )}
                  {(Array.isArray(h.results) ? h.results : []).map((r) => {
                    const badge = targetBadge(r);
                    const text = targetBadgeText(r);
                    return (
                      <span
                        key={r.targetId || badge.name}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${text.done ? "bg-emerald-100 text-emerald-700" : "bg-secondary text-muted-foreground"}`}
                      >
                        {badge.name}: {text.text}
                      </span>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                data-testid={`sales-target-reprint-${h.id}`}
                onClick={() => setPrinting(h)}
                className="flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-xs font-medium hover:border-primary"
              >
                <Printer className="h-3.5 w-3.5" />Cetak Ulang
              </button>
            </div>
          ))}
        </div>
      )}
      <WaiterShiftPrintDialog shift={printing} onClose={() => setPrinting(null)} />
    </div>
  );
}
