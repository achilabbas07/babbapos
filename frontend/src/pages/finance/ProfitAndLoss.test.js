import { normalizeProfitLossData, orderProfitLossHppRows, orderProfitLossRevenueRows } from "./profitAndLossData";

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

  describe("orderProfitLossHppRows", () => {
    it("places the Beban Pokok Pendapatan parent before its seri 8- detail rows", () => {
      const rows = [
        { account_code: "8-51005", account_name: "Bumbu/Sayur", is_hpp_detail: true },
        { account_code: "5-50000", account_name: "Beban Pokok Pendapatan", is_hpp_parent: true },
        { account_code: "8-51001", account_name: "Air Galon", is_hpp_detail: true },
      ];

      expect(orderProfitLossHppRows(rows).map(({ account_name }) => account_name)).toEqual([
        "Beban Pokok Pendapatan",
        "Air Galon",
        "Bumbu/Sayur",
      ]);
    });
  });

  it("keeps seri 8- HPP detail rows in the report and counts them in the HPP total", () => {
    const report = normalizeProfitLossData({
      rows: [
        { account_name: "Penjualan", account_type: "revenue", balance: 1000000 },
        {
          account_name: "Beban Pokok Pendapatan",
          account_code: "5-50000",
          account_type: "cost_of_goods_sold",
          balance: 200000,
          is_hpp_parent: true,
        },
        {
          account_name: "Air Galon",
          account_code: "8-51001",
          account_category: "Bahan Penunjang",
          account_type: "cost_of_goods_sold",
          balance: 45000,
          is_hpp_detail: true,
          parent_account_code: "5-50000",
        },
        { account_name: "Beban Operasional", account_type: "operating_expense", balance: 50000 },
      ],
    });

    const hppRows = orderProfitLossHppRows(report.rows.filter((row) => row.account_type === "cogs"));
    expect(hppRows.map(({ account_name }) => account_name)).toEqual([
      "Beban Pokok Pendapatan",
      "Air Galon",
    ]);
    expect(hppRows[1].is_hpp_detail).toBe(true);
    expect(hppRows[1].parent_account_code).toBe("5-50000");
    expect(report.summary).toEqual({
      revenue: 1000000,
      sales_discount: 0,
      hpp: 245000,
      expenses: 50000,
      net_profit: 705000,
    });
  });

  it("rejects accounts with unsupported types", () => {
    expect(() => normalizeProfitLossData({
      rows: [{ account_name: "Akun lain", account_type: "asset", balance: 100 }],
    })).toThrow("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
  });
});
