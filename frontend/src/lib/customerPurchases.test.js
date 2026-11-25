import {
  canViewCustomerPurchases,
  customerPurchaseCellValue,
  customerPurchaseColumns,
  customerPurchasesCacheKey,
  formatLocalDate,
  formatWitaTime,
  normalizeCustomerPurchases,
  summarizeCustomerPurchases,
  WITA_TIME_ZONE,
} from "./customerPurchases";

describe("formatLocalDate", () => {
  it("formats a WITA calendar date for display", () => {
    expect(formatLocalDate("2026-11-11")).toBe("11 Nov 2026");
  });

  it("falls back to the raw value when it is not a YYYY-MM-DD date", () => {
    expect(formatLocalDate("")).toBe("-");
    expect(formatLocalDate("bukan-tanggal")).toBe("bukan-tanggal");
  });
});

describe("formatWitaTime", () => {
  it("shows the WITA wall clock regardless of the device time zone", () => {
    // 18:30 UTC == 02:30 WITA keesokan harinya.
    expect(formatWitaTime("2026-11-10T18:30:00+00:00")).toBe("02.30");
    expect(WITA_TIME_ZONE).toBe("Asia/Makassar");
  });

  it("returns a dash for missing or invalid values", () => {
    expect(formatWitaTime(null)).toBe("-");
    expect(formatWitaTime("nope")).toBe("-");
  });
});

describe("customerPurchasesCacheKey", () => {
  it("scopes the cache key per customer and range", () => {
    expect(customerPurchasesCacheKey("CUST-1")).toBe("customers/purchases/CUST-1");
    expect(customerPurchasesCacheKey("CUST-1", { start: "2026-11-01", end: "" }))
      .toBe("customers/purchases/CUST-1?start=2026-11-01");
  });
});

describe("canViewCustomerPurchases (admin-only)", () => {
  it("allows only the admin role", () => {
    expect(canViewCustomerPurchases({ role: "admin" })).toBe(true);
    expect(canViewCustomerPurchases({ role: "kasir" })).toBe(false);
    expect(canViewCustomerPurchases({ role: "waiter" })).toBe(false);
  });

  it("denies when there is no user", () => {
    expect(canViewCustomerPurchases(null)).toBe(false);
    expect(canViewCustomerPurchases(undefined)).toBe(false);
    expect(canViewCustomerPurchases({})).toBe(false);
  });
});

describe("normalizeCustomerPurchases", () => {
  it("maps the payload to the seven display fields with safe fallbacks", () => {
    const rows = normalizeCustomerPurchases([
      { id: "T1", tanggal: "2026-11-11", waktuOrder: "x", waktuBayar: "y", meja: "  ", totalItem: "6", jumlah: 45000, pelayan: "" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      key: "T1", tanggal: "2026-11-11", waktuOrder: "x", waktuBayar: "y",
      meja: "-", totalItem: 6, jumlah: 45000, pelayan: "-", void: false,
    });
  });

  it("tolerates non-array payloads", () => {
    expect(normalizeCustomerPurchases(null)).toEqual([]);
    expect(normalizeCustomerPurchases({})).toEqual([]);
  });
});

describe("customerPurchaseColumns", () => {
  it("lists exactly the seven requested columns in order", () => {
    expect(customerPurchaseColumns().map((c) => c.key)).toEqual([
      "tanggal", "waktuOrder", "waktuBayar", "meja", "totalItem", "jumlah", "pelayan",
    ]);
  });
});

describe("customerPurchaseCellValue", () => {
  const row = {
    tanggal: "2026-11-11",
    waktuOrder: "2026-11-10T18:30:00+00:00",
    waktuBayar: "2026-11-10T18:45:00+00:00",
    meja: "Meja 1",
    totalItem: 6,
    jumlah: 45000,
    pelayan: "Budi",
  };
  const rp = (v) => `Rp ${v}`;

  it("formats each of the seven columns", () => {
    expect(customerPurchaseCellValue("tanggal", row, rp)).toBe("11 Nov 2026");
    expect(customerPurchaseCellValue("waktuOrder", row, rp)).toBe("02.30");
    expect(customerPurchaseCellValue("waktuBayar", row, rp)).toBe("02.45");
    expect(customerPurchaseCellValue("meja", row, rp)).toBe("Meja 1");
    expect(customerPurchaseCellValue("totalItem", row, rp)).toBe("6");
    expect(customerPurchaseCellValue("jumlah", row, rp)).toBe("Rp 45000");
    expect(customerPurchaseCellValue("pelayan", row, rp)).toBe("Budi");
  });

  it("returns a dash for an unknown column", () => {
    expect(customerPurchaseCellValue("nope", row, rp)).toBe("-");
  });
});

describe("summarizeCustomerPurchases", () => {
  it("totals transactions, items, and amount", () => {
    const summary = summarizeCustomerPurchases([{ totalItem: 6, jumlah: 45000 }, { totalItem: 2, jumlah: 15000 }]);
    expect(summary).toEqual({ count: 2, totalItem: 8, total: 60000 });
  });

  it("handles empty input", () => {
    expect(summarizeCustomerPurchases([])).toEqual({ count: 0, totalItem: 0, total: 0 });
  });
});
