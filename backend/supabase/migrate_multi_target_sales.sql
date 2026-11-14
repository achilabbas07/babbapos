-- Multi-Target Sales: dukungan tipe target berdampingan (non-destruktif).
--
-- Semua kolom baru NULLABLE / punya DEFAULT sehingga data target lama
-- (yang hanya menyimpan "productIds", "productNames", "targetQty") tetap
-- terbaca dan berperilaku sama seperti sebelumnya.
--
--   targetType   'item_quantity' (default) | 'revenue_amount' | 'time_bounded'
--   targetAmount omzet Rupiah yang ditargetkan (khusus tipe omzet/waktu)
--   periodType   'shift' (default) | 'daily' | 'weekly' | 'monthly'
--   metric       'revenue' | 'item_quantity' (khusus time_bounded)
--   startTime /  jam operasional "HH:MM" (opsional, boleh melewati tengah malam)
--   endTime
--
-- Safe to run more than once.

ALTER TABLE public.sales_targets
  ADD COLUMN IF NOT EXISTS "targetType"   text    NOT NULL DEFAULT 'item_quantity',
  ADD COLUMN IF NOT EXISTS "targetAmount" numeric,
  ADD COLUMN IF NOT EXISTS "periodType"   text    NOT NULL DEFAULT 'shift',
  ADD COLUMN IF NOT EXISTS "metric"       text,
  ADD COLUMN IF NOT EXISTS "startTime"    text,
  ADD COLUMN IF NOT EXISTS "endTime"      text;

-- targetQty boleh kosong untuk target omzet (tidak ada kuantitas item).
ALTER TABLE public.sales_targets
  ALTER COLUMN "targetQty" DROP NOT NULL;

-- Pertahankan targetQty > 0 hanya bila diisi.
--
-- Nama constraint CHECK yang dibuat inline di schema.sql di-generate oleh
-- PostgreSQL menjadi huruf kecil (sales_targets_targetqty_check) dan identifier
-- tanpa tanda kutip juga di-fold ke huruf kecil. Karena itu constraint lama
-- dicari berdasarkan definisinya, bukan berdasarkan nama.
DO $constraint$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.sales_targets'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%"targetQty"%'
  LOOP
    EXECUTE format('ALTER TABLE public.sales_targets DROP CONSTRAINT %I', existing.conname);
  END LOOP;

  ALTER TABLE public.sales_targets
    ADD CONSTRAINT sales_targets_targetqty_check
    CHECK ("targetQty" IS NULL OR "targetQty" > 0);
END;
$constraint$;

ALTER TABLE public.sales_targets
  DROP CONSTRAINT IF EXISTS sales_targets_target_type_check;
ALTER TABLE public.sales_targets
  ADD CONSTRAINT sales_targets_target_type_check
  CHECK ("targetType" IN ('item_quantity', 'revenue_amount', 'time_bounded'));

ALTER TABLE public.sales_targets
  DROP CONSTRAINT IF EXISTS sales_targets_period_type_check;
ALTER TABLE public.sales_targets
  ADD CONSTRAINT sales_targets_period_type_check
  CHECK ("periodType" IN ('shift', 'daily', 'weekly', 'monthly'));
