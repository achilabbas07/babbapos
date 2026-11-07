import asyncio
from datetime import date
from decimal import Decimal

from finance import (
    ACCOUNT_HPP_DETAIL_CATEGORY,
    ACCOUNT_HPP_DETAIL_PREFIX,
    account_type_from_category,
    get_profit_and_loss_report,
    is_hpp_detail_account_code,
)


def test_bahan_penunjang_accounts_are_classified_as_hpp_details():
    assert ACCOUNT_HPP_DETAIL_PREFIX == "8-"
    assert ACCOUNT_HPP_DETAIL_CATEGORY == "Bahan Penunjang"
    assert is_hpp_detail_account_code("8-51001") is True
    assert is_hpp_detail_account_code("5-50000") is False
    assert is_hpp_detail_account_code(None) is False
    assert account_type_from_category("Bahan Penunjang", "8-51001") == "expense"
    assert account_type_from_category(None, "8-51004") == "expense"
    assert account_type_from_category("balance_sheet", "8-51006") == "expense"


def test_profit_loss_keeps_seri_8_rows_as_independent_hpp_rows_below_beban_pokok_pendapatan():
    class FakePool:
        async def fetch(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            # Rincian biaya penunjang dibaca langsung dari general_ledger dengan
            # kedua pasangan kolom nominal dan dikecualikan dari cabang beban.
            assert "coalesce(ledger.account_code, '') like '8-%'" in normalized_query
            assert "coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0)" in normalized_query
            assert "coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0)" in normalized_query
            assert "ledger.source_type is distinct from 'expense'" in normalized_query
            assert "coalesce(account_code, '') not like '8-%'" in normalized_query
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
                    "account_name": "Beban Pokok Pendapatan",
                    "account_category": "Beban Pokok Pendapatan",
                    "account_type": "cost_of_goods_sold",
                    "balance": Decimal("400.00"),
                },
                {
                    "account_code": "8-51001",
                    "account_name": "Air Galon",
                    "account_category": "Bahan Penunjang",
                    "account_type": "cost_of_goods_sold",
                    "balance": Decimal("45.00"),
                },
                {
                    "account_code": "8-51001",
                    "account_name": "Beban HPP - Air Galon",
                    "account_category": "Bahan Penunjang",
                    "account_type": "cost_of_goods_sold",
                    "balance": Decimal("5.00"),
                },
                {
                    "account_code": "8-51005",
                    "account_name": "Bumbu/Sayur",
                    "account_category": "Bahan Penunjang",
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
            ]

        async def fetchrow(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            if "as sales_discount" in normalized_query:
                return {"sales_discount": Decimal("0")}
            return {"hpp": Decimal("200.00"), "missing_products": 0}

    report = asyncio.run(
        get_profit_and_loss_report(
            FakePool(),
            start_date=date(2026, 11, 1),
            end_date=date(2026, 12, 1),
        )
    )

    hpp_rows = [row for row in report["rows"] if row["account_type"] == "cogs"]
    parent = next(row for row in hpp_rows if row.get("is_hpp_parent"))
    details = [row for row in hpp_rows if row.get("is_hpp_detail")]

    # Pos induk memakai HPP hasil transaksi, rincian 8- berdiri sendiri.
    assert parent["account_code"] == "5-50000"
    assert parent["balance"] == Decimal("200.00")
    assert "hpp_detail_total" not in parent
    # Rincian dengan kode akun sama digabung menjadi satu baris per akun; akun
    # berbeda tidak pernah dijumlahkan ke dalam baris akun lain.
    assert [(row["account_code"], row["balance"]) for row in details] == [
        ("8-51001", Decimal("50.00")),
        ("8-51005", Decimal("30.00")),
    ]
    assert next(row for row in details if row["account_code"] == "8-51001")["account_name"] == "Air Galon"
    assert all(row["parent_account_code"] == "5-50000" for row in details)

    # HPP total = penjumlahan murni seluruh baris akun HPP independen
    # (5-50000 hasil transaksi + seluruh akun seri 8-). Akun 5- lain selain
    # 5-50000 tetap diabaikan agar tidak dobel.
    assert report["summary"]["hpp"] == Decimal("280.00")
    assert report["summary"]["hpp"] == sum(row["balance"] for row in hpp_rows)
    assert report["summary"]["expenses"] == Decimal("50.00")
    assert report["summary"]["net_profit"] == Decimal("1000.00") - Decimal("280.00") - Decimal("50.00")

    # Rincian HPP muncul setelah pos induk, bukan sebelum pendapatan.
    names = [row["account_name"] for row in report["rows"]]
    assert names.index("Beban Pokok Pendapatan") < names.index("Air Galon")
    assert names.index("Air Galon") < names.index("Bumbu/Sayur")


def test_profit_loss_does_not_double_add_variant_hpp_on_top_of_product_hpp():
    """HPP per baris penjualan tidak boleh menjumlahkan HPP produk + HPP varian."""

    class FakePool:
        async def fetch(self, query, *args):
            return []

        async def fetchrow(self, query, *args):
            normalized_query = " ".join(query.lower().split())
            if "as sales_discount" in normalized_query:
                return {"sales_discount": Decimal("0")}
            # Formula baru: snapshot HPP dipakai lebih dulu, lalu varian ATAU
            # produk — tidak pernah keduanya dijumlahkan.
            assert "nullif(sold.snapshot_hpp, 0)" in normalized_query
            assert "coalesce(variant.variant_hpp, product.hpp, 0)" in normalized_query
            assert "coalesce(product.hpp, 0) + case" not in normalized_query
            return {"hpp": Decimal("150.00"), "missing_products": 0}

    report = asyncio.run(
        get_profit_and_loss_report(
            FakePool(),
            start_date=date(2026, 11, 1),
            end_date=date(2026, 12, 1),
        )
    )

    hpp_rows = [row for row in report["rows"] if row["account_type"] == "cogs"]
    assert [row["account_code"] for row in hpp_rows] == ["5-50000"]
    assert report["summary"]["hpp"] == Decimal("150.00")
