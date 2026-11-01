alter table public.general_ledger
  add column if not exists account_code text;

update public.general_ledger as ledger
set account_code = coalesce(
  nullif(to_jsonb(account)->>'account_code', ''),
  nullif(to_jsonb(account)->>'kode_akun', ''),
  nullif(to_jsonb(account)->>'code', ''),
  nullif(to_jsonb(account)->>'kode', '')
)
from public.chart_of_accounts as account
where ledger.account_code is null
  and ledger.account_name = account.account_name;
