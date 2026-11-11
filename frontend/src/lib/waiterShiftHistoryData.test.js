import { isClosedShift, shiftResults, targetBadge } from "./waiterShiftHistoryData";

describe("waiterShiftHistoryData", () => {
  it("returns the shift results array or an empty array when missing", () => {
    expect(shiftResults({ results: [{ targetId: "T1" }] })).toEqual([{ targetId: "T1" }]);
    expect(shiftResults({ results: null })).toEqual([]);
    expect(shiftResults(null)).toEqual([]);
  });

  it("builds a target badge and flags achieved targets", () => {
    expect(targetBadge({ name: "Kopi", achieved: 10, targetQty: 10 })).toEqual({
      name: "Kopi",
      achieved: 10,
      targetQty: 10,
      done: true,
    });
    expect(targetBadge({ name: "Teh", achieved: 3, targetQty: 5 }).done).toBe(false);
    expect(targetBadge({ name: "Teh", achieved: 0, targetQty: 0 }).done).toBe(false);
    expect(targetBadge(undefined).name).toBe("Target");
  });

  it("detects closed shifts by status or closedAt", () => {
    expect(isClosedShift({ id: "WSHIFT-1", status: "closed" })).toBe(true);
    expect(isClosedShift({ id: "WSHIFT-1", closedAt: "2026-11-11T10:00:00+08:00" })).toBe(true);
    expect(isClosedShift({ id: "WSHIFT-1", status: "open", closedAt: null })).toBe(false);
    expect(isClosedShift({})).toBe(false);
  });
});
