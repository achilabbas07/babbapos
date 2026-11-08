import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Download } from "lucide-react";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { api, errMsg, rp } from "@/lib/api";
import { FinanceError, FinanceTable, LoadingPanel, Money } from "./FinanceShared";
import { getAccountType, isCashBankAccount } from "@/lib/accountClassification";

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
  const [dashboardSummary, setDashboardSummary] = useState({});
  const [dashboardSummaryError, setDashboardSummaryError] = useState("");
  const [positionSummary, setPositionSummary] = useState({});
  const [positionSummaryError, setPositionSummaryError] = useState("");
  const [pdfError, setPdfError] = useState("");
  const requestId = useRef(0);

  const summary = useMemo(() => accounts.reduce((totals, account) => {
    const balance = Number(account.balance) || 0;
    const accountType = getAccountType(account) || account.account_type;
    if (accountType === "asset") {
      totals.totalAssets += balance;
      if (isCashBankAccount(account)) totals.cashBank += balance;
      if (/(persediaan|inventory)/i.test(account.account_name || "")) totals.inventory += balance;
    }
    if (accountType === "liability" || accountType === "equity") {
      totals.liabilitiesEquity += balance;
    }
    return totals;
  }, { cashBank: 0, inventory: 0, totalAssets: 0, liabilitiesEquity: 0 }), [accounts]);
  const inventoryBalance = Number(
    dashboardSummary?.persediaan_bahan_baku
      ?? dashboardSummary?.inventory
      ?? summary.inventory
      ?? 0,
  ) || 0;
  const liabilitiesEquityBalance = Number(
    dashboardSummary?.total_liabilitas_ekuitas
      ?? dashboardSummary?.liabilitiesEquity
      ?? dashboardSummary?.totalLiabilitiesEquity
      ?? summary.liabilitiesEquity
      ?? 0,
  ) || 0;

  // Posisi keuangan kumulatif (ending balance) dari awal usaha s.d. tanggal akhir.
  const position = useMemo(() => {
    const hasPosition = positionSummary && Object.keys(positionSummary).length > 0;
    const cashBank = Number(positionSummary?.cash_bank ?? summary.cashBank) || 0;
    const inventory = Number(positionSummary?.inventory ?? inventoryBalance) || 0;
    const totalAssets = Number(positionSummary?.total_assets ?? summary.totalAssets) || 0;
    const totalLiabilities = Number(positionSummary?.total_liabilities ?? 0) || 0;
    const equityAccounts = Number(positionSummary?.equity_accounts ?? 0) || 0;
    const netProfit = Number(positionSummary?.net_profit ?? 0) || 0;
    const totalEquity = Number(positionSummary?.total_equity ?? equityAccounts + netProfit) || 0;
    const totalLiabilitiesEquity = Number(
      positionSummary?.total_liabilities_equity
        ?? liabilitiesEquityBalance
        ?? totalLiabilities + totalEquity,
    ) || 0;
    return {
      hasPosition,
      cashBank,
      inventory,
      totalAssets,
      totalLiabilities,
      equityAccounts,
      netProfit,
      totalEquity,
      totalLiabilitiesEquity,
      difference: Number(positionSummary?.difference ?? totalAssets - totalLiabilitiesEquity) || 0,
    };
  }, [positionSummary, summary, inventoryBalance, liabilitiesEquityBalance]);

  const assetComposition = useMemo(() => {
    const positionAccounts = Array.isArray(positionSummary?.accounts) ? positionSummary.accounts : [];
    const assetAccounts = positionAccounts.filter((account) => account.account_type === "asset");
    if (assetAccounts.length > 0) {
      const cashBank = assetAccounts
        .filter((account) => isCashBankAccount(account))
        .reduce((total, account) => total + (Number(account.balance) || 0), 0);
      const inventory = assetAccounts
        .filter((account) => /(persediaan|inventory)/i.test(account.account_name || ""))
        .reduce((total, account) => total + (Number(account.balance) || 0), 0);
      const totalAssets = assetAccounts.reduce((total, account) => total + (Number(account.balance) || 0), 0);
      return [
        { name: "Kas & Bank", balance: cashBank },
        { name: "Persediaan", balance: inventory },
        { name: "Aset Lainnya", balance: totalAssets - cashBank - inventory },
      ].filter((entry) => entry.balance !== 0)
        .map((entry) => ({ ...entry, value: Math.abs(entry.balance) }));
    }
    return [
      { name: "Kas & Bank", balance: summary.cashBank },
      { name: "Persediaan", balance: summary.inventory },
      { name: "Aset Lainnya", balance: summary.totalAssets - summary.cashBank - summary.inventory },
    ].filter((entry) => entry.balance !== 0)
      .map((entry) => ({ ...entry, value: Math.abs(entry.balance) }));
  }, [positionSummary, summary]);

  const loadDashboard = useCallback(async () => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setAccountsError("");
    setTransactionsError("");
    setDashboardSummaryError("");
    setPositionSummaryError("");
    setPdfError("");
    setAccountsLoading(true);
    setTransactionsLoading(true);

    if (!startDate || !endDate || startDate > endDate) {
      const message = "Tanggal mulai tidak boleh setelah tanggal akhir.";
      setAccountsError(message);
      setTransactionsError(message);
      setDashboardSummaryError(message);
      setPositionSummaryError(message);
      setAccountsLoading(false);
      setTransactionsLoading(false);
      return;
    }

    const params = { start_date: startDate, end_date: endDate };
    const [accountsResult, transactionsResult, summaryResult, positionResult] = await Promise.allSettled([
      api.get("/finance/chart-of-accounts", { params }),
      api.get("/v1/finance/recent-transactions", { params }),
      api.get("/v1/finance/dashboard-summary"),
      api.get("/v1/finance/position-summary", { params: { end_date: endDate } }),
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
    if (summaryResult.status === "fulfilled") {
      const payload = summaryResult.value?.data?.data ?? summaryResult.value?.data;
      setDashboardSummary(payload && typeof payload === "object" ? payload : {});
    } else {
      setDashboardSummary({});
      setDashboardSummaryError(errMsg(summaryResult.reason));
    }
    if (positionResult.status === "fulfilled") {
      const payload = positionResult.value?.data?.data ?? positionResult.value?.data;
      setPositionSummary(payload && typeof payload === "object" ? payload : {});
    } else {
      setPositionSummary({});
      // Endpoint posisi kumulatif mungkin belum tersedia di backend lama;
      // jangan ganggu halaman, cukup fallback ke ringkasan yang ada.
      const status = positionResult.reason?.response?.status;
      if (status !== 404 && status !== 501) {
        setPositionSummaryError(errMsg(positionResult.reason));
      }
    }
    setAccountsLoading(false);
    setTransactionsLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const formatDateTime = (value) => new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const handleDownloadPdf = async () => {
    setPdfError("");
    try {
      const { downloadFinancePositionPDF } = await import("@/lib/financePositionPdf");
      downloadFinancePositionPDF({
        position: {
          cash_bank: position.cashBank,
          inventory: position.inventory,
          total_assets: position.totalAssets,
          total_liabilities: position.totalLiabilities,
          equity_accounts: position.equityAccounts,
          net_profit: position.netProfit,
          total_equity: position.totalEquity,
          total_liabilities_equity: position.totalLiabilitiesEquity,
          difference: position.difference,
        },
        transactions,
        startDate,
        endDate,
      });
    } catch (error) {
      setPdfError(error?.message || "Gagal membuat dokumen PDF. Silakan coba lagi.");
    }
  };

  return (
    <div>
      <PageHeader title="Dashboard & Laporan Posisi Keuangan (Neraca)" subtitle="Posisi saldo akhir kumulatif kas, aset, liabilitas, dan ekuitas sejak awal usaha hingga tanggal akhir terpilih.">
        <button type="button" onClick={loadDashboard} className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:border-primary">Perbarui</button>
        <button type="button" onClick={handleDownloadPdf} className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <Download className="h-4 w-4" /> Download PDF
        </button>
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
      {pdfError && <div className="mb-4"><FinanceError message={pdfError} /></div>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardSummaryError && <div className="sm:col-span-2 xl:col-span-4"><FinanceError message={dashboardSummaryError} onRetry={loadDashboard} /></div>}
        {positionSummaryError && <div className="sm:col-span-2 xl:col-span-4"><FinanceError message={positionSummaryError} onRetry={loadDashboard} /></div>}
        <StatCard label="Total Kas & Bank" value={rp(position.cashBank)} />
        <StatCard label="Total Aset" value={rp(position.totalAssets)} />
        <StatCard label="Persediaan" value={rp(position.inventory)} />
        <StatCard label="Total Liabilitas & Ekuitas" value={rp(position.totalLiabilitiesEquity)} />
      </div>
      {position.hasPosition && (
        <section className="mb-6 grid gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Liabilitas</p>
            <p className="mt-2 font-mono text-xl font-semibold">{rp(position.totalLiabilities)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Ekuitas (Akun Modal)</p>
            <p className="mt-2 font-mono text-xl font-semibold">{rp(position.equityAccounts)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Laba Berjalan (Kumulatif)</p>
            <p className="mt-2 font-mono text-xl font-semibold">{rp(position.netProfit)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status Keseimbangan</p>
            <p className={`mt-2 text-sm font-semibold ${Math.abs(position.difference) < 0.5 ? "text-emerald-600" : "text-destructive"}`}>
              {Math.abs(position.difference) < 0.5 ? "Seimbang (Aset = Liabilitas + Ekuitas)" : `Selisih ${rp(position.difference)}`}
            </p>
          </div>
        </section>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Komposisi Aset</h2>
          {accountsError && <div className="mb-4"><FinanceError message={accountsError} onRetry={loadDashboard} /></div>}
          {accountsLoading ? <LoadingPanel /> : assetComposition.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">Belum ada saldo aset tercatat hingga tanggal ini.</p>
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
              emptyText="Tidak ada jurnal pada rentang tanggal ini."
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
