DO $migration$
DECLARE
  existing_view_definition text;
  account_name_expression_count integer;
BEGIN
  IF to_regclass('public.view_laporan_arus_kas_final') IS NULL THEN
    RAISE EXCEPTION 'View public.view_laporan_arus_kas_final tidak ditemukan.';
  END IF;

  SELECT pg_get_viewdef('public.view_laporan_arus_kas_final'::regclass, false)
  INTO existing_view_definition;

  IF existing_view_definition IS NULL THEN
    RAISE EXCEPTION 'Definisi public.view_laporan_arus_kas_final tidak dapat dibaca.';
  END IF;

  SELECT count(*)
  INTO account_name_expression_count
  FROM regexp_matches(
    existing_view_definition,
    'g[.]account_name[[:space:]]+AS[[:space:]]+nama_akun_lawan',
    'gi'
  );

  IF account_name_expression_count = 1 THEN
    existing_view_definition := regexp_replace(
      existing_view_definition,
      'g[.]account_name[[:space:]]+AS[[:space:]]+nama_akun_lawan',
      '''Beban Pokok Pendapatan'' AS nama_akun_lawan',
      'i'
    );

    EXECUTE
      'CREATE OR REPLACE VIEW public.view_laporan_arus_kas_final AS '
      || existing_view_definition;
  ELSIF account_name_expression_count = 0
    AND position('beban pokok pendapatan' IN lower(existing_view_definition)) > 0
  THEN
    RAISE NOTICE 'Label pembelian tunai pada view sudah diperbarui.';
  ELSE
    RAISE EXCEPTION
      'Ekspresi akun pembelian tunai tidak ditemukan secara unik pada view arus kas (ditemukan %).',
      account_name_expression_count;
  END IF;
END
$migration$;
