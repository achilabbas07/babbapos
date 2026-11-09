import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { api, errMsg, fmtDate, num, rp } from "@/lib/api";
import { PageHeader, Empty } from "@/components/PageHeader";
import { PurchaseDialog } from "@/components/PurchaseDialog";
import { SupplierPaymentDialog } from "@/components/SupplierPaymentDialog";
import DateRangeFilter from "@/components/DateRangeFilter";
import { Button } from "@/components/ui/button";

export default function Purchases() {
  const [list, setList] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [open, setOpen] = useState(false);
  const [paymentPurchase, setPaymentPurchase] = useState(null);
  const [range, setRange] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    try {
      const params = {};
      if (range.from) params.start = range.from;
      if (range.to) params.end = range.to;
      const [p, i] = await Promise.all([api.get("/purchases", { params }), api.get("/inventory")]);
      setList(p.data);
      setInventory(i.data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [range]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader title="Pembelian" subtitle="Restock bahan dari supplier — stok inventory bertambah otomatis.">
        <Button data-testid="add-purchase-button" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Pembelian Baru</Button>
      </PageHeader>
      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} testidPrefix="purchases-date-filter" />
      {list.length === 0 ? <Empty testid="purchases-empty" text="Belum ada pembelian." /> : (
        <div className="space-y-3">
          {list.map((p) => (
            <details key={p.id} data-testid={`purchase-row-${p.id}`} className="group rounded-2xl border border-border bg-card px-5 py-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{p.supplier}</p>
                  <p className="font-mono text-xs text-muted-foreground">{p.id} · {fmtDate(p.date)} · oleh {p.userName}</p>
                  {p.status_pembayaran === "belum_lunas" && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium text-destructive">
                        Belum lunas - sisa utang {rp(p.sisa_utang)}
                      </p>
                      <Button
                        data-testid={`pay-supplier-${p.id}`}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setPaymentPurchase(p);
                        }}
                      >
                        Bayar Utang
                      </Button>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-mono font-semibold">{rp(p.total_cost)}</p>
                  <p className="text-xs text-muted-foreground">{p.items_json.length} bahan</p>
                  <p className="text-xs text-muted-foreground">
                    {p.metode_pembayaran === "credit" ? "Kredit" : "Tunai"}
                  </p>
                </div>
              </summary>
              <div className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
                {p.items_json.map((i, idx) => (
                  <div key={idx} className="flex justify-between text-muted-foreground">
                    <span>{i.name} · {num(i.qty)} {i.unit} × {rp(i.cost_per_unit)}</span><span className="font-mono">{rp(i.subtotal)}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
      <PurchaseDialog open={open} onOpenChange={setOpen} inventory={inventory} onSaved={load} />
      <SupplierPaymentDialog
        open={Boolean(paymentPurchase)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPaymentPurchase(null);
        }}
        purchase={paymentPurchase}
        onSaved={load}
      />
    </div>
  );
}
