// Kompatibilitas Mode Owner (fallback baca-saja).
//
// Halaman "Pantauan Pemilik" idealnya membaca satu endpoint gabungan
// `/reports/owner-monitor`. Bila backend yang melayani APK belum memiliki rute
// tersebut (mis. server lama yang belum di-deploy ulang), rute itu menjawab
// `404 {"detail":"Not Found"}` sehingga halaman Pantauan Pemilik gagal tampil.
//
// Modul ini menyusun payload BENTUK-SAMA dari endpoint BACA-SAJA yang sudah
// lama tersedia, sehingga APK Mode Owner tetap menampilkan pantauan. Modul ini
// MURNI (tanpa React/DOM), hanya boleh memanggil GET, dan tidak pernah menulis,
// mengubah, atau menghapus data. Tidak menyentuh alur HPP, pemakaian stok saat
// pembayaran, antrean offline, autentikasi/sesi, jurnal diskon, maupun cetak
// dapur.
//
// Endpoint yang dipakai (semua GET/baca-saja, semuanya sudah ada di backend
// lama): `/transactions`, `/open-bills`, `/tables`, `/inventory`,
// `/targets/progress`, dan `/finance/profit-loss`.

const WITA_OFFSET = "+08:00";
const pad2 = (n) => String(n).padStart(2, "0");
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * True bila kegagalan `/reports/owner-monitor` berarti rute gabungan memang
 * BELUM ada di server (bukan error bisnis/jaringan biasa). FastAPI menjawab
 * `404 {"detail":"Not Found"}` untuk rute yang tidak dikenal, sedangkan `405`
 * (metode salah) dan `501` (belum diimplementasi) juga menandakan hal serupa.
 *
 * Pada kasus ini halaman Pantauan Pemilik harus jatuh ke kompatibilitas
 * baca-saja; error lain (mis. jaringan/500) TIDAK memicu fallback.
 */
export const isOwnerMonitorUnavailable = (error) => {
  const status = error?.response?.status;
  return status === 404 || status === 405 || status === 501;
};

/** Tanggal kalender WITA (Asia/Makassar, UTC+8) dari sebuah instant. */
export const witaDateParts = (now = new Date()) => {
  const wita = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return { year: wita.getUTCFullYear(), month: wita.getUTCMonth() + 1, day: wita.getUTCDate() };
};

/** Jumlah hari pada bulan `month` (1-12) tahun `year`. */
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Format "YYYY-MM-DD". */
export const toDateOnly = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

/** Tambah `n` hari pada string "YYYY-MM-DD" (murni UTC, aman lintas zona). */
export const addDays = (dateStr, n) => {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const base = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  base.setUTCDate(base.getUTCDate() + n);
  return toDateOnly(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
};

/**
 * Rentang kalender WITA (inklusif) untuk filter Bulan/Tanggal, meniru
 * `_owner_period_bounds` di backend.
 *
 * @param {{month?: number, year?: number, start?: string, end?: string}} [filter]
 * @param {Date} [now] acuan bila filter kosong
 */
export const ownerPeriodBounds = (filter = {}, now = new Date()) => {
  const month = filter.month != null ? Number(filter.month) : null;
  const year = filter.year != null ? Number(filter.year) : null;
  if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year >= 1) {
    return {
      start: toDateOnly(year, month, 1),
      end: toDateOnly(year, month, daysInMonth(year, month)),
      month,
      year,
      mode: "month",
    };
  }
  if (filter.start && filter.end) {
    return {
      start: String(filter.start).slice(0, 10),
      end: String(filter.end).slice(0, 10),
      month: null,
      year: null,
      mode: "range",
    };
  }
  const today = witaDateParts(now);
  return {
    start: toDateOnly(today.year, today.month, 1),
    end: toDateOnly(today.year, today.month, daysInMonth(today.year, today.month)),
    month: today.month,
    year: today.year,
    mode: "month",
  };
};

/** Ringkas omzet dari daftar transaksi (bentuk `/transactions`). */
export const summarizeTransactions = (txs = []) => {
  const list = Array.isArray(txs) ? txs : [];
  let revenue = 0;
  let items = 0;
  for (const tx of list) {
    revenue += num(tx?.total);
    for (const item of Array.isArray(tx?.items_json) ? tx.items_json : []) items += num(item?.qty);
  }
  return {
    total_revenue: revenue,
    transaction_count: list.length,
    total_items: items,
    average_order_value: list.length ? revenue / list.length : 0,
  };
};

/** Bagian `open_bills` dari daftar open bill + peta nama meja. */
export const summarizeOpenBills = (bills = [], tableNames = {}) => {
  const list = Array.isArray(bills) ? bills : [];
  return {
    count: list.length,
    total_value: list.reduce((sum, bill) => sum + num(bill?.total), 0),
    truncated: false,
    items: list.map((bill) => ({
      id: bill?.id ?? null,
      date: String(bill?.timestamp ?? "").slice(0, 10),
      timestamp: bill?.timestamp ?? null,
      type: bill?.type ?? "",
      table_id: bill?.tableId ?? null,
      table_name: tableNames[bill?.tableId] ?? bill?.tableName ?? "",
      customer_name: bill?.customerName ?? "",
      waiter_name: bill?.waiterName ?? "",
      item_count: Array.isArray(bill?.items_json)
        ? bill.items_json.reduce((sum, item) => sum + num(item?.qty), 0)
        : 0,
      total: num(bill?.total),
    })),
  };
};

/** Bagian `inventory` dari daftar bahan `/inventory`. */
export const summarizeInventory = (stocks = []) => {
  const list = Array.isArray(stocks) ? stocks : [];
  const items = list.map((row) => {
    const stock = num(row?.stock);
    const cost = num(row?.cost_per_unit);
    const minStock = num(row?.min_stock);
    return {
      id: row?.id ?? null,
      name: row?.name ?? "",
      type: row?.type ?? "",
      stock,
      unit: row?.unit ?? "",
      cost_per_unit: cost,
      min_stock: minStock,
      stock_value: stock * cost,
      is_low: minStock > 0 && stock <= minStock,
    };
  });
  return {
    count: items.length,
    low_stock_count: items.filter((row) => row.is_low).length,
    total_stock_value: items.reduce((sum, row) => sum + row.stock_value, 0),
    truncated: false,
    items,
  };
};

/**
 * Bagian `active_shifts` dari `/targets/progress` (semua shift terbuka) plus
 * ringkasan transaksi periode ini (untuk item terjual, promo, dan redeem poin).
 *
 * Catatan: total void tidak tersedia dari endpoint lama (transaksi yang dibatalkan
 * tidak lagi ada di daftar transaksi), jadi dilaporkan 0 — bukan angka palsu.
 */
export const summarizeActiveShifts = (progress = [], txs = []) => {
  const shifts = Array.isArray(progress) ? progress : [];
  const list = Array.isArray(txs) ? txs : [];
  return shifts.map((row) => {
    const shiftId = row?.shiftId ?? null;
    const mine = shiftId ? list.filter((tx) => tx?.shiftId === shiftId) : [];
    const promo = mine.filter((tx) => num(tx?.promoDiscount) > 0 || tx?.promoCode);
    const redeem = mine.filter((tx) => num(tx?.pointsRedeemed) > 0);
    return {
      shift_id: shiftId,
      waiter_id: row?.waiterId ?? null,
      waiter_name: row?.waiterName ?? "",
      opened_at: row?.openedAt ?? null,
      total_orders: mine.length,
      total_items_sold: mine.reduce(
        (sum, tx) =>
          sum + (Array.isArray(tx?.items_json) ? tx.items_json.reduce((q, item) => q + num(item?.qty), 0) : 0),
        0,
      ),
      total_voids: 0,
      void_qty: 0,
      void_value: 0,
      promo_usage: {
        count: promo.length,
        discount: promo.reduce((sum, tx) => sum + num(tx?.promoDiscount), 0),
      },
      redeem_points: {
        count: redeem.length,
        points: redeem.reduce((sum, tx) => sum + num(tx?.pointsRedeemed), 0),
        discount: redeem.reduce((sum, tx) => sum + num(tx?.pointsDiscount), 0),
      },
      void_details: [],
    };
  });
};

/** Bagian `profit_loss` dari respons `/finance/profit-loss` (memakai `.summary`). */
export const summarizeProfitLoss = (report = {}) => {
  const summary = report?.summary ?? report ?? {};
  return {
    revenue: num(summary?.revenue),
    sales_discount: num(summary?.sales_discount),
    hpp: num(summary?.hpp),
    expenses: num(summary?.expenses),
    net_profit: num(summary?.net_profit),
  };
};

/**
 * Susun payload bentuk-`/reports/owner-monitor` dari endpoint baca-saja lama.
 *
 * @param {{month?: number, year?: number, start?: string, end?: string}} [filter]
 * @param {{get: (url: string, config?: object) => Promise<any>}} [client] klien HTTP (mis. instance axios `api`)
 * @returns {Promise<object>} payload siap dinormalkan `normalizeOwnerDashboard`
 */
export async function buildOwnerMonitorFallback(filter = {}, client) {
  const period = ownerPeriodBounds(filter);
  // Rentang pembayaran kalender WITA: [start 00:00 WITA, sehari setelah end 00:00 WITA).
  const range = {
    start: `${period.start}T00:00:00${WITA_OFFSET}`,
    end: `${addDays(period.end, 1)}T00:00:00${WITA_OFFSET}`,
  };
  const plParams =
    period.mode === "month"
      ? { month: period.month, year: period.year }
      : { start: period.start, end: period.end };

  const get = typeof client?.get === "function" ? (url, config) => client.get(url, config) : null;
  const safe = async (url, config) => {
    if (!get) return null;
    try {
      const res = await get(url, config);
      return res && typeof res === "object" && "data" in res ? res.data : res;
    } catch {
      // Setiap bagian bersifat best-effort: satu endpoint gagal tidak menggagalkan
      // seluruh halaman (bagian terkait tampil kosong, bukan layar error).
      return null;
    }
  };

  const [txs, bills, tables, stocks, progress, pl] = await Promise.all([
    safe("/transactions", { params: range }),
    safe("/open-bills"),
    safe("/tables"),
    safe("/inventory"),
    safe("/targets/progress"),
    safe("/finance/profit-loss", { params: plParams }),
  ]);

  const tableNames = {};
  for (const table of Array.isArray(tables) ? tables : []) {
    if (table?.id != null) tableNames[table.id] = table?.name ?? "";
  }

  return {
    readonly: true,
    source: "compat-fallback",
    period: {
      start: period.start,
      end: period.end,
      month: period.month ?? 0,
      year: period.year ?? 0,
      label: `${period.start} s.d. ${period.end}`,
      generated_at: new Date().toISOString(),
    },
    omzet: summarizeTransactions(txs),
    open_bills: summarizeOpenBills(bills, tableNames),
    inventory: summarizeInventory(stocks),
    active_shifts: summarizeActiveShifts(progress, txs),
    profit_loss: summarizeProfitLoss(pl),
  };
}
