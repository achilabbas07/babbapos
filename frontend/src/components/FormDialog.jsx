import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errMsg } from "@/lib/api";

const Field = ({ f, value, onChange, testid }) => {
  if (f.type === "select") {
    const empty = value === null || value === undefined || value === "";
    return (
      <Select value={empty ? (f.allowNone ? "none" : "") : String(value)} onValueChange={(v) => onChange(v === "none" ? null : v)}>
        <SelectTrigger data-testid={testid}><SelectValue placeholder={f.placeholder || "Pilih"} /></SelectTrigger>
        <SelectContent>
          {f.allowNone && <SelectItem value="none">{f.noneLabel || "— Tidak ada —"}</SelectItem>}
          {f.options.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (f.type === "textarea") return <Textarea data-testid={testid} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  const isNum = f.type === "number";
  return (
    <Input
      data-testid={testid}
      type={f.type || "text"}
      inputMode={f.inputMode}
      step={isNum ? "any" : undefined}
      value={value ?? ""}
      required={f.required}
      placeholder={f.placeholder}
      disabled={f.disabled}
      maxLength={f.maxLength}
      onChange={(e) => onChange(isNum ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
    />
  );
};

export const FormDialog = ({ open, onOpenChange, title, description, fields, initial, onSubmit, testid }) => {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial || {});
    }
  }, [open, initial]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit(form);
      onOpenChange(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={`${testid}-dialog`} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : "sr-only"}>{description || title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {fields.map((f) => (
            <div key={f.name} className="grid gap-1.5">
              <Label>{f.label}</Label>
              <Field f={f} value={form[f.name]} testid={`${testid}-${f.name}`} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />
              {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
          <DialogFooter>
            <Button data-testid={`${testid}-submit`} type="submit" disabled={saving}>{saving ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
