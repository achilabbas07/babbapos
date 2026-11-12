// Helper murni untuk Laporan "Analisa Perilaku Pelanggan & Perputaran Warkop".
// Dipisahkan dari komponen agar logika normalisasi/agregasi dapat diuji tanpa
// merender UI. Semua fungsi di sini murni (tidak memanggil API / menulis state).

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Normalisasi payload `/reports/customer-behavior` milik backend.
 * - Menjamin tipe angka.
 * - Menyediakan fallback ringkasan yang dihitung dari baris bila kosong.
 * - Tidak mengubah urutan kanal/metode: backend sudah mengurutkan.
 */
export const normalizeCustomerBehaviorReport = (data) => {
  const channels = Array.isArray(data?.channels)
    ? data.channels.map((c, index) => ({
        key: `${c.channel ?? index}:${index}`,
        channel: (c.channel || "Lainnya").trim(),
        transactions: toNumber(c.transactions),
        revenue: toNumber(c.revenue),
        revenueShare: toNumber(c.revenue_share),
        aov: toNumber(c.aov),
      }))
    : [];

  const methods = Array.isArray(data?.methods)
    ? data.methods.map((m, index) => ({
        key: `${m.method ?? index}:${index}`,
        method: (m.method || "Lainnya").trim(),
        transactions: toNumber(m.transactions),
        total: toNumber(m.total),
        share: toNumber(m.share),
      }))
    : [];

  const hours = Array.isArray(data?.hours)
    ? data.hours.map((h) => ({
        hour: toNumber(h.hour),
        label: h.label || `${String(toNumber(h.hour)).padStart(2, "0")}:00`,
        transactions: toNumber(h.transactions),
        revenue: toNumber(h.revenue),
      }))
    : Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: `${String(h).padStart(2, "0")}:00`,
        transactions: 0,
        revenue: 0,
      }));

  const peak = data?.peak_hour;
  const quiet = data?.quiet_hour;

  const insights = Array.isArray(data?.insights)
    ? data.insights.map((line) => String(line || "").trim()).filter(Boolean)
    : [];

  return {
    channels,
    methods,
    hours,
    insights,
    transactionCount: toNumber(data?.transaction_count),
    totalRevenue: toNumber(data?.total_revenue),
    totalItems: toNumber(data?.total_items),
    averageOrderValue: toNumber(data?.average_order_value),
    averageBasketSize: toNumber(data?.average_basket_size),
    peakHour: peak
      ? { hour: toNumber(peak.hour), transactions: toNumber(peak.transactions) }
      : null,
    quietHour: quiet
      ? { hour: toNumber(quiet.hour), transactions: toNumber(quiet.transactions) }
      : null,
    basket: {
      averageItems: toNumber(data?.basket?.average_items, toNumber(data?.average_basket_size)),
      maxItems: toNumber(data?.basket?.max_items),
      minItems: toNumber(data?.basket?.min_items),
    },
  };
};

/** Format jam 0-23 menjadi label "HH:00". */
export const formatHour = (hour) => `${String(toNumber(hour)).padStart(2, "0")}:00`;

/**
 * Ringkas kanal menjadi tiga kelompok utama (Dine In, Takeaway, Ojol) untuk
 * tampilan cepat, sambil tetap mempertahankan detail kanal lain (Walk In).
 */
export const groupChannels = (channels) => {
  const groups = new Map();
  (channels || []).forEach((c) => {
    const key = c.channel;
    const current = groups.get(key) || { channel: key, transactions: 0, revenue: 0 };
    current.transactions += c.transactions;
    current.revenue += c.revenue;
    groups.set(key, current);
  });
  const totalRevenue = [...groups.values()].reduce((sum, g) => sum + g.revenue, 0);
  return [...groups.values()]
    .map((g) => ({
      ...g,
      revenueShare: totalRevenue ? (g.revenue / totalRevenue) * 100 : 0,
      aov: g.transactions ? g.revenue / g.transactions : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
};

/** Cari jam dengan transaksi terbanyak (peak) dan tersedikit (downtime). */
export const findPeakAndQuietHours = (hours) => {
  const active = (hours || []).filter((h) => h.transactions > 0);
  if (!active.length) return { peak: null, quiet: null };
  const peak = active.reduce((best, h) =>
    h.transactions > best.transactions || (h.transactions === best.transactions && h.revenue > best.revenue)
      ? h
      : best,
  );
  const quiet = active.reduce((worst, h) =>
    h.transactions < worst.transactions || (h.transactions === worst.transactions && h.revenue < worst.revenue)
      ? h
      : worst,
  );
  return { peak, quiet };
};
