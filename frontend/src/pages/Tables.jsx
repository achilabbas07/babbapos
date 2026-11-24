import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Move, Save, X, CloudOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache } from "@/lib/offlineRead";
import { OFFLINE_BILL_STATUS_LABEL, projectTables, pendingOpenBillsFromQueue } from "@/lib/offlineOpenBills";
import { useTransactionQueue } from "@/hooks/useTransactionQueue";
import { QUEUE_SYNC_EVENT } from "@/lib/queueSync";
import { PageHeader } from "@/components/PageHeader";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { ReceiptDialog } from "@/components/ReceiptDialog";
import CachedDataNotice from "@/components/CachedDataNotice";
import { FloorCanvas, STATUS, autoLayout } from "@/components/tables/FloorCanvas";
import { TableDetailDialog } from "@/components/tables/TableDetailDialog";
import { TABLES_FALLBACK_POLL_MS, createTablesReloadScheduler, subscribeToTablesRealtime } from "@/lib/realtimeTables";

const FIELDS = [
  { name: "name", label: "Nama", required: true, placeholder: "A-01" },
  { name: "area", label: "Area", required: true, placeholder: "Indoor / Outdoor / VIP Room" },
  { name: "kind", label: "Jenis", type: "select", options: [{ value: "table", label: "Meja" }, { value: "fixture", label: "Objek denah (Kasir, Bar, dll)" }] },
];

// Penanda bahwa koordinat di DB sudah memakai satuan unit halus (bukan satuan
// sel lama). Disimpan per-perangkat; bila DB sudah berisi unit (nilai > 10),
// deteksi otomatis juga menganggapnya unit sehingga denah tidak melompat.
const LAYOUT_UNITS_MARKER = "babbapos.table-layout-units";

const layoutUsesUnits = (tables) => {
  try {
    if (typeof window !== "undefined" && window.localStorage.getItem(LAYOUT_UNITS_MARKER) === "1") return true;
  } catch { /* localStorage tidak tersedia -> pakai deteksi data */ }
  const coords = tables.flatMap((t) => (t.x != null && t.y != null ? [t.x, t.y] : []));
  return coords.length > 0 && Math.max(...coords) > 10;
};

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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);
  const { items: queueItems } = useTransactionQueue(true);

  // Muat denah meja dengan fallback cache lokal: bila fetch gagal karena
  // jaringan/offline, denah terakhir dari cache tetap ditampilkan.
  const load = useCallback((signal) => loadWithCache(
    CACHE_KEYS.TABLES,
    async () => (await api.get("/tables", { signal })).data,
  ).then((result) => {
    if (result.canceled) return;
    if (result.data !== undefined) setTables(result.data);
    setFromCache(result.fromCache);
    setCachedAt(result.updatedAt);
    if (result.error) toast.error(errMsg(result.error));
  }), []);

  const queueReloadRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onOnline = () => { queueReloadRef.current = true; };
    const onSynced = () => {
      if (!queueReloadRef.current) return;
      queueReloadRef.current = false;
      load();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener(QUEUE_SYNC_EVENT, onSynced);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(QUEUE_SYNC_EVENT, onSynced);
    };
  }, [load]);

  // Proyeksikan Open Bill yang masih mengantre (pending/failed) ke denah meja
  // agar meja berstatus "Terisi" walau bill belum tersimpan di server.
  //
  // PENTING: proyeksi TIDAK digantung pada `navigator.onLine`/status offline.
  // Di WebView Android, `navigator.onLine` bisa tetap `true` saat server tak
  // terjangkau; bila proyeksi digantung pada sinyal itu, bill yang tersimpan
  // lokal tidak pernah tampil. Item yang sudah terkirim sudah dihapus dari
  // antrean (`queueSync`), jadi tidak ada duplikasi setelah sinkronisasi.
  const offlineBills = useMemo(() => pendingOpenBillsFromQueue(queueItems), [queueItems]);
  const offlineByTable = useMemo(
    () => Object.fromEntries(offlineBills.filter((b) => b.tableId).map((b) => [b.tableId, b])),
    [offlineBills],
  );

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
    if (!editing) setPositions(autoLayout(tables, !layoutUsesUnits(tables)));
  }, [tables, editing]);

  // Denah yang ditampilkan = data server/cache + proyeksi antrean offline.
  const renderedTables = useMemo(
    () => projectTables(tables, queueItems, offlineBills),
    [tables, queueItems, offlineBills],
  );
  const areas = [...new Set(tables.map((t) => t.area))];
  const current = areas.includes(area) ? area : areas[0];
  const shown = renderedTables.filter((t) => t.area === current);
  const realTables = renderedTables.filter((t) => t.kind !== "fixture");
  const detail = renderedTables.find((t) => t.id === detailId) || null;

  const saveLayout = async () => {
    try {
      // Simpan dalam satuan unit halus (integer 0..60). Pembulatan hanya untuk
      // memenuhi tipe int backend/DB, BUKAN snap ke grid sel -> posisi bebas
      // tetap bertahan setelah save & muat ulang.
      const clampUnit = (v) => Math.max(0, Math.min(60, Math.round(v)));
      const saved = Object.entries(positions).map(([id, p]) => ({ id, x: clampUnit(p.x), y: clampUnit(p.y) }));
      await api.put("/tables/layout", saved);
      // Sinkronkan state lokal lebih dulu agar posisi tidak melompat balik
      // sebelum hasil muat ulang tiba (tabel lama masih berisi koordinat lama).
      const byId = Object.fromEntries(saved.map((s) => [s.id, s]));
      setTables((prev) => prev.map((t) => (byId[t.id] ? { ...t, x: byId[t.id].x, y: byId[t.id].y } : t)));
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(LAYOUT_UNITS_MARKER, "1");
      } catch { /* localStorage tidak tersedia -> abaikan */ }
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

      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />

      {offlineBills.length > 0 && (
        <div data-testid="tables-offline-bills-notice" className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {offlineBills.length} Open Bill menunggu dikirim: {offlineBills.map((b) => {
              const tableName = tables.find((t) => t.id === b.tableId)?.name || b.tableId || "Tanpa meja";
              return `${tableName} (${OFFLINE_BILL_STATUS_LABEL[b.queuedStatus] || b.queuedStatus})`;
            }).join(", ")}. Meja terkait ditandai terisi sampai data terkirim.
          </span>
        </div>
      )}

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
      <TableDetailDialog table={detail} tables={tables} offlineBill={detail ? offlineByTable[detail.id] || null : null} onClose={() => setDetailId(null)} onChanged={load}
        onPaid={(trx, partial) => { setReceipt(trx); if (!partial) setDetailId(null); load(); }} />
      <ReceiptDialog trx={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
