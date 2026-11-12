-- ============================================================================
--  PERBAIKAN ZONA WAKTU: pencatatan `public.expenses.date`
--  ---------------------------------------------------------------------------
--  Warkop Babba beroperasi di WITA (Asia/Makassar, UTC+8) tanpa DST, sedangkan
--  server/Vercel berjalan pada UTC. Trigger sync_cash_movement_to_expenses
--  menyalin `cash_movements."timestamp"` apa adanya ke `expenses.date`. Bila
--  sumbernya UTC mentah, tanggal kalender yang terbaca pada laporan (yang
--  memakai `(expense.date at time zone 'Asia/Makassar')::date`) dapat bergeser
--  hingga 8 jam / satu hari untuk pencatatan dini hari.
--
--  Perbaikan ini HANYA menyentuh ekspresi timestamp pada trigger sinkronisasi:
--    * nilai `NEW."timestamp"` (yang kini dikirim backend sebagai ISO ber-offset
--      +08:00) tetap dipakai apa adanya;
--    * fallback bila NULL dibuat EKSPLISIT WITA lewat round-trip
--      `(now() at time zone 'Asia/Makassar') at time zone 'Asia/Makassar'`,
--      bukan `now()`/UTC mentah.
--
--  Tidak ada perubahan pada kategori, nominal, relasi, maupun logika bisnis.
--  Idempotent: create or replace function.
-- ============================================================================

create or replace function public.sync_cash_movement_to_expenses()
returns trigger
language plpgsql
as $function$
DECLARE
    v_cat_name TEXT;
BEGIN
    -- Hanya sinkronkan jika transaksi bertipe pengeluaran ('out')
    IF NEW.type = 'out' THEN

        -- Ambil nama kategori pengeluaran jika ada relasinya
        BEGIN
            SELECT name INTO v_cat_name FROM public.expense_categories WHERE id = NEW.expense_category_id;
        EXCEPTION WHEN OTHERS THEN
            v_cat_name := 'Kasir';
        END;

        IF v_cat_name IS NULL THEN
            v_cat_name := 'Kasir';
        END IF;

        -- Eksekusi INSERT ke tabel expenses.
        -- Stempel waktu eksplisit WITA: sumber `NEW."timestamp"` sudah ber-offset
        -- +08:00 dari backend; fallback memakai jam dinding Asia/Makassar yang
        -- dikonversi kembali menjadi timestamptz (bukan now() UTC mentah).
        INSERT INTO public.expenses (
            id,
            date,
            category,
            description,
            amount,
            "userName",
            "userId",
            category_id
        )
        VALUES (
            COALESCE(NEW.id, gen_random_uuid()::text),
            COALESCE(
                NEW."timestamp",
                (now() AT TIME ZONE 'Asia/Makassar') AT TIME ZONE 'Asia/Makassar'
            ),
            v_cat_name,
            COALESCE(NEW.note, 'Pengeluaran Kasir (Transit)'),
            NEW.amount,
            COALESCE(NEW."userName", 'Kasir'),
            NEW."userId",
            NEW.expense_category_id
        );

    END IF;

    RETURN NEW;
END;
$function$;

-- VERIFIKASI (jalankan manual bila perlu):
--   select p.proname, pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'sync_cash_movement_to_expenses';
