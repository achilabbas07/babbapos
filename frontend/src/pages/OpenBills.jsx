import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Ban } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, fmtDate, itemName, rp } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { combineCacheResults, loadWithCache } from "@/lib/offlineRead";
import { groupOrderItemsForDisplay } from "@/lib/openBillDisplay";
import { notifyOpenBillsChanged } from "@/lib/openBillCount";
import { PageHeader, Empty } from "@/components/PageHeader";
import CachedDataNotice from "@/components/CachedDataNotice";
import { AdminPinDialog } from "@/components/tables/AdminPinDialog";

export default function OpenBills() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [bills, setBills] = useState([]);
  const [tables, setTables] = useState({});
  const [voidBill, setVoidBill] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  // Muat open bill + denah meja dengan fallback cache lokal, sehingga saat
  // offline daftar bill terakhir tetap tampil (tidak terblokir pesan gagal).
  const load = useCallback(async () => {
    const [b, t] = await Promise.all([
      loadWithCache(CACHE_KEYS.OPEN_BILLS, async () => (await api.get("/open-bills")).data),
      loadWithCache(CACHE_KEYS.TABLES, async () => (await api.get("/tables")).data),
    ]);
    if (b.data !== undefined) setBills(Array.isArray(b.data) ? b.data : []);
    if (t.data !== undefined) setTables(Object.fromEntries((t.data || []).map((x) => [x.id, x.name])));
    const combined = combineCacheResults([b, t]);
    setFromCache(combined.fromCache);
    setCachedAt(b.updatedAt || t.updatedAt || null);
    if (combined.fromCache) notifyOpenBillsChanged();
    if (combined.error) toast.error(errMsg(combined.error));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader title="Open Bill" subtitle="Pesanan tersimpan yang belum dibayar. Lanjutkan untuk menambah item atau membayar." />
      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />
      {bills.length === 0 ? <Empty testid="open-bills-empty" text="Tidak ada open bill." /> : (
        <div className="android-bills-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bills.map((b) => (
            <div key={b.id} data-testid={`open-bill-${b.id}`} className="android-bill-card flex flex-col rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-sm text-primary">{b.id}</p>
                  <p className="mt-1 text-lg font-semibold">{b.customerName || "Pelanggan umum"}</p>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">{b.type}{b.tableId ? ` · ${tables[b.tableId] || b.tableId}` : ""}</span>
              </div>
              <ul className="mt-4 flex-1 space-y-1 text-sm text-muted-foreground">
                {groupOrderItemsForDisplay(b.items_json).map((i) => <li key={`${i.productId || i.id_menu || i.displayName || itemName(i)}:${i.variantId ?? i.variantName ?? ""}:${i.notes || ""}`} className="flex justify-between"><span>{i.qty}× {i.displayName || itemName(i)}</span><span className="font-mono">{rp(i.subtotal)}</span></li>)}
              </ul>
              <div className="mt-4 flex items-end justify-between border-t border-border pt-4">
                <div className="text-xs text-muted-foreground">
                  <p>{fmtDate(b.timestamp)}</p>
                  <p>Waiter: {b.waiterName || "-"} · Input: {b.userName}</p>
                </div>
                <p data-testid={`open-bill-total-${b.id}`} className="font-mono text-lg font-bold">{rp(b.total)}</p>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  data-testid={`open-bill-resume-${b.id}`}
                  onClick={() => nav(`/pos?bill=${b.id}`)}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  {user.role === "waiter" ? "Tambah item" : "Lanjutkan / Bayar"} <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  data-testid={`open-bill-void-${b.id}`}
                  onClick={() => setVoidBill(b)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Ban className="h-4 w-4" />Void
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <AdminPinDialog open={!!voidBill} onClose={() => setVoidBill(null)} testid="void-pin" needPin={user.role !== "admin"} withReason
        title={`Void ${voidBill?.id || ""}`} description="Bill dihapus dan meja dikosongkan. Stok tidak berubah. Tercatat di log void."
        onSubmit={async ({ pin, reason }) => { await api.post(`/open-bills/${voidBill.id}/void`, { adminPin: pin || null, reason }); toast.success("Bill di-void"); setVoidBill(null); load(); }} />
    </div>
  );
}
