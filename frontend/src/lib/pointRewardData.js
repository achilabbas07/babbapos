// Helper murni untuk Laporan Point Reward. Dipisahkan dari komponen agar logika
// normalisasi/filter dapat diuji tanpa merender UI.

/**
 * Normalisasi payload `/reports/point-reward-usage` milik backend.
 * - Menjamin tipe angka.
 * - Menyediakan total ringkasan (fallback dihitung dari baris bila kosong).
 * - Tidak mengubah urutan: backend sudah mengurutkan terbaru lebih dulu.
 */
export const normalizePointRewardReport = (data) => {
  const items = Array.isArray(data?.items)
    ? data.items.map((r, index) => ({
        key: `${r.transaction_id ?? index}:${index}`,
        transactionId: r.transaction_id ?? null,
        date: r.date ?? "",
        timestamp: r.timestamp ?? null,
        customerName: (r.customer_name || "").trim(),
        pointsRedeemed: Number(r.points_redeemed) || 0,
        discountValue: Number(r.discount_value) || 0,
        cashier: (r.cashier || "").trim(),
      }))
    : [];

  const derivedPoints = items.reduce((sum, r) => sum + r.pointsRedeemed, 0);
  const derivedDiscount = items.reduce((sum, r) => sum + r.discountValue, 0);

  return {
    items,
    totalRedemptions: Number(data?.total_redemptions ?? items.length) || 0,
    totalPoints: Number(data?.total_points_redeemed ?? derivedPoints) || 0,
    totalDiscount: Number(data?.total_discount_value ?? derivedDiscount) || 0,
  };
};

/** Filter baris berdasarkan kata kunci (no. transaksi, pelanggan, atau kasir). */
export const filterPointRewardItems = (items, query) => {
  const q = (query || "").trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter((r) =>
    `${r.transactionId} ${r.customerName} ${r.cashier}`.toLowerCase().includes(q),
  );
};
