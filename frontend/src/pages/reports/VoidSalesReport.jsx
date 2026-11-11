import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Search } from "lucide-react";
import { api, errMsg, rp, fmtDate, todayStr, daysAgoStr } from "@/lib/api";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  filterVoidSalesItems,
  normalizeVoidSalesReport,
  voidSalesDisplayName,
} from "@/lib/voidSalesData";

const PRESETS = [
  ["Hari ini", 0],
  ["7 hari", 6],
  ["30 hari", 29],
];

const formatWhen = (row) => (row.timestamp ? fmtDate(row.timestamp) : row.date || "-");

export default function VoidSalesReport() {
  const [range, setRange] = useState({ start: daysAgoStr(6), end: todayStr() });
  const [query, setQuery] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports/void-sales", {
        params: { start: range.start, end: range.end },
      });
      setReport(normalizeVoidSalesReport(data));
    } catch (error) {
      toast.error(errMsg(error));
      setReport(normalizeVoidSalesReport(null));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(
    () => filterVoidSalesItems(report?.items || [], query),
    [report, query],
  );

  // Ringkasan mengikuti hasil filter pencarian agar konsisten dengan tabel.
  const filteredQty = items.reduce((sum, row) => sum + row.qty, 0);
  const filteredValue = items.reduce((sum, row) => sum + row.value, 0);

  const isFiltering = query.trim().length > 0;

  return (
    <div>
      <PageHeader
        title="Laporan Void"
        subtitle="Riwayat pembatalan (void) item/transaksi beserta nilai rupiah pada rentang tanggal terpilih."
      >
        {PRESETS.map(([label, n]) => {
          const active = range.start === daysAgoStr(n) && range.end === todayStr();
          return (
            <button
              key={label}
              type="button"
              data-testid={`void-sales-preset-${n}`}
              onClick={() => setRange({ start: daysAgoStr(n), end: todayStr() })}
              className={`h-10 rounded-lg px-3 text-sm ${active ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-secondary"}`}
            >
              {label}
            </button>
          );
        })}
        <input
          data-testid="void-sales-start-date"
          type="date"
          value={range.start}
          max={range.end || undefined}
          onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        />
        <input
          data-testid="void-sales-end-date"
          type="date"
          value={range.end}
          min={range.start || undefined}
          onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        />
        <button
          type="button"
          data-testid="void-sales-refresh"
          onClick={load}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-secondary"
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat ulang
        </button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Total Item/Transaksi Void"
          value={`${items.length}`}
          hint={
            isFiltering
              ? "Mengikuti hasil pencarian"
              : `${report?.totalVoids ?? 0} transaksi void · ${report?.totalItems ?? 0} item`
          }
          testid="void-sales-total-qty"
        />
        <StatCard
          label="Total Nilai Void (Rp)"
          value={rp(filteredValue)}
          tone="text-destructive"
          hint={isFiltering ? "Mengikuti hasil pencarian" : `Dari ${filteredQty} item yang dibatalkan`}
          testid="void-sales-total-value"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Rincian Pembatalan (Void)
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              data-testid="void-sales-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari produk, meja, atau kasir…"
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm"
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-4">
            <Empty
              text={
                report && report.items.length > 0
                  ? "Tidak ada data void yang cocok dengan pencarian."
                  : "Belum ada transaksi void pada rentang tanggal ini."
              }
              testid="void-sales-empty"
            />
          </div>
        ) : (
          <div data-testid="void-sales-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Waktu / Tanggal</TableHead>
                  <TableHead>No. Meja / Transaksi</TableHead>
                  <TableHead>Produk &amp; Varian</TableHead>
                  <TableHead className="text-right">Qty Void</TableHead>
                  <TableHead className="text-right">Nilai Rupiah</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead>Catatan / Alasan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row, index) => (
                  <TableRow key={row.key} data-testid={`void-sales-row-${index + 1}`}>
                    <TableCell className="text-right font-mono text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(row)}</TableCell>
                    <TableCell>
                      <span className="font-medium">{row.tableName || "—"}</span>
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{row.billId || "—"}</span>
                    </TableCell>
                    <TableCell className="font-medium">{voidSalesDisplayName(row)}</TableCell>
                    <TableCell className="text-right font-mono">{row.qty}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">{rp(row.value)}</TableCell>
                    <TableCell className="text-muted-foreground">{row.cashier || "—"}</TableCell>
                    <TableCell className="max-w-[220px] text-muted-foreground">{row.reason || "—"}</TableCell>
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
