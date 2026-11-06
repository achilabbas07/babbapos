import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, rp, todayStr } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { FinanceError } from "./FinanceShared";

const ACCOUNT_TYPES = [
  ["asset", "Aset"],
  ["liability", "Liabilitas"],
  ["equity", "Ekuitas"],
  ["revenue", "Pendapatan"],
  ["expense", "Beban"],
];

const newLine = (accountCode = "", accountName = "", accountType = "") => ({
  accountCode,
  accountName,
  accountType,
  debit: "",
  credit: "",
});

const amountInCents = (value) => Math.round((Number(value) || 0) * 100);

export default function Journal() {
  const [date, setDate] = useState(todayStr());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([newLine(), newLine()]);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError("");
    try {
      const { data } = await api.get("/finance/accounts");
      setAccounts(data);
    } catch (error) {
      setAccountsError(errMsg(error));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const totalDebit = lines.reduce((total, line) => total + amountInCents(line.debit), 0);
  const totalCredit = lines.reduce((total, line) => total + amountInCents(line.credit), 0);
  const balanced = totalDebit === totalCredit;
  const validLines = lines.length >= 2 && lines.every((line) => {
    const debit = amountInCents(line.debit);
    const credit = amountInCents(line.credit);
    const account = accounts.find(({ account_code }) => account_code === line.accountCode);
    return account?.account_type === line.accountType && (debit > 0) !== (credit > 0);
  });
  const canSave = balanced && validLines && Boolean(date && description.trim()) && !saving;

  const updateLine = (index, key, value) => {
    setLines((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, [key]: value } : line
    )));
  };

  const selectAccount = (index, accountCode) => {
    const account = accounts.find((item) => item.account_code === accountCode);
    setLines((current) => current.map((line, lineIndex) => (
      lineIndex === index
        ? {
          ...line,
          accountCode,
          accountName: account?.account_name || "",
          accountType: account?.account_type || "",
        }
        : line
    )));
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await api.post("/finance/journals", {
        date,
        description: description.trim(),
        lines: lines.map((line) => ({
          ...line,
          accountName: line.accountName.trim(),
          accountCode: line.accountCode,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
        })),
      });
      toast.success("Jurnal umum berhasil disimpan.");
      setDescription("");
      setLines([newLine(), newLine()]);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Input Jurnal Umum" subtitle="Catat transaksi berpasangan dan pastikan total debit sama dengan kredit." />
      <form onSubmit={save} className="space-y-6">
        <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[200px_1fr]">
          <label className="space-y-1.5 text-sm font-medium">
            Tanggal transaksi
            <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3" />
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            Keterangan transaksi
            <input required maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Contoh: Penjualan tunai harian" className="h-10 w-full rounded-lg border border-border bg-background px-3" />
          </label>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-semibold">Baris jurnal</h2>
              <p className="mt-1 text-xs text-muted-foreground">Minimal dua akun; setiap baris hanya boleh berisi debit atau kredit.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, newLine()])}>
              <Plus className="mr-1 h-4 w-4" />Tambah baris
            </Button>
          </div>
          {accountsError && <div className="p-4 pb-0"><FinanceError message={accountsError} onRetry={loadAccounts} /></div>}
          <div className="space-y-3 p-4">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[minmax(160px,1.3fr)_minmax(130px,0.8fr)_minmax(130px,0.8fr)_minmax(130px,0.8fr)_40px] md:items-end">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Nama akun
                  <select required value={line.accountCode} disabled={accountsLoading || accounts.length === 0} onChange={(event) => selectAccount(index, event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60">
                    <option value="">{accountsLoading ? "Memuat akun..." : "Pilih akun"}</option>
                    {accounts.map((account) => (
                      <option key={account.account_code} value={account.account_code} disabled={!account.account_type}>
                        {account.account_name} ({account.account_code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Kelompok akun
                  <select required value={line.accountType} disabled className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-75">
                    <option value="">Pilih nama akun terlebih dahulu</option>
                    {ACCOUNT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Debit (Rp)
                  <input type="number" min="0" step="0.01" value={line.debit} onChange={(event) => updateLine(index, "debit", event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-right font-mono text-sm text-foreground" />
                </label>
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Kredit (Rp)
                  <input type="number" min="0" step="0.01" value={line.credit} onChange={(event) => updateLine(index, "credit", event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-right font-mono text-sm text-foreground" />
                </label>
                <button type="button" disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} aria-label={`Hapus baris akun ${index + 1}`} className="grid h-10 w-10 place-items-center rounded-lg border border-border text-muted-foreground hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className={`grid gap-4 rounded-2xl border p-5 sm:grid-cols-2 ${balanced ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total Debit</p>
            <p className="mt-1 font-mono text-xl font-semibold">{rp(totalDebit / 100)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total Kredit</p>
            <p className="mt-1 font-mono text-xl font-semibold">{rp(totalCredit / 100)}</p>
          </div>
          <p className={`sm:col-span-2 text-sm font-medium ${balanced ? "text-emerald-700" : "text-destructive"}`}>
            {balanced ? "Jurnal seimbang." : "Jurnal belum seimbang. Samakan total debit dan kredit untuk menyimpan."}
          </p>
        </section>

        <div className="flex justify-end">
          <Button type="submit" disabled={!canSave} className="min-w-40">
            {saving ? "Menyimpan..." : "Simpan Jurnal"}
          </Button>
        </div>
      </form>
    </div>
  );
}
