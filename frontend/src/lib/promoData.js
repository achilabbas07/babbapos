// Helper murni untuk Laporan Promo. Dipisahkan dari komponen agar logika
// normalisasi/filter/rekap dapat diuji tanpa merender UI. Semua fungsi di sini
// murni (tidak memanggil API / menulis state).

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Label tampilan kode promo; kode kosong ditampilkan sebagai "(tanpa kode)". */
export const promoCodeLabel = (code) => {
  const text = (code || "").toString().trim();
  return text && text !== "-" ? text : "(tanpa kode)";
};

/**
 * Rekap per kode promo dari daftar item transaksi.
 * - Menjumlahkan jumlah transaksi, total diskon promo, dan total nilai transaksi.
 * - Urut dari diskon promo terbesar; tie-break kode menaik agar stabil.
 */
export const buildPromoRecap = (items = []) => {
  const map = new Map();
  for (const row of items || []) {
    const raw = (row?.promoCode || "").trim();
    const key = raw || "-";
    const bucket = map.get(key) || { key, code: key, transactions: 0, promoDiscount: 0, transactionValue: 0 };
    bucket.transactions += 1;
    bucket.promoDiscount += toNumber(row?.promoDiscount);
    bucket.transactionValue += toNumber(row?.total);
    map.set(key, bucket);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.promoDiscount - a.promoDiscount || a.code.localeCompare(b.code),
  );
};

/**
 * Normalisasi payload `/reports/promo-usage` milik backend.
 * - Menjamin tipe angka.
 * - Menyediakan total ringkasan (fallback dihitung dari baris bila kosong).
 * - Rekap promo memakai ``promos`` dari backend bila ada, jika tidak dihitung
 *   ulang dari baris.
 * - Tidak mengubah urutan item: backend sudah mengurutkan terbaru lebih dulu.
 */
export const normalizePromoReport = (data) => {
  const items = Array.isArray(data?.items)
    ? data.items.map((r, index) => ({
        key: `${r.transaction_id ?? index}:${index}`,
        transactionId: r.transaction_id ?? null,
        date: r.date ?? "",
        timestamp: r.timestamp ?? null,
        promoCode: (r.promo_code || "").trim(),
        promoDiscount: toNumber(r.promo_discount),
        subtotal: toNumber(r.subtotal),
        discount: toNumber(r.discount),
        total: toNumber(r.total),
        customerName: (r.customer_name || "").trim(),
        cashier: (r.cashier || "").trim(),
      }))
    : [];

  const derivedDiscount = items.reduce((sum, r) => sum + r.promoDiscount, 0);
  const derivedValue = items.reduce((sum, r) => sum + r.total, 0);

  const promos = Array.isArray(data?.promos)
    ? data.promos.map((p, index) => ({
        key: `${p.code ?? index}:${index}`,
        code: (p.code || "-").trim(),
        transactions: toNumber(p.transactions),
        promoDiscount: toNumber(p.promo_discount),
        transactionValue: toNumber(p.transaction_value),
      }))
    : buildPromoRecap(items);

  return {
    items,
    promos,
    totalTransactions: Number(data?.total_transactions ?? items.length) || 0,
    totalPromoDiscount: toNumber(data?.total_promo_discount ?? derivedDiscount),
    totalTransactionValue: toNumber(data?.total_transaction_value ?? derivedValue),
    promoCount: Number(data?.promo_count ?? promos.length) || 0,
  };
};

/** Filter baris berdasarkan kata kunci (no. transaksi, kode promo, pelanggan, kasir). */
export const filterPromoItems = (items, query) => {
  const q = (query || "").trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter((r) =>
    `${r.transactionId} ${r.promoCode} ${r.customerName} ${r.cashier}`.toLowerCase().includes(q),
  );
};
