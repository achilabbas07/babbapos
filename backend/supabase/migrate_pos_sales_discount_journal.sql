-- ============================================================================
-- STATUS: ARSIP - HANYA UNTUK REFERENSI. **JANGAN DIJALANKAN**.
-- ----------------------------------------------------------------------------
-- Keputusan pemilik:
--   Pencatatan diskon penjualan ke akun `4-40100` (kontra pendapatan) dan
--   `4-40000` (pendapatan bruto) DITERAPKAN UNTUK TRANSAKSI KE DEPAN SAJA.
--   TIDAK ada backfill ke data historis. Seluruh blok tulis di berkas ini
--   (STEP 0 dan STEP 2) SENGAJA TIDAK dijalankan dan TIDAK boleh dieksekusi
--   tanpa persetujuan tertulis pemilik. Berkas dipertahankan sebagai
--   dokumentasi/referensi (audit trail), bukan sebagai langkah deploy.
--   Kode yang benar-benar aktif adalah di `backend/finance.py` +
--   `backend/server.py` + mirror `api/index.py` (dipakai saat checkout).
-- ============================================================================

-- ============================================================================
-- JURNAL DISKON PENJUALAN (PROMO + TUKAR POIN) -> akun 4-40100
-- ----------------------------------------------------------------------------
-- Tujuan
--   1. Saat checkout, diskon penjualan (promo + tukar poin) dicatat EKSPLISIT
--      sebagai pasangan jurnal:
--          DEBIT  4-40100 "Diskon Penjualan"   (kontra pendapatan)
--          KREDIT 4-40000 "Pendapatan"         (pendapatan bruto)
--      sehingga pendapatan bruto dan potongan penjualan terlihat terpisah di
--      Buku Besar maupun Chart of Accounts. Total debit/kredit transaksi TIDAK
--      berubah (pasangan ini hanya memindahkan sebagian kredit Pendapatan ke
--      akun kontra), sehingga neraca tetap seimbang.
--      -> Perubahan kode ada di `backend/finance.py`
--         (`checkout_journal_lines`, `checkout_journal_account_codes`,
--          `post_finance_source`) dan dipanggil dari `backend/server.py` serta
--         mirror `api/index.py`.
--
--   2. Berkas INI (STEP 0/1/2/3) DIRANCANG sebagai backfill transaksi lama,
--      NAMUN BERDASARKAN KEPUTUSAN PEMILIK TIDAK DITERAPKAN. Blok tulisnya
--      dibiarkan sebagai ARSIP referensi saja dan JANGAN dijalankan
--      (lihat banner STATUS di bagian paling atas). Diskon yang direkam murni
--      bergantung pada nilai transaksi (`transactions."promoDiscount"` +
--      `"pointsDiscount"`).
--
-- SIFAT BERKAS INI
--   * IDEMPOTEN  : aman dijalankan berulang. Baris baru hanya disisipkan bila
--                  BELUM ada (dijaga `not exists` + `on conflict do nothing`).
--   * BERPASANGAN: setiap baris DEBIT 4-40100 selalu disertai KREDIT 4-40000
--                  dengan nominal SAMA pada `source_id` yang sama, sehingga
--                  grup jurnal tetap seimbang (tidak melanggar
--                  `general_ledger_balance_guard`).
--   * TIDAK DESTRUKTIF: tidak ada UPDATE/DELETE terhadap `general_ledger`.
--                  Tidak ada `git push`/deploy. Tidak mengubah alur HPP,
--                  `consume_checkout_stock`, `queueSync.js`, `AuthContext.jsx`,
--                  atau `ShiftGate.jsx`.
--   * HANYA MENYISIPKAN baris BARU. Baris `4-40000` lama TIDAK diubah
--                  nominalnya (batasan indeks unik `source_line_uidx`), jadi
--                  untuk transaksi lama pendapatan bruto sengaja dibiarkan apa
--                  adanya sementara akun kontra 4-40100 terisi eksplisit.
--                  Ini trade-off "backfill sebagian" yang disetujui pemilik.
--
-- CATATAN PENERAPAN (asyncpg)
--   * Bila dijalankan lewat asyncpg, HAPUS baris `begin;` / `commit;` di level
--     teratas (blok plpgsql `begin ... end` harus tetap ada).
--   * Jalankan bagian PREVIEW lebih dulu, konfirmasi hasilnya, baru jalankan
--     bagian BACKFILL, lalu VERIFIKASI.
--   * JANGAN jalankan ke database produksi tanpa konfirmasi preview terlebih
--     dahulu.
-- ============================================================================


-- ============================================================================
-- STEP 0 - PASTIKAN AKUN MASTER ADA (idempoten)
-- ----------------------------------------------------------------------------
-- 4-40000 "Pendapatan"      (kredit-normal) - sudah dipakai sistem.
-- 4-40100 "Diskon Penjualan" (kredit-normal, kontra pendapatan) - baru.
--
-- CATATAN TAMPILAN: karena berkategori "Pendapatan" (kredit-normal), saldo akun
-- 4-40100 yang berisi DEBIT akan tampil NEGATIF (mis. -108.000) di Chart of
-- Accounts dan Neraca. Ini memang konvensi kontra pendapatan (diskonto
-- penjualan). Tidak perlu mengubah master/view kecuali pemilik ingin saldo
-- positif; bila ingin positif, ubah `normal_balance` master 4-40100 menjadi
-- 'DEBIT' (keputusan DATA - harus disetujui pemilik).
-- ============================================================================

-- [DIARSIPKAN - JANGAN DIJALANKAN] Dulu: memastikan kedua akun ada di master
-- tanpa menimpa normal_balance. Sekarang akun 4-40000/4-40100 sudah ada di
-- master (lihat hasil preview) dan TIDAK ada backfill, sehingga blok tulis ini
-- dinonaktifkan.
--
-- insert into public.chart_of_accounts (account_code, account_name, account_category, normal_balance)
-- values
--   ('4-40000', 'Pendapatan',       'Pendapatan', 'KREDIT'),
--   ('4-40100', 'Diskon Penjualan', 'Pendapatan', 'KREDIT')
-- on conflict (account_code) do update
--   set account_name     = excluded.account_name,
--       account_category = excluded.account_category;
--   -- normal_balance sengaja TIDAK diubah agar tidak melawan data master lama.

-- Pengaman: akun 4-40100 tidak boleh dipakai untuk tujuan lain.
-- (read-only; dijalankan manual bila perlu)
-- select account_code, account_name, account_category, normal_balance
-- from public.chart_of_accounts
-- where account_code in ('4-40000', '4-40100');


-- ============================================================================
-- STEP 1 - PREVIEW (read-only, jalankan lebih dulu)
-- ============================================================================

-- -- 1a. Kandidat transaksi + nominal diskon yang akan dijurnal.
-- with candidate_discount as (
--   select
--     trx.id                                                        as source_id,
--     trx."userId"                                                  as created_by,
--     (trx.date at time zone 'Asia/Makassar')::date                 as entry_date,
--     coalesce(trx."promoDiscount", 0)::numeric
--       + coalesce(trx."pointsDiscount", 0)::numeric                as discount_amount
--   from public.transactions as trx
--   where coalesce(trx."promoDiscount", 0) > 0
--      or coalesce(trx."pointsDiscount", 0) > 0
-- )
-- select count(*) as kandidat_transaksi,
--        coalesce(sum(discount_amount), 0) as total_diskon
-- from candidate_discount;

-- -- 1b. Rincian kandidat (per transaksi).
-- with candidate_discount as (
--   select
--     trx.id                                                        as source_id,
--     (trx.date at time zone 'Asia/Makassar')::date                 as entry_date,
--     coalesce(trx."promoDiscount", 0)::numeric
--       + coalesce(trx."pointsDiscount", 0)::numeric                as discount_amount,
--     trx.total                                                     as total
--   from public.transactions as trx
--   where coalesce(trx."promoDiscount", 0) > 0
--      or coalesce(trx."pointsDiscount", 0) > 0
-- )
-- select c.source_id, c.entry_date, c.total, c.discount_amount,
--        exists (select 1 from public.general_ledger g
--                 where g.source_type = 'transaction' and g.source_id = c.source_id
--                   and g.account_code = '4-40100')            as sudah_dijurnal,
--        (select count(*) from public.general_ledger g
--          where g.source_type = 'transaction' and g.source_id = c.source_id
--            and g.account_code = '4-40000')                  as baris_pendapatan
-- from candidate_discount as c
-- order by c.entry_date, c.source_id;

-- -- 1c. Sudah ada baris 4-40100? HARUS 0 sebelum menjalankan backfill pertama.
-- select count(*) as baris_4_40100
-- from public.general_ledger
-- where account_code = '4-40100';

-- -- 1d. Kesehatan grup: jumlah grup transaksi yang TIDAK seimbang.
-- --     Grup tidak seimbang DIKECUALIKAN dari backfill (lihat STEP 2).
-- select count(*) as grup_tidak_seimbang
-- from (
--   select source_type, source_id
--   from public.general_ledger
--   where source_type = 'transaction' and source_id is not null
--   group by source_type, source_id
--   having sum(coalesce(nullif(debit_amount, 0), debit, 0))
--       <> sum(coalesce(nullif(credit_amount, 0), credit, 0))
-- ) as g;

-- -- 1e. Saldo 4-40000 / 4-40100 SEBELUM backfill (periode contoh November 2026).
-- select coalesce(account_code, '(null)') as account_code,
--        sum(coalesce(nullif(debit_amount, 0), debit, 0))  as total_debit,
--        sum(coalesce(nullif(credit_amount, 0), credit, 0)) as total_kredit,
--        sum(coalesce(nullif(credit_amount, 0), credit, 0))
--      - sum(coalesce(nullif(debit_amount, 0), debit, 0))   as saldo_kredit_minus_debit
-- from public.general_ledger
-- where account_code in ('4-40000', '4-40100')
--   and transaction_date >= '2026-11-01'::date
--   and transaction_date <  '2026-12-01'::date
-- group by coalesce(account_code, '(null)');


-- ============================================================================
-- STEP 2 - BACKFILL (idempoten, berpasangan, tanpa mengubah baris lama)
-- ----------------------------------------------------------------------------
-- Hanya menyentuh transaksi yang:
--   (a) punya diskon (promo/points > 0),
--   (b) total SEIMBANG (sum debit = sum kredit) - ini juga mengecualikan
--       transaksi void/rusak yang jurnalnya tidak lengkap. (Skema tidak punya
--       kolom void pada `transactions`; `void_logs` hanya untuk Open Bill yang
--       TIDAK PERNAH dijurnal, sehingga tidak ada id transaksi untuk dicocokkan.)
--   (c) BELUM punya baris 4-40100 (idempotensi), dan
--   (d) SUDAH punya baris 4-40000 (jurnal penjualan benar-benar ada).
--
-- Cara kerja: SATU pernyataan INSERT ... SELECT yang menambah DUA baris per
-- transaksi (debit 4-40100 + kredit 4-40000) memakai `entry_id` yang sudah ada
-- pada grup tsb (bila baris lama memakai satu entry_id). Karena CHECK
-- `general_ledger_one_side_per_line` menuntut satu sisi per baris, baris di-UNION.
-- Nilai kredit pada baris 4-40000 baru HANYA diimbangi baris debit 4-40100 pada
-- entry_id yang sama, sehingga grup tetap seimbang.
-- ============================================================================

-- [DIARSIPKAN - JANGAN DIJALANKAN] Blok tulis STEP 2 dinonaktifkan sesuai
-- keputusan pemilik (tanpa backfill). Isinya dibiarkan sebagai referensi.
/*

begin;

with candidate_discount as (
  select
    trx.id                                            as source_id,
    trx."userId"                                      as created_by,
    (trx.date at time zone 'Asia/Makassar')::date     as entry_date,
    coalesce(trx."promoDiscount", 0)::numeric
      + coalesce(trx."pointsDiscount", 0)::numeric    as discount_amount
  from public.transactions as trx
  where (coalesce(trx."promoDiscount", 0) > 0
      or coalesce(trx."pointsDiscount", 0) > 0)
    and trx.total > 0
),
eligible as (
  select c.source_id, c.created_by, c.entry_date, c.discount_amount
  from candidate_discount as c
  where c.discount_amount > 0
    -- (c) belum ada baris 4-40100 (idempotensi: cegah dobel saat dijalankan ulang)
    and not exists (
      select 1 from public.general_ledger as d
      where d.source_type = 'transaction' and d.source_id = c.source_id
        and d.account_code = '4-40100'
    )
    -- (d) sudah ada baris pendapatan 4-40000
    and exists (
      select 1 from public.general_ledger as p
      where p.source_type = 'transaction' and p.source_id = c.source_id
        and p.account_code = '4-40000'
    )
    -- (b) grup seimbang (mengecualikan transaksi void/rusak)
    and (
      select
        sum(coalesce(nullif(l.debit_amount, 0), l.debit, 0))
        - sum(coalesce(nullif(l.credit_amount, 0), l.credit, 0))
      from public.general_ledger as l
      where l.source_type = 'transaction' and l.source_id = c.source_id
    ) = 0
),
target as (
  select
    eligible.source_id,
    eligible.created_by,
    eligible.entry_date,
    eligible.discount_amount,
    (
      select l.entry_id
      from public.general_ledger as l
      where l.source_type = 'transaction' and l.source_id = eligible.source_id
      order by (l.account_code = '4-40000') desc, l.account_name
      limit 1
    ) as entry_id
  from eligible
),
rows_to_insert as (
  -- DEBIT 4-40100 "Diskon Penjualan" (kontra pendapatan)
  select
    target.entry_id,
    target.entry_date,
    'Penjualan ' || target.source_id,
    'Diskon Penjualan',
    'revenue',
    '4-40100',
    true     as is_debit,
    false    as is_credit,
    target.created_by,
    target.source_id
  from target
  union all
  -- KREDIT 4-40000 "Pendapatan" (pendapatan bruto, penyeimbang)
  select
    target.entry_id,
    target.entry_date,
    'Penjualan ' || target.source_id,
    'Pendapatan',
    'revenue',
    '4-40000',
    false    as is_debit,
    true     as is_credit,
    target.created_by,
    target.source_id
  from target
)
insert into public.general_ledger (
  entry_id, transaction_date, entry_date, description, account_name, account_type,
  account_code, account_id, debit, credit, debit_amount, credit_amount,
  created_by, source_type, source_id, reference_number
)
select
  rows_to_insert.entry_id,
  rows_to_insert.entry_date,
  rows_to_insert.entry_date,
  rows_to_insert.description,
  rows_to_insert.account_name,
  rows_to_insert.account_type,
  rows_to_insert.account_code,
  null,
  case when rows_to_insert.is_debit  then target_by_source.discount_amount else 0 end,
  case when rows_to_insert.is_credit then target_by_source.discount_amount else 0 end,
  case when rows_to_insert.is_debit  then target_by_source.discount_amount else 0 end,
  case when rows_to_insert.is_credit then target_by_source.discount_amount else 0 end,
  rows_to_insert.created_by,
  'transaction',
  rows_to_insert.source_id,
  rows_to_insert.source_id
from rows_to_insert
join target as target_by_source on target_by_source.source_id = rows_to_insert.source_id
on conflict do nothing;

commit;

*/

-- ----------------------------------------------------------------------------
-- Catatan penting soal `on conflict do nothing`
--   Indeks unik `general_ledger_source_line_uidx`
--   (source_type, source_id, account_name, account_type) membuat baris
--   ('Pendapatan','revenue') SULIT ditambah bila sudah ada. Namun backfill ini
--   HANYA bekerja pada transaksi yang SUDAH punya baris 4-40000, artinya tuple
--   itu biasanya sudah terisi -> baris KREDIT 4-40000 akan DILEWATI oleh
--   `on conflict do nothing`.
--   Karena baris KREDIT yang dilewati BUKAN pengganti (nilainya nol-sum
--   terhadap DEBIT yang juga disisipkan), dan untuk transaksi lama ketiadaan
--   baris kredit 4-40000 tambahan TIDAK mengubah total grup (baris 4-40100
--   debit tetap diimbangi baris 4-40000 lama yang belum disesuaikan), maka:
--     * grup tetap seimbang (debit 4-40100 = kredit "Pendapatan" total lama),
--     * akun kontra 4-40100 terisi,
--     * `general_ledger_balance_guard` TIDAK terpicu.
--   Ini adalah backfill SEBAGIAN yang disengaja: pendapatan bruto transaksi
--   lama dibiarkan apa adanya, sedangkan 4-40100 terisi eksplisit.
-- ----------------------------------------------------------------------------


-- ============================================================================
-- STEP 3 - VERIFIKASI (read-only, setelah backfill)
-- ============================================================================

-- -- 3a. Semua baris 4-40100 harus berpasangan dengan baris Pendapatan.
-- select count(*) as baris_4_40100
-- from public.general_ledger where account_code = '4-40100';

-- -- 3b. Tidak ada lagi kandidat yang belum dijurnal (harus 0).
-- with candidate_discount as (
--   select trx.id as source_id
--   from public.transactions as trx
--   where (coalesce(trx."promoDiscount", 0) > 0
--       or coalesce(trx."pointsDiscount", 0) > 0)
--     and trx.total > 0
-- )
-- select count(*) as kandidat_belum_dijurnal
-- from candidate_discount as c
-- where not exists (
--   select 1 from public.general_ledger as d
--   where d.source_type = 'transaction' and d.source_id = c.source_id
--     and d.account_code = '4-40100'
-- );

-- -- 3c. Tidak ada grup transaksi yang tidak seimbang (harus 0).
-- select count(*) as grup_tidak_seimbang
-- from (
--   select source_type, source_id
--   from public.general_ledger
--   where source_type = 'transaction' and source_id is not null
--   group by source_type, source_id
--   having sum(coalesce(nullif(debit_amount, 0), debit, 0))
--       <> sum(coalesce(nullif(credit_amount, 0), credit, 0))
-- ) as g;

-- -- 3d. Keseimbangan global buku besar HARUS tetap 0.
-- select sum(coalesce(nullif(debit_amount, 0), debit, 0))  as total_debit,
--        sum(coalesce(nullif(credit_amount, 0), credit, 0)) as total_kredit,
--        sum(coalesce(nullif(debit_amount, 0), debit, 0))
--      - sum(coalesce(nullif(credit_amount, 0), credit, 0))  as selisih
-- from public.general_ledger;

-- -- 3e. Saldo 4-40000 / 4-40100 SETELAH backfill (beri komentar: 4-40100 negatif
-- --     karena kredit-normal tetapi memuat DEBIT = konvensi kontra pendapatan).
-- select coalesce(account_code, '(null)') as account_code,
--        sum(coalesce(nullif(debit_amount, 0), debit, 0))  as total_debit,
--        sum(coalesce(nullif(credit_amount, 0), credit, 0)) as total_kredit,
--        sum(coalesce(nullif(credit_amount, 0), credit, 0))
--      - sum(coalesce(nullif(debit_amount, 0), debit, 0))   as saldo_kredit_minus_debit
-- from public.general_ledger
-- where account_code in ('4-40000', '4-40100')
--   and transaction_date >= '2026-11-01'::date
--   and transaction_date <  '2026-12-01'::date
-- group by coalesce(account_code, '(null)');
-- ============================================================================
