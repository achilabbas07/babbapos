import { useEffect, useState } from "react";
import { Star, Trophy } from "lucide-react";
import { api, rp } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache } from "@/lib/offlineRead";
import CachedDataNotice from "@/components/CachedDataNotice";

export const TopCustomers = ({ refreshKey }) => {
  const [top, setTop] = useState([]);
  const [error, setError] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);
  useEffect(() => {
    // Fallback cache lokal: daftar pelanggan terbaik tetap tampil saat offline.
    // Error hanya ditampilkan bila tidak ada cache sama sekali.
    loadWithCache(
      CACHE_KEYS.CUSTOMERS_TOP,
      async () => (await api.get("/customers/top")).data,
    ).then((result) => {
      if (result.canceled) return;
      if (result.data !== undefined) { setTop(Array.isArray(result.data) ? result.data : []); setError(false); }
      else if (result.error) setError(true);
      setFromCache(result.fromCache);
      setCachedAt(result.updatedAt);
    });
  }, [refreshKey]);
  return (
    <div data-testid="top-customers-card" className="rounded-2xl border border-border bg-card p-5">
      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">10 Pelanggan Terbaik</h2>
      </div>
      {error && <p data-testid="top-customers-error" className="text-sm text-destructive">Gagal memuat data.</p>}
      {!error && top.length === 0 && <p className="text-sm text-muted-foreground">Belum ada data belanja.</p>}
      <ol className="space-y-1">
        {top.map((c, i) => (
          <li key={c.id} data-testid={`top-customer-${i + 1}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs font-bold ${i < 3 ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{c.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{rp(c.total_spent)}</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-primary"><Star className="h-3.5 w-3.5" />{c.points}</span>
          </li>
        ))}
      </ol>
    </div>
  );
};
