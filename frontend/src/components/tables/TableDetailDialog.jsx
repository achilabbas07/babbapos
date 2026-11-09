import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PlusCircle, CreditCard, Split, Merge, MoveRight, Printer, ChefHat, Ban, Eraser, CalendarClock, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, errorCode, fmtDate, fmtTime, itemKey, itemName, rp } from "@/lib/api";
import { STATUS } from "@/components/tables/FloorCanvas";
import { PayDialog } from "@/components/pos/PayDialog";
import { SplitBillDialog } from "@/components/tables/SplitBillDialog";
import { PickTableDialog } from "@/components/tables/PickTableDialog";
import { AdminPinDialog } from "@/components/tables/AdminPinDialog";
import { PrintTicketDialog } from "@/components/tables/PrintTicketDialog";
import { groupOrderItemsForDisplay } from "@/lib/openBillDisplay";

const Action = ({ icon: Icon, label, onClick, testid, tone = "", lock }) => (
  <button
    data-testid={testid}
    type="button"
    onClick={onClick}
    className={`relative flex touch-manipulation flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-xs font-semibold transition-colors hover:border-primary active:scale-[0.97] ${tone}`}
  >
    <Icon className="h-5 w-5" />
    {label}
    {lock && <span className="absolute right-1.5 top-1.5 rounded bg-secondary px-1 text-[9px] font-medium text-muted-foreground">PIN</span>}
  </button>
);

const BillSummary = ({ bill }) => (
  <div className="rounded-xl border border-border">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span className="font-mono text-primary">{bill.id}</span>
      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtTime(bill.timestamp)}</span>
      <span>Waiter: {bill.waiterName || "-"}</span>
      <span>{bill.customerName || "Pelanggan umum"}</span>
    </div>
    <div data-testid="table-detail-items" className="max-h-56 space-y-1.5 overflow-y-auto px-4 py-3 text-sm">
      {groupOrderItemsForDisplay(bill.items_json).map((i) => (
        <div key={`${itemKey(i)}:${i.notes || ""}`} className="flex justify-between gap-3">
          <span>{i.qty}× {i.displayName || itemName(i)}{i.notes && <span className="text-xs text-muted-foreground"> · {i.notes}</span>}</span>
          <span className="font-mono">{rp(i.subtotal)}</span>
        </div>
      ))}
    </div>
    <div className="flex justify-between border-t border-border px-4 py-3">
      <span className="text-sm text-muted-foreground">Total</span>
      <span data-testid="table-detail-total" className="font-mono text-xl font-bold text-primary">{rp(bill.total)}</span>
    </div>
  </div>
);

export const TableDetailDialog = ({ table, tables, onClose, onChanged, onPaid }) => {
  const { user } = useAuth();
  const nav = useNavigate();
  const [bill, setBill] = useState(null);
  const [mode, setMode] = useState(null);
  const [pay, setPay] = useState(null);
  const [busy, setBusy] = useState(false);
  const paymentInFlight = useRef(false);
  const isAdmin = user.role === "admin";
  const canPay = user.role !== "waiter";
  const billId = table?.orderData?.openBillId;

  useEffect(() => {
    const controller = new AbortController();
    setBill(null);
    if (table?.status === "occupied" && billId) {
      api.get(`/open-bills/${billId}`, { signal: controller.signal })
        .then((r) => setBill(r.data))
        .catch((e) => {
          if (!controller.signal.aborted) toast.error(errMsg(e));
        });
    }
    return () => controller.abort();
  }, [table?.id, table?.status, billId]);

  const run = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast.success(msg);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doPay = async (method, cashGiven, extra = {}) => {
    if (paymentInFlight.current) return;
    paymentInFlight.current = true;
    setBusy(true);
    try {
      const { data } = await api.post("/transactions", {
        type: bill.type, tableId: bill.tableId, customerId: bill.customerId, customerName: bill.customerName, waiterName: bill.waiterName,
        queueNumber: bill.queueNumber,
        items: pay.items.map(({ id, is_printed, productId, qty, notes, variantId }) => ({ id, is_printed, productId, qty, notes, variantId: variantId ?? null })), method, cashGiven, openBillId: bill.id, partial: pay.partial, ...extra,
      });
      const partial = pay.partial;
      setPay(null);
      setMode(null);
      onPaid(data, partial);
      if (partial) {
        try {
          const updatedBill = await api.get(`/open-bills/${bill.id}`);
          setBill(updatedBill.data);
        } catch (error) {
          toast.error(`Pembayaran berhasil, tetapi data sisa bill gagal dimuat ulang: ${errMsg(error)}`);
        }
      }
    } catch (e) {
      if (isAdmin && errorCode(e) === "SHIFT_NOT_OPEN") {
        setPay(null);
        setMode(null);
        toast.error(errMsg(e));
        nav("/cash");
        return;
      }
      toast.error(errMsg(e));
    } finally {
      paymentInFlight.current = false;
      setBusy(false);
    }
  };

  const others = tables.filter((t) => t.kind !== "fixture" && t.id !== table?.id);
  const s = STATUS[table?.status] || STATUS.available;

  return (
    <>
      <Dialog open={!!table && !mode && !pay} onOpenChange={(o) => !o && onClose()}>
        <DialogContent data-testid="table-detail-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {table?.name}
              <span data-testid="table-detail-status" className={`flex items-center gap-1.5 text-xs font-medium ${s.text}`}><span className={`h-2 w-2 rounded-full ${s.dot}`} />{s.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{table?.area}</span>
            </DialogTitle>
          </DialogHeader>

          {table?.status === "occupied" && (bill ? (
            <div className="space-y-4">
              <BillSummary bill={bill} />
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                <Action testid="action-add-order" icon={PlusCircle} label="Tambah Pesanan" onClick={() => nav(`/pos?bill=${bill.id}`)} />
                {canPay && <Action testid="action-pay" icon={CreditCard} label="Bayar" tone="bg-primary text-primary-foreground border-primary hover:bg-primary/90" onClick={() => setPay({ items: bill.items_json, partial: false })} />}
                {canPay && <Action testid="action-split" icon={Split} label="Pisah Bill" onClick={() => setMode("split")} />}
                <Action testid="action-merge" icon={Merge} label="Gabung Meja" onClick={() => setMode("merge")} />
                <Action testid="action-move" icon={MoveRight} label="Pindah Meja" onClick={() => setMode("move")} />
                <Action testid="action-print-bill" icon={Printer} label="Cetak Bill" onClick={() => setMode("printBill")} />
                <Action testid="action-print-kitchen" icon={ChefHat} label="Cetak Dapur" lock={!isAdmin}
                  onClick={() => setMode(isAdmin ? "printKitchen" : "pinKitchen")} />
                <Action testid="action-void" icon={Ban} label="Void" lock={!isAdmin} tone="text-destructive hover:border-destructive" onClick={() => setMode("void")} />
              </div>
            </div>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">Memuat pesanan...</p>)}

          {table?.status === "paid" && (
            <div className="space-y-4">
              <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700">
                <p className="font-semibold">Pesanan sudah lunas</p>
                <p data-testid="table-paid-info" className="mt-1 font-mono text-xs">{table.orderData?.lastTransactionId} · {rp(table.orderData?.total)} · {fmtDate(table.orderData?.paidAt)}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Action testid="action-clear-table" icon={Eraser} label="Kosongkan Meja" tone="bg-primary text-primary-foreground border-primary"
                  onClick={() => run(() => api.put(`/tables/${table.id}/status`, { status: "available" }), `${table.name} dikosongkan`)} />
                <Action testid="action-new-order" icon={PlusCircle} label="Pesanan Baru" onClick={() => nav(`/pos?table=${table.id}`)} />
              </div>
            </div>
          )}

          {(table?.status === "available" || table?.status === "reserved") && (
            <div className="grid grid-cols-2 gap-2">
              <Action testid="action-new-order" icon={PlusCircle} label="Buat Pesanan" tone="bg-primary text-primary-foreground border-primary" onClick={() => nav(`/pos?table=${table.id}`)} />
              <Action testid="action-toggle-reserve" icon={CalendarClock} label={table.status === "reserved" ? "Batal Reservasi" : "Reservasi"}
                onClick={() => run(() => api.put(`/tables/${table.id}/status`, { status: table.status === "reserved" ? "available" : "reserved" }))} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SplitBillDialog bill={bill} open={mode === "split"} onClose={() => setMode(null)} onConfirm={(items) => setPay({ items, partial: true })} />
      <PayDialog open={!!pay} onOpenChange={(o) => !o && setPay(null)} total={(pay?.items || []).reduce((sum, i) => sum + i.price * i.qty, 0)} onPay={doPay} busy={busy} customerId={bill?.customerId || null} />
      <PickTableDialog open={mode === "merge"} onClose={() => setMode(null)} testid="merge-table" title={`Gabungkan meja lain ke ${table?.name}`}
        options={others.filter((t) => t.status === "occupied")}
        onPick={(t) => run(async () => { await api.post(`/open-bills/${bill.id}/merge`, { sourceBillId: t.orderData.openBillId }); setMode(null); }, `${t.name} digabung ke ${table.name}`)} />
      <PickTableDialog open={mode === "move"} onClose={() => setMode(null)} testid="move-table" title={`Pindahkan pesanan ${table?.name} ke...`}
        options={others.filter((t) => t.status !== "occupied")}
        onPick={(t) => run(async () => { await api.post(`/open-bills/${bill.id}/move`, { tableId: t.id }); setMode(null); onClose(); }, `Pesanan dipindah ke ${t.name}`)} />
      <PrintTicketDialog bill={bill} tableName={table?.name} mode={mode === "printBill" ? "bill" : mode === "printKitchen" ? "kitchen" : null} onClose={() => setMode(null)} />
      <AdminPinDialog open={mode === "pinKitchen"} onClose={() => setMode(null)} testid="kitchen-pin" needPin
        title="Otorisasi Cetak Dapur" description="Masukkan PIN admin untuk mencetak order dapur."
        onSubmit={async ({ pin }) => { await api.post("/auth/verify-admin", { pin }); setMode("printKitchen"); }} />
      <AdminPinDialog open={mode === "void"} onClose={() => setMode(null)} testid="void-pin" needPin={!isAdmin} withReason title={`Void ${bill?.id || ""}`}
        description="Bill dihapus dan meja dikosongkan. Tindakan tercatat di log void."
        onSubmit={async ({ pin, reason }) => { await api.post(`/open-bills/${bill.id}/void`, { adminPin: pin || null, reason }); toast.success("Bill di-void"); setMode(null); onClose(); onChanged(); }} />
    </>
  );
};
