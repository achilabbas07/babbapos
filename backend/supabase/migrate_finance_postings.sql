alter table public.general_ledger
  add column if not exists transaction_date date,
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists account_code text;

update public.general_ledger
set transaction_date = entry_date
where transaction_date is null;

alter table public.general_ledger
  alter column transaction_date set default current_date,
  alter column transaction_date set not null;

create unique index if not exists general_ledger_source_line_uidx
  on public.general_ledger (source_type, source_id, account_name, account_type)
  where source_id is not null;

with transaction_entries as materialized (
  select
    gen_random_uuid() as entry_id,
    t.id as source_id,
    t.date::date as entry_date,
    'Penjualan ' || t.id as description,
    t.total as total,
    t.method,
    t."userId" as created_by,
    round(coalesce(cost.amount, 0), 2) as cost_of_goods
  from public.transactions t
  cross join lateral (
    select sum(
      coalesce(nullif(item ->> 'hpp', '')::numeric, 0)
      * coalesce(nullif(item ->> 'qty', '')::numeric, 0)
    ) as amount
    from jsonb_array_elements(coalesce(t.items_json, '[]'::jsonb)) as item
  ) cost
  where t.total > 0 or coalesce(cost.amount, 0) > 0
)
insert into public.general_ledger
  (entry_id, transaction_date, entry_date, description, account_name, account_type, debit, credit,
   created_by, source_type, source_id)
select
  entry_id,
  entry_date,
  entry_date,
  description,
  line.account_name,
  line.account_type,
  line.debit,
  line.credit,
  created_by,
  'transaction',
  source_id
from transaction_entries
cross join lateral (
  values
    (case when method = 'Cash' then 'Kas' else 'Bank' end, 'asset', total::numeric, 0::numeric),
    ('Penjualan', 'revenue', 0::numeric, total::numeric),
    ('Beban HPP', 'expense', cost_of_goods, 0::numeric),
    ('Persediaan bahan baku', 'asset', 0::numeric, cost_of_goods)
) as line(account_name, account_type, debit, credit)
where line.debit > 0 or line.credit > 0
on conflict do nothing;

with purchase_entries as materialized (
  select
    gen_random_uuid() as entry_id,
    p.id as source_id,
    p.date::date as entry_date,
    'Pembelian persediaan ' || p.id as description,
    p.total_cost as amount,
    p."userId" as created_by
  from public.purchases p
  where p.total_cost > 0
)
insert into public.general_ledger
  (entry_id, transaction_date, entry_date, description, account_name, account_type, debit, credit,
   created_by, source_type, source_id)
select
  entry_id,
  entry_date,
  entry_date,
  description,
  line.account_name,
  line.account_type,
  line.debit,
  line.credit,
  created_by,
  'purchase',
  source_id
from purchase_entries
cross join lateral (
  values
    ('Persediaan bahan baku', 'asset', amount::numeric, 0::numeric),
    ('Kas', 'asset', 0::numeric, amount::numeric)
) as line(account_name, account_type, debit, credit)
on conflict do nothing;

with expense_entries as materialized (
  select
    gen_random_uuid() as entry_id,
    e.id as source_id,
    e.date::date as entry_date,
    coalesce(nullif(btrim(e.description), ''), 'Pengeluaran ' || e.category) as description,
    e.category as account_name,
    e.amount as amount,
    e."userId" as created_by
  from public.expenses e
  where e.amount > 0
)
insert into public.general_ledger
  (entry_id, transaction_date, entry_date, description, account_name, account_type, debit, credit,
   created_by, source_type, source_id)
select
  entry_id,
  entry_date,
  entry_date,
  description,
  line.account_name,
  line.account_type,
  line.debit,
  line.credit,
  created_by,
  'expense',
  source_id
from expense_entries
cross join lateral (
  values
    (account_name, 'expense', amount::numeric, 0::numeric),
    ('Kas', 'asset', 0::numeric, amount::numeric)
) as line(account_name, account_type, debit, credit)
on conflict do nothing;

create or replace view public.view_balance_sheet as
with account_balances as (
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
  ) <> 0
)
select account_name, account_type, balance
from account_balances
union all
select 'Laba tahun berjalan', 'equity', net_profit
from public.view_profit_and_loss_summary
where net_profit <> 0;
