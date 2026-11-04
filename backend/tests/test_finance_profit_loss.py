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
            assert args == (date(2026, 11, 1), date(2026, 12, 1))
            if "as sales_discount" in normalized_query:
                assert "from public.transactions" in normalized_query
                assert 'coalesce("promodiscount", 0)' in normalized_query
                assert 'coalesce("pointsdiscount", 0)' in normalized_query
                assert "where date >= $1::date and date < $2::date" in normalized_query
                return {"sales_discount": Decimal("75.00")}

            assert "jsonb_array_elements" in normalized_query
            assert "from public.variant_ingredients" in normalized_query
            assert "join public.inventory" in normalized_query
            assert "join public.products" in normalized_query
            assert "ingredient.qty_needed * inventory.cost_per_unit" in normalized_query
            assert "trx.date >= $1::date and trx.date < $2::date" in normalized_query
            return {"hpp": Decimal("260.00"), "missing_products": 0}

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
        "hpp": Decimal("260.00"),
        "expenses": Decimal("60.00"),
        "net_profit": Decimal("680.00"),
    }
    assert [row["account_name"] for row in report["rows"]] == [
        "Penjualan",
        "Potongan Penjualan",
        "Beban Operasional",
        "Uang Makan",
        "Beban Pokok Pendapatan",
    ]
    assert [row["account_type"] for row in report["rows"]] == [
        "revenue",
        "revenue",
        "expense",
        "expense",
        "cogs",
    ]
    assert report["rows"][-1]["balance"] == Decimal("260.00")
