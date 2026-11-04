import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/supabaseClient";

const EMPTY_PROMO = {
  code: "",
  description: "",
  discount_type: "percent",
  discount_value: "",
  max_discount: "",
  min_minimum_order: "0",
  expired_at: "",
  is_active: true,
};

const formatDateTimeLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
};

const formatDiscount = (promo) => {
  const value = Number(promo.discount_value);
  if (promo.discount_type === "percent") return `${value}%`;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 2,
  }).format(value);
};

function PromoForm({ promo, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_PROMO);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(promo ? {
      code: promo.code ?? "",
      description: promo.description ?? "",
      discount_type: promo.discount_type ?? "percent",
      discount_value: promo.discount_value == null ? "" : String(promo.discount_value),
      max_discount: promo.max_discount == null ? "" : String(promo.max_discount),
      min_minimum_order: promo.min_minimum_order == null ? "0" : String(promo.min_minimum_order),
      expired_at: formatDateTimeLocal(promo.expired_at),
      is_active: promo.is_active ?? true,
    } : EMPTY_PROMO);
    setError("");
  }, [promo]);

  const updateField = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    const discountValue = Number.parseFloat(form.discount_value);
    const minimumOrder = form.min_minimum_order.trim() === ""
      ? 0
      : Number.parseFloat(form.min_minimum_order);
    const maxDiscount = form.max_discount.trim() === ""
      ? null
      : Number.parseFloat(form.max_discount);

    if (!Number.isFinite(discountValue) || !Number.isFinite(minimumOrder)
      || (maxDiscount !== null && !Number.isFinite(maxDiscount))) {
      setError("Pastikan nilai diskon, batas diskon, dan minimum pesanan valid.");
      return;
    }

    let expiredAt = null;
    if (form.expired_at) {
      const expiration = new Date(form.expired_at);
      if (Number.isNaN(expiration.getTime())) {
        setError("Tanggal kedaluwarsa tidak valid.");
        return;
      }
      expiredAt = expiration.toISOString();
    }

    setSaving(true);
    try {
      await onSave({
        code: form.code.trim(),
        description: form.description.trim(),
        discount_type: form.discount_type,
        discount_value: discountValue,
        max_discount: maxDiscount,
        min_minimum_order: minimumOrder,
        expired_at: expiredAt,
        is_active: form.is_active,
      });
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Promo gagal disimpan.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass = "mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground";
  const labelClass = "block text-sm font-medium";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-form-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl sm:p-6"
      >
        <div className="mb-5">
          <h2 id="promo-form-title" className="text-xl font-semibold">
            {promo ? "Edit Promo" : "Tambah Promo"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Lengkapi detail promo di bawah ini.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Kode promo
              <input className={inputClass} name="code" value={form.code} onChange={updateField} required maxLength={100} />
            </label>
            <label className={labelClass}>
              Tipe diskon
              <select className={inputClass} name="discount_type" value={form.discount_type} onChange={updateField}>
                <option value="percent">Persentase</option>
                <option value="fixed">Nominal tetap</option>
              </select>
            </label>
          </div>

          <label className={labelClass}>
            Deskripsi
            <textarea
              className="mt-1 min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              name="description"
              value={form.description}
              onChange={updateField}
              rows={3}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className={labelClass}>
              Nilai diskon
              <input className={inputClass} name="discount_value" type="number" min="0" step="any" value={form.discount_value} onChange={updateField} required />
            </label>
            <label className={labelClass}>
              Maksimum diskon (opsional)
              <input className={inputClass} name="max_discount" type="number" min="0" step="any" value={form.max_discount} onChange={updateField} />
            </label>
            <label className={labelClass}>
              Minimum pesanan
              <input className={inputClass} name="min_minimum_order" type="number" min="0" step="any" value={form.min_minimum_order} onChange={updateField} />
            </label>
          </div>

          <label className={labelClass}>
            Tanggal kedaluwarsa (opsional)
            <input className={inputClass} name="expired_at" type="datetime-local" value={form.expired_at} onChange={updateField} />
          </label>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              className="h-4 w-4 rounded border-border accent-primary"
              name="is_active"
              type="checkbox"
              checked={form.is_active}
              onChange={updateField}
            />
            Promo aktif
          </label>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
            <Button type="submit" disabled={saving}>{saving ? "Menyimpan..." : "Simpan Promo"}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function PromoManagement() {
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedPromo, setSelectedPromo] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  const loadPromos = useCallback(async () => {
    if (!supabase) {
      setLoadError("Supabase belum dikonfigurasi.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");
    const { data, error } = await supabase.from("promos").select("*").order("id", { ascending: false });
    if (error) {
      setLoadError(error.message);
    } else {
      setPromos(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPromos();
  }, [loadPromos]);

  const openCreateForm = () => {
    setSelectedPromo(null);
    setFormOpen(true);
  };

  const openEditForm = (promo) => {
    setSelectedPromo(promo);
    setFormOpen(true);
  };

  const savePromo = async (values) => {
    if (!supabase) throw new Error("Supabase belum dikonfigurasi.");

    const { error } = selectedPromo
      ? await supabase.from("promos").update(values).eq("id", selectedPromo.id)
      : await supabase.from("promos").insert(values);
    if (error) throw error;

    toast.success(selectedPromo ? "Promo berhasil diperbarui." : "Promo berhasil ditambahkan.");
    await loadPromos();
  };

  const deletePromo = async (promo) => {
    if (!window.confirm(`Hapus promo "${promo.code}"?`)) return;
    if (!supabase) {
      toast.error("Supabase belum dikonfigurasi.");
      return;
    }

    const { error } = await supabase.from("promos").delete().eq("id", promo.id);
    if (error) {
      toast.error(`Promo gagal dihapus: ${error.message}`);
      return;
    }

    toast.success("Promo berhasil dihapus.");
    await loadPromos();
  };

  return (
    <div>
      <PageHeader title="Manajemen Promo" subtitle="Kelola kode promo, diskon, masa berlaku, dan status promo.">
        <Button onClick={openCreateForm}><Plus className="mr-1 h-4 w-4" />Tambah Promo</Button>
      </PageHeader>

      {loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <span className="text-destructive">Gagal memuat promo: {loadError}</span>
          <Button variant="outline" size="sm" onClick={loadPromos}>Coba lagi</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[850px] text-left text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Kode</th>
              <th className="px-4 py-3 font-semibold">Deskripsi</th>
              <th className="px-4 py-3 text-right font-semibold">Diskon</th>
              <th className="px-4 py-3 text-right font-semibold">Maks. diskon</th>
              <th className="px-4 py-3 text-right font-semibold">Min. pesanan</th>
              <th className="px-4 py-3 font-semibold">Kedaluwarsa</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td className="px-4 py-10 text-center text-muted-foreground" colSpan={8}>Memuat data promo...</td></tr>
            ) : promos.length === 0 ? (
              <tr><td className="px-4 py-10 text-center text-muted-foreground" colSpan={8}>Belum ada data promo.</td></tr>
            ) : promos.map((promo) => (
              <tr key={promo.id} className="hover:bg-secondary/20">
                <td className="px-4 py-3 font-mono font-semibold">{promo.code}</td>
                <td className="max-w-56 truncate px-4 py-3 text-muted-foreground">{promo.description || "-"}</td>
                <td className="px-4 py-3 text-right font-mono">{formatDiscount(promo)}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {promo.max_discount == null ? "-" : new Intl.NumberFormat("id-ID").format(Number(promo.max_discount))}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {new Intl.NumberFormat("id-ID").format(Number(promo.min_minimum_order ?? 0))}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {promo.expired_at ? new Date(promo.expired_at).toLocaleString("id-ID") : "Tidak ada"}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${promo.is_active ? "bg-emerald-100 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>
                    {promo.is_active ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label={`Edit promo ${promo.code}`}
                      onClick={() => openEditForm(promo)}
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Hapus promo ${promo.code}`}
                      onClick={() => deletePromo(promo)}
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <PromoForm
          key={selectedPromo?.id ?? "new-promo"}
          promo={selectedPromo}
          onClose={() => setFormOpen(false)}
          onSave={savePromo}
        />
      )}
    </div>
  );
}
