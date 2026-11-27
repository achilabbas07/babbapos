import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { api, errMsg, fmtDate, rp, todayStr, dayRange } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache, rangeCacheKey } from "@/lib/offlineRead";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import CachedDataNotice from "@/components/CachedDataNotice";
import { ReceiptDialog } from "@/components/ReceiptDialog";
import { AdminPinDialog } from "@/components/tables/AdminPinDialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DateInput = ({ value, onChange, testid }) => (
  <input data-testid={testid} type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" />
);

// Transaksi void dibaca dari kolom `status` (di-set oleh POST /transactions/{id}/void).
// Transaksi lama tanpa kolom ini dianggap BUKAN void sehingga riwayat tetap utuh.
const isVoidTx = (t) => String(t?.status || "").trim().toLowerCase() === "void";

const VoidBadge = () => (
  <span data-testid="trx-void-badge" className="w-fit rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-destructive">
    VOID
  </span>
);

export default function Transactions() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [voidTarget, setVoidTarget] = useState(null);
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
            <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Waktu</TableHead><TableHead>Tipe</TableHead><TableHead>Pelanggan</TableHead><TableHead>Metode</TableHead><TableHead>Kasir</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map((t) => {
                const trxVoid = isVoidTx(t);
                return (
                  <TableRow key={t.id} data-testid={`trx-row-${t.id}`} onClick={() => setSelected(t)} className="cursor-pointer">
                    <TableCell className="font-mono text-xs text-primary">
                      <div className="flex flex-col items-start gap-1">
                        <span>{t.id}</span>
                        {trxVoid && <VoidBadge />}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(t.date)}</TableCell>
                    <TableCell>{t.type}{t.tableName ? ` · ${t.tableName}` : ""}</TableCell>
                    <TableCell>{t.customerName || "-"}</TableCell>
                    <TableCell><span className="rounded-full bg-secondary px-2.5 py-1 text-xs">{t.method}</span></TableCell>
                    <TableCell className="text-muted-foreground">{t.userName}</TableCell>
                    <TableCell className="text-right font-mono">{rp(t.total)}</TableCell>
                    <TableCell className="text-right">
                      {trxVoid ? (
                        <span data-testid={`trx-void-disabled-${t.id}`} className="text-xs text-muted-foreground">Sudah void</span>
                      ) : (
                        <Button
                          data-testid={`trx-void-${t.id}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!isAdmin}
                          onClick={(e) => { e.stopPropagation(); setVoidTarget(t); }}
                          className="h-8 gap-1 text-destructive hover:border-destructive hover:text-destructive"
                        >
                          <Ban className="h-3.5 w-3.5" /> Void
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <ReceiptDialog trx={selected} onClose={() => setSelected(null)} />
      <AdminPinDialog
        open={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        testid="trx-void-pin"
        needPin
        withReason
        title={`Void ${voidTarget?.id || ""}`}
        description="Transaksi selesai di-void: stok dikembalikan, jurnal penjualan/HPP dibalik, dan tindakan tercatat di log void."
        onSubmit={async ({ pin, reason }) => {
          await api.post(`/transactions/${voidTarget?.id}/void`, { adminPin: pin || null, reason });
          toast.success("Transaksi di-void");
          setVoidTarget(null);
          await load();
        }}
      />
    </div>
  );
}
