// Dual-printer (Bluetooth) mapping storage.
//
// Menyimpan identitas perangkat printer yang dipilih kasir/pelayan ke
// localStorage. Sejak pemisahan transport Web Bluetooth vs native (Android),
// nilai disimpan sebagai record transport-aware:
//
//   { v: 1, t: "web" | "native", id: "<device id>", name: "<device name>" }
//
// Format lama (string id polos dari tahap 1) tetap terbaca dan diperlakukan
// sebagai perangkat web, sehingga data yang sudah tersimpan tidak hilang.
export const KITCHEN_PRINTER_KEY = "babba_printer_kitchen";
export const CASHIER_PRINTER_KEY = "babba_printer_cashier";

export const PRINTER_KEYS = {
  kitchen: KITCHEN_PRINTER_KEY,
  cashier: CASHIER_PRINTER_KEY,
};

const RECORD_VERSION = 1;

const keyFor = (kind) => {
  const key = PRINTER_KEYS[kind];
  if (!key) throw new Error(`Jenis printer tidak dikenal: ${kind}`);
  return key;
};

const storage = () => (typeof window !== "undefined" ? window.localStorage : null);

const normalize = (value) => (typeof value === "string" ? value.trim() : String(value ?? "").trim());

const normalizeTransport = (value) => (value === "native" ? "native" : "web");

// Parser toleran: menerima format baru (JSON) maupun format lama (string id
// polos). String lama dianggap sebagai perangkat web tanpa nama.
const parseRecord = (raw) => {
  const value = normalize(raw);
  if (!value) return null;
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      const id = normalize(parsed?.id);
      if (id) {
        return { transport: normalizeTransport(parsed?.t), id, name: normalize(parsed?.name) };
      }
    } catch {
      // Bukan JSON valid: perlakukan sebagai id format lama di bawah.
    }
  }
  return { transport: "web", id: value, name: "" };
};

const serialize = (record) => JSON.stringify({
  v: RECORD_VERSION,
  t: normalizeTransport(record.transport),
  id: record.id,
  name: record.name || "",
});

export const getPrinterRecord = (kind) => {
  const key = keyFor(kind);
  try {
    return parseRecord(storage()?.getItem(key));
  } catch (error) {
    console.error(`Gagal membaca pengaturan printer ${key}`, error);
    return null;
  }
};

export const getPrinterId = (kind) => getPrinterRecord(kind)?.id || "";

export const setPrinterRecord = (kind, record = {}) => {
  const key = keyFor(kind);
  const id = normalize(record?.id);
  try {
    if (id) {
      storage()?.setItem(key, serialize({
        id,
        name: normalize(record?.name),
        transport: record?.transport,
      }));
    } else {
      storage()?.removeItem(key);
    }
  } catch (error) {
    console.error(`Gagal menyimpan pengaturan printer ${key}`, error);
  }
  return id;
};

// Terima string id (kompatibel dengan pemanggil lama) maupun record penuh.
export const setPrinterId = (kind, value) => (
  setPrinterRecord(kind, typeof value === "object" && value !== null ? value : { id: value })
);

export const clearPrinterId = (kind) => setPrinterRecord(kind, {});

export const getKitchenPrinterId = () => getPrinterId("kitchen");
export const getCashierPrinterId = () => getPrinterId("cashier");
export const getKitchenPrinterRecord = () => getPrinterRecord("kitchen");
export const getCashierPrinterRecord = () => getPrinterRecord("cashier");
export const setKitchenPrinterId = (value) => setPrinterId("kitchen", value);
export const setCashierPrinterId = (value) => setPrinterId("cashier", value);
export const setKitchenPrinterRecord = (record) => setPrinterRecord("kitchen", record);
export const setCashierPrinterRecord = (record) => setPrinterRecord("cashier", record);
export const clearKitchenPrinterId = () => clearPrinterId("kitchen");
export const clearCashierPrinterId = () => clearPrinterId("cashier");

// Prefer the stable per-origin Web Bluetooth device id, fall back to the
// advertised name when an id is unavailable.
export const resolveDeviceId = (device) => normalize(device?.id) || normalize(device?.name);
