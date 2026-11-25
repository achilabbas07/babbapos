import {
  filterSpendAlerts,
  findPeakAndQuietHours,
  formatHour,
  groupChannels,
  isDrasticSpendDrop,
  normalizeCustomerBehaviorReport,
  normalizeCustomerSpendAlerts,
  sortSpendAlerts,
  witaDateStr,
  witaDaysAgoStr,
  witaTodayStr,
} from "./customerBehaviorData";

const PAYLOAD = {
  start: "2026-11-01",
  end: "2026-11-30",
  transaction_count: 3,
  total_revenue: 170000,
  total_items: 7,
  average_order_value: 56666.67,
  average_basket_size: 2.33,
  channels: [
    { channel: "Ojek Online", transactions: 1, revenue: 100000, revenue_share: 58.82, aov: 100000 },
    { channel: "Dine In", transactions: 1, revenue: 50000, revenue_share: 29.41, aov: 50000 },
    { channel: "Takeaway", transactions: 1, revenue: 20000, revenue_share: 11.76, aov: 20000 },
  ],
  methods: [
    { method: "Cash", transactions: 2, total: 60000, share: 35.29 },
    { method: "QRIS", transactions: 1, total: 100000, share: 58.82 },
    { method: "Debit", transactions: 1, total: 10000, share: 5.88 },
  ],
  peak_hour: { hour: 11, transactions: 2, revenue: 150000 },
  quiet_hour: { hour: 2, transactions: 1, revenue: 20000 },
  basket: { average_items: 2.33, max_items: 3, min_items: 1 },
  hours: [
    { hour: 2, label: "02:00", transactions: 1, revenue: 20000 },
    { hour: 11, label: "11:00", transactions: 2, revenue: 150000 },
  ],
  insights: ["Kanal Ojek Online mendominasi omzet."],
};

describe("normalizeCustomerBehaviorReport", () => {
  it("memetakan payload backend ke bentuk camelCase dengan angka aman", () => {
    const report = normalizeCustomerBehaviorReport(PAYLOAD);
    expect(report.transactionCount).toBe(3);
    expect(report.totalRevenue).toBe(170000);
    expect(report.averageBasketSize).toBeCloseTo(2.33);
    expect(report.channels[0]).toMatchObject({
      channel: "Ojek Online",
      revenue: 100000,
      revenueShare: 58.82,
      aov: 100000,
    });
    expect(report.methods.map((m) => m.method)).toEqual(["Cash", "QRIS", "Debit"]);
    expect(report.peakHour).toMatchObject({ hour: 11, transactions: 2 });
    expect(report.quietHour).toMatchObject({ hour: 2 });
    expect(report.basket).toMatchObject({ maxItems: 3, minItems: 1 });
    expect(report.insights).toHaveLength(1);
  });

  it("menghasilkan struktur kosong yang aman saat data null", () => {
    const report = normalizeCustomerBehaviorReport(null);
    expect(report.transactionCount).toBe(0);
    expect(report.channels).toEqual([]);
    expect(report.methods).toEqual([]);
    expect(report.hours).toHaveLength(24);
    expect(report.peakHour).toBeNull();
    expect(report.insights).toEqual([]);
  });
});

describe("groupChannels", () => {
  it("menggabungkan kanal dan menghitung porsi omzet serta AOV", () => {
    const grouped = groupChannels(normalizeCustomerBehaviorReport(PAYLOAD).channels);
    expect(grouped.map((g) => g.channel)).toEqual(["Ojek Online", "Dine In", "Takeaway"]);
    const dineIn = grouped.find((g) => g.channel === "Dine In");
    expect(dineIn.revenueShare).toBeCloseTo((50000 / 170000) * 100);
    expect(dineIn.aov).toBe(50000);
  });
});

describe("findPeakAndQuietHours", () => {
  it("menemukan jam tersibuk dan tersepi dari jam aktif", () => {
    const { peak, quiet } = findPeakAndQuietHours(
      normalizeCustomerBehaviorReport(PAYLOAD).hours,
    );
    expect(peak.hour).toBe(11);
    expect(quiet.hour).toBe(2);
  });

  it("mengembalikan null bila tidak ada aktivitas", () => {
    const { peak, quiet } = findPeakAndQuietHours([]);
    expect(peak).toBeNull();
    expect(quiet).toBeNull();
  });
});

describe("formatHour", () => {
  it("memformat jam menjadi label HH:00", () => {
    expect(formatHour(2)).toBe("02:00");
    expect(formatHour(11)).toBe("11:00");
    expect(formatHour(0)).toBe("00:00");
  });
});

describe("helper tanggal WITA", () => {
  it("memakai kalender WITA, bukan zona perangkat", () => {
    // 2026-11-13T16:30Z = 2026-11-14 00:30 WITA -> sudah tanggal 14 di WITA.
    expect(witaDateStr(new Date("2026-11-13T16:30:00Z"))).toBe("2026-11-14");
    // 2026-11-13T15:30Z = 2026-11-13 23:30 WITA -> masih tanggal 13.
    expect(witaDateStr(new Date("2026-11-13T15:30:00Z"))).toBe("2026-11-13");
    // 2026-11-14T23:00Z = 2026-11-15 07:00 WITA.
    expect(witaDateStr("2026-11-14T23:00:00Z")).toBe("2026-11-15");
  });

  it("mengembalikan string kosong untuk input tidak valid", () => {
    expect(witaDateStr("bukan-tanggal")).toBe("");
    expect(witaDateStr(null)).toBe("");
  });

  it("menghitung hari mundur pada kalender WITA", () => {
    const base = new Date("2026-11-14T02:00:00Z"); // 10:00 WITA
    expect(witaDaysAgoStr(6, base)).toBe("2026-11-08");
  });

  it("witaTodayStr mengembalikan format YYYY-MM-DD", () => {
    expect(witaTodayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

const SPEND_ALERTS = [
  {
    customer_id: "CUST-1",
    customer_name: "Budi",
    identity: "customerId",
    baseline_tx_count: 5,
    baseline_aov: 50000,
    baseline_avg_items: 3,
    recent_tx_count: 1,
    recent_aov: 20000,
    recent_avg_items: 1,
    aov_change_pct: -60,
    aov_drop_pct: 60,
    items_change_pct: -66.67,
    items_drop_pct: 66.67,
    drop_pct: 66.67,
    is_drastic_drop: true,
    last_cashier: "Kasir A",
    last_shift_id: "SHIFT-9",
    last_visit: "2026-11-20",
  },
  {
    customer_id: null,
    customer_name: "Sari",
    identity: "customerName",
    baseline_tx_count: 4,
    baseline_aov: 30000,
    baseline_avg_items: 2,
    recent_tx_count: 2,
    recent_aov: 28000,
    recent_avg_items: 2,
    aov_change_pct: -6.67,
    aov_drop_pct: 6.67,
    items_change_pct: 0,
    items_drop_pct: 0,
    drop_pct: 6.67,
    is_drastic_drop: false,
    last_cashier: "",
    last_shift_id: null,
    last_visit: "2026-11-19",
  },
];

describe("normalizeCustomerSpendAlerts", () => {
  it("memetakan payload spend_alerts ke camelCase dengan tipe aman", () => {
    const alerts = normalizeCustomerSpendAlerts(SPEND_ALERTS);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({
      key: "CUST-1",
      customerName: "Budi",
      baselineAov: 50000,
      recentAov: 20000,
      dropPct: 66.67,
      isDrasticDrop: true,
      lastCashier: "Kasir A",
      lastShiftId: "SHIFT-9",
    });
    expect(alerts[1].customerId).toBe("");
    expect(alerts[1].isDrasticDrop).toBe(false);
  });

  it("mengembalikan array kosong untuk input tidak valid", () => {
    expect(normalizeCustomerSpendAlerts(null)).toEqual([]);
    expect(normalizeCustomerSpendAlerts(undefined)).toEqual([]);
  });

  it("menyertakan spendAlerts pada normalisasi laporan dan aman saat null", () => {
    const report = normalizeCustomerBehaviorReport({
      ...PAYLOAD,
      spend_alerts: SPEND_ALERTS,
      spend_drop_threshold: 40,
      baseline: { start: "2026-08-03", end: "2026-10-31", days: 90, min_baseline_tx: 2 },
    });
    expect(report.spendAlerts).toHaveLength(2);
    expect(report.spendDropThreshold).toBe(40);
    expect(report.baseline).toMatchObject({ days: 90, minBaselineTx: 2 });

    const empty = normalizeCustomerBehaviorReport(null);
    expect(empty.spendAlerts).toEqual([]);
    expect(empty.spendDropThreshold).toBe(40);
  });
});

describe("filterSpendAlerts / isDrasticSpendDrop", () => {
  it("menyaring hanya penurunan drastis dan mengklasifikasi ambang", () => {
    const alerts = normalizeCustomerSpendAlerts(SPEND_ALERTS);
    expect(filterSpendAlerts(alerts).map((a) => a.customerName)).toEqual(["Budi", "Sari"]);
    expect(filterSpendAlerts(alerts, true).map((a) => a.customerName)).toEqual(["Budi"]);
    expect(isDrasticSpendDrop(alerts[0])).toBe(true);
    expect(isDrasticSpendDrop(alerts[1])).toBe(false);
    // Ambang diturunkan -> Sari (6.67%) seharusnya ikut bila ambang 5%.
    expect(isDrasticSpendDrop(alerts[1], 5)).toBe(true);
  });
});

describe("sortSpendAlerts", () => {
  it("mengurutkan berdasar penurunan, AOV terakhir, dan nama", () => {
    const alerts = normalizeCustomerSpendAlerts(SPEND_ALERTS);
    expect(sortSpendAlerts(alerts, "drop")[0].customerName).toBe("Budi");
    expect(sortSpendAlerts(alerts, "aov")[0].customerName).toBe("Sari");
    expect(sortSpendAlerts(alerts, "name")[0].customerName).toBe("Budi");
    // Tidak mengubah array asli (imutabilitas).
    expect(alerts.map((a) => a.customerName)).toEqual(["Budi", "Sari"]);
  });
});
