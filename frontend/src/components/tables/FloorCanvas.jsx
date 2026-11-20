import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Armchair, Store } from "lucide-react";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { fmtTime } from "@/lib/api";

export const CELL = 132;
const PAD = 20;
const TILE = 120;
const DEFAULT_POSITION = { x: 0, y: 0 };

// Ukuran sel & kartu dibaca dari CSS (`.floor-canvas`), sehingga denah meja
// menyesuaikan lebar layar HP/tablet. Nilai fallback = default desktop.
const readCssSize = (el, name, fallback) => {
  if (!el || typeof window === "undefined") return fallback;
  const raw = Number.parseFloat(window.getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const useFloorSizes = (ref) => {
  const [sizes, setSizes] = useState({ cell: CELL, tile: TILE });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setSizes((prev) => {
      const cell = readCssSize(el, "--floor-cell", CELL);
      const tile = readCssSize(el, "--floor-tile", TILE);
      return prev.cell === cell && prev.tile === tile ? prev : { cell, tile };
    });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [ref]);
  return sizes;
};

export const STATUS = {
  available: { label: "Kosong", dot: "bg-emerald-500", text: "text-emerald-700" },
  occupied: { label: "Terisi", dot: "bg-rose-500", text: "text-rose-600" },
  paid: { label: "Lunas (Kosongkan)", dot: "bg-emerald-600", text: "text-emerald-700" },
  reserved: { label: "Reservasi", dot: "bg-amber-500", text: "text-amber-600" },
};

export const autoLayout = (tables) => {
  const pos = {};
  const byArea = {};
  tables.forEach((t) => (byArea[t.area] = [...(byArea[t.area] || []), t]));
  Object.values(byArea).forEach((list) => {
    const used = new Set();
    list.filter((t) => t.x != null && t.y != null).forEach((t) => { pos[t.id] = { x: t.x, y: t.y }; used.add(`${t.x},${t.y}`); });
    let i = 0;
    list.filter((t) => t.x == null || t.y == null).forEach((t) => {
      while (used.has(`${i % 8},${Math.floor(i / 8)}`)) i += 1;
      pos[t.id] = { x: i % 8, y: Math.floor(i / 8) };
      used.add(`${i % 8},${Math.floor(i / 8)}`);
    });
  });
  return pos;
};

const shortRp = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v);

const Tile = ({ t, editing }) => {
  const fixture = t.kind === "fixture";
  const s = STATUS[t.status] || STATUS.available;
  const Icon = fixture ? Store : Armchair;
  const od = t.orderData;
  const busy = !editing && t.status === "occupied" && od;
  const isPaid = t.status === "paid";

  if (busy) {
    return (
      <div className={`flex h-full w-full min-w-0 flex-col px-1.5 py-1.5 ${s.text}`}>
        <p data-testid={`table-tile-customer-${t.id}`} className="w-full min-w-0 max-w-full truncate text-xs font-bold text-slate-700 sm:text-sm">
          {od.customerName?.trim() || "UMUM"}
        </p>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center">
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.2} />
          <p className="mt-0.5 w-full min-w-0 max-w-full truncate text-xs font-bold sm:text-sm">{t.name}</p>
        </div>
        <div className="mt-auto flex w-full items-end justify-between gap-1">
          <p data-testid={`table-tile-time-${t.id}`} className="truncate text-left font-mono text-[10px] sm:text-xs">
            {fmtTime(od.startTime)}
          </p>
          <p className="shrink-0 text-right text-xs font-bold sm:text-sm">{shortRp(od.total || 0)}</p>
        </div>
      </div>
    );
  }

  // Meja LUNAS: aksen hijau (emerald) dengan badge status yang rapi. Tidak ada
  // kotak berlapis (nested container) di dalam kartu utama -> bersih & minimalis.
  if (isPaid) {
    return (
      <div className="relative flex h-full w-full min-w-0 flex-col px-1.5 py-1.5">
        <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-emerald-400/70" aria-hidden="true" />
        <span
          data-testid={`table-tile-paid-badge-${t.id}`}
          className="absolute -left-1.5 -top-1.5 z-10 flex items-center gap-0.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white shadow-sm"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
          LUNAS
        </span>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center">
          <Icon className="h-5 w-5 text-emerald-600 sm:h-6 sm:w-6" strokeWidth={2.2} />
          <p className="mt-0.5 w-full min-w-0 max-w-full truncate text-xs font-bold text-slate-700 sm:text-sm">{t.name}</p>
        </div>
        {od && (
          <div className="mt-auto w-full min-w-0 border-t border-emerald-200 pt-1">
            <p
              data-testid={`table-tile-paid-customer-${t.id}`}
              className="w-full min-w-0 max-w-full truncate text-[10px] font-semibold text-slate-600 sm:text-xs"
            >
              {`${od.customerName || od.customer_name || ""}`.trim() || "UMUM"}
            </p>
            <p className="w-full text-right text-xs font-bold text-emerald-700 sm:text-sm">{shortRp(od.total || 0)}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`w-full px-1 ${fixture ? "text-slate-500" : s.text}`}>
      <Icon className="mx-auto h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.2} />
      <p className="mt-0.5 truncate text-xs font-bold sm:text-sm">{t.name}</p>
    </div>
  );
};

const FloorTileButton = memo(({ t, position, ghost, editing, down, move, up, onTileClick, onDelete, cell, tile }) => {
  const handlePointerDown = useCallback((event) => down(event, t), [down, t]);
  const handlePointerUp = useCallback((event) => up(event, t), [up, t]);
  const handleClick = useCallback(() => {
    if (!editing) onTileClick(t);
  }, [editing, onTileClick, t]);
  const handleDelete = useCallback(() => onDelete(t), [onDelete, t]);

  return (
    <div
      data-testid={`table-tile-${t.id}`}
      onPointerDown={handlePointerDown}
      onPointerMove={move}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      style={{
        left: ghost ? ghost.left : PAD + position.x * cell,
        top: ghost ? ghost.top : PAD + position.y * cell,
        width: tile,
        height: tile,
        touchAction: editing ? "none" : "manipulation",
      }}
      className={`absolute grid select-none place-items-center rounded-xl bg-[#eef1f5] text-center shadow-[3px_3px_8px_#cdd4dd,-3px_-3px_8px_#ffffff] ${
        ghost ? "z-20 cursor-grabbing scale-105" : "transition-[left,top,transform] duration-150"
      } ${editing ? "cursor-grab outline-dashed outline-2 outline-offset-2 outline-primary/40" : t.kind === "fixture" ? "cursor-default" : "cursor-pointer hover:-translate-y-0.5"}`}
    >
      <Tile t={t} editing={editing} />
      {editing && t.status !== "occupied" && (
        <span
          className="absolute -right-2 -top-2 rounded-lg bg-white shadow"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <ConfirmDelete testid={`table-delete-${t.id}`} title={`Hapus ${t.name}?`} onConfirm={handleDelete} />
        </span>
      )}
    </div>
  );
});

export const FloorCanvas = ({ tables, positions, setPositions, editing, onTileClick, onDelete }) => {
  const canvasRef = useRef(null);
  const drag = useRef(null);
  const [ghost, setGhost] = useState(null);
  const { cell, tile } = useFloorSizes(canvasRef);

  const cols = Math.max(10, ...tables.map((t) => (positions[t.id]?.x ?? 0) + 2));
  const rows = Math.max(4, ...tables.map((t) => (positions[t.id]?.y ?? 0) + 2));

  const down = useCallback((e, t) => {
    if (!editing) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const p = positions[t.id];
    drag.current = { id: t.id, dx: e.clientX - rect.left - (PAD + p.x * cell), dy: e.clientY - rect.top - (PAD + p.y * cell), sx: e.clientX, sy: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [editing, positions, cell]);
  const move = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 5) d.moved = true;
    if (!d.moved) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setGhost({ id: d.id, left: e.clientX - rect.left - d.dx, top: e.clientY - rect.top - d.dy });
  }, []);
  const up = useCallback((e, t) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    setGhost(null);
    if (!d.moved) return onTileClick(t);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.round((e.clientX - rect.left - d.dx - PAD) / cell));
    const y = Math.max(0, Math.round((e.clientY - rect.top - d.dy - PAD) / cell));
    setPositions((prev) => {
      const next = { ...prev };
      const other = tables.find((o) => o.id !== d.id && next[o.id]?.x === x && next[o.id]?.y === y);
      if (other) next[other.id] = prev[d.id];
      next[d.id] = { x, y };
      return next;
    });
  }, [onTileClick, setPositions, tables, cell]);

  return (
    <div className="floor-canvas max-w-full overflow-auto rounded-3xl border border-border bg-white shadow-sm" data-testid="floor-canvas">
      <div
        ref={canvasRef}
        className="relative min-w-full"
        style={{ width: cols * cell + PAD, height: rows * cell + PAD, backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: "18px 18px" }}
      >
        {tables.map((table) => (
          <FloorTileButton
            key={table.id}
            t={table}
            position={positions[table.id] || DEFAULT_POSITION}
            ghost={ghost?.id === table.id ? ghost : null}
            editing={editing}
            down={down}
            move={move}
            up={up}
            onTileClick={onTileClick}
            onDelete={onDelete}
            cell={cell}
            tile={tile}
          />
        ))}
      </div>
    </div>
  );
};
