import {
  OPEN_BILLS_CHANGED_EVENT,
  OPEN_BILLS_POLL_MS,
  notifyOpenBillsChanged,
  parseOpenBillCount,
  subscribeToOpenBillsChanged,
} from "./openBillCount";

describe("parseOpenBillCount", () => {
  it("menghitung jumlah dari daftar bill (endpoint GET /open-bills)", () => {
    expect(parseOpenBillCount([{ id: "BILL-1" }, { id: "BILL-2" }])).toBe(2);
  });

  it("mengembalikan 0 untuk daftar kosong", () => {
    expect(parseOpenBillCount([])).toBe(0);
  });

  it("menerima bentuk ringkasan objek bila backend mengembalikannya", () => {
    expect(parseOpenBillCount({ count: 5 })).toBe(5);
    expect(parseOpenBillCount({ total: 3 })).toBe(3);
    expect(parseOpenBillCount({ open_count: 7 })).toBe(7);
  });

  it("aman terhadap data tak terduga (null/undefined/teks)", () => {
    expect(parseOpenBillCount(null)).toBe(0);
    expect(parseOpenBillCount(undefined)).toBe(0);
    expect(parseOpenBillCount("bukan angka")).toBe(0);
    expect(parseOpenBillCount({ total: -4 })).toBe(0);
  });

  it("membulatkan nilai pecahan dari backend", () => {
    expect(parseOpenBillCount({ total: 2.9 })).toBe(2);
  });
});

describe("event bus open bill", () => {
  it("mengumumkan nama event dan interval polling yang stabil", () => {
    expect(OPEN_BILLS_CHANGED_EVENT).toBe("babbapos:open-bills-changed");
    expect(OPEN_BILLS_POLL_MS).toBeGreaterThanOrEqual(15000);
    expect(OPEN_BILLS_POLL_MS).toBeLessThanOrEqual(30000);
  });

  it("memanggil handler saat notify dipanggil dan berhenti setelah unsubscribe", () => {
    const handler = jest.fn();
    const unsubscribe = subscribeToOpenBillsChanged(handler);

    notifyOpenBillsChanged();
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    notifyOpenBillsChanged();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("mengembalikan no-op yang aman untuk handler tidak valid", () => {
    const unsubscribe = subscribeToOpenBillsChanged(null);
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });
});
