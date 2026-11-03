import asyncio
from datetime import date
from decimal import Decimal

from finance import get_profit_and_loss_report


def test_profit_loss_uses_account_code_prefixes_and_separates_hpp():
    class FakePool:
        async def fetch(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            assert "where left(btrim(account_code), 1) in ('4', '5', '6')" in normalized_query
            assert "account_type in" not in normalized_query
            assert "when '5' then 'cogs'" in normalized_query
            assert "when account_type = 'revenue' then credit - debit else debit - credit" in normalized_query
            assert args == (date(2026, 11, 1), date(2026, 12, 1))
            return [
                {
                    "account_code": "4-40001",
                    "account_name": "Penjualan",
                    "account_type": "revenue",
                    "balance": Decimal("1000.00"),
                },
                {
                    "account_code": "5-50001",
                    "account_name": "Beban HPP - Tissu",
                    "account_type": "cogs",
                    "balance": Decimal("200.00"),
                },
                {
                    "account_code": "6-60001",
                    "account_name": "Uang Makan",
                    "account_type": "expense",
                    "balance": Decimal("50.00"),
                },
            ]

    report = asyncio.run(
        get_profit_and_loss_report(
            FakePool(),
            start_date=date(2026, 11, 1),
            end_date=date(2026, 12, 1),
        )
    )

    assert report["summary"] == {
        "revenue": Decimal("1000.00"),
        "hpp": Decimal("200.00"),
        "expenses": Decimal("50.00"),
        "net_profit": Decimal("750.00"),
    }
    assert [row["account_type"] for row in report["rows"]] == ["revenue", "cogs", "expense"]
