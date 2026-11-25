// Helper murni untuk panel "Riwayat Transaksi" pada halaman Pelanggan.
//
// Memetakan payload baca-saja `GET /customers/{cid}/purchases` ke tepat 7
// informasi yang diminta: Tanggal (WITA), Waktu Order (WITA), Waktu Bayar
// (WITA), No. Meja, Total Item, Jumlah (Rp), dan Pelayan.
//
// Modul ini HANYA memformat data tampilan: tidak menyentuh skema database,
// alur transaksi/checkout, harga, stok, Open Bill, split payment, maupun jurnal.
//
// Catatan zona waktu: backend sudah mengirim stempel waktu ber-offset WITA
// (`+08:00`). Agar tampilan selalu konsisten WITA (Asia/Makassar) walau
// perangkat berada di zona waktu lain, format waktu di sini memakai
// `timeZone: "Asia/Makassar"` secara eksplisit.

import { CACHE_KEYS } from "./localStore";
import { rangeCacheKey } from "./offlineRead";

export const WITA_TIME_ZONE = "Asia/Makassar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Format tanggal kalender WITA (`YYYY-MM-DD`) -> "05 Jan 2026". */
export const formatLocalDate = (value) => {
  const raw = String(value || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return value || "-";
  return `${m[3]} ${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`;
};

/** Format jam WITA (`HH:MM`) dari ISO apa pun, selalu dalam zona Asia/Makassar. */
export const formatWitaTime = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: WITA_TIME_ZONE,
  });
};

/**
 * Key cache unik per pelanggan + rentang tanggal.
 * Contoh: customerPurchasesCacheKey("CUST-1", { start: "x" }) ->
 * "customers/purchases/CUST-1?start=x".
 */
export const customerPurchasesCacheKey = (customerId, params = {}) =>
  rangeCacheKey(`${CACHE_KEYS.CUSTOMER_PURCHASES}/${customerId}`, params);

/**
 * Normalisasi payload riwayat transaksi pelanggan menjadi baris siap tampil.
 * Field yang hilang tidak boleh membuat panel rusak — selalu ada fallback "-".
 */
export const normalizeCustomerPurchases = (data) => {
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r, index) => {
    const items = Number(r?.totalItem);
    const amount = Number(r?.jumlah);
    return {
      key: String(r?.id ?? index),
      tanggal: r?.tanggal || "",
      waktuOrder: r?.waktuOrder || "",
      waktuBayar: r?.waktuBayar || "",
      meja: (r?.meja || "").trim() || "-",
      totalItem: Number.isFinite(items) ? items : 0,
      jumlah: Number.isFinite(amount) ? amount : 0,
      pelayan: (r?.pelayan || "").trim() || "-",
      void: Boolean(r?.void),
    };
  });
};

/** Tujuh kolom informasi yang diminta, urut sesuai permintaan. */
export const customerPurchaseColumns = () => [
  { key: "tanggal", label: "Tanggal", align: "left" },
  { key: "waktuOrder", label: "Waktu Order", align: "left" },
  { key: "waktuBayar", label: "Waktu Bayar", align: "left" },
  { key: "meja", label: "No. Meja", align: "left" },
  { key: "totalItem", label: "Total Item", align: "right" },
  { key: "jumlah", label: "Jumlah", align: "right" },
  { key: "pelayan", label: "Pelayan", align: "left" },
];

/** Nilai satu kolom yang sudah diformat untuk ditampilkan. */
export const customerPurchaseCellValue = (columnKey, row, rp) => {
  switch (columnKey) {
    case "tanggal":
      return row.tanggal ? formatLocalDate(row.tanggal) : "-";
    case "waktuOrder":
      return formatWitaTime(row.waktuOrder);
    case "waktuBayar":
      return formatWitaTime(row.waktuBayar);
    case "meja":
      return row.meja;
    case "totalItem":
      return String(row.totalItem);
    case "jumlah":
      return rp(row.jumlah);
    case "pelayan":
      return row.pelayan;
    default:
      return "-";
  }
};

/** Ringkasan footer: jumlah transaksi, total item, dan total nominal. */
export const summarizeCustomerPurchases = (rows = []) => ({
  count: rows.length,
  totalItem: rows.reduce((acc, r) => acc + (Number(r?.totalItem) || 0), 0),
  total: rows.reduce((acc, r) => acc + (Number(r?.jumlah) || 0), 0),
});
