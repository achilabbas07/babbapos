-- Split Payment: simpan rincian multi-pembayaran pada transaksi.
-- Kolom ini murni tambahan (nullable default '[]') sehingga transaksi lama
-- dan klien lama tetap berjalan tanpa perubahan.
alter table transactions
  add column if not exists payments jsonb not null default '[]'::jsonb;

-- Backfill transaksi lama agar setiap baris punya minimal satu kaki pembayaran.
update transactions
set payments = jsonb_build_array(
  jsonb_build_object('method', method, 'amount', total)
)
where (payments is null or payments = '[]'::jsonb)
  and total > 0;

-- View arus kas membaca general_ledger; tidak ada perubahan struktur di sini.
-- Kolom payments hanya untuk rekap kasir/shift & struk, bukan sumber jurnal.
