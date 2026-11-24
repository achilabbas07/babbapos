import {
  NETWORK_FAILURE_TTL_MS,
  getConnectivitySnapshot,
  isOffline,
  isOnline,
  recordNetworkFailure,
  recordNetworkSuccess,
  resetConnectivityForTests,
  resolveOnline,
  runConnectivityProbe,
  setConnectivityProbe,
  setNavigatorOnline,
  subscribeConnectivity,
} from "./connectivity";

// Modul ini adalah sumber kebenaran TUNGGAL status online/offline. Tes di bawah
// memverifikasi aturan penggabungan sinyal, khususnya kasus WebView Android di
// mana `navigator.onLine` tetap `true` walau server tidak terjangkau.

describe("resolveOnline", () => {
  it("offline ketika ada kegagalan jaringan yang lebih baru dari keberhasilan", () => {
    const now = 1_000_000;
    expect(resolveOnline({ navigatorOnline: true, lastFailureAt: now - 1000, lastSuccessAt: now - 5000 }, now)).toBe(false);
  });

  it("online ketika server terbukti menjawab (respons setelah kegagalan)", () => {
    const now = 1_000_000;
    expect(resolveOnline({ navigatorOnline: true, lastFailureAt: now - 5000, lastSuccessAt: now - 1000 }, now)).toBe(true);
  });

  it("kegagalan yang sudah kedaluwarsa tidak lagi menahan status offline", () => {
    const now = 1_000_000;
    expect(resolveOnline({ navigatorOnline: true, lastFailureAt: now - NETWORK_FAILURE_TTL_MS - 1, lastSuccessAt: 0 }, now)).toBe(true);
  });

  it("navigator.onLine === false menandai offline walau tanpa kegagalan tercatat", () => {
    expect(resolveOnline({ navigatorOnline: false, lastFailureAt: 0, lastSuccessAt: 0 }, 1)).toBe(false);
  });

  it("default aman: online bila tidak ada sinyal apa pun", () => {
    expect(resolveOnline({ navigatorOnline: null, lastFailureAt: 0, lastSuccessAt: 0 }, 1)).toBe(true);
    expect(resolveOnline({}, 1)).toBe(true);
  });

  it("kegagalan & keberhasilan pada milidetik SAMA tetap terurut oleh penghitung urutan", () => {
    const now = 1_000_000;
    // Nilai `at` identik: hanya urutan (seq) yang membedakan mana yang terakhir.
    expect(
      resolveOnline(
        { navigatorOnline: true, lastFailureAt: now, lastSuccessAt: now, lastFailureSeq: 2, lastSuccessSeq: 1 },
        now,
      ),
    ).toBe(false);
    expect(
      resolveOnline(
        { navigatorOnline: true, lastFailureAt: now, lastSuccessAt: now, lastFailureSeq: 1, lastSuccessSeq: 2 },
        now,
      ),
    ).toBe(true);
  });

  it("tanpa penghitung urutan, urutan jatuh kembali ke stempel waktu", () => {
    const now = 1_000_000;
    expect(resolveOnline({ navigatorOnline: true, lastFailureAt: now, lastSuccessAt: now - 1 }, now)).toBe(false);
    expect(resolveOnline({ navigatorOnline: true, lastFailureAt: now - 1, lastSuccessAt: now }, now)).toBe(true);
    // Stempel waktu sama tanpa seq -> dianggap bukan kegagalan segar (default aman: online).
    expect(resolveOnline({ navigatorOnline: true, lastFailureAt: now, lastSuccessAt: now }, now)).toBe(true);
  });

  it("kegagalan tercatat tanpa stempel waktu (0) tidak pernah menahan status offline", () => {
    expect(resolveOnline({ navigatorOnline: true, lastFailureAt: 0, lastSuccessAt: 0, lastFailureSeq: 5 }, 1)).toBe(true);
  });
});

describe("urutan kegagalan/keberhasilan pada state nyata", () => {
  beforeEach(() => {
    resetConnectivityForTests();
  });

  afterEach(() => {
    resetConnectivityForTests();
  });

  it("gagal lalu sukses pada milidetik sama tidak menyisakan status offline", () => {
    recordNetworkFailure();
    recordNetworkSuccess();
    expect(isOnline()).toBe(true);
    const snapshot = getConnectivitySnapshot();
    expect(snapshot.lastSuccessSeq).toBeGreaterThan(snapshot.lastFailureSeq);
  });

  it("sukses lalu gagal pada milidetik sama menandai offline", () => {
    recordNetworkSuccess();
    recordNetworkFailure();
    expect(isOffline()).toBe(true);
    const snapshot = getConnectivitySnapshot();
    expect(snapshot.lastFailureSeq).toBeGreaterThan(snapshot.lastSuccessSeq);
  });
});

describe("state connectivity", () => {
  beforeEach(() => {
    resetConnectivityForTests();
  });

  afterEach(() => {
    resetConnectivityForTests();
  });

  it("mulai online (navigator.onLine true di jsdom) lalu offline setelah fetch gagal", () => {
    expect(isOnline()).toBe(true);
    recordNetworkFailure();
    expect(isOffline()).toBe(true);
    expect(getConnectivitySnapshot().lastFailureAt).toBeGreaterThan(0);
  });

  it("kembali online setelah ada respons HTTP dari server", () => {
    recordNetworkFailure();
    expect(isOffline()).toBe(true);
    recordNetworkSuccess();
    expect(isOnline()).toBe(true);
  });

  it("event navigator 'online' TIDAK menghapus bukti kegagalan (navigator.onLine bisa usang)", () => {
    recordNetworkFailure();
    setNavigatorOnline(true);
    expect(isOffline()).toBe(true);
  });

  it("event navigator 'offline' langsung menandai offline", () => {
    setNavigatorOnline(false);
    expect(isOffline()).toBe(true);
  });

  it("listener hanya dipanggil saat status benar-benar berubah", () => {
    const seen = [];
    const unsubscribe = subscribeConnectivity((snap) => seen.push(snap.online));
    recordNetworkSuccess();
    recordNetworkSuccess();
    expect(seen).toEqual([]); // tetap online -> tidak ada notifikasi berulang
    recordNetworkFailure();
    expect(seen).toEqual([false]);
    recordNetworkSuccess();
    expect(seen).toEqual([false, true]);
    unsubscribe();
    recordNetworkFailure();
    expect(seen).toEqual([false, true]);
  });
});

describe("runConnectivityProbe", () => {
  beforeEach(() => {
    resetConnectivityForTests();
  });

  afterEach(() => {
    resetConnectivityForTests();
  });

  it("probe sukses menandai online kembali", async () => {
    recordNetworkFailure();
    setConnectivityProbe(async () => ({ status: 200 }));
    await expect(runConnectivityProbe()).resolves.toBe(true);
    expect(isOnline()).toBe(true);
  });

  it("probe gagal menandai offline", async () => {
    setConnectivityProbe(async () => {
      throw new Error("Network Error");
    });
    await expect(runConnectivityProbe()).resolves.toBe(false);
    expect(isOffline()).toBe(true);
  });

  it("tanpa probe terdaftar, status tidak berubah", async () => {
    await expect(runConnectivityProbe()).resolves.toBe(true);
    expect(isOnline()).toBe(true);
  });
});
