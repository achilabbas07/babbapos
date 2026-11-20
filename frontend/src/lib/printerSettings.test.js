import {
  CASHIER_PRINTER_KEY,
  KITCHEN_PRINTER_KEY,
  PRINTER_KEYS,
  clearCashierPrinterId,
  clearKitchenPrinterId,
  getCashierPrinterId,
  getKitchenPrinterId,
  getPrinterId,
  getPrinterRecord,
  resolveDeviceId,
  setCashierPrinterId,
  setKitchenPrinterId,
  setPrinterId,
  setPrinterRecord,
} from "./printerSettings";

describe("printer settings storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("exposes the required localStorage keys", () => {
    expect(KITCHEN_PRINTER_KEY).toBe("babba_printer_kitchen");
    expect(CASHIER_PRINTER_KEY).toBe("babba_printer_cashier");
    expect(PRINTER_KEYS).toEqual({
      kitchen: "babba_printer_kitchen",
      cashier: "babba_printer_cashier",
    });
  });

  it("persists kitchen and cashier printers independently", () => {
    setKitchenPrinterId("device-kitchen");
    setCashierPrinterId("device-cashier");

    expect(JSON.parse(window.localStorage.getItem(KITCHEN_PRINTER_KEY))).toMatchObject({
      t: "web",
      id: "device-kitchen",
    });
    expect(JSON.parse(window.localStorage.getItem(CASHIER_PRINTER_KEY))).toMatchObject({
      t: "web",
      id: "device-cashier",
    });
    expect(getKitchenPrinterId()).toBe("device-kitchen");
    expect(getCashierPrinterId()).toBe("device-cashier");
  });

  it("stores transport and name for native devices", () => {
    setPrinterRecord("kitchen", { id: "AA:BB:CC:DD:EE:FF", name: "RPP02", transport: "native" });

    expect(getPrinterRecord("kitchen")).toEqual({
      transport: "native",
      id: "AA:BB:CC:DD:EE:FF",
      name: "RPP02",
    });
    expect(getKitchenPrinterId()).toBe("AA:BB:CC:DD:EE:FF");
  });

  it("keeps reading the legacy plain-string format as a web device", () => {
    window.localStorage.setItem(KITCHEN_PRINTER_KEY, "LEGACY-DEVICE");

    expect(getKitchenPrinterId()).toBe("LEGACY-DEVICE");
    expect(getPrinterRecord("kitchen")).toEqual({
      transport: "web",
      id: "LEGACY-DEVICE",
      name: "",
    });
  });

  it("returns an empty string when nothing is stored", () => {
    expect(getKitchenPrinterId()).toBe("");
    expect(getCashierPrinterId()).toBe("");
  });

  it("trims stored values", () => {
    setPrinterId("kitchen", "  padded-id  ");
    expect(getPrinterId("kitchen")).toBe("padded-id");
  });

  it("removes the key when the value is blank", () => {
    setKitchenPrinterId("device-kitchen");
    setKitchenPrinterId("   ");
    expect(window.localStorage.getItem(KITCHEN_PRINTER_KEY)).toBeNull();
    expect(getKitchenPrinterId()).toBe("");
  });

  it("clears each printer independently", () => {
    setKitchenPrinterId("k");
    setCashierPrinterId("c");
    clearKitchenPrinterId();
    expect(getKitchenPrinterId()).toBe("");
    expect(getCashierPrinterId()).toBe("c");
    clearCashierPrinterId();
    expect(getCashierPrinterId()).toBe("");
  });

  it("rejects unknown printer kinds", () => {
    expect(() => getPrinterId("unknown")).toThrow("Jenis printer tidak dikenal");
  });

  it("prefers the device id and falls back to the device name", () => {
    expect(resolveDeviceId({ id: "abc-123", name: "RPP02" })).toBe("abc-123");
    expect(resolveDeviceId({ id: "", name: "RPP02" })).toBe("RPP02");
    expect(resolveDeviceId(null)).toBe("");
  });
});
