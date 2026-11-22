// Penyimpanan lokal terstruktur untuk Tahap 1 "Offline Read".
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
  WAITERS: "waiters",
  OJOL_MARKUP: "ojol-markup",
});

// Key varian per produk -> "menu-variants:<product_id>".
export const variantsCacheKey = (productId) => `menu-variants:${productId}`;

// Cache profil sesi (id/nama/role user) untuk fallback saat offline. TIDAK
// pernah menyimpan token atau PIN -- token tetap hanya di localStorage
// "pos_token" dan validitasnya tetap diverifikasi ke server saat online.
export const SESSION_USER_KEY = "session-user";

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
