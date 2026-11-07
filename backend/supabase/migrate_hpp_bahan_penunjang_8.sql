-- ============================================================================
-- HPP "Bahan Penunjang" (akun seri 8-)
-- ----------------------------------------------------------------------------
-- Tujuan:
--   1. Biaya penunjang produksi (air galon, bumbu/sayur, es kristal, creamer,
--      tissu, cup/sealer) dipindahkan dari akun seri 5- ke akun seri 8-.
--   2. Semua akun seri 8- diklasifikasikan sebagai Harga Pokok Penjualan
--      (cost_of_goods_sold) sehingga tampil sebagai rincian di bawah pos
--      "Beban Pokok Pendapatan" pada laporan laba rugi.
--   3. expense_categories diarahkan ulang ke kode akun 8- agar pemetaan
--      kategori pengeluaran konsisten dengan COA.
--
-- Catatan penerapan:
--   * Saat dijalankan lewat asyncpg, hapus baris `begin;` / `commit;` di
--     level teratas (blok plpgsql `begin ... end` harus tetap ada).
--   * Idempoten: aman dijalankan berulang.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Akun seri 8- (Bahan Penunjang) di Chart of Accounts
-- ---------------------------------------------------------------------------
insert into public.chart_of_accounts (account_code, account_name, account_category, normal_balance)
values
  ('8-51001', 'Air Galon',           'Bahan Penunjang', 'DEBIT'),
  ('8-51002', 'Creamer/Fullcream',   'Bahan Penunjang', 'DEBIT'),
  ('8-51004', 'Es Kristal',          'Bahan Penunjang', 'DEBIT'),
  ('8-51005', 'Bumbu/Sayur',         'Bahan Penunjang', 'DEBIT'),
  ('8-51006', 'Tissu',               'Bahan Penunjang', 'DEBIT'),
  ('8-51007', 'Cup/Sealer/Pipet/Tutup', 'Bahan Penunjang', 'DEBIT')
on conflict (account_code) do update
  set account_category = excluded.account_category;
  -- normal_balance sengaja TIDAK diubah: baris lama memakai 'DEBIT' (huruf besar).

-- Akun seri 8- yang sudah ada tetapi kategorinya masih lama.
update public.chart_of_accounts
   set account_category = 'Bahan Penunjang'
 where account_code like '8-%'
   and coalesce(account_category, '') <> 'Bahan Penunjang';

-- ---------------------------------------------------------------------------
-- 2. expense_categories -> kode akun 8-
-- ---------------------------------------------------------------------------
update public.expense_categories set account_code = '8-51001' where name = 'Air Galon';
update public.expense_categories set account_code = '8-51002' where name = 'Creamer/Fullcream';
update public.expense_categories set account_code = '8-51004' where name = 'Es Kristal';
update public.expense_categories set account_code = '8-51005' where name = 'Bumbu/Sayur';
update public.expense_categories set account_code = '8-51006' where name = 'Tissu';

-- Kategori "Gas" dan "Bayar Cemilan" bukan bahan penunjang produksi:
-- keduanya beban operasional, bukan HPP. Diarahkan ke akun generik
-- "Beban Operasional Lainnya" (6-9999) — bukan 6-60203 (Perbaikan & Pemeliharaan)
-- yang maknanya tidak cocok.
update public.expense_categories set account_code = '6-9999' where name = 'Gas' and coalesce(account_code, '') like '5-%';
update public.expense_categories set account_code = '6-9999' where name = 'Bayar Cemilan' and coalesce(account_code, '') like '5-%';

-- ---------------------------------------------------------------------------
-- 3. View laba rugi: SENGAJA TIDAK DIBUAT ULANG.
--
--    Percobaan menulis ulang view agar membaca kedua pasangan kolom nominal
--    (debit/debit_amount) TERBUKTI MENGUBAH ANGKA LAPORAN secara tidak benar:
--    baris saldo penyeimbang harian pada akun '41999' ("Pendapatan Belum
--    Dialokasikan", dibuat oleh fn_final_check_and_balance_by_date) hanya terisi
--    di credit_amount. Definisi view lama memakai credit - debit HANYA bila
--    kategori akun memuat '%revenue%' atau kode '4-%'; '41999' tidak memenuhi
--    keduanya sehingga bernilai 0. Dengan pembacaan kedua pasangan kolom, baris
--    itu menjadi debit - credit = -853.750 dan menurunkan pendapatan secara palsu.
--
--    Untuk cabang laporan laba rugi yang memakai view ini (revenue + cogs saja),
--    akun 4-* dan 5-* seluruhnya hanya terisi di kolom legacy, jadi pembacaan
--    kedua pasangan kolom tidak menambah satu rupiah pun. Akun 8-* dikecualikan
--    dari cabang tersebut dan diambil langsung dari general_ledger.
--
--    Yang diperlukan hanyalah komentar dokumentasi di bawah ini.
-- ---------------------------------------------------------------------------

comment on view public.view_profit_and_loss is
  'Laba rugi per baris ledger. Akun seri 8- (Bahan Penunjang) = cost_of_goods_sold (HPP).';
