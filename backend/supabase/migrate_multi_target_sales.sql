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
DO $constraint$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_targets_targetQty_check'
      AND conrelid = 'public.sales_targets'::regclass
  ) THEN
    ALTER TABLE public.sales_targets DROP CONSTRAINT sales_targets_targetQty_check;
  END IF;
  ALTER TABLE public.sales_targets
    ADD CONSTRAINT sales_targets_targetQty_check
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
