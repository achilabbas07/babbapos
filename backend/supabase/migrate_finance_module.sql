create table if not exists public.general_ledger (
  id            bigserial primary key,
  entry_id      uuid not null,
  entry_date    date not null,
  description   text not null check (length(btrim(description)) > 0),
  account_name  text not null check (length(btrim(account_name)) > 0),
  account_type  text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  account_code  text,
  account_id    uuid,
  debit         numeric(16, 2) not null default 0 check (debit >= 0),
  credit        numeric(16, 2) not null default 0 check (credit >= 0),
  created_by    text references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint general_ledger_one_side_per_line check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  )
);

alter table public.general_ledger
  add column if not exists entry_date date not null default current_date,
  add column if not exists description text not null default 'Jurnal lama',
  add column if not exists account_name text not null default 'Akun belum diklasifikasikan',
  add column if not exists account_type text not null default 'asset',
  add column if not exists account_code text,
  add column if not exists account_id uuid,
  add column if not exists debit numeric(16, 2) not null default 0,
  add column if not exists credit numeric(16, 2) not null default 0,
  add column if not exists created_by text,
  add column if not exists created_at timestamptz not null default now();

alter table public.general_ledger
  alter column account_name drop default;

alter table public.general_ledger
  add column if not exists entry_id uuid;
alter table public.general_ledger
  alter column entry_id set default gen_random_uuid();

create index if not exists general_ledger_entry_idx
  on public.general_ledger (entry_id);
create index if not exists general_ledger_date_type_idx
  on public.general_ledger (entry_date desc, account_type);

alter table public.general_ledger enable row level security;
revoke all on table public.general_ledger from public, anon, authenticated;

drop view if exists public.view_profit_and_loss_summary cascade;
drop view if exists public.view_profit_and_loss cascade;
drop view if exists public.view_balance_sheet;
drop view if exists public.view_arus_kas_bulanan;

create or replace view public.view_arus_kas_bulanan as
select
  id,
  entry_id,
  entry_date,
  date_trunc('month', entry_date)::date as month,
  description,
  account_name,
  debit as money_in,
  credit as money_out
from public.general_ledger
where account_type = 'asset'
  and (
    lower(account_name) like '%kas%'
    or lower(account_name) like '%bank%'
    or lower(account_name) like '%cash%'
  );

create or replace view public.view_balance_sheet as
select
  account_name,
  account_type,
  sum(
    case
      when account_type = 'asset' then debit - credit
      else credit - debit
    end
  ) as balance
from public.general_ledger
where account_type in ('asset', 'liability', 'equity')
group by account_name, account_type
having sum(
  case
    when account_type = 'asset' then debit - credit
    else credit - debit
  end
) <> 0;

create or replace view public.view_profit_and_loss as
select
  coalesce(gl.account_id::text, '0') as account_id,
  case
    when lower(gl.account_name) like '%pendapatan%'
      or lower(gl.account_name) like '%omset%' then 'Pendapatan'
    when lower(gl.account_name) like '%beban pokok%'
      or lower(gl.account_name) like '%hpp%'
      or lower(gl.account_name) like '%tissu%'
      or lower(gl.account_name) like '%bumbu%'
      or lower(gl.account_name) like '%persediaan bahan%'
      or lower(gl.account_name) like '%persediaan barang%' then 'Beban Pokok Pendapatan'
    else coalesce(gl.account_name, 'Beban Operasional Lainnya')
  end as account_name,
  case
    when lower(gl.account_name) like '%pendapatan%'
      or lower(gl.account_name) like '%omset%' then 'revenue'
    when lower(gl.account_name) like '%beban pokok%'
      or lower(gl.account_name) like '%hpp%'
      or lower(gl.account_name) like '%tissu%'
      or lower(gl.account_name) like '%bumbu%'
      or lower(gl.account_name) like '%persediaan bahan%'
      or lower(gl.account_name) like '%persediaan barang%' then 'cost_of_goods_sold'
    when lower(gl.account_name) like '%kas%'
      or lower(gl.account_name) like '%bank%'
      or lower(gl.account_name) like '%qris%'
      or lower(gl.account_name) like '%utang%' then 'balance_sheet'
    else 'operating_expense'
  end as account_type,
  coalesce(gl.debit, 0) as total_debit,
  coalesce(gl.credit, 0) as total_credit,
  case
    when lower(gl.account_name) like '%pendapatan%'
      or lower(gl.account_name) like '%omset%'
      then coalesce(gl.credit, 0) - coalesce(gl.debit, 0)
    else coalesce(gl.debit, 0) - coalesce(gl.credit, 0)
  end as balance,
  gl.entry_date as transaction_date,
  to_char(gl.entry_date, 'YYYY-MM') as period_month,
  gl.created_at
from public.general_ledger as gl;

create or replace view public.view_profit_and_loss_summary as
select
  account_type,
  account_name,
  transaction_date,
  period_month,
  sum(balance) as subtotal_balance
from public.view_profit_and_loss
where account_type <> 'balance_sheet'
group by account_type, account_name, transaction_date, period_month;

revoke all on table
  public.view_arus_kas_bulanan,
  public.view_balance_sheet,
  public.view_profit_and_loss,
  public.view_profit_and_loss_summary
from public, anon, authenticated;
