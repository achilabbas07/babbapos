const accountTypeAliases = {
  revenue: "revenue",
  cost_of_goods_sold: "cogs",
  cogs: "cogs",
  operating_expense: "expense",
  expense: "expense",
};

export const orderProfitLossRevenueRows = (rows) => [...rows].sort((left, right) => {
  const priority = (row) => {
    const name = row.account_name.trim().toLocaleLowerCase("id-ID");
    if (name === "pendapatan" || name === "penjualan") return 0;
    if (name === "potongan penjualan") return 1;
    return 2;
  };
  return priority(left) - priority(right);
});

export const normalizeProfitLossData = (data) => {
  if (!Array.isArray(data?.rows)) {
    throw new Error("Format rincian laporan laba-rugi dari server tidak valid.");
  }

  const rows = data.rows.map((row) => {
    if (!row || typeof row.account_name !== "string") {
      throw new Error("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
    }
    const balance = typeof row.balance === "number" || (typeof row.balance === "string" && row.balance.trim() !== "")
      ? Number(row.balance)
      : Number.NaN;
    const rawAccountType = String(row.account_type || "").trim().toLowerCase();
    const accountType = Object.prototype.hasOwnProperty.call(accountTypeAliases, rawAccountType)
      ? accountTypeAliases[rawAccountType]
      : null;
    if (!Number.isFinite(balance) || !accountType) {
      throw new Error("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
    }
    return { ...row, balance, account_type: accountType };
  });

  const revenues = rows.filter((row) => row.account_type === "revenue");
  const salesDiscount = revenues
    .filter((row) => row.account_name === "Potongan Penjualan")
    .reduce((total, row) => total - row.balance, 0);
  const hppRows = rows.filter((row) => row.account_type === "cogs");
  const expenses = rows.filter((row) => row.account_type === "expense");
  const revenue = revenues
    .filter((row) => row.account_name !== "Potongan Penjualan")
    .reduce((total, row) => total + row.balance, 0);
  const hpp = hppRows.reduce((total, row) => total + row.balance, 0);
  const expense = expenses.reduce((total, row) => total + row.balance, 0);

  return {
    rows,
    summary: {
      revenue,
      sales_discount: salesDiscount,
      hpp,
      expenses: expense,
      net_profit: revenue - salesDiscount - hpp - expense,
    },
  };
};
