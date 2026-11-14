// Helper murni untuk Laporan "Analisa Perilaku Pelanggan & Perputaran Warkop".
// Dipisahkan dari komponen agar logika normalisasi/agregasi dapat diuji tanpa
// merender UI. Semua fungsi di sini murni (tidak memanggil API / menulis state).

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// Warkop Babba memakai kalender bisnis Asia/Makassar (WITA, UTC+8) tanpa DST.
// Browser pengguna bisa berada di zona lain (mis. laptop admin di-set UTC),
// sehingga "hari ini" untuk laporan ini TIDAK boleh memakai tanggal lokal
// perangkat. Backend memfilter memakai kalender WITA, jadi frontend harus
// mengirim tanggal yang sama agar preset "Hari Ini" tidak meleset satu hari.
export const WITA_OFFSET_MINUTES = 8 * 60;

const pad2 = (n) => String(n).padStart(2, "0");

/** Tanggal kalender WITA (YYYY-MM-DD) dari sebuah instant. */
export const witaDateStr = (value = new Date()) => {
  if (value === null || value === undefined || value === "") return "";
  const base = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(base)) return "";
  const wita = new Date(base + WITA_OFFSET_MINUTES * 60 * 1000);
  return `${wita.getUTCFullYear()}-${pad2(wita.getUTCMonth() + 1)}-${pad2(wita.getUTCDate())}`;
};

/** Tanggal hari ini menurut kalender WITA (YYYY-MM-DD). */
export const witaTodayStr = () => witaDateStr(new Date());

/** Tanggal WITA ``n`` hari lalu (YYYY-MM-DD). */
export const witaDaysAgoStr = (n, base = new Date()) => {
  if (base === null || base === undefined || base === "") return "";
  const baseMs = base instanceof Date ? base.getTime() : new Date(base).getTime();
  if (!Number.isFinite(baseMs)) return "";
  return witaDateStr(new Date(baseMs - toNumber(n) * 86400000));
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
