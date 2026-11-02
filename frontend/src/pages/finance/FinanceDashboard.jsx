import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { api, errMsg, rp } from "@/lib/api";
import { FinanceError, FinanceTable, LoadingPanel, Money } from "./FinanceShared";

const ASSET_COLORS = ["#2563eb", "#10b981", "#f59e0b"];

const toDateInputValue = (value) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDefaultDateRange = () => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
};

export default function FinanceDashboard() {
  const defaultDateRange = useMemo(getDefaultDateRange, []);
  const [startDate, setStartDate] = useState(defaultDateRange.startDate);
  const [endDate, setEndDate] = useState(defaultDateRange.endDate);
  const [transactions, setTransactions] = useState([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transactionsError, setTransactionsError] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const requestId = useRef(0);

  const hasMutations = accounts.some((account) => account.has_mutations);
  const summary = useMemo(() => accounts.reduce((totals, account) => {
    const balance = Number(account.balance) || 0;
    const name = account.account_name || "";
    if (account.account_type === "asset") {
      totals.totalAssets += balance;
      if (/(kas|bank|cash)/i.test(name)) totals.cashBank += balance;
      if (/(persediaan|inventory)/i.test(name)) totals.inventory += balance;
    }
    if (account.account_type === "liability" || account.account_type === "equity") {
      totals.liabilitiesEquity += balance;
    }
    return totals;
  }, { cashBank: 0, inventory: 0, totalAssets: 0, liabilitiesEquity: 0 }), [accounts]);

  const assetComposition = useMemo(() => [
    { name: "Kas & Bank", balance: summary.cashBank },
    { name: "Persediaan", balance: summary.inventory },
    { name: "Aset Lainnya", balance: summary.totalAssets - summary.cashBank - summary.inventory },
  ].filter((entry) => entry.balance !== 0)
    .map((entry) => ({ ...entry, value: Math.abs(entry.balance) })), [summary]);

  const loadDashboard = useCallback(async () => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setAccountsError("");
    setTransactionsError("");
    setAccountsLoading(true);
    setTransactionsLoading(true);

    if (!startDate || !endDate || startDate > endDate) {
      const message = "Tanggal mulai tidak boleh setelah tanggal akhir.";
      setAccountsError(message);
      setTransactionsError(message);
      setAccountsLoading(false);
      setTransactionsLoading(false);
      return;
    }

    const params = { start_date: startDate, end_date: endDate };
    const [accountsResult, transactionsResult] = await Promise.allSettled([
      api.get("/finance/chart-of-accounts", { params }),
      api.get("/v1/finance/recent-transactions", { params }),
    ]);

    if (requestId.current !== currentRequestId) return;
    if (accountsResult.status === "fulfilled") {
      setAccounts(accountsResult.value.data);
    } else {
      setAccountsError(errMsg(accountsResult.reason));
    }
    if (transactionsResult.status === "fulfilled") {
      setTransactions(transactionsResult.value.data.data);
    } else {
      setTransactionsError(errMsg(transactionsResult.reason));
    }
    setAccountsLoading(false);
    setTransactionsLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const formatDateTime = (value) => new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div>
      <PageHeader title="Dashboard & Neraca Keuangan" subtitle="Ringkasan mutasi kas, aset, liabilitas, dan ekuitas pada rentang tanggal terpilih.">
        <button type="button" onClick={loadDashboard} className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:border-primary">Perbarui</button>
      </PageHeader>
      <section className="mb-6 grid gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Tanggal mulai
          <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Tanggal akhir
          <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3" />
        </label>
      </section>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Mutasi kas & bank" value={rp(summary.cashBank)} />
        <StatCard label="Mutasi total aset" value={rp(summary.totalAssets)} />
        <StatCard label="Mutasi persediaan" value={rp(summary.inventory)} />
        <StatCard label="Mutasi liabilitas + ekuitas" value={rp(summary.liabilitiesEquity)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Komposisi Aset</h2>
          {accountsError && <div className="mb-4"><FinanceError message={accountsError} onRetry={loadDashboard} /></div>}
          {accountsLoading ? <LoadingPanel /> : !hasMutations ? (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">Tidak ada mutasi jurnal pada rentang tanggal ini.</p>
          ) : assetComposition.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">Tidak ada mutasi aset pada rentang tanggal ini.</p>
          ) : (
            <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="h-56 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={assetComposition}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {assetComposition.map((entry, index) => (
                        <Cell key={entry.name} fill={ASSET_COLORS[index % ASSET_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(_, __, item) => rp(item.payload.balance)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-3 text-sm">
                {assetComposition.map((entry, index) => (
                  <li key={entry.name} className="flex items-start gap-2">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: ASSET_COLORS[index % ASSET_COLORS.length] }} />
                    <span>
                      <span className="block text-muted-foreground">{entry.name}</span>
                      <span className="font-medium">{rp(entry.balance)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Riwayat Jurnal Terbaru</h2>
          {transactionsError && <div className="mb-4"><FinanceError message={transactionsError} onRetry={loadDashboard} /></div>}
          {transactionsLoading ? <LoadingPanel /> : (
            <FinanceTable
              rows={transactions}
              emptyText="Tidak ada mutasi jurnal pada rentang tanggal ini."
              columns={[
                { key: "tanggal", label: "Tanggal", render: (row) => formatDateTime(row.tanggal) },
                { key: "keterangan", label: "Keterangan" },
                { key: "kode_akun", label: "Kode Akun" },
                {
                  key: "nilai",
                  label: "Nilai",
                  className: "text-right whitespace-nowrap",
                  render: (row) => (
                    <span>
                      <Money value={Number(row.debit) > 0 ? row.debit : row.kredit} />
                      {Number(row.debit) <= 0 && Number(row.kredit) > 0 ? " K" : ""}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </section>
      </div>
    </div>
  );
}
