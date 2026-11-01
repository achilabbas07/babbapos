create or replace function public.set_general_ledger_account_name()
returns trigger
language plpgsql
as $$
begin
  if nullif(btrim(new.account_name), '') is not null then
    return new;
  end if;

  case new.account_code
    when '1-10001' then
      new.account_name := 'Kas Tunai';
    when '4-40000' then
      new.account_name := 'Pendapatan';
    else
      if new.source_type = 'transaction'
        and new.account_type = 'asset'
        and new.debit > 0
        and new.credit = 0 then
        new.account_name := 'Kas Tunai';
      elsif new.source_type = 'transaction'
        and new.account_type = 'revenue'
        and new.credit > 0
        and new.debit = 0 then
        new.account_name := 'Pendapatan';
      elsif new.account_id is not null then
        select account.account_name
        into new.account_name
        from public.chart_of_accounts as account
        where nullif(to_jsonb(account)->>'id', '')::uuid = new.account_id
        limit 1;
      end if;
  end case;

  if nullif(btrim(new.account_name), '') is null then
    raise exception 'Nama akun wajib diisi untuk general_ledger (account_code=%).', new.account_code;
  end if;

  return new;
end;
$$;

drop trigger if exists general_ledger_account_name_fallback
  on public.general_ledger;

create trigger general_ledger_account_name_fallback
before insert or update of account_name, account_code, account_type, debit, credit
on public.general_ledger
for each row
execute function public.set_general_ledger_account_name();
