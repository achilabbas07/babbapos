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
  ["bahan penunjang", "expense"],
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
  ["8", "expense"],
]);

// Pemetaan nilai mentah `account_category` (warisan snake_case maupun label
// Indonesia yang tidak seragam) ke satu label baku berbahasa Indonesia.
// Backend memakai kolom ini sebagai filter laporan, jadi tampilan harus
// konsisten tanpa mengubah arti akuntansinya.
const CANONICAL_CATEGORY_LABELS = new Map([
  ["asset", "Aset Lancar"],
  ["assets", "Aset Lancar"],
  ["aset", "Aset Lancar"],
  ["aset lancar", "Aset Lancar"],
  ["aktiva", "Aset Lancar"],
  ["aktiva lancar", "Aset Lancar"],
  ["kas", "Kas & Bank"],
  ["kas & bank", "Kas & Bank"],
  ["kas dan bank", "Kas & Bank"],
  ["cash", "Kas & Bank"],
  ["cash & bank", "Kas & Bank"],
  ["cash and bank", "Kas & Bank"],
  ["bank", "Kas & Bank"],
  ["liability", "Liabilitas"],
  ["liabilities", "Liabilitas"],
  ["liabilitas", "Liabilitas"],
  ["kewajiban", "Liabilitas"],
  ["utang", "Liabilitas"],
  ["hutang", "Liabilitas"],
  ["equity", "Ekuitas"],
  ["ekuitas", "Ekuitas"],
  ["modal", "Ekuitas"],
  ["revenue", "Pendapatan"],
  ["pendapatan", "Pendapatan"],
  ["income", "Pendapatan"],
  ["pendapatan lainnya", "Pendapatan Lainnya"],
  ["pendapatan lain-lain", "Pendapatan Lainnya"],
  ["pendapatan lain - lain", "Pendapatan Lainnya"],
  ["cost_of_goods_sold", "Beban Pokok Pendapatan"],
  ["beban pokok pendapatan", "Beban Pokok Pendapatan"],
  ["beban hpp", "Beban Pokok Pendapatan"],
  ["hpp", "Beban Pokok Pendapatan"],
  ["harga pokok penjualan", "Beban Pokok Pendapatan"],
  ["operating_expense", "Beban Operasional"],
  ["beban operasional", "Beban Operasional"],
  ["biaya operasional", "Beban Operasional"],
  ["expense", "Beban Operasional"],
  ["expenses", "Beban Operasional"],
  ["beban", "Beban Operasional"],
  ["biaya", "Beban Operasional"],
  ["bahan penunjang", "Bahan Penunjang"],
]);

const CANONICAL_BY_CODE_PREFIX = new Map([
  ["1", "Aset Lancar"],
  ["2", "Liabilitas"],
  ["3", "Ekuitas"],
  ["4", "Pendapatan"],
  ["5", "Beban Pokok Pendapatan"],
  ["6", "Beban Operasional"],
  ["8", "Bahan Penunjang"],
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
  if (prefix === "8") return "bahan penunjang";
  return "";
};

/**
 * Label kategori akun baku berbahasa Indonesia.
 *
 * Selalu mengembalikan label Indonesia — nilai mentah seperti
 * `operating_expense`, `bahan penunjang`, atau `Asset` tidak pernah bocor ke UI.
 */
export const normalizeAccountCategory = (account = {}) => {
  const category = normalize(account.account_category);
  if (category && category !== "balance_sheet") {
    if (CANONICAL_CATEGORY_LABELS.has(category)) {
      return CANONICAL_CATEGORY_LABELS.get(category);
    }
    const prefixKey = [...CANONICAL_CATEGORY_LABELS.keys()]
      .find((knownCategory) => category.startsWith(`${knownCategory} `));
    if (prefixKey) return CANONICAL_CATEGORY_LABELS.get(prefixKey);
  }
  const code = String(account.account_code || "").trim();
  return CANONICAL_BY_CODE_PREFIX.get(code.charAt(0)) || "";
};

export const getAccountCategoryLabel = (account = {}) => normalizeAccountCategory(account) || "—";
