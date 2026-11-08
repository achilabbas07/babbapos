-- Perbaikan ketidakseimbangan public.general_ledger (double-entry).
--
-- HASIL AUDIT (data live, 1.721 baris)
--   Total debit  = 154.517.976,62
--   Total kredit = 152.649.151,62
--   Selisih      =   1.868.825,00  (debit lebih besar)
--
-- AKAR MASALAH (dua kelompok, keduanya baris "kaki kas" duplikat)
--
--   KASUS 1 - Penjualan POS (source_type = 'transaction'), 12 baris, 208.000,00
--     Setiap transaksi QRIS/Card punya DUA baris debit kas:
--       (a) account_code = '1-10002' / 'Kas Bank / QRIS'   -> benar
--       (b) account_code = NULL      / 'Bank'              -> duplikat, harus dihapus
--     Contoh TRX-20261030-0012:
--       dr 1-10002 Kas Bank / QRIS  36.000   (benar)
--       dr NULL    Bank             36.000   (duplikat)
--       cr 4-40000 Pendapatan       36.000
--       dr 5-50000 Beban HPP         7.505,20
--       cr 1-10003 Persediaan        7.505,20
--     -> grup jadi debit-heavy tepat sebesar nilai baris (b).
--
--   KASUS 2 - Pembelian legacy (source_type = 'purchase'), 5 baris, 1.660.825,00
--     Setiap PO tunai punya DUA baris debit kas:
--       (a) account_code = NULL / 'Kas'       cr  -> ini leg KREDIT yang sah
--       (b) account_code = NULL / 'Kas Tunai' dr  -> duplikat, harus dihapus
--     Contoh PO-20261017-001:
--       dr NULL Persediaan bahan baku  33.000
--       cr NULL Kas                    33.000   (leg kredit sah)
--       dr NULL Kas Tunai              33.000   (duplikat)
--     -> grup jadi debit-heavy tepat sebesar baris (b).
--
--   Pembanding yang SUDAH BENAR (jangan disentuh):
--     PO-20261104-001: dr Persediaan Barang 520.000 / cr Bank 520.000  (2 baris, balance)
--     PO-20261107-001: dr 1-10003 60.000 / cr 1-10004 Rek. Belanja 60.000 (balance)
--
--   Stok Opname (source_type = 'stock_opname') SUDAH SEIMBANG - tidak disentuh.
--     dr 5-51099 Beban Selisih Stok / cr 1-10003 Persediaan bahan baku
--
-- HASIL SIMULASI SETELAH PERBAIKAN
--   debit  = 152.649.151,62
--   kredit = 152.649.151,62
--   selisih = 0,00
--   Semua grup (source_type, source_id) balance. Tidak ada baris penambal 41999.
--
-- CATATAN PENTING
--   Perbaikan ini hanya MENGHAPUS baris duplikat. Tidak menambah baris baru,
--   tidak memakai akun penampung (41999), dan tidak mengubah skema.
--   Idempoten: aman dijalankan berulang kali.
--
-- Jalankan berkas ini di Supabase SQL Editor.
-- Jalankan bagian PREVIEW lebih dulu, lalu bagian PERBAIKAN, lalu VERIFIKASI.

-- ============================================================================
-- PREVIEW (read-only) - jalankan dulu untuk melihat dampaknya
-- ============================================================================
-- -- 1. Selisih global saat ini
-- select sum(coalesce(nullif(debit_amount,0), debit, 0))  as total_debit,
--        sum(coalesce(nullif(credit_amount,0), credit, 0)) as total_kredit,
--        sum(coalesce(nullif(debit_amount,0), debit, 0))
--      - sum(coalesce(nullif(credit_amount,0), credit, 0)) as selisih
-- from public.general_ledger;
--
-- -- 2. Baris yang akan dihapus (KASUS 1: penjualan POS)
-- select entry_id, source_id, transaction_date, account_name,
--        coalesce(nullif(debit_amount,0), debit, 0) as debit
-- from public.general_ledger
-- where source_type = 'transaction'
--   and account_code is null
--   and account_name = 'Bank'
--   and coalesce(nullif(debit_amount,0), debit, 0) > 0
--   and source_id in (
--       select source_id from public.general_ledger
--       where source_type = 'transaction'
--       group by source_id
--       having sum(coalesce(nullif(debit_amount,0), debit, 0))
--            <> sum(coalesce(nullif(credit_amount,0), credit, 0))
--   )
-- order by source_id;
--
-- -- 3. Baris yang akan dihapus (KASUS 2: pembelian legacy)
-- select entry_id, source_id, transaction_date, account_name,
--        coalesce(nullif(debit_amount,0), debit, 0) as debit
-- from public.general_ledger
-- where source_type = 'purchase'
--   and account_code is null
--   and account_name = 'Kas Tunai'
--   and coalesce(nullif(debit_amount,0), debit, 0) > 0
--   and source_id in (
--       select source_id from public.general_ledger
--       where source_type = 'purchase'
--       group by source_id
--       having sum(coalesce(nullif(debit_amount,0), debit, 0))
--            <> sum(coalesce(nullif(credit_amount,0), credit, 0))
--   )
-- order by source_id;

-- ============================================================================
-- PERBAIKAN
-- ============================================================================
begin;

-- ----------------------------------------------------------------------------
-- KASUS 1: hapus kaki kas duplikat pada penjualan POS (12 baris, 208.000,00)
-- ----------------------------------------------------------------------------
with unbalanced_trx as (
    select source_id
    from public.general_ledger
    where source_type = 'transaction'
    group by source_id
    having sum(coalesce(nullif(debit_amount, 0), debit, 0))
        <> sum(coalesce(nullif(credit_amount, 0), credit, 0))
)
delete from public.general_ledger gl
using unbalanced_trx u
where gl.source_type = 'transaction'
  and gl.source_id = u.source_id
  and gl.account_code is null
  and gl.account_name = 'Bank'
  and coalesce(nullif(gl.debit_amount, 0), gl.debit, 0) > 0;

-- ----------------------------------------------------------------------------
-- KASUS 2: hapus kaki kas duplikat pada pembelian legacy (5 baris, 1.660.825,00)
-- ----------------------------------------------------------------------------
with unbalanced_po as (
    select source_id
    from public.general_ledger
    where source_type = 'purchase'
    group by source_id
    having sum(coalesce(nullif(debit_amount, 0), debit, 0))
        <> sum(coalesce(nullif(credit_amount, 0), credit, 0))
)
delete from public.general_ledger gl
using unbalanced_po u
where gl.source_type = 'purchase'
  and gl.source_id = u.source_id
  and gl.account_code is null
  and gl.account_name = 'Kas Tunai'
  and coalesce(nullif(gl.debit_amount, 0), gl.debit, 0) > 0;

commit;

-- ============================================================================
-- VERIFIKASI (read-only) - jalankan setelah PERBAIKAN
-- ============================================================================
-- -- 1. Selisih global HARUS 0,00
-- select sum(coalesce(nullif(debit_amount,0), debit, 0))  as total_debit,
--        sum(coalesce(nullif(credit_amount,0), credit, 0)) as total_kredit,
--        sum(coalesce(nullif(debit_amount,0), debit, 0))
--      - sum(coalesce(nullif(credit_amount,0), credit, 0)) as selisih
-- from public.general_ledger;
--
-- -- 2. Semua grup (source_type, source_id) HARUS balance -> 0 baris
-- select coalesce(source_type, '<null>') as source_type, source_id,
--        sum(coalesce(nullif(debit_amount,0), debit, 0))  as debit,
--        sum(coalesce(nullif(credit_amount,0), credit, 0)) as kredit,
--        sum(coalesce(nullif(debit_amount,0), debit, 0))
--      - sum(coalesce(nullif(credit_amount,0), credit, 0)) as selisih
-- from public.general_ledger
-- where source_id is not null
-- group by 1, 2
-- having sum(coalesce(nullif(debit_amount,0), debit, 0))
--     <> sum(coalesce(nullif(credit_amount,0), credit, 0))
-- order by abs(sum(coalesce(nullif(debit_amount,0), debit, 0))
--            - sum(coalesce(nullif(credit_amount,0), credit, 0))) desc;
--
-- -- 3. Neraca: total aset harus sama dengan total liabilitas + ekuitas
-- with classified as (
--     select account_code, account_name,
--            case
--                when account_code like '1%' then 'asset'
--                when account_code like '2%' then 'liability'
--                when account_code like '3%' then 'equity'
--                when account_code like '4%' then 'revenue'
--                when account_code like '5%' then 'expense'
--                when account_code like '6%' then 'expense'
--                when account_code like '8%' then 'expense'
--                else account_type
--            end as tipe,
--            sum(coalesce(nullif(debit_amount,0), debit, 0))
--          - sum(coalesce(nullif(credit_amount,0), credit, 0)) as net_dr
--     from public.general_ledger
--     group by 1, 2, 3
-- )
-- select
--     sum(case when tipe = 'asset'     then net_dr  else 0 end) as total_aset,
--     sum(case when tipe = 'liability' then -net_dr else 0 end) as total_liabilitas,
--     sum(case when tipe = 'equity'    then -net_dr else 0 end) as ekuitas_akun,
--     sum(case when tipe = 'revenue'   then -net_dr else 0 end) as total_pendapatan,
--     sum(case when tipe = 'expense'   then net_dr  else 0 end) as total_beban,
--     sum(case when tipe = 'revenue'   then -net_dr else 0 end)
--   - sum(case when tipe = 'expense'   then net_dr  else 0 end) as laba_berjalan
-- from classified;
