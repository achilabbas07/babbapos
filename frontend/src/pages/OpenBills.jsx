import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Ban, CloudOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, fmtDate, itemName, rp } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { combineCacheResults, loadWithCache } from "@/lib/offlineRead";
import { OFFLINE_BILL_STATUS_LABEL, offlineBillActionLabel, isOfflineMode, mergeOfflineBills, pendingOpenBillsFromQueue } from "@/lib/offlineOpenBills";
import { useTransactionQueue } from "@/hooks/useTransactionQueue";
import { QUEUE_SYNC_EVENT } from "@/lib/queueSync";
import { groupOrderItemsForDisplay, openBillsGrandTotal } from "@/lib/openBillDisplay";
import { notifyOpenBillsChanged, OPEN_BILLS_CHANGED_EVENT } from "@/lib/openBillCount";
import { subscribeToOpenBillsRealtime } from "@/lib/realtimeOpenBills";
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
  const [offline, setOffline] = useState(() => isOfflineMode());
  const reloadOnSyncRef = useRef(false);
  const lastChangedReloadRef = useRef(0);
  const { items: queueItems } = useTransactionQueue(true);

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

  // Deteksi mode offline (untuk proyeksi antrean) + muat ulang SEGAR dari
  // server begitu antrean selesai disinkronkan setelah koneksi kembali.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const sync = () => setOffline(isOfflineMode());
    const onOnline = () => { reloadOnSyncRef.current = true; };
    const onSynced = () => {
      if (!reloadOnSyncRef.current) return;
      reloadOnSyncRef.current = false;
      load();
    };
    // Muat ulang saat daftar Open Bill berubah dari aksi lokal (bill
    // dibuat/di-update/dibayar/di-void di halaman lain perangkat ini) supaya
    // total di header ikut ter-update. Dibatasi ~1,5 dtk agar tidak berulang
    // saat fallback cache aktif, namun tetap real-time.
    const onBillsChanged = () => {
      const now = Date.now();
      if (now - lastChangedReloadRef.current < 1500) return;
      lastChangedReloadRef.current = now;
      load();
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("online", onOnline);
    window.addEventListener(QUEUE_SYNC_EVENT, onSynced);
    window.addEventListener(OPEN_BILLS_CHANGED_EVENT, onBillsChanged);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(QUEUE_SYNC_EVENT, onSynced);
      window.removeEventListener(OPEN_BILLS_CHANGED_EVENT, onBillsChanged);
    };
  }, [load]);

  // Update real-time lintas perangkat: berlangganan perubahan tabel open_bills
  // (Supabase Realtime) lalu muat ulang daftar. Best-effort — bila Realtime
  // belum dikonfigurasi, helper mengembalikan no-op dan halaman tetap akurat
  // via muat-ulang saat mount/navigasi dan event lokal di atas.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const unsubscribe = subscribeToOpenBillsRealtime(() => load());
    return () => unsubscribe();
  }, [load]);

  const offlineBills = useMemo(
    () => (offline ? pendingOpenBillsFromQueue(queueItems) : []),
    [offline, queueItems],
  );
  const displayBills = useMemo(
    () => (offline ? mergeOfflineBills(bills, offlineBills) : bills),
    [offline, bills, offlineBills],
  );
  // Total nominal seluruh Open Bill yang tampil (termasuk bill proyeksi offline).
  const grandTotal = useMemo(() => openBillsGrandTotal(displayBills), [displayBills]);
  // Label sesuai permintaan memakai "Rp." (titik), sedangkan helper `rp()`
  // mengembalikan "Rp " — titik ditambahkan tanpa mengubah format ribuan.
  const grandTotalLabel = useMemo(() => `Total Open Bill ${rp(grandTotal).replace(/^Rp/, "Rp.")}`, [grandTotal]);

  return (
    <div>
      <PageHeader title="Open Bill" subtitle="Pesanan tersimpan yang belum dibayar. Lanjutkan untuk menambah item atau membayar.">
        <p
          data-testid="open-bills-grand-total"
          className="font-mono text-lg font-bold tracking-tight text-[#1e3a8a] sm:text-xl"
        >
          {grandTotalLabel}
        </p>
      </PageHeader>
      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />
      {offline && offlineBills.length > 0 && (
        <div data-testid="open-bills-offline-notice" className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {offlineBills.length} Open Bill tersimpan lokal dan sedang menunggu terkirim. Data akan disinkronkan otomatis saat online; daftar di-refresh setelah sinkronisasi berhasil.
          </span>
        </div>
      )}
      {displayBills.length === 0 ? <Empty testid="open-bills-empty" text="Tidak ada open bill." /> : (
        <div className="android-bills-grid grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {displayBills.map((b) => (
            <div key={b.id} data-testid={`open-bill-${b.id}`} data-offline={b.offline ? "true" : undefined}
              className={`android-bill-card flex flex-col rounded-2xl border bg-card p-5 ${b.offline ? "border-amber-400 ring-1 ring-amber-300/60" : "border-border"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-sm text-primary">{b.id}</p>
                  <p className="mt-1 text-lg font-semibold">{b.customerName || "Pelanggan umum"}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">{b.type}{b.tableId ? ` · ${tables[b.tableId] || b.tableId}` : ""}</span>
                  {b.offline && (
                    <span data-testid={`open-bill-offline-badge-${b.id}`} className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      <CloudOff className="h-3 w-3" />{offlineBillActionLabel(b.queuedType)} · {OFFLINE_BILL_STATUS_LABEL[b.queuedStatus] || b.queuedStatus}
                    </span>
                  )}
                </div>
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
                  onClick={() => (b.offline
                    ? (nav(`/pos?offline-bill=${b.id}`), notifyOpenBillsChanged())
                    : nav(`/pos?bill=${b.id}`))}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  {user.role === "waiter" ? "Tambah item" : "Lanjutkan / Bayar"} <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  data-testid={`open-bill-void-${b.id}`}
                  onClick={() => (b.offline ? toast.error("Bill ini belum tersimpan di server. Tunggu koneksi kembali sebelum void.") : setVoidBill(b))}
                  title={b.offline ? "Belum tersimpan di server" : undefined}
                  className={`inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm hover:bg-destructive/10 hover:text-destructive ${b.offline ? "cursor-not-allowed text-muted-foreground/50" : "text-muted-foreground"}`}
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
