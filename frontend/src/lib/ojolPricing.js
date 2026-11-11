// Logika harga markup Ojol GLOBAL (persentase tunggal) untuk menu ber-varian.
//
// Satu persentase berlaku otomatis di kanal "Ojek Online" untuk SEMUA menu
// ber-varian, tanpa input per item dan TANPA kolom/tabel database baru.
//
// Rumus: Harga Varian Reguler * (1 + Global Markup % / 100).
//
// Harga varian reguler = harga produk + additional_price varian. Bila produk
// sudah punya harga Ojol khusus (price_ojol > 0), harga itu tetap diutamakan
// (ditambah surcharge varian) dan tidak dikenai markup lagi.
//
// Nilai default dibaca dari REACT_APP_OJOL_MARKUP_PERCENT (default 20%). Backend
// tetap menjadi sumber kebenaran saat checkout; helper ini dipakai untuk preview
// harga real-time di kasir supaya angka di layar sama dengan yang ditagih.

export const DEFAULT_OJOL_MARKUP_PERCENT = 20;

const parsePercent = (raw, fallback) => {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export const resolveOjolMarkupPercent = (raw = process.env.REACT_APP_OJOL_MARKUP_PERCENT) =>
  parsePercent(raw, DEFAULT_OJOL_MARKUP_PERCENT);

export const isOjolOrder = (orderType) => orderType === "Ojek Online";

// Apakah produk punya harga Ojol khusus (per produk) yang menimpa markup global.
export const hasSpecificOjolPrice = (priceOjol) => Number(priceOjol) > 0;

// Harga varian reguler: harga produk (atau harga Ojol khusus) + surcharge varian.
export const regularVariantPrice = (price, extra = 0) => (Number(price) || 0) + (Number(extra) || 0);

/**
 * Harga satu porsi untuk menu ber-varian pada kanal Ojol.
 * @param {object} p - data produk ({ price, price_ojol }).
 * @param {number} extra - additional_price varian.
 * @param {number} markupPercent - markup Ojol global.
 * @param {boolean} ojol - apakah kanal Ojol aktif.
 * @returns {number} harga final satu porsi.
 */
export const ojolVariantPrice = (p, extra = 0, markupPercent = resolveOjolMarkupPercent(), ojol = true) => {
  const base = Number(p?.price) || 0;
  const surcharge = Number(extra) || 0;
  if (!ojol) return base + surcharge;
  const specific = Number(p?.price_ojol) || 0;
  if (specific > 0) return specific + surcharge;
  return (base + surcharge) * (1 + (Number(markupPercent) || 0) / 100);
};
