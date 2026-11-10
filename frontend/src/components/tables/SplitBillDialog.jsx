import { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { itemName, rp } from "@/lib/api";

// Unique key for a single bill row. Rows are addressed by their persisted item
// id so identical products sitting on separate rows keep independent state.
// Legacy bills without ids fall back to a stable composite including the index.
const rowKeyOf = (item, index) =>
  item.id || `${item.productId}:${item.variantId ?? ""}:${item.notes || ""}:${index}`;

export const SplitBillDialog = ({ bill, open, onClose, onConfirm }) => {
  const [qty, setQty] = useState({});

  useEffect(() => {
    if (open) {
      setQty({});
    }
  }, [open]);

  const rows = useMemo(
    () => (bill?.items_json || []).map((item, index) => ({ item, key: rowKeyOf(item, index) })),
    [bill],
  );

  if (!bill) return null;

  const change = (key, max, d) =>
    setQty((q) => ({ ...q, [key]: Math.min(max, Math.max(0, (q[key] || 0) + d)) }));
  const selected = rows
    .filter(({ key }) => (qty[key] || 0) > 0)
    .map(({ item, key }) => ({ ...item, qty: qty[key] }));
  const total = selected.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="split-bill-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pisah Bill · {bill.id}</DialogTitle>
          <DialogDescription>Pilih item yang dibayar terpisah. Sisa item tetap di bill meja ini.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map(({ item, key }) => (
            <div key={key} data-testid={`split-item-${key}`} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{itemName(item)}</p>
                <p className="font-mono text-xs text-muted-foreground">{rp(item.price)} · di bill: {item.qty}</p>
              </div>
              <div className="flex items-center rounded-lg border border-border">
                <button data-testid={`split-dec-${key}`} disabled={(qty[key] || 0) <= 0} onClick={() => change(key, item.qty, -1)} className="grid h-8 w-8 place-items-center disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                <span data-testid={`split-qty-${key}`} className="w-7 text-center font-mono text-sm">{qty[key] || 0}</span>
                <button data-testid={`split-inc-${key}`} disabled={(qty[key] || 0) >= item.qty} onClick={() => change(key, item.qty, 1)} className="grid h-8 w-8 place-items-center disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
          <span className="text-sm text-muted-foreground">Total dibayar terpisah</span>
          <span data-testid="split-total" className="font-mono text-lg font-semibold text-primary">{rp(total)}</span>
        </div>
        <DialogFooter>
          <Button data-testid="split-confirm-button" disabled={!selected.length} onClick={() => onConfirm(selected)}>Lanjut Bayar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
