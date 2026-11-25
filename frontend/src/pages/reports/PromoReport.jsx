import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Search } from "lucide-react";
import { api, errMsg, rp, num, fmtDate, todayStr, daysAgoStr } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache, rangeCacheKey } from "@/lib/offlineRead";
import { useAuth } from "@/context/AuthContext";
import { isAdminRole } from "@/lib/openBillDisplay";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import CachedDataNotice from "@/components/CachedDataNotice";
import DateRangeFilter from "@/components/DateRangeFilter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildPromoRecap, filterPromoItems, normalizePromoReport, promoCodeLabel } from "@/lib/promoData";

const formatWhen = (row) => (row.timestamp ? fmtDate(row.timestamp) : row.date || "-");

export default function PromoReport() {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user);
  const [range, setRange] = useState({ from: daysAgoStr(6), to: todayStr() });
  const [query, setQuery] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  // Laporan ini ADMIN-only. Route sudah dijaga `Protected`; guard di sini
  // mencegah endpoint dipanggil bila halaman entah bagaimana dirender untuk
  // peran non-admin (defense-in-depth, sejalan dengan guard backend 403).
  const load = useCallback(() => {
    if (!isAdmin) {
      setReport(normalizePromoReport(null));
      return Promise.resolve();
    }
    const params = {};
    if (range.from) params.start = range.from;
    if (range.to) params.end = range.to;
    setLoading(true);
    return loadWithCache(
      rangeCacheKey(CACHE_KEYS.PROMO_REPORT, params),
      async () => (await api.get("/reports/promo-usage", { params })).data,
    )
      .then((result) => {
        if (result.canceled) return;
        if (result.data !== undefined) setReport(normalizePromoReport(result.data));
        setFromCache(result.fromCache);
        setCachedAt(result.updatedAt);
        if (result.error) {
          toast.error(errMsg(result.error));
          setReport(normalizePromoReport(null));
        }
      })
      .finally(() => setLoading(false));
  }, [range, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => filterPromoItems(report?.items || [], query), [report, query]);

  // Rekap per promo mengikuti hasil filter pencarian agar konsisten dengan tabel.
  const promos = useMemo(() => {
    if (!query.trim()) return report?.promos || [];
    return buildPromoRecap(items);
  }, [report, items, query]);

  const filteredDiscount = items.reduce((sum, row) => sum + row.promoDiscount, 0);
  const filteredValue = items.reduce((sum, row) => sum + row.total, 0);

  const isFiltering = query.trim().length > 0;

  return (
    <div>
      <PageHeader
        title="Laporan Promo"
        subtitle="Transaksi yang memakai kode promo beserta nilai diskonnya pada rentang tanggal terpilih."
      >
        <button
          type="button"
          data-testid="promo-report-refresh"
          onClick={load}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-secondary"
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat ulang
        </button>
      </PageHeader>

      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />

      <DateRangeFilter
        from={range.from}
        to={range.to}
        onChange={setRange}
        testidPrefix="promo-report-date-filter"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Transaksi Ber-promo"
          value={num(isFiltering ? items.length : report?.totalTransactions ?? 0)}
          hint={isFiltering ? "Mengikuti hasil pencarian" : `${report?.promoCount ?? 0} kode promo terpakai`}
          testid="promo-report-total-transactions"
        />
        <StatCard
          label="Total Diskon Promo"
          value={rp(filteredDiscount)}
          tone="text-emerald-600"
          hint={isFiltering ? "Mengikuti hasil pencarian" : `${items.length} baris transaksi`}
          testid="promo-report-total-discount"
        />
        <StatCard
          label="Total Nilai Transaksi"
          value={rp(isFiltering ? filteredValue : report?.totalTransactionValue ?? 0)}
          hint="Nilai transaksi setelah diskon promo"
          testid="promo-report-total-value"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Rekap per Kode Promo
          </h2>
        </div>
        {promos.length === 0 ? (
          <div className="p-4">
            <Empty text="Belum ada promo yang terpakai pada rentang tanggal ini." testid="promo-report-recap-empty" />
          </div>
        ) : (
          <div data-testid="promo-report-recap-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode Promo</TableHead>
                  <TableHead className="text-right">Transaksi</TableHead>
                  <TableHead className="text-right">Diskon Promo</TableHead>
                  <TableHead className="text-right">Nilai Transaksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promos.map((p, index) => (
                  <TableRow key={p.key} data-testid={`promo-report-recap-row-${index + 1}`}>
                    <TableCell className="font-medium">{promoCodeLabel(p.code)}</TableCell>
                    <TableCell className="text-right font-mono">{num(p.transactions)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">{rp(p.promoDiscount)}</TableCell>
                    <TableCell className="text-right font-mono">{rp(p.transactionValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Rincian Transaksi Ber-promo
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              data-testid="promo-report-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari no. transaksi, kode promo, pelanggan, atau kasir…"
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm"
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-4">
            <Empty
              text={
                report && report.items.length > 0
                  ? "Tidak ada transaksi ber-promo yang cocok dengan pencarian."
                  : "Belum ada transaksi ber-promo pada rentang tanggal ini."
              }
              testid="promo-report-empty"
            />
          </div>
        ) : (
          <div data-testid="promo-report-table" className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Waktu / Tanggal</TableHead>
                  <TableHead>No. Transaksi</TableHead>
                  <TableHead>Kode Promo</TableHead>
                  <TableHead>Nama Pelanggan</TableHead>
                  <TableHead className="text-right">Nilai Transaksi</TableHead>
                  <TableHead className="text-right">Diskon Promo</TableHead>
                  <TableHead>Kasir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row, index) => (
                  <TableRow key={row.key} data-testid={`promo-report-row-${index + 1}`}>
                    <TableCell className="text-right font-mono text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(row)}</TableCell>
                    <TableCell className="font-mono">{row.transactionId || "—"}</TableCell>
                    <TableCell className="font-medium">{promoCodeLabel(row.promoCode)}</TableCell>
                    <TableCell className="font-medium">{row.customerName || "UMUM"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{rp(row.total)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-emerald-600">{rp(row.promoDiscount)}</TableCell>
                    <TableCell className="text-muted-foreground">{row.cashier || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
