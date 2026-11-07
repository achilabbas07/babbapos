-- Perbaikan pencatatan penjualan POS ke public.general_ledger.
--
-- MASALAH
--   1. Tabel public.transactions punya trigger trigger_record_sales_ledger
--      (fungsi record_sales_to_ledger) yang menulis jurnal penjualan sendiri
--      dengan reference_number 'POS-<8 char>' dan source_type NULL.
--      Backend FastAPI (backend/finance.py::post_finance_source) juga menulis
--      jurnal penjualan yang sama dengan source_type = 'transaction'.
--      Akibatnya pendapatan tercatat DUA KALI.
--   2. Jurnal dari trigger TIDAK seimbang: debit kas + debit HPP + kredit
--      pendapatan, tanpa kredit persediaan. Selisihnya kemudian "ditambal"
--      oleh trigger trg_final_balance_protection_by_date
--      (fn_final_check_and_balance_by_date) ke akun 41999
--      "Pendapatan Belum Dialokasikan (Pajak/Biaya)".
--   3. Hal yang sama terjadi pada public.purchases (trigger trigger_record_purchase
--      -> record_purchase_to_ledger) yang menduplikasi jurnal pembelian.
--
-- SOLUSI
--   Backend Python adalah satu-satunya penulis jurnal untuk penjualan dan
--   pembelian, sehingga trigger penulis jurnal di level tabel dihapus.
--   Setelah itu tidak ada lagi baris tidak seimbang yang perlu ditambal ke 41999.
--
-- Jalankan berkas ini di Supabase SQL Editor.
-- Disarankan menjalankan bagian PREVIEW lebih dulu.

-- ============================================================================
-- PREVIEW (read-only) - jalankan dulu untuk melihat dampaknya
-- ============================================================================
-- select coalesce(source_type, '<null>') as penulis, count(*) as baris
-- from public.general_ledger group by 1 order by 2 desc;
--
-- select count(*) as baris_trigger_penjualan
-- from public.general_ledger
-- where source_type is null and reference_number like 'POS-%';
--
-- select count(*) as baris_trigger_pembelian
-- from public.general_ledger
-- where source_type is null and reference_number like 'PRC-%';
--
-- select count(*) as baris_akun_penampung_41999
-- from public.general_ledger
-- where account_code = '41999';


begin;

-- ============================================================================
-- 1. Hentikan penulis jurnal duplikat di level tabel
-- ============================================================================
drop trigger if exists trigger_record_sales_ledger on public.transactions;
drop trigger if exists trigger_record_purchase on public.purchases;

-- Fungsi trigger dibiarkan ada agar mudah di-rollback, tetapi tidak lagi
-- dipanggil. Hapus komentar di bawah bila ingin benar-benar membuangnya.
-- drop function if exists public.record_sales_to_ledger();
-- drop function if exists public.record_purchase_to_ledger();

-- ============================================================================
-- 2. Hapus baris jurnal hasil duplikasi trigger
--    (baris buatan backend Python punya source_type/source_id, baris trigger tidak)
-- ============================================================================
delete from public.general_ledger
where source_type is null
  and reference_number like 'POS-%';

delete from public.general_ledger
where source_type is null
  and reference_number like 'PRC-%';

-- ============================================================================
-- 3. Hapus baris penambal akun 41999
--    Ciri baris ini: description, reference_number, source_type, source_id,
--    created_by semuanya NULL dan nilainya hanya ada di debit_amount/credit_amount.
-- ============================================================================
delete from public.general_ledger
where account_code = '41999'
  and reference_number is null
  and description is null
  and source_type is null
  and source_id is null;

-- ============================================================================
-- 4. Pastikan seluruh jurnal penjualan POS memakai akun 4-40000
--    (jaring pengaman bila masih ada baris lama yang belum berkode akun)
-- ============================================================================
update public.general_ledger
set account_code = '4-40000',
    account_name = 'Pendapatan',
    account_type = 'revenue'
where source_type = 'transaction'
  and account_type = 'revenue'
  and credit > 0
  and debit = 0
  and (account_code is null or account_code in ('41999', '4-40001'));

-- Jaring pengaman: kode akun untuk baris HPP penjualan POS
update public.general_ledger
set account_code = '5-50000'
where source_type = 'transaction'
  and account_type = 'expense'
  and debit > 0
  and credit = 0
  and account_code is null
  and account_name = 'Beban HPP';

update public.general_ledger
set account_code = '1-10003'
where source_type = 'transaction'
  and account_type = 'asset'
  and credit > 0
  and debit = 0
  and account_code is null
  and account_name = 'Persediaan bahan baku';

commit;

-- ============================================================================
-- VERIFIKASI setelah migrasi - semua baris harus seimbang per tanggal
-- ============================================================================
-- select transaction_date,
--        sum(coalesce(nullif(debit_amount, 0), debit))  as total_debit,
--        sum(coalesce(nullif(credit_amount, 0), credit)) as total_kredit,
--        sum(coalesce(nullif(debit_amount, 0), debit))
--          - sum(coalesce(nullif(credit_amount, 0), credit)) as selisih
-- from public.general_ledger
-- group by 1
-- having sum(coalesce(nullif(debit_amount, 0), debit))
--        <> sum(coalesce(nullif(credit_amount, 0), credit))
-- order by 1 desc;
