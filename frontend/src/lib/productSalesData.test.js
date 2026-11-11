import {
  filterProductSalesItems,
  normalizeProductSalesReport,
  productSalesDisplayName,
} from "./productSalesData";

describe("normalizeProductSalesReport", () => {
  const payload = {
    total_qty: 7,
    gross_sales: 130000,
    transaction_count: 3,
    items: [
      { productId: "P1", name: "Kopi", variantId: null, variantName: "", category: "Minuman", qty: 2, revenue: 20000, contribution: 15.38 },
      { productId: "P2", name: "Nasi Goreng", variantId: 5, variantName: "Pedas", category: "Makanan", qty: 5, revenue: 110000, contribution: 84.62 },
    ],
  };

  it("mengurutkan dari qty tertinggi dan menjumlahkan total", () => {
    const report = normalizeProductSalesReport(payload);
    expect(report.items.map((r) => r.name)).toEqual(["Nasi Goreng", "Kopi"]);
    expect(report.items[0].qty).toBe(5);
    expect(report.totalQty).toBe(7);
    expect(report.grossSales).toBe(130000);
    expect(report.itemCount).toBe(2);
  });

  it("memberi key unik per produk+varian", () => {
    const report = normalizeProductSalesReport(payload);
    expect(new Set(report.items.map((r) => r.key)).size).toBe(2);
    expect(report.items.find((r) => r.name === "Nasi Goreng").key).toBe("P2:5");
  });

  it("menghitung total dari baris bila ringkasan kosong", () => {
    const report = normalizeProductSalesReport({ items: [{ name: "Teh", qty: 3, revenue: 15000 }] });
    expect(report.totalQty).toBe(3);
    expect(report.grossSales).toBe(15000);
  });

  it("aman saat payload kosong / tidak valid", () => {
    const report = normalizeProductSalesReport(null);
    expect(report.items).toEqual([]);
    expect(report.totalQty).toBe(0);
    expect(report.grossSales).toBe(0);
  });

  it("memakai qty sebagai kunci utama lalu omzet sebagai tie-breaker", () => {
    const report = normalizeProductSalesReport({
      items: [
        { name: "A", qty: 2, revenue: 5000 },
        { name: "B", qty: 2, revenue: 9000 },
      ],
    });
    expect(report.items.map((r) => r.name)).toEqual(["B", "A"]);
  });
});

describe("filterProductSalesItems", () => {
  const report = normalizeProductSalesReport({
    items: [
      { productId: "P1", name: "Kopi Susu", category: "Minuman", qty: 4, revenue: 40000 },
      { productId: "P2", name: "Nasi Goreng", variantName: "Pedas", category: "Makanan", qty: 2, revenue: 30000 },
    ],
  });

  it("mencari berdasarkan nama produk (case-insensitive)", () => {
    expect(filterProductSalesItems(report.items, "kopi").map((r) => r.name)).toEqual(["Kopi Susu"]);
  });

  it("mencari berdasarkan varian dan kategori", () => {
    expect(filterProductSalesItems(report.items, "pedas").map((r) => r.name)).toEqual(["Nasi Goreng"]);
    expect(filterProductSalesItems(report.items, "makanan").map((r) => r.name)).toEqual(["Nasi Goreng"]);
  });

  it("mengembalikan semua baris saat kata kunci kosong", () => {
    expect(filterProductSalesItems(report.items, "  ")).toHaveLength(2);
  });
});

describe("productSalesDisplayName", () => {
  it("menyertakan varian bila ada", () => {
    expect(productSalesDisplayName({ name: "Nasi Goreng", variantName: "Pedas" })).toBe("Nasi Goreng - Pedas");
    expect(productSalesDisplayName({ name: "Kopi", variantName: "" })).toBe("Kopi");
  });
});
