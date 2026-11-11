import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, ChefHat, UtensilsCrossed, Layers, Percent } from "lucide-react";
import { VariantAdminDialog } from "@/components/VariantAdminDialog";
import { api, errMsg, rp, PRODUCT_TYPE_LABEL } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { FormDialog } from "@/components/FormDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { RecipeDialog } from "@/components/RecipeDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Products() {
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [recipeFor, setRecipeFor] = useState(null);
  const [variantOpen, setVariantOpen] = useState(false);
  const [ojolMarkup, setOjolMarkup] = useState(null);
  const [editingOjol, setEditingOjol] = useState(false);
  const [ojolDraft, setOjolDraft] = useState("");
  const [savingOjol, setSavingOjol] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, i, r] = await Promise.all([api.get("/products"), api.get("/inventory"), api.get("/recipes")]);
      setProducts(p.data);
      setInventory(i.data);
      setRecipes(r.data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Konfigurasi markup Ojol global. Disimpan pada tabel pengaturan `app_profile`
  // (bukan tabel transaksional POS) dan bisa diedit langsung dari halaman ini.
  useEffect(() => {
    api.get("/settings/ojol-markup").then((r) => setOjolMarkup(r.data.markup_percent)).catch(() => {});
  }, []);

  const startEditOjol = () => {
    setOjolDraft(String(ojolMarkup ?? 0));
    setEditingOjol(true);
  };
  const cancelEditOjol = () => {
    setEditingOjol(false);
    setOjolDraft("");
  };
  const saveOjolMarkup = async () => {
    const value = Number(ojolDraft);
    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      toast.error("Persentase markup harus berupa angka antara 0 dan 1000.");
      return;
    }
    setSavingOjol(true);
    try {
      const r = await api.put("/settings/ojol-markup", { markup_percent: value });
      setOjolMarkup(r.data.markup_percent);
      setEditingOjol(false);
      setOjolDraft("");
      toast.success("Markup Ojol global tersimpan");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingOjol(false);
    }
  };

  const recipeCount = (pid) => recipes.filter((r) => r.productId === pid).length;
  const invName = (id) => inventory.find((i) => i.id === id)?.name;

  const fields = useMemo(() => [
    { name: "name", label: "Nama produk", required: true },
    { name: "category", label: "Kategori", required: true, placeholder: "Minuman / Makanan / Snack" },
    { name: "price", label: "Harga jual (Rp)", type: "number", required: true },
    { name: "price_ojol", label: "Harga Ojol (Rp)", type: "number", hint: "Harga Ojol khusus per produk (menimpa markup global). Isi 0 untuk memakai harga normal + markup Ojol global khusus menu ber-varian." },
    { name: "type", label: "Tipe penjualan", type: "select", options: Object.entries(PRODUCT_TYPE_LABEL).map(([value, label]) => ({ value, label })) },
    { name: "image", label: "URL gambar", placeholder: "https://..." },
    { name: "inventoryId", label: "Barang jadi (stok langsung)", type: "select", allowNone: true, options: inventory.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` })), hint: "Opsional. Dipakai bila produk tidak punya resep — stok berkurang 1 per porsi." },
    { name: "hpp", label: "HPP manual (Rp)", type: "number", hint: "Diabaikan bila produk punya resep atau barang jadi — HPP dihitung otomatis." },
  ], [inventory]);

  const save = async (f) => {
    const body = { name: f.name, category: f.category, price: Number(f.price) || 0, price_ojol: Number(f.price_ojol) || 0, type: f.type || "both", image: f.image || "", inventoryId: f.inventoryId || null, hpp: Number(f.hpp) || 0 };
    if (dialog.id) await api.put(`/products/${dialog.id}`, body);
    else await api.post("/products", body);
    toast.success("Produk tersimpan");
    load();
  };

  return (
    <div>
      <VariantAdminDialog open={variantOpen} products={products} onClose={() => setVariantOpen(false)} />
      <PageHeader title="Produk & Resep" subtitle="HPP dihitung otomatis dari resep (qty bahan × biaya per unit).">
        <Button data-testid="add-variant-button" variant="outline" onClick={() => setVariantOpen(true)}><Layers className="mr-1 h-4 w-4" />Tambah Varian</Button>
        <Button data-testid="add-product-button" onClick={() => setDialog({ type: "both", hpp: 0, price_ojol: 0 })}><Plus className="mr-1 h-4 w-4" />Tambah Produk</Button>
      </PageHeader>
      {ojolMarkup != null && (
        <div data-testid="ojol-markup-info" className="mb-5 flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Percent className="h-5 w-5" /></div>
          <div className="flex-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Markup Ojol global untuk menu ber-varian:</span>
              {editingOjol ? (
                <span className="inline-flex items-center gap-1">
                  <Input data-testid="ojol-markup-input" type="number" min="0" max="1000" step="0.5" autoFocus
                    value={ojolDraft} onChange={(e) => setOjolDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveOjolMarkup(); if (e.key === "Escape") cancelEditOjol(); }}
                    className="h-8 w-24 font-mono" />
                  <span className="font-mono font-semibold text-primary">%</span>
                </span>
              ) : (
                <span data-testid="ojol-markup-value" className="font-mono font-semibold text-primary">{ojolMarkup}%</span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Berlaku otomatis di kanal Ojol tanpa input per item. Varian memakai harga reguler × (1 + markup). Isi <em>Harga Ojol</em> per produk bila ingin menimpa markup ini.</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editingOjol ? (
              <>
                <Button data-testid="ojol-markup-save" size="sm" disabled={savingOjol} onClick={saveOjolMarkup}>{savingOjol ? "Menyimpan…" : "Simpan"}</Button>
                <Button data-testid="ojol-markup-cancel" size="sm" variant="ghost" disabled={savingOjol} onClick={cancelEditOjol}>Batal</Button>
              </>
            ) : (
              <Button data-testid="ojol-markup-edit" size="sm" variant="outline" onClick={startEditOjol}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
            )}
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Produk</TableHead><TableHead>Kategori</TableHead><TableHead>Sumber stok</TableHead><TableHead className="text-right">Harga</TableHead><TableHead className="text-right">Harga Ojol</TableHead><TableHead className="text-right">HPP</TableHead><TableHead className="text-right">Margin</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const rc = recipeCount(p.id);
              const margin = p.price ? ((p.price - p.hpp) / p.price) * 100 : 0;
              return (
                <TableRow key={p.id} data-testid={`product-row-${p.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-secondary">
                        {p.image ? <img src={p.image} alt="" className="h-full w-full object-cover" /> : <UtensilsCrossed className="m-3 h-5 w-5 text-muted-foreground" />}
                      </div>
                      <div><p className="font-medium">{p.name}</p><p className="font-mono text-xs text-muted-foreground">{p.id} · {PRODUCT_TYPE_LABEL[p.type]}</p></div>
                    </div>
                  </TableCell>
                  <TableCell>{p.category}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{rc ? `Resep (${rc} bahan)` : p.inventoryId ? `Barang jadi: ${invName(p.inventoryId) || p.inventoryId}` : "Manual"}</TableCell>
                  <TableCell className="text-right font-mono">{rp(p.price)}</TableCell>
                  <TableCell data-testid={`product-price-ojol-${p.id}`} className="text-right font-mono">{p.price_ojol > 0 ? rp(p.price_ojol) : <span className="text-xs text-muted-foreground">= normal</span>}</TableCell>
                  <TableCell data-testid={`product-hpp-${p.id}`} className="text-right font-mono text-muted-foreground">{rp(p.hpp)}</TableCell>
                  <TableCell className={`text-right font-mono ${margin >= 50 ? "text-emerald-600" : "text-amber-600"}`}>{margin.toFixed(0)}%</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <button data-testid={`product-recipe-${p.id}`} onClick={() => setRecipeFor(p)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-primary hover:bg-primary/10"><ChefHat className="h-4 w-4" />Resep</button>
                      <button data-testid={`product-edit-${p.id}`} onClick={() => setDialog(p)} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                      <ConfirmDelete testid={`product-delete-${p.id}`} title={`Hapus ${p.name}?`} description="Resep produk ini juga akan dihapus. Riwayat transaksi tetap tersimpan."
                        onConfirm={async () => { await api.delete(`/products/${p.id}`); load(); }} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} title={dialog?.id ? "Edit Produk" : "Tambah Produk"} fields={fields} initial={dialog} onSubmit={save} testid="product-form" />
      <RecipeDialog product={recipeFor} inventory={inventory} onClose={() => setRecipeFor(null)} onSaved={load} />
    </div>
  );
}
