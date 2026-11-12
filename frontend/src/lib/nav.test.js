import {
  FINANCE_NAV,
  NAV,
  NAV_GROUPS,
  OPERATIONAL_NAV,
  OPERATIONAL_REPORTS_GROUP_ID,
  OPERATIONAL_REPORTS_NAV_GROUP,
  filterNavItemsByRole,
} from "./nav";

const ALL_ROUTES = [...NAV, ...FINANCE_NAV, ...OPERATIONAL_NAV];

describe("navigasi sidebar bertingkat", () => {
  it("menyusun sub-menu 'Laporan & Analisa Operasional' sesuai urutan yang diminta", () => {
    expect(OPERATIONAL_REPORTS_NAV_GROUP.id).toBe(OPERATIONAL_REPORTS_GROUP_ID);
    expect(OPERATIONAL_REPORTS_NAV_GROUP.items.map((n) => n.to)).toEqual([
      "/reports/product-sales",
      "/reports/void-sales",
      "/reports/waiter-sales-target",
      "/reports/point-reward",
      "/reports/customer-behavior",
      "/transactions",
      "/shifts",
    ]);
    expect(OPERATIONAL_REPORTS_NAV_GROUP.items.map((n) => n.label)).toEqual([
      "Laporan Penjualan Produk",
      "Laporan Void",
      "Laporan Sales Target",
      "Laporan Point Reward",
      "Analisa Perilaku Pelanggan",
      "Transaksi",
      "Riwayat Shift",
    ]);
  });

  it("memindahkan Transaksi & Riwayat Shift ke dalam grup operasional, bukan di luar", () => {
    const operational = NAV_GROUPS.find((group) => group.id === "operasional");
    const operationalPaths = operational.items.map((item) => item.to);
    expect(operationalPaths).toEqual(["/pos", "/tables", "/open-bills", "/targets", "/cash", "/customers"]);

    const management = NAV_GROUPS.find((group) => group.id === "manajemen");
    const topLevelPaths = management.items.filter((item) => !item.items).map((item) => item.to);
    expect(topLevelPaths).not.toContain("/transactions");
    expect(topLevelPaths).not.toContain("/shifts");
    // Sub-menu "Point Reward" berada tepat setelah "Promo" di grup manajemen.
    expect(topLevelPaths.indexOf("/point-reward-settings")).toBe(topLevelPaths.indexOf("/promos") + 1);
    // Grup nested-nya menjadi anak pertama di grup manajemen.
    expect(management.items[0]).toBe(OPERATIONAL_REPORTS_NAV_GROUP);
  });

  it("tetap mendaftarkan Transaksi & Riwayat Shift untuk pembuatan route (peran admin)", () => {
    const byPath = Object.fromEntries(ALL_ROUTES.map((item) => [item.to, item]));
    expect(byPath["/transactions"]).toMatchObject({ label: "Transaksi", roles: ["admin"] });
    expect(byPath["/shifts"]).toMatchObject({ label: "Riwayat Shift", roles: ["admin"] });
    // Setiap item menu yang tampil di sidebar punya route-nya (tidak ada menu yatim).
    const sidebarPaths = NAV_GROUPS.flatMap((group) =>
      group.items.flatMap((item) => (item.items ? item.items.map((n) => n.to) : [item.to])),
    );
    for (const path of sidebarPaths) {
      expect(byPath[path]).toBeDefined();
    }
  });

  it("tidak menghasilkan route duplikat setelah penataan ulang", () => {
    const paths = ALL_ROUTES.map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("menyaring sub-menu menyesuaikan peran tanpa menyisakan grup kosong", () => {
    const adminNested = filterNavItemsByRole([OPERATIONAL_REPORTS_NAV_GROUP], "admin");
    expect(adminNested).toHaveLength(1);
    expect(adminNested[0].items).toHaveLength(7);

    // Kasir/waiter bukan admin: grup operasional habis difilter -> tidak dirender.
    expect(filterNavItemsByRole([OPERATIONAL_REPORTS_NAV_GROUP], "kasir")).toHaveLength(0);
    expect(filterNavItemsByRole([OPERATIONAL_REPORTS_NAV_GROUP], "waiter")).toHaveLength(0);
  });
});
