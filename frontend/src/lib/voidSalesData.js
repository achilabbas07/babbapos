// Helper murni untuk Laporan Void. Dipisahkan dari komponen agar logika
// normalisasi/filter dapat diuji tanpa merender UI.

/** Nama tampilan satu baris: sertakan varian bila ada. */
export const voidSalesDisplayName = (row) =>
  row.variantName ? `${row.productName} - ${row.variantName}` : row.productName;

/**
 * Normalisasi payload `/reports/void-sales` milik backend.
 * - Menjamin tipe angka.
 * - Menyediakan total ringkasan (fallback dihitung dari baris bila kosong).
 * - Tidak mengubah urutan: backend sudah mengurutkan terbaru lebih dulu.
 */
export const normalizeVoidSalesReport = (data) => {
  const items = Array.isArray(data?.items)
    ? data.items.map((r, index) => ({
        key: `${r.void_id ?? index}:${r.bill_id ?? ""}:${index}`,
        voidId: r.void_id ?? null,
        billId: (r.bill_id || "").trim(),
        date: r.date ?? "",
        timestamp: r.timestamp ?? null,
        tableId: r.table_id ?? null,
        tableName: (r.table_name || "").trim(),
        productName: (r.product_name || "").trim(),
        variantName: (r.variant_name || "").trim(),
        qty: Number(r.qty) || 0,
        value: Number(r.value) || 0,
        cashier: (r.cashier || "").trim(),
        authorizedBy: (r.authorized_by || "").trim(),
        reason: (r.reason || "").trim(),
      }))
    : [];

  const derivedQty = items.reduce((sum, r) => sum + r.qty, 0);
  const derivedValue = items.reduce((sum, r) => sum + r.value, 0);

  return {
    items,
    totalVoids: Number(data?.total_voids) || 0,
    totalItems: Number(data?.total_items ?? items.length) || 0,
    totalQty: Number(data?.total_qty ?? derivedQty) || 0,
    totalValue: Number(data?.total_value ?? derivedValue) || 0,
  };
};

/** Filter baris berdasarkan kata kunci (produk, varian, meja, atau kasir). */
export const filterVoidSalesItems = (items, query) => {
  const q = (query || "").trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter((r) =>
    `${r.productName} ${r.variantName} ${r.tableName} ${r.cashier} ${r.billId}`
      .toLowerCase()
      .includes(q),
  );
};
