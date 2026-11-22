import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg, fmtDate, rp, todayStr, dayRange } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache, rangeCacheKey } from "@/lib/offlineRead";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import CachedDataNotice from "@/components/CachedDataNotice";
import { ReceiptDialog } from "@/components/ReceiptDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DateInput = ({ value, onChange, testid }) => (
  <input data-testid={testid} type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" />
);

export default function Transactions() {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  // Fallback cache lokal per rentang tanggal: riwayat terakhir tetap tampil
  // saat offline. Cache dipisah per rentang agar tidak tertukar antar filter.
  const load = useCallback(() => {
    const params = dayRange(from, to);
    return loadWithCache(
      rangeCacheKey(CACHE_KEYS.TRANSACTIONS, params),
      async () => (await api.get("/transactions", { params })).data,
    ).then((result) => {
      if (result.canceled) return;
      if (result.data !== undefined) setList(Array.isArray(result.data) ? result.data : []);
      setFromCache(result.fromCache);
      setCachedAt(result.updatedAt);
      if (result.error) toast.error(errMsg(result.error));
    });
  }, [from, to]);
  useEffect(() => {
    load();
  }, [load]);

  const total = list.reduce((s, t) => s + t.total, 0);

  return (
    <div>
      <PageHeader title="Riwayat Transaksi" subtitle="Klik transaksi untuk melihat struk.">
        <DateInput value={from} onChange={setFrom} testid="trx-from-date" />
        <span className="text-muted-foreground">—</span>
        <DateInput value={to} onChange={setTo} testid="trx-to-date" />
      </PageHeader>
      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Total penjualan" value={rp(total)} testid="trx-total-sales" />
        <StatCard label="Jumlah transaksi" value={list.length} testid="trx-count" />
      </div>
      {list.length === 0 ? <Empty testid="trx-empty" text="Tidak ada transaksi pada rentang ini." /> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Waktu</TableHead><TableHead>Tipe</TableHead><TableHead>Pelanggan</TableHead><TableHead>Metode</TableHead><TableHead>Kasir</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map((t) => (
                <TableRow key={t.id} data-testid={`trx-row-${t.id}`} onClick={() => setSelected(t)} className="cursor-pointer">
                  <TableCell className="font-mono text-xs text-primary">{t.id}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(t.date)}</TableCell>
                  <TableCell>{t.type}{t.tableName ? ` · ${t.tableName}` : ""}</TableCell>
                  <TableCell>{t.customerName || "-"}</TableCell>
                  <TableCell><span className="rounded-full bg-secondary px-2.5 py-1 text-xs">{t.method}</span></TableCell>
                  <TableCell className="text-muted-foreground">{t.userName}</TableCell>
                  <TableCell className="text-right font-mono">{rp(t.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ReceiptDialog trx={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
