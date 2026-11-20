import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { api, errMsg, rp } from "@/lib/api";

const EMPTY_FORM = { variant_name: "", additional_price: 0 };
const EMPTY_LINE = () => ({ inventory_id: "", qty_needed: 1 });
const INPUT = "h-10 w-full rounded-md border border-border bg-transparent px-3 text-sm outline-none focus:border-primary";

const IngredientRow = ({ idx, line, materials, onChange, onRemove }) => (
  <div data-testid={`variant-ingredient-row-${idx}`} className="grid grid-cols-[minmax(0,1fr)_100px_36px] items-center gap-2">
    <Select value={line.inventory_id || undefined} onValueChange={(v) => onChange({ inventory_id: v })}>
      <SelectTrigger data-testid={`variant-material-select-${idx}`}><SelectValue placeholder="Pilih bahan baku" /></SelectTrigger>
      <SelectContent>
        {materials.map((material) => (
          <SelectItem key={material.id} value={String(material.id)}>
            {material.name} · stok {Number(material.stock)} {material.unit}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <input
      data-testid={`variant-qty-input-${idx}`}
      type="number"
      min="1"
      value={line.qty_needed}
      onChange={(e) => onChange({ qty_needed: e.target.value })}
      className={`${INPUT} font-mono`}
      placeholder="Qty"
      aria-label={`Kuantitas bahan ${idx + 1}`}
    />
    <Button type="button" variant="ghost" size="icon" data-testid={`variant-remove-ingredient-${idx}`} onClick={onRemove} aria-label={`Hapus bahan ${idx + 1}`}>
      <X className="h-4 w-4 text-muted-foreground" />
    </Button>
  </div>
);

export const VariantAdminDialog = ({ open, products, onClose }) => {
  const [productId, setProductId] = useState("");
  const [variants, setVariants] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [lines, setLines] = useState([EMPTY_LINE()]);
  const [editingId, setEditingId] = useState(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setLines([EMPTY_LINE()]);
  }, []);

  const loadVariants = useCallback(async () => {
    if (!productId) {
      setVariants([]);
      return [];
    }

    setLoadingVariants(true);
    try {
      const { data } = await api.get(`/products/${encodeURIComponent(productId)}/variants`);
      setVariants(data);
      return data;
    } catch (error) {
      toast.error(errMsg(error));
      return null;
    } finally {
      setLoadingVariants(false);
    }
  }, [productId]);

  useEffect(() => {
    if (!open) return;
    setProductId((current) => current || products[0]?.id || "");
    setVariants([]);
    resetForm();
    setLoadingMaterials(true);
    api.get("/inventory")
      .then(({ data }) => setMaterials(data.filter((item) => item.type === "Bahan Baku")))
      .catch((error) => toast.error(errMsg(error)))
      .finally(() => setLoadingMaterials(false));
  }, [open, products, resetForm]);

  useEffect(() => {
    if (!open || !productId) return;
    resetForm();
    loadVariants();
  }, [open, productId, loadVariants, resetForm]);

  const startNew = () => resetForm();

  const editVariant = (variant) => {
    setEditingId(variant.id);
    setForm({ variant_name: variant.variant_name, additional_price: variant.additional_price || 0 });
    setLines(variant.ingredients?.length
      ? variant.ingredients.map((item) => ({ inventory_id: String(item.inventory_id), qty_needed: item.qty_needed }))
      : [EMPTY_LINE()]);
  };

  const updateLine = (index, patch) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const save = async () => {
    const ingredients = lines
      .filter((line) => line.inventory_id)
      .map((line) => ({ inventory_id: line.inventory_id, qty_needed: Number(line.qty_needed) }));
    if (!productId) return toast.error("Pilih menu terlebih dahulu");
    if (!form.variant_name.trim()) return toast.error("Isi nama varian");
    if (!ingredients.length || ingredients.some((item) => !(item.qty_needed > 0))) {
      return toast.error("Isi minimal satu bahan baku dengan kuantitas lebih dari 0");
    }

    const payload = {
      product_id: productId,
      variant_name: form.variant_name.trim(),
      additional_price: Number(form.additional_price) || 0,
      ingredients,
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await api.put(`/variants/${editingId}`, payload);
        toast.success("Varian berhasil diperbarui");
      } else {
        await api.post("/variants", payload);
        toast.success("Varian berhasil ditambahkan");
      }
      resetForm();
      await loadVariants();
    } catch (error) {
      toast.error(`Gagal menyimpan varian: ${errMsg(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteVariant = async (variant) => {
    await api.delete(`/variants/${variant.id}`);
    toast.success(`Varian ${variant.variant_name} berhasil dihapus`);
    if (editingId === variant.id) resetForm();
    await loadVariants();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent data-testid="variant-admin-dialog" className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>Kelola Varian & Resep</DialogTitle></DialogHeader>
        <label className="grid gap-1.5 text-sm font-medium">
          Pilih Menu
          <Select value={productId || undefined} onValueChange={setProductId}>
            <SelectTrigger data-testid="variant-product-select"><SelectValue placeholder="Pilih menu utama" /></SelectTrigger>
            <SelectContent>{products.map((product) => <SelectItem key={product.id} value={String(product.id)}>{product.name}</SelectItem>)}</SelectContent>
          </Select>
        </label>

        <div className="grid min-h-[420px] gap-5 md:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.5fr)]">
          <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Daftar Varian</h3>
              <Button type="button" size="sm" onClick={startNew} disabled={!productId}>
                <Plus className="h-4 w-4" />Tambah Varian Baru
              </Button>
            </div>
            {!productId ? <p className="py-8 text-center text-sm text-muted-foreground">Pilih menu untuk melihat variannya.</p>
              : loadingVariants ? <p className="py-8 text-center text-sm text-muted-foreground">Memuat varian...</p>
                : variants.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Belum ada varian untuk menu ini.</p>
                  : (
                    <div className="space-y-2 overflow-y-auto">
                      {variants.map((variant) => (
                        <div key={variant.id} data-testid={`variant-list-item-${variant.id}`} className={`flex items-center gap-2 rounded-lg border p-3 ${editingId === variant.id ? "border-primary bg-primary/5" : "border-border"}`}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{variant.variant_name}</p>
                            <p className="text-xs text-muted-foreground">+{rp(variant.additional_price || 0)}</p>
                          </div>
                          <Button type="button" variant="ghost" size="icon" data-testid={`variant-edit-${variant.id}`} onClick={() => editVariant(variant)} aria-label={`Edit ${variant.variant_name}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <ConfirmDelete
                            testid={`variant-delete-${variant.id}`}
                            title={`Hapus varian ${variant.variant_name}?`}
                            description="Resep bahan baku varian ini juga akan dihapus."
                            onConfirm={() => deleteVariant(variant)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
          </section>

          <section className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{editingId != null ? "Edit Varian" : "Varian Baru"}</h3>
              {editingId != null && <Button type="button" variant="ghost" size="sm" onClick={startNew}>Batal Edit</Button>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Nama Varian
                <input data-testid="variant-name-input" value={form.variant_name} onChange={(e) => setForm((current) => ({ ...current, variant_name: e.target.value }))} className={INPUT} placeholder="Large / Less Sugar" />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Tambahan Harga (Rp)
                <input data-testid="variant-price-input" type="number" min="0" value={form.additional_price} onChange={(e) => setForm((current) => ({ ...current, additional_price: e.target.value }))} className={`${INPUT} font-mono`} />
              </label>
            </div>

            <div className="space-y-3 rounded-xl bg-secondary p-4">
              <div>
                <p className="text-sm font-semibold">Resep Bahan Baku</p>
                <p className="text-xs text-muted-foreground">Kuantitas bahan yang digunakan untuk satu porsi.</p>
              </div>
              {loadingMaterials ? <p className="text-sm text-muted-foreground">Memuat bahan baku...</p>
                : materials.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada bahan baku di inventory.</p>
                  : lines.map((line, index) => (
                    <IngredientRow
                      key={index}
                      idx={index}
                      line={line}
                      materials={materials}
                      onChange={(patch) => updateLine(index, patch)}
                      onRemove={() => setLines((current) => current.length > 1 ? current.filter((_, i) => i !== index) : [EMPTY_LINE()])}
                    />
                  ))}
              <Button type="button" variant="ghost" size="sm" data-testid="variant-add-ingredient" onClick={() => setLines((current) => [...current, EMPTY_LINE()])}>
                <Plus className="h-4 w-4" />Tambah Bahan Baku
              </Button>
            </div>
            <DialogFooter>
              <Button data-testid="variant-save-button" type="button" onClick={save} disabled={saving || !productId || loadingMaterials}>
                {saving ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
