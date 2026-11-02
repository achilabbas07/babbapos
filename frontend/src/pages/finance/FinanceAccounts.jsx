import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { api, errMsg } from "@/lib/api";
import { FinanceError, FinanceTable, LoadingPanel, Money } from "./FinanceShared";

export default function FinanceAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const loadAccounts = useCallback(async () => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setLoading(true);
    setError("");

    try {
      const { data } = await api.get("/finance/account-balances");
      if (!Array.isArray(data)) {
        throw new Error("Respons daftar akun dari server tidak valid.");
      }
      if (requestId.current === currentRequestId) setAccounts(data);
    } catch (requestError) {
      if (requestId.current === currentRequestId) setError(errMsg(requestError));
    } finally {
      if (requestId.current === currentRequestId) setLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  return (
    <div>
      <PageHeader
        title="Daftar Akun (Chart of Accounts)"
        subtitle="Saldo terbaru dari daftar akun keuangan."
      >
        <button
          type="button"
          onClick={loadAccounts}
          disabled={loading}
          className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Perbarui
        </button>
      </PageHeader>

      <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
        {error && <div className="mb-4"><FinanceError message={error} onRetry={loadAccounts} /></div>}
        {loading ? <LoadingPanel /> : (
          <FinanceTable
            rows={accounts}
            emptyText="Belum ada akun di Chart of Accounts."
            columns={[
              { key: "kode_akun", label: "Kode Akun" },
              { key: "nama_akun", label: "Nama Akun" },
              { key: "kategori_akun", label: "Kategori Akun" },
              {
                key: "current_balance",
                label: "Saldo Saat Ini",
                className: "text-right whitespace-nowrap",
                render: (row) => <Money value={row.current_balance} />,
              },
            ]}
          />
        )}
      </section>
    </div>
  );
}
