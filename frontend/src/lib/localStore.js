// Penyimpanan lokal terstruktur untuk Tahap 1 "Offline Read".
// Juga menjadi fondasi Tahap 2 "Offline Queue": pembuat `client_request_id`
// unik + CRUD dasar antrean transaksi persisten (belum dihubungkan ke alur
// transaksi/checkout -- murni penyimpanan).
//
// Tujuan: meng-cache DATA MASTER (produk, stok, meja, pelanggan, pelayan,
// markup ojol, dan varian per produk) agar halaman kasir tetap bisa menampilkan
// data terakhir ketika perangkat sedang offline / fetch gagal karena jaringan.
//
// - Backend utama: IndexedDB (kapasitas besar, async, tidak memblok UI).
// - Fallback otomatis: localStorage bila IndexedDB tidak tersedia (browser lama,
//   mode privat tertentu, atau WebView yang memblokir IndexedDB).
// - Selalu menyimpan `{ data, updatedAt }` supaya umur cache bisa ditampilkan.
//
// Modul ini TIDAK menyentuh alur transaksi/checkout, harga, stok, atau jurnal.
// Hanya baca/tulis cache lokal. Semua operasi best-effort: kegagalan storage
// tidak boleh menggagalkan aplikasi (dikembalikan sebagai null / resolve).

const DB_NAME = "babbapos-offline";
const DB_VERSION = 1;
const STORE_NAME = "refs";
const LS_PREFIX = "babbapos.offline.ref.";

// Daftar key cache yang dikenali (mencegah key liar / typo).
export const CACHE_KEYS = Object.freeze({
  PRODUCTS: "products",
  PRODUCTS_STOCK: "products/stock",
  TABLES: "tables",
  CUSTOMERS: "customers",
  CUSTOMERS_TOP: "customers/top",
  CUSTOMER_PURCHASES: "customers/purchases",
  WAITERS: "waiters",
  USERS: "users",
  INVENTORY: "inventory",
  RECIPES: "recipes",
  OPEN_BILLS: "open-bills",
  TRANSACTIONS: "transactions",
  SHIFTS: "shifts",
  PURCHASES: "purchases",
  EXPENSES: "expenses",
  EXPENSE_CATEGORIES: "expense-categories",
  TARGETS: "targets",
  TARGET_PROGRESS: "targets/progress",
  REPORTS_SUMMARY: "reports/summary",
  PROMO_REPORT: "reports/promo",
  OWNER_DASHBOARD: "reports/owner",
  SCHEMA_COUNTS: "schema",
  COA_ACCOUNTS: "chart-of-accounts",
  OJOL_MARKUP: "ojol-markup",
});

// Key varian per produk -> "menu-variants:<product_id>".
export const variantsCacheKey = (productId) => `menu-variants:${productId}`;

// Key cache detail Open Bill -> "open-bill:<bill_id>". Dipakai sebagai fallback
// baca saat perangkat offline / fetch gagal jaringan, sehingga keranjang POS
// masih bisa dibuka untuk menambah item atau melanjutkan pesanan.
export const openBillCacheKey = (billId) => `open-bill:${billId}`;

// Cache profil sesi (id/nama/role user) untuk fallback saat offline. TIDAK
// pernah menyimpan token atau PIN -- token tetap hanya di localStorage
// "pos_token" dan validitasnya tetap diverifikasi ke server saat online.
export const SESSION_USER_KEY = "session-user";

// Cache shift aktif untuk fallback saat offline. Dibedakan per endpoint supaya
// shift KASIR ("/shifts/current") dan shift PELAYAN ("/waiter-shifts/current")
// tidak pernah tertukar. Data `shift` boleh null (artinya memang tak ada shift
// terbuka) -- dibaca via `readCache` agar "ada record" vs "belum ada record"
// tetap bisa dibedakan.
export const activeShiftCacheKey = (endpoint) => `active-shift:${endpoint}`;

const hasIndexedDB = () => {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
};

const hasLocalStorage = () => {
  try {
    return typeof window !== "undefined" && window.localStorage != null;
  } catch {
    return false;
  }
};

// ---------- Backend IndexedDB ----------
let dbPromise = null;

const openDb = () => {
  if (!hasIndexedDB()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => done(null);
      request.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });
  return dbPromise;
};

const idbRequest = (request) =>
  new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });

const idbGet = async (key) => {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const record = await idbRequest(tx.objectStore(STORE_NAME).get(key));
    return record && typeof record === "object" && "data" in record ? record : null;
  } catch {
    return null;
  }
};

const idbSet = async (key, record) => {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    await idbRequest(tx.objectStore(STORE_NAME).put({ key, ...record }));
    return true;
  } catch {
    return false;
  }
};

const idbDelete = async (key) => {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    await idbRequest(tx.objectStore(STORE_NAME).delete(key));
    return true;
  } catch {
    return false;
  }
};

// ---------- Backend localStorage (fallback) ----------
const lsGet = (key) => {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(`${LS_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && "data" in parsed ? parsed : null;
  } catch {
    return null;
  }
};

const lsSet = (key, record) => {
  if (!hasLocalStorage()) return false;
  try {
    window.localStorage.setItem(`${LS_PREFIX}${key}`, JSON.stringify(record));
    return true;
  } catch {
    // Kuota penuh / storage ditolak -> jangan ganggu aplikasi.
    return false;
  }
};

const lsDelete = (key) => {
  if (!hasLocalStorage()) return false;
  try {
    window.localStorage.removeItem(`${LS_PREFIX}${key}`);
    return true;
  } catch {
    return false;
  }
};

// ---------- API publik (selalu best-effort) ----------

// Simpan `data` ke cache dengan stempel waktu. Mengembalikan record yang
// tersimpan (atau null bila storage tidak tersedia / gagal).
export async function saveCache(key, data) {
  const record = { data, updatedAt: new Date().toISOString() };
  const okIdb = await idbSet(key, record);
  if (okIdb) {
    // Bersihkan salinan localStorage lama agar tidak ada dua sumber kebenaran.
    lsDelete(key);
    return record;
  }
  const okLs = lsSet(key, record);
  return okLs ? record : null;
}

// Baca cache: `{ data, updatedAt }` atau null bila belum ada.
export async function readCache(key) {
  const fromIdb = await idbGet(key);
  if (fromIdb) return fromIdb;
  return lsGet(key);
}

// Baca hanya payload data (tanpa metadata). Berguna sebagai fallback fetch.
export async function readCacheData(key) {
  const record = await readCache(key);
  return record ? record.data : null;
}

// Umur cache dalam milidetik (null bila belum pernah disimpan).
export async function cacheAgeMs(key) {
  const record = await readCache(key);
  if (!record?.updatedAt) return null;
  const ts = Date.parse(record.updatedAt);
  if (Number.isNaN(ts)) return null;
  return Date.now() - ts;
}

// Hapus satu key dari kedua backend.
export async function clearCache(key) {
  const okIdb = await idbDelete(key);
  const okLs = lsDelete(key);
  return okIdb || okLs;
}

// ===========================================================================
// Tahap 2 -- FONDASI ANTREAN TRANSAKSI LOKAL (idempotency + queue)
// ===========================================================================
//
// Bagian ini HANYA menyediakan penyimpanan. Ia TIDAK dipanggil oleh alur
// transaksi/checkout/open bill, tidak mengubah payload yang dikirim ke server,
// dan tidak mengubah backend/skema DB. Tujuannya: menyiapkan `client_request_id`
// (kunci idempotensi) + antrean persisten yang bisa dipakai Tahap 2 nanti.

// Status standar sebuah item antrean.
export const QUEUE_STATUS = Object.freeze({
  PENDING: "pending",
  SYNCING: "syncing",
  FAILED: "failed",
});

// Key penyimpanan antrean (satu collection berisi array item).
export const TRANSACTION_QUEUE_KEY = "transaction-queue";

// Pembuat `client_request_id` unik untuk idempotensi pengiriman transaksi.
// Dipakai agar percobaan ulang (retry) tidak menghasilkan transaksi ganda.
export function makeClientRequestId(prefix = "crq") {
  const stamp = Date.now().toString(36);
  let random;
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      random = crypto.randomUUID();
    }
  } catch {
    random = null;
  }
  if (!random) {
    random = `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${prefix}-${stamp}-${random}`;
}

// Serialisasi read-modify-write antrean di dalam satu tab agar penambahan /
// pembaruan bersamaan tidak saling menimpa.
let queueChain = Promise.resolve();
const withQueueLock = (fn) => {
  const run = queueChain.then(fn, fn);
  queueChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

const readQueue = async () => {
  const data = await readCacheData(TRANSACTION_QUEUE_KEY);
  return Array.isArray(data) ? data : [];
};

const writeQueue = (list) => saveCache(TRANSACTION_QUEUE_KEY, list);

// Ambil daftar antrean (selalu array, urut sesuai waktu penambahan).
export async function getTransactionQueue() {
  return readQueue();
}

// Ambil satu item antrean berdasarkan `client_request_id`.
export async function getQueuedTransaction(clientRequestId) {
  const queue = await readQueue();
  return queue.find((item) => item.client_request_id === clientRequestId) ?? null;
}

// Jumlah item dalam antrean.
export async function countTransactionQueue() {
  const queue = await readQueue();
  return queue.length;
}

// Tambah item antrean. `client_request_id` dihasilkan otomatis bila tidak
// diberikan. Mengembalikan item yang tersimpan (atau null bila storage gagal).
export async function enqueueTransaction(payload, meta = {}) {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const now = new Date().toISOString();
    const item = {
      client_request_id: meta.clientRequestId || makeClientRequestId(),
      type: meta.type || "transaction",
      payload: payload ?? null,
      status: meta.status || QUEUE_STATUS.PENDING,
      retryCount: Number.isInteger(meta.retryCount) ? meta.retryCount : 0,
      createdAt: now,
      updatedAt: now,
      lastAttemptAt: null,
      lastError: null,
      nextAttemptAt: null,
    };
    const next = [...queue.filter((q) => q.client_request_id !== item.client_request_id), item];
    const ok = await writeQueue(next);
    return ok ? item : null;
  });
}

// Perbarui sebagian field item antrean (status, retryCount, lastError, dst).
export async function updateTransactionQueueItem(clientRequestId, patch = {}) {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const index = queue.findIndex((q) => q.client_request_id === clientRequestId);
    if (index === -1) return null;
    const updated = {
      ...queue[index],
      ...patch,
      client_request_id: clientRequestId,
      updatedAt: new Date().toISOString(),
    };
    const next = [...queue];
    next[index] = updated;
    const ok = await writeQueue(next);
    return ok ? updated : null;
  });
}

// Naikkan `retryCount` satu langkah + catat error percobaan terakhir.
export async function incrementQueueRetry(clientRequestId, { error = null, nextAttemptAt = null } = {}) {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const index = queue.findIndex((q) => q.client_request_id === clientRequestId);
    if (index === -1) return null;
    const prev = queue[index];
    const now = new Date().toISOString();
    const updated = {
      ...prev,
      retryCount: (Number(prev.retryCount) || 0) + 1,
      lastAttemptAt: now,
      lastError: error == null ? prev.lastError ?? null : String(error),
      nextAttemptAt: nextAttemptAt ?? prev.nextAttemptAt ?? null,
      updatedAt: now,
    };
    const next = [...queue];
    next[index] = updated;
    const ok = await writeQueue(next);
    return ok ? updated : null;
  });
}

// Hapus item yang sudah sukses terkirim. Mengembalikan true bila ada yang dihapus.
export async function removeTransactionQueueItem(clientRequestId) {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const next = queue.filter((q) => q.client_request_id !== clientRequestId);
    if (next.length === queue.length) return false;
    return writeQueue(next);
  });
}

// Kosongkan seluruh antrean.
export async function clearTransactionQueue() {
  return withQueueLock(() => writeQueue([]));
}
