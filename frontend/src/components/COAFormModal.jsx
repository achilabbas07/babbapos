import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { errMsg } from "@/lib/api";
import {
  getAccountCategoryFallback,
  getAccountType,
  normalizeAccountCategory,
} from "@/lib/accountClassification";
import { COA_HEADER_MAX_LENGTH, getAccountHeader } from "@/lib/coaGrouping";

const ACCOUNT_CATEGORIES = [
  { value: "Aset Lancar", label: "Aset Lancar" },
  { value: "Kas & Bank", label: "Kas & Bank" },
  { value: "Liabilitas", label: "Liabilitas" },
  { value: "Ekuitas", label: "Ekuitas" },
  { value: "Pendapatan", label: "Pendapatan" },
  { value: "Pendapatan Lainnya", label: "Pendapatan Lainnya" },
  { value: "Beban Pokok Pendapatan", label: "Beban Pokok Pendapatan" },
  { value: "Bahan Penunjang", label: "Bahan Penunjang" },
  { value: "Beban Operasional", label: "Beban Operasional" },
  { value: "balance_sheet", label: "Neraca" },
];
const EMPTY_FORM = { account_code: "", account_name: "", account_category: "", header: "" };

// Batas panjang mengikuti kolom asli `public.chart_of_accounts`, BUKAN batas
// Pydantic di backend (code 32 / name 160). Kolom database hanya
// varchar(15) dan varchar(100); input yang lebih panjang akan ditolak
// PostgreSQL dan tampil sebagai error 500 yang membingungkan pengguna.
const ACCOUNT_CODE_MAX_LENGTH = 15;
const ACCOUNT_NAME_MAX_LENGTH = 100;

export default function COAFormModal({
  open,
  onOpenChange,
  account,
  headerOptions = [],
  onSubmit,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        account_code: account?.account_code ?? "",
        account_name: account?.account_name ?? "",
        account_category: account?.account_category ?? "",
        header: getAccountHeader(account),
      });
    }
  }, [open, account]);

  const setField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };
  const accountCategory = normalizeAccountCategory({
    account_category: form.account_category
      || getAccountCategoryFallback({
        account_code: form.account_code,
        account_name: form.account_name,
      }),
    account_code: form.account_code,
  });
  const categoryOption = ACCOUNT_CATEGORIES.find(({ value }) => value === accountCategory);
  const customCategory = accountCategory && !categoryOption
    ? { value: accountCategory, label: accountCategory }
    : null;

  const submit = async (event) => {
    event.preventDefault();

    // Backend menolak kategori tanpa tipe akuntansi yang jelas
    // ("Jenis akun tidak didukung."). Cek lebih dulu agar pengguna tidak
    // melihat error 422 setelah menekan Simpan.
    if (!getAccountType({ account_category: accountCategory, account_code: form.account_code })) {
      toast.error("Jenis akun tidak didukung untuk kode akun ini. Periksa kode dan jenis akun.");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        account_code: form.account_code.trim(),
        account_name: form.account_name.trim(),
        account_category: accountCategory,
        header: form.header.trim(),
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (nextOpen) => {
    if (!saving) onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="coa-form-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{account ? "Edit Akun" : "Tambah Akun"}</DialogTitle>
          <DialogDescription>
            Kelompok akun menggunakan pilihan baku agar laporan keuangan tetap konsisten.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="coa-account-code">Kode Akun</Label>
            <Input
              id="coa-account-code"
              data-testid="coa-account-code"
              value={form.account_code}
              onChange={setField("account_code")}
              maxLength={ACCOUNT_CODE_MAX_LENGTH}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="coa-account-name">Nama Akun</Label>
            <Input
              id="coa-account-name"
              data-testid="coa-account-name"
              value={form.account_name}
              onChange={setField("account_name")}
              maxLength={ACCOUNT_NAME_MAX_LENGTH}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="coa-account-category">Jenis Akun</Label>
            <select
              id="coa-account-category"
              data-testid="coa-account-category"
              value={accountCategory}
              onChange={setField("account_category")}
              required
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="" disabled>Pilih jenis akun</option>
              {customCategory && getAccountType({ account_category: customCategory.value }) && (
                <option value={customCategory.value}>{customCategory.label}</option>
              )}
              {ACCOUNT_CATEGORIES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="coa-account-header">Header (opsional)</Label>
            <Input
              id="coa-account-header"
              data-testid="coa-account-header"
              value={form.header}
              onChange={setField("header")}
              maxLength={COA_HEADER_MAX_LENGTH}
              list="coa-header-options"
              placeholder="mis. Beban Karyawan"
              autoComplete="off"
            />
            <datalist id="coa-header-options">
              {headerOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Sub-kelompok tampilan akun. Kosongkan bila belum ditentukan.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Batal
            </Button>
            <Button data-testid="coa-form-submit" type="submit" disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
