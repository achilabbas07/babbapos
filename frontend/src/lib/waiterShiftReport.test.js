import {
  buildWaiterShiftReportBytes,
  buildWaiterShiftReportLines,
} from "./waiterShiftReport";

if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

const shift = {
  id: "WSHIFT-123",
  waiter_name: "Budi Santoso",
  shift_id: "SHIFT-SIANG-B",
  closed_at: "2026-11-03 21:00:00",
  results: {
    total_orders: 24,
    active_tables: 0,
    orders_data: [
      { variant_name: "Kopi Susu Gula Aren Extra Panjang", qty: 35 },
      { variant_name: "Croissant Cokelat", qty: 12 },
    ],
    voids: {
      total: 1,
      details: [{ qty: 1, name: "Kopi Susu", reason: "Salah Input Meja" }],
    },
    target_sales_status: "TERCAPAI",
  },
};

describe("waiter shift report printer", () => {
  it("formats every report line within 32 characters", () => {
    const lines = buildWaiterShiftReportLines(shift);

    expect(lines[0]).toMatchObject({ text: "LAPORAN TUTUP SHIFT", align: "center" });
    expect(lines[1]).toMatchObject({ text: "PELAYAN", align: "center" });
    expect(lines.some(({ text }) => text.slice(0, 20) === "Kopi Susu Gula Aren ")).toBe(true);
    expect(lines.find(({ text }) => text.includes("35x"))?.text.endsWith("35x")).toBe(true);
    expect(lines.some(({ text }) => text.includes("Salah Input Meja"))).toBe(true);
    expect(lines[lines.length - 1].text).toBe("( Pelayan )       ( .......... )");
    expect(lines.every(({ text }) => Array.from(text).length <= 32)).toBe(true);
  });

  it("encodes the report and feeds three lines before cutting", () => {
    const bytes = Array.from(buildWaiterShiftReportBytes(shift));
    const cutIndex = bytes.findIndex((byte, index) => byte === 0x1d && bytes[index + 1] === 0x56);

    expect(String.fromCharCode(...bytes.slice(0, cutIndex))).toContain("LAPORAN TUTUP SHIFT");
    expect(bytes.slice(cutIndex - 6, cutIndex)).toEqual([0x0a, 0x0d, 0x0a, 0x0d, 0x0a, 0x0d]);
    expect(bytes.slice(cutIndex, cutIndex + 3)).toEqual([0x1d, 0x56, 0x00]);
  });

  it("rejects malformed report data instead of printing an empty receipt", () => {
    expect(() => buildWaiterShiftReportLines({ ...shift, results: null }))
      .toThrow("Data laporan shift pelayan tidak valid.");
  });
});
