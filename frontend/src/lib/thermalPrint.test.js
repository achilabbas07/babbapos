import {
  buildKitchenTicketLines,
  buildOpenBillLines,
  buildPaidReceiptLines,
  incrementPrintCount,
  PRINT_LINE_WIDTH,
  printCountKey,
  readPrintCount,
  wrapPrintText,
} from "./thermalPrint";

const currency = (value) => `Rp${value}`;
const itemName = (item) => item.name || item.productName || "";

describe("thermal print templates", () => {
  const bill = {
    id: "BILL-001",
    type: "Dine In",
    waiterName: "Siti Pelayan",
    userName: "Siti Pelayan",
    total: 25000,
    items_json: [{ qty: 2, name: "Nasi Goreng Spesial", price: 12500, subtotal: 25000 }],
  };

  it("wraps every text line to 32 characters, including long words", () => {
    expect(wrapPrintText("NamaMenuSangatPanjangTanpaSpasi123456")).toEqual([
      "NamaMenuSangatPanjangTanpaSpasi1",
      "23456",
    ]);
  });

  it("adds a clear duplicate marker to subsequent paid receipts", () => {
    const lines = buildPaidReceiptLines({
      trx: { ...bill, date: "2026-10-29", method: "Cash", cashGiven: 25000, change: 0, queueNumber: "3" },
      printCount: 2,
      dateText: "29/10/2026",
      paidAtText: "29/10/2026 10:05",
      currency,
      itemName,
    });
    expect(lines[0]).toBe("DUPLIKAT");
    expect(lines[0]).toContain("DUPLIKAT");
    expect(lines[lines.length - 1]).toBe("Terima Kasih Atas Kunjungan Anda");
    expect(lines.every((line) => line.length <= PRINT_LINE_WIDTH)).toBe(true);
    expect(lines).toContain("Pelayan: Siti Pelayan");
    expect(lines).toContain("Kasir: Siti Pelayan");
    expect(lines).toContain("Status: LUNAS");
    expect(lines).toContain("No. Urut: 3");
    expect(lines).toContain("Kembalian: Rp0");
    expect(lines).toContain("Waktu bayar: 29/10/2026 10:05");
  });

  it("omits change for non-cash payments while retaining the thank-you footer", () => {
    const lines = buildPaidReceiptLines({
      trx: { ...bill, method: "QRIS", cashGiven: 25000, change: 0, queueNumber: "4" },
      printCount: 0,
      dateText: "29/10/2026 10:00",
      paidAtText: "29/10/2026 10:03",
      currency,
      itemName,
    });

    expect(lines.some((line) => line.startsWith("Bayar QRIS"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Kembalian:"))).toBe(false);
    expect(lines[lines.length - 1]).toBe("Terima Kasih Atas Kunjungan Anda");
  });

  it("prints the combined split total with each leg and derives change from the cash leg", () => {
    const lines = buildPaidReceiptLines({
      trx: {
        ...bill,
        method: "QRIS",
        total: 20000,
        payments: [
          { method: "Cash", amount: 10000 },
          { method: "QRIS", amount: 10000 },
        ],
        cashGiven: 10000,
      },
      printCount: 0,
      dateText: "29/10/2026 10:00",
      paidAtText: "29/10/2026 10:03",
      currency,
      itemName,
    });

    // Bayar = jumlah seluruh kaki (10.000 + 10.000 = 20.000), bukan porsi tunai saja.
    expect(lines).toContain("Bayar: Rp20000");
    expect(lines).toContain("Bayar Split");
    expect(lines).toContain("• Cash: Rp10000");
    expect(lines).toContain("• QRIS: Rp10000");
    // Kembalian dihitung dari total bayar gabungan (tanpa `change` dari backend → 0).
    expect(lines).toContain("Kembalian: Rp0");
    expect(lines.every((line) => line.length <= PRINT_LINE_WIDTH)).toBe(true);
  });

  it("includes open-bill details and duplicate marking", () => {
    const lines = buildOpenBillLines({
      bill,
      tableName: "A-02",
      printCount: 2,
      dateText: "29/10/2026 10:00",
      currency,
      itemName,
    });
    expect(lines[0]).toBe("DUPLIKAT");
    expect(lines).toContain("OPEN BILL");
    expect(lines).toContain("Pelayan: Siti Pelayan");
    expect(lines.every((line) => line.length <= PRINT_LINE_WIDTH)).toBe(true);
  });

  it("prints only kitchen details without adding a duplicate marker for repeat counts", () => {
    const lines = buildKitchenTicketLines({
      bill,
      tableName: "A-02",
      printCount: 3,
      dateText: "29/10/2026 10:00",
      itemName,
    });
    expect(lines[0]).toBe("ORDER DAPUR");
    expect(lines).not.toContain("DUPLIKAT");
    expect(lines).toContain("Pelayan: Siti Pelayan");
    expect(lines).toContain("No. Urut: -");
    expect(lines.some((line) => line.includes("Rp"))).toBe(false);
    expect(lines.every((line) => line.length <= PRINT_LINE_WIDTH)).toBe(true);
  });

  it("marks a kitchen ticket as duplicate only when manual reprint is requested", () => {
    const lines = buildKitchenTicketLines({
      bill,
      tableName: "A-02",
      isDuplicate: true,
      dateText: "29/10/2026 10:00",
      itemName,
    });
    expect(lines[0]).toBe("DUPLIKAT");
  });
});

describe("print count storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("tracks counts independently by document type and ID", () => {
    const receiptKey = printCountKey("receipt", "TRX-001");
    const billKey = printCountKey("bill", "BILL-001");
    expect(readPrintCount(receiptKey)).toBe(0);
    expect(incrementPrintCount(receiptKey)).toBe(1);
    expect(incrementPrintCount(receiptKey)).toBe(2);
    expect(readPrintCount(receiptKey)).toBe(2);
    expect(readPrintCount(billKey)).toBe(0);
  });
});
