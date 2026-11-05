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
