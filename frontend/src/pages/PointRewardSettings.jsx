import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/supabaseClient";

// Halaman pengaturan Point Reward: CRUD sederhana ke tabel Supabase
// `point_settings` (kolom `required_points` & `reward_value`). Tidak menyentuh
// logika transaksional/pembayaran/cetak struk -- murni master data konversi poin.
const EMPTY_SETTING = {
  required_points: "",
  reward_value: "",
};

const numberText = (value) => (value == null || value === "" ? "" : String(Number(value)));

const formatRupiah = (value) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const formatUpdatedAt = (value) => (value ? new Date(value).toLocaleString("id-ID") : "-");

function PointSettingForm({ setting, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_SETTING);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(setting ? {
      required_points: numberText(setting.required_points),
      reward_value: numberText(setting.reward_value),
    } : EMPTY_SETTING);
    setError("");
  }, [setting]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    const requiredPoints = Number.parseInt(form.required_points, 10);
    const rewardValue = Number.parseFloat(form.reward_value);

    if (!Number.isFinite(requiredPoints) || requiredPoints <= 0) {
      setError("Poin yang dibutuhkan harus berupa angka lebih dari 0.");
      return;
    }
    if (!Number.isFinite(rewardValue) || rewardValue < 0) {
      setError("Nilai reward (Rp) harus berupa angka yang valid.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        required_points: requiredPoints,
        reward_value: rewardValue,
      });
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Pengaturan point reward gagal disimpan.");
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
        aria-labelledby="point-setting-form-title"
        data-testid="point-setting-form"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl sm:p-6"
      >
        <div className="mb-5">
          <h2 id="point-setting-form-title" className="text-xl font-semibold">
            {setting ? "Edit Pengaturan Point Reward" : "Tambah Pengaturan Point Reward"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tentukan berapa poin yang dibutuhkan dan nilai rupiah diskon reward-nya.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Poin dibutuhkan
              <input
                data-testid="point-setting-required-input"
                className={inputClass}
                name="required_points"
                type="number"
                min="1"
                step="1"
                value={form.required_points}
                onChange={updateField}
                required
              />
            </label>
            <label className={labelClass}>
              Nilai reward (Rp)
              <input
                data-testid="point-setting-reward-input"
                className={inputClass}
                name="reward_value"
                type="number"
                min="0"
                step="any"
                value={form.reward_value}
                onChange={updateField}
                required
              />
            </label>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
            <Button type="submit" data-testid="point-setting-save-button" disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function PointRewardSettings() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedSetting, setSelectedSetting] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!supabase) {
      setLoadError("Supabase belum dikonfigurasi.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");
    const { data, error } = await supabase
      .from("point_settings")
      .select("*")
      .order("id", { ascending: true });
    if (error) {
      setLoadError(error.message);
    } else {
      setSettings(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const openCreateForm = () => {
    setSelectedSetting(null);
    setFormOpen(true);
  };

  const openEditForm = (setting) => {
    setSelectedSetting(setting);
    setFormOpen(true);
  };

  const saveSetting = async (values) => {
    if (!supabase) throw new Error("Supabase belum dikonfigurasi.");

    const payload = { ...values, updated_at: new Date().toISOString() };
    const { error } = selectedSetting
      ? await supabase.from("point_settings").update(payload).eq("id", selectedSetting.id)
      : await supabase.from("point_settings").insert(payload);
    if (error) throw error;

    toast.success(selectedSetting ? "Pengaturan point reward diperbarui." : "Pengaturan point reward ditambahkan.");
    await loadSettings();
  };

  const deleteSetting = async (setting) => {
    if (!window.confirm(`Hapus pengaturan ${setting.required_points} poin → ${formatRupiah(setting.reward_value)}?`)) return;
    if (!supabase) {
      toast.error("Supabase belum dikonfigurasi.");
      return;
    }

    const { error } = await supabase.from("point_settings").delete().eq("id", setting.id);
    if (error) {
      toast.error(`Pengaturan point reward gagal dihapus: ${error.message}`);
      return;
    }

    toast.success("Pengaturan point reward dihapus.");
    await loadSettings();
  };

  return (
    <div>
      <PageHeader title="Pengaturan Point Reward" subtitle="Kelola konversi poin pelanggan menjadi nilai diskon reward.">
        <Button data-testid="point-setting-add-button" onClick={openCreateForm}>
          <Plus className="mr-1 h-4 w-4" />Tambah Pengaturan
        </Button>
      </PageHeader>

      {loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <span className="text-destructive">Gagal memuat pengaturan point reward: {loadError}</span>
          <Button variant="outline" size="sm" onClick={loadSettings}>Coba lagi</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table data-testid="point-setting-table" className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Poin dibutuhkan</th>
              <th className="px-4 py-3 text-right font-semibold">Nilai reward (Rp)</th>
              <th className="px-4 py-3 font-semibold">Diperbarui</th>
              <th className="px-4 py-3 text-right font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr><td className="px-4 py-10 text-center text-muted-foreground" colSpan={4}>Memuat pengaturan point reward...</td></tr>
            ) : settings.length === 0 ? (
              <tr>
                <td data-testid="point-setting-empty" className="px-4 py-10 text-center text-muted-foreground" colSpan={4}>
                  Belum ada pengaturan point reward.
                </td>
              </tr>
            ) : settings.map((setting) => (
              <tr key={setting.id} data-testid={`point-setting-row-${setting.id}`} className="hover:bg-secondary/20">
                <td className="px-4 py-3 font-mono font-semibold">
                  {new Intl.NumberFormat("id-ID").format(Number(setting.required_points) || 0)}
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatRupiah(setting.reward_value)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatUpdatedAt(setting.updated_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label={`Edit pengaturan ${setting.required_points} poin`}
                      data-testid={`point-setting-edit-${setting.id}`}
                      onClick={() => openEditForm(setting)}
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Hapus pengaturan ${setting.required_points} poin`}
                      data-testid={`point-setting-delete-${setting.id}`}
                      onClick={() => deleteSetting(setting)}
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
        <PointSettingForm
          key={selectedSetting?.id ?? "new-point-setting"}
          setting={selectedSetting}
          onClose={() => setFormOpen(false)}
          onSave={saveSetting}
        />
      )}
    </div>
  );
}
