import {
  buildWaiterShiftReportBytes,
  buildWaiterShiftReportLines,
  WAITER_SHIFT_FEED_LINES,
} from "./waiterShiftReport";

if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

const shift = {
  id: "WSHIFT-123",
  waiter_name: "Budi Santoso",
  shift_id: "SHIFT-SIANG-B",
  opened_at: "2026-11-03 09:00:00",
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
    target_sales_status: "BELUM TERCAPAI",
  },
};

describe("waiter shift report printer", () => {
  it("formats every report line within 32 characters", () => {
    const lines = buildWaiterShiftReportLines(shift);

    expect(lines[0]).toMatchObject({ text: "LAPORAN TUTUP", align: "center" });
    expect(lines[1]).toMatchObject({ text: "SHIFT PELAYAN", align: "center" });
    expect(lines.find(({ text }) => text.startsWith("Tanggal"))?.text.endsWith("03 Nov 2026")).toBe(true);
    expect(lines.find(({ text }) => text.startsWith("Dibuka"))?.text.endsWith("09:00")).toBe(true);
    expect(lines.find(({ text }) => text.startsWith("Ditutup"))?.text.endsWith("21:00")).toBe(true);
    expect(lines.some(({ text }) => text.startsWith("Waktu"))).toBe(false);
    expect(lines.find(({ text }) => text.startsWith("35x "))?.text).toContain("Kopi Susu Gula Aren");
    expect(lines.some(({ text }) => text.includes("Salah Input Meja"))).toBe(true);
    const auditStart = lines.findIndex(({ text }) => text === "LOG AUDIT & KOREKSI");
    expect(lines[auditStart - 1].text).toBe("-".repeat(32));
    expect(lines.slice(auditStart + 1).find(({ text }) => text === "-".repeat(32))).toBeDefined();
    expect(lines.some(({ text }) => text === `+${"-".repeat(30)}+`)).toBe(true);
    expect(lines.some(({ text }) => text.includes("BELUM TERCAPAI") && text.startsWith("|") && text.endsWith("|"))).toBe(true);
    expect(lines[lines.length - 2].text).toBe("( Pelayan )       ( Supervisor )");
    expect(lines[lines.length - 1].text).toBe("_____________  _____________");
    expect(lines.every(({ text }) => Array.from(text).length <= 32)).toBe(true);
  });

  it("converts zoned UTC timestamps to local time", () => {
    const utcShift = {
      ...shift,
      opened_at: "2026-11-03T01:00:00+00:00",
      closed_at: "2026-11-03T13:00:00+00:00",
    };
    const lines = buildWaiterShiftReportLines(utcShift);
    const expectedOpened = new Date(utcShift.opened_at).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const expectedClosed = new Date(utcShift.closed_at).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });

    expect(lines.find(({ text }) => text.startsWith("Dibuka"))?.text.endsWith(expectedOpened)).toBe(true);
    expect(lines.find(({ text }) => text.startsWith("Ditutup"))?.text.endsWith(expectedClosed)).toBe(true);
  });

  it("feeds enough blank lines before cutting so the footer is not truncated", () => {
    const bytes = Array.from(buildWaiterShiftReportBytes(shift));
    const cutIndex = bytes.findIndex((byte, index) => byte === 0x1d && bytes[index + 1] === 0x56);

    expect(String.fromCharCode(...bytes.slice(0, cutIndex))).toContain("SHIFT PELAYAN");
    // Minimal 4 baris kosong (0x0a 0x0d) sebelum perintah potong.
    expect(WAITER_SHIFT_FEED_LINES).toBeGreaterThanOrEqual(4);
    const feedBytes = bytes.slice(cutIndex - WAITER_SHIFT_FEED_LINES * 2, cutIndex);
    expect(feedBytes).toEqual(
      Array.from({ length: WAITER_SHIFT_FEED_LINES }).flatMap(() => [0x0a, 0x0d]),
    );
    expect(bytes.slice(cutIndex, cutIndex + 3)).toEqual([0x1d, 0x56, 0x00]);
  });

  it("rejects malformed report data instead of printing an empty receipt", () => {
    expect(() => buildWaiterShiftReportLines({ ...shift, results: null }))
      .toThrow("Data laporan shift pelayan tidak valid.");
  });
});
