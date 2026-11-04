DO $migration$
DECLARE
  existing_view_definition text;
  required_column text;
BEGIN
  IF to_regclass('public.view_laporan_arus_kas_final') IS NULL THEN
    RAISE EXCEPTION 'View public.view_laporan_arus_kas_final tidak ditemukan.';
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
  INTO existing_view_definition;

  IF existing_view_definition IS NULL THEN
    RAISE EXCEPTION 'Definisi public.view_laporan_arus_kas_final tidak dapat dibaca.';
  END IF;
  existing_view_definition := regexp_replace(
    rtrim(existing_view_definition),
    ';[[:space:]]*$',
    ''
  );

  EXECUTE format(
    $view$
      CREATE OR REPLACE VIEW public.view_laporan_arus_kas_final AS
      WITH existing_rows AS (
        %s
      )
      SELECT
        tanggal_transaksi,
        keterangan,
        kode_akun_lawan,
        nama_akun_lawan,
        nilai_neto,
        aktivitas_arus_kas
      FROM existing_rows

      UNION ALL

      SELECT
        g.transaction_date AS tanggal_transaksi,
        g.description AS keterangan,
        g.account_code::text AS kode_akun_lawan,
        g.account_name AS nama_akun_lawan,
        (-g.credit)::bigint AS nilai_neto,
        '1. Aktivitas Operasional (CFO)' AS aktivitas_arus_kas
      FROM public.general_ledger AS g
      WHERE g.source_type = 'purchase'
        AND g.account_type = 'asset'
        AND g.credit > 0
        AND lower(g.account_name) ~ '(kas|bank|cash)'
        AND NOT EXISTS (
          SELECT 1
          FROM existing_rows AS old
          WHERE old.tanggal_transaksi = g.transaction_date
            AND old.keterangan ILIKE '%%' || g.source_id || '%%'
            AND old.aktivitas_arus_kas = '1. Aktivitas Operasional (CFO)'
            AND old.nilai_neto = -g.credit
        )
    $view$,
    existing_view_definition
  );
END
$migration$;
