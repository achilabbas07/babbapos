"""Laporan Laba Rugi tidak boleh menampilkan akun aset transit/penampungan.

Akun ``1-10004`` (Rek. Belanja) adalah akun aset penampungan sementara. Sebelum
perbaikan, akun ini bisa terbaca sebagai ``operating_expense`` di tabel Beban
Operasional. Uji ini memastikan filter eksplisit prefix ``1-`` menjaganya tetap
keluar dari laporan.
"""

import asyncio
from datetime import date
from decimal import Decimal

from finance import get_profit_and_loss_report


def test_profit_loss_sql_excludes_asset_transit_accounts_from_operating_expense():
    class FakePool:
        async def fetch(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            # Cabang ringkasan (view_profit_and_loss): aset transit dibuang.
            assert (
                "and coalesce(account_code, '') not like '1-%' "
                "and lower(coalesce(account_category, '')) not like 'bahan penunjang%'"
            ) in normalized_query
            # Cabang buku besar (6-% / 5-51099): aset transit dibuang.
            assert "coalesce(ledger.account_code, '') not like '1-%'" in normalized_query
            # Cabang expenses: akun aset transit dibuang.
            assert (
                "coalesce(nullif(btrim(account.account_code), ''), "
                "nullif(btrim(category.account_code), ''), '') not like '1-%'"
            ) in normalized_query
            # Jaring pengaman terakhir sebelum agregasi hasil akhir.
            assert "where coalesce(account_code, '') not like '1-%'" in normalized_query
            return []

        async def fetchrow(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            if "as sales_discount" in normalized_query:
                return {"sales_discount": Decimal("0")}
            return {"hpp": Decimal("0"), "missing_products": 0}

    report = asyncio.run(
        get_profit_and_loss_report(
            FakePool(),
            start_date=date(2026, 11, 1),
            end_date=date(2026, 12, 1),
        )
    )

    assert report["summary"]["expenses"] == Decimal("0")
    assert report["summary"]["net_profit"] == Decimal("0")


def test_profit_loss_never_reports_1_10004_rek_belanja_as_operating_expense():
    class FakePool:
        async def fetch(self, query, *args):
            return [
                {
                    "account_code": "4-40000",
                    "account_name": "Penjualan",
                    "account_category": "Pendapatan",
                    "account_type": "revenue",
                    "balance": Decimal("500.00"),
                },
                {
                    # Akun transit/penampungan aset yang sempat bocor ke Beban
                    # Operasional: harus dibuang dari seluruh baris laporan.
                    "account_code": "1-10004",
                    "account_name": "Rek. Belanja",
                    "account_category": "Beban Operasional",
                    "account_type": "operating_expense",
                    "balance": Decimal("90.00"),
                },
                {
                    "account_code": "6-60000",
                    "account_name": "Beban Listrik",
                    "account_category": "Beban Operasional",
                    "account_type": "operating_expense",
                    "balance": Decimal("40.00"),
                },
            ]

        async def fetchrow(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            if "as sales_discount" in normalized_query:
                return {"sales_discount": Decimal("0")}
            return {"hpp": Decimal("0"), "missing_products": 0}

    report = asyncio.run(
        get_profit_and_loss_report(
            FakePool(),
            start_date=date(2026, 11, 1),
            end_date=date(2026, 12, 1),
        )
    )

    assert "1-10004" not in [row["account_code"] for row in report["rows"]]
    assert "Rek. Belanja" not in [row["account_name"] for row in report["rows"]]
    # Hanya beban operasional asli (6-60000) yang dihitung.
    assert report["summary"]["expenses"] == Decimal("40.00")
    assert report["summary"]["net_profit"] == Decimal("460.00")
