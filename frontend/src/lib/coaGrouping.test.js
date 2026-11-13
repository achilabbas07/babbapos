import { COA_HEADER_FALLBACK_LABEL, getAccountHeader, groupAccountsByHeader } from "./coaGrouping";

const accounts = [
  {
    id: "c1",
    account_code: "1-10001",
    account_name: "Kas Tunai",
    account_category: "Kas & Bank",
    header: "Kas & Bank",
    current_balance: 1000,
  },
  {
    id: "c2",
    account_code: "1-10002",
    account_name: "Kas Bank / QRIS",
    account_category: "Kas & Bank",
    header: "Kas & Bank",
    current_balance: 500,
  },
  {
    id: "c3",
    account_code: "1-10003",
    account_name: "Persediaan Bahan Baku",
    account_category: "Aset Lancar",
    header: "Persediaan",
    current_balance: 250,
  },
  {
    id: "c4",
    account_code: "6-60161",
    account_name: "Listrik",
    account_category: "Beban Operasional",
    header: "Beban Outlet",
    current_balance: 100,
  },
  {
    id: "c5",
    account_code: "6-60102",
    account_name: "Gaji Manager",
    account_category: "Beban Operasional",
    header: "Beban Karyawan",
    current_balance: 200,
  },
];

describe("getAccountHeader", () => {
  it("reads the header column and its known aliases", () => {
    expect(getAccountHeader({ header: " Kas & Bank " })).toBe("Kas & Bank");
    expect(getAccountHeader({ account_header: "COGS" })).toBe("COGS");
    expect(getAccountHeader({ coa_header: "Modal" })).toBe("Modal");
    expect(getAccountHeader({ group_header: "Pendapatan" })).toBe("Pendapatan");
  });

  it("returns an empty string for missing, blank, or non-object values", () => {
    expect(getAccountHeader({})).toBe("");
    expect(getAccountHeader({ header: "   " })).toBe("");
    expect(getAccountHeader({ header: null })).toBe("");
    expect(getAccountHeader(null)).toBe("");
    expect(getAccountHeader(undefined)).toBe("");
    expect(getAccountHeader("not-an-account")).toBe("");
  });

  it("prefers the primary header column over aliases", () => {
    expect(getAccountHeader({ header: "Utama", account_header: "Cadangan" })).toBe("Utama");
  });
});

describe("groupAccountsByHeader", () => {
  it("groups by canonical category, then by header", () => {
    const groups = groupAccountsByHeader(accounts);
    const categoryLabels = groups.map((group) => group.category);

    expect(categoryLabels).toEqual(["Aset Lancar", "Kas & Bank", "Beban Operasional"]);
    const cash = groups.find((group) => group.category === "Kas & Bank");
    expect(cash.count).toBe(2);
    expect(cash.total).toBe(1500);
    expect(cash.subgroups).toHaveLength(1);
    expect(cash.subgroups[0].header).toBe("Kas & Bank");
  });

  it("sorts subgroup headers alphabetically", () => {
    const operational = groupAccountsByHeader(accounts).find(
      (group) => group.category === "Beban Operasional",
    );
    expect(operational.subgroups.map((subgroup) => subgroup.header)).toEqual([
      "Beban Karyawan",
      "Beban Outlet",
    ]);
  });

  it("keeps accounts without a header inside their main category", () => {
    const groups = groupAccountsByHeader([
      ...accounts,
      {
        id: "c6",
        account_code: "1-10009",
        account_name: "Aset Tanpa Header",
        account_category: "Aset Lancar",
        current_balance: 75,
      },
    ]);

    const asset = groups.find((group) => group.category === "Aset Lancar");
    expect(asset.count).toBe(2);
    expect(asset.showSubgroupHeaders).toBe(true);
    // Header bernama dulu, "(tanpa header)" di akhir.
    expect(asset.subgroups.map((subgroup) => subgroup.header)).toEqual(["Persediaan", ""]);
    expect(asset.subgroups.at(-1).count).toBe(1);
    expect(asset.subgroups.at(-1).total).toBe(75);
    expect(COA_HEADER_FALLBACK_LABEL).toBe("Tanpa header");
  });

  it("never throws for malformed payloads", () => {
    expect(groupAccountsByHeader()).toEqual([]);
    expect(groupAccountsByHeader(null)).toEqual([]);
    expect(groupAccountsByHeader({})).toEqual([]);
    expect(groupAccountsByHeader([null, undefined, "x", 42])).toEqual([]);
  });

  it("falls back to a safe category and zero balance for odd rows", () => {
    const groups = groupAccountsByHeader([
      { id: "x", account_code: "9-99999", account_name: "Aneh", current_balance: "abc" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe("Lainnya");
    expect(groups[0].total).toBe(0);
  });

  it("sorts accounts inside a subgroup by account code", () => {
    const groups = groupAccountsByHeader([
      { account_code: "6-60161", account_name: "B", account_category: "Beban Operasional", header: "Z" },
      { account_code: "6-60102", account_name: "A", account_category: "Beban Operasional", header: "Z" },
    ]);
    expect(groups[0].subgroups[0].accounts.map((row) => row.account_code)).toEqual([
      "6-60102",
      "6-60161",
    ]);
  });
});
