import { getAccountCategoryLabel, getAccountTypeLabel } from "./accountClassification";

/**
 * Nama field yang mungkin dipakai API untuk kolom `header` pada
 * `public.chart_of_accounts`. Nilai pertama yang berisi teks dipakai, sehingga
 * UI tetap aman ketika API mengirim `header`, `account_header`, `coa_header`,
 * maupun `group_header` — atau belum mengirim sama sekali.
 */
const HEADER_FIELDS = ["header", "account_header", "coa_header", "group_header"];

/**
 * Urutan tampilan kategori utama agar stabil dan mengikuti siklus akuntansi.
 * Kategori di luar daftar ini tetap tampil, ditempatkan di akhir.
 */
const CATEGORY_ORDER = [
  "Aset Lancar",
  "Kas & Bank",
  "Liabilitas",
  "Ekuitas",
  "Pendapatan",
  "Pendapatan Lainnya",
  "Beban Pokok Pendapatan",
  "Bahan Penunjang",
  "Beban Operasional",
];

const FALLBACK_CATEGORY = "Lainnya";

export const COA_HEADER_FALLBACK_LABEL = "Tanpa header";

/**
 * Batas panjang kolom `header` di database (`character varying(100)`).
 * Dipakai form agar input tidak pernah ditolak PostgreSQL.
 */
export const COA_HEADER_MAX_LENGTH = 100;

const asText = (value) => (typeof value === "string" ? value.trim() : "");

const asAmount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Ambil nilai kolom `header` dari satu akun.
 *
 * Selalu mengembalikan string (bisa kosong), sehingga akun tanpa header —
 * termasuk bila API belum mengirim field tersebut — tidak pernah membuat
 * komponen crash.
 */
export const getAccountHeader = (account = {}) => {
  if (!account || typeof account !== "object") return "";
  for (const field of HEADER_FIELDS) {
    const value = asText(account[field]);
    if (value) return value;
  }
  return "";
};

/**
 * Kumpulkan header unik dari daftar akun untuk pilihan pada form.
 * Aman terhadap input non-array maupun baris tanpa header.
 */
export function collectHeaderOptions(accounts) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const unique = new Set();

  for (const account of rows) {
    const header = getAccountHeader(account);
    if (header) unique.add(header);
  }

  return [...unique].sort((left, right) =>
    left.localeCompare(right, "id", { sensitivity: "base" }),
  );
}

const compareAccounts = (left, right) => {
  const byCode = String(left?.account_code ?? "").localeCompare(
    String(right?.account_code ?? ""),
    "id",
    { numeric: true, sensitivity: "base" },
  );
  if (byCode !== 0) return byCode;
  return String(left?.account_name ?? "").localeCompare(
    String(right?.account_name ?? ""),
    "id",
    { sensitivity: "base" },
  );
};

const categorySortIndex = (label) => {
  const index = CATEGORY_ORDER.indexOf(label);
  return index === -1 ? CATEGORY_ORDER.length : index;
};

const balanceTotal = (rows) =>
  rows.reduce((sum, account) => sum + asAmount(account.current_balance), 0);

/**
 * Kelompokkan akun COA menjadi dua tingkat:
 *   1. kategori utama — label baku `account_category` (mis. "Aset Lancar");
 *   2. sub-kelompok berdasarkan kolom `header`.
 *
 * Akun yang belum memiliki header tetap ditampilkan pada kategori utamanya,
 * di sub-kelompok "(tanpa header)" pada urutan terakhir. Tidak ada akun yang
 * dibuang dan tidak ada akses properti yang bisa melempar error.
 */
export function groupAccountsByHeader(accounts = []) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const byCategory = new Map();

  for (const account of rows) {
    if (!account || typeof account !== "object") continue;

    const rawCategory = getAccountCategoryLabel(account);
    const category =
      !rawCategory || rawCategory === "—" ? FALLBACK_CATEGORY : rawCategory;
    const header = getAccountHeader(account);

    if (!byCategory.has(category)) {
      byCategory.set(category, { byHeader: new Map(), typeLabels: new Set() });
    }
    const bucket = byCategory.get(category);
    const typeLabel = getAccountTypeLabel(account);
    if (typeLabel && typeLabel !== "—") bucket.typeLabels.add(typeLabel);

    if (!bucket.byHeader.has(header)) bucket.byHeader.set(header, []);
    bucket.byHeader.get(header).push(account);
  }

  return [...byCategory.entries()]
    .map(([category, bucket]) => {
      const subgroups = [...bucket.byHeader.entries()]
        .map(([header, groupAccounts]) => {
          const sorted = [...groupAccounts].sort(compareAccounts);
          return {
            key: `${category}::${header}`,
            header,
            accounts: sorted,
            count: sorted.length,
            total: balanceTotal(sorted),
          };
        })
        .sort((left, right) => {
          // Header bernama lebih dulu (alfabetis); "(tanpa header)" di akhir.
          if (!left.header && right.header) return 1;
          if (left.header && !right.header) return -1;
          if (!left.header && !right.header) return 0;
          return left.header.localeCompare(right.header, "id", { sensitivity: "base" });
        });

      const accountsInCategory = subgroups.flatMap((subgroup) => subgroup.accounts);
      return {
        key: category,
        category,
        typeLabel: [...bucket.typeLabels].join(" / "),
        subgroups,
        count: accountsInCategory.length,
        total: balanceTotal(accountsInCategory),
        // Baris sub-kelompok hanya ditampilkan bila memang ada header bernama.
        showSubgroupHeaders: subgroups.some((subgroup) => Boolean(subgroup.header)),
      };
    })
    .sort((left, right) => categorySortIndex(left.category) - categorySortIndex(right.category));
}
