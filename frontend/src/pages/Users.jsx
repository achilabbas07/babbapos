import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, ROLE_LABEL } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { FormDialog } from "@/components/FormDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fields = (editing) => [
  { name: "name", label: "Nama", required: true },
  { name: "role", label: "Peran", type: "select", options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })) },
  { name: "pin", label: editing ? "PIN baru (kosongkan bila tidak diubah)" : "PIN (4-6 digit)", type: "password", inputMode: "numeric", maxLength: 6, required: !editing },
];

export default function Users() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [dialog, setDialog] = useState(null);
  const load = useCallback(() => api.get("/users").then((r) => setList(r.data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (f) => {
    const body = { name: f.name, role: f.role || "kasir", pin: f.pin || null };
    if (dialog.id) await api.put(`/users/${dialog.id}`, body);
    else await api.post("/users", body);
    toast.success("Pengguna tersimpan");
    load();
  };

  return (
    <div>
      <PageHeader title="Pengguna & PIN" subtitle="Admin: akses penuh · Kasir: kasir, meja, transaksi, pelanggan · Waiter: meja, open bill, pelanggan.">
        <Button data-testid="add-user-button" onClick={() => setDialog({ role: "kasir" })}><Plus className="mr-1 h-4 w-4" />Tambah Pengguna</Button>
      </PageHeader>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Nama</TableHead><TableHead>Peran</TableHead><TableHead>PIN</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {list.map((u) => (
              <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                <TableCell className="font-mono text-xs text-muted-foreground">{u.id}</TableCell>
                <TableCell className="font-medium">{u.name}{u.id === user.id && <span className="ml-2 text-xs text-primary">(Anda)</span>}</TableCell>
                <TableCell><span className="rounded-full bg-secondary px-2.5 py-1 text-xs">{ROLE_LABEL[u.role]}</span></TableCell>
                <TableCell className="font-mono text-muted-foreground">••••</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <button data-testid={`user-edit-${u.id}`} onClick={() => setDialog({ id: u.id, name: u.name, role: u.role })} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                    {u.id !== user.id && <ConfirmDelete testid={`user-delete-${u.id}`} title={`Hapus ${u.name}?`} onConfirm={async () => { await api.delete(`/users/${u.id}`); load(); }} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} title={dialog?.id ? "Edit Pengguna" : "Tambah Pengguna"} fields={fields(!!dialog?.id)} initial={dialog} onSubmit={save} testid="user-form" />
    </div>
  );
}
