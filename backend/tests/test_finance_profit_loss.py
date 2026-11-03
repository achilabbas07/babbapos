import asyncio
from decimal import Decimal

from finance import get_profit_and_loss_report


def test_profit_loss_preserves_rows_from_view_and_accepts_standard_types():
    class FakePool:
        async def fetch(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            assert "from public.view_profit_and_loss" in normalized_query
            assert "select account_name, account_type, balance" in normalized_query
            assert "account_id" not in normalized_query
            assert "entry_id" not in normalized_query
            assert "transaction_date" not in normalized_query
            assert args == ()
            return [
                {
                    "account_name": "Penjualan",
                    "account_type": "revenue",
                    "balance": Decimal("1000.00"),
                },
                {
                    "account_name": "HPP Barang",
                    "account_type": "cost_of_goods_sold",
                    "balance": Decimal("200.00"),
                },
                {
                    "account_name": "Beban HPP - Tissu",
                    "account_type": "cost_of_goods_sold",
                    "balance": Decimal("30.00"),
                },
                {
                    "account_name": "Beban Operasional",
                    "account_type": "operating_expense",
                    "balance": Decimal("50.00"),
                },
                {
                    "account_name": "Uang Makan",
                    "account_type": "operating_expense",
                    "balance": Decimal("10.00"),
                },
            ]

    report = asyncio.run(get_profit_and_loss_report(FakePool()))

    assert report["summary"] == {
        "revenue": Decimal("1000.00"),
        "hpp": Decimal("230.00"),
        "expenses": Decimal("60.00"),
        "net_profit": Decimal("710.00"),
    }
    assert [row["account_name"] for row in report["rows"]] == [
        "Penjualan",
        "HPP Barang",
        "Beban HPP - Tissu",
        "Beban Operasional",
        "Uang Makan",
    ]
    assert [row["account_type"] for row in report["rows"]] == [
        "revenue",
        "cogs",
        "cogs",
        "expense",
        "expense",
    ]
