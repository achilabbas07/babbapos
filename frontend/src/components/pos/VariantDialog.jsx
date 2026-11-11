import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { rp } from "@/lib/api";

const StockBadge = ({ v }) => {
  if (v.available == null) return null;
  if (v.available <= 0) return <span data-testid={`variant-out-${v.id}`} className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{v.available < 0 ? "Stok Minus" : "Stok 0"}</span>;
  if (v.available <= 5) return <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Sisa {v.available}</span>;
  return null;
};

export const VariantDialog = ({ product, variants, basePrice, priceOf, onPick, onClose }) => (
  <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
    <DialogContent data-testid="variant-dialog" className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{product?.name}</DialogTitle>
        <DialogDescription>Pilih variasi rasa / ukuran. Harga dasar {rp(basePrice)}. Harga Ojol ber-varian dihitung otomatis dari markup global.</DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
        {variants.map((v) => (
          <button key={v.id} data-testid={`variant-option-${v.id}`} onClick={() => onPick(v)}
            className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-primary hover:bg-secondary/50">
            <span className="min-w-0 font-medium">{v.variant_name}<StockBadge v={v} /></span>
            <span className="shrink-0 text-right font-mono text-sm">
              {v.additional_price > 0 && <span className="block text-xs text-muted-foreground">+ {rp(v.additional_price)}</span>}
              <span className="font-semibold text-primary">{rp(priceOf ? priceOf(v) : basePrice + Number(v.additional_price || 0))}</span>
            </span>
          </button>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
