import { supabase } from "@/supabaseClient";
import { getAccountHeader } from "@/lib/coaGrouping";

const TABLE = "chart_of_accounts";
const PAGE_SIZE = 1000;

const asText = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Ambil pemetaan `account_code` -> `header` langsung dari Supabase.
 *
 * Endpoint COA backend saat ini belum menyeleksi kolom `header`, sehingga UI
 * mengambilnya secara terpisah dengan operasi READ-ONLY. Fungsi ini bersifat
 * best-effort: bila Supabase belum dikonfigurasi, RLS menolak, atau jaringan
 * gagal, fungsi mengembalikan `{}` dan UI tetap berjalan seperti sebelumnya.
 */
export async function fetchAccountHeaders() {
  if (!supabase) return {};

  const headers = {};
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(TABLE)
        .select("account_code,header")
        .order("account_code", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!Array.isArray(data) || data.length === 0) break;

      for (const row of data) {
        const code = asText(row?.account_code);
        const header = asText(row?.header);
        if (code && header) headers[code] = header;
      }

      if (data.length < PAGE_SIZE) break;
    }
  } catch (error) {
    // Sengaja ditelan: pengayaan header tidak boleh menggagalkan halaman COA.
    if (typeof console !== "undefined") {
      console.warn("Gagal memuat kolom header COA dari Supabase:", error);
    }
    return {};
  }

  return headers;
}

/**
 * Tempelkan `header` ke daftar akun tanpa mengubah field lain.
 *
 * Nilai `header` yang SUDAH dikirim API tidak pernah ditimpa, sehingga bila
 * backend kelak menyertakan kolom ini, data API tetap menjadi sumber utama.
 */
export function attachAccountHeaders(accounts, headers) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const map = headers && typeof headers === "object" ? headers : {};

  return rows.map((account) => {
    if (!account || typeof account !== "object") return account;
    if (getAccountHeader(account)) return account;

    const code = asText(account.account_code);
    if (!code || !map[code]) return account;

    return { ...account, header: map[code] };
  });
}

/**
 * Simpan kolom `header` satu akun langsung ke Supabase (kolom ini belum
 * dikirim/diterima endpoint COA backend).
 *
 * Return value:
 *  - `undefined` → Supabase tidak dikonfigurasi, tidak ada yang perlu disimpan;
 *  - `true`      → header berhasil disimpan (atau dikosongkan);
 *  - `false`     → gagal disimpan (mis. RLS diaktifkan kembali / jaringan).
 *
 * Tidak pernah melempar error: kegagalan hanya menghasilkan peringatan.
 */
export async function saveAccountHeader(accountCode, header) {
  const code = asText(accountCode);
  if (!supabase || !code) return undefined;

  const value = asText(header) || null;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ header: value })
      .eq("account_code", code)
      .select("account_code");

    if (error) throw error;

    // Tanpa policy UPDATE (atau bila akun belum terlihat), Supabase tidak
    // mengembalikan baris apa pun. Anggap gagal agar UI memberi peringatan.
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    if (typeof console !== "undefined") {
      console.warn(`Gagal menyimpan header untuk akun ${code}:`, error);
    }
    return false;
  }
}
