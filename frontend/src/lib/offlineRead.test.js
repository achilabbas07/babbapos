import { combineCacheResults, isCanceledError, loadWithCache, rangeCacheKey } from "./offlineRead";

// Helper: buat error yang mensimulasikan kegagalan jaringan (tanpa `response`)
// vs. kegagalan bisnis dari server (punya `response`).
const networkError = () => Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
const businessError = () => Object.assign(new Error("Bad Request"), { response: { status: 400 } });

const makeStore = () => {
  const store = new Map();
  return {
    store,
    read: async (key) => (store.has(key) ? store.get(key) : null),
    save: async (key, data) => store.set(key, { data, updatedAt: "2024-01-01T00:00:00.000Z" }),
  };
};

describe("offlineRead", () => {
  describe("isCanceledError", () => {
    it("mengenali berbagai bentuk pembatalan request", () => {
      expect(isCanceledError({ name: "CanceledError" })).toBe(true);
      expect(isCanceledError({ name: "AbortError" })).toBe(true);
      expect(isCanceledError({ code: "ERR_CANCELED" })).toBe(true);
      expect(isCanceledError(networkError())).toBe(false);
      expect(isCanceledError(null)).toBe(false);
    });
  });

  describe("rangeCacheKey", () => {
    it("menggabungkan parameter menjadi key stabil", () => {
      expect(rangeCacheKey("transactions", { start: "a", end: "b" })).toBe("transactions?start=a&end=b");
    });

    it("mengabaikan nilai kosong dan mengembalikan base bila tidak ada parameter", () => {
      expect(rangeCacheKey("transactions", { start: "", end: null, page: undefined })).toBe("transactions");
      expect(rangeCacheKey("transactions")).toBe("transactions");
    });
  });

  describe("loadWithCache", () => {
    it("menyimpan hasil request ke cache saat berhasil", async () => {
      const { store, read, save } = makeStore();
      const result = await loadWithCache("products", async () => [{ id: 1 }], { read, save });

      expect(result.data).toEqual([{ id: 1 }]);
      expect(result.fromCache).toBe(false);
      expect(result.error).toBeNull();
      expect(result.canceled).toBe(false);
      expect(store.get("products").data).toEqual([{ id: 1 }]);
    });

    it("memakai cache saat request gagal karena jaringan", async () => {
      const { store, read, save } = makeStore();
      store.set("tables", { data: [{ id: "T1" }], updatedAt: "2024-02-02T00:00:00.000Z" });

      const result = await loadWithCache("tables", async () => { throw networkError(); }, { read, save });

      expect(result.data).toEqual([{ id: "T1" }]);
      expect(result.fromCache).toBe(true);
      expect(result.updatedAt).toBe("2024-02-02T00:00:00.000Z");
      expect(result.error).toBeNull();
    });

    it("mengembalikan error jaringan bila tidak ada cache", async () => {
      const { read, save } = makeStore();
      const result = await loadWithCache("tables", async () => { throw networkError(); }, { read, save });

      expect(result.data).toBeUndefined();
      expect(result.fromCache).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("tidak memakai cache untuk error bisnis (4xx/5xx)", async () => {
      const { store, read, save } = makeStore();
      store.set("tables", { data: [{ id: "T1" }], updatedAt: "2024-02-02T00:00:00.000Z" });

      const result = await loadWithCache("tables", async () => { throw businessError(); }, { read, save });

      expect(result.data).toBeUndefined();
      expect(result.fromCache).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("menandai pembatalan tanpa mengubah data maupun cache", async () => {
      const { store, read, save } = makeStore();
      const result = await loadWithCache("tables", async () => { throw { name: "CanceledError" }; }, { read, save });

      expect(result.canceled).toBe(true);
      expect(result.data).toBeUndefined();
      expect(store.size).toBe(0);
    });

    it("melewati cache bila cacheKey null", async () => {
      const { store, read, save } = makeStore();
      store.set("shared", { data: ["cached"], updatedAt: "2024-01-01T00:00:00.000Z" });

      const success = await loadWithCache(null, async () => ["fresh"], { read, save });
      expect(success.data).toEqual(["fresh"]);
      expect(store.size).toBe(1);

      const failed = await loadWithCache(null, async () => { throw networkError(); }, { read, save });
      expect(failed.data).toBeUndefined();
      expect(failed.error).toBeTruthy();
    });
  });

  describe("combineCacheResults", () => {
    it("menandai fromCache bila ada salah satu hasil dari cache", () => {
      expect(combineCacheResults([{ fromCache: false }, { fromCache: true }])).toEqual({ fromCache: true, error: null });
    });

    it("mengambil error pertama yang ada", () => {
      const err = businessError();
      expect(combineCacheResults([{ fromCache: false }, { error: err }])).toEqual({ fromCache: false, error: err });
    });

    it("aman untuk input kosong / berisi null", () => {
      expect(combineCacheResults()).toEqual({ fromCache: false, error: null });
      expect(combineCacheResults([null, undefined])).toEqual({ fromCache: false, error: null });
    });
  });
});
