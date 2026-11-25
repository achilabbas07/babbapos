import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Search, Star, History } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, rp } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache } from "@/lib/offlineRead";
import { PageHeader } from "@/components/PageHeader";
import CachedDataNotice from "@/components/CachedDataNotice";
import { TopCustomers } from "@/components/TopCustomers";
import CustomerPurchaseHistory from "@/components/CustomerPurchaseHistory";
import { FormDialog } from "@/components/FormDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FIELDS = [
  { name: "name", label: "Nama", required: true },
  { name: "wa", label: "No. WhatsApp", inputMode: "tel", placeholder: "08xxxxxxxxxx" },
  { name: "email", label: "Email", type: "email" },
];

export default function Customers() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState(null);
  const [selected, setSelected] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);
  // Fallback cache lokal: daftar pelanggan terakhir tetap tampil saat offline.
  const load = useCallback(() => loadWithCache(
    CACHE_KEYS.CUSTOMERS,
    async () => (await api.get("/customers")).data,
  ).then((result) => {
    if (result.canceled) return;
    if (result.data !== undefined) setList(Array.isArray(result.data) ? result.data : []);
    setFromCache(result.fromCache);
    setCachedAt(result.updatedAt);
    if (result.error) toast.error(errMsg(result.error));
  }), []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (f) => {
    const body = { name: f.name, wa: f.wa || "", email: f.email || "" };
    if (dialog.id) await api.put(`/customers/${dialog.id}`, body);
    else await api.post("/customers", body);
    toast.success("Pelanggan tersimpan");
    load();
  };
  const shown = list.filter((c) => `${c.name} ${c.wa} ${c.email}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader title="Pelanggan" subtitle="Poin loyalitas: +1 poin per Rp 10.000 belanja.">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input data-testid="customer-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari pelanggan" className="h-10 rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary" />
        </div>
        <Button data-testid="add-customer-button" onClick={() => setDialog({})}><Plus className="mr-1 h-4 w-4" />Tambah</Button>
      </PageHeader>
      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />
      <div className="grid items-start gap-6 lg:grid-cols-[7fr_3fr]">
      <div className="min-w-0 overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Kontak</TableHead><TableHead className="text-right">Poin</TableHead><TableHead className="text-right">Kunjungan</TableHead><TableHead className="text-right">Total belanja</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {shown.map((c) => (
              <TableRow key={c.id} data-testid={`customer-row-${c.id}`}>
                <TableCell><p className="font-medium">{c.name}</p><p className="font-mono text-xs text-muted-foreground">{c.id}</p></TableCell>
                <TableCell className="text-sm text-muted-foreground"><p>{c.wa || "-"}</p><p>{c.email}</p></TableCell>
                <TableCell data-testid={`customer-points-${c.id}`} className="text-right font-mono"><span className="inline-flex items-center gap-1 text-primary"><Star className="h-3.5 w-3.5" />{c.points}</span></TableCell>
                <TableCell data-testid={`customer-visits-${c.id}`} className="text-right font-mono">{c.visits}</TableCell>
                <TableCell data-testid={`customer-spent-${c.id}`} className="text-right font-mono">{rp(c.total_spent)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <button data-testid={`customer-history-${c.id}`} onClick={() => setSelected(c)} title="Riwayat transaksi" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><History className="h-4 w-4" /></button>
                    <button data-testid={`customer-edit-${c.id}`} onClick={() => setDialog(c)} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                    {user.role === "admin" && <ConfirmDelete testid={`customer-delete-${c.id}`} title={`Hapus ${c.name}?`} description="Riwayat transaksi tetap tersimpan." onConfirm={async () => { await api.delete(`/customers/${c.id}`); load(); }} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        {selected ? (
          <CustomerPurchaseHistory customer={selected} onClose={() => setSelected(null)} />
        ) : (
          <div data-testid="customer-history-hint" className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
            Pilih <History className="inline h-4 w-4" /> pada baris pelanggan untuk melihat riwayat transaksinya.
          </div>
        )}
        <TopCustomers refreshKey={list} />
      </div>
      </div>
      <FormDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} title={dialog?.id ? "Edit Pelanggan" : "Tambah Pelanggan"} fields={FIELDS} initial={dialog} onSubmit={save} testid="customer-form" />
    </div>
  );
}
