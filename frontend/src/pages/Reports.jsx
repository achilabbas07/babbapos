import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errMsg, rp, todayStr, daysAgoStr, dayRange } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache, rangeCacheKey } from "@/lib/offlineRead";
import { PageHeader, StatCard } from "@/components/PageHeader";
import CachedDataNotice from "@/components/CachedDataNotice";

const PRESETS = [["Hari ini", 0], ["7 hari", 6], ["30 hari", 29]];

const Panel = ({ title, children, className = "" }) => (
  <section className={`rounded-2xl border border-border bg-card p-5 ${className}`}>
    <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}</h2>
    {children}
  </section>
);

const Bars = ({ rows, labelKey, valueKey, testid }) => {
  const max = Math.max(...rows.map((r) => r[valueKey]), 1);
  if (!rows.length) return <p className="text-sm text-muted-foreground">Belum ada data.</p>;
  return (
    <div data-testid={testid} className="space-y-3">
      {rows.map((r) => (
        <div key={r[labelKey]}>
          <div className="mb-1 flex justify-between text-sm"><span>{r[labelKey]}</span><span className="font-mono">{rp(r[valueKey])}</span></div>
          <div className="h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-primary" style={{ width: `${(r[valueKey] / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
};

export default function Reports() {
  const [range, setRange] = useState({ from: daysAgoStr(6), to: todayStr() });
  const [data, setData] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  // Fallback cache lokal per rentang: ringkasan laporan terakhir tetap tampil
  // saat offline (angka bisa sedikit tertinggal, ditandai lewat notice).
  const load = useCallback(() => {
    const params = { ...dayRange(range.from, range.to), tz_offset: new Date().getTimezoneOffset() };
    return loadWithCache(
      rangeCacheKey(CACHE_KEYS.REPORTS_SUMMARY, params),
      async () => (await api.get("/reports/summary", { params })).data,
    ).then((result) => {
      if (result.canceled) return;
      if (result.data !== undefined) setData(result.data);
      setFromCache(result.fromCache);
      setCachedAt(result.updatedAt);
      if (result.error) toast.error(errMsg(result.error));
    });
  }, [range]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader title="Laporan Laba Rugi" subtitle="Pendapatan − HPP (dari resep) − Pengeluaran = Laba bersih.">
        {PRESETS.map(([label, n]) => (
          <button key={label} data-testid={`report-preset-${n}`} onClick={() => setRange({ from: daysAgoStr(n), to: todayStr() })}
            className={`h-10 rounded-lg px-3 text-sm ${range.from === daysAgoStr(n) && range.to === todayStr() ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>{label}</button>
        ))}
        <input data-testid="report-from-date" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-10 rounded-lg border border-border bg-card px-3 text-sm" />
        <input data-testid="report-to-date" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-10 rounded-lg border border-border bg-card px-3 text-sm" />
      </PageHeader>
      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Pendapatan" value={rp(data.revenue)} hint={`${data.transaction_count} transaksi · rata-rata ${rp(data.avg_ticket)}`} testid="report-revenue" />
            <StatCard label="HPP" value={rp(data.cogs)} testid="report-cogs" />
            <StatCard label="Laba kotor" value={rp(data.gross_profit)} tone="text-emerald-600" hint="Pendapatan − HPP" testid="report-gross-profit" />
            <StatCard label="Laba bersih" value={rp(data.net_profit)} tone={data.net_profit >= 0 ? "text-primary" : "text-destructive"} hint={`Setelah pengeluaran ${rp(data.expenses)}`} testid="report-net-profit" />
          </div>
          <Panel title="Penjualan harian">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => rp(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} cursor={{ fill: "hsl(var(--secondary))" }} />
                  <Bar dataKey="revenue" name="Pendapatan" fill="#2563EB" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="profit" name="Laba kotor" fill="#10B981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="Produk terlaris" className="lg:col-span-2">
              <div data-testid="report-top-products" className="divide-y divide-border">
                {data.top_products.length === 0 && <p className="text-sm text-muted-foreground">Belum ada data.</p>}
                {data.top_products.map((p, i) => (
                  <div key={`${p.productId}:${p.variantId ?? p.variantName ?? ""}`} className="flex items-center gap-4 py-2.5 text-sm">
                    <span className="w-6 font-mono text-muted-foreground">{i + 1}</span>
                    <span className="flex-1">{p.variantName ? `${p.name} - ${p.variantName}` : p.name}</span>
                    <span className="font-mono text-muted-foreground">{p.qty}×</span>
                    <span className="w-28 text-right font-mono">{rp(p.revenue)}</span>
                    <span className="w-28 text-right font-mono text-emerald-600">{rp(p.profit)}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Metode pembayaran"><Bars rows={data.by_method} labelKey="method" valueKey="total" testid="report-by-method" /></Panel>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Pengeluaran per kategori"><Bars rows={data.expenses_by_category} labelKey="category" valueKey="total" testid="report-expenses" /></Panel>
            <Panel title="Arus kas keluar lain">
              <StatCard label="Total pembelian bahan" value={rp(data.purchases)} hint="Tidak masuk laba rugi langsung — tercermin lewat HPP saat bahan terjual." testid="report-purchases" />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
