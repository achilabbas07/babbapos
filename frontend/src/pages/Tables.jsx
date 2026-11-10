import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Move, Save, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { ReceiptDialog } from "@/components/ReceiptDialog";
import { FloorCanvas, STATUS, autoLayout } from "@/components/tables/FloorCanvas";
import { TableDetailDialog } from "@/components/tables/TableDetailDialog";
import { TABLES_FALLBACK_POLL_MS, createTablesReloadScheduler, subscribeToTablesRealtime } from "@/lib/realtimeTables";

const FIELDS = [
  { name: "name", label: "Nama", required: true, placeholder: "A-01" },
  { name: "area", label: "Area", required: true, placeholder: "Indoor / Outdoor / VIP Room" },
  { name: "kind", label: "Jenis", type: "select", options: [{ value: "table", label: "Meja" }, { value: "fixture", label: "Objek denah (Kasir, Bar, dll)" }] },
];

export default function Tables() {
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [tables, setTables] = useState([]);
  const [area, setArea] = useState(null);
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState({});
  const [form, setForm] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const load = useCallback((signal) => api.get("/tables", { signal }).then((r) => setTables(r.data)).catch((e) => {
    if (e.name !== "CanceledError") toast.error(errMsg(e));
  }), []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Sinkronisasi real-time denah meja: perangkat lain langsung melihat perubahan
  // status meja (occupied/available/paid/reserved) tanpa refresh manual.
  // Bila realtime Supabase tidak tersedia, fallback ke pemuatan berkala ringan.
  useEffect(() => {
    const controller = new AbortController();
    const scheduler = createTablesReloadScheduler(controller, load);
    let fallbackId = null;
    const unsubscribe = subscribeToTablesRealtime(() => scheduler.schedule(), {
      onStatus: (status) => {
        if (status === "subscribed" || fallbackId) return;
        fallbackId = setInterval(() => scheduler.schedule(), TABLES_FALLBACK_POLL_MS);
      },
    });
    return () => {
      unsubscribe();
      scheduler.cancel();
      if (fallbackId) clearInterval(fallbackId);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!editing) setPositions(autoLayout(tables));
  }, [tables, editing]);

  const areas = [...new Set(tables.map((t) => t.area))];
  const current = areas.includes(area) ? area : areas[0];
  const shown = tables.filter((t) => t.area === current);
  const realTables = tables.filter((t) => t.kind !== "fixture");
  const detail = tables.find((t) => t.id === detailId) || null;

  const saveLayout = async () => {
    try {
      await api.put("/tables/layout", Object.entries(positions).map(([id, p]) => ({ id, ...p })));
      toast.success("Layout meja tersimpan");
      setEditing(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveForm = async (f) => {
    const body = { name: f.name, area: f.area, kind: f.kind || "table" };
    if (form.id) await api.put(`/tables/${form.id}`, body);
    else await api.post("/tables", body);
    toast.success("Data meja tersimpan");
    load();
  };

  const onTileClick = useCallback((t) => {
    if (editing) return setForm(t);
    if (t.kind !== "fixture") setDetailId(t.id);
  }, [editing]);

  const deleteTable = useCallback(async (table) => {
    await api.delete(`/tables/${table.id}`);
    toast.success(`${table.name} dihapus`);
    load();
  }, [load]);

  return (
    <div>
      <PageHeader title="Denah Meja" subtitle={editing ? "Mode atur layout: geser meja ke posisi baru, ketuk meja untuk ubah nama/area." : "Ketuk meja untuk melihat pesanan & opsi."}>
        {isAdmin && !editing && (
          <>
            <Button data-testid="edit-layout-button" variant="outline" onClick={() => setEditing(true)}><Move className="mr-1 h-4 w-4" />Atur Layout</Button>
            <Button data-testid="add-table-button" onClick={() => setForm({ area: current || "Indoor", kind: "table" })}><Plus className="mr-1 h-4 w-4" />Tambah Meja</Button>
          </>
        )}
        {editing && (
          <>
            <Button data-testid="cancel-layout-button" variant="outline" onClick={() => setEditing(false)}><X className="mr-1 h-4 w-4" />Batal</Button>
            <Button data-testid="add-table-button" variant="outline" onClick={() => setForm({ area: current || "Indoor", kind: "table" })}><Plus className="mr-1 h-4 w-4" />Tambah</Button>
            <Button data-testid="save-layout-button" onClick={saveLayout}><Save className="mr-1 h-4 w-4" />Simpan Layout</Button>
          </>
        )}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm" data-testid="table-legend">
          {Object.entries(STATUS).map(([k, s]) => (
            <span key={k} data-testid={`table-count-${k}`} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />{s.label}
              <span className="font-mono text-xs text-muted-foreground">({realTables.filter((t) => t.status === k).length})</span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
          {areas.map((a) => (
            <button key={a} data-testid={`area-tab-${a.toLowerCase().replace(/\s+/g, "-")}`} onClick={() => setArea(a)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold ${current === a ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-secondary"}`}>{a}</button>
          ))}
        </div>
      </div>

      <FloorCanvas tables={shown} positions={positions} setPositions={setPositions} editing={editing} onTileClick={onTileClick}
        onDelete={deleteTable} />

      <FormDialog open={!!form} onOpenChange={(o) => !o && setForm(null)} title={form?.id ? `Edit ${form.name}` : "Tambah Meja / Objek"} fields={FIELDS} initial={form} onSubmit={saveForm} testid="table-form" />
      <TableDetailDialog table={detail} tables={tables} onClose={() => setDetailId(null)} onChanged={load}
        onPaid={(trx, partial) => { setReceipt(trx); if (!partial) setDetailId(null); load(); }} />
      <ReceiptDialog trx={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
