import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Printer } from "lucide-react";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { useProfile } from "@/context/ProfileContext";
import { api, errMsg, rp } from "@/lib/api";
import { FinanceError, FinanceTable, LoadingPanel, Money } from "./FinanceShared";
import FinanceDateFilter from "./FinanceDateFilter";
import { normalizeProfitLossData, orderProfitLossHppRows, orderProfitLossRevenueRows } from "./profitAndLossData";

export default function ProfitAndLoss() {
  const { profile, appName } = useProfile();
  const [filters, setFilters] = useState(() => {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const profitLossResponse = await api.get("/finance/profit-loss", { params: filters });
      const report = normalizeProfitLossData(profitLossResponse.data);
      setRows(report.rows);
      setSummary(report.summary);
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const revenues = orderProfitLossRevenueRows(rows.filter((row) => row.account_type === "revenue"));
  const hppRows = orderProfitLossHppRows(rows.filter((row) => row.account_type === "cogs"));
  const expenses = rows.filter((row) => row.account_type === "expense");
  const exportExcel = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [appName],
      ["LAPORAN LABA RUGI"],
      ["Tanggal cetak", new Date().toLocaleDateString("id-ID")],
      [],
      ["Jenis", "No. akun", "Nama akun", "Jumlah (Rp)"],
      ...revenues.map((row) => ["Pendapatan", row.account_code || "", row.account_name, Number(row.balance) || 0]),
      ...hppRows.map((row) => [
        row.is_hpp_parent ? "HPP" : "HPP - Rincian",
        row.account_code || "",
        row.is_hpp_parent ? row.account_name : `   ${row.account_name}`,
        Number(row.balance) || 0,
      ]),
      ...expenses.map((row) => ["Beban", row.account_code || "", row.account_name, Number(row.balance) || 0]),
      [],
      ["Ringkasan", "Total"],
      ["Total pendapatan", Number(summary?.revenue) || 0],
      ["Potongan Penjualan", -(Number(summary?.sales_discount) || 0)],
      ["HPP", Number(summary?.hpp) || 0],
      ["Total beban", Number(summary?.expenses) || 0],
      ["Laba / (rugi) bersih", Number(summary?.net_profit) || 0],
    ]);
    sheet["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 40 }, { wch: 22 }];
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let row = 5; row <= range.e.r; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: 3 })];
      if (cell && typeof cell.v === "number") cell.z = '"Rp" #,##0.00';
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Laba Rugi");
    XLSX.writeFile(workbook, `laporan-laba-rugi-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div>
      <div className="no-print print:hidden">
        <PageHeader title="Laporan Laba Rugi" subtitle="Rincian pendapatan, HPP, dan beban operasional berdasarkan periode yang dipilih.">
          <button type="button" disabled={!summary} onClick={exportExcel} className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:border-primary disabled:opacity-50">
            <Download className="mr-2 h-4 w-4" />Unduh Excel
          </button>
          <button type="button" disabled={!summary} onClick={() => window.print()} className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <Printer className="mr-2 h-4 w-4" />Cetak / PDF
          </button>
        </PageHeader>
      </div>
      <div className="relative z-10 no-print print:hidden">
        <FinanceDateFilter initialMode="month" onApply={setFilters} />
      </div>
      {error && <div className="no-print print:hidden mb-5"><FinanceError message={error} onRetry={load} /></div>}
      {loading ? <LoadingPanel /> : summary && (
        <div className="finance-print-area rounded-2xl border border-border bg-card p-5 sm:p-8">
          <header className="mb-7 border-b-2 border-slate-800 pb-4 text-center">
            <h1 className="text-2xl font-bold uppercase tracking-wide">{appName}</h1>
            {profile.address && <p className="mt-1 text-sm">{profile.address}</p>}
            {profile.phone && <p className="text-sm">{profile.phone}</p>}
            <h2 className="mt-5 text-lg font-bold uppercase tracking-wider">Laporan Laba Rugi</h2>
            <p className="mt-1 text-xs text-muted-foreground">Dicetak {new Date().toLocaleDateString("id-ID", { dateStyle: "long" })}</p>
          </header>

          <div className="no-print print:hidden mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Total pendapatan" value={rp(summary.revenue)} tone="text-emerald-700" />
            <StatCard label="Potongan Penjualan" value={rp(summary.sales_discount)} tone="text-amber-700" />
            <StatCard label="HPP" value={rp(summary.hpp)} tone="text-amber-700" />
            <StatCard label="Total beban" value={rp(summary.expenses)} tone="text-destructive" />
            <StatCard label="Laba / (rugi) bersih" value={rp(summary.net_profit)} tone={Number(summary.net_profit) >= 0 ? "text-primary" : "text-destructive"} />
          </div>

          <div className="space-y-6">
            <FinanceTable
              rows={revenues}
              emptyText="Belum ada pendapatan tercatat."
              columns={[
                { key: "account_name", label: "Pendapatan" },
                { key: "balance", label: "Jumlah", className: "finance-amount text-right", render: (row) => <Money value={row.balance} /> },
              ]}
            />
            <FinanceTable
              rows={hppRows}
              emptyText="Belum ada HPP tercatat."
              columns={[
                {
                  key: "account_name",
                  label: "Harga Pokok Penjualan (HPP)",
                  render: (row) => (
                    <span className={row.is_hpp_detail ? "pl-6 text-muted-foreground" : "font-semibold"}>
                      {row.account_name}
                    </span>
                  ),
                },
                { key: "balance", label: "Jumlah", className: "finance-amount text-right", render: (row) => <Money value={row.balance} /> },
              ]}
            />
            <FinanceTable
              rows={expenses}
              emptyText="Belum ada beban tercatat."
              columns={[
                { key: "account_code", label: "No. akun" },
                { key: "account_name", label: "Beban operasional" },
                { key: "balance", label: "Jumlah", className: "finance-amount text-right", render: (row) => <Money value={row.balance} /> },
              ]}
            />
            <section className="ml-auto max-w-md space-y-2 border-t-2 border-slate-800 pt-4">
              <div className="flex justify-between gap-4 text-sm"><span>Total pendapatan</span><Money value={summary.revenue} /></div>
              <div className="flex justify-between gap-4 text-sm"><span>Potongan Penjualan</span><Money value={-summary.sales_discount} /></div>
              <div className="flex justify-between gap-4 text-sm"><span>Harga Pokok Penjualan (HPP)</span><Money value={summary.hpp} /></div>
              <div className="flex justify-between gap-4 text-sm"><span>Total beban</span><Money value={summary.expenses} /></div>
              <div className="flex justify-between gap-4 border-t border-slate-400 pt-2 font-bold"><span>Laba / (rugi) bersih</span><Money value={summary.net_profit} /></div>
            </section>
          </div>

          <div className="mt-16 flex justify-end">
            <div className="min-w-56 text-center text-sm">
              <p>{new Date().toLocaleDateString("id-ID", { dateStyle: "long" })}</p>
              <p className="mt-1 font-semibold">Admin Keuangan</p>
              <div className="mx-auto mt-20 w-48 border-t border-slate-700" />
              <p className="mt-2">BabbaPOS</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
