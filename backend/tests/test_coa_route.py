import asyncio
from decimal import Decimal

from core import User
from routers import coa


def test_list_accounts_calculates_balances_from_general_ledger(monkeypatch):
    class FakePool:
        async def fetch(self, query):
            assert "from public.general_ledger as ledger" in query
            assert "ledger.account_code = account_master.account_code" in query
            assert "ledger.account_name = account_master.account_name" in query
            assert "'cost_of_goods_sold', 'operating_expense'" in query
            assert "= 'balance_sheet'" in query
            assert "then ledger.debit - ledger.credit" in query
            assert "else ledger.credit - ledger.debit" in query
            assert "to_jsonb(account)->>'current_balance'" not in query
            return [
                {
                    "id": "expense-account",
                    "account_code": "5-51099",
                    "account_name": "Beban Selisih Stok",
                    "account_category": "Beban Operasional",
                    "normal_balance": "debit",
                    "current_balance": Decimal("125.00"),
                },
                {
                    "id": "inventory-account",
                    "account_code": "1-10003",
                    "account_name": "Persediaan Bahan Baku",
                    "account_category": "Aset Lancar",
                    "normal_balance": "debit",
                    "current_balance": Decimal("875.00"),
                },
            ]

    async def connect():
        return None

    monkeypatch.setattr(coa.db, "connect", connect)
    monkeypatch.setattr(coa.db, "pool", FakePool())

    accounts = asyncio.run(coa.list_accounts(User(id="admin", name="Admin", role="admin")))

    assert accounts[0]["current_balance"] == Decimal("125.00")
    assert accounts[0]["account_type"] == "Expense"
    assert accounts[1]["current_balance"] == Decimal("875.00")
    assert accounts[1]["account_type"] == "Asset"


def test_account_input_accepts_account_category_aliases_and_legacy_type():
    assert coa.AccountIn(
        account_code="6-60001",
        account_name="Biaya Operasional",
        account_category="operating_expense",
    ).account_category == "operating_expense"
    assert coa.AccountIn(
        account_code="6-60002",
        account_name="Biaya Operasional",
        accountCategory="Beban Operasional",
    ).account_category == "Beban Operasional"
    assert coa.AccountIn(
        account_code="4-40001",
        account_name="Pendapatan",
        account_type="Revenue",
    ).account_category == "Pendapatan"
    assert coa.account_type_from_category("balance_sheet", "2-20001") == "Liability"
    assert coa.account_type_from_category("balance_sheet", "4-40001") == "Revenue"
    assert coa.account_type_from_category("balance_sheet", "6-60001") == "Expense"
    assert coa.account_type_from_category("Bank Account", "2-10001") == "Asset"
    assert coa.account_type_from_category("cost_of_goods_sold") == "Expense"


def test_create_account_persists_account_category_from_request(monkeypatch):
    class FakePool:
        async def fetchval(self, query, *args):
            return None

        async def fetchrow(self, query, *args):
            assert '"account_category"' in query
            assert "operating_expense" in args
            return {
                "id": "expense-account",
                "account_code": "6-60001",
                "account_name": "Biaya Operasional",
                "account_category": "operating_expense",
                "normal_balance": "debit",
            }

    async def connect():
        return None

    monkeypatch.setattr(coa.db, "connect", connect)
    monkeypatch.setattr(coa.db, "pool", FakePool())
    monkeypatch.setattr(
        coa.db,
        "columns",
        {
            "chart_of_accounts": {
                "id": "uuid",
                "account_code": "text",
                "account_name": "text",
                "account_category": "text",
                "normal_balance": "text",
            }
        },
    )

    account = asyncio.run(
        coa.create_account(
            coa.AccountIn(
                account_code="6-60001",
                account_name="Biaya Operasional",
                account_category="operating_expense",
            ),
            User(id="admin", name="Admin", role="admin"),
        )
    )

    assert account["account_category"] == "operating_expense"
    assert account["account_type"] == "Expense"


def test_update_account_persists_account_category_from_request(monkeypatch):
    class FakePool:
        async def fetchval(self, query, *args):
            return None

        async def fetchrow(self, query, *args):
            assert '"account_category" = $3' in query
            assert args[2] == "cost_of_goods_sold"
            return {
                "id": "expense-account",
                "account_code": "5-51099",
                "account_name": "Beban Selisih Stok",
                "account_category": "cost_of_goods_sold",
                "normal_balance": "debit",
            }

    async def connect():
        return None

    monkeypatch.setattr(coa.db, "connect", connect)
    monkeypatch.setattr(coa.db, "pool", FakePool())
    monkeypatch.setattr(
        coa.db,
        "columns",
        {
            "chart_of_accounts": {
                "id": "uuid",
                "account_code": "text",
                "account_name": "text",
                "account_category": "text",
                "normal_balance": "text",
            }
        },
    )

    account = asyncio.run(
        coa.update_account(
            "00000000-0000-0000-0000-000000000001",
            coa.AccountIn(
                account_code="5-51099",
                account_name="Beban Selisih Stok",
                account_category="cost_of_goods_sold",
            ),
            User(id="admin", name="Admin", role="admin"),
        )
    )

    assert account["account_category"] == "cost_of_goods_sold"
    assert account["account_type"] == "Expense"
