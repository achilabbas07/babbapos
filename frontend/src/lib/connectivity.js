// Sumber kebenaran TUNGGAL untuk status "online/offline" aplikasi.
//
// Dipakai oleh:
//   - indikator koneksi di header (`ConnectionStatus` -> `useOnlineStatus`),
//   - proyeksi data offline di halaman Meja & Open Bill (bill yang masih
//     mengantre di antrean lokal),
//   - penggantung sinkronisasi antrean (`queueSync` / `useQueueSync`).
//
// Mengapa `navigator.onLine` saja tidak cukup?
// Di WebView Android (Capacitor) `navigator.onLine` sering TETAP `true` walau
// perangkat tidak punya internet, dan event `offline`/`online` tidak selalu
// dipancarkan. Akibatnya indikator bisa menampilkan "Terhubung" sementara
// permintaan ke server gagal (banner "Mode offline" muncul) dan data antrean
// lokal tidak diproyeksikan ke UI. Karena itu modul ini menggabungkan:
//   1. `navigator.onLine` + event `online`/`offline` -> bukti cepat (bisa usang),
//   2. kegagalan fetch/timeout NYATA yang dicatat interceptor axios
//      (`recordNetworkFailure`) -> bukti server tidak terjangkau,
//   3. respons HTTP apa pun (termasuk 4xx/5xx, karena server menjawab) yang
//      dicatat sebagai `recordNetworkSuccess` -> bukti server terjangkau.
// Selama status dianggap offline, modul ini menjalankan probe ringan berkala
// (`/ping`, didaftarkan `api.js`) agar status bisa pulih tanpa aksi pengguna.
//
// Modul ini MURNI frontend: tidak mengubah backend, skema database, alur
// checkout, maupun kalkulasi harga/diskon/HPP.

// Satu kegagalan jaringan dianggap masih berlaku selama ini. Setelahnya status
// kembali "online" sampai ada kegagalan baru (biasanya probe berkala sudah
// menyegarkan nilainya saat perangkat benar-benar tidak terjangkau).
export const NETWORK_FAILURE_TTL_MS = 90_000;

// Interval probe ringan saat status dianggap offline.
export const CONNECTIVITY_PROBE_INTERVAL_MS = 15_000;

// Batas waktu probe supaya permintaan yang menggantung tidak menahan status.
export const CONNECTIVITY_PROBE_TIMEOUT_MS = 5_000;

/** Baca `navigator.onLine`; `null` bila API tidak tersedia (SSR/tes tanpa navigator). */
export const readNavigatorOnline = (nav = typeof navigator === "undefined" ? null : navigator) =>
  nav && typeof nav.onLine === "boolean" ? nav.onLine : null;

/**
 * Fungsi MURNI: tentukan status online dari sinyal yang terkumpul.
 *
 * Aturan:
 *   - kegagalan jaringan yang lebih baru daripada keberhasilan terakhir
 *     (dan belum kedaluwarsa) -> OFFLINE, karena server terbukti tidak terjangkau
 *     walau `navigator.onLine` berkata sebaliknya;
 *   - keberhasilan lebih baru daripada kegagalan -> ONLINE (server menjawab,
 *     jadi interface jaringan pasti ada);
 *   - `navigator.onLine === false` tanpa bukti keberhasilan -> OFFLINE;
 *   - selain itu -> ONLINE (default aman, tidak memblokir alur transaksi).
 *
 * Urutan "lebih baru" ditentukan oleh penghitung urutan monotonik
 * (`lastFailureSeq`/`lastSuccessSeq`), bukan hanya stempel waktu, supaya
 * kegagalan dan keberhasilan yang terjadi pada milidetik yang SAMA tetap
 * terurut dengan pasti (kasus nyata saat probe/sync beruntun).
 * Untuk pemanggil yang hanya mengirim stempel waktu, urutan jatuh kembali ke
 * nilai `lastFailureAt`/`lastSuccessAt`.
 *
 * @param {{navigatorOnline?: boolean|null, lastFailureAt?: number, lastSuccessAt?: number, lastFailureSeq?: number, lastSuccessSeq?: number}} snapshot
 * @param {number} [now]
 * @returns {boolean}
 */
export const resolveOnline = (snapshot, now = Date.now()) => {
  const failureAt = Number(snapshot?.lastFailureAt) || 0;
  const successAt = Number(snapshot?.lastSuccessAt) || 0;
  const failureSeq = snapshot?.lastFailureSeq === undefined ? failureAt : Number(snapshot.lastFailureSeq) || 0;
  const successSeq = snapshot?.lastSuccessSeq === undefined ? successAt : Number(snapshot.lastSuccessSeq) || 0;
  const freshFailure = failureAt > 0 && failureSeq > successSeq && now - failureAt <= NETWORK_FAILURE_TTL_MS;
  if (freshFailure) return false;
  if (snapshot?.navigatorOnline === false) return false;
  return true;
};

// --- State internal (singleton per dokumen) ---------------------------------

const state = {
  // `null` = belum diketahui -> dibaca dari `navigator.onLine` saat snapshot dibuat.
  navigatorOnline: null,
  lastFailureAt: 0,
  lastSuccessAt: 0,
  lastFailureSeq: 0,
  lastSuccessSeq: 0,
};

// Penghitung urutan monotonik: membuat urutan kegagalan vs keberhasilan
// tidak ambigu walau keduanya terjadi pada milidetik yang sama.
let eventSeq = 0;

const listeners = new Set();

// Fungsi probe yang didaftarkan `api.js` (mis. `GET /ping`). Disimpan sebagai
// callback agar modul ini tidak mengimpor `api.js` (mencegah impor sirkular).
let probeRequest = null;
let probeTimer = null;
let monitoring = false;
// Status terakhir yang sudah dipancarkan ke listener. Dipakai agar respons
// HTTP yang sukses beruntun tidak memicu re-render/listener berulang.
let lastEmittedOnline = null;

export const getConnectivitySnapshot = () => {
  const navigatorOnline = state.navigatorOnline === null ? readNavigatorOnline() : state.navigatorOnline;
  const snapshot = {
    navigatorOnline,
    lastFailureAt: state.lastFailureAt,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureSeq: state.lastFailureSeq,
    lastSuccessSeq: state.lastSuccessSeq,
  };
  return { ...snapshot, online: resolveOnline(snapshot) };
};

/** True bila aplikasi dianggap terhubung ke server. */
export const isOnline = () => getConnectivitySnapshot().online;

/** True bila aplikasi dianggap offline/tidak terjangkau (kebalikan `isOnline`). */
export const isOffline = () => !isOnline();

/** Berlangganan perubahan status. Mengembalikan fungsi unsubscribe. */
export const subscribeConnectivity = (listener) => {
  if (typeof listener !== "function") return () => {};
  // Samakan baseline dengan status saat ini supaya respons HTTP pertama tidak
  // memicu notifikasi "berubah" palsu.
  if (lastEmittedOnline === null) lastEmittedOnline = getConnectivitySnapshot().online;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Jadwalkan/hentikan probe ringan sesuai status saat ini.
const syncProbeTimer = (snapshot = getConnectivitySnapshot()) => {
  if (typeof window === "undefined") return;
  const shouldProbe = !snapshot.online && typeof probeRequest === "function";
  if (shouldProbe && probeTimer === null) {
    probeTimer = window.setInterval(() => {
      runConnectivityProbe().catch(() => {});
    }, CONNECTIVITY_PROBE_INTERVAL_MS);
  } else if (!shouldProbe && probeTimer !== null) {
    window.clearInterval(probeTimer);
    probeTimer = null;
  }
};

const emit = () => {
  const snapshot = getConnectivitySnapshot();
  const changed = lastEmittedOnline !== snapshot.online;
  lastEmittedOnline = snapshot.online;
  if (changed) {
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // Notifikasi UI best-effort: satu listener bermasalah tidak boleh
        // menghentikan yang lain.
      }
    }
  }
  syncProbeTimer(snapshot);
  return snapshot;
};

/** Catat bukti "server tidak terjangkau" (fetch gagal / timeout / tanpa respons). */
export const recordNetworkFailure = () => {
  state.lastFailureAt = Date.now();
  state.lastFailureSeq = ++eventSeq;
  return emit();
};

/** Catat bukti "server terjangkau" (ada respons HTTP, termasuk 4xx/5xx). */
export const recordNetworkSuccess = () => {
  state.lastSuccessAt = Date.now();
  state.lastSuccessSeq = ++eventSeq;
  return emit();
};

/**
 * Catat sinyal `navigator.onLine` (dari nilai awal atau event `online`/`offline`).
 * Nilai `true` TIDAK menghapus kegagalan jaringan terakhir, karena di WebView
 * Android `navigator.onLine` bisa usang; hanya keberhasilan nyata yang
 * mengembalikan status ke online.
 */
export const setNavigatorOnline = (value) => {
  const next = value === true ? true : value === false ? false : null;
  if (state.navigatorOnline === next) return getConnectivitySnapshot();
  state.navigatorOnline = next;
  return emit();
};

/** Daftarkan fungsi probe (dipanggil `api.js`). */
export const setConnectivityProbe = (request) => {
  probeRequest = typeof request === "function" ? request : null;
  syncProbeTimer();
};

/**
 * Jalankan probe sekali. Sukses -> tandai online, gagal -> tandai offline.
 * @returns {Promise<boolean>} true bila server terjangkau
 */
export const runConnectivityProbe = async () => {
  if (typeof probeRequest !== "function") return isOnline();
  try {
    await probeRequest();
    recordNetworkSuccess();
    return true;
  } catch {
    recordNetworkFailure();
    return false;
  }
};

/**
 * Pasang listener `online`/`offline` + probe. Idempoten: boleh dipanggil dari
 * banyak komponen. Listener sengaja tidak pernah dilepas karena kondisi koneksi
 * berlaku untuk seluruh masa hidup dokumen.
 */
export const ensureConnectivityMonitor = () => {
  if (monitoring || typeof window === "undefined") return;
  monitoring = true;
  if (state.navigatorOnline === null) state.navigatorOnline = readNavigatorOnline();
  window.addEventListener("online", () => setNavigatorOnline(true));
  window.addEventListener("offline", () => setNavigatorOnline(false));
  syncProbeTimer();
};

/** Reset seluruh state (khusus pengujian). */
export const resetConnectivityForTests = () => {
  state.navigatorOnline = null;
  state.lastFailureAt = 0;
  state.lastSuccessAt = 0;
  state.lastFailureSeq = 0;
  state.lastSuccessSeq = 0;
  eventSeq = 0;
  listeners.clear();
  probeRequest = null;
  lastEmittedOnline = null;
  if (probeTimer !== null && typeof window !== "undefined") window.clearInterval(probeTimer);
  probeTimer = null;
  monitoring = false;
};

export default {
  isOnline,
  isOffline,
  getConnectivitySnapshot,
  subscribeConnectivity,
  recordNetworkFailure,
  recordNetworkSuccess,
  setNavigatorOnline,
  resolveOnline,
};
