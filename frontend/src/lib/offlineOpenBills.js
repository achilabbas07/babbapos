// Helper MURNI (tanpa React / Supabase / axios) untuk "Open Bill offline":
//  - menentukan permintaan HTTP yang benar saat item antrean disinkronkan,
//  - memproyeksikan item antrean `open-bill-create`/`open-bill-update` yang
//    masih `pending`/`failed` menjadi bentuk data tampilan Open Bill & Meja,
//    sehingga kasir tetap melihat bill baru / tambahan item yang sedang
//    mengantre saat offline.
//
// Modul ini TIDAK mengubah alur pelunasan (`pay()`), kalkulasi harga/diskon/
// pembayaran/HPP, backend, maupun skema database. Ia hanya membaca antrean
// (`TRANSACTION_QUEUE_KEY`) yang sudah ada dan membentuk data tampilan.

export const OPEN_BILL_CREATE_TYPE = "open-bill-create";
export const OPEN_BILL_UPDATE_TYPE = "open-bill-update";
export const OPEN_BILL_QUEUE_TYPES = Object.freeze([OPEN_BILL_CREATE_TYPE, OPEN_BILL_UPDATE_TYPE]);

// Label ringkas status item antrean untuk tampilan kasir.
export const OFFLINE_BILL_STATUS_LABEL = Object.freeze({
  pending: "Menunggu dikirim",
  failed: "Gagal terkirim",
});

// Label jenis aksi antrean (untuk badge di daftar bill).
export const offlineBillActionLabel = (queuedType) =>
  queuedType === OPEN_BILL_UPDATE_TYPE ? "Tambah item" : "Bill baru";

// Normalisasi nilai "none"/undefined -> null (dipakai field opsional).
const optional = (v) => (v === "none" || v === undefined ? null : v ?? null);

// Ubah satu item payload antrean menjadi bentuk item `items_json` Open Bill
// yang bisa dipakai komponen tampilan (groupOrderItemsForDisplay, rp, dst.).
const toDisplayItem = (src) => {
  if (!src || typeof src !== "object") return null;
  const qty = Number(src.qty) || 0;
  const priceRaw = Number(src.price);
  const subtotalRaw = Number(src.subtotal);
  const price = Number.isFinite(priceRaw) ? priceRaw : (qty ? (Number.isFinite(subtotalRaw) ? subtotalRaw : 0) / qty : 0);
  const subtotal = Number.isFinite(subtotalRaw) ? subtotalRaw : price * qty;
  const productName = src.productName || src.variantName || src.name || "Menu";
  return {
    id: src.id ?? null,
    is_printed: Boolean(src.is_printed),
    productId: src.productId ?? null,
    variantId: src.variantId ?? null,
    productName,
    variantName: src.variantName || "",
    name: productName,
    qty,
    notes: src.notes || "",
    waiterId: src.waiterId ?? null,
    waiterName: src.waiterName || "",
    price,
    subtotal,
  };
};

// Bentuk Open Bill dari kandidat antrean. `id` memakai id server bila sudah
// diketahui, atau `client_request_id` sebagai id sementara (bill baru offline
// belum punya id server).
const toOfflineBill = (candidate) => {
  const items = (candidate.items || []).map(toDisplayItem).filter(Boolean);
  const total = items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
  const qty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const stamp = candidate.createdAt || new Date().toISOString();
  return {
    id: candidate.id,
    type: candidate.type || "Dine In",
    tableId: optional(candidate.tableId),
    customerId: optional(candidate.customerId),
    customerName: candidate.customerName || "",
    waiterName: candidate.waiterName || "",
    waiterId: candidate.waiterId ?? null,
    queueNumber: candidate.queueNumber ?? null,
    timestamp: stamp,
    startTime: stamp,
    items_json: items,
    total,
    qty,
    userName: "",
    // Penanda tambahan untuk UI: bill ini belum ada di server.
    offline: true,
    queuedStatus: candidate.queuedStatus,
    queuedType: candidate.queuedType,
    clientRequestId: candidate.id,
  };
};

/**
 * Ambil Open Bill yang masih mengantre dari daftar item antrean transaksi.
 *
 * Hanya item tipe `open-bill-create`/`open-bill-update` dengan status
 * `pending`/`failed` yang diproyeksikan. Bila satu bill punya beberapa aksi
 * (mis. dibuat lalu ditambah item), aksi paling baru (`open-bill-update`)
 * menang sehingga jumlah item yang ditampilkan sesuai kondisi terkini.
 *
 * @param {unknown} queue daftar item dari `getTransactionQueue()`
 * @returns {Array<object>} daftar Open Bill (bentuk mirip respons `GET /open-bills`)
 */
export const pendingOpenBillsFromQueue = (queue = []) => {
  const list = Array.isArray(queue) ? queue : [];
  const byBill = new Map();

  for (const item of list) {
    const queuedType = item?.type;
    if (!OPEN_BILL_QUEUE_TYPES.includes(queuedType)) continue;
    const status = item?.status || "pending";
    if (status !== "pending" && status !== "failed") continue;

    const payload = item?.payload || {};
    const id = payload.billId || item?.client_request_id || "";
    if (!id) continue;

    const candidate = {
      id,
      queuedType,
      queuedStatus: status,
      createdAt: item?.createdAt || null,
      type: typeof payload.type === "string" && payload.type ? payload.type : "Dine In",
      tableId: payload.tableId ?? null,
      customerId: payload.customerId ?? null,
      customerName: payload.customerName || "",
      waiterName: payload.waiterName || "",
      waiterId: payload.waiterId ?? null,
      queueNumber: payload.queueNumber ?? null,
      items: Array.isArray(payload.items) ? payload.items : [],
    };

    const prev = byBill.get(id);
    if (!prev || isNewer(candidate, prev)) byBill.set(id, candidate);
  }

  return [...byBill.values()].map(toOfflineBill);
};

// `open-bill-update` lebih baru daripada `open-bill-create`; bila sama-sama
// update, yang `createdAt` paling akhir menang.
const isNewer = (a, b) => {
  const au = a.queuedType === OPEN_BILL_UPDATE_TYPE ? 1 : 0;
  const bu = b.queuedType === OPEN_BILL_UPDATE_TYPE ? 1 : 0;
  if (au !== bu) return au > bu;
  return (Date.parse(a.createdAt || 0) || 0) >= (Date.parse(b.createdAt || 0) || 0);
};

/** True bila perangkat sedang offline (`navigator.onLine === false`). */
export const isOfflineMode = (navigatorLike = typeof navigator !== "undefined" ? navigator : undefined) =>
  Boolean(navigatorLike && navigatorLike.onLine === false);

/**
 * Gabungkan Open Bill hasil antrean (belum ada di server) dengan daftar cache.
 * Bill yang id-nya sudah ada di cache diabaikan agar tidak dobel.
 */
export const mergeOfflineBills = (cached, offline) => {
  const list = Array.isArray(cached) ? cached : [];
  const extras = (Array.isArray(offline) ? offline : []).filter(
    (bill) => bill?.id && !list.some((existing) => existing?.id === bill.id),
  );
  return [...extras, ...list];
};

/** Proyeksikan Open Bill antrean ke item Daftar Open Bill (dipakai komponen). */
export const withOfflineBills = (cached, queue, offline = isOfflineMode()) =>
  (offline ? mergeOfflineBills(cached, pendingOpenBillsFromQueue(queue)) : (Array.isArray(cached) ? cached : []));

/**
 * Tandai meja yang punya Open Bill masih mengantre sebagai `occupied` agar
 * status meja di denah ikut memperlihatkan pesanan yang belum terkirim.
 */
export const mergeOfflineTables = (cachedTables, offlineBills) => {
  const tables = Array.isArray(cachedTables) ? cachedTables.map((table) => ({ ...table })) : [];
  for (const bill of Array.isArray(offlineBills) ? offlineBills : []) {
    if (!bill?.tableId) continue;
    const table = tables.find((t) => t?.id === bill.tableId);
    if (!table) continue;
    table.status = "occupied";
    table.orderData = {
      ...(table.orderData && typeof table.orderData === "object" ? table.orderData : {}),
      openBillId: bill.id,
      total: bill.total,
      customerName: bill.customerName || "",
      startTime: bill.startTime,
      offline: true,
    };
  }
  return tables;
};

/** Proyeksikan antrean ke denah Meja (dipakai komponen).
 *  Mengembalikan `{ tables, offlineBills }` agar pemanggil bisa memakai daftar
 *  bill antrean tanpa menghitung ulang. */
export const withOfflineTables = (cachedTables, queue, offline = isOfflineMode()) => {
  const offlineBills = offline ? pendingOpenBillsFromQueue(queue) : [];
  return { tables: mergeOfflineTables(cachedTables, offlineBills), offlineBills };
};

/**
 * Ubah Open Bill antrean menjadi `order` POS (bentuk sama seperti fallback
 * cache `GET /open-bills/{id}`) sehingga keranjang bisa dibuka untuk bill yang
 * belum tersimpan di server.
 */
export const offlineOrderFromBill = (bill) => {
  if (!bill?.id) return null;
  return {
    billId: bill.id,
    queueNumber: bill.queueNumber ?? null,
    type: bill.type || "Dine In",
    tableId: bill.tableId || "none",
    customerId: bill.customerId || "none",
    customerName: bill.customerName || "",
    waiterName: bill.waiterName || "",
    waiterId: bill.waiterId ?? null,
  };
};

/**
 * Tentukan permintaan HTTP untuk satu item antrean.
 *
 *   - `open-bill-create` -> POST /open-bills   (bill baru; `client_request_id`
 *     server HANYA dipakai untuk idempotensi transaksi, jadi field itu dibuang
 *     agar tidak ditolak validasi backend),
 *   - `open-bill-update` -> PUT  /open-bills/{billId} (tambah/ubah item),
 *   - lainnya            -> POST /transactions (perilaku lama, tidak berubah).
 *
 * @returns {{method:"post"|"put", url:string, body:object}}
 */
export const resolveQueueRequest = (item) => {
  const payload = { ...(item?.payload || {}) };
  const clientRequestId = item?.client_request_id || payload.client_request_id || "";
  const type = payload.type;

  if (type === OPEN_BILL_CREATE_TYPE) {
    delete payload.type;
    delete payload.client_request_id;
    return { method: "post", url: "/open-bills", body: payload };
  }

  if (type === OPEN_BILL_UPDATE_TYPE && payload.billId) {
    const billId = payload.billId;
    delete payload.type;
    delete payload.client_request_id;
    delete payload.billId;
    return { method: "put", url: `/open-bills/${billId}`, body: payload };
  }

  return {
    method: "post",
    url: "/transactions",
    body: { ...payload, client_request_id: clientRequestId },
  };
};

export default {
  OPEN_BILL_CREATE_TYPE,
  OPEN_BILL_UPDATE_TYPE,
  pendingOpenBillsFromQueue,
  mergeOfflineBills,
  mergeOfflineTables,
  withOfflineBills,
  withOfflineTables,
  offlineOrderFromBill,
  resolveQueueRequest,
};
