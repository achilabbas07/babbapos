import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SupplierDialog } from "@/components/SupplierDialog";
import { api, errMsg, rp, todayStr, dateToIso } from "@/lib/api";

export const PurchaseDialog = ({ open, onOpenChange, inventory, onSaved }) => {
  const [suppliers, setSuppliers] = useState([]);
  const [fundingAccounts, setFundingAccounts] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [fundingAccount, setFundingAccount] = useState("");
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadSuppliers = useCallback(async () => {
    try {
      const { data } = await api.get("/v1/finance/suppliers");
      const list = Array.isArray(data) ? data : [];
      setSuppliers(list);
      return list;
    } catch (error) {
      toast.error(errMsg(error));
      return null;
    }
  }, []);

  const unitCost = (totalPrice, qty) => {
    const quantity = Number(qty);
    const totalAmount = Number(totalPrice);
    return Number.isFinite(quantity) && quantity > 0 && Number.isFinite(totalAmount)
      ? totalAmount / quantity
      : 0;
  };

  useEffect(() => {
    if (open) {
      loadSuppliers();
      api.get("/finance/funding-accounts")
        .then(({ data }) => {
          if (!Array.isArray(data)) throw new Error("Respons daftar sumber dana tidak valid.");
          setFundingAccounts(data);
          setFundingAccount((current) => (
            data.some((account) => account.account_code === current)
              ? current
              : data[0]?.account_code || ""
          ));
        })
        .catch((error) => toast.error(errMsg(error)));
      setSupplierId("");
      setSupplierDialogOpen(false);
      setDate(todayStr());
      setPaymentMethod("cash");
      setFundingAccount("");
      setLines([{ inventoryId: "", qty: 1, total_price: 0, cost_per_unit: 0 }]);
    }
  }, [open, loadSuppliers]);

  const handleSupplierCreated = async (created) => {
    const createdId = created?.id != null ? String(created.id) : "";
    const list = await loadSuppliers();
    if (createdId) {
      if (!list?.some((supplier) => String(supplier.id) === createdId)) {
        setSuppliers((current) => (
          current.some((supplier) => String(supplier.id) === createdId)
            ? current
            : [...current, created]
        ));
      }
      setSupplierId(createdId);
    }
  };

  const update = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const updateQuantity = (idx, qty) => setLines((current) => current.map((line, i) => (
    i === idx ? { ...line, qty, cost_per_unit: unitCost(line.total_price, qty) } : line
  )));
  const updateTotalPrice = (idx, totalPrice) => setLines((current) => current.map((line, i) => (
    i === idx ? { ...line, total_price: totalPrice, cost_per_unit: unitCost(totalPrice, line.qty) } : line
  )));
  const total = lines.reduce((sum, line) => sum + (Number(line.total_price) || 0), 0);

  const save = async () => {
    if (!supplierId) {
      toast.error("Pilih supplier terlebih dahulu.");
      return;
    }
    if (paymentMethod === "cash" && !fundingAccount) {
      toast.error("Tidak ada akun kas atau bank yang tersedia sebagai sumber dana.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/purchases", {
        supplier_id: Number(supplierId),
        date: dateToIso(date),
        metode_pembayaran: paymentMethod,
        ...(paymentMethod === "cash" ? { sumber_dana_akun: fundingAccount } : {}),
        items: lines.filter((l) => l.inventoryId).map((l) => ({ inventoryId: l.inventoryId, qty: Number(l.qty), cost_per_unit: Number(l.cost_per_unit) })),
      });
      toast.success(paymentMethod === "credit"
        ? "Pembelian tercatat sebagai utang, stok bertambah"
        : "Pembelian tercatat, stok bertambah");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="purchase-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Pembelian Bahan</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="purchase-supplier">Supplier</Label>
            <div className="flex items-center gap-2">
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger id="purchase-supplier" data-testid="purchase-supplier-select" className="flex-1">
                  <SelectValue placeholder="Pilih supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={String(supplier.id)}>{supplier.nama_supplier}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="purchase-add-supplier"
                onClick={() => setSupplierDialogOpen(true)}
                className="shrink-0"
              >
                <Plus className="mr-1 h-4 w-4" />Supplier Baru
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5"><Label>Tanggal</Label><Input data-testid="purchase-date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="grid gap-1.5">
            <Label htmlFor="purchase-payment-method">Metode Pembayaran</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger id="purchase-payment-method" data-testid="purchase-payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Tunai</SelectItem>
                <SelectItem value="credit">Kredit / Utang</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {paymentMethod === "cash" && <div className="grid gap-1.5">
            <Label htmlFor="purchase-funding-account">Sumber Dana</Label>
            <Select value={fundingAccount} onValueChange={setFundingAccount}>
              <SelectTrigger id="purchase-funding-account" data-testid="purchase-funding-account">
                <SelectValue placeholder="Pilih sumber dana" />
              </SelectTrigger>
              <SelectContent>
                {fundingAccounts.map((account) => (
                  <SelectItem key={account.account_code} value={account.account_code}>
                    {account.account_name} ({account.account_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>}
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_90px_120px_32px] gap-2 text-xs text-muted-foreground"><span>Bahan</span><span>Qty</span><span>Total harga</span><span /></div>
          {lines.map((l, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_90px_120px_32px] items-start gap-2">
              <Select value={l.inventoryId || undefined} onValueChange={(v) => {
                const qty = Number(l.qty) || 0;
                const cost = Number(inventory.find((item) => item.id === v)?.cost_per_unit) || 0;
                update(idx, { inventoryId: v, cost_per_unit: cost, total_price: qty * cost });
              }}>
                <SelectTrigger data-testid={`purchase-inventory-${idx}`}><SelectValue placeholder="Pilih bahan" /></SelectTrigger>
                <SelectContent>{inventory.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}</SelectContent>
              </Select>
              <Input data-testid={`purchase-qty-${idx}`} type="number" step="any" min="0" value={l.qty} onChange={(e) => updateQuantity(idx, e.target.value)} className="font-mono" />
              <div className="grid gap-1">
                <Input data-testid={`purchase-total-price-${idx}`} type="number" step="any" min="0" value={l.total_price} onChange={(e) => updateTotalPrice(idx, e.target.value)} className="font-mono" />
                <span data-testid={`purchase-unit-cost-${idx}`} className="text-[10px] leading-tight text-muted-foreground">
                  Satuan: {rp(Number(l.cost_per_unit) || 0)}
                </span>
              </div>
              <button data-testid={`purchase-remove-${idx}`} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <button data-testid="purchase-add-line" onClick={() => setLines((ls) => [...ls, { inventoryId: "", qty: 1, total_price: 0, cost_per_unit: 0 }])} className="flex items-center gap-1.5 text-sm text-primary"><Plus className="h-4 w-4" />Tambah baris</button>
        </div>
        <p className="text-xs text-muted-foreground">Biaya per satuan bahan diperbarui ke harga beli terakhir, HPP produk terkait dihitung ulang.</p>
        <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
          <span className="text-sm text-muted-foreground">Total pembelian</span>
          <span data-testid="purchase-total" className="font-mono text-lg font-semibold text-primary">{rp(total)}</span>
        </div>
        <DialogFooter><Button data-testid="purchase-save-button" onClick={save} disabled={saving || !supplierId || suppliers.length === 0}>{saving ? "Menyimpan..." : "Simpan Pembelian"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <SupplierDialog
      open={supplierDialogOpen}
      onOpenChange={setSupplierDialogOpen}
      onCreated={handleSupplierCreated}
    />
    </>
  );
};
