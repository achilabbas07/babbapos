"""Prove the neraca balances after the repair, using the real backend function.

Runs the repair SQL inside a transaction, calls get_financial_position_summary,
then rolls back so no data is changed.
"""
import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from finance import get_financial_position_summary  # noqa: E402

SQL_FILE = ROOT / "supabase" / "migrate_ledger_balance_repair.sql"


def extract_repair_block(text: str) -> str:
    start = text.index("begin;")
    end = text.index("commit;", start)
    return text[start + len("begin;"):end]


def show(label: str, pos: dict) -> None:
    print(f"\n--- {label} ---")
    for key in (
        "total_assets", "cash_bank", "inventory", "total_liabilities",
        "equity_accounts", "total_revenue", "total_expense", "net_profit",
        "total_equity", "total_liabilities_equity", "difference",
    ):
        if key in pos:
            print(f"  {key:26} = {pos[key]:>18,.2f}")


async def main():
    sql = extract_repair_block(SQL_FILE.read_text(encoding="utf-8"))
    conn = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    try:
        show("SEBELUM PERBAIKAN", await get_financial_position_summary(conn))

        async with conn.transaction():
            await conn.execute(sql)
            show("SESUDAH PERBAIKAN (dalam transaksi)", await get_financial_position_summary(conn))
            raise RuntimeError("__ROLLBACK__")
    except RuntimeError as exc:
        if str(exc) != "__ROLLBACK__":
            raise
        print("\nROLLED BACK - data tidak berubah.")
    finally:
        show("SETELAH ROLLBACK (kembali seperti semula)", await get_financial_position_summary(conn))
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
