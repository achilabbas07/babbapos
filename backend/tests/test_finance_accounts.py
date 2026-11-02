import asyncio
import logging
from decimal import Decimal

import pytest

from finance import get_account_balances


def test_get_account_balances_returns_ordered_master_balances():
    class FakePool:
        async def fetch(self, query, *args):
            assert "from public.chart_of_accounts" in query
            assert "order by kode_akun" in query
            assert "current_balance" in query
            assert query.lstrip().lower().startswith("select")
            return [
                {
                    "kode_akun": "1-10001",
                    "nama_akun": "Kas Tunai",
                    "kategori_akun": "Aset",
                    "current_balance": "2269825.25",
                },
                {
                    "kode_akun": "2-10001",
                    "nama_akun": "Hutang Usaha",
                    "kategori_akun": "Liability",
                    "current_balance": Decimal("250000.00"),
                },
            ]

    accounts = asyncio.run(get_account_balances(FakePool()))

    assert accounts == [
        {
            "kode_akun": "1-10001",
            "nama_akun": "Kas Tunai",
            "kategori_akun": "Aset",
            "current_balance": Decimal("2269825.25"),
            "saldo_terupdate": Decimal("2269825.25"),
        },
        {
            "kode_akun": "2-10001",
            "nama_akun": "Hutang Usaha",
            "kategori_akun": "Liability",
            "current_balance": Decimal("250000.00"),
            "saldo_terupdate": Decimal("250000.00"),
        },
    ]


def test_get_account_balances_logs_raw_response_before_conversion(caplog):
    class FakePool:
        async def fetch(self, _query, *_args):
            return [{
                "kode_akun": "1-10001",
                "nama_akun": "Kas Tunai",
                "kategori_akun": "Aset",
                "current_balance": "10.25",
            }]

    with caplog.at_level(logging.DEBUG, logger="finance"):
        asyncio.run(get_account_balances(FakePool()))

    assert "Raw chart_of_accounts balance response" in caplog.text
    assert "'current_balance': '10.25'" in caplog.text


@pytest.mark.parametrize(
    "account",
    [
        {"kode_akun": "", "nama_akun": "Kas", "kategori_akun": "Aset", "current_balance": "10"},
        {"kode_akun": "1-10001", "nama_akun": "Kas", "kategori_akun": "Aset", "current_balance": None},
        {"kode_akun": "1-10001", "nama_akun": "Kas", "kategori_akun": "Aset", "current_balance": "not-a-number"},
        {"kode_akun": "1-10001", "nama_akun": "Kas", "kategori_akun": "Aset", "current_balance": "NaN"},
    ],
)
def test_get_account_balances_rejects_invalid_master_data(account):
    class FakePool:
        async def fetch(self, query, *args):
            return [account]

    with pytest.raises(ValueError):
        asyncio.run(get_account_balances(FakePool()))


def test_get_account_balances_rejects_duplicate_account_codes():
    class FakePool:
        async def fetch(self, query, *args):
            account = {
                "kode_akun": "1-10001",
                "nama_akun": "Kas",
                "kategori_akun": "Aset",
                "current_balance": "10",
            }
            return [account, account]

    with pytest.raises(ValueError, match="duplikat"):
        asyncio.run(get_account_balances(FakePool()))
