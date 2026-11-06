import asyncio
from datetime import date
from decimal import Decimal

from finance import get_profit_and_loss_report


def test_profit_loss_aggregates_account_and_expense_sources_for_requested_date_range():
    class FakePool:
        async def fetch(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            assert "from public.view_profit_and_loss_summary" in normalized_query
            assert "account_code" in normalized_query
            assert "account_category" in normalized_query
            assert "balance" in normalized_query
            assert "subtotal_balance" not in normalized_query
            assert "group by account_code, account_name, account_category" in normalized_query
            assert "account_id" not in normalized_query
            assert "from public.expenses as expense" in normalized_query
            assert "from public.cash_movements as movement" in normalized_query
            assert "from public.expense_categories as expense_category" in normalized_query
            assert "from public.chart_of_accounts as chart_account" in normalized_query
            assert "sum(expense.amount)::numeric as balance" in normalized_query
            assert "sum(movement.amount)::numeric as balance" in normalized_query
            assert "movement.type = 'out'" in normalized_query
            assert "movement.\"timestamp\" >= $1::date" in normalized_query
            assert "movement.\"timestamp\" < $2::date" in normalized_query
            assert "expense.date >= $1::date" in normalized_query
            assert "expense.date < $2::date" in normalized_query
            assert "to_jsonb(movement)->>'expense_category_id'" in normalized_query
            assert "category.account_code" in normalized_query
            assert "source_type is distinct from 'expense'" in normalized_query
            assert "ledger.entry_date >= $1::date" in normalized_query
            assert "group by ledger.account_code, ledger.account_name, account_category" in normalized_query
            assert args == (date(2026, 11, 1), date(2026, 12, 1))
            return [
                {
                    "account_code": "4-40000",
                    "account_name": "Penjualan",
                    "account_category": "Pendapatan",
                    "account_type": "revenue",
                    "balance": Decimal("1000.00"),
                },
                {
                    "account_code": "5-50000",
                    "account_name": "HPP Barang",
                    "account_category": "Beban Pokok Pendapatan",
                    "account_type": "cost_of_goods_sold",
                    "balance": Decimal("200.00"),
                },
                {
                    "account_code": "5-50100",
                    "account_name": "Beban HPP - Tissu",
                    "account_category": "Beban Pokok Pendapatan",
                    "account_type": "cost_of_goods_sold",
                    "balance": Decimal("30.00"),
                },
                {
                    "account_code": "6-60000",
                    "account_name": "Beban Operasional",
                    "account_category": "Beban Operasional",
                    "account_type": "operating_expense",
                    "balance": Decimal("50.00"),
                },
                {
                    "account_code": "6-60153",
                    "account_name": "Uang Makan",
                    "account_category": "Beban Operasional",
                    "account_type": "operating_expense",
                    "balance": Decimal("10.00"),
                },
                {
                    "account_code": "6-60154",
                    "account_name": "Uang Makan",
                    "account_category": "Beban Operasional",
                    "account_type": "operating_expense",
                    "balance": Decimal("5.00"),
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
        "expenses": Decimal("65.00"),
        "net_profit": Decimal("675.00"),
    }
    assert [row["account_name"] for row in report["rows"]] == [
        "Penjualan",
        "Potongan Penjualan",
        "Beban Operasional",
        "Uang Makan",
        "Uang Makan",
        "Beban Pokok Pendapatan",
    ]
    assert [row["account_code"] for row in report["rows"] if row["account_name"] == "Uang Makan"] == [
        "6-60153",
        "6-60154",
    ]
    assert [row["account_type"] for row in report["rows"]] == [
        "revenue",
        "revenue",
        "expense",
        "expense",
        "expense",
        "cogs",
    ]
    assert report["rows"][-1]["balance"] == Decimal("260.00")
