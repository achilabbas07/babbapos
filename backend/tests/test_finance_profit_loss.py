import asyncio
from datetime import date
from decimal import Decimal

from finance import get_profit_and_loss_report


def test_profit_loss_aggregates_view_rows_for_requested_date_range():
    class FakePool:
        async def fetch(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            assert "from public.view_profit_and_loss_summary" in normalized_query
            assert "select account_name, account_type, sum(subtotal_balance) as balance" in normalized_query
            assert "where transaction_date >= $1::date and transaction_date < $2::date" in normalized_query
            assert "group by account_name, account_type" in normalized_query
            assert "account_id" not in normalized_query
            assert "entry_id" not in normalized_query
            assert args == (date(2026, 11, 1), date(2026, 12, 1))
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

        async def fetchrow(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            assert 'from public.transactions' in normalized_query
            assert 'coalesce("promodiscount", 0)' in normalized_query
            assert 'coalesce("pointsdiscount", 0)' in normalized_query
            assert "where date >= $1::date and date < $2::date" in normalized_query
            assert args == (date(2026, 11, 1), date(2026, 12, 1))
            return {"sales_discount": Decimal("75.00")}

    report = asyncio.run(
        get_profit_and_loss_report(
            FakePool(),
            start_date=date(2026, 11, 1),
            end_date=date(2026, 12, 1),
        )
    )

    assert report["summary"] == {
        "revenue": Decimal("1075.00"),
        "sales_discount": Decimal("75.00"),
        "hpp": Decimal("230.00"),
        "expenses": Decimal("60.00"),
        "net_profit": Decimal("710.00"),
    }
    assert [row["account_name"] for row in report["rows"]] == [
        "Penjualan",
        "Potongan Penjualan",
        "HPP Barang",
        "Beban HPP - Tissu",
        "Beban Operasional",
        "Uang Makan",
    ]
    assert [row["account_type"] for row in report["rows"]] == [
        "revenue",
        "revenue",
        "cogs",
        "cogs",
        "expense",
        "expense",
    ]
    assert report["rows"][1]["balance"] == Decimal("-75.00")
