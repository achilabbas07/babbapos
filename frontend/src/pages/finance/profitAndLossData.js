const accountTypeFromCode = (accountCode) => ({
  4: "revenue",
  5: "cogs",
  6: "expense",
})[String(accountCode || "").trim()[0]];

export const normalizeProfitLossData = (data) => {
  if (!Array.isArray(data?.rows)) {
    throw new Error("Format rincian laporan laba-rugi dari server tidak valid.");
  }

  const validRows = data.rows.map((row) => {
    if (!row || typeof row.account_name !== "string" || typeof row.account_code !== "string") {
      throw new Error("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
    }
    const balance = typeof row.balance === "number" || (typeof row.balance === "string" && row.balance.trim() !== "")
      ? Number(row.balance)
      : Number.NaN;
    const accountType = accountTypeFromCode(row.account_code);
    if (!Number.isFinite(balance) || !accountType) {
      throw new Error("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
    }
    return { ...row, balance, account_type: accountType };
  });

  const revenueRows = validRows.filter((row) => row.account_type === "revenue");
  const namedSalesRows = revenueRows.filter((row) => (
    ["pendapatan", "penjualan"].includes(row.account_name.trim().toLowerCase())
  ));
  const revenues = revenueRows.filter((row) => (
    !["pendapatan", "penjualan"].includes(row.account_name.trim().toLowerCase())
  ));
  if (namedSalesRows.length) {
    revenues.push({
      account_name: "Penjualan",
      account_type: "revenue",
      balance: namedSalesRows.reduce((total, row) => total + row.balance, 0),
    });
  }

  const hppRows = validRows.filter((row) => row.account_type === "cogs");
  const expenses = validRows.filter((row) => row.account_type === "expense");
  const rows = [...revenues, ...hppRows, ...expenses];
  const revenue = revenues.reduce((total, row) => total + row.balance, 0);
  const hpp = hppRows.reduce((total, row) => total + row.balance, 0);
  const expense = expenses.reduce((total, row) => total + row.balance, 0);

  return {
    rows,
    summary: {
      revenue,
      hpp,
      expenses: expense,
      net_profit: revenue - hpp - expense,
    },
  };
};
