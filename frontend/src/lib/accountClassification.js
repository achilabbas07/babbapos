const CATEGORY_TYPES = new Map([
  ["asset", "asset"],
  ["assets", "asset"],
  ["aset", "asset"],
  ["aktiva", "asset"],
  ["kas", "asset"],
  ["kas & bank", "asset"],
  ["kas dan bank", "asset"],
  ["cash", "asset"],
  ["cash & bank", "asset"],
  ["cash and bank", "asset"],
  ["liability", "liability"],
  ["liabilities", "liability"],
  ["liabilitas", "liability"],
  ["kewajiban", "liability"],
  ["utang", "liability"],
  ["hutang", "liability"],
  ["equity", "equity"],
  ["ekuitas", "equity"],
  ["modal", "equity"],
  ["revenue", "revenue"],
  ["pendapatan", "revenue"],
  ["income", "revenue"],
  ["cost_of_goods_sold", "expense"],
  ["operating_expense", "expense"],
  ["expense", "expense"],
  ["expenses", "expense"],
  ["beban", "expense"],
  ["biaya", "expense"],
]);

const CODE_TYPES = new Map([
  ["1", "asset"],
  ["2", "liability"],
  ["3", "equity"],
  ["4", "revenue"],
  ["5", "expense"],
  ["6", "expense"],
]);

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("id-ID");

export const getAccountType = (account = {}) => {
  const category = normalize(account.account_category);
  if (category === "balance_sheet") {
    return CODE_TYPES.get(String(account.account_code || "").trim().charAt(0)) || null;
  }
  if (CATEGORY_TYPES.has(category)) return CATEGORY_TYPES.get(category);

  const categoryPrefix = [...CATEGORY_TYPES.keys()]
    .find((knownCategory) => category.startsWith(`${knownCategory} `));
  if (categoryPrefix) return CATEGORY_TYPES.get(categoryPrefix);

  return CODE_TYPES.get(String(account.account_code || "").trim().charAt(0)) || null;
};

export const isCashBankAccount = (account = {}) => {
  const category = normalize(account.account_category);
  if (/(kas|cash|bank)/i.test(category)) {
    return true;
  }

  if (!String(account.account_code || "").trim().startsWith("1-")) return false;
  return /(kas|bank|cash|qris|rekening)/i.test(String(account.account_name || ""));
};

export const getAccountTypeLabel = (account = {}) => {
  if (isCashBankAccount(account)) return "Kas & Bank";
  return ({
    asset: "Aset",
    liability: "Liabilitas",
    equity: "Ekuitas",
    revenue: "Pendapatan",
    expense: "Beban",
  })[getAccountType(account)] || "—";
};

export const getAccountCategoryFallback = (account = {}) => {
  if (normalize(account.account_category) && getAccountType({ ...account, account_code: "" })) {
    return account.account_category;
  }
  const code = String(account.account_code || "").trim();
  const prefix = code.charAt(0);
  if (prefix === "1") {
    return isCashBankAccount({ ...account, account_category: "" }) ? "Kas & Bank" : "asset";
  }
  if (prefix === "2") return "liability";
  if (prefix === "3") return "equity";
  if (prefix === "4") return "revenue";
  if (prefix === "5") {
    const name = normalize(account.account_name);
    return ["hpp", "beban pokok"].some((term) => name.includes(term))
      ? "cost_of_goods_sold"
      : "operating_expense";
  }
  if (prefix === "6") return "operating_expense";
  return "";
};

export const getAccountCategoryLabel = (account = {}) => {
  if (normalize(account.account_category) && getAccountType({ ...account, account_code: "" })) {
    return account.account_category;
  }
  return ({
    "Kas & Bank": "Kas & Bank",
    asset: "Aset",
    liability: "Liabilitas",
    equity: "Ekuitas",
    revenue: "Pendapatan",
    cost_of_goods_sold: "Harga Pokok Penjualan",
    operating_expense: "Beban Operasional",
  })[getAccountCategoryFallback(account)] || "—";
};
