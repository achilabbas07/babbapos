import {
  addDays,
  buildOwnerMonitorFallback,
  isOwnerMonitorUnavailable,
  ownerPeriodBounds,
  summarizeActiveShifts,
  summarizeInventory,
  summarizeOpenBills,
  summarizeProfitLoss,
  summarizeTransactions,
} from "./ownerFallback";
import { normalizeOwnerDashboard } from "./ownerData";

// Kompatibilitas Mode Owner: menyusun payload bentuk `/reports/owner-monitor`
// dari endpoint BACA-SAJA lama, supaya halaman Pantauan Pemilik tetap tampil
// saat rute gabungan belum tersedia di server APK.
describe("kompatibilitas Pantauan Pemilik (fallback baca-saja)", () => {
  test("mengenali rute gabungan yang belum ada (404/405/501)", () => {
    expect(isOwnerMonitorUnavailable({ response: { status: 404 } })).toBe(true);
    expect(isOwnerMonitorUnavailable({ response: { status: 405 } })).toBe(true);
    expect(isOwnerMonitorUnavailable({ response: { status: 501 } })).toBe(true);
    // Error jaringan / server biasa TIDAK memicu fallback.
    expect(isOwnerMonitorUnavailable({ response: { status: 500 } })).toBe(false);
    expect(isOwnerMonitorUnavailable({ message: "Network Error" })).toBe(false);
    expect(isOwnerMonitorUnavailable(undefined)).toBe(false);
  });

  test("menghitung batas periode Bulan (WITA)", () => {
    expect(ownerPeriodBounds({ month: 2, year: 2026 })).toMatchObject({
      start: "2026-02-01",
      end: "2026-02-28",
      mode: "month",
    });
    // Tahun kabisat.
    expect(ownerPeriodBounds({ month: 2, year: 2024 }).end).toBe("2024-02-29");
    expect(ownerPeriodBounds({ month: 12, year: 2025 }).end).toBe("2025-12-31");
  });

  test("menghitung batas periode Tanggal", () => {
    expect(ownerPeriodBounds({ start: "2026-11-10", end: "2026-11-12" })).toMatchObject({
      start: "2026-11-10",
      end: "2026-11-12",
      mode: "range",
    });
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("meringkas omzet dari daftar transaksi", () => {
    const txs = [
      { total: 50000, items_json: [{ qty: 2 }, { qty: 1 }] },
      { total: 30000, items_json: [{ qty: 3 }] },
    ];
    expect(summarizeTransactions(txs)).toEqual({
      total_revenue: 80000,
      transaction_count: 2,
      total_items: 6,
      average_order_value: 40000,
    });
  });

  test("meringkas open bill + nama meja + jumlah item", () => {
    const bills = [
      { id: "OB-1", total: 75000, tableId: "T-1", waiterName: "Sari", items_json: [{ qty: 3 }] },
      { id: "OB-2", total: 25000, tableId: "T-2", items_json: [{ qty: 1 }] },
    ];
    const result = summarizeOpenBills(bills, { "T-1": "Meja 1" });
    expect(result.count).toBe(2);
    expect(result.total_value).toBe(100000);
    expect(result.items[0]).toMatchObject({ table_name: "Meja 1", item_count: 3 });
    expect(result.items[1].table_name).toBe("");
  });

  test("meringkas stok bahan + penanda menipis + nilai persediaan", () => {
    const stocks = [
      { id: "INV-1", name: "Gula", stock: 5, cost_per_unit: 15000, min_stock: 10, unit: "kg" },
      { id: "INV-2", name: "Kopi", stock: 20, cost_per_unit: 90000, min_stock: 5, unit: "kg" },
    ];
    const result = summarizeInventory(stocks);
    expect(result.count).toBe(2);
    expect(result.low_stock_count).toBe(1);
    expect(result.total_stock_value).toBe(5 * 15000 + 20 * 90000);
    expect(result.items[0].is_low).toBe(true);
    expect(result.items[1].is_low).toBe(false);
  });

  test("meringkas shift aktif dari progres target + transaksi periode", () => {
    const progress = [
      { shiftId: "WSHIFT-1", waiterId: "U-3", waiterName: "Sari", openedAt: "2026-11-10T02:00:00+00:00" },
    ];
    const txs = [
      { shiftId: "WSHIFT-1", items_json: [{ qty: 4 }], promoDiscount: 10000, promoCode: "PROMO", pointsRedeemed: 20, pointsDiscount: 5000 },
      { shiftId: "WSHIFT-9", items_json: [{ qty: 9 }] },
    ];
    const [shift] = summarizeActiveShifts(progress, txs);
    expect(shift.waiter_name).toBe("Sari");
    expect(shift.total_orders).toBe(1);
    expect(shift.total_items_sold).toBe(4);
    expect(shift.total_voids).toBe(0);
    expect(shift.promo_usage).toEqual({ count: 1, discount: 10000 });
    expect(shift.redeem_points.count).toBe(1);
    expect(shift.redeem_points.points).toBe(20);
    expect(shift.redeem_points.discount).toBe(5000);
  });

  test("memakai ringkasan laba-rugi dari respons finance", () => {
    const report = {
      summary: { revenue: 150000, sales_discount: 20000, hpp: 40000, expenses: 25000, net_profit: -35000 },
    };
    expect(summarizeProfitLoss(report)).toEqual({
      revenue: 150000,
      sales_discount: 20000,
      hpp: 40000,
      expenses: 25000,
      net_profit: -35000,
    });
  });

  test("menyusun payload lengkap yang bisa dinormalkan + hanya memakai GET", async () => {
    const calls = [];
    const client = {
      get: async (url, config) => {
        calls.push({ url, config });
        if (url === "/transactions") {
          return { data: [{ total: 60000, items_json: [{ qty: 2 }], shiftId: "WSHIFT-1", promoDiscount: 0 }] };
        }
        if (url === "/open-bills") return { data: [{ id: "OB-1", total: 40000, tableId: "T-1", items_json: [{ qty: 1 }] }] };
        if (url === "/tables") return { data: [{ id: "T-1", name: "Meja 1" }] };
        if (url === "/inventory") return { data: [{ id: "INV-1", name: "Gula", stock: 5, cost_per_unit: 10000, min_stock: 2 }] };
        if (url === "/targets/progress") return { data: [{ shiftId: "WSHIFT-1", waiterId: "U-3", waiterName: "Sari", openedAt: "2026-11-10T02:00:00+00:00" }] };
        if (url === "/finance/profit-loss") return { data: { summary: { revenue: 60000, sales_discount: 0, hpp: 20000, expenses: 10000, net_profit: 30000 } } };
        throw new Error(`tidak terduga: ${url}`);
      },
    };

    const payload = await buildOwnerMonitorFallback({ month: 11, year: 2026 }, client);
    expect(calls.map((c) => c.url)).toEqual([
      "/transactions",
      "/open-bills",
      "/tables",
      "/inventory",
      "/targets/progress",
      "/finance/profit-loss",
    ]);

    const data = normalizeOwnerDashboard(payload);
    expect(data.readonly).toBe(true);
    expect(data.period.start).toBe("2026-11-01");
    expect(data.omzet.totalRevenue).toBe(60000);
    expect(data.openBills.items[0].tableName).toBe("Meja 1");
    expect(data.inventory.totalStockValue).toBe(50000);
    expect(data.activeShifts[0].totalItemsSold).toBe(2);
    expect(data.profitLoss.netProfit).toBe(30000);
  });

  test("satu bagian gagal tidak menggagalkan seluruh halaman", async () => {
    const client = {
      get: async (url) => {
        if (url === "/inventory") throw new Error("boom");
        if (url === "/transactions") return { data: [] };
        return { data: [] };
      },
    };
    const payload = await buildOwnerMonitorFallback({ month: 11, year: 2026 }, client);
    expect(payload.inventory.count).toBe(0);
    expect(payload.omzet.transaction_count).toBe(0);
  });

  test("tanpa klien HTTP tetap mengembalikan bentuk payload yang benar", async () => {
    const payload = await buildOwnerMonitorFallback({ month: 11, year: 2026 });
    const data = normalizeOwnerDashboard(payload);
    expect(data.omzet.totalRevenue).toBe(0);
    expect(data.openBills.count).toBe(0);
    expect(data.inventory.count).toBe(0);
    expect(data.activeShifts).toEqual([]);
  });
});
