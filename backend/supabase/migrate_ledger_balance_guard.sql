-- ============================================================================
--  PENJAGA PERMANEN DOUBLE-ENTRY UNTUK public.general_ledger
--  ---------------------------------------------------------------------------
--  Tujuan
--    Menolak (RAISE EXCEPTION) setiap jurnal yang tidak seimbang, sehingga
--    selisih neraca seperti Rp 1.868.825,00 tidak bisa terulang.
--
--  Prinsip
--    1. DEFERRED CONSTRAINT TRIGGER -> diperiksa saat COMMIT, bukan per baris.
--       Ini wajib karena satu jurnal ditulis dengan beberapa INSERT/executemany
--       dalam satu transaksi; pemeriksaan per baris akan selalu gagal.
--    2. HANYA MENOLAK. Trigger ini TIDAK PERNAH menyisipkan baris penambal.
--       (Trigger lama `trg_final_balance_protection_by_date` menyisipkan baris
--       ke akun 41999 dan justru merusak data; jangan diulangi.)
--    3. Dua lapis pemeriksaan:
--         GUARD A : per (source_type, source_id)  -> unit transaksi sebenarnya
--         GUARD B : per entry_id                  -> unit jurnal
--       GUARD A menangkap kasus "kaki kas ganda" (penyebab selisih 1,8 M).
--       GUARD B menangkap jurnal manual satu sisi (source_type NULL).
--
--  Kondisi data saat migrasi ini dibuat (2026-11-09, sudah diverifikasi):
--    - Total ledger seimbang: debit = kredit = 157.406.471,62 (selisih 0,00)
--    - Grup (source_type, source_id) tidak seimbang : 0 dari 399  -> GUARD A aman
--    - Grup entry_id tidak seimbang                 : 204 dari 604 -> dikecualikan
--      (warisan data lama: backfill `migrate_finance_postings.sql` memakai
--       gen_random_uuid() PER BARIS sehingga satu jurnal terpecah ke banyak
--       entry_id, plus jurnal "Koreksi" manual yang ditulis satu sisi.)
--
--  Catatan penting
--    - Baris warisan yang dikecualikan TIDAK diperiksa ulang, tetapi tetap
--      dihitung dalam saldo. Pengecualian hanya melewati pemeriksaan.
--    - Jika suatu saat baris warisan diperbaiki menjadi seimbang, pengecualian
--      boleh dihapus dari tabel pengecualian (lihat bagian VERIFIKASI).
--    - Semua penulis jurnal di aplikasi sudah membungkus INSERT dalam
--      `async with connection.transaction()`, sehingga trigger deferred aman.
-- ============================================================================


-- ============================================================================
--  BAGIAN 1 - TABEL PENGECUALIAN (snapshot data warisan)
-- ============================================================================
create table if not exists public.general_ledger_balance_exempt (
    entry_id    uuid primary key,
    reason      text not null default 'legacy unbalanced entry (pre-guard snapshot)',
    created_at  timestamptz not null default now()
);

comment on table public.general_ledger_balance_exempt is
    'Daftar entry_id warisan yang tidak seimbang SEBELUM penjaga double-entry dipasang. '
    'Trigger general_ledger_balance_guard melewati pemeriksaan untuk entry_id di sini. '
    'Jangan menambah baris baru kecuali benar-benar data historis.';

alter table public.general_ledger_balance_exempt enable row level security;
revoke all on table public.general_ledger_balance_exempt from public, anon, authenticated;

-- Isi snapshot: semua entry_id yang saat ini tidak seimbang.
insert into public.general_ledger_balance_exempt (entry_id, reason)
select
    g.entry_id,
    'legacy unbalanced entry (pre-guard snapshot)'
from (
    select entry_id
    from public.general_ledger
    where entry_id is not null
    group by entry_id
    having sum(coalesce(nullif(debit_amount, 0), debit, 0))
        <> sum(coalesce(nullif(credit_amount, 0), credit, 0))
) as g
on conflict (entry_id) do nothing;


-- ============================================================================
--  BAGIAN 2 - FUNGSI PEMERIKSA
-- ============================================================================
create or replace function public.fn_general_ledger_assert_balanced(
    p_source_type text,
    p_source_id   text,
    p_entry_id    uuid
)
returns void
language plpgsql
as $$
declare
    v_dr numeric;
    v_cr numeric;
begin
    -- ------------------------------------------------------------------
    -- GUARD A : keseimbangan per (source_type, source_id)
    -- ------------------------------------------------------------------
    if p_source_type is not null and p_source_id is not null then
        select
            coalesce(sum(coalesce(nullif(debit_amount, 0), debit, 0)), 0),
            coalesce(sum(coalesce(nullif(credit_amount, 0), credit, 0)), 0)
        into v_dr, v_cr
        from public.general_ledger
        where source_type = p_source_type
          and source_id   = p_source_id;

        if v_dr <> v_cr then
            raise exception
                'Jurnal tidak seimbang untuk sumber % / %: total debit % <> total kredit % (selisih %)',
                p_source_type, p_source_id, v_dr, v_cr, v_dr - v_cr
                using
                    errcode = 'check_violation',
                    hint    = 'Pastikan setiap transaksi menulis pasangan debit dan kredit dengan nominal sama. '
                              'Jangan menambah kaki kas kedua untuk sumber yang sama.';
        end if;
    end if;

    -- ------------------------------------------------------------------
    -- GUARD B : keseimbangan per entry_id (kecuali data warisan)
    -- ------------------------------------------------------------------
    if p_entry_id is not null then
        if exists (
            select 1
            from public.general_ledger_balance_exempt
            where entry_id = p_entry_id
        ) then
            return;
        end if;

        select
            coalesce(sum(coalesce(nullif(debit_amount, 0), debit, 0)), 0),
            coalesce(sum(coalesce(nullif(credit_amount, 0), credit, 0)), 0)
        into v_dr, v_cr
        from public.general_ledger
        where entry_id = p_entry_id;

        if v_dr <> v_cr then
            raise exception
                'Jurnal tidak seimbang untuk entry_id %: total debit % <> total kredit % (selisih %)',
                p_entry_id, v_dr, v_cr, v_dr - v_cr
                using
                    errcode = 'check_violation',
                    hint    = 'Satu entry_id harus berisi pasangan debit dan kredit yang seimbang. '
                              'Jangan menulis jurnal koreksi satu sisi.';
        end if;
    end if;
end;
$$;

comment on function public.fn_general_ledger_assert_balanced(text, text, uuid) is
    'Memeriksa keseimbangan debit/kredit general_ledger per (source_type, source_id) dan per entry_id. '
    'Melempar check_violation bila tidak seimbang. Tidak pernah menyisipkan baris penambal.';


-- ============================================================================
--  BAGIAN 3 - FUNGSI TRIGGER
-- ============================================================================
create or replace function public.fn_general_ledger_balance_guard()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'INSERT' then
        perform public.fn_general_ledger_assert_balanced(
            new.source_type, new.source_id, new.entry_id
        );

    elsif tg_op = 'DELETE' then
        perform public.fn_general_ledger_assert_balanced(
            old.source_type, old.source_id, old.entry_id
        );

    else  -- UPDATE
        perform public.fn_general_ledger_assert_balanced(
            old.source_type, old.source_id, old.entry_id
        );
        -- Bila baris dipindahkan ke grup lain, grup tujuan juga harus diperiksa.
        if new.source_type is distinct from old.source_type
           or new.source_id is distinct from old.source_id
           or new.entry_id    is distinct from old.entry_id then
            perform public.fn_general_ledger_assert_balanced(
                new.source_type, new.source_id, new.entry_id
            );
        end if;
    end if;

    return null;  -- AFTER trigger: nilai kembalian diabaikan
end;
$$;

comment on function public.fn_general_ledger_balance_guard() is
    'Trigger deferred: memastikan setiap jurnal general_ledger seimbang saat COMMIT.';


-- ============================================================================
--  BAGIAN 4 - PASANG TRIGGER (DEFERRED)
-- ============================================================================
drop trigger if exists general_ledger_balance_guard on public.general_ledger;

create constraint trigger general_ledger_balance_guard
    after insert or update or delete on public.general_ledger
    deferrable initially deferred
    for each row
    execute function public.fn_general_ledger_balance_guard();


-- ============================================================================
--  BAGIAN 5 - INDEKS PENDUKUNG (mempercepat pemeriksaan)
-- ============================================================================
-- GUARD A memakai prefix (source_type, source_id); indeks unik yang sudah ada
-- (general_ledger_source_line_uidx) sudah bisa dipakai untuk itu.
-- GUARD B memakai entry_id; general_ledger_entry_idx sudah ada.
-- Tidak ada indeks tambahan yang diperlukan.


-- ============================================================================
--  VERIFIKASI (jalankan manual, read-only)
-- ============================================================================
-- -- 1. Trigger terpasang dan deferred?
-- select t.tgname, t.tgenabled, t.tgdeferrable, t.tginitdeferred,
--        pg_get_triggerdef(t.oid) as definisi
-- from pg_trigger t
-- join pg_class c on c.oid = t.tgrelid
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname = 'general_ledger'
--   and not t.tgisinternal;
--
-- -- 2. Berapa entry_id warisan yang dikecualikan?
-- select count(*) as jumlah_pengecualian from public.general_ledger_balance_exempt;
--
-- -- 3. Apakah masih ada grup (source_type, source_id) tidak seimbang?
-- select source_type, source_id,
--        sum(coalesce(nullif(debit_amount,0), debit,0)) as dr,
--        sum(coalesce(nullif(credit_amount,0), credit,0)) as cr
-- from public.general_ledger
-- where source_type is not null and source_id is not null
-- group by source_type, source_id
-- having sum(coalesce(nullif(debit_amount,0), debit,0))
--     <> sum(coalesce(nullif(credit_amount,0), credit,0));
--
-- -- 4. Apakah masih ada entry_id tidak seimbang DI LUAR pengecualian?
-- select g.entry_id, g.dr, g.cr
-- from (
--     select entry_id,
--            sum(coalesce(nullif(debit_amount,0), debit,0)) as dr,
--            sum(coalesce(nullif(credit_amount,0), credit,0)) as cr
--     from public.general_ledger
--     where entry_id is not null
--     group by entry_id
-- ) g
-- where g.dr <> g.cr
--   and not exists (select 1 from public.general_ledger_balance_exempt e
--                   where e.entry_id = g.entry_id);
--
-- -- 5. Total ledger seimbang?
-- select sum(coalesce(nullif(debit_amount,0), debit,0)) as total_debit,
--        sum(coalesce(nullif(credit_amount,0), credit,0)) as total_kredit,
--        sum(coalesce(nullif(debit_amount,0), debit,0))
--          - sum(coalesce(nullif(credit_amount,0), credit,0)) as selisih
-- from public.general_ledger;
--
-- -- 6. Bersihkan pengecualian yang sudah seimbang (opsional, aman):
-- delete from public.general_ledger_balance_exempt e
-- where exists (
--     select 1 from (
--         select entry_id,
--                sum(coalesce(nullif(debit_amount,0), debit,0)) as dr,
--                sum(coalesce(nullif(credit_amount,0), credit,0)) as cr
--         from public.general_ledger
--         where entry_id = e.entry_id
--         group by entry_id
--     ) g
--     where g.dr = g.cr
-- );


-- ============================================================================
--  ROLLBACK (jalankan manual bila perlu melepas penjaga)
-- ============================================================================
-- drop trigger if exists general_ledger_balance_guard on public.general_ledger;
-- drop function if exists public.fn_general_ledger_balance_guard();
-- drop function if exists public.fn_general_ledger_assert_balanced(text, text, uuid);
-- -- tabel pengecualian boleh dibiarkan (tidak mengganggu) atau dihapus:
-- -- drop table if exists public.general_ledger_balance_exempt;
