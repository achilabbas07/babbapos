import { normalizeProfitLossData } from "./profitAndLossData";

describe("normalizeProfitLossData", () => {
  it("merges revenue aliases, excludes asset rows, and recomputes totals", () => {
    const report = normalizeProfitLossData({
      rows: [
        { account_name: "Pendapatan", account_type: "revenue", balance: "500000" },
        { account_name: "Penjualan", account_type: "revenue", balance: 250000 },
        { account_name: "Kas Tunai", account_type: "expense", balance: 291795 },
        { account_name: "Beban Operasional", account_type: "expense", balance: "19500" },
        { account_name: "Perlengkapan", account_type: "asset", balance: 10000 },
      ],
      summary: { revenue: 0, expenses: 0, net_profit: 0 },
    });

    expect(report.rows).toEqual([
      { account_name: "Penjualan", account_type: "revenue", balance: 750000 },
      { account_name: "Beban Operasional", account_type: "expense", balance: 19500 },
    ]);
    expect(report.summary).toEqual({
      revenue: 750000,
      expenses: 19500,
      net_profit: 730500,
    });
  });
});
