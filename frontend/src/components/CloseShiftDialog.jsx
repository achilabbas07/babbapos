import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api, errMsg, rp } from "@/lib/api";
import { printBluetoothReceipt, printerTypeForDocType } from "@/lib/bluetoothThermalPrinter";

const Row = ({ label, value, strong, tone = "", testid }) => (
  <div className={`flex justify-between py-1.5 text-sm ${strong ? "font-semibold" : ""}`}>
    <span className="text-muted-foreground">{label}</span>
    <span data-testid={testid} className={`font-mono ${tone}`}>{value}</span>
  </div>
);

const Summary = ({ s, onDone }) => {
  const diff = s.difference || 0;
  return (
    <>
      <div data-testid="close-shift-summary" className="divide-y divide-border rounded-xl border border-border px-4">
        <Row label="Kas awal" value={rp(s.openingCash)} />
        <Row label="Penjualan tunai" value={rp(s.cashSales)} />
        <Row label="Kas masuk" value={rp(s.cashIn)} />
        <Row label="Kas keluar" value={`− ${rp(s.cashOut)}`} />
        <Row label="Seharusnya di laci" value={rp(s.expectedCash)} strong testid="close-expected" />
        <Row label="Uang fisik dihitung" value={rp(s.countedCash)} strong testid="close-counted" />
        <Row label="Selisih" value={`${diff > 0 ? "+" : ""}${rp(diff)}`} strong testid="close-difference"
          tone={diff === 0 ? "text-emerald-600" : diff > 0 ? "text-blue-600" : "text-destructive"} />
      </div>
      <p className="text-xs text-muted-foreground">Non-tunai (QRIS/Kartu/Debit): {rp(s.nonCashSales)} · {s.trxCount} transaksi</p>
      <DialogFooter><Button data-testid="close-shift-done" onClick={onDone}>Selesai</Button></DialogFooter>
    </>
  );
};

export const CloseShiftDialog = ({ open, onOpenChange, onClosed }) => {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCounted("");
      setNote("");
      setResult(null);
      setError("");
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/shifts/close", { countedCash: Number(counted) || 0, note });
      setResult(data);
      try {
        await printBluetoothReceipt("shift", data, { printerType: printerTypeForDocType("shift") });
        toast.success("Shift ditutup dan laporan berhasil dicetak.");
      } catch (printError) {
        toast.error(`Shift ditutup, tetapi laporan gagal dicetak: ${printError.message}`);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    onOpenChange(false);
    onClosed();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (result ? finish() : onOpenChange(o))}>
      <DialogContent data-testid="close-shift-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{result ? "Shift Ditutup" : "Tutup Kasir"}</DialogTitle>
          {!result && <DialogDescription>Mode blind: hitung seluruh uang fisik di laci lalu masukkan jumlahnya. Sistem akan menghitung selisih setelah disimpan.</DialogDescription>}
        </DialogHeader>
        {result ? <Summary s={result} onDone={finish} /> : (
          <div className="space-y-4">
            <input data-testid="counted-cash-input" type="number" inputMode="numeric" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)}
              placeholder="Total uang fisik di laci" className="h-14 w-full rounded-xl border border-border bg-white px-4 font-mono text-2xl outline-none focus:border-primary" />
            <textarea data-testid="close-note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)"
              className="h-20 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary" />
            {error && <p data-testid="close-shift-error" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button data-testid="close-shift-submit" disabled={busy || counted === ""} onClick={submit}>{busy ? "Menyimpan..." : "Tutup Shift"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
