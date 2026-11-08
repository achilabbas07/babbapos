import {
  getAccountCategoryFallback,
  getAccountCategoryLabel,
  getAccountType,
  getAccountTypeLabel,
  isCashBankAccount,
  normalizeAccountCategory,
} from "./accountClassification";

describe("account classification", () => {
  it.each([
    ["1-10001", "Unknown", "asset"],
    ["2-20001", "Unknown", "liability"],
    ["3-30001", "Unknown", "equity"],
    ["4-40001", "Unknown", "revenue"],
    ["5-50001", "Unknown", "expense"],
    ["6-60001", "Unknown", "expense"],
  ])("falls back to the code prefix for %s", (account_code, account_category, expectedType) => {
    expect(getAccountType({ account_code, account_category })).toBe(expectedType);
  });

  it("recognizes cash and bank category, and only liquid 1- accounts by name", () => {
    expect(isCashBankAccount({ account_category: "Kas & Bank" })).toBe(true);
    expect(isCashBankAccount({ account_code: "1-10002", account_name: "Rekening Giro" })).toBe(true);
    expect(isCashBankAccount({ account_code: "1-10003", account_name: "Persediaan Bahan Baku" })).toBe(false);
  });

  it("uses code fallback labels for COA table and modal", () => {
    const account = { account_code: "4-40000", account_category: "Unmapped" };
    expect(getAccountTypeLabel(account)).toBe("Pendapatan");
    expect(getAccountCategoryFallback(account)).toBe("revenue");
    expect(getAccountCategoryLabel(account)).toBe("Pendapatan");
  });

  it("always renders an Indonesian category label, never the raw value", () => {
    expect(getAccountCategoryLabel({ account_code: "6-60200", account_category: "operating_expense" }))
      .toBe("Beban Operasional");
    expect(getAccountCategoryLabel({ account_code: "8-51008", account_category: "bahan penunjang" }))
      .toBe("Bahan Penunjang");
    expect(getAccountCategoryLabel({ account_code: "9-10001", account_category: "Asset" }))
      .toBe("Aset Lancar");
    expect(getAccountCategoryLabel({ account_code: "5-50000", account_category: "Beban HPP" }))
      .toBe("Beban Pokok Pendapatan");
    expect(getAccountCategoryLabel({ account_code: "1-10001", account_category: "Kas & Bank" }))
      .toBe("Kas & Bank");
    expect(getAccountCategoryLabel({ account_code: "7-70006", account_category: "Pendapatan Lainnya" }))
      .toBe("Pendapatan Lainnya");
  });

  it("normalizes categories idempotently and falls back to the code prefix", () => {
    expect(normalizeAccountCategory({ account_code: "6-60203", account_category: "Beban Operasional" }))
      .toBe("Beban Operasional");
    expect(normalizeAccountCategory({ account_code: "2-20001", account_category: "" }))
      .toBe("Liabilitas");
    expect(normalizeAccountCategory({ account_code: "3-10000", account_category: "balance_sheet" }))
      .toBe("Ekuitas");
    expect(normalizeAccountCategory({ account_code: "8-51001", account_category: "Nilai Aneh" }))
      .toBe("Bahan Penunjang");
  });

  it("keeps a recognized category ahead of a conflicting code prefix", () => {
    expect(getAccountType({ account_code: "1-10003", account_category: "operating_expense" })).toBe("expense");
    expect(getAccountType({ account_code: "4-40000", account_category: "balance_sheet" })).toBe("revenue");
  });
});
