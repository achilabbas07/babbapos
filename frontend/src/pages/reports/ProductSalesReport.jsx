import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Search } from "lucide-react";
import { api, errMsg, rp, todayStr, daysAgoStr } from "@/lib/api";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  filterProductSalesItems,
  normalizeProductSalesReport,
  productSalesDisplayName,
} from "@/lib/productSalesData";

const PRESETS = [
  ["Hari ini", 0],
  ["7 hari", 6],
  ["30 hari", 29],
];

export default function ProductSalesReport() {
  const [range, setRange] = useState({ start: daysAgoStr(6), end: todayStr() });
  const [query, setQuery] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports/product-sales", {
        params: { start: range.start, end: range.end },
      });
      setReport(normalizeProductSalesReport(data));
    } catch (error) {
      toast.error(errMsg(error));
      setReport(normalizeProductSalesReport(null));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(
    () => filterProductSalesItems(report?.items || [], query),
    [report, query],
  );

  // Total mengikuti hasil filter pencarian agar konsisten dengan tabel di bawahnya.
  const filteredQty = items.reduce((sum, row) => sum + row.qty, 0);
  const filteredRevenue = items.reduce((sum, row) => sum + row.revenue, 0);

  const isFiltering = query.trim().length > 0;
  const maxRevenue = Math.max(...items.map((row) => row.revenue), 1);

  return (
    <div>
      <PageHeader
        title="Laporan Penjualan Produk"
        subtitle="Rekap kuantitas dan omzet kotor per produk & varian pada rentang tanggal terpilih."
      >
        {PRESETS.map(([label, n]) => {
          const active = range.start === daysAgoStr(n) && range.end === todayStr();
          return (
            <button
              key={label}
              type="button"
              data-testid={`product-sales-preset-${n}`}
              onClick={() => setRange({ start: daysAgoStr(n), end: todayStr() })}
              className={`h-10 rounded-lg px-3 text-sm ${active ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-secondary"}`}
            >
              {label}
            </button>
          );
        })}
        <input
          data-testid="product-sales-start-date"
          type="date"
          value={range.start}
          max={range.end || undefined}
          onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        />
        <input
          data-testid="product-sales-end-date"
          type="date"
          value={range.end}
          min={range.start || undefined}
          onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        />
        <button
          type="button"
          data-testid="product-sales-refresh"
          onClick={load}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-secondary"
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat ulang
        </button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Total Kuantitas Terjual"
          value={`${filteredQty}`}
          hint={isFiltering ? "Mengikuti hasil pencarian" : "Seluruh produk pada rentang tanggal"}
          testid="product-sales-total-qty"
        />
        <StatCard
          label="Total Omzet Kotor"
          value={rp(filteredRevenue)}
          tone="text-emerald-600"
          hint={isFiltering ? "Mengikuti hasil pencarian" : `Dari ${report?.transactionCount ?? 0} transaksi`}
          testid="product-sales-gross-sales"
        />
        <StatCard
          label="Jumlah Baris Produk"
          value={`${items.length}`}
          hint={`${report?.itemCount ?? 0} baris pada rentang ini`}
          testid="product-sales-item-count"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Rincian Penjualan per Produk
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              data-testid="product-sales-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nama produk atau varian…"
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm"
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-4">
            <Empty
              text={
                report && report.itemCount > 0
                  ? "Tidak ada produk yang cocok dengan pencarian."
                  : "Belum ada penjualan produk pada rentang tanggal ini."
              }
              testid="product-sales-empty"
            />
          </div>
        ) : (
          <div data-testid="product-sales-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Produk &amp; Varian</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Total Penjualan</TableHead>
                  <TableHead className="text-right">Kontribusi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row, index) => (
                  <TableRow key={row.key} data-testid={`product-sales-row-${index + 1}`}>
                    <TableCell className="text-right font-mono text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="font-medium">{productSalesDisplayName(row)}</TableCell>
                    <TableCell className="text-muted-foreground">{row.category || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{row.qty}</TableCell>
                    <TableCell className="text-right font-mono">
                      {rp(row.revenue)}
                      <span className="mt-1 block h-1 w-full rounded-full bg-secondary">
                        <span
                          className="block h-1 rounded-full bg-primary"
                          style={{ width: `${Math.min((row.revenue / maxRevenue) * 100, 100)}%` }}
                        />
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {row.contribution.toFixed(2)}%
                    </TableCell>
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
