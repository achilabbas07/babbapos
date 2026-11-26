import fs from "fs";
import path from "path";
import {
  monthLabel,
  normalizeOwnerDashboard,
  ownerRangeParams,
  summarizeShifts,
} from "./ownerData";

const PAYLOAD = {
  period: {
    start: "2026-11-01",
    end: "2026-11-30",
    month: 11,
    year: 2026,
    label: "2026-11-01 s.d. 2026-11-30",
    generated_at: "2026-11-30T17:00:00+08:00",
  },
  readonly: true,
  omzet: {
    total_revenue: 1500000,
    transaction_count: 20,
    total_items: "45",
    average_order_value: 75000,
  },
  open_bills: {
    count: 2,
    total_value: 100000,
    truncated: false,
    items: [
      {
        id: "OB-1",
        date: "2026-11-10",
        timestamp: "2026-11-10T05:00:00+00:00",
        type: "Dine In",
        table_id: "T-1",
        table_name: "Meja 1",
        customer_name: "Budi",
        waiter_name: "Pelayan Sari",
        item_count: 3,
        total: 75000,
      },
    ],
  },
  inventory: {
    count: 2,
    low_stock_count: 1,
    total_stock_value: 1875000,
    truncated: false,
    items: [
      { id: "I-1", name: "Gula", type: "bahan", stock: 5, unit: "kg", cost_per_unit: 15000, min_stock: 10, stock_value: 75000, is_low: true },
      { id: "I-2", name: "Kopi Robusta", type: "bahan", stock: 20, unit: "kg", cost_per_unit: 90000, min_stock: 5, stock_value: 1800000, is_low: false },
    ],
  },
  active_shifts: [
    {
      shift_id: "WSHIFT-1",
      waiter_id: "W-1",
      waiter_name: "Pelayan Sari",
      opened_at: "2026-11-10T02:00:00+00:00",
      total_orders: 2,
      total_items_sold: 4,
      total_voids: 1,
      void_qty: 1,
      void_value: 20000,
      void_details: [{ qty: 1, name: "Kopi Susu", reason: "Salah input" }],
      promo_usage: { count: 1, discount: 10000 },
      redeem_points: { count: 1, points: 20, discount: 5000 },
    },
  ],
  profit_loss: {
    revenue: 150000,
    sales_discount: 10000,
    hpp: 60000,
    expenses: 20000,
    net_profit: 60000,
  },
};

describe("ownerData.normalizeOwnerDashboard", () => {
  test("menormalkan kelima bagian pantauan", () => {
    const data = normalizeOwnerDashboard(PAYLOAD);

    expect(data.readonly).toBe(true);
    expect(data.period.month).toBe(11);
    expect(data.period.year).toBe(2026);
    expect(data.period.label).toContain("2026-11-01");

    expect(data.omzet).toEqual({
      totalRevenue: 1500000,
      transactionCount: 20,
      totalItems: 45,
      averageOrderValue: 75000,
    });
  });

  test("menormalkan open bill beserta barisnya", () => {
    const data = normalizeOwnerDashboard(PAYLOAD);
    expect(data.openBills.count).toBe(2);
    expect(data.openBills.totalValue).toBe(100000);
    expect(data.openBills.items).toHaveLength(1);

    const row = data.openBills.items[0];
    expect(row.id).toBe("OB-1");
    expect(row.tableName).toBe("Meja 1");
    expect(row.itemCount).toBe(3);
    expect(row.total).toBe(75000);
  });

  test("menormalkan stok bahan + penanda menipis", () => {
    const data = normalizeOwnerDashboard(PAYLOAD);
    expect(data.inventory.count).toBe(2);
    expect(data.inventory.lowStockCount).toBe(1);
    expect(data.inventory.totalStockValue).toBe(1875000);

    const gula = data.inventory.items.find((r) => r.name === "Gula");
    const kopi = data.inventory.items.find((r) => r.name === "Kopi Robusta");
    expect(gula.isLow).toBe(true);
    expect(kopi.isLow).toBe(false);
  });

  test("mendukung kelima metrik shift yang wajib dipantau", () => {
    const data = normalizeOwnerDashboard(PAYLOAD);
    expect(data.activeShifts).toHaveLength(1);

    const shift = data.activeShifts[0];
    expect(shift.waiterName).toBe("Pelayan Sari");       // Nama Pelayan
    expect(shift.totalItemsSold).toBe(4);                // Total Item Terjual
    expect(shift.totalVoids).toBe(1);                    // Total Void
    expect(shift.promoCount).toBe(1);                    // Penggunaan Promo
    expect(shift.promoDiscount).toBe(10000);
    expect(shift.pointsRedeemed).toBe(20);               // Redeem Point
    expect(shift.redeemCount).toBe(1);
    expect(shift.voidDetails[0].name).toBe("Kopi Susu");
  });

  test("menormalkan laba-rugi dan menghitung laba bersih bila kosong", () => {
    const data = normalizeOwnerDashboard(PAYLOAD);
    expect(data.profitLoss).toEqual({
      revenue: 150000,
      salesDiscount: 10000,
      hpp: 60000,
      expenses: 20000,
      netProfit: 60000,
    });

    const derived = normalizeOwnerDashboard({
      profit_loss: { revenue: 100000, sales_discount: 5000, hpp: 30000, expenses: 10000 },
    });
    expect(derived.profitLoss.netProfit).toBe(55000);
  });

  test("aman terhadap payload kosong / tidak valid", () => {
    const data = normalizeOwnerDashboard(null);
    expect(data.readonly).toBe(true);
    expect(data.omzet.totalRevenue).toBe(0);
    expect(data.openBills.items).toEqual([]);
    expect(data.inventory.items).toEqual([]);
    expect(data.activeShifts).toEqual([]);
    expect(data.profitLoss.netProfit).toBe(0);
  });

  test("menghitung penanda menipis bila backend tidak mengirim is_low", () => {
    const data = normalizeOwnerDashboard({
      inventory: { items: [{ id: "I-9", name: "Susu", stock: 2, min_stock: 5 }] },
    });
    expect(data.inventory.items[0].isLow).toBe(true);
  });
});

describe("ownerData.ownerRangeParams", () => {
  test("mode bulan mengirim month & year", () => {
    expect(ownerRangeParams("month", { month: 11, year: 2026 })).toEqual({ month: 11, year: 2026 });
  });

  test("mode tanggal mengirim start & end, mengabaikan nilai kosong", () => {
    expect(ownerRangeParams("range", { start: "2026-11-01", end: "2026-11-30" }))
      .toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(ownerRangeParams("range", { start: "", end: "" })).toEqual({});
  });
});

describe("ownerData.summarizeShifts", () => {
  test("menjumlahkan metrik seluruh shift aktif", () => {
    const summary = summarizeShifts([
      { totalItemsSold: 4, totalVoids: 1, promoCount: 1, pointsRedeemed: 20 },
      { totalItemsSold: 6, totalVoids: 0, promoCount: 2, pointsRedeemed: 5 },
    ]);
    expect(summary).toEqual({ waiters: 2, itemsSold: 10, voids: 1, promoCount: 3, pointsRedeemed: 25 });
  });

  test("aman untuk daftar kosong", () => {
    expect(summarizeShifts().waiters).toBe(0);
  });
});

describe("ownerData.monthLabel", () => {
  test("membentuk label bulan Indonesia", () => {
    expect(monthLabel(11, 2026)).toBe("November 2026");
    expect(monthLabel(1, 2026)).toBe("Januari 2026");
    expect(monthLabel(null, null)).toBe("-");
  });
});

// Halaman Owner harus benar-benar hanya-baca: tidak ada satu pun elemen/aksi
// yang memutasi data (ubah, tambah, hapus, void, tutup shift, opname).
describe("halaman Pantauan Pemilik bersifat read-only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "pages", "Owner.jsx"), "utf8");

  test("tidak memuat metode mutasi HTTP", () => {
    for (const forbidden of ["api.post", "api.put", "api.patch", "api.delete"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("tidak memuat aksi mutasi data", () => {
    const forbidden = [
      "Tutup Shift",
      "tutupShift",
      "opname",
      "Opname",
      "onVoid",
      "handleVoid",
      "/pay",
      "checkout",
      "Checkout",
    ];
    for (const token of forbidden) {
      expect(source).not.toContain(token);
    }
  });

  test("memanggil endpoint pantauan milik pemilik", () => {
    expect(source).toContain("/reports/owner-monitor");
  });

  test("menampilkan kelima bagian pantauan", () => {
    for (const testid of [
      "owner-section-omzet",
      "owner-section-open-bills",
      "owner-section-inventory",
      "owner-section-shifts",
      "owner-section-profit-loss",
    ]) {
      expect(source).toContain(testid);
    }
  });

  test("menampilkan kelima metrik laba-rugi", () => {
    for (const testid of [
      "owner-pl-revenue",
      "owner-pl-discount",
      "owner-pl-hpp",
      "owner-pl-expenses",
      "owner-pl-net",
    ]) {
      expect(source).toContain(testid);
    }
  });
});

// Filter periode (Bulan/Tanggal) hanya menerapkan parameter; tidak mengubah data.
describe("OwnerPeriodFilter bersifat read-only", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "components", "owner", "OwnerPeriodFilter.jsx"),
    "utf8",
  );

  test("menyediakan filter Bulan dan Tanggal", () => {
    expect(source).toContain('value="month"');
    expect(source).toContain('value="range"');
    expect(source).toContain("owner-period-filter");
  });

  test("tidak memanggil API atau metode mutasi", () => {
    expect(source).not.toContain("axios");
    expect(source).not.toContain("api.");
    expect(source).not.toContain("fetch(");
  });
});
