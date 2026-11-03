import { normalizeProfitLossData } from "./profitAndLossData";

describe("normalizeProfitLossData", () => {
  it("classifies accounts by code prefix and recomputes totals", () => {
    const report = normalizeProfitLossData({
      rows: [
        { account_code: "4-40000", account_name: "Pendapatan", account_type: "expense", balance: "500000" },
        { account_code: "4-40001", account_name: "Penjualan", account_type: "expense", balance: 250000 },
        { account_code: "5-50001", account_name: "Beban HPP - Tissu", account_type: "expense", balance: 46465 },
        { account_code: "6-60001", account_name: "Uang Makan", account_type: "revenue", balance: "19500" },
      ],
    });

    expect(report.rows).toEqual([
      { account_name: "Penjualan", account_type: "revenue", balance: 750000 },
      { account_code: "5-50001", account_name: "Beban HPP - Tissu", account_type: "cogs", balance: 46465 },
      { account_code: "6-60001", account_name: "Uang Makan", account_type: "expense", balance: 19500 },
    ]);
    expect(report.summary).toEqual({
      revenue: 750000,
      hpp: 46465,
      expenses: 19500,
      net_profit: 684035,
    });
  });

  it("rejects accounts without a supported account-code prefix", () => {
    expect(() => normalizeProfitLossData({
      rows: [{ account_code: "7-70001", account_name: "Akun lain", balance: 100 }],
    })).toThrow("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
  });
});
