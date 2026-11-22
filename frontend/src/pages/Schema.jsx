import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Link2 } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache } from "@/lib/offlineRead";
import { SCHEMA, RELATIONS } from "@/lib/schema";
import { PageHeader } from "@/components/PageHeader";
import CachedDataNotice from "@/components/CachedDataNotice";

const NAMES = Object.fromEntries(SCHEMA.map((s) => [s.key, s.name]));

const related = (key) => new Set(SCHEMA.flatMap((s) => s.fields.filter((f) => f[3]).flatMap((f) => (s.key === key ? [f[3]] : f[3] === key ? [s.key] : []))));

const FieldRow = ({ f, onHover }) => {
  const [name, type, tag, ref] = f;
  const isPk = tag?.includes("PK");
  const isFk = tag?.includes("FK");
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1.5 text-xs" onMouseEnter={() => ref && onHover(ref)}>
      <span className="flex min-w-0 items-center gap-1.5">
        {isPk ? <KeyRound className="h-3 w-3 shrink-0 text-primary" /> : isFk ? <Link2 className="h-3 w-3 shrink-0 text-sky-600" /> : <span className="w-3" />}
        <span className={`truncate font-mono ${isPk ? "text-primary" : ""}`}>{name}</span>
        {tag?.includes("+") && <span className="rounded bg-emerald-100 px-1 text-[9px] text-emerald-700">tambahan</span>}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground">{ref ? `→ ${NAMES[ref]}` : type}</span>
    </div>
  );
};

export default function Schema() {
  const [counts, setCounts] = useState({});
  const [focus, setFocus] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  // Fallback cache lokal: jumlah baris terakhir tetap tampil saat offline.
  useEffect(() => {
    loadWithCache(
      CACHE_KEYS.SCHEMA_COUNTS,
      async () => (await api.get("/schema")).data?.counts,
    ).then((result) => {
      if (result.canceled) return;
      if (result.data !== undefined && result.data !== null) setCounts(result.data);
      setFromCache(result.fromCache);
      setCachedAt(result.updatedAt);
      if (result.error) toast.error(errMsg(result.error));
    });
  }, []);

  const rel = focus ? related(focus) : null;

  return (
    <div>
      <PageHeader title="Skema Database" subtitle="10 tabel inti + tabel tambahan di Supabase (PostgreSQL) beserta relasi PK/FK. Arahkan kursor ke tabel untuk menyorot relasinya." />
      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" onMouseLeave={() => setFocus(null)}>
        {SCHEMA.map((s) => {
          const state = !focus ? "" : s.key === focus ? "border-primary ring-1 ring-primary" : rel.has(s.key) ? "border-sky-500/70" : "opacity-35";
          return (
            <div key={s.key} data-testid={`schema-table-${s.key}`} onMouseEnter={() => setFocus(s.key)}
              className={`overflow-hidden rounded-2xl border border-border bg-card transition-[opacity,border-color] duration-200 ${state}`}>
              <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-4 py-3">
                <div>
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.desc}</p>
                </div>
                <span data-testid={`schema-count-${s.key}`} className="rounded-full bg-background px-2.5 py-1 font-mono text-xs">{counts[s.key] ?? "–"}</span>
              </div>
              <div className="py-2">{s.fields.map((f) => <FieldRow key={f[0]} f={f} onHover={() => {}} />)}</div>
            </div>
          );
        })}
      </div>

      <section className="mt-10 rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Relasi & aturan integritas</h2>
        <div className="divide-y divide-border">
          {RELATIONS.map(([from, to, card, rule]) => (
            <div key={from} data-testid={`schema-relation-${from}`} className="grid gap-1 py-2.5 text-sm md:grid-cols-[1.4fr_1fr_70px_2fr] md:items-center">
              <span className="font-mono text-xs">{from}</span>
              <span className="font-mono text-xs text-sky-600">→ {to}</span>
              <span className="font-mono text-xs text-primary">{card}</span>
              <span className="text-xs text-muted-foreground">{rule}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          ["1 · Pesan", "Kasir/waiter membuat Open Bill → Tables.status = occupied, orderData.openBillId terisi."],
          ["2 · Bayar", "Transaksi dibuat dari bill → stok Inventory berkurang sesuai Recipes × qty, Customer +poin, meja kosong."],
          ["3 · Restock", "Purchases menambah stok & memperbarui cost_per_unit → HPP produk terkait dihitung ulang."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-border bg-card p-5">
            <p className="font-semibold text-primary">{t}</p>
            <p className="mt-2 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
