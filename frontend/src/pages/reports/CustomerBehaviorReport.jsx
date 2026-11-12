import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Lightbulb, RotateCw } from "lucide-react";
import { api, errMsg, rp, num, todayStr, daysAgoStr } from "@/lib/api";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatHour,
  normalizeCustomerBehaviorReport,
} from "@/lib/customerBehaviorData";

const PRESETS = [
  ["Hari Ini", 0],
  ["7 Hari Terakhir", 6],
  ["30 Hari Terakhir", 29],
];

const Panel = ({ title, hint, children, testid }) => (
  <section data-testid={testid} className="rounded-2xl border border-border bg-card p-5">
    <div className="mb-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}</h2>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
    {children}
  </section>
);

const BarRow = ({ label, value, max, sublabel, tone = "bg-primary" }) => (
  <div>
    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
      <span className="truncate font-medium">{label}</span>
      <span className="shrink-0 font-mono">{value}</span>
    </div>
    <div className="h-2 rounded-full bg-secondary">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
    </div>
    {sublabel && <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>}
  </div>
);

export default function CustomerBehaviorReport() {
  const [range, setRange] = useState({ start: daysAgoStr(6), end: todayStr() });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports/customer-behavior", {
        params: { start_date: range.start, end_date: range.end },
      });
      setReport(normalizeCustomerBehaviorReport(data));
    } catch (error) {
      toast.error(errMsg(error));
      setReport(normalizeCustomerBehaviorReport(null));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const channels = useMemo(() => report?.channels || [], [report]);
  const methods = useMemo(() => report?.methods || [], [report]);
  const hours = useMemo(() => report?.hours || [], [report]);
  const insights = useMemo(() => report?.insights || [], [report]);

  const maxChannelRevenue = useMemo(
    () => Math.max(...channels.map((c) => c.revenue), 1),
    [channels],
  );
  const maxMethodTotal = useMemo(
    () => Math.max(...methods.map((m) => m.total), 1),
    [methods],
  );

  // Grafik jam: tampilkan hanya rentang jam yang punya aktivitas (dengan padding
  // 1 jam di kiri/kanan) supaya grafik tidak dipenuhi jam kosong dini hari.
  const chartHours = useMemo(() => {
    const active = hours.filter((h) => h.transactions > 0);
    if (!active.length) return [];
    const first = Math.max(0, Math.min(...active.map((h) => h.hour)) - 1);
    const last = Math.min(23, Math.max(...active.map((h) => h.hour)) + 1);
    return hours.filter((h) => h.hour >= first && h.hour <= last);
  }, [hours]);

  const hasData = (report?.transactionCount || 0) > 0;

  return (
    <div>
      <PageHeader
        title="Analisa Perilaku Pelanggan"
        subtitle="Perputaran warkop: kanal orderan, metode bayar, ukuran keranjang, dan jam sibuk pada rentang tanggal terpilih."
      >
        {PRESETS.map(([label, n]) => {
          const active = range.start === daysAgoStr(n) && range.end === todayStr();
          return (
            <button
              key={label}
              type="button"
              data-testid={`customer-behavior-preset-${n}`}
              onClick={() => setRange({ start: daysAgoStr(n), end: todayStr() })}
              className={`h-10 rounded-lg px-3 text-sm ${active ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-secondary"}`}
            >
              {label}
            </button>
          );
        })}
        <input
          data-testid="customer-behavior-start-date"
          type="date"
          aria-label="Tanggal mulai"
          value={range.start}
          max={range.end || undefined}
          onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        />
        <input
          data-testid="customer-behavior-end-date"
          type="date"
          aria-label="Tanggal akhir"
          value={range.end}
          min={range.start || undefined}
          onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        />
        <button
          type="button"
          data-testid="customer-behavior-refresh"
          onClick={load}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-secondary"
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat ulang
        </button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Transaksi"
          value={num(report?.transactionCount || 0)}
          hint={report?.totalItems ? `${num(report.totalItems)} item terjual` : "Belum ada transaksi"}
          testid="customer-behavior-transaction-count"
        />
        <StatCard
          label="Omzet Periode"
          value={rp(report?.totalRevenue || 0)}
          tone="text-emerald-600"
          hint="Total nilai transaksi pada rentang ini"
          testid="customer-behavior-revenue"
        />
        <StatCard
          label="Rata-rata Belanja (AOV)"
          value={rp(report?.averageOrderValue || 0)}
          hint="Nilai transaksi ÷ jumlah transaksi"
          testid="customer-behavior-aov"
        />
        <StatCard
          label="Rata-rata Item / Transaksi"
          value={num(report?.averageBasketSize || 0)}
          hint={`Keranjang ${num(report?.basket?.minItems || 0)}–${num(report?.basket?.maxItems || 0)} item`}
          testid="customer-behavior-basket"
        />
      </div>

      {/* Kotak Wawasan Pintar Lokal */}
      <div
        data-testid="customer-behavior-insights"
        className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-5"
      >
        <div className="mb-3 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Wawasan Pintar
          </h2>
        </div>
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada wawasan untuk rentang ini.</p>
        ) : (
          <ul className="space-y-2">
            {insights.map((line, index) => (
              <li
                key={`${index}-${line}`}
                data-testid={`customer-behavior-insight-${index + 1}`}
                className="flex gap-2 text-sm text-foreground/90"
              >
                <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!hasData ? (
        <div className="mt-6">
          <Empty text="Belum ada transaksi pada rentang tanggal ini." testid="customer-behavior-empty" />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Analisis Kanal Orderan"
              hint="Kontribusi omzet & rata-rata nilai belanja (AOV) per kanal."
              testid="customer-behavior-channels"
            >
              <div className="space-y-4">
                {channels.map((c) => (
                  <BarRow
                    key={c.key}
                    label={c.channel}
                    value={rp(c.revenue)}
                    max={maxChannelRevenue}
                    sublabel={`${num(c.transactions)} transaksi · ${c.revenueShare.toFixed(1)}% omzet · AOV ${rp(c.aov)}`}
                  />
                ))}
              </div>
            </Panel>

            <Panel
              title="Analisis Metode Pembayaran"
              hint="Nilai transaksi per metode (split payment dihitung per leg)."
              testid="customer-behavior-methods"
            >
              <div className="space-y-4">
                {methods.map((m) => (
                  <BarRow
                    key={m.key}
                    label={m.method}
                    value={rp(m.total)}
                    max={maxMethodTotal}
                    tone="bg-emerald-500"
                    sublabel={`${num(m.transactions)} leg bayar · ${m.share.toFixed(1)}% nilai transaksi`}
                  />
                ))}
              </div>
            </Panel>
          </div>

          <Panel
            title="Distribusi Jam Sibuk & Jam Sepian"
            hint={
              report?.peakHour
                ? `Jam sibuk ${formatHour(report.peakHour.hour)} · Jam sepian ${formatHour(report.quietHour?.hour ?? 0)}`
                : "Belum ada aktivitas jam pada rentang ini."
            }
            testid="customer-behavior-hours"
          >
            <div className="h-72">
              {chartHours.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada data jam.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartHours}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      interval={0}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value, name) => (name === "revenue" ? rp(value) : value)}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 12,
                      }}
                      cursor={{ fill: "hsl(var(--secondary))" }}
                    />
                    <Bar dataKey="transactions" name="Transaksi" fill="#2563EB" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Jam Sibuk</p>
                <p data-testid="customer-behavior-peak-hour" className="mt-1 font-mono text-xl font-semibold">
                  {report?.peakHour ? formatHour(report.peakHour.hour) : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report?.peakHour ? `${num(report.peakHour.transactions)} transaksi` : "Belum ada"}
                </p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Jam Sepian</p>
                <p data-testid="customer-behavior-quiet-hour" className="mt-1 font-mono text-xl font-semibold">
                  {report?.quietHour ? formatHour(report.quietHour.hour) : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report?.quietHour ? `${num(report.quietHour.transactions)} transaksi` : "Belum ada"}
                </p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Ukuran Keranjang</p>
                <p data-testid="customer-behavior-basket-detail" className="mt-1 font-mono text-xl font-semibold">
                  {num(report?.basket?.averageItems || 0)} item
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Rata-rata per transaksi</p>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jam</TableHead>
                    <TableHead className="text-right">Transaksi</TableHead>
                    <TableHead className="text-right">Omzet</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartHours.map((h) => (
                    <TableRow key={h.hour}>
                      <TableCell className="font-mono">{h.label}</TableCell>
                      <TableCell className="text-right font-mono">{num(h.transactions)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{rp(h.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
