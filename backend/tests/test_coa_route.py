import asyncio
from decimal import Decimal

from core import User
from routers import coa


def test_list_accounts_calculates_balances_from_general_ledger(monkeypatch):
    class FakePool:
        async def fetch(self, query, *args):
            assert "from public.general_ledger as ledger" in query
            assert "ledger.account_code = account_master.account_code" in query
            assert "ledger.account_name = account_master.account_name" in query
            assert "'cost_of_goods_sold', 'operating_expense'" in query
            assert "= 'balance_sheet'" in query
            assert "coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0)" in query
            assert "coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0)" in query
            assert "to_jsonb(account)->>'current_balance'" not in query
            assert "ledger.transaction_date >= $1" in query
            assert "ledger.transaction_date <= $2" in query
            assert args == (None, None)
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

    accounts = asyncio.run(coa.list_accounts(_=User(id="admin", name="Admin", role="admin")))

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


def test_list_accounts_applies_date_range_filter(monkeypatch):
    from datetime import date

    class FakePool:
        async def fetch(self, query, *args):
            assert "ledger.transaction_date >= $1" in query
            assert "ledger.transaction_date <= $2" in query
            assert args == (date(2026, 1, 1), date(2026, 1, 31))
            return []

    async def connect():
        return None

    monkeypatch.setattr(coa.db, "connect", connect)
    monkeypatch.setattr(coa.db, "pool", FakePool())

    accounts = asyncio.run(
        coa.list_accounts(
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31),
            _=User(id="admin", name="Admin", role="admin"),
        )
    )

    assert accounts == []


def test_list_accounts_rejects_reversed_date_range(monkeypatch):
    from datetime import date

    from fastapi import HTTPException

    async def connect():
        return None

    monkeypatch.setattr(coa.db, "connect", connect)

    try:
        asyncio.run(
            coa.list_accounts(
                start_date=date(2026, 2, 1),
                end_date=date(2026, 1, 1),
                _=User(id="admin", name="Admin", role="admin"),
            )
        )
    except HTTPException as error:
        assert error.status_code == 422
    else:  # pragma: no cover
        raise AssertionError("HTTPException 422 seharusnya dilempar")


def test_list_account_transactions_builds_running_balance(monkeypatch):
    from datetime import date

    class FakePool:
        async def fetchrow(self, query, *args):
            assert "from public.chart_of_accounts as account" in query
            assert args == ("5-51001",)
            return {
                "account_code": "5-51001",
                "account_name": "Beban Pokok Bahan Baku",
                "account_category": "cost_of_goods_sold",
                "normal_balance": "debit",
            }

        async def fetch(self, query, *args):
            assert "from public.general_ledger as ledger" in query
            assert "ledger.account_code = $1" in query
            assert "coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0) as debit" in query
            assert "coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0) as credit" in query
            assert args == ("5-51001", "Beban Pokok Bahan Baku", date(2026, 1, 1), date(2026, 1, 31))
            return [
                {
                    "id": 2,
                    "entry_id": "00000000-0000-0000-0000-000000000002",
                    "transaction_date": date(2026, 1, 20),
                    "entry_date": date(2026, 1, 20),
                    "description": "Pemakaian bahan",
                    "account_code": "5-51001",
                    "account_name": "Beban Pokok Bahan Baku",
                    "account_type": "expense",
                    "debit": Decimal("250.00"),
                    "credit": Decimal("0"),
                    "source_type": "transaction",
                    "source_id": "TRX-1",
                },
                {
                    "id": 1,
                    "entry_id": "00000000-0000-0000-0000-000000000001",
                    "transaction_date": date(2026, 1, 10),
                    "entry_date": date(2026, 1, 10),
                    "description": "Pemakaian bahan",
                    "account_code": "5-51001",
                    "account_name": "Beban Pokok Bahan Baku",
                    "account_type": "expense",
                    "debit": Decimal("100.00"),
                    "credit": Decimal("0"),
                    "source_type": "transaction",
                    "source_id": "TRX-2",
                },
            ]

    async def connect():
        return None

    monkeypatch.setattr(coa.db, "connect", connect)
    monkeypatch.setattr(coa.db, "pool", FakePool())

    result = asyncio.run(
        coa.list_account_transactions(
            "5-51001",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31),
            _=User(id="admin", name="Admin", role="admin"),
        )
    )

    assert result["account"]["account_type"] == "Expense"
    assert result["account"]["normal_balance_side"] == "debit"
    assert result["summary"]["total_debit"] == Decimal("350.00")
    assert result["summary"]["total_credit"] == Decimal("0")
    assert result["summary"]["closing_balance"] == Decimal("350.00")
    assert result["summary"]["transaction_count"] == 2
    # Urut terbaru lebih dahulu, saldo berjalan akumulatif dari transaksi terlama.
    assert result["transactions"][0]["balance"] == Decimal("350.00")
    assert result["transactions"][1]["balance"] == Decimal("100.00")


def test_list_account_transactions_returns_404_for_unknown_code(monkeypatch):
    from fastapi import HTTPException

    class FakePool:
        async def fetchrow(self, query, *args):
            return None

    async def connect():
        return None

    monkeypatch.setattr(coa.db, "connect", connect)
    monkeypatch.setattr(coa.db, "pool", FakePool())

    try:
        asyncio.run(
            coa.list_account_transactions(
                "9-99999",
                _=User(id="admin", name="Admin", role="admin"),
            )
        )
    except HTTPException as error:
        assert error.status_code == 404
    else:  # pragma: no cover
        raise AssertionError("HTTPException 404 seharusnya dilempar")


def test_list_account_transactions_reads_amount_columns_when_legacy_is_zero(monkeypatch):
    """Baris ditulis trigger POS: debit/credit = 0, nilainya di debit_amount/credit_amount."""
    from datetime import date

    class FakePool:
        async def fetchrow(self, query, *args):
            return {
                "account_code": "5-51001",
                "account_name": "Air Galon",
                "account_category": "operating_expense",
                "normal_balance": None,
            }

        async def fetch(self, query, *args):
            # Kolom gabungan harus dipakai, bukan ledger.debit / ledger.credit mentah.
            assert "ledger.debit_amount" in query
            assert "ledger.credit_amount" in query
            return [
                {
                    "id": "a7c11a38-a8fe-4fbe-8ad7-205a15d15256",
                    "entry_id": None,
                    "transaction_date": date(2026, 11, 6),
                    "entry_date": date(2026, 11, 6),
                    "description": "Pengeluaran Kas: Air Galon - Air",
                    "reference_number": "EXP-KAS-0073",
                    "account_code": "5-51001",
                    "account_name": "Air Galon",
                    "account_type": "expense",
                    "debit": Decimal("25000.00"),
                    "credit": Decimal("0.00"),
                    "source_type": None,
                    "source_id": None,
                },
                {
                    "id": "27ae8e20-49e1-4332-b1a5-a94c7b62fb95",
                    "entry_id": None,
                    "transaction_date": date(2026, 11, 5),
                    "entry_date": date(2026, 11, 5),
                    "description": "Pengeluaran Kas: Air Galon - Galon",
                    "reference_number": "EXP-KAS-0059",
                    "account_code": "5-51001",
                    "account_name": "Air Galon",
                    "account_type": "expense",
                    "debit": Decimal("20000.00"),
                    "credit": Decimal("0.00"),
                    "source_type": None,
                    "source_id": None,
                },
            ]

    async def connect():
        return None

    monkeypatch.setattr(coa.db, "connect", connect)
    monkeypatch.setattr(coa.db, "pool", FakePool())

    result = asyncio.run(
        coa.list_account_transactions(
            "5-51001",
            _=User(id="admin", name="Admin", role="admin"),
        )
    )

    assert result["summary"]["total_debit"] == Decimal("45000.00")
    assert result["summary"]["total_credit"] == Decimal("0.00")
    assert result["summary"]["closing_balance"] == Decimal("45000.00")
    assert result["summary"]["transaction_count"] == 2
    assert result["transactions"][0]["debit"] == Decimal("25000.00")
    assert result["transactions"][0]["reference_number"] == "EXP-KAS-0073"
