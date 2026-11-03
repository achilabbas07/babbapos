const isAssetAccount = (row) => {
  const accountType = String(row.account_type || "").trim().toLowerCase();
  const category = String(row.account_category || row.kategori_akun || "").trim().toLowerCase();
  const accountCode = String(row.account_code || row.kode_akun || "").trim();
  const accountName = String(row.account_name || "").trim().toLowerCase();

  return ["asset", "assets", "aset", "aktiva"].includes(accountType)
    || /asset|aset|aktiva/.test(category)
    || /^1(?:[-.]|$)/.test(accountCode)
    || /^(kas|cash|bank|piutang|persediaan|inventori|aset|aktiva|peralatan|gedung|kendaraan)\b/.test(accountName);
};

export const normalizeProfitLossData = (data) => {
  if (!Array.isArray(data?.rows)) {
    throw new Error("Format rincian laporan laba-rugi dari server tidak valid.");
  }

  const validRows = data.rows.map((row) => {
    if (!row || typeof row.account_name !== "string") {
      throw new Error("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
    }
    const balance = typeof row.balance === "number" || (typeof row.balance === "string" && row.balance.trim() !== "")
      ? Number(row.balance)
      : Number.NaN;
    if (!Number.isFinite(balance)) {
      throw new Error("Laporan laba-rugi berisi akun atau nilai yang tidak valid.");
    }
    return { ...row, balance, account_type: String(row.account_type || "").trim().toLowerCase() };
  });

  const eligibleRows = validRows.filter((row) => (
    !isAssetAccount(row) && ["revenue", "expense"].includes(row.account_type)
  ));
  const revenueRows = eligibleRows.filter((row) => row.account_type === "revenue");
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

  const expenses = eligibleRows.filter((row) => row.account_type === "expense");
  const rows = [...revenues, ...expenses];
  const revenue = revenues.reduce((total, row) => total + row.balance, 0);
  const expense = expenses.reduce((total, row) => total + row.balance, 0);

  return { rows, summary: { revenue, expenses: expense, net_profit: revenue - expense } };
};
