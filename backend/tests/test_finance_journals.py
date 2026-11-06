import asyncio
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

import server
from core import User


class AsyncContext:
    def __init__(self, value=None):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *_args):
        return False


def _journal_body(account_code):
    return server.JournalIn(
        date=date(2026, 11, 1),
        description="Penjualan tunai",
        lines=[
            server.JournalLineIn(
                accountName="Kas",
                accountCode=account_code,
                accountType="asset",
                debit=Decimal("100"),
            ),
            server.JournalLineIn(
                accountName="Pendapatan",
                accountCode="4-40000",
                accountType="revenue",
                credit=Decimal("100"),
            ),
        ],
    )


def test_create_finance_journal_persists_selected_account_code(monkeypatch):
    accounts = [
        {"account_name": "Kas", "account_code": "1-10001", "account_category": "Aset"},
        {"account_name": "Kas", "account_code": "1-10002", "account_category": "Aset"},
        {"account_name": "Pendapatan", "account_code": "4-40000", "account_category": "Pendapatan"},
    ]

    class FakeConnection:
        rows = []

        def transaction(self):
            return AsyncContext()

        async def executemany(self, _query, rows):
            self.rows = list(rows)

    connection = FakeConnection()

    class FakePool:
        async def fetch(self, _query, names, codes):
            assert "Kas" in names
            assert "1-10002" in codes
            return accounts

        def acquire(self):
            return AsyncContext(connection)

    async def connect():
        return None

    monkeypatch.setattr(server.db, "connect", connect)
    monkeypatch.setattr(server.db, "pool", FakePool())

    asyncio.run(server.create_finance_journal(
        _journal_body("1-10002"),
        User(id="admin", name="Admin", role="admin"),
    ))

    assert connection.rows[0][3:6] == ("Kas", "asset", "1-10002")
    assert connection.rows[1][3:6] == ("Pendapatan", "revenue", "4-40000")


def test_create_finance_journal_rejects_ambiguous_legacy_account_name(monkeypatch):
    accounts = [
        {"account_name": "Kas", "account_code": "1-10001", "account_category": "Aset"},
        {"account_name": "Kas", "account_code": "1-10002", "account_category": "Aset"},
        {"account_name": "Pendapatan", "account_code": "4-40000", "account_category": "Pendapatan"},
    ]

    class FakePool:
        async def fetch(self, _query, _names, _codes):
            return accounts

    async def connect():
        return None

    monkeypatch.setattr(server.db, "connect", connect)
    monkeypatch.setattr(server.db, "pool", FakePool())
    body = _journal_body(None)
    body.lines[0].accountCode = None

    with pytest.raises(HTTPException, match="ambigu"):
        asyncio.run(server.create_finance_journal(
            body,
            User(id="admin", name="Admin", role="admin"),
        ))
