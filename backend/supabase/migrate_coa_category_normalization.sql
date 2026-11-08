-- ============================================================================
-- Normalisasi kategori akun (public.chart_of_accounts.account_category)
-- ============================================================================
-- Kolom account_category BUKAN sekadar tampilan: nilainya dipakai sebagai
-- filter di beberapa query laporan (klasifikasi laba-rugi, neraca, deteksi
-- kas/bank, sisi saldo normal). Karena itu nilainya harus seragam.
--
-- Migrasi ini hanya menyeragamkan LABEL kategori dan kapitalisasi
-- normal_balance. Kode akun, nama akun, dan seluruh baris general_ledger
-- TIDAK disentuh sehingga tidak ada dampak akuntansi.
--
-- Idempoten: aman dijalankan berulang kali.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. PRATINJAU: kondisi sebelum perbaikan
-- ---------------------------------------------------------------------------
select 'SEBELUM' as tahap, account_category, count(*) as jumlah
from public.chart_of_accounts
group by account_category
order by jumlah desc, account_category;

-- ---------------------------------------------------------------------------
-- 2. Normalisasi account_category ke label baku berbahasa Indonesia
-- ---------------------------------------------------------------------------
update public.chart_of_accounts
set account_category = case lower(btrim(account_category))
        -- Aset
        when 'asset' then 'Aset Lancar'
        when 'assets' then 'Aset Lancar'
        when 'aset' then 'Aset Lancar'
        when 'aset lancar' then 'Aset Lancar'
        when 'aktiva' then 'Aset Lancar'
        when 'aktiva lancar' then 'Aset Lancar'
        -- Kas & bank
        when 'kas' then 'Kas & Bank'
        when 'kas & bank' then 'Kas & Bank'
        when 'kas dan bank' then 'Kas & Bank'
        when 'cash' then 'Kas & Bank'
        when 'cash & bank' then 'Kas & Bank'
        when 'cash and bank' then 'Kas & Bank'
        when 'bank' then 'Kas & Bank'
        -- Liabilitas
        when 'liability' then 'Liabilitas'
        when 'liabilities' then 'Liabilitas'
        when 'liabilitas' then 'Liabilitas'
        when 'kewajiban' then 'Liabilitas'
        when 'utang' then 'Liabilitas'
        when 'hutang' then 'Liabilitas'
        -- Ekuitas
        when 'equity' then 'Ekuitas'
        when 'ekuitas' then 'Ekuitas'
        when 'modal' then 'Ekuitas'
        -- Pendapatan
        when 'revenue' then 'Pendapatan'
        when 'pendapatan' then 'Pendapatan'
        when 'income' then 'Pendapatan'
        when 'pendapatan lainnya' then 'Pendapatan Lainnya'
        when 'pendapatan lain-lain' then 'Pendapatan Lainnya'
        when 'pendapatan lain - lain' then 'Pendapatan Lainnya'
        -- Beban pokok pendapatan (HPP)
        when 'cost_of_goods_sold' then 'Beban Pokok Pendapatan'
        when 'beban pokok pendapatan' then 'Beban Pokok Pendapatan'
        when 'beban hpp' then 'Beban Pokok Pendapatan'
        when 'hpp' then 'Beban Pokok Pendapatan'
        when 'harga pokok penjualan' then 'Beban Pokok Pendapatan'
        -- Beban operasional
        when 'operating_expense' then 'Beban Operasional'
        when 'beban operasional' then 'Beban Operasional'
        when 'biaya operasional' then 'Beban Operasional'
        when 'expense' then 'Beban Operasional'
        when 'expenses' then 'Beban Operasional'
        when 'beban' then 'Beban Operasional'
        when 'biaya' then 'Beban Operasional'
        -- Bahan penunjang (rincian HPP seri 8-)
        when 'bahan penunjang' then 'Bahan Penunjang'
        -- Nilai tak dikenal: turunkan dari awalan kode akun
        else case left(btrim(account_code), 1)
            when '1' then 'Aset Lancar'
            when '2' then 'Liabilitas'
            when '3' then 'Ekuitas'
            when '4' then 'Pendapatan'
            when '5' then 'Beban Pokok Pendapatan'
            when '6' then 'Beban Operasional'
            when '8' then 'Bahan Penunjang'
            else btrim(account_category)
        end
    end
where account_category is distinct from case lower(btrim(account_category))
        when 'asset' then 'Aset Lancar'
        when 'assets' then 'Aset Lancar'
        when 'aset' then 'Aset Lancar'
        when 'aset lancar' then 'Aset Lancar'
        when 'aktiva' then 'Aset Lancar'
        when 'aktiva lancar' then 'Aset Lancar'
        when 'kas' then 'Kas & Bank'
        when 'kas & bank' then 'Kas & Bank'
        when 'kas dan bank' then 'Kas & Bank'
        when 'cash' then 'Kas & Bank'
        when 'cash & bank' then 'Kas & Bank'
        when 'cash and bank' then 'Kas & Bank'
        when 'bank' then 'Kas & Bank'
        when 'liability' then 'Liabilitas'
        when 'liabilities' then 'Liabilitas'
        when 'liabilitas' then 'Liabilitas'
        when 'kewajiban' then 'Liabilitas'
        when 'utang' then 'Liabilitas'
        when 'hutang' then 'Liabilitas'
        when 'equity' then 'Ekuitas'
        when 'ekuitas' then 'Ekuitas'
        when 'modal' then 'Ekuitas'
        when 'revenue' then 'Pendapatan'
        when 'pendapatan' then 'Pendapatan'
        when 'income' then 'Pendapatan'
        when 'pendapatan lainnya' then 'Pendapatan Lainnya'
        when 'pendapatan lain-lain' then 'Pendapatan Lainnya'
        when 'pendapatan lain - lain' then 'Pendapatan Lainnya'
        when 'cost_of_goods_sold' then 'Beban Pokok Pendapatan'
        when 'beban pokok pendapatan' then 'Beban Pokok Pendapatan'
        when 'beban hpp' then 'Beban Pokok Pendapatan'
        when 'hpp' then 'Beban Pokok Pendapatan'
        when 'harga pokok penjualan' then 'Beban Pokok Pendapatan'
        when 'operating_expense' then 'Beban Operasional'
        when 'beban operasional' then 'Beban Operasional'
        when 'biaya operasional' then 'Beban Operasional'
        when 'expense' then 'Beban Operasional'
        when 'expenses' then 'Beban Operasional'
        when 'beban' then 'Beban Operasional'
        when 'biaya' then 'Beban Operasional'
        when 'bahan penunjang' then 'Bahan Penunjang'
        else case left(btrim(account_code), 1)
            when '1' then 'Aset Lancar'
            when '2' then 'Liabilitas'
            when '3' then 'Ekuitas'
            when '4' then 'Pendapatan'
            when '5' then 'Beban Pokok Pendapatan'
            when '6' then 'Beban Operasional'
            when '8' then 'Bahan Penunjang'
            else btrim(account_category)
        end
    end;

-- ---------------------------------------------------------------------------
-- 3. Seragamkan kapitalisasi normal_balance (DEBIT/Debit -> debit)
-- ---------------------------------------------------------------------------
update public.chart_of_accounts
set normal_balance = lower(btrim(normal_balance))
where normal_balance is distinct from lower(btrim(normal_balance));

-- ---------------------------------------------------------------------------
-- 4. VERIFIKASI: hasil setelah perbaikan
-- ---------------------------------------------------------------------------
select 'SESUDAH' as tahap, account_category, count(*) as jumlah
from public.chart_of_accounts
group by account_category
order by jumlah desc, account_category;

select 'NORMAL_BALANCE' as tahap, normal_balance, count(*) as jumlah
from public.chart_of_accounts
group by normal_balance
order by jumlah desc;

-- Tidak boleh ada lagi nilai mentah snake_case / kapitalisasi tidak seragam.
do $$
declare
    sisa integer;
begin
    select count(*) into sisa
    from public.chart_of_accounts
    where account_category in (
            'asset', 'assets', 'aset', 'aktiva', 'kas', 'cash', 'bank',
            'liability', 'liabilities', 'kewajiban', 'utang', 'hutang',
            'equity', 'modal', 'revenue', 'income',
            'cost_of_goods_sold', 'operating_expense', 'expense', 'expenses',
            'beban', 'biaya', 'bahan penunjang', 'beban hpp', 'hpp',
            'harga pokok penjualan', 'balance_sheet'
        )
        or account_category <> btrim(account_category)
        or normal_balance <> lower(btrim(normal_balance));

    if sisa > 0 then
        raise exception 'Normalisasi kategori akun belum tuntas: % baris masih tidak baku.', sisa;
    end if;
    raise notice 'Normalisasi kategori akun selesai dan terverifikasi.';
end $$;

commit;
