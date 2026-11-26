import {
  ShoppingCart, LayoutGrid, ReceiptText, History, Users, UtensilsCrossed, Boxes, Truck, Wallet, BarChart3, UserCog, ClipboardList, Target, Store, BookOpen, Tags, LineChart, Ban, Gift, TicketPercent, Eye,
} from "lucide-react";

const ALL = ["admin", "kasir", "waiter"];
const STAFF = ["admin", "kasir"];
const ADMIN = ["admin"];

// ID wadah utama sub-menu "Laporan & Analisa Operasional". Dipakai sebagai
// penanda `group` pada item menu dan sebagai id grup nested di sidebar.
export const OPERATIONAL_REPORTS_GROUP_ID = "operational-reports";

export const NAV = [
  { to: "/pos", label: "Kasir", icon: ShoppingCart, roles: ALL },
  { to: "/tables", label: "Meja", icon: LayoutGrid, roles: ALL },
  { to: "/open-bills", label: "Open Bill", icon: ReceiptText, roles: ALL },
  { to: "/targets", label: "Target Sales", icon: Target, roles: ["admin", "waiter"] },
  { to: "/cash", label: "Kas & Shift", icon: Wallet, roles: STAFF },
  { to: "/customers", label: "Pelanggan", icon: Users, roles: ALL },
  { to: "/products", label: "Produk & Resep", icon: UtensilsCrossed, roles: ADMIN },
  { to: "/inventory", label: "Stok Bahan", icon: Boxes, roles: ADMIN },
  { to: "/purchases", label: "Pembelian", icon: Truck, roles: ADMIN },
  { to: "/expenses", label: "Pengeluaran", icon: Wallet, roles: ADMIN },
  { to: "/reports", label: "Laporan", icon: BarChart3, roles: ADMIN },
  { to: "/users", label: "Pengguna", icon: UserCog, roles: ADMIN },
  { to: "/profile", label: "Profil Usaha", icon: Store, roles: ADMIN },
  { to: "/promos", label: "Promo", icon: Tags, roles: ADMIN },
  { to: "/point-reward-settings", label: "Point Reward", icon: Gift, roles: ADMIN },
  // Transaksi & Riwayat Shift tampil di dalam grup nested "Laporan & Analisa
  // Operasional" (OPERATIONAL_REPORTS_NAV_GROUP) tetapi objeknya tetap di NAV
  // agar route-nya di-generate persis sama seperti sebelumnya.
  { to: "/transactions", label: "Transaksi", shortLabel: "Riwayat Transaksi", icon: History, roles: ADMIN, group: OPERATIONAL_REPORTS_GROUP_ID },
  { to: "/shifts", label: "Riwayat Shift", shortLabel: "Riwayat Tutup Shift", icon: ClipboardList, roles: ADMIN, group: OPERATIONAL_REPORTS_GROUP_ID },
];

export const FINANCE_NAV = [
  { to: "/admin/jurnal", label: "Input Jurnal Umum", icon: BookOpen, roles: ADMIN },
  { to: "/coa", label: "Chart of Accounts", icon: BookOpen, roles: ADMIN },
  { to: "/admin/dashboard-keuangan", label: "Posisi Keuangan (Neraca)", icon: Wallet, roles: ADMIN },
  { to: "/admin/arus-kas", label: "Laporan Arus Kas", icon: BarChart3, roles: ADMIN },
  { to: "/admin/laba-rugi", label: "Laporan Laba Rugi", icon: BarChart3, roles: ADMIN },
];

// "Laporan & Analisa Operasional" adalah WADAH UTAMA sub-menu operasional.
// Sub-menu: Laporan Penjualan Produk, Laporan Void, Laporan Sales Target,
// Transaksi (riwayat transaksi), dan Riwayat Shift (riwayat tutup shift).
// Setiap entri di sini punya `group` yang sama supaya sidebar bisa merender
// induk + anaknya secara berkelompok.
export const OPERATIONAL_NAV = [
  {
    to: "/reports/product-sales",
    label: "Laporan Penjualan Produk",
    shortLabel: "Penjualan Produk",
    icon: LineChart,
    roles: ADMIN,
    group: OPERATIONAL_REPORTS_GROUP_ID,
  },
  {
    to: "/reports/void-sales",
    label: "Laporan Void",
    shortLabel: "Laporan Void",
    icon: Ban,
    roles: ADMIN,
    group: OPERATIONAL_REPORTS_GROUP_ID,
  },
  {
    to: "/reports/waiter-sales-target",
    label: "Laporan Sales Target",
    shortLabel: "Sales Target",
    icon: Target,
    roles: ADMIN,
    group: OPERATIONAL_REPORTS_GROUP_ID,
  },
  {
    to: "/reports/point-reward",
    label: "Laporan Point Reward",
    shortLabel: "Point Reward",
    icon: Gift,
    roles: ADMIN,
    group: OPERATIONAL_REPORTS_GROUP_ID,
  },
  {
    to: "/reports/customer-behavior",
    label: "Analisa Perilaku Pelanggan",
    shortLabel: "Perilaku Pelanggan",
    icon: Users,
    roles: ADMIN,
    group: OPERATIONAL_REPORTS_GROUP_ID,
  },
  {
    to: "/reports/promo",
    label: "Laporan Promo",
    shortLabel: "Laporan Promo",
    icon: TicketPercent,
    roles: ADMIN,
    group: OPERATIONAL_REPORTS_GROUP_ID,
  },
];

// Menu khusus "Mode Owner" (APK pemilik). Sengaja DIPISAH dari NAV/FINANCE_NAV/
// OPERATIONAL_NAV supaya struktur sidebar operasional tidak berubah sama sekali.
// Halaman ini tetap dibuat route-nya pada build operasional maupun build Owner
// agar tautan lama tidak "yatim"; penyembunyian menu dilakukan di runtime.
export const OWNER_NAV = [
  { to: "/owner", label: "Pantauan Pemilik", shortLabel: "Pantauan", icon: Eye, roles: ADMIN },
];

// Daftar path yang BOLEH tampil pada Mode Owner — seluruhnya halaman baca-saja
// (pemantauan & laporan). Tidak ada kasir, meja, open bill, pengeluaran, jurnal,
// pengguna, promo, dsb., sehingga tidak ada aksi yang memutasi data.
export const OWNER_MODE_ALLOWED_PATHS = [
  "/owner",
  "/reports",
  "/reports/product-sales",
  "/reports/void-sales",
  "/reports/waiter-sales-target",
  "/reports/point-reward",
  "/reports/customer-behavior",
  "/reports/promo",
  "/transactions",
  "/shifts",
  "/admin/dashboard-keuangan",
  "/admin/arus-kas",
  "/admin/laba-rugi",
];

// Lookup so the grouped sidebar reuses the exact same objects (path, label, icon, roles)
// that App.js uses to generate routes. Nothing is duplicated or re-declared.
const NAV_BY_PATH = Object.fromEntries(
  [...NAV, ...FINANCE_NAV, ...OPERATIONAL_NAV, ...OWNER_NAV].map((item) => [item.to, item]),
);

const pick = (...paths) => paths.map((path) => NAV_BY_PATH[path]).filter(Boolean);

// Wadah utama sub-menu: di sidebar ini dirender sebagai grup nested (accordion).
// Urutan sub-menu: Laporan Penjualan Produk, Laporan Void, Laporan Sales Target,
// Transaksi (riwayat transaksi), lalu Riwayat Shift (riwayat tutup shift).
// Bentuknya nested (punya `items`), berbeda dari item menu biasa (punya `to`).
export const OPERATIONAL_REPORTS_NAV_GROUP = {
  id: OPERATIONAL_REPORTS_GROUP_ID,
  label: "Laporan & Analisa Operasional",
  shortLabel: "Analisa Operasional",
  icon: BarChart3,
  items: pick(
    "/reports/product-sales",
    "/reports/void-sales",
    "/reports/waiter-sales-target",
    "/reports/point-reward",
    "/reports/customer-behavior",
    "/reports/promo",
    "/transactions",
    "/shifts",
  ),
};

export const NAV_GROUPS = [
  {
    id: "operasional",
    label: "Operasional Warkop",
    alwaysOpen: true,
    items: pick("/pos", "/tables", "/open-bills", "/targets", "/cash", "/customers"),
  },
  {
    id: "inventaris",
    label: "Inventaris & Persediaan",
    items: pick("/products", "/inventory", "/purchases"),
  },
  {
    id: "keuangan",
    label: "Keuangan & Akuntansi",
    items: pick(
      "/expenses",
      "/reports",
      "/admin/jurnal",
      "/coa",
      "/admin/dashboard-keuangan",
      "/admin/arus-kas",
      "/admin/laba-rugi",
    ),
  },
  {
    id: "manajemen",
    label: "Manajemen & Laporan",
    items: [
      OPERATIONAL_REPORTS_NAV_GROUP,
      ...pick("/promos", "/point-reward-settings", "/users", "/profile"),
    ],
  },
];

// Filter item menu berdasarkan peran. Mendukung item biasa (`roles`) maupun
// grup nested (`items`) secara rekursif.
export const filterNavItemsByRole = (items, role) =>
  (items || [])
    .map((item) => (item.items ? { ...item, items: filterNavItemsByRole(item.items, role) } : item))
    .filter((item) => (item.roles ? item.roles.includes(role) : item.items && item.items.length > 0));

// --- Mode Owner (baca-saja) -------------------------------------------------

// Sidebar versi Mode Owner: satu grup yang hanya berisi halaman pantauan dan
// laporan baca-saja. Tidak ada menu transaksional sama sekali.
export const OWNER_MODE_GROUPS = [
  {
    id: "owner-pantauan",
    label: "Pantauan Pemilik",
    alwaysOpen: true,
    items: pick(...OWNER_MODE_ALLOWED_PATHS),
  },
];

// Saring daftar item sidebar agar hanya menyisakan path yang boleh pada Mode
// Owner. Mendukung item biasa (`to`) maupun grup nested (`items`) secara rekursif
// sehingga sub-menu laporan baca-saja tetap tampil apa adanya.
export const filterOwnerModeItems = (items) =>
  (items || [])
    .map((item) => (item.items
      ? { ...item, items: filterOwnerModeItems(item.items) }
      : item))
    .filter((item) => (item.items ? item.items.length > 0 : OWNER_MODE_ALLOWED_PATHS.includes(item.to)));

// Saring daftar grup sidebar agar hanya menyisakan path yang boleh pada Mode
// Owner. Grup yang habis difilter otomatis dibuang supaya tidak ada bagian kosong.
export const filterOwnerModeGroups = (groups) =>
  (groups || [])
    .map((group) => ({ ...group, items: filterOwnerModeItems(group.items) }))
    .filter((group) => group.items.length > 0);
