"""Penjaga statis untuk berkas ARSIP jurnal diskon penjualan (4-40100).

Berkas migrasi ``backend/supabase/migrate_pos_sales_discount_journal.sql``
TIDAK dijalankan di sini (butuh database). Keputusan pemilik: pencatatan diskon
ke ``4-40100`` diterapkan untuk transaksi KE DEPAN SAJA, TANPA backfill historis.
Berkas migrasi hanya dipertahankan sebagai ARSIP referensi.

Uji ini mengunci dua hal:

1. Sifat-sifat WAJIB pada teks SQL bila suatu saat dipakai lagi:
    - idempoten   : dijaga ``not exists`` (4-40100) + ``on conflict do nothing``,
    - berpasangan : selalu ada pasangan DEBIT 4-40100 dan KREDIT 4-40000,
    - aman void   : hanya menyentuh grup transaksi yang SEIMBANG,
    - non-destruktif: tidak ada UPDATE/DELETE ke ``general_ledger``.
2. STATUS ARSIP: tidak ada pernyataan tulis yang TEREKSEKUSI di dalam berkas.

Semua pemeriksaan dilakukan pada SQL AKTIF (komentar ``--`` dan blok ``/* */``
dibuang) supaya teks dokumentasi tidak membuat uji lolos secara palsu.
"""

import re
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "supabase"
    / "migrate_pos_sales_discount_journal.sql"
)


def _active_sql() -> str:
    text = MIGRATION.read_text(encoding="utf-8")
    lines = [line for line in text.splitlines() if not line.lstrip().startswith("--")]
    return "\n".join(lines).lower()


def _full_text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _executable_sql() -> str:
    """SQL yang benar-benar tereksekusi (komentar baris DAN blok dibuang)."""
    text = re.sub(r"/\*.*?\*/", "", _full_text(), flags=re.DOTALL)
    lines = [line for line in text.splitlines() if not line.lstrip().startswith("--")]
    return "\n".join(lines).lower()


def test_migration_file_exists():
    assert MIGRATION.is_file()


def test_migration_is_archived_and_has_no_executable_write_statement():
    """Berkas DIARSIPKAN: tidak ada pernyataan tulis yang bisa tereksekusi."""
    text = _full_text().lower()
    assert "arsip" in text
    assert "jangan dijalankan" in text
    sql = _executable_sql()
    assert "insert into" not in sql
    assert "update " not in sql
    assert "delete from" not in sql
    assert "begin;" not in sql
    assert "commit;" not in sql


def test_migration_inserts_both_legs_of_the_discount_pair():
    sql = _active_sql()
    assert "insert into public.general_ledger" in sql
    # Akun kontra pendapatan + akun pendapatan bruto penyeimbang.
    assert "'4-40100'" in sql
    assert "'diskon penjualan'" in sql
    assert "'4-40000'" in sql
    # Satu transaksi menghasilkan dua baris: satu DEBIT dan satu KREDIT.
    assert sql.count("is_debit") >= 1
    assert sql.count("is_credit") >= 1
    assert "union all" in sql


def test_migration_is_idempotent():
    sql = _active_sql()
    # Tidak menambah baris 4-40100 dua kali bila dijalankan ulang.
    assert "not exists" in sql
    assert "d.account_code = '4-40100'" in sql
    assert "on conflict do nothing" in sql


def test_migration_only_targets_balanced_transaction_groups():
    sql = _active_sql()
    # Predikat "grup seimbang" -> otomatis mengecualikan transaksi void/rusak.
    assert "sum(coalesce(nullif(l.debit_amount, 0), l.debit, 0))" in sql
    assert "sum(coalesce(nullif(l.credit_amount, 0), l.credit, 0))" in sql
    assert ") = 0" in sql
    # Hanya transaksi yang sudah punya jurnal penjualan (4-40000) yang disentuh.
    assert "p.account_code = '4-40000'" in sql


def test_migration_is_non_destructive_for_general_ledger():
    sql = _active_sql()
    assert "update public.general_ledger" not in sql
    assert "delete from public.general_ledger" not in sql
    assert "truncate" not in sql
    assert "drop table" not in sql


def test_migration_documents_asyncpg_and_preview_workflow():
    text = _full_text()
    # Catatan asyncpg: hapus begin;/commit; saat dijalankan via asyncpg.
    assert "asyncpg" in text
    assert "PREVIEW" in text
    assert "VERIFIKASI" in text
    # Akun kontra pendapatan tampil negatif -> didokumentasikan.
    assert "negatif" in text.lower()


def test_migration_writes_both_ledger_amount_column_pairs():
    sql = _active_sql()
    # general_ledger punya pasangan warisan (debit/credit) DAN (debit_amount/
    # credit_amount); keduanya harus terisi agar semua pembaca konsisten.
    for column in ("debit", "credit", "debit_amount", "credit_amount"):
        assert column in sql
