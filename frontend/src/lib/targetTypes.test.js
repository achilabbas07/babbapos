import {
  formatProgressValue,
  isAchieved,
  needsAmount,
  needsProducts,
  periodLabel,
  periodOf,
  progressCaption,
  targetBadgeText,
  targetRuleSummary,
  targetTypeLabel,
  targetTypeOf,
  targetValueOf,
  timeWindowLabel,
  unitOf,
  METRIC_ITEM,
  METRIC_REVENUE,
  PERIOD_DAILY,
  PERIOD_SHIFT,
  PERIOD_WEEKLY,
  TARGET_TYPE_ITEM,
  TARGET_TYPE_REVENUE,
  TARGET_TYPE_TIME,
  UNIT_CURRENCY,
  UNIT_ITEM,
} from "./targetTypes";

describe("targetTypeOf", () => {
  it("defaults legacy targets to item quantity", () => {
    expect(targetTypeOf({})).toBe(TARGET_TYPE_ITEM);
    expect(targetTypeOf(undefined)).toBe(TARGET_TYPE_ITEM);
    expect(targetTypeOf({ targetType: "tidak_dikenal" })).toBe(TARGET_TYPE_ITEM);
  });

  it("keeps known types", () => {
    expect(targetTypeOf({ targetType: TARGET_TYPE_REVENUE })).toBe(TARGET_TYPE_REVENUE);
    expect(targetTypeOf({ targetType: TARGET_TYPE_TIME })).toBe(TARGET_TYPE_TIME);
  });
});

describe("targetTypeLabel", () => {
  it("labels each type", () => {
    expect(targetTypeLabel({})).toBe("Kuantitas item");
    expect(targetTypeLabel({ targetType: TARGET_TYPE_REVENUE })).toBe("Omzet");
    expect(targetTypeLabel({ targetType: TARGET_TYPE_TIME })).toBe("Berbasis waktu");
  });
});

describe("needsProducts / needsAmount", () => {
  it("item target only needs products", () => {
    expect(needsProducts({})).toBe(true);
    expect(needsAmount({})).toBe(false);
  });

  it("revenue target only needs amount", () => {
    const revenue = { targetType: TARGET_TYPE_REVENUE };
    expect(needsProducts(revenue)).toBe(false);
    expect(needsAmount(revenue)).toBe(true);
  });

  it("time target follows its metric", () => {
    const byItem = { targetType: TARGET_TYPE_TIME, metric: METRIC_ITEM };
    const byRevenue = { targetType: TARGET_TYPE_TIME, metric: METRIC_REVENUE };
    expect(needsProducts(byItem)).toBe(true);
    expect(needsAmount(byItem)).toBe(false);
    expect(needsProducts(byRevenue)).toBe(false);
    expect(needsAmount(byRevenue)).toBe(true);
  });

  it("time target without metric defaults to revenue", () => {
    expect(needsAmount({ targetType: TARGET_TYPE_TIME })).toBe(true);
  });
});

describe("period helpers", () => {
  it("defaults to shift", () => {
    expect(periodOf({})).toBe(PERIOD_SHIFT);
    expect(periodOf({ periodType: "tahunan" })).toBe(PERIOD_SHIFT);
    expect(periodLabel({ periodType: PERIOD_WEEKLY })).toBe("Mingguan");
    expect(periodLabel({ periodType: PERIOD_DAILY })).toBe("Harian");
  });
});

describe("unitOf / targetValueOf", () => {
  it("honours explicit unit", () => {
    expect(unitOf({ unit: UNIT_CURRENCY })).toBe(UNIT_CURRENCY);
    expect(unitOf({ unit: UNIT_ITEM })).toBe(UNIT_ITEM);
  });

  it("falls back based on targetQty for legacy items", () => {
    expect(unitOf({ targetQty: 10 })).toBe(UNIT_ITEM);
    expect(unitOf({ targetQty: null })).toBe(UNIT_CURRENCY);
  });

  it("prefers targetValue then targetAmount then targetQty", () => {
    expect(targetValueOf({ targetValue: 500, targetQty: 10 })).toBe(500);
    expect(targetValueOf({ targetAmount: 700, targetQty: 10 })).toBe(700);
    expect(targetValueOf({ targetQty: 10 })).toBe(10);
    expect(targetValueOf(undefined)).toBe(0);
  });
});

describe("isAchieved", () => {
  it("works for item targets", () => {
    expect(isAchieved({ achieved: 10, targetQty: 10 })).toBe(true);
    expect(isAchieved({ achieved: 9, targetQty: 10 })).toBe(false);
  });

  it("works for revenue targets with null targetQty", () => {
    expect(isAchieved({ achieved: 500000, targetQty: null, targetValue: 500000 })).toBe(true);
    expect(isAchieved({ achieved: 400000, targetQty: null, targetValue: 500000 })).toBe(false);
  });

  it("never achieved when target value is zero or missing", () => {
    expect(isAchieved({ achieved: 5, targetQty: 0 })).toBe(false);
    expect(isAchieved({ achieved: 5, targetQty: null })).toBe(false);
    expect(isAchieved(undefined)).toBe(false);
  });
});

describe("timeWindowLabel", () => {
  it("renders a range", () => {
    expect(timeWindowLabel({ startTime: "22:00", endTime: "02:00" })).toBe("22:00-02:00");
  });

  it("renders single bounds", () => {
    expect(timeWindowLabel({ startTime: "08:00" })).toBe("mulai 08:00");
    expect(timeWindowLabel({ endTime: "12:00" })).toBe("sampai 12:00");
  });

  it("is empty without bounds", () => {
    expect(timeWindowLabel({})).toBe("");
    expect(timeWindowLabel(undefined)).toBe("");
  });
});

describe("targetRuleSummary", () => {
  it("summarises item targets", () => {
    expect(targetRuleSummary({ targetQty: 25 })).toBe("25 item");
  });

  it("summarises revenue targets in rupiah", () => {
    expect(targetRuleSummary({ targetType: TARGET_TYPE_REVENUE, targetAmount: 1500000 })).toBe("Rp 1.500.000");
  });

  it("summarises time targets with window", () => {
    expect(targetRuleSummary({
      targetType: TARGET_TYPE_TIME, metric: METRIC_REVENUE, targetAmount: 500000,
      startTime: "22:00", endTime: "02:00",
    })).toBe("Rp 500.000 · 22:00-02:00");
  });
});

describe("formatProgressValue", () => {
  it("formats currency values in rupiah", () => {
    expect(formatProgressValue({ unit: UNIT_CURRENCY }, 400000)).toBe("Rp 400.000");
  });

  it("keeps plain numbers for item targets", () => {
    expect(formatProgressValue({ unit: UNIT_ITEM }, 5)).toBe("5");
  });

  it("handles legacy items without unit", () => {
    expect(formatProgressValue({ targetQty: 10 }, 4)).toBe("4");
  });
});

describe("progressCaption", () => {
  it("is empty for shift-scoped item targets", () => {
    expect(progressCaption({ targetQty: 10 })).toBe("");
  });

  it("shows the period for non-shift targets", () => {
    expect(progressCaption({ periodType: PERIOD_WEEKLY })).toBe("Mingguan");
  });

  it("shows period and window for time-bounded targets", () => {
    expect(progressCaption({
      targetType: TARGET_TYPE_TIME, periodType: PERIOD_DAILY, startTime: "22:00", endTime: "02:00",
    })).toBe("Harian · 22:00-02:00");
  });
});

describe("targetBadgeText", () => {
  it("keeps the legacy item format", () => {
    expect(targetBadgeText({ name: "Kopi", achieved: 4, targetQty: 10 }))
      .toEqual({ name: "Kopi", text: "4/10", done: false });
  });

  it("formats revenue targets as rupiah", () => {
    expect(targetBadgeText({
      name: "Omzet", achieved: 400000, targetQty: null, targetValue: 500000, unit: UNIT_CURRENCY,
    })).toEqual({ name: "Omzet", text: "Rp 400.000 / Rp 500.000", done: false });
  });

  it("marks achieved targets as done", () => {
    expect(targetBadgeText({ name: "Omzet", achieved: 600000, targetQty: null, targetValue: 500000 }).done).toBe(true);
  });

  it("falls back to a generic name", () => {
    expect(targetBadgeText(undefined).name).toBe("Target");
  });
});
