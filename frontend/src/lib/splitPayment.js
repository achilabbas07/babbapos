export const PAYMENT_METHODS = ["Cash", "QRIS", "Card", "Debit"];

const amountOf = (leg) => Number(leg?.amount) || 0;

/**
 * Rupiah rounding helper (split allocation is validated on whole rupiah).
 */
export const roundRupiah = (value) => Math.round(Number(value) || 0);

/**
 * Jumlahkan nominal semua kaki pembayaran.
 */
export const sumLegs = (legs = []) => legs.reduce((sum, leg) => sum + amountOf(leg), 0);

/**
 * Total uang yang dibayarkan pada sebuah transaksi.
 *
 * Untuk split payment, jumlahkan seluruh kaki `payments[].amount` (mis.
 * Cash Rp10.000 + QRIS Rp10.000 = Rp20.000) supaya nominal pembayaran dan
 * kembalian tidak pernah memakai satu kaki saja. Bila tidak ada
 * rincian `payments`, pakai nominal tunggal `fallback` (legacy: totalPaid →
 * cashGiven → total).
 */
export const resolvePaidTotal = (payments = [], fallback = 0) => {
  const legs = payments.filter((leg) => amountOf(leg) > 0);
  return legs.length ? roundRupiah(sumLegs(legs)) : roundRupiah(fallback);
};

/**
 * Sisa tagihan yang belum dialokasikan ke salah satu metode.
 */
export const remainingAmount = (total, legs = []) => roundRupiah(total) - roundRupiah(sumLegs(legs));

/**
 * Split dianggap lunas bila setiap kaki berisi nominal > 0 dan totalnya pas.
 * Dibandingkan pada satuan rupiah agar subtotal desimal tidak memblokir.
 */
export const isSplitSettled = (total, legs = []) =>
  legs.length > 0 &&
  legs.every((leg) => amountOf(leg) > 0) &&
  roundRupiah(sumLegs(legs)) === roundRupiah(total);

/**
 * Metode dominan sebuah transaksi multi-pembayaran.
 *
 * Kolom `transactions.method` dibatasi CHECK constraint ke 4 metode, sehingga
 * pembayaran terbagi tidak boleh mengirim "Split". Semua-tunai tetap "Cash",
 * sisanya memakai kaki non-tunai terbesar (atau fallback bila tidak ada).
 */
export const primaryMethod = (legs = [], fallback = "Cash") => {
  if (!legs.length) return fallback;
  if (legs.every((leg) => leg.method === "Cash")) return "Cash";
  const nonCash = legs.filter((leg) => leg.method !== "Cash");
  const dominant = [...(nonCash.length ? nonCash : legs)].sort((a, b) => amountOf(b) - amountOf(a))[0];
  return dominant?.method || fallback;
};

/**
 * Ubah state baris split menjadi payload `payments: [{method, amount}]`.
 */
export const buildPaymentsPayload = (legs = []) =>
  legs.map((leg) => ({ method: leg.method, amount: amountOf(leg) }));

/**
 * Argumen `onPay(method, cashGiven, extra)` untuk pembayaran terbagi.
 *
 * `cashGiven` hanya diisi dari kaki Cash; pembayaran non-tunai murni memakai
 * `total` seperti perilaku lama.
 */
export const splitPayArgs = (total, legs = [], extra = {}) => {
  const payments = buildPaymentsPayload(legs);
  const cashLeg = payments.find((payment) => payment.method === "Cash");
  return {
    method: primaryMethod(payments, "Cash"),
    cashGiven: cashLeg ? cashLeg.amount : roundRupiah(total),
    extra: { ...extra, payments },
  };
};

/**
 * Pilih metode untuk kaki baru: hindari menduplikasi metode yang sudah dipakai.
 */
export const nextLegMethod = (legs = []) => {
  const used = new Set(legs.map((leg) => leg.method));
  return PAYMENT_METHODS.find((method) => !used.has(method)) || PAYMENT_METHODS[0];
};

/**
 * Tambah satu kaki pembayaran baru pada daftar split.
 */
export const appendLeg = (legs = [], method = "Cash", amount = "") => {
  if (legs.length >= PAYMENT_METHODS.length) return legs;
  if (!legs.length) {
    return [
      { method, amount },
      { method: nextLegMethod([{ method }]), amount: "" },
    ];
  }
  return [...legs, { method: nextLegMethod(legs), amount: "" }];
};
