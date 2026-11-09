-- ============================================================================
--  PERBAIKAN: kas keluar 500 karena copy_cash_to_expense_table() menulis dua
--  kaki jurnal dengan entry_id BERBEDA.
--  ---------------------------------------------------------------------------
--  Gejala
--    POST /api/shifts/cash-movements (type=out) -> HTTP 500.
--    Log: asyncpg.exceptions.CheckViolationError
--         "Jurnal tidak seimbang untuk entry_id ...: total debit 5000.00 <>
--          total kredit 0.00 (selisih 5000.00)"
--         HINT: Satu entry_id harus berisi pasangan debit dan kredit seimbang.
--
--  Penyebab
--    public.general_ledger.entry_id punya DEFAULT gen_random_uuid().
--    copy_cash_to_expense_table() meng-INSERT dua baris (debit beban + kredit
--    kas) tanpa menyebut entry_id, sehingga SETIAP baris mendapat entry_id
--    acak sendiri-sendiri. Constraint trigger
--    general_ledger_balance_guard (DEFERRABLE INITIALLY DEFERRED) memeriksa
--    keseimbangan PER entry_id saat COMMIT dan menolak kedua baris
--    satu-sisi tersebut. Trigger penjaga ini benar; penulis jurnalnya yang
--    salah karena memecah satu jurnal ke dua entry_id.
--
--  Perbaikan
--    Hitung SATU v_entry_id di awal fungsi dan tulis nilai itu pada kedua
--    baris. Pasangan debit/kredit kini seimbang per entry_id sehingga lolos
--    penjaga double-entry, dan expenses tetap menjadi single source of truth
--    (trigger sync_cash_movement_to_expenses tidak diubah).
--
--  Catatan
--    - Idempotent: create or replace function.
--    - Baris historis TIDAK diubah. Guard hanya memeriksa baris yang
--      di-INSERT/UPDATE/DELETE, jadi data lama tidak menghalangi transaksi baru.
-- ============================================================================

create or replace function public.copy_cash_to_expense_table()
returns trigger
language plpgsql
as $function$
declare
    kode_akun      varchar;
    nama_akun      varchar;
    nama_kategori  varchar;
    v_nilai        numeric;
    v_entry_id     uuid := gen_random_uuid();
begin
    -- 1. Ambil kode akun & nama kategori dari expense_categories
    select account_code, name
      into kode_akun, nama_kategori
    from public.expense_categories
    where id = new.expense_category_id;

    -- 2. Validasi: bila kode akun kosong / tidak terdaftar di CoA,
    --    alihkan ke akun operasional umum yang valid.
    if kode_akun is null or not exists (
        select 1 from public.chart_of_accounts where account_code = kode_akun
    ) then
        kode_akun := '6-60203';
    end if;

    select coalesce(
             nullif(btrim(to_jsonb(a)->>'account_name'), ''),
             nullif(btrim(to_jsonb(a)->>'nama_akun'), '')
           )
      into nama_akun
    from public.chart_of_accounts a
    where coalesce(
            nullif(to_jsonb(a)->>'account_code', ''),
            nullif(to_jsonb(a)->>'kode_akun', ''),
            nullif(to_jsonb(a)->>'code', ''),
            nullif(to_jsonb(a)->>'kode', '')
          ) = kode_akun
    limit 1;

    v_nilai := coalesce(new.amount, 0);
    if v_nilai <= 0 then
        return new;
    end if;

    -- 3. Tulis jurnal BERPASANGAN: debit beban, kredit kas.
    --    Kedua baris WAJIB berbagi satu entry_id agar penjaga double-entry
    --    (general_ledger_balance_guard) melihatnya sebagai satu jurnal yang
    --    seimbang. Tanpa entry_id eksplisit, DEFAULT gen_random_uuid() membuat
    --    tiap baris menjadi jurnal satu-sisi dan COMMIT ditolak (HTTP 500).
    insert into public.general_ledger
        (entry_id, transaction_date, entry_date, reference_number, description,
         account_code, account_name, account_type,
         debit, credit, debit_amount, credit_amount)
    values
        (v_entry_id, cast(new.timestamp as date), cast(new.timestamp as date),
         'EXP-' || left(new.id::text, 8),
         'Pengeluaran Kas: ' || coalesce(nama_kategori, 'Beban Usaha')
            || ' - ' || coalesce(new.note, ''),
         kode_akun, coalesce(nama_akun, coalesce(nama_kategori, 'Beban Usaha')), 'expense',
         v_nilai, 0, v_nilai, 0),
        (v_entry_id, cast(new.timestamp as date), cast(new.timestamp as date),
         'EXP-' || left(new.id::text, 8),
         'Pengeluaran Kas: ' || coalesce(nama_kategori, 'Beban Usaha')
            || ' - ' || coalesce(new.note, ''),
         '1-10001', 'Kas Tunai', 'asset',
         0, v_nilai, 0, v_nilai);

    return new;
end;
$function$;

-- ============================================================================
--  VERIFIKASI
--    Setelah migrasi, uji satu kas keluar. Kedua baris EXP-% harus berbagi
--    entry_id yang sama dan seimbang:
--
--    select entry_id, account_code, debit_amount, credit_amount
--    from public.general_ledger
--    where reference_number = 'EXP-<8 char pertama id cash_movement>'
--    order by account_code;
-- ============================================================================
