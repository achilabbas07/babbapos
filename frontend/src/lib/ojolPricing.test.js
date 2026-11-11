import {
  DEFAULT_OJOL_MARKUP_PERCENT,
  hasSpecificOjolPrice,
  isOjolOrder,
  ojolVariantPrice,
  regularVariantPrice,
  resolveOjolMarkupPercent,
} from "./ojolPricing";

describe("ojolPricing", () => {
  it("defaults the global markup to 20% and normalizes invalid values", () => {
    expect(DEFAULT_OJOL_MARKUP_PERCENT).toBe(20);
    expect(resolveOjolMarkupPercent(undefined)).toBe(20);
    expect(resolveOjolMarkupPercent("")).toBe(20);
    expect(resolveOjolMarkupPercent("abc")).toBe(20);
    expect(resolveOjolMarkupPercent("-5")).toBe(20);
    expect(resolveOjolMarkupPercent("35")).toBe(35);
  });

  it("recognizes the Ojol channel and specific Ojol prices", () => {
    expect(isOjolOrder("Ojek Online")).toBe(true);
    expect(isOjolOrder("Dine In")).toBe(false);
    expect(hasSpecificOjolPrice(12000)).toBe(true);
    expect(hasSpecificOjolPrice(0)).toBe(false);
  });

  it("computes the regular variant price as base + surcharge", () => {
    expect(regularVariantPrice(20000, 2000)).toBe(22000);
    expect(regularVariantPrice(20000, 0)).toBe(20000);
    expect(regularVariantPrice(undefined, 2000)).toBe(2000);
  });

  it("applies the global markup on-the-fly for variant products on Ojol", () => {
    // (20.000 + 2.000) * 1.2 = 26.400
    expect(ojolVariantPrice({ price: 20000, price_ojol: 0 }, 2000, 20)).toBe(26400);
    // (10.000) * 1.2 = 12.000
    expect(ojolVariantPrice({ price: 10000, price_ojol: 0 }, 0, 20)).toBe(12000);
    // 50%
    expect(ojolVariantPrice({ price: 10000, price_ojol: 0 }, 0, 50)).toBe(15000);
  });

  it("keeps a specific per-product Ojol price without applying the markup", () => {
    // 25.000 spesifik + 2.000 varian
    expect(ojolVariantPrice({ price: 20000, price_ojol: 25000 }, 2000, 20)).toBe(27000);
  });

  it("does not apply the markup outside the Ojol channel", () => {
    expect(ojolVariantPrice({ price: 20000, price_ojol: 0 }, 2000, 20, false)).toBe(22000);
  });
});
