import { useCallback, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, errMsg, fmtDate } from "@/lib/api";
import { printBluetoothReceipt, printerTypeForDocType, connectBluetoothPrinter } from "@/lib/bluetoothThermalPrinter";
import { targetBadge } from "@/lib/waiterShiftHistoryData";

// Dialog cetak ulang laporan tutup shift pelayan dari riwayat.
// Read-only: hanya memuat laporan tersimpan lalu mengirimkannya kembali ke printer.
export const WaiterShiftPrintDialog = ({ shift, onClose }) => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [printError, setPrintError] = useState("");
  const shiftId = shift?.id || null;

  const load = useCallback(async (signal) => {
    if (!shiftId) return;
    setLoading(true);
    setFetchError("");
    try {
      const { data } = await api.get(`/waiter-shifts/${encodeURIComponent(shiftId)}`, { signal });
      if (data.id !== shiftId || !data.results || typeof data.results !== "object") {
        throw new Error("Data laporan shift yang diterima tidak sesuai.");
      }
      setReport(data);
    } catch (error) {
      if (error.name !== "CanceledError") setFetchError(errMsg(error));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    setReport(null);
    setPrintError("");
    if (!shiftId) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, shiftId]);

  const print = useCallback(async (data = report) => {
    if (!data) return;
    setPrinting(true);
    setPrintError("");
    try {
      await printBluetoothReceipt("waiterShift", { ...data, isReprint: true }, { printerType: printerTypeForDocType("waiterShift") });
      toast.success("Laporan tutup shift berhasil dicetak ulang.");
    } catch (error) {
      setPrintError(error?.message || "Laporan shift gagal dicetak melalui Bluetooth.");
    } finally {
      setPrinting(false);
    }
  }, [report]);

  const connectAndPrint = async () => {
    setConnecting(true);
    try {
      await connectBluetoothPrinter({ printerType: "kitchen" });
      await print();
    } catch (error) {
      setPrintError(error?.message || "Printer Bluetooth gagal dihubungkan.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={!!shift} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="waiter-shift-print-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>Cetak Ulang Laporan Shift Pelayan</DialogTitle></DialogHeader>
        {shift && (
          <div className="space-y-4 text-sm">
            <div className="space-y-1 border-y border-dashed border-border py-3 text-xs">
              <p data-testid="waiter-shift-print-name" className="font-semibold">{shift.userName}</p>
              <p className="font-mono text-muted-foreground">{fmtDate(shift.openedAt)} → {fmtDate(shift.closedAt)}</p>
              <p className="font-mono text-muted-foreground">ID: {shift.id}</p>
            </div>
            {loading && <p data-testid="waiter-shift-print-loading" className="text-sm text-muted-foreground">Memuat laporan untuk dicetak...</p>}
            {fetchError && (
              <div className="space-y-2" data-testid="waiter-shift-print-fetch-error">
                <p className="text-sm text-destructive">Laporan gagal dimuat: {fetchError}</p>
                <Button variant="outline" onClick={() => load()}>Coba muat lagi</Button>
              </div>
            )}
            {report && (
              <div className="space-y-2" data-testid="waiter-shift-print-summary">
                {(Array.isArray(shift.results) ? shift.results : []).map((r) => {
                  const badge = targetBadge(r);
                  return (
                    <div key={r.targetId || badge.name} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{badge.name}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.done ? "bg-emerald-100 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>
                        {badge.achieved}/{badge.targetQty}
                      </span>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">Status target: {report.results?.target_sales_status || "-"}</p>
              </div>
            )}
            {printError && (
              <div className="space-y-2" data-testid="waiter-shift-print-error">
                <p className="text-sm text-destructive">Gagal mencetak: {printError}</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          {printError && (
            <Button variant="outline" disabled={connecting || printing} onClick={connectAndPrint}>
              {connecting ? "Menghubungkan printer..." : "Hubungkan printer & coba lagi"}
            </Button>
          )}
          <Button data-testid="waiter-shift-reprint-button" disabled={!report || printing || loading} onClick={() => print()}>
            <Printer className="mr-1 h-4 w-4" />{printing ? "Mencetak..." : "Cetak Ulang"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WaiterShiftPrintDialog;
