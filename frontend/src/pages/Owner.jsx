import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, Lock, RotateCw } from "lucide-react";
import { api, errMsg, rp, num, fmtDate } from "@/lib/api";
import { CACHE_KEYS } from "@/lib/localStore";
import { loadWithCache, rangeCacheKey } from "@/lib/offlineRead";
import { useAuth } from "@/context/AuthContext";
import { isAdminRole } from "@/lib/openBillDisplay";
import { PageHeader, StatCard, Empty } from "@/components/PageHeader";
import CachedDataNotice from "@/components/CachedDataNotice";
import OwnerPeriodFilter from "@/components/owner/OwnerPeriodFilter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { monthLabel, normalizeOwnerDashboard, ownerRangeParams, summarizeShifts } from "@/lib/ownerData";
import { buildOwnerMonitorFallback, isOwnerMonitorUnavailable } from "@/lib/ownerFallback";
import { isOwnerMode } from "@/lib/appMode";

// Halaman Pantauan Pemilik (Mode Owner).
//
// STRICTLY READ-ONLY: halaman ini hanya menampilkan data hasil pembacaan
// endpoint `/reports/owner-monitor`. Tidak ada satu pun tombol atau aksi yang
// menambah, mengubah, menghapus, membatalkan item, menutup sesi kasir,
// menyesuaikan stok fisik, maupun memutasi data — sesuai batasan mode Owner.
// Halaman tidak menyentuh alur HPP, pemakaian stok saat pembayaran, antrean
// offline, autentikasi/shift gate, jurnal diskon, maupun cetak dapur.
export default function Owner() {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user);
  const now = useMemo(() => new Date(), []);
  const [mode, setMode] = useState("month");
  const [params, setParams] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);

  const load = useCallback(() => {
    if (!isAdmin) {
      setData(normalizeOwnerDashboard(null));
      return Promise.resolve();
    }
    setLoading(true);
    // Endpoint gabungan `/reports/owner-monitor` ideal. Bila server yang
    // melayani APK belum memilikinya (404 "Not Found"), susun payload yang sama
    // dari endpoint baca-saja lama lewat kompatibilitas `buildOwnerMonitorFallback`
    // supaya halaman Pantauan Pemilik tetap tampil. Kompatibilitas ini HANYA
    // aktif di APK Mode Owner (`REACT_APP_OWNER_MODE`); APK Operasional tidak
    // terpengaruh. Error lain dibiarkan apa adanya.
    return loadWithCache(
      rangeCacheKey(CACHE_KEYS.OWNER_DASHBOARD, params),
      async () => {
        try {
          return (await api.get("/reports/owner-monitor", { params })).data;
        } catch (error) {
          if (isOwnerMode() && isOwnerMonitorUnavailable(error)) {
            return buildOwnerMonitorFallback(params, api);
          }
          throw error;
        }
      },
    )
      .then((result) => {
        if (result.canceled) return;
        if (result.data !== undefined) setData(normalizeOwnerDashboard(result.data));
        setFromCache(result.fromCache);
        setCachedAt(result.updatedAt);
        if (result.error) {
          toast.error(errMsg(result.error));
          setData(normalizeOwnerDashboard(null));
        }
      })
      .finally(() => setLoading(false));
  }, [params, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPeriod = (payload) => {
    setMode(payload.month ? "month" : "range");
    setParams(ownerRangeParams(payload.month ? "month" : "range", payload));
  };

  const omzet = data?.omzet;
  const openBills = data?.openBills;
  const inventory = data?.inventory;
  const shifts = useMemo(() => data?.activeShifts || [], [data]);
  const profitLoss = data?.profitLoss;
  const shiftSummary = useMemo(() => summarizeShifts(shifts), [shifts]);

  const periodHint = mode === "month"
    ? `Periode ${monthLabel(data?.period?.month, data?.period?.year)}`
    : data?.period?.start
      ? `Periode ${data.period.start} s.d. ${data.period.end}`
      : "";

  return (
    <div data-testid="owner-page">
      <PageHeader
        title="Pantauan Pemilik"
        subtitle="Mode Owner — hanya membaca. Tidak ada satu pun tombol yang mengubah, menambah, menghapus, membatalkan item, atau menyesuaikan stok fisik di halaman ini."
      >
        <span
          data-testid="owner-readonly-badge"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700"
        >
          <Lock className="h-4 w-4" /> Hanya Baca
        </span>
        <button
          type="button"
          data-testid="owner-refresh"
          onClick={load}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-secondary"
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat ulang
        </button>
      </PageHeader>

      <CachedDataNotice fromCache={fromCache} updatedAt={cachedAt} />

      <OwnerPeriodFilter onApply={applyPeriod} initialMode="month" />

      {/* 1. Omzet */}
      <section data-testid="owner-section-omzet" className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Eye className="h-4 w-4 text-primary" /> Omzet
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Omzet"
            value={rp(omzet?.totalRevenue ?? 0)}
            tone="text-emerald-600"
            hint={periodHint}
            testid="owner-omzet-total"
          />
          <StatCard
            label="Jumlah Nota"
            value={num(omzet?.transactionCount ?? 0)}
            hint="Transaksi dibayar pada periode ini"
            testid="owner-omzet-transactions"
          />
          <StatCard
            label="Total Item Terjual"
            value={num(omzet?.totalItems ?? 0)}
            hint="Akumulasi qty item pada nota"
            testid="owner-omzet-items"
          />
          <StatCard
            label="Rata-rata Nilai Nota"
            value={rp(omzet?.averageOrderValue ?? 0)}
            hint="Total omzet / jumlah nota"
            testid="owner-omzet-average"
          />
        </div>
      </section>

      {/* 2. Total Open Bill */}
      <section data-testid="owner-section-open-bills" className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Total Open Bill</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Jumlah Open Bill"
            value={num(openBills?.count ?? 0)}
            hint="Bill yang belum dibayar"
            testid="owner-open-bills-count"
          />
          <StatCard
            label="Total Nilai Open Bill"
            value={rp(openBills?.totalValue ?? 0)}
            tone="text-amber-600"
            hint="Nilai tagihan berjalan"
            testid="owner-open-bills-total"
          />
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-card">
          {(openBills?.items || []).length === 0 ? (
            <Empty text="Tidak ada open bill saat ini." testid="owner-open-bills-empty" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Meja</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Pelayan</TableHead>
                  <TableHead className="text-right">Item</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openBills.items.map((row) => (
                  <TableRow key={row.key} data-testid={`owner-open-bill-${row.id}`}>
                    <TableCell>{row.timestamp ? fmtDate(row.timestamp) : row.date || "-"}</TableCell>
                    <TableCell>{row.tableName || row.tableId || "-"}</TableCell>
                    <TableCell>{row.customerName || "-"}</TableCell>
                    <TableCell>{row.waiterName || "-"}</TableCell>
                    <TableCell className="text-right">{num(row.itemCount)}</TableCell>
                    <TableCell className="text-right">{rp(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* 3. Stok Bahan */}
      <section data-testid="owner-section-inventory" className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Stok Bahan</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Jumlah Bahan"
            value={num(inventory?.count ?? 0)}
            hint="Item persediaan tercatat"
            testid="owner-inventory-count"
          />
          <StatCard
            label="Stok Menipis"
            value={num(inventory?.lowStockCount ?? 0)}
            tone={(inventory?.lowStockCount || 0) > 0 ? "text-red-600" : ""}
            hint="Stok <= stok minimum"
            testid="owner-inventory-low"
          />
          <StatCard
            label="Nilai Persediaan"
            value={rp(inventory?.totalStockValue ?? 0)}
            hint="Stok x harga pokok satuan"
            testid="owner-inventory-value"
          />
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-card">
          {(inventory?.items || []).length === 0 ? (
            <Empty text="Belum ada data stok bahan." testid="owner-inventory-empty" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bahan</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead>Satuan</TableHead>
                  <TableHead className="text-right">HPP Satuan</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.items.map((row) => (
                  <TableRow key={row.key} data-testid={`owner-inventory-row-${row.id}`}>
                    <TableCell className="font-medium">{row.name || "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(row.stock)}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(row.minStock)}</TableCell>
                    <TableCell>{row.unit || "-"}</TableCell>
                    <TableCell className="text-right">{rp(row.costPerUnit)}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.isLow ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {row.isLow ? "Menipis" : "Aman"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* 4. Shift Aktif */}
      <section data-testid="owner-section-shifts" className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Shift Aktif</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Pelayan Aktif"
            value={num(shiftSummary.waiters)}
            hint="Shift pelayan yang masih terbuka"
            testid="owner-shifts-count"
          />
          <StatCard
            label="Total Item Terjual"
            value={num(shiftSummary.itemsSold)}
            hint="Akumulasi seluruh shift aktif"
            testid="owner-shifts-items"
          />
          <StatCard
            label="Total Void"
            value={num(shiftSummary.voids)}
            tone={shiftSummary.voids > 0 ? "text-red-600" : ""}
            hint="Jumlah void pada shift aktif"
            testid="owner-shifts-voids"
          />
        </div>

        {shifts.length === 0 ? (
          <div className="mt-4">
            <Empty text="Belum ada shift pelayan yang aktif." testid="owner-shifts-empty" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {shifts.map((shift) => (
              <div
                key={shift.key}
                data-testid={`owner-shift-${shift.shiftId}`}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p data-testid={`owner-shift-name-${shift.shiftId}`} className="text-base font-semibold">
                      {shift.waiterName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Buka shift: {shift.openedAt ? fmtDate(shift.openedAt) : "-"} · {num(shift.totalOrders)} pesanan
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Total Item Terjual"
                    value={num(shift.totalItemsSold)}
                    hint="Item terjual pada shift ini"
                    testid={`owner-shift-items-${shift.shiftId}`}
                  />
                  <StatCard
                    label="Total Void"
                    value={num(shift.totalVoids)}
                    tone={shift.totalVoids > 0 ? "text-red-600" : ""}
                    hint={`${num(shift.voidQty)} item · ${rp(shift.voidValue)}`}
                    testid={`owner-shift-voids-${shift.shiftId}`}
                  />
                  <StatCard
                    label="Penggunaan Promo"
                    value={num(shift.promoCount)}
                    hint={`Diskon promo ${rp(shift.promoDiscount)}`}
                    testid={`owner-shift-promo-${shift.shiftId}`}
                  />
                  <StatCard
                    label="Redeem Point"
                    value={num(shift.pointsRedeemed)}
                    hint={`${num(shift.redeemCount)} penukaran · potongan ${rp(shift.pointsDiscount)}`}
                    testid={`owner-shift-points-${shift.shiftId}`}
                  />
                </div>

                {shift.voidDetails.length > 0 && (
                  <div className="mt-4 rounded-xl border border-dashed border-border p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Rincian Void
                    </p>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {shift.voidDetails.map((row) => (
                        <li key={row.key}>
                          {num(row.qty)}x {row.name} — {row.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. Laporan Laba-Rugi */}
      <section data-testid="owner-section-profit-loss" className="mb-4">
        <h2 className="mb-3 text-lg font-semibold">Laporan Laba-Rugi</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Mengikuti periode filter di atas ({periodHint || "-"}).
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Total Pendapatan"
            value={rp(profitLoss?.revenue ?? 0)}
            tone="text-emerald-600"
            testid="owner-pl-revenue"
          />
          <StatCard
            label="Potongan Penjualan"
            value={rp(profitLoss?.salesDiscount ?? 0)}
            testid="owner-pl-discount"
          />
          <StatCard label="HPP" value={rp(profitLoss?.hpp ?? 0)} testid="owner-pl-hpp" />
          <StatCard label="Total Beban" value={rp(profitLoss?.expenses ?? 0)} testid="owner-pl-expenses" />
          <StatCard
            label="Laba Bersih"
            value={rp(profitLoss?.netProfit ?? 0)}
            tone={(profitLoss?.netProfit ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}
            testid="owner-pl-net"
          />
        </div>
      </section>
    </div>
  );
}
