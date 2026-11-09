import { todayStr, daysAgoStr } from "./api";

const pad = (n) => String(n).padStart(2, "0");

export const monthStartStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
};

/**
 * Preset rentang tanggal untuk filter halaman Pembelian, Pengeluaran, dan
 * Riwayat Shift. `from`/`to` berupa tanggal kalender lokal `YYYY-MM-DD`;
 * string kosong berarti tanpa batas pada sisi tersebut.
 */
export const DATE_RANGE_PRESETS = [
  { key: "today", label: "Hari ini", range: () => ({ from: todayStr(), to: todayStr() }) },
  { key: "7d", label: "7 hari", range: () => ({ from: daysAgoStr(6), to: todayStr() }) },
  { key: "30d", label: "30 hari", range: () => ({ from: daysAgoStr(29), to: todayStr() }) },
  { key: "month", label: "Bulan ini", range: () => ({ from: monthStartStr(), to: todayStr() }) },
  { key: "all", label: "Semua", range: () => ({ from: "", to: "" }) },
];
