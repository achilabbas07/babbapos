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
const EMPTY_FORM = { account_code: "", account_name: "", account_category: "" };

export default function COAFormModal({ open, onOpenChange, account, onSubmit }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        account_code: account?.account_code ?? "",
        account_name: account?.account_name ?? "",
        account_category: account?.account_category ?? "",
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
    setSaving(true);
    try {
      await onSubmit({
        account_code: form.account_code.trim(),
        account_name: form.account_name.trim(),
        account_category: accountCategory,
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
              maxLength={32}
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
              maxLength={160}
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
