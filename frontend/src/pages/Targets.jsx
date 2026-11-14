import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Lock } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useShift } from "@/components/ShiftGate";
import { api, errMsg } from "@/lib/api";
import { PageHeader, Empty } from "@/components/PageHeader";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { TargetDialog } from "@/components/TargetDialog";
import { ProgressCard, TargetBar } from "@/components/TargetProgress";
import { periodLabel, targetRuleSummary, targetTypeLabel } from "@/lib/targetTypes";
import { useWaiterShiftReport } from "@/hooks/useWaiterShiftReport";
import { connectBluetoothPrinter } from "@/lib/bluetoothThermalPrinter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const WaiterView = () => {
  const { refresh } = useShift();
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [closedShiftId, setClosedShiftId] = useState(null);
  const [closing, setClosing] = useState(false);
  const [connectingPrinter, setConnectingPrinter] = useState(false);
  const {
    loading: reportLoading,
    fetchError: reportFetchError,
    printing: reportPrinting,
    printError: reportPrintError,
    printed: reportPrinted,
    retryLoad: retryReportLoad,
    retryPrint,
  } = useWaiterShiftReport(closedShiftId);

  useEffect(() => {
    api.get("/targets/progress").then((r) => setProgress(r.data)).catch((e) => toast.error(errMsg(e)));
  }, []);

  const close = async () => {
    setClosing(true);
    try {
      const { data } = await api.post("/waiter-shifts/close");
      setConfirm(false);
      setResult(data);
      setClosedShiftId(data.id);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setClosing(false);
    }
  };

  const finishResult = () => {
    setResult(null);
    setClosedShiftId(null);
    refresh();
  };

  const connectAndRetryPrint = async () => {
    setConnectingPrinter(true);
    try {
      await connectBluetoothPrinter({ printerType: "kitchen" });
      await retryPrint();
    } catch (error) {
      toast.error(error?.message || "Printer Bluetooth gagal dihubungkan.");
    } finally {
      setConnectingPrinter(false);
    }
  };

  return (
    <div>
      <PageHeader title="Target Sales Saya" subtitle="Target kuantitas item dihitung saat order, target omzet dihitung saat transaksi. Reset setiap shift baru.">
        <Button data-testid="close-waiter-shift-button" onClick={() => setConfirm(true)}><Lock className="mr-1 h-4 w-4" />Tutup Shift</Button>
      </PageHeader>
      {progress === null ? <p className="py-10 text-center text-sm text-muted-foreground">Memuat target...</p> : progress.length === 0 ? <Empty testid="target-empty" text="Belum ada shift aktif." /> : <div className="max-w-2xl">{progress.map((p) => <ProgressCard key={p.shiftId} p={p} />)}</div>}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent data-testid="close-waiter-shift-dialog" className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Tutup shift sekarang?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Pencapaian target disimpan. Shift berikutnya mulai dari nol.</p>
          <DialogFooter><Button data-testid="close-waiter-shift-confirm" disabled={closing} onClick={close}>{closing ? "Menutup..." : "Ya, tutup shift"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!result} onOpenChange={(o) => { if (!o) finishResult(); }}>
        <DialogContent data-testid="waiter-shift-result-dialog" className="sm:max-w-md">
          <DialogHeader><DialogTitle>Hasil Shift</DialogTitle></DialogHeader>
          <div className="space-y-4">{(Array.isArray(result?.results) ? result.results : []).map((i) => <TargetBar key={i.targetId} item={i} testid={`result-bar-${i.targetId}`} />)}</div>
          {reportLoading && <p data-testid="waiter-shift-report-loading" className="text-sm text-muted-foreground">Memuat laporan untuk dicetak...</p>}
          {reportFetchError && (
            <div className="space-y-2" data-testid="waiter-shift-report-error">
              <p className="text-sm text-destructive">Laporan gagal dimuat: {reportFetchError}</p>
              <Button variant="outline" onClick={retryReportLoad}>Coba muat lagi</Button>
            </div>
          )}
          {reportPrinting && <p data-testid="waiter-shift-printing" className="text-sm text-muted-foreground">Mencetak laporan shift...</p>}
          {reportPrinted && <p data-testid="waiter-shift-printed" className="text-sm text-emerald-700">Laporan shift berhasil dicetak otomatis.</p>}
          {reportPrintError && (
            <div className="space-y-2" data-testid="waiter-shift-print-error">
              <p className="text-sm text-destructive">Shift sudah ditutup, tetapi laporan gagal dicetak: {reportPrintError}</p>
              <Button variant="outline" disabled={connectingPrinter || reportPrinting} onClick={connectAndRetryPrint}>
                {connectingPrinter ? "Menghubungkan printer..." : "Hubungkan printer & coba lagi"}
              </Button>
            </div>
          )}
          <DialogFooter><Button data-testid="waiter-shift-result-done" onClick={finishResult}>Selesai</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const AdminView = () => {
  const [targets, setTargets] = useState([]);
  const [products, setProducts] = useState([]);
  const [waiters, setWaiters] = useState([]);
  const [progress, setProgress] = useState([]);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      const [t, p, w, pr] = await Promise.all([api.get("/targets"), api.get("/products"), api.get("/users/waiters"), api.get("/targets/progress")]);
      setTargets(t.data); setProducts(p.data); setWaiters(w.data); setProgress(pr.data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-10">
      <div>
        <PageHeader title="Target Sales Pelayan" subtitle="Target kuantitas item, omzet, atau berbasis periode/jam. Target item dihitung saat order (bukan saat bayar), reset setiap shift baru.">
          <Button data-testid="add-target-button" onClick={() => setDialog({})}><Plus className="mr-1 h-4 w-4" />Tambah Target</Button>
        </PageHeader>
        {targets.length === 0 ? <Empty testid="targets-empty" text="Belum ada target." /> : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Target</TableHead><TableHead>Jenis</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Nilai target</TableHead><TableHead>Periode</TableHead><TableHead>Berlaku untuk</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {targets.map((t) => (
                  <TableRow key={t.id} data-testid={`target-row-${t.id}`}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <span data-testid={`target-type-${t.id}`} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{targetTypeLabel(t)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">{t.productNames.map((n) => <span key={n} className="rounded-full bg-secondary px-2 py-0.5 text-xs">{n}</span>)}</div>
                      {t.productNames.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell data-testid={`target-value-${t.id}`} className="text-right font-mono">{targetRuleSummary(t)}</TableCell>
                    <TableCell className="text-muted-foreground">{periodLabel(t)}</TableCell>
                    <TableCell className="text-muted-foreground">{t.waiterName || "Semua pelayan"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <button data-testid={`target-edit-${t.id}`} onClick={() => setDialog(t)} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                        <ConfirmDelete testid={`target-delete-${t.id}`} title={`Hapus target ${t.name}?`} onConfirm={async () => { await api.delete(`/targets/${t.id}`); load(); }} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Progres shift berjalan</h2>
        {progress.length === 0 ? <Empty testid="progress-empty" text="Tidak ada pelayan dengan shift aktif." /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{progress.map((p) => <ProgressCard key={p.shiftId} p={p} />)}</div>
        )}
      </section>
      <TargetDialog target={dialog} products={products} waiters={waiters} onClose={() => setDialog(null)} onSaved={load} />
    </div>
  );
};

export default function Targets() {
  const { user } = useAuth();
  return user.role === "waiter" ? <WaiterView /> : <AdminView />;
}
