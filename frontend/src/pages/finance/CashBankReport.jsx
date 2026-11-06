import { useCallback, useEffect, useState } from "react";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { api, errMsg, rp } from "@/lib/api";
import { FinanceError, FinanceTable, LoadingPanel, Money } from "./FinanceShared";

export default function CashBankReport() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get("/finance/cash-flow");
      setRows(data);
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const totalBalance = rows.reduce((total, row) => total + Number(row.saldo_berjalan || 0), 0);

  return (
    <div>
      <PageHeader title="Buku Kas & Bank" subtitle="Saldo kumulatif berdasarkan sumber dana. Data diperbarui otomatis setiap 30 detik.">
        <button type="button" onClick={load} className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:border-primary">Perbarui</button>
      </PageHeader>
      {error && <div className="mb-5"><FinanceError message={error} onRetry={load} /></div>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Jumlah sumber dana" value={rows.length} />
        <StatCard label="Total saldo berjalan" value={rp(totalBalance)} />
      </div>
      {loading ? <LoadingPanel /> : (
        <FinanceTable
          rows={rows}
          emptyText="Belum ada saldo kas atau bank."
          columns={[
            { key: "sumber_dana", label: "Sumber dana" },
            { key: "account_code", label: "Kode akun" },
            { key: "saldo_berjalan", label: "Saldo berjalan", className: "text-right", render: (row) => <Money value={row.saldo_berjalan} /> },
          ]}
        />
      )}
    </div>
  );
}
