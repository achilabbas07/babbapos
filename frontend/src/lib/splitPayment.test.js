import {
  appendLeg,
  buildPaymentsPayload,
  isSplitSettled,
  nextLegMethod,
  primaryMethod,
  remainingAmount,
  splitPayArgs,
  sumLegs,
} from "./splitPayment";

describe("split payment helpers", () => {
  it("sums payment legs and reports the unallocated remainder", () => {
    const legs = [
      { method: "Cash", amount: "30000" },
      { method: "QRIS", amount: "70000" },
    ];
    expect(sumLegs(legs)).toBe(100000);
    expect(remainingAmount(100000, legs)).toBe(0);
    expect(remainingAmount(100000, [{ method: "Cash", amount: "30000" }])).toBe(70000);
  });

  it("treats a split as settled only when every leg has an amount and the total matches", () => {
    expect(isSplitSettled(100000, [
      { method: "Cash", amount: "30000" },
      { method: "QRIS", amount: "70000" },
    ])).toBe(true);
    expect(isSplitSettled(100000, [
      { method: "Cash", amount: "30000" },
      { method: "QRIS", amount: "60000" },
    ])).toBe(false);
    expect(isSplitSettled(100000, [
      { method: "Cash", amount: "30000" },
      { method: "QRIS", amount: "" },
    ])).toBe(false);
    expect(isSplitSettled(100000, [])).toBe(false);
  });

  it("tolerates fractional decimals so a valid split is never blocked", () => {
    expect(isSplitSettled(20000.4, [
      { method: "Cash", amount: "10000" },
      { method: "QRIS", amount: "10000.4" },
    ])).toBe(true);
  });

  it("picks the dominant method while respecting the transactions CHECK constraint", () => {
    expect(primaryMethod([
      { method: "Cash", amount: 30000 },
      { method: "QRIS", amount: 70000 },
    ])).toBe("QRIS");
    expect(primaryMethod([{ method: "Cash", amount: 100000 }])).toBe("Cash");
    expect(primaryMethod([])).toBe("Cash");
    expect(primaryMethod([], "Debit")).toBe("Debit");
    expect(primaryMethod([
      { method: "Cash", amount: 90000 },
      { method: "Debit", amount: 10000 },
    ])).toBe("Debit");
  });

  it("builds the payments payload as plain numbers", () => {
    expect(buildPaymentsPayload([
      { method: "Cash", amount: "30000" },
      { method: "Debit", amount: "70000" },
    ])).toEqual([
      { method: "Cash", amount: 30000 },
      { method: "Debit", amount: 70000 },
    ]);
  });

  it("returns onPay arguments carrying the payments array and only the cash tender", () => {
    const split = splitPayArgs(100000, [
      { method: "Cash", amount: "30000" },
      { method: "QRIS", amount: "70000" },
    ], { promoCode: "HEMAT", redeemPoints: false, discountPin: null });

    expect(split.method).toBe("QRIS");
    expect(split.cashGiven).toBe(30000);
    expect(split.extra).toEqual({
      promoCode: "HEMAT",
      redeemPoints: false,
      discountPin: null,
      payments: [
        { method: "Cash", amount: 30000 },
        { method: "QRIS", amount: 70000 },
      ],
    });
  });

  it("passes the full total as the tender for a non-cash only split", () => {
    const args = splitPayArgs(50000, [
      { method: "QRIS", amount: "25000" },
      { method: "Debit", amount: "25000" },
    ]);
    expect(args.method).toBe("QRIS");
    expect(args.cashGiven).toBe(50000);
  });

  it("adds legs without duplicating a method and starts from the current selection", () => {
    const first = appendLeg([], "Card", "10000");
    expect(first).toEqual([
      { method: "Card", amount: "10000" },
      { method: "Cash", amount: "" },
    ]);
    expect(nextLegMethod([{ method: "Cash" }])).toBe("QRIS");
    expect(nextLegMethod([
      { method: "Cash" },
      { method: "QRIS" },
      { method: "Card" },
    ])).toBe("Debit");
    expect(appendLeg(first, "Card")).toHaveLength(3);
    expect(appendLeg([
      { method: "Cash" },
      { method: "QRIS" },
      { method: "Card" },
      { method: "Debit" },
    ], "Cash")).toHaveLength(4);
  });
});
