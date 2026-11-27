-- Void transaksi selesai (bukan Open Bill): kolom penanda void pada
-- `transactions` dan tautan eksplisit `void_logs.transactionId`.
--
-- Konteks: endpoint `POST /api/transactions/{tid}/void` (`backend/server.py`)
-- sudah ada, tetapi skema belum menyediakan kolom tujuannya sehingga penanda
-- void sebelumnya diabaikan secara best-effort. Migrasi ini melengkapinya agar
-- void transaksi selesai dapat disimpan penuh.
--
-- AMAN dijalankan berulang kali:
--   * semua penambahan memakai `IF NOT EXISTS` (kolom & index);
--   * tidak ada UPDATE/DELETE -> data transaksi lama TIDAK diubah;
--   * `status` default `'paid'` (baris lama otomatis dianggap lunas, tanpa
--     rewrite tabel karena default konstan pada PostgreSQL 11+);
--   * kolom void lain nullable (NULL sampai transaksi benar-benar di-void);
--   * `void_logs.billId` dipertahankan apa adanya (pembaca lama tetap jalan).
--
-- Catatan penting: nama kolom camelCase WAJIB dikutip (mis. "voidedAt") agar
-- tersimpan case-sensitive, sehingga `pgdb` (`column_name` dari
-- information_schema) cocok dengan kunci payload di `server.py`
-- (`status`, `voidedAt`, `voidedBy`, `voidReason`, `transactionId`).

-- ---------- 1. Kolom void pada `transactions` (transaksi selesai) ----------
alter table public.transactions
  add column if not exists status       text not null default 'paid',
  add column if not exists "voidedAt"   timestamptz,
  add column if not exists "voidedBy"   text,
  add column if not exists "voidReason" text;

-- Index parsial untuk rekap transaksi void (baris non-void TIDAK diindeks).
create index if not exists transactions_status_void_idx
  on public.transactions ("voidedAt")
  where status = 'void';

-- ---------- 2. Tautan void log -> transaksi selesai ----------
-- `transactionId` ditambahkan di samping `billId` yang sudah ada. Untuk void
-- transaksi selesai kedua kolom berisi id transaksi; untuk void Open Bill lama
-- `transactionId` tetap NULL (kompatibel dengan baris lama).
alter table public.void_logs
  add column if not exists "transactionId" text;

-- Index parsial: hanya baris dengan `transactionId` yang diindeks (baris void
-- Open Bill lama ber-NULL tidak ikut masuk index).
create index if not exists void_logs_transaction_id_idx
  on public.void_logs ("transactionId")
  where "transactionId" is not null;

-- Tidak ada perubahan pada alur checkout, HPP, stok, jurnal, thermal printing,
-- maupun shift report. Kolom ini murni metadata void pada transaksi selesai.
