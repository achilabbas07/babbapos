// Helper murni untuk halaman Pantauan Pemilik (Mode Owner).
//
// Halaman Owner bersifat STRICTLY READ-ONLY. Modul ini hanya menormalkan data
// yang dibaca dari endpoint `/reports/owner-monitor`; tidak ada fungsi yang
// membuat/mengubah/menghapus data, tidak memanggil API, dan tidak menyentuh alur
// transaksi/checkout, HPP, jurnal diskon, maupun cetak dapur.
//
// Semua fungsi di sini murni (tanpa React/DOM) agar mudah diuji.

export const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toText = (value) => (value ?? "").toString().trim();

const isLowStock = (row) => {
  if (typeof row?.is_low === "boolean") return row.is_low;
  const stock = toNumber(row?.stock);
  const minStock = toNumber(row?.min_stock);
  return minStock > 0 && stock <= minStock;
};

/** Label periode "Bulan" (mis. "November 2026") untuk judul/keterangan filter. */
export const monthLabel = (month, year) => {
  const m = toNumber(month, 0);
  const y = toNumber(year, 0);
  if (!m || !y) return "-";
  const names = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  return `${names[(m - 1 + 12) % 12]} ${y}`;
};

/** Parameter query untuk endpoint Owner: mode "bulan" atau mode "tanggal". */
export const ownerRangeParams = (mode, range) => {
  if (mode === "month") {
    return { month: toNumber(range?.month), year: toNumber(range?.year) };
  }
  // Menerima dua penamaan yang dipakai UI: `start`/`end` (OwnerPeriodFilter)
  // maupun `from`/`to` (DateRangeFilter). Nilai kosong tidak dikirim.
  const start = range?.start ?? range?.from;
  const end = range?.end ?? range?.to;
  const params = {};
  if (start) params.start = start;
  if (end) params.end = end;
  return params;
};

export const normalizeOmzet = (raw) => ({
  totalRevenue: toNumber(raw?.total_revenue),
  transactionCount: toNumber(raw?.transaction_count),
  totalItems: toNumber(raw?.total_items),
  averageOrderValue: toNumber(raw?.average_order_value),
});

export const normalizeOpenBills = (raw) => ({
  count: toNumber(raw?.count),
  totalValue: toNumber(raw?.total_value),
  truncated: Boolean(raw?.truncated),
  items: Array.isArray(raw?.items)
    ? raw.items.map((row, index) => ({
        key: `${row?.id ?? index}:${index}`,
        id: row?.id ?? null,
        date: toText(row?.date),
        timestamp: row?.timestamp ?? null,
        type: toText(row?.type),
        tableId: row?.table_id ?? null,
        tableName: toText(row?.table_name),
        customerName: toText(row?.customer_name),
        waiterName: toText(row?.waiter_name),
        itemCount: toNumber(row?.item_count),
        total: toNumber(row?.total),
      }))
    : [],
});

export const normalizeInventory = (raw) => ({
  count: toNumber(raw?.count),
  lowStockCount: toNumber(raw?.low_stock_count),
  totalStockValue: toNumber(raw?.total_stock_value),
  truncated: Boolean(raw?.truncated),
  items: Array.isArray(raw?.items)
    ? raw.items.map((row, index) => ({
        key: `${row?.id ?? index}:${index}`,
        id: row?.id ?? null,
        name: toText(row?.name),
        type: toText(row?.type),
        stock: toNumber(row?.stock),
        unit: toText(row?.unit),
        costPerUnit: toNumber(row?.cost_per_unit),
        minStock: toNumber(row?.min_stock),
        stockValue: toNumber(row?.stock_value),
        isLow: isLowStock(row),
      }))
    : [],
});

export const normalizeShift = (raw, index = 0) => ({
  key: `${raw?.shift_id ?? index}:${index}`,
  shiftId: raw?.shift_id ?? null,
  waiterId: raw?.waiter_id ?? null,
  waiterName: toText(raw?.waiter_name) || "(tanpa nama)",
  openedAt: raw?.opened_at ?? null,
  totalOrders: toNumber(raw?.total_orders),
  totalItemsSold: toNumber(raw?.total_items_sold),
  totalVoids: toNumber(raw?.total_voids),
  voidQty: toNumber(raw?.void_qty),
  voidValue: toNumber(raw?.void_value),
  promoCount: toNumber(raw?.promo_usage?.count),
  promoDiscount: toNumber(raw?.promo_usage?.discount),
  redeemCount: toNumber(raw?.redeem_points?.count),
  pointsRedeemed: toNumber(raw?.redeem_points?.points),
  pointsDiscount: toNumber(raw?.redeem_points?.discount),
  voidDetails: Array.isArray(raw?.void_details)
    ? raw.void_details.map((row, i) => ({
        key: `${i}`,
        qty: toNumber(row?.qty),
        name: toText(row?.name) || "Menu",
        reason: toText(row?.reason) || "-",
      }))
    : [],
});

export const normalizeProfitLoss = (raw) => {
  const revenue = toNumber(raw?.revenue);
  const salesDiscount = toNumber(raw?.sales_discount);
  const hpp = toNumber(raw?.hpp);
  const expenses = toNumber(raw?.expenses);
  const netProfit = raw?.net_profit === undefined || raw?.net_profit === null
    ? revenue - salesDiscount - hpp - expenses
    : toNumber(raw?.net_profit);
  return { revenue, salesDiscount, hpp, expenses, netProfit };
};

export const normalizePeriod = (raw) => ({
  start: toText(raw?.start),
  end: toText(raw?.end),
  month: toNumber(raw?.month),
  year: toNumber(raw?.year),
  label: toText(raw?.label),
  generatedAt: raw?.generated_at ?? null,
});

/** Normalisasi payload `/reports/owner-monitor` → bentuk camelCase siap render. */
export const normalizeOwnerDashboard = (data) => {
  const shifts = Array.isArray(data?.active_shifts)
    ? data.active_shifts.map((row, index) => normalizeShift(row, index))
    : [];
  return {
    readonly: data?.readonly !== false,
    period: normalizePeriod(data?.period),
    omzet: normalizeOmzet(data?.omzet),
    openBills: normalizeOpenBills(data?.open_bills),
    inventory: normalizeInventory(data?.inventory),
    activeShifts: shifts,
    profitLoss: normalizeProfitLoss(data?.profit_loss),
  };
};

/** Ringkasan cepat untuk judul: total item terjual & total void seluruh shift. */
export const summarizeShifts = (shifts = []) =>
  (shifts || []).reduce(
    (acc, shift) => ({
      waiters: acc.waiters + 1,
      itemsSold: acc.itemsSold + toNumber(shift?.totalItemsSold),
      voids: acc.voids + toNumber(shift?.totalVoids),
      promoCount: acc.promoCount + toNumber(shift?.promoCount),
      pointsRedeemed: acc.pointsRedeemed + toNumber(shift?.pointsRedeemed),
    }),
    { waiters: 0, itemsSold: 0, voids: 0, promoCount: 0, pointsRedeemed: 0 },
  );
