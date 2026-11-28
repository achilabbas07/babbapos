import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useProfile } from "@/context/ProfileContext";
import { PageHeader } from "@/components/PageHeader";
import { PrintHeader, PrintFooter } from "@/components/ReceiptDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const FIELDS = [
  { name: "app_name", label: "Nama Usaha", required: true, maxLength: 120 },
  { name: "logo_url", label: "URL Logo", type: "url", placeholder: "https://...", hint: "Kosongkan untuk memakai ikon standar.", maxLength: 1000 },
  { name: "address", label: "Alamat", textarea: true, maxLength: 500 },
  { name: "phone", label: "No. Telepon", type: "tel", placeholder: "08xx-xxxx-xxxx", maxLength: 50 },
  { name: "additional_info", label: "Keterangan Tambahan", textarea: true, hint: "Tampil di bagian bawah struk, misal info Wi-Fi atau jam buka.", maxLength: 1000 },
];

const ProfileField = ({ f, value, onChange }) => {
  const props = { id: f.name, "data-testid": `profile-${f.name}-input`, value: value || "", maxLength: f.maxLength, onChange: (e) => onChange(e.target.value) };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={f.name}>{f.label}</Label>
      {f.textarea ? <Textarea rows={3} {...props} /> : (
        <Input type={f.type || "text"} required={f.required} placeholder={f.placeholder} {...props} />
      )}
      {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
    </div>
  );
};

export default function Profile() {
  const { profile, setProfile } = useProfile();
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm(profile);
  }, [profile]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.put("/app-profile", form);
      setProfile(data);
      toast.success("Profil usaha tersimpan");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Profil Usaha" subtitle="Nama dan logo tampil di header aplikasi; alamat, telepon & keterangan tampil di struk." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={save} data-testid="profile-form" className="grid gap-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          {FIELDS.map((f) => (
            <ProfileField
              key={f.name}
              f={f}
              value={form[f.name]}
              onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))}
            />
          ))}
          <div className="flex items-center gap-2">
            <Checkbox
              id="cetakOtomatis"
              data-testid="profile-cetakOtomatis-checkbox"
              checked={!!form.cetakOtomatis}
              onCheckedChange={(checked) => setForm((s) => ({ ...s, cetakOtomatis: checked === true }))}
            />
            <Label htmlFor="cetakOtomatis">Cetak Struk Otomatis (Kasir)</Label>
          </div>
          <div>
            <Button data-testid="profile-save-button" type="submit" disabled={saving}><Save className="mr-1 h-4 w-4" />{saving ? "Menyimpan..." : "Simpan"}</Button>
          </div>
        </form>
        <div data-testid="profile-preview" className="h-fit rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-24">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Pratinjau Struk</p>
          <div className="space-y-3 rounded-xl border border-dashed border-border p-4 text-sm">
            <PrintHeader profile={form} testid="profile-preview-header" />
            <div className="border-y border-dashed border-border py-3 text-center text-xs text-muted-foreground">· · · item pesanan · · ·</div>
            <PrintFooter profile={form} paid />
          </div>
        </div>
      </div>
      <div data-testid="profile-app-info" className="mt-6 flex justify-end">
        <div className="text-right text-xs leading-relaxed text-muted-foreground">
          <p data-testid="profile-app-version" className="font-semibold text-foreground">v1.1.1 / Build 11</p>
          <p data-testid="profile-app-copyright">Copyright @warkopbabba.mks</p>
          <p data-testid="profile-app-updated">Update terakhir: 28 Nov 2026</p>
        </div>
      </div>
    </div>
  );
}
