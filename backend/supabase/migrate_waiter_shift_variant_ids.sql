ALTER TABLE public.order_logs
  ADD COLUMN IF NOT EXISTS "variantId" bigint;
