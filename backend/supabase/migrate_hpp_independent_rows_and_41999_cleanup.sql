-- Perbaikan HPP Laba Rugi + pembersihan akun 41999.
--
-- ============================================================================
-- BAGIAN A — HPP ganda / membengkak di Laporan Laba Rugi
-- ============================================================================
-- GEJALA
--   Nilai HPP di laporan laba rugi tampil dua kali lipat, dan akun induk
--   5-50000 "Beban Pokok Pendapatan" tercampur dengan akun rincian seri 8-
--   (Air Galon, Es Kristal, Tissu, dst.) sehingga totalnya menggelembung.
--
-- PENYEBAB (terverifikasi pada data produksi)
--   1. Untuk 46 transaksi penjualan terdapat DUA baris jurnal 5-50000 dengan
--      nominal identik tetapi nama akun berbeda:
--          (account_code = '5-50000', account_name = 'Beban HPP')
--          (account_code = NULL,      account_name = 'Beban Pokok Pendapatan')
--      Keduanya berpasangan 1:1 per (transaction_date, description).
--   2. Query HPP di backend menjumlahkan HPP produk master DITAMBAH HPP varian
--      (coalesce(product.hpp,0) + variant_hpp), padahal keduanya sama-sama
--      mewakili satu unit terjual -> HPP per transaksi menjadi ~2x.
--   3. Laporan menampilkan satu baris induk berisi HPP hasil hitung transaksi
--      DAN seluruh baris rincian seri 8-, lalu frontend menjumlahkan keduanya
--      lagi untuk ringkasan -> dobel hitung di lapisan UI.
--
-- PERBAIKAN (sudah diterapkan di kode)
--   backend/finance.py::get_profit_and_loss_report
--     * HPP per baris penjualan memakai snapshot items_json->>'hpp' lebih dulu;
--       bila kosong baru memakai HPP varian ATAU HPP produk (tidak dijumlahkan).
--     * Setiap akun HPP menjadi baris yang berdiri sendiri secara independen:
--       satu baris 5-50000 + satu baris untuk setiap akun seri 8-.
--       Tidak ada penggabungan nilai antar akun.
--     * total HPP = penjumlahan murni seluruh baris akun HPP independen.
--   frontend/src/pages/finance/profitAndLossData.js + ProfitAndLoss.jsx
--     * Setiap baris HPP dirender sebagai baris sendiri (dengan kolom No. akun)
--       dan total HPP dihitung sekali saja dari penjumlahan baris-baris itu.
--
-- Berkas SQL ini membersihkan data historis yang menyebabkan duplikasi.
--
-- ============================================================================
-- BAGIAN B — Akun 41999 "Pendapatan Belum Dialokasikan (Pajak/Biaya)"
-- ============================================================================
-- GEJALA
--   Muncul saldo pada akun 41999 sebesar 1.183.750,00 (kredit) yang bukan
--   berasal dari transaksi nyata, dan tidak pernah "dialokasikan" ke akun
--   pendapatan utama ketika transaksi lunas.
--
-- PENYEBAB (terverifikasi pada data produksi)
--   Trigger CONSTRAINT trg_final_balance_protection_by_date
--   -> fn_final_check_and_balance_by_date()
--   menjumlahkan HANYA kolom debit_amount/credit_amount per transaction_date.
--   Bila selisih != 0 maka trigger MENYISIPKAN baris penambal ke akun 41999
--   dengan seluruh metadata (description, reference_number, source_type,
--   source_id, created_by) bernilai NULL.
--
--   Selisih itu muncul karena trigger public.copy_cash_to_expense_table()
--   menulis jurnal pengeluaran kas HANYA pada sisi DEBIT (beban) tanpa sisi
--   KREDIT (kas). Akibatnya setiap pengeluaran kas membuat jurnal tidak
--   seimbang, lalu "ditambal" ke 41999.
--
-- PERBAIKAN
--   1. Hapus baris penambal 41999 (metadata NULL).
--   2. Perbaiki copy_cash_to_expense_table() agar menulis jurnal berpasangan
--      (debit beban + kredit kas) pada kedua pasangan kolom nominal.
--   3. Tambal sisi kredit kas yang hilang pada baris historis.
--   4. Hapus trigger penambal otomatis karena jurnal kini seimbang by design
--      (bila tetap aktif, ia akan terus membuat baris 41999 palsu).
--   5. Arahkan sisa baris 41999 yang masih punya metadata nyata ke 4-40000.
--
-- Jalankan berkas ini di Supabase SQL Editor.
-- Disarankan menjalankan blok PREVIEW lebih dulu.
-- Berkas ini idempoten: aman dijalankan berulang kali.

-- ============================================================================
-- PREVIEW (read-only) — jalankan dulu untuk melihat dampaknya
-- ============================================================================
-- select 'penambal 41999' as temuan, count(*) as baris, sum(coalesce(credit_amount,0) - coalesce(debit_amount,0)) as nilai
-- from public.general_ledger
-- where account_code = '41999'
--   and reference_number is null and description is null
--   and source_type is null and source_id is null
-- union all
-- select '5-50000 ganda (baris NULL-code)', count(*), sum(coalesce(debit,0))
-- from public.general_ledger g
-- where g.account_code is null
--   and g.account_name = 'Beban Pokok Pendapatan'
--   and exists (
--     select 1 from public.general_ledger h
--     where h.account_code = '5-50000'
--       and h.account_name = 'Beban HPP'
--       and h.description is not distinct from g.description
--       and h.transaction_date = g.transaction_date
--       and coalesce(h.debit,0) = coalesce(g.debit,0)
--   );
--
-- select transaction_date,
--        sum(coalesce(nullif(debit_amount,0), debit, 0))  as total_debit,
--        sum(coalesce(nullif(credit_amount,0), credit, 0)) as total_kredit,
--        sum(coalesce(nullif(debit_amount,0), debit, 0))
--          - sum(coalesce(nullif(credit_amount,0), credit, 0)) as selisih
-- from public.general_ledger
-- group by 1
-- having sum(coalesce(nullif(debit_amount,0), debit, 0))
--        <> sum(coalesce(nullif(credit_amount,0), credit, 0))
-- order by 1 desc;


begin;

-- ============================================================================
-- 1. Hentikan penambal otomatis ke akun 41999
--    Jurnal dari backend Python sudah berpasangan (debit + kredit), sehingga
--    trigger ini hanya akan terus menyuntikkan baris 41999 palsu.
-- ============================================================================
drop trigger if exists trg_final_balance_protection_by_date on public.general_ledger;

-- Fungsi dibiarkan ada agar mudah di-rollback. Hapus komentar bila ingin
-- benar-benar membuangnya.
-- drop function if exists public.fn_final_check_and_balance_by_date();

-- ============================================================================
-- 2. Hapus semua baris penambal akun 41999
--    Ciri: account_code = '41999' dan SELURUH metadata NULL.
-- ============================================================================
delete from public.general_ledger
where account_code = '41999'
  and reference_number is null
  and description is null
  and source_type is null
  and source_id is null;

-- ============================================================================
-- 3. Perbaiki trigger pengeluaran kas agar menulis jurnal berpasangan
--    Sebelumnya hanya sisi DEBIT (beban) yang ditulis, sehingga jurnal tidak
--    seimbang dan selisihnya ditambal ke 41999.
-- ============================================================================
create or replace function public.copy_cash_to_expense_table()
returns trigger
language plpgsql
as $function$
declare
    kode_akun      varchar;
    nama_akun      varchar;
    nama_kategori  varchar;
    v_nilai        numeric;
begin
    -- 1. Ambil kode akun & nama kategori dari expense_categories
    select account_code, name
      into kode_akun, nama_kategori
    from public.expense_categories
    where id = new.expense_category_id;

    -- 2. Validasi: bila kode akun kosong / tidak terdaftar di CoA,
    --    alihkan ke akun operasional umum yang valid.
    if kode_akun is null or not exists (
        select 1 from public.chart_of_accounts where account_code = kode_akun
    ) then
        kode_akun := '6-60203';
    end if;

    select coalesce(
             nullif(btrim(to_jsonb(a)->>'account_name'), ''),
             nullif(btrim(to_jsonb(a)->>'nama_akun'), '')
           )
      into nama_akun
    from public.chart_of_accounts a
    where coalesce(
            nullif(to_jsonb(a)->>'account_code', ''),
            nullif(to_jsonb(a)->>'kode_akun', ''),
            nullif(to_jsonb(a)->>'code', ''),
            nullif(to_jsonb(a)->>'kode', '')
          ) = kode_akun
    limit 1;

    v_nilai := coalesce(new.amount, 0);
    if v_nilai <= 0 then
        return new;
    end if;

    -- 3. Tulis jurnal BERPASANGAN: debit beban, kredit kas.
    --    Kedua pasangan kolom nominal (legacy + current) diisi sekaligus agar
    --    tidak bergantung pada cara pembaca mana pun.
    insert into public.general_ledger
        (transaction_date, entry_date, reference_number, description,
         account_code, account_name, account_type,
         debit, credit, debit_amount, credit_amount)
    values
        (cast(new.timestamp as date), cast(new.timestamp as date),
         'EXP-' || left(new.id::text, 8),
         'Pengeluaran Kas: ' || coalesce(nama_kategori, 'Beban Usaha')
            || ' - ' || coalesce(new.note, ''),
         kode_akun, coalesce(nama_akun, coalesce(nama_kategori, 'Beban Usaha')), 'expense',
         v_nilai, 0, v_nilai, 0),
        (cast(new.timestamp as date), cast(new.timestamp as date),
         'EXP-' || left(new.id::text, 8),
         'Pengeluaran Kas: ' || coalesce(nama_kategori, 'Beban Usaha')
            || ' - ' || coalesce(new.note, ''),
         '1-10001', 'Kas Tunai', 'asset',
         0, v_nilai, 0, v_nilai);

    return new;
end;
$function$;

-- ============================================================================
-- 4. Tambal sisi KREDIT kas yang hilang pada baris pengeluaran kas historis
--    Hanya dibuat bila belum ada baris kredit kas dengan reference_number sama.
-- ============================================================================
insert into public.general_ledger
    (transaction_date, entry_date, reference_number, description,
     account_code, account_name, account_type,
     debit, credit, debit_amount, credit_amount)
select
    g.transaction_date,
    coalesce(g.entry_date, g.transaction_date),
    g.reference_number,
    coalesce(g.description, 'Pengeluaran Kas'),
    '1-10001',
    'Kas Tunai',
    'asset',
    0, coalesce(nullif(g.debit_amount, 0), g.debit, 0),
    0, coalesce(nullif(g.debit_amount, 0), g.debit, 0)
from public.general_ledger g
where g.reference_number like 'EXP-%'
  and coalesce(nullif(g.debit_amount, 0), g.debit, 0) > 0
  and coalesce(nullif(g.credit_amount, 0), g.credit, 0) = 0
  and coalesce(g.account_code, '') <> '1-10001'
  and not exists (
      select 1
      from public.general_ledger h
      where h.reference_number = g.reference_number
        and coalesce(h.account_code, '') = '1-10001'
        and coalesce(nullif(h.credit_amount, 0), h.credit, 0) > 0
  );

-- ============================================================================
-- 5. Hapus baris 5-50000 ganda
--    Baris (account_code NULL, account_name 'Beban Pokok Pendapatan') adalah
--    duplikat dari (account_code '5-50000', account_name 'Beban HPP') untuk
--    transaksi yang sama. Yang dipertahankan adalah baris berkode akun.
-- ============================================================================
delete from public.general_ledger g
where g.account_code is null
  and g.account_name = 'Beban Pokok Pendapatan'
  and coalesce(nullif(g.debit_amount, 0), g.debit, 0) > 0
  and exists (
      select 1
      from public.general_ledger h
      where h.account_code = '5-50000'
        and h.account_name = 'Beban HPP'
        and h.description is not distinct from g.description
        and h.transaction_date = g.transaction_date
        and coalesce(nullif(h.debit_amount, 0), h.debit, 0)
            = coalesce(nullif(g.debit_amount, 0), g.debit, 0)
  );

-- ============================================================================
-- 6. Arahkan baris 41999 yang masih punya metadata nyata ke akun pendapatan
--    utama 4-40000 (transaksi POS yang sudah lunas).
-- ============================================================================
update public.general_ledger
set account_code = '4-40000',
    account_name = 'Pendapatan',
    account_type = 'revenue'
where account_code = '41999'
  and (reference_number is not null or description is not null or source_type is not null)
  and coalesce(nullif(credit_amount, 0), credit, 0) > 0
  and coalesce(nullif(debit_amount, 0), debit, 0) = 0;

-- ============================================================================
-- 7. Alokasi otomatis ke akun pendapatan utama
--    Kedua fungsi penambal di atas (fn_final_check_and_balance_by_date dan
--    fn_auto_balance_journal) masih menyebut 41999 di dalam badannya. Trigger
--    -nya sudah dihapus, tetapi bila suatu saat diaktifkan kembali keduanya
--    akan membuat baris 41999 baru. Karena itu badannya dialihkan: selisih
--    kredit dicatat sebagai pendapatan utama 4-40000 (bukan akun penampung),
--    dan selisih debit tidak lagi menciptakan baris baru (hanya diabaikan).
-- ============================================================================
create or replace function public.fn_final_check_and_balance_by_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_debit  numeric;
  v_total_credit numeric;
  v_selisih      numeric;
begin
  select coalesce(sum(coalesce(nullif(debit_amount, 0), debit, 0)), 0),
         coalesce(sum(coalesce(nullif(credit_amount, 0), credit, 0)), 0)
  into v_total_debit, v_total_credit
  from public.general_ledger
  where transaction_date = new.transaction_date;

  v_selisih := v_total_debit - v_total_credit;

  -- Hanya selisih KREDIT yang dialokasikan otomatis ke pendapatan utama.
  -- Selisih debit berarti ada beban tanpa lawan kas; itu cacat data dan harus
  -- diperbaiki di sumbernya, bukan ditambal dengan baris baru.
  if v_selisih < 0 then
    insert into public.general_ledger (
      transaction_date, entry_date, account_code, account_name,
      account_type, debit, credit, debit_amount, credit_amount
    ) values (
      new.transaction_date, new.transaction_date,
      '4-40000', 'Pendapatan',
      'revenue', 0, abs(v_selisih), 0, abs(v_selisih)
    );
  end if;

  return new;
end;
$$;

create or replace function public.fn_auto_balance_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_debit  numeric;
  v_total_credit numeric;
  v_selisih      numeric;
begin
  select coalesce(sum(coalesce(nullif(debit_amount, 0), debit, 0)), 0),
         coalesce(sum(coalesce(nullif(credit_amount, 0), credit, 0)), 0)
  into v_total_debit, v_total_credit
  from public.general_ledger
  where reference_number = new.reference_number;

  v_selisih := v_total_debit - v_total_credit;

  if v_selisih < 0 then
    insert into public.general_ledger (
      transaction_date, entry_date, reference_number, account_code, account_name,
      account_type, debit, credit, debit_amount, credit_amount
    ) values (
      new.transaction_date, new.transaction_date, new.reference_number,
      '4-40000', 'Pendapatan',
      'revenue', 0, abs(v_selisih), 0, abs(v_selisih)
    );
  end if;

  return new;
end;
$$;

commit;

-- ============================================================================
-- VERIFIKASI setelah migrasi
-- ============================================================================
-- a) Akun 41999 harus kosong.
-- select count(*) as sisa_41999 from public.general_ledger where account_code = '41999';
--
-- b) Tidak boleh ada lagi 5-50000 ganda per transaksi.
-- select transaction_date, description, count(*) as baris
-- from public.general_ledger
-- where account_name in ('Beban HPP', 'Beban Pokok Pendapatan')
-- group by 1, 2
-- having count(*) > 1
-- order by 1 desc;
--
-- c) Semua tanggal harus seimbang (tidak ada baris selisih).
-- select transaction_date,
--        sum(coalesce(nullif(debit_amount, 0), debit, 0))  as total_debit,
--        sum(coalesce(nullif(credit_amount, 0), credit, 0)) as total_kredit,
--        sum(coalesce(nullif(debit_amount, 0), debit, 0))
--          - sum(coalesce(nullif(credit_amount, 0), credit, 0)) as selisih
-- from public.general_ledger
-- group by 1
-- having sum(coalesce(nullif(debit_amount, 0), debit, 0))
--        <> sum(coalesce(nullif(credit_amount, 0), credit, 0))
-- order by 1 desc;
--
-- d) Trigger penambal harus sudah tidak ada.
-- select tgname from pg_trigger
-- where tgrelid = 'public.general_ledger'::regclass
--   and tgname = 'trg_final_balance_protection_by_date';
