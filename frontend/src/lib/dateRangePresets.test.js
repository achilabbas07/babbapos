import { DATE_RANGE_PRESETS, monthStartStr } from "./dateRangePresets";
import { todayStr, daysAgoStr } from "./api";

const preset = (key) => DATE_RANGE_PRESETS.find((p) => p.key === key);

describe("DATE_RANGE_PRESETS", () => {
  it("exposes the expected quick presets", () => {
    expect(DATE_RANGE_PRESETS.map((p) => p.key)).toEqual(["today", "7d", "30d", "month", "all"]);
  });

  it("builds today / 7d / 30d ranges from local calendar dates", () => {
    expect(preset("today").range()).toEqual({ from: todayStr(), to: todayStr() });
    expect(preset("7d").range()).toEqual({ from: daysAgoStr(6), to: todayStr() });
    expect(preset("30d").range()).toEqual({ from: daysAgoStr(29), to: todayStr() });
  });

  it("starts the month preset on the first day of the current month", () => {
    expect(preset("month").range()).toEqual({ from: monthStartStr(), to: todayStr() });
    expect(monthStartStr()).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("uses empty bounds for the 'all' preset so no filter is sent", () => {
    expect(preset("all").range()).toEqual({ from: "", to: "" });
  });
});
