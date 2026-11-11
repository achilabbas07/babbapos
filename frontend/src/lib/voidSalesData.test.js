import {
  filterVoidSalesItems,
  normalizeVoidSalesReport,
  voidSalesDisplayName,
} from "./voidSalesData";

describe("normalizeVoidSalesReport", () => {
  const payload = {
    total_voids: 2,
    total_items: 3,
    total_qty: 8,
    total_value: 55000,
    items: [
      {
        void_id: "VOID-002",
        bill_id: "BILL-020",
        date: "2026-11-11",
        timestamp: "2026-11-10T17:30:00+00:00",
        table_id: "T2",
        table_name: "Meja 2",
        product_name: "Es Teh",
        variant_name: "",
        qty: 2,
        value: 10000,
        cashier: "Kasir Sari",
        authorized_by: "Admin",
        reason: "Salah input",
      },
      {
        void_id: "VOID-001",
        bill_id: "BILL-010",
        date: "2026-11-09",
        table_name: "Meja 1",
        product_name: "Kopi",
        variant_name: "Panas",
        qty: 1,
        value: 20000,
        cashier: "Kasir Budi",
        reason: "Pelanggan batal",
      },
    ],
  };

  it("memetakan baris dan menormalkan tipe angka", () => {
    const report = normalizeVoidSalesReport(payload);
    expect(report.items).toHaveLength(2);
    expect(report.items[0].tableName).toBe("Meja 2");
    expect(report.items[0].cashier).toBe("Kasir Sari");
    expect(report.items[1].variantName).toBe("Panas");
    expect(report.items[1].qty).toBe(1);
    expect(report.items[1].value).toBe(20000);
  });

  it("memberi key unik per baris", () => {
    const report = normalizeVoidSalesReport(payload);
    expect(new Set(report.items.map((r) => r.key)).size).toBe(2);
  });

  it("memakai ringkasan dari backend", () => {
    const report = normalizeVoidSalesReport(payload);
    expect(report.totalVoids).toBe(2);
    expect(report.totalItems).toBe(3);
    expect(report.totalQty).toBe(8);
    expect(report.totalValue).toBe(55000);
  });

  it("menghitung total dari baris bila ringkasan kosong", () => {
    const report = normalizeVoidSalesReport({
      items: [{ product_name: "Teh", qty: 3, value: 15000 }],
    });
    expect(report.totalQty).toBe(3);
    expect(report.totalValue).toBe(15000);
    expect(report.totalItems).toBe(1);
  });

  it("aman saat payload kosong / tidak valid", () => {
    const report = normalizeVoidSalesReport(null);
    expect(report.items).toEqual([]);
    expect(report.totalVoids).toBe(0);
    expect(report.totalQty).toBe(0);
    expect(report.totalValue).toBe(0);
  });
});

describe("filterVoidSalesItems", () => {
  const report = normalizeVoidSalesReport({
    items: [
      { product_name: "Kopi Susu", table_name: "Meja 1", cashier: "Sari", qty: 1, value: 20000 },
      { product_name: "Nasi Goreng", variant_name: "Pedas", table_name: "Meja 5", cashier: "Budi", qty: 2, value: 30000 },
    ],
  });

  it("mencari berdasarkan nama produk (case-insensitive)", () => {
    expect(filterVoidSalesItems(report.items, "kopi").map((r) => r.productName)).toEqual(["Kopi Susu"]);
  });

  it("mencari berdasarkan meja dan kasir", () => {
    expect(filterVoidSalesItems(report.items, "meja 5").map((r) => r.productName)).toEqual(["Nasi Goreng"]);
    expect(filterVoidSalesItems(report.items, "budi").map((r) => r.productName)).toEqual(["Nasi Goreng"]);
  });

  it("mengembalikan semua baris saat kata kunci kosong", () => {
    expect(filterVoidSalesItems(report.items, "  ")).toHaveLength(2);
  });
});

describe("voidSalesDisplayName", () => {
  it("menyertakan varian bila ada", () => {
    expect(voidSalesDisplayName({ productName: "Nasi Goreng", variantName: "Pedas" })).toBe("Nasi Goreng - Pedas");
    expect(voidSalesDisplayName({ productName: "Kopi", variantName: "" })).toBe("Kopi");
  });
});
