import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errMsg, rp } from "@/lib/api";
import { getAccountCategoryLabel, getAccountTypeLabel } from "@/lib/accountClassification";
import { getAccountTransactions } from "@/services/coaService";

const fmtDate = (value) => {
  if (!value) return "-";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const SOURCE_LABEL = {
  transaction: "Penjualan POS",
  purchase: "Pembelian",
  purchase_payment: "Pembayaran Pembelian",
  expense: "Pengeluaran",
  cash_movement: "Kas Keluar/Masuk",
  stock_adjustment: "Penyesuaian Stok",
  supplier_payment: "Pembayaran Supplier",
  manual: "Jurnal Manual",
};

const sourceLabel = (value) => {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "-";
  return SOURCE_LABEL[key] || key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const SummaryCard = ({ label, value, tone = "", testid }) => (
  <div className="rounded-xl border border-border bg-secondary/30 p-3">
    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
    <p data-testid={testid} className={`mt-1 font-mono text-base font-semibold tabular-nums ${tone}`}>{value}</p>
  </div>
);

export default function AccountTransactionsModal({ open, onOpenChange, account, range }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startDate = range?.startDate || "";
  const endDate = range?.endDate || "";

  const load = useCallback(async () => {
    if (!account?.account_code) return;
    setLoading(true);
    setError("");
    try {
      setData(await getAccountTransactions(account.account_code, { startDate, endDate }));
    } catch (requestError) {
      setError(errMsg(requestError));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [account?.account_code, startDate, endDate]);

  useEffect(() => {
    if (open && account?.account_code) {
      load();
    }
    if (!open) {
      setData(null);
      setError("");
    }
  }, [open, account?.account_code, load]);

  const summary = data?.summary;
  const transactions = data?.transactions || [];
  const periodLabel = startDate || endDate
    ? `${startDate ? fmtDate(startDate) : "Awal"} — ${endDate ? fmtDate(endDate) : "Sekarang"}`
    : "Seluruh periode";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="coa-transactions-dialog" className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Rincian Transaksi Akun</DialogTitle>
          <DialogDescription>
            {account
              ? `${account.account_code} — ${account.account_name} · ${getAccountTypeLabel(account)} · ${getAccountCategoryLabel(account)}`
              : "Pilih akun untuk melihat rincian jurnal."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant="secondary" data-testid="coa-transactions-period">{periodLabel}</Badge>
          <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Muat ulang
          </Button>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {summary && (
          <div className="grid gap-2 sm:grid-cols-4">
            <SummaryCard label="Total Debit" value={rp(summary.total_debit)} testid="coa-trx-total-debit" />
            <SummaryCard label="Total Kredit" value={rp(summary.total_credit)} testid="coa-trx-total-credit" />
            <SummaryCard
              label="Saldo Periode"
              value={rp(summary.closing_balance)}
              tone={Number(summary.closing_balance) < 0 ? "text-destructive" : ""}
              testid="coa-trx-closing-balance"
            />
            <SummaryCard label="Jumlah Baris" value={String(summary.transaction_count ?? 0)} testid="coa-trx-count" />
          </div>
        )}

        <div className="rounded-xl border border-border">
          {loading ? (
            <div role="status" className="p-8 text-center text-sm text-muted-foreground">
              Memuat rincian transaksi...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Kredit</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((row, index) => (
                  <TableRow key={`${row.id ?? row.entry_id ?? index}`} data-testid={`coa-trx-row-${index}`}>
                    <TableCell className="whitespace-nowrap">{fmtDate(row.transaction_date)}</TableCell>
                    <TableCell className="min-w-[200px]">{row.description || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{sourceLabel(row.source_type)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Number(row.debit) ? rp(row.debit) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Number(row.credit) ? rp(row.credit) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">{rp(row.balance)}</TableCell>
                  </TableRow>
                ))}
                {transactions.length === 0 && !error && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      Belum ada mutasi untuk akun ini pada periode terpilih.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
