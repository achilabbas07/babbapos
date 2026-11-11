-- Pengaturan markup Ojol global (persen) untuk menu ber-varian.
-- Kolom ini HANYA ditambahkan pada tabel pengaturan `app_profile`
-- (bukan tabel transaksional inti POS). Safe to run more than once.

ALTER TABLE public.app_profile
  ADD COLUMN IF NOT EXISTS ojol_markup_percent numeric NOT NULL DEFAULT 20;
