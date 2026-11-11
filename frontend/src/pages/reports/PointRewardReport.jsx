import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Search } from "lucide-react";
import { api, errMsg, rp, num, fmtDate, todayStr, daysAgoStr } from "@/lib/api";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterPointRewardItems, normalizePointRewardReport } from "@/lib/pointRewardData";

const PRESETS = [
  ["Hari ini", 0],
  ["7 hari", 6],
  ["30 hari", 29],
];

const formatWhen = (row) => (row.timestamp ? fmtDate(row.timestamp) : row.date || "-");

export default function PointRewardReport() {
  const [range, setRange] = useState({ start: daysAgoStr(6), end: todayStr() });
  const [query, setQuery] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports/point-reward-usage", {
        params: { start: range.start, end: range.end },
      });
      setReport(normalizePointRewardReport(data));
    } catch (error) {
      toast.error(errMsg(error));
      setReport(normalizePointRewardReport(null));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(
    () => filterPointRewardItems(report?.items || [], query),
    [report, query],
  );

  // Ringkasan mengikuti hasil filter pencarian agar konsisten dengan tabel.
  const filteredPoints = items.reduce((sum, row) => sum + row.pointsRedeemed, 0);
  const filteredDiscount = items.reduce((sum, row) => sum + row.discountValue, 0);

  const isFiltering = query.trim().length > 0;

  return (
    <div>
      <PageHeader
        title="Laporan Point Reward"
        subtitle="Riwayat penukaran poin pelanggan beserta nilai rupiah diskon pada rentang tanggal terpilih."
      >
        {PRESETS.map(([label, n]) => {
          const active = range.start === daysAgoStr(n) && range.end === todayStr();
          return (
            <button
              key={label}
              type="button"
              data-testid={`point-reward-preset-${n}`}
              onClick={() => setRange({ start: daysAgoStr(n), end: todayStr() })}
              className={`h-10 rounded-lg px-3 text-sm ${active ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-secondary"}`}
            >
              {label}
            </button>
          );
        })}
        <input
          data-testid="point-reward-start-date"
          type="date"
          value={range.start}
          max={range.end || undefined}
          onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        />
        <input
          data-testid="point-reward-end-date"
          type="date"
          value={range.end}
          min={range.start || undefined}
          onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        />
        <button
          type="button"
          data-testid="point-reward-refresh"
          onClick={load}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-secondary"
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat ulang
        </button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Total Poin Ditukar"
          value={num(filteredPoints)}
          hint={
            isFiltering
              ? "Mengikuti hasil pencarian"
              : `${report?.totalRedemptions ?? 0} transaksi penukaran poin`
          }
          testid="point-reward-total-points"
        />
        <StatCard
          label="Total Nilai Rupiah Diskon"
          value={rp(filteredDiscount)}
          tone="text-emerald-600"
          hint={isFiltering ? "Mengikuti hasil pencarian" : `${items.length} baris penukaran poin`}
          testid="point-reward-total-value"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Rincian Penukaran Poin
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              data-testid="point-reward-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari no. transaksi, pelanggan, atau kasir…"
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm"
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="p-4">
            <Empty
              text={
                report && report.items.length > 0
                  ? "Tidak ada data penukaran poin yang cocok dengan pencarian."
                  : "Belum ada penukaran poin pada rentang tanggal ini."
              }
              testid="point-reward-empty"
            />
          </div>
        ) : (
          <div data-testid="point-reward-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Waktu / Tanggal</TableHead>
                  <TableHead>No. Transaksi</TableHead>
                  <TableHead>Nama Pelanggan</TableHead>
                  <TableHead className="text-right">Poin Ditukar</TableHead>
                  <TableHead className="text-right">Nilai Diskon (Rp)</TableHead>
                  <TableHead>Kasir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row, index) => (
                  <TableRow key={row.key} data-testid={`point-reward-row-${index + 1}`}>
                    <TableCell className="text-right font-mono text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatWhen(row)}</TableCell>
                    <TableCell className="font-mono">{row.transactionId || "—"}</TableCell>
                    <TableCell className="font-medium">{row.customerName || "UMUM"}</TableCell>
                    <TableCell className="text-right font-mono">{num(row.pointsRedeemed)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">{rp(row.discountValue)}</TableCell>
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
