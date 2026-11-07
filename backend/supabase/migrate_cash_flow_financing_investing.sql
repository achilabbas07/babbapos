-- migrate_cash_flow_financing_investing.sql
--
-- Tujuan:
--   Laporan Arus Kas (public.view_laporan_arus_kas_final) belum pernah
--   menghasilkan baris untuk:
--     * Aktivitas Pendanaan (CFF) -> akun Ekuitas / Modal, mis. "3-10000",
--       "3-10100" (Prive), "3-20000" (Laba Ditahan).
--     * Aktivitas Investasi (CFI) -> akun aset investasi berawalan "9-",
--       mis. "9-10001" (Aset Lainnya / Aset Penyesuaian).
--   Akibatnya laporan selalu menampilkan 0 akun pada CFI/CFF.
--
-- Penyebab:
--   Definisi view lama hanya membaca public.view_jurnal_kas_final, yang
--   bersumber dari public.cash_movements (kas masuk/keluar harian). Tabel itu
--   tidak pernah menyimpan transaksi setoran modal / prive, sehingga aturan
--   prefix "3%" -> CFF dan "1-2%"/"12%" -> CFI tidak pernah terpicu.
--   Transaksi modal disimpan sebagai jurnal berpasangan di public.general_ledger
--   (mis. debit 1-10001 Kas Tunai + kredit 3-10000 Modal Disetor).
--
-- Solusi (idempoten):
--   Bangun ulang view sebagai UNION ALL dari sumber yang sudah ada plus sumber
--   baru dari public.general_ledger:
--     1. Baris lama (dari view lama) dipertahankan apa adanya.
--     2. Baris arus kas lama yang sebelumnya "4. Belum Terklasifikasi"
--        diklasifikasi ulang: prefix "3" -> CFF, "9" -> CFI.
--     3. Baris BARU dari general_ledger yang menyentuh akun kas/bank pada satu
--        sisi dan akun lawan berawalan "3-" (CFF) atau "9-" (CFI) pada sisi
--        lain, dipasangkan per transaksi sehingga nilai_neto-nya akurat.
--
-- Catatan: gunakan kedua pasangan kolom jumlah general_ledger
--   (debit_amount/credit_amount) dan warisan (debit/credit).

DO $migration$
DECLARE
  old_view_definition text;
  required_column text;
BEGIN
  IF to_regclass('public.view_laporan_arus_kas_final') IS NULL THEN
    RAISE EXCEPTION 'View public.view_laporan_arus_kas_final tidak ditemukan.';
  END IF;

  IF to_regclass('public.general_ledger') IS NULL THEN
    RAISE EXCEPTION 'Tabel public.general_ledger tidak ditemukan.';
  END IF;

  FOREACH required_column IN ARRAY ARRAY[
    'tanggal_transaksi',
    'keterangan',
    'kode_akun_lawan',
    'nama_akun_lawan',
    'nilai_neto',
    'aktivitas_arus_kas'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = 'public.view_laporan_arus_kas_final'::regclass
        AND attname = required_column
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION
        'Kolom wajib % tidak ditemukan pada public.view_laporan_arus_kas_final.',
        required_column;
    END IF;
  END LOOP;

  SELECT pg_get_viewdef('public.view_laporan_arus_kas_final'::regclass, false)
  INTO old_view_definition;

  IF old_view_definition IS NULL THEN
    RAISE EXCEPTION 'Definisi public.view_laporan_arus_kas_final tidak dapat dibaca.';
  END IF;
  old_view_definition := regexp_replace(
    rtrim(old_view_definition),
    ';[[:space:]]*$',
    ''
  );

  EXECUTE format(
    $view$
      CREATE OR REPLACE VIEW public.view_laporan_arus_kas_final AS
      WITH existing_rows AS (
        %s
      ),
      -- Reklasifikasi baris arus kas lama: ekuitas/modal -> CFF, aset 9- -> CFI.
      reclassified_rows AS (
        SELECT
          tanggal_transaksi,
          keterangan,
          kode_akun_lawan,
          nama_akun_lawan,
          nilai_neto,
          CASE
            WHEN kode_akun_lawan LIKE '3-%%' THEN '3. Aktivitas Pendanaan (CFF)'
            WHEN kode_akun_lawan LIKE '9-%%' THEN '2. Aktivitas Investasi (CFI)'
            ELSE aktivitas_arus_kas
          END AS aktivitas_arus_kas
        FROM existing_rows
      ),
      -- Klasifikasi aktivitas berdasarkan kode akun lawan (dipakai sumber ledger).
      classified_ledger AS (
        SELECT
          g.entry_id,
          g.transaction_date,
          g.description,
          g.created_at,
          g.account_code,
          g.account_name,
          coalesce(nullif(g.debit_amount, 0), g.debit, 0) AS dr,
          coalesce(nullif(g.credit_amount, 0), g.credit, 0) AS cr,
          CASE
            WHEN lower(g.account_name) ~ '(kas|bank|cash|qris|rekening)' THEN true
            ELSE false
          END AS is_cash_account,
          CASE
            WHEN g.account_code LIKE '3-%%' THEN '3. Aktivitas Pendanaan (CFF)'
            WHEN g.account_code LIKE '9-%%' THEN '2. Aktivitas Investasi (CFI)'
            ELSE NULL
          END AS target_activity
        FROM public.general_ledger AS g
      ),
      -- Hanya transaksi yang menyentuh akun kas/bank DAN akun lawan CFF/CFI.
      matched_entries AS (
        SELECT DISTINCT leg.entry_id
        FROM classified_ledger AS leg
        WHERE leg.is_cash_account
          AND EXISTS (
            SELECT 1
            FROM classified_ledger AS other
            WHERE other.entry_id IS NOT DISTINCT FROM leg.entry_id
              AND other.target_activity IS NOT NULL
              AND NOT other.is_cash_account
          )
      ),
      -- Total arus kas (neto) untuk tiap transaksi yang cocok.
      entry_cash_flow AS (
        SELECT
          leg.entry_id,
          -- Kas bertambah dengan DEBIT (kas masuk) dan berkurang dengan KREDIT.
          coalesce(sum(leg.dr) - sum(leg.cr), 0) AS cash_flow
        FROM classified_ledger AS leg
        JOIN matched_entries AS matched
          ON matched.entry_id IS NOT DISTINCT FROM leg.entry_id
        WHERE leg.is_cash_account
        GROUP BY leg.entry_id
      ),
      -- Total sisi akun lawan CFF/CFI untuk pembagian proporsional.
      counterpart_legs AS (
        SELECT DISTINCT
          other.entry_id,
          other.transaction_date,
          other.description,
          other.created_at,
          other.account_code,
          other.account_name,
          other.target_activity,
          (other.cr - other.dr) AS counterpart_flow,
          sum(other.cr - other.dr) OVER (PARTITION BY other.entry_id) AS counterpart_total
        FROM classified_ledger AS other
        JOIN matched_entries AS matched
          ON matched.entry_id IS NOT DISTINCT FROM other.entry_id
        WHERE other.target_activity IS NOT NULL
          AND NOT other.is_cash_account
          AND (other.dr <> 0 OR other.cr <> 0)
      ),
      ledger_rows AS (
        SELECT
          counterpart.transaction_date AS transaction_date,
          counterpart.description AS description,
          counterpart.account_code AS account_code,
          counterpart.account_name AS account_name,
          -- Bagi arus kas transaksi secara proporsional terhadap sisi lawan,
          -- sehingga jumlah baris = total arus kas (tanpa dobel hitung).
          CASE
            WHEN counterpart.counterpart_total <> 0 THEN
              entry_cash_flow.cash_flow
                * counterpart.counterpart_flow
                / counterpart.counterpart_total
            ELSE 0
          END AS nilai_neto,
          counterpart.target_activity AS target_activity
        FROM counterpart_legs AS counterpart
        JOIN entry_cash_flow
          ON entry_cash_flow.entry_id IS NOT DISTINCT FROM counterpart.entry_id
      )
      SELECT
        tanggal_transaksi,
        keterangan,
        kode_akun_lawan,
        nama_akun_lawan,
        nilai_neto,
        aktivitas_arus_kas
      FROM reclassified_rows

      UNION ALL

      SELECT
        ledger_rows.transaction_date AS tanggal_transaksi,
        ledger_rows.description AS keterangan,
        ledger_rows.account_code::text AS kode_akun_lawan,
        ledger_rows.account_name::text AS nama_akun_lawan,
        ledger_rows.nilai_neto::bigint AS nilai_neto,
        ledger_rows.target_activity AS aktivitas_arus_kas
      FROM ledger_rows
      WHERE ledger_rows.nilai_neto <> 0
        AND NOT EXISTS (
          SELECT 1
          FROM reclassified_rows AS old
          WHERE old.tanggal_transaksi = ledger_rows.transaction_date
            AND old.kode_akun_lawan = ledger_rows.account_code
            AND old.aktivitas_arus_kas = ledger_rows.target_activity
        )
    $view$,
    old_view_definition
  );
END
$migration$;
