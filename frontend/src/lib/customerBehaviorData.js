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

// Ambang penurunan drastis (persen) bila backend tidak mengirimkannya.
export const DEFAULT_SPEND_DROP_THRESHOLD = 40;

// Batas jumlah pelanggan yang ditampilkan pada panel peringatan belanja.
// Backend sudah membatasi 20; ini jaring pengaman di sisi UI.
export const SPEND_ALERTS_LIMIT = 20;

/**
 * Normalisasi daftar ``spend_alerts`` dari backend (pemantauan perubahan
 * perilaku belanja per pelanggan). Menjamin tipe angka & boolean aman serta
 * menyediakan label identitas yang ramah ditampilkan.
 *
 * Tiap baris membandingkan TRANSAKSI TERAKHIR pelanggan dengan 2-3 transaksi
 * sebelumnya (rentang ``prevTotalMin``/``prevTotalMax`` + acuan median
 * ``baselineTotal``), bukan rata-rata. Field lama (``baselineAov``,
 * ``recentAov``, ``aovChangePct``) dipertahankan sebagai alias agar komponen
 * lama tetap kompatibel.
 */
export const normalizeCustomerSpendAlerts = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const name = String(row?.customer_name || row?.customer_id || "Tanpa nama").trim();
    const baselineTotal = toNumber(row?.baseline_total, toNumber(row?.baseline_aov));
    const lastTotal = toNumber(row?.last_total, toNumber(row?.recent_aov));
    const changePct =
      row?.change_pct === undefined || row?.change_pct === null
        ? toNumber(row?.aov_change_pct)
        : toNumber(row?.change_pct);
    const dropPct = toNumber(row?.drop_pct, toNumber(row?.aov_drop_pct));
    return {
      key: row?.customer_id || `row-${index}`,
      customerId: row?.customer_id || "",
      customerName: name,
      identity: row?.identity || (row?.customer_id ? "customerId" : "customerName"),
      baselineTxCount: toNumber(row?.baseline_tx_count),
      baselineTotal,
      baselineAov: baselineTotal,
      baselineAvgItems: toNumber(row?.baseline_avg_items),
      // Rentang nilai 2-3 transaksi sebelumnya (min-max).
      prevTxCount: toNumber(row?.prev_tx_count, toNumber(row?.baseline_tx_count)),
      prevTotalMin: toNumber(row?.prev_total_min),
      prevTotalMax: toNumber(row?.prev_total_max),
      // Transaksi terakhir pelanggan.
      lastTotal,
      lastItems: toNumber(row?.last_items, toNumber(row?.recent_avg_items)),
      lastTime: String(row?.last_time || ""),
      recentTxCount: toNumber(row?.recent_tx_count),
      recentAov: lastTotal,
      recentAvgItems: toNumber(row?.recent_avg_items),
      changePct,
      aovChangePct: changePct,
      aovDropPct: dropPct,
      itemsChangePct: toNumber(row?.items_change_pct),
      itemsDropPct: toNumber(row?.items_drop_pct),
      dropPct,
      isDrasticDrop: Boolean(row?.is_drastic_drop),
      lastCashier: String(row?.last_cashier || "").trim(),
      lastShiftId: row?.last_shift_id || "",
      lastVisit: row?.last_visit || "",
    };
  });
};

/**
 * Format rentang nilai transaksi sebelumnya (min-max) dalam Rupiah.
 * ``formatValue`` biasanya fungsi ``rp`` dari ``@/lib/api``; bila tidak
 * diberikan, nilai dikembalikan sebagai angka apa adanya. Bila min == max
 * hanya satu nilai ditampilkan (contoh: ``Rp 100.000``), selain itu dipisah
 * tanda hubung (contoh: ``Rp 100.000 – Rp 130.000``).
 */
export const formatSpendRange = (min, max, formatValue) => {
  const fmt = typeof formatValue === "function" ? formatValue : (v) => String(toNumber(v));
  const lo = toNumber(min);
  const hi = toNumber(max);
  return lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`;
};

/** Batasi daftar alert agar tidak melebihi ``limit`` pelanggan. */
export const limitSpendAlerts = (alerts, limit = SPEND_ALERTS_LIMIT) => {
  const list = Array.isArray(alerts) ? alerts : [];
  const cap = toNumber(limit, SPEND_ALERTS_LIMIT);
  return cap > 0 ? list.slice(0, cap) : list;
};

/** Apakah satu pelanggan turun drastis dari kebiasaannya sendiri. */
export const isDrasticSpendDrop = (alert, threshold = DEFAULT_SPEND_DROP_THRESHOLD) =>
  Boolean(alert?.isDrasticDrop) || toNumber(alert?.dropPct) >= toNumber(threshold, DEFAULT_SPEND_DROP_THRESHOLD);

/** Saring daftar alert; ``onlyDrastic`` menyisakan penurunan drastis saja. */
export const filterSpendAlerts = (alerts, onlyDrastic = false) => {
  const list = Array.isArray(alerts) ? alerts : [];
  return onlyDrastic ? list.filter((a) => isDrasticSpendDrop(a)) : list;
};

/**
 * Urutkan daftar alert. ``mode``: "drop" (penurunan terbesar, default),
 * "aov" (belanja/transaksi terakhir terbesar), "name" (alfabetis).
 */
export const sortSpendAlerts = (alerts, mode = "drop") => {
  const list = [...(Array.isArray(alerts) ? alerts : [])];
  if (mode === "aov") {
    return list.sort(
      (a, b) =>
        toNumber(b.lastTotal, b.recentAov) - toNumber(a.lastTotal, a.recentAov) ||
        a.customerName.localeCompare(b.customerName),
    );
  }
  if (mode === "name") {
    return list.sort((a, b) => a.customerName.localeCompare(b.customerName));
  }
  return list.sort(
    (a, b) =>
      toNumber(b.dropPct) - toNumber(a.dropPct) ||
      toNumber(b.lastTotal, b.recentAov) - toNumber(a.lastTotal, a.recentAov),
  );
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
    spendAlerts: normalizeCustomerSpendAlerts(data?.spend_alerts),
    spendDropThreshold: toNumber(data?.spend_drop_threshold, 40),
    spendAlertsLimit: toNumber(data?.spend_alerts_limit, toNumber(data?.baseline?.limit, SPEND_ALERTS_LIMIT)),
    baseline: {
      start: data?.baseline?.start || "",
      end: data?.baseline?.end || "",
      days: toNumber(data?.baseline?.days),
      minBaselineTx: toNumber(data?.baseline?.min_baseline_tx),
      maxPrevTx: toNumber(data?.baseline?.max_prev_tx),
      limit: toNumber(data?.baseline?.limit, SPEND_ALERTS_LIMIT),
    },
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
