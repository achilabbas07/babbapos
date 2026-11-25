import { useCallback, useEffect, useState } from "react";
import { History, Search } from "lucide-react";
import { api, errMsg, rp } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { loadWithCache } from "@/lib/offlineRead";
import CachedDataNotice from "@/components/CachedDataNotice";
import DateRangeFilter from "@/components/DateRangeFilter";
import { Empty } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  canViewCustomerPurchases,
  customerPurchaseCellValue,
  customerPurchaseColumns,
  customerPurchasesCacheKey,
  normalizeCustomerPurchases,
  summarizeCustomerPurchases,
} from "@/lib/customerPurchases";

/**
 * Panel "Riwayat Transaksi" pada halaman Pelanggan.
 *
 * Memuat `GET /customers/{cid}/purchases` (endpoint BACA-SAJA) memakai pola
 * `loadWithCache` + key cache per pelanggan/rentang sehingga riwayat terakhir
 * tetap terlihat saat sinyal hilang.
 *
 * Menampilkan tepat 7 informasi: Tanggal, Waktu Order, Waktu Bayar, No. Meja,
 * Total Item, Jumlah, dan Pelayan. Tidak ada aksi tulis apa pun di panel ini
 * sehingga alur transaksi, harga, stok, dan jurnal tidak tersentuh.
 *
 * ADMIN-ONLY: panel ini hanya dirender untuk peran admin. Non-Admin tidak
 * melihat panel maupun memuat data (penegakan sebenarnya di backend).
 */
export default function CustomerPurchaseHistory({ customer, onClose }) {
  const { user } = useAuth();
  const allowed = canViewCustomerPurchases(user);
  const [range, setRange] = useState({ from: "", to: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);
  const [q, setQ] = useState("");
  const cid = customer?.id;

  const load = useCallback(async () => {
    if (!cid || !allowed) return;
    const params = {};
    if (range.from) params.start = range.from;
    if (range.to) params.end = range.to;
    setLoading(true);
    const result = await loadWithCache(
      customerPurchasesCacheKey(cid, params),
      async () => (await api.get(`/customers/${cid}/purchases`, { params })).data,
    );
    if (result.canceled) return;
    if (result.data !== undefined) {
      setRows(normalizeCustomerPurchases(result.data));
      setError(null);
    } else if (result.error) {
      setError(result.error);
    }
    setFromCache(result.fromCache);
    setCachedAt(result.updatedAt);
    setLoading(false);
  }, [cid, range, allowed]);

  useEffect(() => { load(); }, [load]);

  // ADMIN-ONLY: non-Admin tidak boleh melihat riwayat transaksi pelanggan.
  if (!customer || !allowed) return null;

  const shown = q
    ? rows.filter((r) => `${r.tanggal} ${r.waktuOrder} ${r.waktuBayar} ${r.meja} ${r.pelayan}`.toLowerCase().includes(q.toLowerCase()))
    : rows;
  const summary = summarizeCustomerPurchases(shown);
  const columns = customerPurchaseColumns();

  return (
    <div data-testid="customer-history-panel" className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <History className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Riwayat Transaksi</h2>
            <p data-testid="customer-history-name" className="truncate text-xs text-muted-foreground">
              {customer.name} &middot; {customer.id}
            </p>
          </div>
        </div>
        <button
          type="button"
          data-testid="customer-history-close"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Tutup
        </button>
      </div>

      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          data-testid="customer-history-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari meja / pelayan / tanggal"
          className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-base outline-none focus:border-primary"
        />
      </div>

      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} testidPrefix="customer-history-date-filter" />

      {error && (
        <p data-testid="customer-history-error" className="mb-3 text-sm text-destructive">{errMsg(error)}</p>
      )}

      {loading && (
        <p data-testid="customer-history-loading" className="mb-3 text-sm text-muted-foreground">Memuat riwayat&hellip;</p>
      )}

      {!loading && shown.length === 0 ? (
        <Empty testid="customer-history-empty" text="Belum ada transaksi pada rentang ini." />
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-border">
          <Table className="w-full text-base">
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key} className={`whitespace-nowrap px-4 py-3 text-sm ${c.align === "right" ? "text-right" : ""}`}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.key} data-testid={`customer-history-row-${r.key}`}>
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      data-testid={`customer-history-${r.key}-${c.key}`}
                      className={`whitespace-nowrap px-4 py-3 text-base ${c.align === "right" ? "text-right font-mono" : ""}`}
                    >
                      {customerPurchaseCellValue(c.key, r, rp)}
                      {c.key === "tanggal" && r.void && (
                        <span className="ml-2 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">VOID</span>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div data-testid="customer-history-summary" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{summary.count} transaksi &middot; {summary.totalItem} item</span>
        <span className="font-mono text-base font-semibold text-foreground">{rp(summary.total)}</span>
      </div>
    </div>
  );
}
