import { normalizeProfitLossData, orderProfitLossRevenueRows } from "./profitAndLossData";

describe("normalizeProfitLossData", () => {
  it("preserves every view row and accepts standardized account types", () => {
    const report = normalizeProfitLossData({
      rows: [
        { account_name: "Penjualan", account_type: "revenue", balance: "500000" },
        { account_name: "Potongan Penjualan", account_type: "revenue", balance: -25000 },
        { account_name: "HPP Barang", account_type: "cost_of_goods_sold", balance: 25000 },
        { account_name: "Beban HPP - Tissu", account_type: "cost_of_goods_sold", balance: 46465 },
        { account_name: "Beban Operasional", account_type: "operating_expense", balance: "19500" },
        { account_name: "Uang Makan", account_type: "operating_expense", balance: 5000 },
      ],
    });

    expect(report.rows).toEqual([
      { account_name: "Penjualan", account_type: "revenue", balance: 500000 },
      { account_name: "Potongan Penjualan", account_type: "revenue", balance: -25000 },
      { account_name: "HPP Barang", account_type: "cogs", balance: 25000 },
      { account_name: "Beban HPP - Tissu", account_type: "cogs", balance: 46465 },
      { account_name: "Beban Operasional", account_type: "expense", balance: 19500 },
      { account_name: "Uang Makan", account_type: "expense", balance: 5000 },
    ]);
    expect(report.summary).toEqual({
      revenue: 500000,
      sales_discount: 25000,
      hpp: 71465,
      expenses: 24500,
      net_profit: 379035,
    });
  });

  describe("orderProfitLossRevenueRows", () => {
    it("places gross revenue first and sales discounts immediately after it", () => {
      const rows = [
        { account_name: "Potongan Penjualan", balance: -25000 },
        { account_name: "Pendapatan", balance: 500000 },
        { account_name: "Pendapatan Lain", balance: 10000 },
      ];

      expect(orderProfitLossRevenueRows(rows).map(({ account_name }) => account_name)).toEqual([
        "Pendapatan",
        "Potongan Penjualan",
        "Pendapatan Lain",
      ]);
    });
  });

  it("rejects accounts with unsupported types", () => {
    expect(() => normalizeProfitLossData({
      rows: [{ account_name: "Akun lain", account_type: "asset", balance: 100 }],
    })).toThrow("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
  });
});
