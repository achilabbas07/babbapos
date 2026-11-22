import { errMsg, errorCode, getBackendConfigError, isFetchNetworkError, isNetworkError, NETWORK_ERROR_MESSAGE, rp } from "./api";

describe("errMsg", () => {
  it("uses backend error messages from 500 responses", () => {
    expect(errMsg({ response: { data: { error: "column quantity does not exist", stage: "inserting open bill" } } }))
      .toBe("column quantity does not exist (inserting open bill)");
  });

  it("continues to use FastAPI detail messages", () => {
    expect(errMsg({ response: { data: { detail: "Meja tidak ditemukan" } } }))
      .toBe("Meja tidak ditemukan");
  });

  it("explains how to recover from a server network error", () => {
    expect(errMsg({ message: "Network Error" }))
      .toContain("Periksa koneksi internet dan coba lagi");
  });

  it("explains how to recover from a fetch failure (TypeError: Failed to fetch)", () => {
    expect(errMsg(Object.assign(new TypeError("Failed to fetch")))).toBe(NETWORK_ERROR_MESSAGE);
  });

  it("explains how to recover from a Supabase-style network error object", () => {
    // Klien Supabase mengubah kegagalan fetch menjadi objek error biasa
    // (tanpa `.response`) dengan pesan "TypeError: Failed to fetch".
    expect(errMsg({ message: "TypeError: Failed to fetch", details: "", hint: "", code: "" }))
      .toBe(NETWORK_ERROR_MESSAGE);
  });

  it("keeps server business messages even when the text mentions fetch", () => {
    expect(errMsg({ response: { data: { error: "Failed to fetch customer" } } }))
      .toBe("Failed to fetch customer");
  });

  it("reads the message from a structured detail object", () => {
    expect(errMsg({
      response: {
        data: {
          detail: {
            code: "SHIFT_NOT_OPEN",
            message: "Admin harus membuka shift dan mengisi kas awal sebelum bertransaksi.",
          },
        },
      },
    })).toBe("Admin harus membuka shift dan mengisi kas awal sebelum bertransaksi.");
  });
});

describe("errorCode", () => {
  it("extracts the code from a structured detail object", () => {
    expect(errorCode({
      response: { data: { detail: { code: "SHIFT_NOT_OPEN", message: "x" } } },
    })).toBe("SHIFT_NOT_OPEN");
  });

  it("returns an empty string for plain string details", () => {
    expect(errorCode({
      response: { data: { detail: "Buka shift kasir terlebih dahulu" } },
    })).toBe("");
  });

  it("returns an empty string when there is no response", () => {
    expect(errorCode({ message: "Network Error" })).toBe("");
  });
});

describe("isNetworkError", () => {
  it("treats a fetch failure as a network error", () => {
    expect(isNetworkError(Object.assign(new TypeError("Failed to fetch")))).toBe(true);
    expect(isNetworkError({ name: "TypeError", message: "Load failed" })).toBe(true);
    expect(isNetworkError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isNetworkError({ message: "Network Error" })).toBe(true);
    expect(isNetworkError(null)).toBe(true);
  });

  it("does not treat server business errors as network errors", () => {
    expect(isNetworkError({ response: { status: 400 }, message: "Failed to fetch" })).toBe(false);
    expect(isNetworkError({ response: { status: 500 } })).toBe(false);
  });
});

describe("isFetchNetworkError", () => {
  it("detects fetch-style failures across browsers", () => {
    expect(isFetchNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isFetchNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isFetchNetworkError({ message: "fetch failed" })).toBe(true);
  });

  it("ignores errors with an HTTP response and unrelated errors", () => {
    expect(isFetchNetworkError({ response: { status: 400 }, message: "Failed to fetch" })).toBe(false);
    expect(isFetchNetworkError(new Error("Meja tidak ditemukan"))).toBe(false);
    expect(isFetchNetworkError(null)).toBe(false);
  });
});

describe("getBackendConfigError", () => {
  it("rejects a localhost backend for a public frontend", () => {
    expect(getBackendConfigError("http://localhost:8001", "babbapos.vercel.app"))
      .toContain("Backend produksi masih diarahkan ke localhost");
  });

  it("allows localhost during local development", () => {
    expect(getBackendConfigError("http://localhost:8001", "localhost")).toBe("");
  });
});

describe("rp", () => {
  it("formats Rupiah with standard Indonesian thousands separators", () => {
    expect(rp(1234567)).toBe("Rp 1.234.567");
    expect(rp("1234567")).toBe("Rp 1.234.567");
  });

  it.each([null, undefined, "", "   ", "not a number", NaN, Infinity])(
    "falls back safely for invalid input %s",
    (value) => {
      expect(rp(value)).toBe("Rp 0");
    }
  );
});
