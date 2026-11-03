-- Persist waiter-shift report snapshots and product variant names in order logs.
-- Safe to run more than once.

BEGIN;

ALTER TABLE public.waiter_shifts
  ADD COLUMN IF NOT EXISTS report jsonb;

ALTER TABLE public.order_logs
  ADD COLUMN IF NOT EXISTS "variantName" text NOT NULL DEFAULT '';

COMMIT;
