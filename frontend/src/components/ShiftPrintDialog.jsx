import { Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDate, rp } from "@/lib/api";
import { printBluetoothReceipt } from "@/lib/bluetoothThermalPrinter";
import { PrintHeader } from "@/components/ReceiptDialog";

const Row = ({ label, value, bold }) => (
  <div className={`flex justify-between gap-4 ${bold ? "font-semibold" : ""}`}>
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-mono">{value}</span>
  </div>
);

export const ShiftPrintDialog = ({ shift, onClose }) => (
  <ShiftPrintContent shift={shift} onClose={onClose} />
);

const ShiftPrintContent = ({ shift, onClose }) => {
  const [printing, setPrinting] = useState(false);

  const reprint = async () => {
    setPrinting(true);
    try {
      await printBluetoothReceipt("shift", { ...shift, isReprint: true });
      toast.success("Laporan shift berhasil dicetak ulang.");
    } catch (error) {
      toast.error(error?.message || "Laporan shift gagal dicetak.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={!!shift} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="shift-print-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader><DialogTitle>Laporan Tutup Shift</DialogTitle></DialogHeader>
        {shift && (
          <div className="print-area space-y-4 text-sm">
            <div className="text-center">
              <PrintHeader testid="shift-print-header" />
              <p className="mt-1 font-semibold">LAPORAN TUTUP SHIFT</p>
              <p data-testid="shift-print-id" className="font-mono text-xs text-muted-foreground">{shift.id} · CETAK ULANG</p>
            </div>
            <div className="space-y-1 border-y border-dashed border-border py-3 text-xs">
              <Row label="Kasir" value={shift.userName} />
              <Row label="Dibuka" value={fmtDate(shift.openedAt)} />
              <Row label="Ditutup" value={shift.closedAt ? fmtDate(shift.closedAt) : "Masih terbuka"} />
              <Row label="Jumlah transaksi" value={shift.trxCount} />
            </div>
            <div className="space-y-1 text-xs">
              <Row label="Saldo awal" value={rp(shift.openingCash)} />
              <Row label="Penjualan tunai" value={rp(shift.cashSales)} />
              <Row label="Penjualan non-tunai" value={rp(shift.nonCashSales)} />
              <Row label="Total penjualan" value={rp((shift.cashSales || 0) + (shift.nonCashSales || 0))} bold />
              <Row label="Kas masuk" value={rp(shift.cashIn)} />
              <Row label="Kas keluar" value={`− ${rp(shift.cashOut)}`} />
            </div>
            <div data-testid="shift-print-totals" className="space-y-1 border-t border-dashed border-border pt-3">
              <Row label="Saldo akhir (seharusnya)" value={shift.expectedCash == null ? "—" : rp(shift.expectedCash)} bold />
              <Row label="Uang fisik" value={shift.countedCash == null ? "—" : rp(shift.countedCash)} />
              <Row label="Selisih" value={shift.difference == null ? "—" : rp(shift.difference)} bold />
              {shift.note && <p className="pt-1 text-xs text-muted-foreground">Catatan: {shift.note}</p>}
            </div>
            <div className="no-print flex">
              <button data-testid="shift-bluetooth-reprint-button" onClick={reprint} disabled={printing}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border font-medium hover:border-primary disabled:opacity-50">
                <Printer className="h-4 w-4" /> {printing ? "Mencetak..." : "Cetak Ulang Bluetooth"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
