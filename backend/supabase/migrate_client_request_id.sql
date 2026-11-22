-- Idempotensi transaksi berbasis `client_request_id` (Tahap 2 antrean offline).
-- Kolom ini OPSIONAL / nullable sehingga transaksi lama dan klien lama tetap
-- berjalan tanpa perubahan. Hanya diisi oleh klien yang mendukung antrean
-- offline (kirim `client_request_id`), lalu dipakai untuk mencegah transaksi
-- ganda saat permintaan yang sama dikirim ulang (retry / sinkronisasi).

alter table transactions
  add column if not exists client_request_id text;

-- Unik per `client_request_id` yang terisi (partial index): menjamin
-- permintaan balapan (race) tetap tidak bisa membuat dua transaksi untuk kunci
-- yang sama, sekaligus mengizinkan banyak baris lama dengan nilai NULL.
create unique index if not exists transactions_client_request_id_uidx
  on transactions (client_request_id)
  where client_request_id is not null;

-- Tidak ada perubahan pada perhitungan harga/diskon/pembayaran/HPP/jurnal.
-- Kolom ini murni metadata idempotensi; alur transaksi normal tidak bergantung
-- padanya (kolom hanya ditulis bila `client_request_id` diisi).
