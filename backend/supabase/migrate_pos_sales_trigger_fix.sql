-- ============================================================================
-- PERBAIKAN: penulisan jurnal penjualan POS ke public.general_ledger
--
-- GEJALA
--   Checkout POS gagal dengan pesan:
--     column "date" of relation "general_ledger" does not exist
--
-- PENYEBAB (diverifikasi langsung pada database Supabase produksi)
--   Tabel public.transactions memiliki dua trigger lama yang menulis jurnal
--   sendiri, dan keduanya memakai nama tabel/kolom yang sudah tidak ada:
--
--   1. trigger trg_record_sales_clean -> function record_sales_to_ledger_clean()
--      - INSERT INTO public.general_ledger (id, date, ...)
--        -> kolom "date" tidak ada (nama benar: transaction_date)
--      - NEW.created_at / NEW.total_amount
--        -> kolom tidak ada di public.transactions (nama benar: NEW.date / NEW.total)
--      - gen_random_uuid()::text ke kolom id bertipe uuid -> type mismatch
--      - hanya menulis sisi debit & kredit pendapatan, tanpa HPP
--
--   2. trigger trg_sales_to_ledger -> function trg_record_sales_clean()
--      - NEW.total_amount -> kolom tidak ada
--      - hanya menulis satu baris (kredit pendapatan), jurnal tidak seimbang
--
--   Backend Python (backend/finance.py::post_finance_source) SUDAH menulis
--   jurnal penjualan POS yang lengkap dan seimbang (Kas/Bank, Pendapatan,
--   Beban HPP, Persediaan) dengan source_type = 'transaction'.
--   Jadi trigger di atas hanya menghasilkan duplikasi + error.
--
-- SOLUSI
--   Hapus kedua trigger penulis jurnal yang rusak dari public.transactions.
--   Backend Python tetap menjadi satu-satunya penulis jurnal penjualan POS
--   (alur laporan tidak berubah: semua view/report membaca public.general_ledger).
--   Fungsi-fungsi trigger tetap disediakan dalam versi yang SUDAH DIPERBAIKI
--   (memakai tabel public.transactions, kolom transaction_date, debit/credit,
--   dan debit_amount/credit_amount) agar aman bila suatu saat diaktifkan lagi.
--
-- Jalankan di Supabase SQL Editor. Aman dijalankan berulang (idempoten).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Hentikan penulis jurnal duplikat/rusak pada public.transactions
-- ----------------------------------------------------------------------------
drop trigger if exists trg_record_sales_clean on public.transactions;
drop trigger if exists trg_sales_to_ledger on public.transactions;

-- ----------------------------------------------------------------------------
-- 2. Versi benar dari record_sales_to_ledger_clean()
--    - sumber data : public.transactions
--    - tanggal     : transaction_date (bukan "date")
--    - nominal     : debit/credit DAN debit_amount/credit_amount
--    - jurnal seimbang: Kas/Bank + Pendapatan + Beban HPP + Persediaan
--    - idempoten   : tidak menulis ulang bila jurnal transaksi sudah ada
-- ----------------------------------------------------------------------------
create or replace function public.record_sales_to_ledger_clean()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id    uuid := gen_random_uuid();
  v_date        date;
  v_total       numeric(16, 2) := 0;
  v_hpp         numeric(16, 2) := 0;
  v_cash_code   text;
  v_cash_name   text;
  v_description text;
begin
  -- Jangan menulis ganda bila backend sudah mencatat jurnal transaksi ini.
  if exists (
    select 1
    from public.general_ledger as ledger
    where ledger.source_type = 'transaction'
      and ledger.source_id = new.id
  ) then
    return new;
  end if;

  v_date := coalesce(new.date::date, new."orderTime"::date, current_date);
  v_total := coalesce(new.total, 0)::numeric(16, 2);
  if v_total <= 0 then
    return new;
  end if;

  if new.method = 'Cash' then
    v_cash_code := '1-10001';
    v_cash_name := 'Kas Tunai';
  else
    v_cash_code := '1-10002';
    v_cash_name := 'Bank';
  end if;

  if new.items_json is not null
     and jsonb_typeof(new.items_json) = 'array'
     and jsonb_array_length(new.items_json) > 0 then
    select coalesce(sum(
             coalesce(nullif(item ->> 'hpp', '')::numeric, 0)
             * coalesce(nullif(item ->> 'qty', '')::numeric, 0)
           ), 0)
    into v_hpp
    from jsonb_array_elements(new.items_json) as item;
  end if;

  v_description := 'Penjualan ' || new.id;

  -- Debit: kas / bank bertambah
  insert into public.general_ledger (
    entry_id, transaction_date, entry_date, description,
    account_name, account_type, account_code, account_id,
    debit, credit, debit_amount, credit_amount,
    created_by, source_type, source_id, reference_number
  ) values (
    v_entry_id, v_date, v_date, v_description,
    v_cash_name, 'asset', v_cash_code, null,
    v_total, 0, v_total, 0,
    new."userId", 'transaction', new.id, new.id
  );

  -- Kredit: pendapatan
  insert into public.general_ledger (
    entry_id, transaction_date, entry_date, description,
    account_name, account_type, account_code, account_id,
    debit, credit, debit_amount, credit_amount,
    created_by, source_type, source_id, reference_number
  ) values (
    v_entry_id, v_date, v_date, v_description,
    'Pendapatan', 'revenue', '4-40000', null,
    0, v_total, 0, v_total,
    new."userId", 'transaction', new.id, new.id
  );

  -- Debit HPP & kredit persediaan (agar jurnal seimbang)
  if v_hpp > 0 then
    insert into public.general_ledger (
      entry_id, transaction_date, entry_date, description,
      account_name, account_type, account_code, account_id,
      debit, credit, debit_amount, credit_amount,
      created_by, source_type, source_id, reference_number
    ) values (
      v_entry_id, v_date, v_date, v_description,
      'Beban HPP', 'expense', '5-50000', null,
      v_hpp, 0, v_hpp, 0,
      new."userId", 'transaction', new.id, new.id
    );

    insert into public.general_ledger (
      entry_id, transaction_date, entry_date, description,
      account_name, account_type, account_code, account_id,
      debit, credit, debit_amount, credit_amount,
      created_by, source_type, source_id, reference_number
    ) values (
      v_entry_id, v_date, v_date, v_description,
      'Persediaan bahan baku', 'asset', '1-10003', null,
      0, v_hpp, 0, v_hpp,
      new."userId", 'transaction', new.id, new.id
    );
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Versi benar dari trg_record_sales_clean()
--    (fungsi lama hanya menulis satu sisi; sekarang mendelegasikan ke fungsi
--     seimbang di atas agar tidak ada dua implementasi yang berbeda)
-- ----------------------------------------------------------------------------
create or replace function public.trg_record_sales_clean()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.record_sales_to_ledger_clean();
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Versi benar dari record_sales_to_ledger() (fungsi legacy)
--    Dulu menulis tanpa account_name/account_type sehingga gagal NOT NULL.
--    Sekarang mendelegasikan ke implementasi yang sudah diperbaiki.
-- ----------------------------------------------------------------------------
create or replace function public.record_sales_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.record_sales_to_ledger_clean();
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Versi benar dari fn_auto_balance_journal()
--    Fungsi lama memakai kolom general_ledger.transaction_id yang tidak ada.
--    Penyeimbang per transaksi memakai reference_number.
-- ----------------------------------------------------------------------------
create or replace function public.fn_auto_balance_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_debit  numeric;
  v_total_credit numeric;
  v_selisih      numeric;
begin
  select coalesce(sum(coalesce(nullif(debit_amount, 0), debit, 0)), 0),
         coalesce(sum(coalesce(nullif(credit_amount, 0), credit, 0)), 0)
  into v_total_debit, v_total_credit
  from public.general_ledger
  where reference_number = new.reference_number;

  v_selisih := v_total_debit - v_total_credit;

  if v_selisih > 0 then
    insert into public.general_ledger (
      transaction_date, entry_date, reference_number, account_code, account_name,
      account_type, debit, credit, debit_amount, credit_amount
    ) values (
      new.transaction_date, new.transaction_date, new.reference_number,
      '41999', 'Pendapatan Belum Dialokasikan (Pajak/Biaya)', 'revenue',
      0, v_selisih, 0, v_selisih
    );
  elsif v_selisih < 0 then
    insert into public.general_ledger (
      transaction_date, entry_date, reference_number, account_code, account_name,
      account_type, debit, credit, debit_amount, credit_amount
    ) values (
      new.transaction_date, new.transaction_date, new.reference_number,
      '41999', 'Pendapatan Belum Dialokasikan (Pajak/Biaya)', 'revenue',
      abs(v_selisih), 0, abs(v_selisih), 0
    );
  end if;

  return new;
end;
$$;

commit;

-- ============================================================================
-- CATATAN PENTING
--   Trigger TIDAK dipasang kembali secara default, karena backend FastAPI
--   (backend/finance.py::post_finance_source) sudah menulis jurnal penjualan
--   yang seimbang untuk setiap transaksi. Memasang trigger di sini akan
--   membuat pendapatan tercatat dua kali.
--
--   Bila suatu saat Anda ingin pencatatan sepenuhnya di database (tanpa
--   jurnal dari backend), aktifkan dengan:
--
--     -- create trigger trg_record_sales_clean
--     --   after insert on public.transactions
--     --   for each row execute function public.record_sales_to_ledger_clean();
--
--   ...dan hapus pemanggilan post_finance_source(...) untuk source_type
--   'transaction' pada backend.
-- ============================================================================

-- ============================================================================
-- VERIFIKASI (read-only)
-- ============================================================================
-- Trigger yang tersisa pada public.transactions:
--   select tgname from pg_trigger t
--   join pg_class c on c.oid = t.tgrelid
--   where c.relname = 'transactions' and not t.tgisinternal;
--   -- harus menyisakan: transactions_loyalty (dan trigger stok/RPC bila ada)
--
-- Jurnal per transaksi harus seimbang (harus 0 baris):
--   select source_id,
--          sum(coalesce(nullif(debit_amount, 0), debit, 0))
--            - sum(coalesce(nullif(credit_amount, 0), credit, 0)) as selisih
--   from public.general_ledger
--   where source_type = 'transaction'
--   group by source_id
--   having sum(coalesce(nullif(debit_amount, 0), debit, 0))
--          <> sum(coalesce(nullif(credit_amount, 0), credit, 0));
