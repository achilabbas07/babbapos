import asyncio
from decimal import Decimal

import pytest

from finance import get_account_balances


def test_get_account_balances_returns_ordered_master_balances():
    class FakePool:
        async def fetch(self, query, *args):
            assert "from public.chart_of_accounts" in query
            assert "order by kode_akun" in query
            assert "saldo_terupdate" in query
            assert query.lstrip().lower().startswith("select")
            return [
                {
                    "kode_akun": "1-10001",
                    "nama_akun": "Kas Tunai",
                    "kategori_akun": "Aset",
                    "saldo_terupdate": "2269825",
                },
                {
                    "kode_akun": "2-10001",
                    "nama_akun": "Hutang Usaha",
                    "kategori_akun": "Liability",
                    "saldo_terupdate": "250000",
                },
            ]

    accounts = asyncio.run(get_account_balances(FakePool()))

    assert accounts == [
        {
            "kode_akun": "1-10001",
            "nama_akun": "Kas Tunai",
            "kategori_akun": "Aset",
            "saldo_terupdate": Decimal("2269825"),
        },
        {
            "kode_akun": "2-10001",
            "nama_akun": "Hutang Usaha",
            "kategori_akun": "Liability",
            "saldo_terupdate": Decimal("250000"),
        },
    ]


@pytest.mark.parametrize(
    "account",
    [
        {"kode_akun": "", "nama_akun": "Kas", "kategori_akun": "Aset", "saldo_terupdate": "10"},
        {"kode_akun": "1-10001", "nama_akun": "Kas", "kategori_akun": "Aset", "saldo_terupdate": None},
        {"kode_akun": "1-10001", "nama_akun": "Kas", "kategori_akun": "Aset", "saldo_terupdate": "NaN"},
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
                "saldo_terupdate": "10",
            }
            return [account, account]

    with pytest.raises(ValueError, match="duplikat"):
        asyncio.run(get_account_balances(FakePool()))
