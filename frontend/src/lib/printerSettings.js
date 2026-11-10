// Dual-printer (Bluetooth) mapping storage.
//
// Tahap 1 hanya menyimpan ID perangkat printer yang dipilih kasir/pelayan ke
// localStorage. Belum ada perubahan pada alur cetak struk kasir maupun tiket
// dapur — helper ini murni untuk registrasi identitas printer.
export const KITCHEN_PRINTER_KEY = "babba_printer_kitchen";
export const CASHIER_PRINTER_KEY = "babba_printer_cashier";

export const PRINTER_KEYS = {
  kitchen: KITCHEN_PRINTER_KEY,
  cashier: CASHIER_PRINTER_KEY,
};

const keyFor = (kind) => {
  const key = PRINTER_KEYS[kind];
  if (!key) throw new Error(`Jenis printer tidak dikenal: ${kind}`);
  return key;
};

const storage = () => (typeof window !== "undefined" ? window.localStorage : null);

const normalize = (value) => (typeof value === "string" ? value.trim() : String(value ?? "").trim());

export const getPrinterId = (kind) => {
  const key = keyFor(kind);
  try {
    return normalize(storage()?.getItem(key));
  } catch (error) {
    console.error(`Gagal membaca pengaturan printer ${key}`, error);
    return "";
  }
};

export const setPrinterId = (kind, value) => {
  const key = keyFor(kind);
  const normalized = normalize(value);
  try {
    if (normalized) storage()?.setItem(key, normalized);
    else storage()?.removeItem(key);
  } catch (error) {
    console.error(`Gagal menyimpan pengaturan printer ${key}`, error);
  }
  return normalized;
};

export const clearPrinterId = (kind) => setPrinterId(kind, "");

export const getKitchenPrinterId = () => getPrinterId("kitchen");
export const getCashierPrinterId = () => getPrinterId("cashier");
export const setKitchenPrinterId = (value) => setPrinterId("kitchen", value);
export const setCashierPrinterId = (value) => setPrinterId("cashier", value);
export const clearKitchenPrinterId = () => clearPrinterId("kitchen");
export const clearCashierPrinterId = () => clearPrinterId("cashier");

// Prefer the stable per-origin Web Bluetooth device id, fall back to the
// advertised name when an id is unavailable.
export const resolveDeviceId = (device) => normalize(device?.id) || normalize(device?.name);
