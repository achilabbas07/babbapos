import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { api, errMsg, fmtDate, rp, todayStr, dateToIso } from "@/lib/api";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import { FormDialog } from "@/components/FormDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import DateRangeFilter from "@/components/DateRangeFilter";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fieldsFor = (cats) => [
  { name: "date", label: "Tanggal", type: "date", required: true },
  { name: "category_id", label: "Kategori Pengeluaran", type: "select", placeholder: "Pilih kategori", options: cats.map((c) => ({ value: c.id, label: c.name })) },
  { name: "description", label: "Keterangan", type: "textarea" },
  { name: "amount", label: "Jumlah (Rp)", type: "number", required: true },
];

export default function Expenses() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState([]);
  const [range, setRange] = useState({ from: "", to: "" });
  const load = useCallback(() => {
    const params = {};
    if (range.from) params.start = range.from;
    if (range.to) params.end = range.to;
    return api.get("/expenses", { params }).then((r) => setList(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [range]);
  const loadCats = useCallback(() => api.get("/expense-categories").then((r) => setCats(r.data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => {
    load();
    loadCats();
  }, [load, loadCats]);

  const save = async (f) => {
    if (!f.category_id) throw new Error("Pilih kategori pengeluaran terlebih dahulu");
    await api.post("/expenses", { date: dateToIso(f.date), category_id: Number(f.category_id), description: f.description || "", amount: Number(f.amount) || 0 });
    toast.success("Pengeluaran tercatat");
    load();
  };
  const total = list.reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <PageHeader title="Pengeluaran" subtitle="Beban operasional yang mengurangi laba bersih.">
        <Button data-testid="add-expense-button" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Catat Pengeluaran</Button>
      </PageHeader>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Total tercatat" value={rp(total)} testid="expenses-total" />
        <StatCard label="Jumlah catatan" value={list.length} />
      </div>
      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} testidPrefix="expenses-date-filter" />
      {list.length === 0 ? <Empty testid="expenses-empty" text="Belum ada pengeluaran." /> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Kategori</TableHead><TableHead>Keterangan</TableHead><TableHead>Oleh</TableHead><TableHead className="text-right">Jumlah</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {list.map((e) => (
                <TableRow key={e.id} data-testid={`expense-row-${e.id}`}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(e.date)}</TableCell>
                  <TableCell><span className="rounded-full bg-secondary px-2.5 py-1 text-xs">{e.category}</span></TableCell>
                  <TableCell>{e.description || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.userName}</TableCell>
                  <TableCell className="text-right font-mono">{rp(e.amount)}</TableCell>
                  <TableCell className="text-right"><ConfirmDelete testid={`expense-delete-${e.id}`} onConfirm={async () => { await api.delete(`/expenses/${e.id}`); load(); }} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <FormDialog open={open} onOpenChange={setOpen} title="Catat Pengeluaran" fields={fieldsFor(cats)} initial={open ? { date: todayStr(), category_id: null } : null} onSubmit={save} testid="expense-form" />
    </div>
  );
}
