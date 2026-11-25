import fs from "fs";
import path from "path";
import {
  buildPromoRecap,
  filterPromoItems,
  normalizePromoReport,
  promoCodeLabel,
} from "./promoData";

const PAYLOAD = {
  start: "2026-11-01",
  end: "2026-11-30",
  total_transactions: 2,
  total_promo_discount: 30000,
  total_transaction_value: 120000,
  promo_count: 1,
  promos: [
    { code: "GRATIS10", transactions: 2, promo_discount: 30000, transaction_value: 120000 },
  ],
  items: [
    {
      transaction_id: "TRX-20261110-0007",
      date: "2026-11-11",
      timestamp: "2026-11-10T17:30:00+00:00",
      promo_code: "GRATIS10",
      promo_discount: 10000,
      subtotal: 60000,
      discount: 10000,
      total: 50000,
      customer_name: "Budi",
      cashier: "Kasir Sari",
    },
    {
      transaction_id: "TRX-20261109-0003",
      date: "2026-11-09",
      timestamp: "2026-11-09T04:00:00+00:00",
      promo_code: "GRATIS10",
      promo_discount: 20000,
      subtotal: 90000,
      discount: 20000,
      total: 70000,
      customer_name: "",
      cashier: "Kasir Budi",
    },
  ],
};

describe("normalizePromoReport", () => {
  it("memetakan payload backend ke bentuk camelCase dengan angka aman", () => {
    const report = normalizePromoReport(PAYLOAD);
    expect(report.totalTransactions).toBe(2);
    expect(report.totalPromoDiscount).toBe(30000);
    expect(report.totalTransactionValue).toBe(120000);
    expect(report.promoCount).toBe(1);
    expect(report.promos).toHaveLength(1);
    expect(report.promos[0]).toMatchObject({ code: "GRATIS10", transactions: 2, promoDiscount: 30000 });

    const first = report.items[0];
    expect(first.transactionId).toBe("TRX-20261110-0007");
    expect(first.promoCode).toBe("GRATIS10");
    expect(first.promoDiscount).toBe(10000);
    expect(first.total).toBe(50000);
    expect(first.customerName).toBe("Budi");
    expect(first.cashier).toBe("Kasir Sari");
  });

  it("menurunkan total & rekap dari baris bila field ringkasan kosong", () => {
    const report = normalizePromoReport({ items: PAYLOAD.items });
    expect(report.totalTransactions).toBe(2);
    expect(report.totalPromoDiscount).toBe(30000);
    expect(report.totalTransactionValue).toBe(120000);
    expect(report.promos).toHaveLength(1);
    expect(report.promos[0].promoDiscount).toBe(30000);
    expect(report.promoCount).toBe(1);
  });

  it("menghasilkan struktur kosong yang aman saat data null", () => {
    const report = normalizePromoReport(null);
    expect(report.items).toEqual([]);
    expect(report.promos).toEqual([]);
    expect(report.totalTransactions).toBe(0);
    expect(report.totalPromoDiscount).toBe(0);
    expect(report.totalTransactionValue).toBe(0);
  });

  it("memberi key unik per baris meski transaction_id sama", () => {
    const report = normalizePromoReport({ items: [{ transaction_id: "X" }, { transaction_id: "X" }] });
    expect(new Set(report.items.map((r) => r.key)).size).toBe(2);
  });
});

describe("buildPromoRecap", () => {
  it("mengelompokkan baris per kode promo & mengurutkan diskon terbesar", () => {
    const items = [
      { promoCode: "KECIL", promoDiscount: 5000, total: 20000 },
      { promoCode: "BESAR", promoDiscount: 30000, total: 90000 },
      { promoCode: "BESAR", promoDiscount: 10000, total: 40000 },
      { promoCode: "", promoDiscount: 4000, total: 15000 },
    ];
    const recap = buildPromoRecap(items);
    expect(recap.map((r) => r.code)).toEqual(["BESAR", "KECIL", "-"]);
    const besar = recap.find((r) => r.code === "BESAR");
    expect(besar.transactions).toBe(2);
    expect(besar.promoDiscount).toBe(40000);
    expect(besar.transactionValue).toBe(130000);
  });

  it("aman untuk input kosong/null", () => {
    expect(buildPromoRecap(null)).toEqual([]);
    expect(buildPromoRecap([])).toEqual([]);
  });
});

describe("filterPromoItems", () => {
  const rows = [
    { transactionId: "TRX-1", promoCode: "GRATIS10", customerName: "Budi", cashier: "Sari" },
    { transactionId: "TRX-2", promoCode: "DISKON20", customerName: "Ani", cashier: "Budi" },
  ];

  it("mencocokkan no. transaksi, kode promo, pelanggan, atau kasir", () => {
    expect(filterPromoItems(rows, "gratis")).toHaveLength(1);
    expect(filterPromoItems(rows, "trx-2")).toHaveLength(1);
    expect(filterPromoItems(rows, "ani")).toHaveLength(1);
    expect(filterPromoItems(rows, "sari")).toHaveLength(1);
  });

  it("mengembalikan semua baris saat kata kunci kosong", () => {
    expect(filterPromoItems(rows, "  ")).toHaveLength(2);
    expect(filterPromoItems(rows, "")).toHaveLength(2);
  });
});

describe("promoCodeLabel", () => {
  it("menampilkan label ramah untuk kode kosong", () => {
    expect(promoCodeLabel("GRATIS10")).toBe("GRATIS10");
    expect(promoCodeLabel("")).toBe("(tanpa kode)");
    expect(promoCodeLabel("-")).toBe("(tanpa kode)");
    expect(promoCodeLabel(null)).toBe("(tanpa kode)");
  });
});

// Tidak ada React Testing Library di proyek ini, jadi verifikasi guard admin
// dilakukan dengan memeriksa sumber `PromoReport.jsx`: endpoint tidak dipanggil
// untuk non-admin (guard di dalam load) dan halaman memakai `isAdminRole`.
describe("PromoReport.jsx — guard admin & integrasi pola laporan", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "pages", "reports", "PromoReport.jsx"),
    "utf8",
  );

  it("membaca role dari sesi dan menghitung status admin", () => {
    expect(source).toContain("const { user } = useAuth();");
    expect(source).toContain("const isAdmin = isAdminRole(user);");
  });

  it("tidak memanggil endpoint promo bila bukan admin", () => {
    const guardIndex = source.indexOf("if (!isAdmin)");
    const requestIndex = source.indexOf("/reports/promo-usage");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(guardIndex);
  });

  it("memakai pola cache laporan (loadWithCache + CachedDataNotice + DateRangeFilter)", () => {
    expect(source).toContain("loadWithCache(");
    expect(source).toContain("rangeCacheKey(CACHE_KEYS.PROMO_REPORT");
    expect(source).toContain("<CachedDataNotice");
    expect(source).toContain("<DateRangeFilter");
  });
});
