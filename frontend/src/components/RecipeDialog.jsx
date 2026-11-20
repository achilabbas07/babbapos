import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { api, errMsg, rp } from "@/lib/api";

export const RecipeDialog = ({ product, inventory, onClose, onSaved }) => {
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));

  useEffect(() => {
    if (product) {
      api.get(`/products/${product.id}/recipes`).then((r) => setLines(r.data.map((x) => ({ inventoryId: x.inventoryId, qty_needed: x.qty_needed })))).catch((e) => toast.error(errMsg(e)));
    }
  }, [product]);

  const hpp = lines.reduce((s, l) => s + (Number(l.qty_needed) || 0) * (invMap[l.inventoryId]?.cost_per_unit || 0), 0);
  const update = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/products/${product.id}/recipes`, lines.filter((l) => l.inventoryId).map((l) => ({ inventoryId: l.inventoryId, qty_needed: Number(l.qty_needed) })));
      toast.success("Resep tersimpan, HPP diperbarui");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="recipe-dialog" className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Resep · {product?.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Bahan per 1 porsi. Stok bahan berkurang otomatis saat transaksi dibayar.</p>
        <div className="space-y-2">
          {lines.map((l, idx) => (
            <div key={idx} data-testid={`recipe-line-${idx}`} className="grid grid-cols-[1fr_110px_90px_32px] items-center gap-2">
              <Select value={l.inventoryId || undefined} onValueChange={(v) => update(idx, { inventoryId: v })}>
                <SelectTrigger data-testid={`recipe-inventory-${idx}`}><SelectValue placeholder="Pilih bahan" /></SelectTrigger>
                <SelectContent>{inventory.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}</SelectContent>
              </Select>
              <div className="relative">
                <input data-testid={`recipe-qty-${idx}`} type="number" step="any" value={l.qty_needed} onChange={(e) => update(idx, { qty_needed: e.target.value })}
                  className="h-10 w-full rounded-md border border-border bg-transparent px-3 pr-10 font-mono text-sm outline-none focus:border-primary" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{invMap[l.inventoryId]?.unit}</span>
              </div>
              <span className="text-right font-mono text-xs text-muted-foreground">{rp((Number(l.qty_needed) || 0) * (invMap[l.inventoryId]?.cost_per_unit || 0))}</span>
              <button data-testid={`recipe-remove-${idx}`} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <button data-testid="recipe-add-line" onClick={() => setLines((ls) => [...ls, { inventoryId: "", qty_needed: 1 }])} className="flex items-center gap-1.5 text-sm text-primary">
            <Plus className="h-4 w-4" /> Tambah bahan
          </button>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
          <span className="text-sm text-muted-foreground">HPP per porsi</span>
          <span data-testid="recipe-hpp" className="font-mono text-lg font-semibold text-primary">{rp(hpp)}</span>
        </div>
        <DialogFooter>
          <Button data-testid="recipe-save-button" onClick={save} disabled={saving}>{saving ? "Menyimpan..." : "Simpan Resep"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
