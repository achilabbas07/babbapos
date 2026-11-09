import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errMsg } from "@/lib/api";

const EMPTY_FORM = {
  nama_supplier: "",
  kontak_person: "",
  nomor_telp: "",
  alamat: "",
};

export function SupplierDialog({ open, onOpenChange, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setSaving(false);
    }
  }, [open]);

  const update = (field) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async (event) => {
    event.preventDefault();
    const namaSupplier = form.nama_supplier.trim();
    if (!namaSupplier) {
      toast.error("Nama supplier wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/v1/finance/suppliers", {
        nama_supplier: namaSupplier,
        kontak_person: form.kontak_person.trim() || null,
        nomor_telp: form.nomor_telp.trim() || null,
        alamat: form.alamat.trim() || null,
      });
      toast.success("Supplier baru berhasil disimpan.");
      await onCreated?.(data);
      onOpenChange(false);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="supplier-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Supplier Baru</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-nama">Nama Supplier</Label>
            <Input
              id="supplier-nama"
              data-testid="supplier-nama-input"
              value={form.nama_supplier}
              onChange={update("nama_supplier")}
              placeholder="Contoh: Toko Sumber Rejeki"
              autoFocus
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-kontak">Kontak Person</Label>
            <Input
              id="supplier-kontak"
              data-testid="supplier-kontak-input"
              value={form.kontak_person}
              onChange={update("kontak_person")}
              placeholder="Nama penanggung jawab"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-telp">Nomor Telepon</Label>
            <Input
              id="supplier-telp"
              data-testid="supplier-telp-input"
              value={form.nomor_telp}
              onChange={update("nomor_telp")}
              placeholder="08xxxxxxxxxx"
              inputMode="tel"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-alamat">Alamat</Label>
            <Textarea
              id="supplier-alamat"
              data-testid="supplier-alamat-input"
              value={form.alamat}
              onChange={update("alamat")}
              placeholder="Alamat lengkap supplier"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button
              type="submit"
              data-testid="supplier-save-button"
              disabled={saving || !form.nama_supplier.trim()}
            >
              {saving ? "Menyimpan..." : "Simpan Supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
