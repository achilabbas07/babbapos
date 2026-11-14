import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { api, errMsg } from "@/lib/api";
import {
  METRIC_OPTIONS,
  METRIC_REVENUE,
  needsAmount,
  needsProducts,
  PERIOD_OPTIONS,
  PERIOD_SHIFT,
  TARGET_TYPE_ITEM,
  TARGET_TYPE_OPTIONS,
  TARGET_TYPE_TIME,
} from "@/lib/targetTypes";

const EMPTY_FORM = {
  name: "",
  targetType: TARGET_TYPE_ITEM,
  productIds: [],
  targetQty: "",
  targetAmount: "",
  periodType: PERIOD_SHIFT,
  metric: METRIC_REVENUE,
  startTime: "",
  endTime: "",
  waiterId: null,
};

const formFromTarget = (target) => ({
  name: target.name || "",
  targetType: target.targetType || TARGET_TYPE_ITEM,
  productIds: target.productIds || [],
  targetQty: target.targetQty ?? "",
  targetAmount: target.targetAmount ?? "",
  periodType: target.periodType || PERIOD_SHIFT,
  metric: target.metric || METRIC_REVENUE,
  startTime: target.startTime || "",
  endTime: target.endTime || "",
  waiterId: target.waiterId || null,
});

export const TargetDialog = ({ target, products, waiters, onClose, onSaved }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setForm(target.id ? formFromTarget(target) : EMPTY_FORM);
      setQ("");
    }
  }, [target]);

  const toggle = (id) => setForm((f) => ({ ...f, productIds: f.productIds.includes(id) ? f.productIds.filter((x) => x !== id) : [...f.productIds, id] }));
  const shown = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  const wantsProducts = needsProducts(form);
  const wantsAmount = needsAmount(form);
  const isTime = form.targetType === TARGET_TYPE_TIME;

  const valid =
    (!wantsProducts || (form.productIds.length > 0 && Number(form.targetQty) > 0)) &&
    (!wantsAmount || Number(form.targetAmount) > 0);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name: form.name,
        targetType: form.targetType,
        productIds: wantsProducts ? form.productIds : [],
        targetQty: wantsProducts ? Number(form.targetQty) || 0 : null,
        targetAmount: wantsAmount ? Number(form.targetAmount) || 0 : null,
        periodType: form.periodType,
        metric: isTime ? form.metric : null,
        startTime: isTime && form.startTime ? form.startTime : null,
        endTime: isTime && form.endTime ? form.endTime : null,
        waiterId: form.waiterId,
      };
      if (target.id) await api.put(`/targets/${target.id}`, body);
      else await api.post("/targets", body);
      toast.success("Target tersimpan");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="target-form-dialog" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{target?.id ? "Edit Target" : "Tambah Target"}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Nama target (opsional)</Label>
            <Input data-testid="target-form-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Paket Kopi Signature" />
          </div>
          <div className="grid gap-1.5">
            <Label>Jenis target</Label>
            <Select value={form.targetType} onValueChange={(v) => setForm({ ...form, targetType: v })}>
              <SelectTrigger data-testid="target-form-targetType"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TARGET_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isTime && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Dihitung dari</Label>
                <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
                  <SelectTrigger data-testid="target-form-metric"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METRIC_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Periode</Label>
                <Select value={form.periodType} onValueChange={(v) => setForm({ ...form, periodType: v })}>
                  <SelectTrigger data-testid="target-form-periodType"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERIOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {wantsProducts && (
          <div className="grid gap-1.5">
            <Label>Item / Produk <span className="text-xs font-normal text-muted-foreground">({form.productIds.length} dipilih · jumlah semua item digabung)</span></Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid="target-form-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk" className="pl-9" />
            </div>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {shown.map((p) => (
                <label key={p.id} data-testid={`target-form-product-${p.id}`} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-secondary">
                  <Checkbox checked={form.productIds.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
                  <span className="flex-1 text-sm">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.category}</span>
                </label>
              ))}
            </div>
          </div>
          )}
          {isTime && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Jam mulai (opsional)</Label>
                <Input data-testid="target-form-startTime" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Jam selesai (opsional)</Label>
                <Input data-testid="target-form-endTime" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {wantsProducts && (
            <div className="grid gap-1.5">
              <Label>{isTime ? "Target jumlah item" : "Target jumlah item / shift"}</Label>
              <Input data-testid="target-form-targetQty" type="number" value={form.targetQty} onChange={(e) => setForm({ ...form, targetQty: e.target.value })} />
            </div>
            )}
            {wantsAmount && (
            <div className="grid gap-1.5">
              <Label>Target omzet (Rp)</Label>
              <Input data-testid="target-form-targetAmount" type="number" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} />
            </div>
            )}
            <div className="grid gap-1.5">
              <Label>Berlaku untuk</Label>
              <Select value={form.waiterId || "none"} onValueChange={(v) => setForm({ ...form, waiterId: v === "none" ? null : v })}>
                <SelectTrigger data-testid="target-form-waiterId"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Semua pelayan</SelectItem>
                  {waiters.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button data-testid="target-form-submit" onClick={save} disabled={saving || !valid}>{saving ? "Menyimpan..." : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
