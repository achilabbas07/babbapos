"""Audit double-entry public.general_ledger. Read-only.

Jalankan: python scripts/audit_ledger_balance.py

Catatan penting:
  * entry_id BUKAN unit transaksi untuk penjualan POS. Backend memanggil
    post_finance_source dua kali per penjualan (leg pendapatan/kas dan leg
    HPP/persediaan), sehingga satu penjualan punya DUA entry_id.
  * Unit transaksi yang benar adalah (source_type, source_id).
  * Kolom nominal ganda: debit/credit (legacy) dan debit_amount/credit_amount.
    Selalu baca coalesce(nullif(debit_amount,0), debit, 0).
"""
import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

D = "coalesce(nullif(gl.debit_amount, 0), gl.debit, 0)"
C = "coalesce(nullif(gl.credit_amount, 0), gl.credit, 0)"


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    try:
        print("=== 1. TOTAL GLOBAL (modern pair) ===")
        r = await conn.fetchrow(
            f"select count(*) n, sum({D}) dr, sum({C}) cr, sum({D})-sum({C}) diff from public.general_ledger gl"
        )
        print(dict(r))

        print("\n=== 1b. BALANCE PER (source_type, source_id) - unit transaksi sebenarnya ===")
        r = await conn.fetchrow(
            f"""
            with g as (
                select coalesce(gl.source_type, '(null)') st, gl.source_id sid,
                       sum({D}) - sum({C}) diff
                from public.general_ledger gl
                where gl.source_id is not null
                group by 1, 2
            )
            select count(*) filter (where diff <> 0) unbalanced_groups,
                   coalesce(sum(diff), 0) total_diff
            from g
            """
        )
        print(dict(r))
        rows = await conn.fetch(
            f"""
            with g as (
                select coalesce(gl.source_type, '(null)') st, gl.source_id sid,
                       count(*) n, sum({D}) dr, sum({C}) cr,
                       sum({D}) - sum({C}) diff
                from public.general_ledger gl
                where gl.source_id is not null
                group by 1, 2
            )
            select * from g where diff <> 0 order by abs(diff) desc
            """
        )
        for row in rows:
            print(dict(row))

        print("\n=== 2. UNBALANCED entry_id GROUPS ===")
        rows = await conn.fetch(
            f"""
            select gl.entry_id, count(*) n, sum({D}) dr, sum({C}) cr, sum({D})-sum({C}) diff,
                   min(gl.transaction_date) d, min(gl.description) descr
            from public.general_ledger gl
            group by gl.entry_id
            having sum({D}) <> sum({C})
            order by abs(sum({D})-sum({C})) desc
            """
        )
        print(f"count={len(rows)}")
        for row in rows[:25]:
            print(dict(row))

        print("\n=== 3. UNBALANCED per transaction_date ===")
        rows = await conn.fetch(
            f"""
            select gl.transaction_date, count(*) n, sum({D}) dr, sum({C}) cr, sum({D})-sum({C}) diff
            from public.general_ledger gl
            group by gl.transaction_date
            having sum({D}) <> sum({C})
            order by gl.transaction_date
            """
        )
        print(f"count={len(rows)}")
        for row in rows:
            print(dict(row))

        print("\n=== 4. ROWS WITH NULL/EMPTY account_code ===")
        r = await conn.fetchrow(
            f"""
            select count(*) n, sum({D}) dr, sum({C}) cr
            from public.general_ledger gl
            where coalesce(btrim(gl.account_code), '') = ''
            """
        )
        print(dict(r))
        rows = await conn.fetch(
            f"""
            select gl.account_name, gl.account_type, count(*) n, sum({D}) dr, sum({C}) cr
            from public.general_ledger gl
            where coalesce(btrim(gl.account_code), '') = ''
            group by gl.account_name, gl.account_type order by n desc
            """
        )
        for row in rows:
            print(dict(row))

        print("\n=== 5. source_type breakdown ===")
        rows = await conn.fetch(
            f"""
            select coalesce(gl.source_type,'(null)') st, count(*) n, sum({D}) dr, sum({C}) cr,
                   sum({D})-sum({C}) diff
            from public.general_ledger gl group by 1 order by n desc
            """
        )
        for row in rows:
            print(dict(row))

        print("\n=== 6. stock_opname entries ===")
        rows = await conn.fetch(
            f"""
            select gl.entry_id, gl.transaction_date, sum({D}) dr, sum({C}) cr,
                   sum({D})-sum({C}) diff, count(*) n
            from public.general_ledger gl
            where gl.source_type = 'stock_opname'
            group by gl.entry_id, gl.transaction_date
            order by gl.transaction_date desc
            """
        )
        print(f"count={len(rows)}")
        for row in rows[:20]:
            print(dict(row))

        print("\n=== 7. account_type vs code-prefix mismatch ===")
        rows = await conn.fetch(
            f"""
            select gl.account_code, gl.account_name, gl.account_type, count(*) n,
                   sum({D})-sum({C}) net
            from public.general_ledger gl
            where gl.account_code is not null
              and (
                (gl.account_code like '1-%' and gl.account_type <> 'asset')
                or (gl.account_code like '2-%' and gl.account_type <> 'liability')
                or (gl.account_code like '3-%' and gl.account_type <> 'equity')
                or (gl.account_code like '4-%' and gl.account_type <> 'revenue')
                or (gl.account_code like '5-%' and gl.account_type <> 'expense')
                or (gl.account_code like '6-%' and gl.account_type <> 'expense')
                or (gl.account_code like '8-%' and gl.account_type <> 'expense')
              )
            group by 1,2,3 order by n desc
            """
        )
        print(f"count={len(rows)}")
        for row in rows[:30]:
            print(dict(row))

        print("\n=== 8. POSITION SUMMARY (cumulative, all time) ===")
        rows = await conn.fetch(
            f"""
            with classified as (
                select gl.account_code, gl.account_name,
                       {D} as debit, {C} as credit,
                       case
                         when lower(coalesce(account.account_category,'')) = 'balance_sheet'
                           then case left(gl.account_code,1)
                             when '1' then 'asset' when '2' then 'liability' when '3' then 'equity'
                             when '4' then 'revenue' when '5' then 'expense' when '6' then 'expense'
                             when '8' then 'expense' else gl.account_type end
                         when lower(coalesce(account.account_category,'')) like 'asset%'
                           or lower(coalesce(account.account_category,'')) like 'aset%'
                           or lower(coalesce(account.account_category,'')) like 'aktiva%'
                           or lower(coalesce(account.account_category,'')) like 'kas%'
                           or lower(coalesce(account.account_category,'')) like 'cash%' then 'asset'
                         when lower(coalesce(account.account_category,'')) like 'liabilit%'
                           or lower(coalesce(account.account_category,'')) like 'kewajiban%'
                           or lower(coalesce(account.account_category,'')) like 'utang%'
                           or lower(coalesce(account.account_category,'')) like 'hutang%' then 'liability'
                         when lower(coalesce(account.account_category,'')) like 'equity%'
                           or lower(coalesce(account.account_category,'')) like 'ekuitas%'
                           or lower(coalesce(account.account_category,'')) like 'modal%' then 'equity'
                         when lower(coalesce(account.account_category,'')) like 'revenue%'
                           or lower(coalesce(account.account_category,'')) like 'pendapatan%'
                           or lower(coalesce(account.account_category,'')) like 'income%' then 'revenue'
                         when lower(coalesce(account.account_category,'')) like 'expense%'
                           or lower(coalesce(account.account_category,'')) like 'beban%'
                           or lower(coalesce(account.account_category,'')) like 'biaya%'
                           or lower(coalesce(account.account_category,'')) in ('cost_of_goods_sold','operating_expense') then 'expense'
                         when gl.account_code like '1-%' then 'asset'
                         when gl.account_code like '2-%' then 'liability'
                         when gl.account_code like '3-%' then 'equity'
                         when gl.account_code like '4-%' then 'revenue'
                         when gl.account_code like '5-%' or gl.account_code like '6-%' or gl.account_code like '8-%' then 'expense'
                         else gl.account_type
                       end as account_type
                from public.general_ledger gl
                left join lateral (
                    select coalesce(
                             nullif(btrim(to_jsonb(a)->>'account_category'),''),
                             nullif(btrim(to_jsonb(a)->>'kategori_akun'),''),
                             nullif(btrim(to_jsonb(a)->>'category'),'')
                           ) as account_category
                    from public.chart_of_accounts a
                    where coalesce(
                            nullif(btrim(to_jsonb(a)->>'account_code'),''),
                            nullif(btrim(to_jsonb(a)->>'kode_akun'),''),
                            nullif(btrim(to_jsonb(a)->>'code'),''),
                            nullif(btrim(to_jsonb(a)->>'kode'),'')
                          ) = gl.account_code
                    limit 1
                ) as account on true
            )
            select account_type,
                   sum(case when account_type in ('asset','expense') then debit-credit else credit-debit end) bal,
                   count(*) n
            from classified
            where account_type in ('asset','liability','equity','revenue','expense')
            group by account_type order by account_type
            """
        )
        for row in rows:
            print(dict(row))

        print("\n=== 9. UNCLASSIFIED rows (account_type not in 5 buckets) ===")
        rows = await conn.fetch(
            f"""
            select gl.account_code, gl.account_name, gl.account_type, count(*) n,
                   sum({D}) dr, sum({C}) cr
            from public.general_ledger gl
            where coalesce(gl.account_type,'') not in ('asset','liability','equity','revenue','expense')
            group by 1,2,3 order by n desc
            """
        )
        print(f"count={len(rows)}")
        for row in rows[:20]:
            print(dict(row))
    finally:
        await conn.close()


if __name__ == "__main__":
    for attempt in range(3):
        try:
            asyncio.run(main())
            break
        except (OSError, asyncpg.PostgresError) as exc:
            print(f"retry {attempt}: {exc}", file=sys.stderr)
            if attempt == 2:
                raise
