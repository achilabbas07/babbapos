import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errMsg, rp } from "@/lib/api";

export function SupplierPaymentDialog({ open, onOpenChange, purchase, onSaved }) {
  const [fundingAccount, setFundingAccount] = useState("");
  const [fundingAccounts, setFundingAccounts] = useState([]);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && purchase) {
      setFundingAccount("");
      setAmount(String(purchase.sisa_utang));
      api.get("/finance/funding-accounts")
        .then(({ data }) => {
          if (!Array.isArray(data)) throw new Error("Respons daftar sumber dana tidak valid.");
          setFundingAccounts(data);
          setFundingAccount(data[0]?.account_code || "");
        })
        .catch((error) => toast.error(errMsg(error)));
    }
  }, [open, purchase]);

  const save = async (event) => {
    event.preventDefault();
    const paidAmount = Number(amount);
    if (!Number.isSafeInteger(paidAmount) || paidAmount <= 0) {
      toast.error("Jumlah bayar harus berupa Rupiah bulat yang lebih besar dari nol.");
      return;
    }
    if (paidAmount > Number(purchase.sisa_utang)) {
      toast.error("Jumlah pembayaran melebihi sisa utang aktual.");
      return;
    }
    if (!fundingAccount) {
      toast.error("Tidak ada akun kas atau bank yang tersedia sebagai sumber dana.");
      return;
    }

    setSaving(true);
    try {
      await api.post("/v1/finance/pay-supplier", {
        purchase_id: purchase.id,
        sumber_dana_akun: fundingAccount,
        jumlah_bayar: paidAmount,
      });
      toast.success("Pembayaran utang supplier berhasil dicatat.");
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="supplier-payment-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bayar Utang Supplier</DialogTitle>
          <DialogDescription>Catat pembayaran untuk nota pembelian yang belum lunas.</DialogDescription>
        </DialogHeader>
        {purchase && (
          <form onSubmit={save} className="space-y-4">
            <div className="rounded-lg bg-secondary px-3 py-2 text-sm">
              <p>ID Pembelian: <span className="font-mono font-medium">{purchase.id}</span></p>
              <p>Sisa utang saat ini: <span className="font-mono font-semibold">{rp(purchase.sisa_utang)}</span></p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supplier-payment-account">Sumber Dana Akun</Label>
              <Select value={fundingAccount} onValueChange={setFundingAccount}>
                <SelectTrigger id="supplier-payment-account" data-testid="supplier-payment-account">
                  <SelectValue placeholder="Pilih sumber dana" />
                </SelectTrigger>
                <SelectContent>
                  {fundingAccounts.map((account) => (
                    <SelectItem key={account.account_code} value={account.account_code}>
                      {account.account_name} ({account.account_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supplier-payment-amount">Jumlah Bayar</Label>
              <Input
                id="supplier-payment-amount"
                data-testid="supplier-payment-amount"
                type="number"
                min="1"
                max={purchase.sisa_utang}
                step="1"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Batal
              </Button>
              <Button data-testid="supplier-payment-submit" type="submit" disabled={saving || !amount || !fundingAccount}>
                {saving ? "Memproses..." : "Konfirmasi Bayar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
