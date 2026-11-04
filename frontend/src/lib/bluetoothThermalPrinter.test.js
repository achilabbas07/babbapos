import {
  buildBluetoothReceiptLines,
  buildBluetoothShiftReportLines,
  buildEscPosReceipt,
  convertImageToESCPOS,
  formatLine,
  printBluetoothReceipt,
  printJustify,
  RPP02_CHARACTERISTIC_UUID,
  RPP02_SERVICE_UUID,
  wordWrapCenter,
} from "./bluetoothThermalPrinter";

describe("Bluetooth ESC/POS receipts", () => {
  it("builds the close-shift report and adds the reprint marker beside its ID", () => {
    const shift = {
      id: "SHIFT-20261030-001",
      userName: "Kasir Pagi",
      openedAt: "2026-10-30T01:00:00+08:00",
      closedAt: "2026-10-30T09:00:00+08:00",
      trxCount: 12,
      openingCash: 100000,
      cashSales: 250000,
      nonCashSales: 75000,
      cashIn: 10000,
      cashOut: 5000,
      expectedCash: 355000,
      countedCash: 350000,
      difference: -5000,
    };
    const lines = buildBluetoothShiftReportLines(shift);
    const reprintLines = buildBluetoothShiftReportLines(shift, { reprint: true });

    expect(lines.slice(0, 5).map(({ text, type }) => [text, type])).toEqual([
      ["WARKOP BABBA", "center"],
      ["Jl. Ujung No. 65, Makassar", "center"],
      ["Telp. 0853 9886 3700", "center"],
      ["================================", "text"],
      ["LAPORAN TUTUP SHIFT", "center"],
    ]);
    expect(lines[5].text).toBe(shift.id);
    expect(lines.map(({ text }) => text)).toContain("Penjualan tunai       Rp 250.000");
    expect(lines.find(({ text }) => text.includes("Total penjualan"))).toMatchObject({ bold: true });
    const expectedBalanceLabelIndex = lines.findIndex(({ text }) => text === "Saldo akhir (seharusnya)");
    expect(lines[expectedBalanceLabelIndex]).toMatchObject({ bold: true, type: "justify" });
    expect(lines[expectedBalanceLabelIndex - 1]).toMatchObject({ type: "blank" });
    expect(lines[expectedBalanceLabelIndex + 1]).toMatchObject({
      text: "                      Rp 355.000",
      bold: true,
      type: "justify",
    });
    expect(reprintLines[5].text).toContain(shift.id);
    expect(reprintLines[5].text).toContain("CETAK ULANG");
    expect(reprintLines[5].bold).toBe(true);

    const openShiftLines = buildBluetoothShiftReportLines({ ...shift, countedCash: null, difference: null });
    expect(openShiftLines.find(({ text }) => text.startsWith("Uang fisik"))?.text.trimEnd()).toMatch(/-$/);
    expect(openShiftLines.find(({ text }) => text.startsWith("Selisih"))?.text.trimEnd()).toMatch(/-$/);
  });

  it("justifies shift rows to the exact character width", () => {
    const line = printJustify("Penjualan non-tunai", "Rp   64.000");
    expect(Array.from(line)).toHaveLength(32);
    expect(line.startsWith("Penjualan non-tunai")).toBe(true);
    expect(line.endsWith("Rp   64.000")).toBe(true);
  });

  it("builds a centered kitchen ticket with fixed-position metadata and indented notes", () => {
    const lines = buildBluetoothReceiptLines("kitchen", {
      id: "ORD-001",
      tableName: "A-02",
      orderTime: "29/10/2026 09:55",
      time: "29/10/2026 10:00",
      queueNumber: "7",
      waiter: "Siti",
      items: [{ qty: 2, name: "Mie Goreng", note: "Tidak pedas" }],
    });

    expect(lines[0]).toMatchObject({ text: "DAPUR", type: "center" });
    expect(lines.map(({ text }) => text)).toContain("No Nota    : ORD-001");
    expect(lines.map(({ text }) => text)).toContain("Waktu      : 29/10/2026 09:55");
    expect(lines.map(({ text }) => text)).toContain("No Urut    : 7");
    expect(lines.map(({ text }) => text)).toContain("Order      : Siti");
    expect(lines.map(({ text }) => text)).toContain("Nomor Meja : A-02");
    expect(lines.map(({ text }) => text)).toContain("  Tidak pedas");
    expect(lines[lines.length - 2]).toEqual({ type: "center", text: "29/10/2026 09:55" });
  });

  it("uses the addon header and places duplicate markers below receipt headers", () => {
    const addon = buildBluetoothReceiptLines("kitchen", {
      isAddOn: true,
      isDuplicate: true,
      items: [],
    });
    expect(addon[0]).toMatchObject({ type: "center", text: "TAMBAHAN ORDER" });
    expect(addon[1]).toMatchObject({ type: "center", text: "*** DUPLIKAT ***", bold: true });

    const payment = buildBluetoothReceiptLines("payment", {
      isDuplicate: true,
      profile: { nama_usaha: "Warkop Babba" },
      items: [],
    });
    expect(payment[1]).toMatchObject({ type: "center", text: "*** DUPLIKAT ***", bold: true });

    const bill = buildBluetoothReceiptLines("bill", { isDuplicate: true, items: [] });
    expect(bill[1]).toMatchObject({ type: "center", text: "*** DUPLIKAT ***", bold: true });
  });

  it("builds payment profile, item, totals, and footer rows", () => {
    const lines = buildBluetoothReceiptLines("payment", {
      id: "TRX-001",
      orderTime: "29/10/2026 09:55",
      paidAt: "29/10/2026 10:00",
      paymentMethod: "Cash",
      queueNumber: "9",
      cashier: "Siti",
      customerName: "Budi",
      tableName: "A-02",
      items: [
        { id: "line-1", productId: "kopi", qty: 1, name: "Kopi Susu", price: 12500, subtotal: 12500, is_printed: true },
        { id: "line-2", productId: "kopi", qty: 1, name: "Kopi Susu", price: 12500, subtotal: 12500, is_printed: false },
      ],
      subtotal: 25000,
      total: 25000,
      cashGiven: 30000,
      change: 5000,
      profile: {
        nama_usaha: "Warkop Babba",
        alamat: "Jl. Contoh yang sangat panjang untuk diuji",
        kota: "Makassar",
        telepon: "08123456789",
      },
    });
    const text = lines.map(({ text }) => text);

    expect(lines[0]).toMatchObject({ type: "center", text: "Warkop Babba", bold: true });
    expect(text.some((line) => line.includes("Jl. Contoh yang sangat panjang"))).toBe(true);
    expect(text).toContain("No Nota    : TRX-001");
    expect(text).toContain("Waktu      : 29/10/2026 09:55");
    expect(text).toContain("No Urut    : 9");
    expect(text.some((line) => line.includes("Bayar Cash"))).toBe(true);
    expect(text.some((line) => line.includes("Terbayar  29/10/2026 10:00"))).toBe(true);
    expect(text.some((line) => line.startsWith("Kembalian") && line.includes("Rp 5.000"))).toBe(true);
    expect(text).toContain("Order      : Siti");
    expect(text).toContain("Customer   : Budi");
    expect(text).toContain("Nomor Meja : A-02");
    expect(text.filter((line) => line.startsWith("2 Kopi Susu"))).toHaveLength(1);
    expect(text.some((line) => line.includes("Subtotal 2 Produk"))).toBe(true);
    expect(text.some((line) => line.includes("Rp 25.000"))).toBe(true);
    expect(text).toContain("Terima Kasih Atas Kunjungan Anda");
    expect(text[text.length - 1]).toBe("dicetak: Siti");
  });

  it("prints dynamic payment method without a change row for QRIS", () => {
    const lines = buildBluetoothReceiptLines("payment", {
      paymentMethod: "QRIS",
      cashGiven: 25000,
      change: 0,
      items: [],
    }).map(({ text }) => text);

    expect(lines.some((line) => line.includes("Bayar QRIS"))).toBe(true);
    expect(lines.some((line) => line.includes("Kembalian"))).toBe(false);
  });

  it("wraps centered text and formats left-right rows to 32 characters", () => {
    expect(wordWrapCenter("Alamat usaha dengan teks yang cukup panjang")).toEqual([
      "Alamat usaha dengan teks yang",
      "cukup panjang",
    ]);
    expect(formatLine("2 Kopi Susu", "Rp 25.000")).toHaveLength(32);
  });

  it("wraps long item names without shifting the price column", () => {
    const lines = buildBluetoothReceiptLines("payment", {
      paymentMethod: "Cash",
      items: [{
        qty: 1,
        name: "Nasi Goreng Spesial dengan Sambal Matah",
        price: 35000,
        subtotal: 35000,
      }],
    }).map(({ text }) => text);
    const itemStart = lines.findIndex((line) => line.startsWith("1 Nasi Goreng"));
    const itemLines = lines.slice(itemStart, itemStart + 2);

    expect(itemLines).toHaveLength(2);
    expect(itemLines[0]).toHaveLength(32);
    expect(itemLines[0].endsWith("Rp 35.000")).toBe(true);
    expect(itemLines.slice(1).every((line) => line.length <= 32)).toBe(true);
    expect(itemLines[0]).toContain("Spesial");
    expect(itemLines[1]).toContain("dengan Sambal Matah");
  });

  it("includes alignment, initialization, and auto-cut ESC/POS commands", async () => {
    const bytes = await buildEscPosReceipt("kitchen", { items: [] });

    expect(Array.from(bytes.slice(0, 9))).toEqual([
      0x1b, 0x40, 0x1d, 0x4c, 0x00, 0x00, 0x1b, 0x61, 0x01,
    ]);
    expect(Array.from(bytes.slice(-6))).toEqual([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]);
  });

  it("rejects unsupported receipt types", () => {
    expect(() => buildBluetoothReceiptLines("other", {})).toThrow("Jenis cetak tidak dikenal");
  });

  it("prints an open bill without marking it as paid", () => {
    const lines = buildBluetoothReceiptLines("bill", {
      id: "BILL-001",
      tableName: "A-02",
      time: "29/10/2026",
      waiter: "Siti",
      items: [
        { id: "line-1", productId: "kopi", qty: 1, name: "Kopi Susu", price: 12000, subtotal: 12000, is_printed: true },
        { id: "line-2", productId: "kopi", qty: 1, name: "Kopi Susu", price: 12000, subtotal: 12000, is_printed: false },
      ],
      total: 24000,
    });
    const text = lines.map(({ text }) => text);

    expect(text).toContain("OPEN BILL");
    expect(text).toContain("No Bill    : BILL-001");
    expect(text.filter((line) => line.includes("2 Kopi Susu") && line.includes("Rp 24.000"))).toHaveLength(1);
    expect(text).toContain("Belum lunas");
    expect(text.some((line) => line.includes("LUNAS"))).toBe(false);
  });

  it("keeps kitchen ticket lines ungrouped and preserves printed flags", () => {
    const items = [
      { id: "line-1", productId: "kopi", qty: 1, name: "Kopi Susu", is_printed: true },
      { id: "line-2", productId: "kopi", qty: 1, name: "Kopi Susu", is_printed: false },
    ];
    const lines = buildBluetoothReceiptLines("kitchen", { items });

    expect(lines.filter(({ text }) => text.includes("Kopi Susu"))).toHaveLength(2);
    expect(items.map(({ is_printed }) => is_printed)).toEqual([true, false]);
  });

  it("skips a logo when image loading fails", async () => {
    const originalImage = global.Image;
    global.Image = class {
      set src(_value) {
        this.onerror();
      }
    };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(convertImageToESCPOS("https://example.test/logo.png")).resolves.toEqual(new Uint8Array());
    global.Image = originalImage;
    warn.mockRestore();
  });

  it("converts a monochrome canvas image to a GS v 0 raster command", async () => {
    const originalImage = global.Image;
    const originalCreateElement = document.createElement.bind(document);
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
    const context = {
      fillRect: jest.fn(),
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data: pixels })),
    };
    const canvas = {
      getContext: jest.fn(() => context),
      width: 0,
      height: 0,
    };

    global.Image = class {
      naturalWidth = 8;
      naturalHeight = 1;
      set src(_value) {
        this.onload();
      }
    };
    const createElement = jest.spyOn(document, "createElement").mockImplementation((tagName) => (
      tagName === "canvas" ? canvas : originalCreateElement(tagName)
    ));

    try {
      const bytes = await convertImageToESCPOS("https://example.test/logo.png");
      expect(Array.from(bytes)).toEqual([0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0x80]);
      expect(context.drawImage).toHaveBeenCalled();
    } finally {
      global.Image = originalImage;
      createElement.mockRestore();
    }
  });

  it("reuses the Bluetooth device and reconnects without another pairing prompt", async () => {
    const writes = [];
    const characteristic = {
      properties: { writeWithoutResponse: true },
      writeValueWithoutResponse: jest.fn(async (chunk) => writes.push(chunk)),
    };
    const device = {
      gatt: {
        connected: false,
        connect: jest.fn(async function connect() {
          this.connected = true;
          return this;
        }),
        getPrimaryService: jest.fn(async () => ({
          getCharacteristic: jest.fn(async (uuid) => {
            expect(uuid).toBe(RPP02_CHARACTERISTIC_UUID);
            return characteristic;
          }),
        })),
      },
    };
    const bluetooth = { requestDevice: jest.fn(async () => device) };
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: bluetooth,
    });

    const printPromise = printBluetoothReceipt("kitchen", {
      tableName: "A-02",
      time: "29/10/2026",
      items: [{ qty: 1, name: "Nasi Goreng" }],
    });
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    await printPromise;

    expect(bluetooth.requestDevice).toHaveBeenCalledWith({
      acceptAllDevices: true,
      optionalServices: [RPP02_SERVICE_UUID],
    });
    expect(device.gatt.getPrimaryService).toHaveBeenCalledWith(RPP02_SERVICE_UUID);
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every((chunk) => chunk.byteLength <= 20)).toBe(true);

    await printBluetoothReceipt("kitchen", { items: [] });
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);

    device.gatt.connected = false;
    await printBluetoothReceipt("kitchen", { items: [] });
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    expect(device.gatt.connect).toHaveBeenCalledTimes(2);
    await printBluetoothReceipt("shift", { items: [], id: "SHIFT-001" }, { requireConnectedDevice: true });
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    delete navigator.bluetooth;
  });

  it("builds shift reports as ESC/POS with center alignment, justification and bold commands", async () => {
    const bytes = await buildEscPosReceipt("shift", {
      id: "SHIFT-001",
      isReprint: true,
      userName: "Kasir",
      openedAt: "2026-10-30T01:00:00+08:00",
      closedAt: "2026-10-30T09:00:00+08:00",
      trxCount: 1,
      openingCash: 0,
      cashSales: 10000,
      nonCashSales: 0,
      cashIn: 0,
      cashOut: 0,
      expectedCash: 10000,
      countedCash: 10000,
      difference: 0,
    });

    expect(Array.from(bytes)).toContain(0x1b);
    expect(String.fromCharCode(...bytes)).toContain("CETAK ULANG");
    expect(Array.from(bytes)).toContain(0x45);
  });
});
