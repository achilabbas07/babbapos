// Helper murni untuk Laporan Penjualan Produk. Dipisahkan dari komponen agar
// logika normalisasi/filter/urut dapat diuji tanpa merender UI.

/** Nama tampilan satu baris: sertakan varian bila ada. */
export const productSalesDisplayName = (row) =>
  row.variantName ? `${row.name} - ${row.variantName}` : row.name;

/**
 * Normalisasi payload `/reports/product-sales` milik backend.
 * - Menjamin tipe angka.
 * - Mengurutkan dari produk paling laris (qty tertinggi, lalu omzet).
 * - Menyediakan total ringkasan (fallback dihitung dari baris bila kosong).
 */
export const normalizeProductSalesReport = (data) => {
  const items = Array.isArray(data?.items)
    ? data.items.map((r) => ({
        key: `${r.productId ?? ""}:${r.variantId ?? r.variantName ?? ""}`,
        productId: r.productId ?? null,
        variantId: r.variantId ?? null,
        name: (r.name || "").trim(),
        variantName: (r.variantName || "").trim(),
        category: (r.category || "").trim(),
        qty: Number(r.qty) || 0,
        revenue: Number(r.revenue) || 0,
        contribution: Number(r.contribution) || 0,
      }))
    : [];

  items.sort(
    (a, b) => b.qty - a.qty || b.revenue - a.revenue || a.name.localeCompare(b.name),
  );

  const totalQty = Number(data?.total_qty ?? items.reduce((sum, r) => sum + r.qty, 0)) || 0;
  const grossSales = Number(data?.gross_sales ?? items.reduce((sum, r) => sum + r.revenue, 0)) || 0;

  return {
    items,
    totalQty,
    grossSales,
    transactionCount: Number(data?.transaction_count) || 0,
    itemCount: items.length,
  };
};

/** Filter baris berdasarkan kata kunci (nama produk, varian, atau kategori). */
export const filterProductSalesItems = (items, query) => {
  const q = (query || "").trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter((r) =>
    `${r.name} ${r.variantName} ${r.category}`.toLowerCase().includes(q),
  );
};
