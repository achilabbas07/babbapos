import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { api, errMsg, rp } from "@/lib/api";
import { isCashBankAccount } from "@/lib/accountClassification";
import { FinanceError, FinanceTable, LoadingPanel, Money } from "./FinanceShared";
import FinanceDateFilter from "./FinanceDateFilter";

const isInventoryAccount = (name) => /(persediaan bahan baku|persediaan|inventory)/i.test(name || "");

export default function BalanceSheet() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const { data } = await api.get("/finance/balance-sheet", { params: filters });
      setRows(data);
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => rows.reduce((result, row) => {
    const balance = Number(row.balance) || 0;
    if (row.account_type === "asset") result.assets += balance;
    if (row.account_type === "liability") result.liabilities += balance;
    if (row.account_type === "equity") result.equity += balance;
    if (row.account_type === "asset" && isCashBankAccount(row)) result.cash += balance;
    if (row.account_type === "asset" && isInventoryAccount(row.account_name)) result.inventory += balance;
    return result;
  }, { assets: 0, liabilities: 0, equity: 0, cash: 0, inventory: 0 }), [rows]);

  return (
    <div>
      <PageHeader title="Neraca & Persediaan" subtitle="Posisi aset, kewajiban, dan ekuitas dari saldo akun serta laba berjalan.">
        <button type="button" onClick={load} className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:border-primary">Perbarui</button>
      </PageHeader>
      <FinanceDateFilter onApply={setFilters} />
      {error && <div className="mb-5"><FinanceError message={error} onRetry={load} /></div>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total aset" value={rp(totals.assets)} />
        <StatCard label="Kas & bank akhir" value={rp(totals.cash)} />
        <StatCard label="Persediaan bahan baku" value={rp(totals.inventory)} />
        <StatCard label="Liabilitas + ekuitas" value={rp(totals.liabilities + totals.equity)} />
      </div>
      {loading ? <LoadingPanel /> : (
        <FinanceTable
          rows={rows}
          emptyText="Belum ada saldo akun di neraca."
          columns={[
            { key: "account_code", label: "Kode akun" },
            { key: "account_name", label: "Nama akun" },
            { key: "account_type", label: "Kelompok", render: (row) => ({ asset: "Aset", liability: "Liabilitas", equity: "Ekuitas" }[row.account_type] || row.account_type) },
            { key: "balance", label: "Saldo akhir", className: "text-right", render: (row) => <Money value={row.balance} /> },
          ]}
        />
      )}
    </div>
  );
}
