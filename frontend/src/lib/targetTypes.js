// Helper murni untuk Multi-Target Sales.
// Semua logika label/format dipisah dari komponen agar mudah diuji tanpa UI.
// Tidak mengubah perilaku target lama: nilai bawaan tetap "item_quantity" / "shift".

import { rp } from "./api";

export const TARGET_TYPE_ITEM = "item_quantity";
export const TARGET_TYPE_REVENUE = "revenue_amount";
export const TARGET_TYPE_TIME = "time_bounded";

export const TARGET_TYPE_OPTIONS = [
  { value: TARGET_TYPE_ITEM, label: "Kuantitas item" },
  { value: TARGET_TYPE_REVENUE, label: "Omzet (Rupiah)" },
  { value: TARGET_TYPE_TIME, label: "Berbasis waktu / periode" },
];

export const PERIOD_SHIFT = "shift";
export const PERIOD_DAILY = "daily";
export const PERIOD_WEEKLY = "weekly";
export const PERIOD_MONTHLY = "monthly";

export const PERIOD_OPTIONS = [
  { value: PERIOD_SHIFT, label: "Per shift" },
  { value: PERIOD_DAILY, label: "Harian" },
  { value: PERIOD_WEEKLY, label: "Mingguan" },
  { value: PERIOD_MONTHLY, label: "Bulanan" },
];

export const METRIC_REVENUE = "revenue";
export const METRIC_ITEM = "item_quantity";

export const METRIC_OPTIONS = [
  { value: METRIC_REVENUE, label: "Omzet (Rupiah)" },
  { value: METRIC_ITEM, label: "Kuantitas item" },
];

export const UNIT_ITEM = "item";
export const UNIT_CURRENCY = "currency";

const TYPE_LABELS = {
  [TARGET_TYPE_ITEM]: "Kuantitas item",
  [TARGET_TYPE_REVENUE]: "Omzet",
  [TARGET_TYPE_TIME]: "Berbasis waktu",
};

const PERIOD_LABELS = {
  [PERIOD_SHIFT]: "Per shift",
  [PERIOD_DAILY]: "Harian",
  [PERIOD_WEEKLY]: "Mingguan",
  [PERIOD_MONTHLY]: "Bulanan",
};

// Tipe target efektif. Nilai tak dikenal / kosong jatuh ke tipe lama.
export const targetTypeOf = (target) => {
  const value = target?.targetType;
  return Object.prototype.hasOwnProperty.call(TYPE_LABELS, value) ? value : TARGET_TYPE_ITEM;
};

// Label singkat untuk badge di tabel admin.
export const targetTypeLabel = (target) => TYPE_LABELS[targetTypeOf(target)];

export const isItemTarget = (target) => targetTypeOf(target) === TARGET_TYPE_ITEM;
export const isRevenueTarget = (target) => targetTypeOf(target) === TARGET_TYPE_REVENUE;
export const isTimeTarget = (target) => targetTypeOf(target) === TARGET_TYPE_TIME;

// Tipe target butuh daftar produk?
export const needsProducts = (target) =>
  isItemTarget(target) || (isTimeTarget(target) && (target?.metric ?? METRIC_REVENUE) === METRIC_ITEM);

// Tipe target butuh nominal rupiah?
export const needsAmount = (target) =>
  isRevenueTarget(target) || (isTimeTarget(target) && (target?.metric ?? METRIC_REVENUE) === METRIC_REVENUE);

export const periodOf = (target) => {
  const value = target?.periodType;
  return Object.prototype.hasOwnProperty.call(PERIOD_LABELS, value) ? value : PERIOD_SHIFT;
};

export const periodLabel = (target) => PERIOD_LABELS[periodOf(target)];

export const unitOf = (item) => {
  if (item?.unit === UNIT_CURRENCY) return UNIT_CURRENCY;
  if (item?.unit === UNIT_ITEM) return UNIT_ITEM;
  // Fallback untuk data lama yang belum punya "unit".
  return item?.targetQty == null ? UNIT_CURRENCY : UNIT_ITEM;
};

// Nilai target efektif: targetQty untuk item, targetValue/targetAmount untuk omzet.
export const targetValueOf = (item) => {
  const value = item?.targetValue ?? item?.targetAmount ?? item?.targetQty;
  return Number(value) || 0;
};

export const achievedOf = (item) => Number(item?.achieved) || 0;

// Pencapaian dihitung dari nilai target efektif sehingga target omzet
// (yang targetQty-nya null) tetap benar tanpa membagi nol.
export const isAchieved = (item) => {
  const value = targetValueOf(item);
  return value > 0 && achievedOf(item) >= value;
};

// 22:00-02:00 (kosong = sepanjang hari).
export const timeWindowLabel = (target) => {
  const start = target?.startTime?.trim();
  const end = target?.endTime?.trim();
  if (!start && !end) return "";
  if (start && end) return `${start}-${end}`;
  return start ? `mulai ${start}` : `sampai ${end}`;
};

// Ringkasan "apa yang ditargetkan" untuk kolom tabel admin.
export const targetRuleSummary = (target) => {
  if (isItemTarget(target)) return `${targetValueOf(target)} item`;
  if (isRevenueTarget(target)) return rp(targetValueOf(target));
  const metric = (target?.metric ?? METRIC_REVENUE) === METRIC_ITEM
    ? `${targetValueOf(target)} item`
    : rp(target.targetAmount ?? target.targetValue);
  const window = timeWindowLabel(target);
  return window ? `${metric} · ${window}` : metric;
};

// Format angka progres: rupiah untuk target omzet, angka biasa untuk item.
export const formatProgressValue = (item, value) => {
  const amount = Number(value) || 0;
  return unitOf(item) === UNIT_CURRENCY ? rp(amount) : String(amount);
};

// Keterangan tambahan di bawah bar progres (periode/jendela waktu).
export const progressCaption = (item, target) => {
  const source = item || target;
  if (!source) return "";
  if (targetTypeOf(source) !== TARGET_TYPE_TIME && periodOf(source) === PERIOD_SHIFT) return "";
  const parts = [periodLabel(source)];
  const window = timeWindowLabel(source);
  if (window) parts.push(window);
  return parts.filter(Boolean).join(" · ");
};

// Teks badge ringkas untuk riwayat/tutup shift, tipe-agnostik.
// Dipakai di halaman riwayat & dialog cetak tanpa mengubah bentuk
// `targetBadge` lama yang sudah dipakai test.
export const targetBadgeText = (result) => {
  const name = result?.name || "Target";
  const achieved = achievedOf(result);
  const value = targetValueOf(result);
  const text = unitOf(result) === UNIT_CURRENCY
    ? `${rp(achieved)} / ${rp(value)}`
    : `${achieved}/${value}`;
  return { name, text, done: isAchieved(result) };
};
