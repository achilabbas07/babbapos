"""Validate migrate_ledger_balance_repair.sql syntax inside a rolled-back transaction."""
import asyncio
import os
import re
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

SQL_FILE = Path(__file__).resolve().parents[1] / "supabase" / "migrate_ledger_balance_repair.sql"


def extract_repair_block(text: str) -> str:
    """Ambil isi antara 'begin;' dan 'commit;' pada bagian PERBAIKAN."""
    start = text.index("begin;")
    end = text.index("commit;", start)
    return text[start + len("begin;"):end]


async def main():
    sql = extract_repair_block(SQL_FILE.read_text(encoding="utf-8"))
    conn = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    try:
        before = await conn.fetchrow(
            """
            select count(*) n,
                   sum(coalesce(nullif(debit_amount,0), debit, 0))
                 - sum(coalesce(nullif(credit_amount,0), credit, 0)) diff
            from public.general_ledger
            """
        )
        print(f"BEFORE: rows={before['n']} diff={before['diff']}")

        async with conn.transaction():
            await conn.execute(sql)
            after = await conn.fetchrow(
                """
                select count(*) n,
                       sum(coalesce(nullif(debit_amount,0), debit, 0)) dr,
                       sum(coalesce(nullif(credit_amount,0), credit, 0)) cr,
                       sum(coalesce(nullif(debit_amount,0), debit, 0))
                     - sum(coalesce(nullif(credit_amount,0), credit, 0)) diff
                from public.general_ledger
                """
            )
            print(f"AFTER (in tx): rows={after['n']} dr={after['dr']} cr={after['cr']} diff={after['diff']}")

            groups = await conn.fetchrow(
                """
                with g as (
                    select source_type, source_id,
                           sum(coalesce(nullif(debit_amount,0), debit, 0))
                         - sum(coalesce(nullif(credit_amount,0), credit, 0)) diff
                    from public.general_ledger
                    where source_id is not null
                    group by 1, 2
                )
                select count(*) filter (where diff <> 0) unbalanced,
                       coalesce(sum(diff), 0) residual
                from g
                """
            )
            print(f"AFTER (in tx): unbalanced source groups={groups['unbalanced']} residual={groups['residual']}")

            # idempotency: run again
            await conn.execute(sql)
            again = await conn.fetchrow(
                """
                select count(*) n,
                       sum(coalesce(nullif(debit_amount,0), debit, 0))
                     - sum(coalesce(nullif(credit_amount,0), credit, 0)) diff
                from public.general_ledger
                """
            )
            print(f"AFTER 2nd run (idempotency): rows={again['n']} diff={again['diff']}")

            raise RuntimeError("__ROLLBACK__")
    except RuntimeError as exc:
        if str(exc) != "__ROLLBACK__":
            raise
        print("\nROLLED BACK - no data changed.")
    finally:
        after_rollback = await conn.fetchrow(
            """
            select count(*) n,
                   sum(coalesce(nullif(debit_amount,0), debit, 0))
                 - sum(coalesce(nullif(credit_amount,0), credit, 0)) diff
            from public.general_ledger
            """
        )
        print(f"AFTER ROLLBACK: rows={after_rollback['n']} diff={after_rollback['diff']}")
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
