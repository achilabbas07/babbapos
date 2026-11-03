import { errMsg, getBackendConfigError, rp } from "./api";

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
