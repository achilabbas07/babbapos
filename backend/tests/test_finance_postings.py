import asyncio
from datetime import date
from decimal import Decimal
import re
from uuid import UUID

from finance import (
    account_type_from_category,
    expense_lines,
    get_account_by_payment_method,
    get_dashboard_neraca_kas,
    get_chart_of_accounts,
    get_recent_finance_transactions,
    post_cash_expense_journal,
    post_checkout_journal_entries,
    post_debt_payment_journal,
    post_purchase_journal,
    post_purchase_payment_journal,
    post_finance_source,
    debt_payment_lines,
    purchase_journal_lines,
    purchase_lines,
    transaction_account_codes,
    transaction_lines,
)


def test_chart_account_categories_map_to_journal_types():
    assert account_type_from_category("Aset Lancar") == "asset"
    assert account_type_from_category("Liabilitas Jangka Pendek") == "liability"
    assert account_type_from_category("Modal Pemilik") == "equity"
    assert account_type_from_category("Pendapatan Operasional") == "revenue"
    assert account_type_from_category("Beban Gaji") == "expense"
    assert account_type_from_category("Kategori Tidak Dikenal") is None


def test_get_chart_of_accounts_keeps_unmutated_master_accounts_and_sorts_by_code():
    class FakePool:
        async def fetch(self, query, *args):
            if "from public.chart_of_accounts" in query:
                assert "transaction_date" not in query
                assert args == ()
                return [
                    {"account_code": "4-10001", "normal_balance": "credit", "account_name": "Penjualan", "account_category": "Pendapatan"},
                    {"account_code": "1-10002", "normal_balance": "debit", "account_name": "Bank", "account_category": "Aset Lancar"},
                    {"account_code": "1-10001", "normal_balance": "debit", "account_name": "Kas", "account_category": "Aset Lancar"},
                ]
            assert "from public.general_ledger" in query
            assert "transaction_date >= $1" in query
            assert "transaction_date <= $2" in query
            assert args == (date(2026, 10, 1), date(2026, 10, 31))
            return [
                {"account_code": None, "account_name": "Kas", "account_type": "asset", "total_debit": Decimal("150000"), "total_credit": Decimal("25000"), "mutation_count": 2},
                {"account_code": None, "account_name": "Penjualan", "account_type": "revenue", "total_debit": Decimal("0"), "total_credit": Decimal("300000"), "mutation_count": 1},
            ]

    rows = asyncio.run(get_chart_of_accounts(FakePool(), date(2026, 10, 1), date(2026, 10, 31)))

    assert rows == [
        {
            "account_code": "1-10001",
            "normal_balance": "debit",
            "account_name": "Kas",
            "account_category": "Aset Lancar",
            "account_type": "asset",
            "balance": Decimal("125000"),
            "has_mutations": True,
        },
        {
            "account_code": "1-10002",
            "normal_balance": "debit",
            "account_name": "Bank",
            "account_category": "Aset Lancar",
            "account_type": "asset",
            "balance": 0,
            "has_mutations": False,
        },
        {
            "account_code": "4-10001",
            "normal_balance": "credit",
            "account_name": "Penjualan",
            "account_category": "Pendapatan",
            "account_type": "revenue",
            "balance": Decimal("300000"),
            "has_mutations": True,
        },
    ]


def test_chart_of_accounts_matches_finance_postings_by_code():
    class FakePool:
        async def fetch(self, query, *args):
            if "from public.chart_of_accounts" in query:
                return [{
                    "account_code": "4-40000",
                    "normal_balance": "credit",
                    "account_name": "Pendapatan",
                    "account_category": "Pendapatan",
                }]
            return [
                {
                    "account_code": "4-40000",
                    "account_name": "Penjualan",
                    "account_type": "revenue",
                    "total_debit": Decimal("0"),
                    "total_credit": Decimal("700"),
                    "mutation_count": 1,
                },
                {
                    "account_code": "4-40000",
                    "account_name": "Penjualan Lama",
                    "account_type": "revenue",
                    "total_debit": Decimal("0"),
                    "total_credit": Decimal("300"),
                    "mutation_count": 1,
                },
            ]

    rows = asyncio.run(get_chart_of_accounts(FakePool()))

    assert rows[0]["account_name"] == "Pendapatan"
    assert rows[0]["balance"] == Decimal("1000")
    assert rows[0]["has_mutations"] is True


def test_cash_sale_posts_revenue_and_cost_of_goods():
    lines = transaction_lines(
        1000,
        "Cash",
        [{"hpp": 12.5, "qty": 2}, {"hpp": 3.25, "qty": 4}],
    )

    assert lines == [
        ("Kas Tunai", "asset", Decimal("1000.00"), Decimal("0")),
        ("Pendapatan", "revenue", Decimal("0"), Decimal("1000.00")),
        ("Beban HPP", "expense", Decimal("38.00"), Decimal("0")),
        ("Persediaan bahan baku", "asset", Decimal("0"), Decimal("38.00")),
    ]


def test_cash_sale_uses_required_account_codes():
    assert transaction_account_codes(
        1000,
        "Cash",
        [{"hpp": 12.5, "qty": 2}],
    ) == ["1-10001", "4-40000", None, None]
    assert transaction_account_codes(1000, "QRIS", []) == ["1-10002", "4-40000"]


def test_payment_methods_map_to_the_project_chart_of_accounts_codes():
    assert get_account_by_payment_method("Tunai") == "1-10001"
    assert get_account_by_payment_method("Cash") == "1-10001"
    for method in ("QRIS", "Debit", "Card", "Credit", "Credit Card"):
        assert get_account_by_payment_method(method) == "1-10002"


def test_checkout_journal_entries_insert_balanced_pair_with_required_account_codes():
    class FakeConnection:
        query = None
        rows = None

        async def executemany(self, query, rows):
            self.query = query
            self.rows = list(rows)

    for method, cash_code in (
        ("Cash", "1-10001"),
        ("QRIS", "1-10002"),
        ("Debit", "1-10002"),
        ("Card", "1-10002"),
    ):
        connection = FakeConnection()
        asyncio.run(post_checkout_journal_entries(connection, {
            "transaction_id": "TRX-001",
            "payment_method": method,
            "total": 12500,
        }))

        assert "insert into public.jurnal_entries" in connection.query
        assert connection.rows == [
            ("TRX-001", cash_code, "DEBIT", 12500.0),
            ("TRX-001", "4-40000", "KREDIT", 12500.0),
        ]


def test_checkout_journal_payload_with_missing_required_fields_is_rejected():
    class FakeConnection:
        async def executemany(self, _query, _rows):
            raise AssertionError("Invalid payload must not execute SQL.")

    for payload in (
        {},
        {"transaction_id": "TRX-001", "payment_method": "Cash"},
        {"transaction_id": "TRX-001", "payment_method": "Cash", "total": "invalid"},
    ):
        try:
            asyncio.run(post_checkout_journal_entries(FakeConnection(), payload))
        except ValueError:
            pass
        else:
            raise AssertionError("Payload checkout yang tidak lengkap harus ditolak.")


def test_missing_checkout_payment_method_uses_non_cash_account():
    class FakeConnection:
        async def executemany(self, _query, rows):
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(post_checkout_journal_entries(connection, {
        "transaction_id": 123,
        "total": "150.50",
    }))

    assert connection.rows == [
        ("123", "1-10002", "DEBIT", 150.5),
        ("123", "4-40000", "KREDIT", 150.5),
    ]


def test_checkout_journal_sanitizes_id_aliases_payment_method_and_formatted_amounts():
    class FakeConnection:
        async def executemany(self, query, rows):
            self.query = query
            self.rows = list(rows)

    for payload, expected_id, expected_account, expected_amount in (
        ({"id": 123, "method": " Tunai ", "total": "Rp 1.250,50"}, "123", "1-10001", 1250.5),
        ({"no_invoice": "INV-4", "metode_pembayaran": "QRIS", "total": "1.250"}, "INV-4", "1-10002", 1250.0),
    ):
        connection = FakeConnection()
        asyncio.run(post_checkout_journal_entries(connection, payload))

        assert "$1, $2, $3, $4" in connection.query
        assert connection.rows == [
            (expected_id, expected_account, "DEBIT", expected_amount),
            (expected_id, "4-40000", "KREDIT", expected_amount),
        ]


def test_checkout_journal_rejects_non_positive_or_unparseable_amounts():
    class FakeConnection:
        async def executemany(self, _query, _rows):
            raise AssertionError("Invalid amount must not execute SQL.")

    for total in ("Rp -", "0", "-100", "NaN"):
        try:
            asyncio.run(post_checkout_journal_entries(FakeConnection(), {
                "transaction_id": "TRX-001",
                "payment_method": "Cash",
                "total": total,
            }))
        except ValueError:
            pass
        else:
            raise AssertionError("Nominal tidak valid harus ditolak.")


def test_checkout_journal_insert_errors_propagate():
    class FailingConnection:
        async def executemany(self, _query, _rows):
            raise RuntimeError("journal insert failed")

    try:
        asyncio.run(post_checkout_journal_entries(FailingConnection(), {
            "transaction_id": "TRX-001",
            "payment_method": "Cash",
            "total": 12500,
        }))
    except RuntimeError as error:
        assert str(error) == "journal insert failed"
    else:
        raise AssertionError("Kegagalan insert jurnal harus diteruskan ke transaksi checkout.")


def test_unknown_payment_methods_are_rejected():
    try:
        get_account_by_payment_method("Transfer")
    except ValueError as error:
        assert "tidak didukung" in str(error)
    else:
        raise AssertionError("Metode pembayaran yang tidak dikenal harus ditolak.")


def test_payment_aliases_are_normalized_for_transaction_storage():
    from finance import normalize_payment_method

    assert normalize_payment_method(" Tunai ") == "Cash"
    assert normalize_payment_method("Credit") == "Card"
    assert normalize_payment_method("Credit Card") == "Card"


def test_payment_fee_is_posted_to_mdr_expense_account_and_balances_sale():
    lines = transaction_lines(1000, "QRIS", [], admin_fee=25)
    codes = transaction_account_codes(1000, "QRIS", [], admin_fee=25)

    assert lines == [
        ("Bank", "asset", Decimal("975.00"), Decimal("0")),
        ("Beban MDR", "expense", Decimal("25.00"), Decimal("0")),
        ("Pendapatan", "revenue", Decimal("0"), Decimal("1000.00")),
    ]
    assert codes == ["1-10002", "6-60203", "4-40000"]


def test_qris_and_mdr_lines_keep_master_account_codes_and_names():
    class FakeConnection:
        rows = []

        async def fetch(self, query, account_codes):
            names = {
                "1-10002": "Kas Bank / QRIS",
                "4-40000": "Penjualan",
                "6-60203": "Beban Administrasi Bank",
            }
            return [
                {
                    "account_code": code,
                    "account_name": name,
                    "account_id": UUID(f"00000000-0000-0000-0000-{index:012d}"),
                }
                for index, (code, name) in enumerate(names.items(), start=1)
                if code in account_codes
            ]

        async def executemany(self, query, rows):
            self.rows = list(rows)

    connection = FakeConnection()
    lines = transaction_lines(1000, "QRIS", [], admin_fee=25)
    codes = transaction_account_codes(1000, "QRIS", [], admin_fee=25)
    asyncio.run(post_finance_source(
        connection,
        "transaction",
        "TRX-MDR-TEST",
        date(2026, 11, 2),
        "Penjualan dengan MDR",
        "USR-ADMIN",
        lines,
        codes,
    ))

    assert [row[4] for row in connection.rows] == [
        "Kas Bank / QRIS",
        "Beban Administrasi Bank",
        "Pendapatan",
    ]
    assert [row[6] for row in connection.rows] == ["1-10002", "6-60203", "4-40000"]
    assert sum(row[8] for row in connection.rows) == sum(row[9] for row in connection.rows)


def test_payment_fee_must_not_exceed_sale_total():
    try:
        transaction_lines(100, "Card", [], admin_fee=101)
    except ValueError as error:
        assert "Biaya admin/MDR" in str(error)
    else:
        raise AssertionError("Biaya admin/MDR melebihi total harus ditolak.")


def test_non_cash_sale_uses_bank_and_rounds_cost_to_cents():
    lines = transaction_lines(500, "QRIS", [{"hpp": 10.105, "qty": 1}])

    assert lines == [
        ("Bank", "asset", Decimal("500.00"), Decimal("0")),
        ("Pendapatan", "revenue", Decimal("0"), Decimal("500.00")),
        ("Beban HPP", "expense", Decimal("10.11"), Decimal("0")),
        ("Persediaan bahan baku", "asset", Decimal("0"), Decimal("10.11")),
    ]


def test_purchase_and_expense_post_balanced_lines():
    assert purchase_lines(1200) == [
        ("Persediaan bahan baku", "asset", Decimal("1200"), Decimal("0")),
        ("Kas", "asset", Decimal("0"), Decimal("1200")),
    ]
    assert expense_lines("  Listrik  ", 350) == [
        ("Listrik", "expense", Decimal("350"), Decimal("0")),
        ("Kas", "asset", Decimal("0"), Decimal("350")),
    ]


def test_purchase_journal_uses_inventory_and_cash_or_ap_accounts():
    assert purchase_journal_lines(1200, "cash", "1-10002") == [
        ("Persediaan Barang", "asset", Decimal("1200.00"), Decimal("0")),
        ("Bank", "asset", Decimal("0"), Decimal("1200.00")),
    ]
    assert purchase_journal_lines(1200, "credit") == [
        ("Persediaan Barang", "asset", Decimal("1200.00"), Decimal("0")),
        ("Utang Usaha", "liability", Decimal("0"), Decimal("1200.00")),
    ]


def test_debt_payment_journal_debits_ap_and_credits_selected_funding_account():
    assert debt_payment_lines(450, "1-10001") == [
        ("Utang Usaha", "liability", Decimal("450.00"), Decimal("0")),
        ("Kas", "asset", Decimal("0"), Decimal("450.00")),
    ]


def test_purchase_and_debt_payment_code_journals_use_required_account_codes():
    class FakeConnection:
        rows = []

        async def executemany(self, sql, rows):
            self.sql = sql
            self.rows = list(rows)

    purchase_connection = FakeConnection()
    asyncio.run(post_purchase_journal(
        purchase_connection, 1200, "cash", "1-10002", "Pembelian PO-002"
    ))
    assert purchase_connection.rows == [
        ("1-10003", Decimal("1200.00"), Decimal("0"), "Pembelian PO-002"),
        ("1-10002", Decimal("0"), Decimal("1200.00"), "Pembelian PO-002"),
    ]

    asyncio.run(post_purchase_journal(
        purchase_connection, 1200, "credit", None, "Pembelian PO-001"
    ))
    assert [row[0] for row in purchase_connection.rows] == ["1-10003", "2-20001"]
    assert "insert into public.jurnal_transaksi" in purchase_connection.sql

    payment_connection = FakeConnection()
    asyncio.run(post_debt_payment_journal(
        payment_connection, 450, "1-10002", "Pelunasan PO-001"
    ))
    assert [row[0] for row in payment_connection.rows] == ["2-20001", "1-10002"]


def test_cash_expense_posts_cash_credit_to_jurnal_transaksi():
    class FakeConnection:
        sql = ""
        args = ()

        async def execute(self, sql, *args):
            self.sql = sql
            self.args = args

    connection = FakeConnection()
    asyncio.run(post_cash_expense_journal(connection, 150000, "Tagihan Listrik & Air"))

    assert "insert into public.jurnal_transaksi" in connection.sql
    assert "(kode_akun, debit, kredit, keterangan)" in connection.sql
    assert "values ($1, 0, $2, $3)" in connection.sql
    assert connection.args == (
        "1-10001",
        Decimal("150000.00"),
        "Pembayaran Tunai Kasir: Tagihan Listrik & Air",
    )


def test_purchase_payment_uses_selected_funding_account():
    class FakeConnection:
        sql = ""
        args = ()

        async def execute(self, sql, *args):
            self.sql = sql
            self.args = args

    connection = FakeConnection()
    asyncio.run(post_purchase_payment_journal(
        connection,
        150000,
        "1-10002",
        "Pembelian persediaan PO-001 - Supplier",
    ))

    assert "insert into public.jurnal_transaksi" in connection.sql
    assert connection.args == (
        "1-10002",
        Decimal("150000.00"),
        "Pembelian persediaan PO-001 - Supplier",
    )


def test_post_finance_source_sets_required_transaction_date():
    class FakeConnection:
        sql = ""
        rows = []

        async def fetch(self, sql, account_codes):
            assert "from public.chart_of_accounts" in sql
            assert account_codes == ["1-10001", "4-40000"]
            return [
                {"account_code": "1-10001", "account_id": UUID("00000000-0000-0000-0000-000000000001")},
                {"account_code": "4-40000", "account_id": UUID("00000000-0000-0000-0000-000000000002")},
            ]

        async def executemany(self, sql, rows):
            self.sql = sql
            self.rows = list(rows)

    connection = FakeConnection()
    entry_date = date(2026, 10, 30)
    asyncio.run(post_finance_source(
        connection,
        "transaction",
        "TRX-TEST",
        entry_date,
        "Penjualan test",
        "USR-ADMIN",
        transaction_lines(100, "Cash", []),
        transaction_account_codes(100, "Cash", []),
    ))

    assert "transaction_date, entry_date" in connection.sql
    assert "account_code" in connection.sql
    assert "account_id" in connection.sql
    assert [row[1:3] for row in connection.rows] == [(entry_date, entry_date)] * 2
    assert [row[4] for row in connection.rows] == ["Kas Tunai", "Pendapatan"]
    assert all(isinstance(row[3], str) and row[3].strip() for row in connection.rows)
    assert [row[6] for row in connection.rows] == ["1-10001", "4-40000"]
    assert [row[7] for row in connection.rows] == [
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
    ]
    assert [(row[8], row[9]) for row in connection.rows] == [
        (Decimal("100.00"), Decimal("0")),
        (Decimal("0"), Decimal("100.00")),
    ]
    target_columns = re.search(r"insert into public\.general_ledger\s*\((.*?)\)\s*values", connection.sql, re.DOTALL)
    value_expressions = re.search(r"\bvalues\s*\((.*?)\)", connection.sql, re.DOTALL)
    assert target_columns is not None
    assert value_expressions is not None
    assert len(target_columns.group(1).split(",")) == len(value_expressions.group(1).split(","))
    assert max(map(int, re.findall(r"\$(\d+)", value_expressions.group(1)))) == len(connection.rows[0])


def test_post_finance_source_uses_fallback_for_missing_description():
    class FakeConnection:
        rows = []

        async def executemany(self, sql, rows):
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(post_finance_source(
        connection,
        "transaction",
        "TRX-TEST",
        date(2026, 10, 30),
        None,
        "USR-ADMIN",
        [("Kas Tunai", "asset", Decimal("100"), Decimal("0"))],
    ))

    assert connection.rows[0][3] == "Transaksi Kasir POS - TRX-TEST"


def test_post_finance_source_fills_missing_transaction_account_names():
    class FakeConnection:
        rows = []

        async def executemany(self, sql, rows):
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(post_finance_source(
        connection,
        "transaction",
        "TRX-TEST",
        date(2026, 10, 30),
        "Penjualan TRX-TEST",
        "USR-ADMIN",
        [
            (None, "asset", Decimal("100"), Decimal("0")),
            (None, "revenue", Decimal("0"), Decimal("100")),
        ],
    ))

    assert [row[4] for row in connection.rows] == ["Kas Tunai", "Pendapatan"]


def test_post_finance_source_keeps_posting_when_master_account_uuid_is_missing():
    class FakeConnection:
        async def fetch(self, sql, account_codes):
            return []

        async def executemany(self, sql, rows):
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(post_finance_source(
        connection,
        "transaction",
        "TRX-TEST",
        date(2026, 10, 30),
        "Penjualan test",
        "USR-ADMIN",
        [
            ("Kas Tunai", "asset", Decimal("100"), Decimal("0")),
            ("Pendapatan", "revenue", Decimal("0"), Decimal("100")),
        ],
        ["1-10001", "4-40000"],
    ))

    assert [row[4] for row in connection.rows] == ["Kas Tunai", "Pendapatan"]
    assert [row[6] for row in connection.rows] == ["1-10001", "4-40000"]
    assert [row[7] for row in connection.rows] == [None, None]


def test_dashboard_neraca_kas_reads_summary_view():
    class FakeConnection:
        def __init__(self):
            self.sql = ""

        async def fetchrow(self, sql):
            self.sql = sql
            return {
                "kas_bank_akhir": Decimal("968050.00"),
                "persediaan_bahan_baku": Decimal("1526718.00"),
                "total_aset": Decimal("2494768.00"),
                "total_liabilitas_ekuitas": Decimal("2494768.00"),
            }

    connection = FakeConnection()
    result = asyncio.run(get_dashboard_neraca_kas(connection))

    assert result == {
        "kas_bank_akhir": Decimal("968050.00"),
        "persediaan_bahan_baku": Decimal("1526718.00"),
        "total_aset": Decimal("2494768.00"),
        "total_liabilitas_ekuitas": Decimal("2494768.00"),
    }
    assert "from public.view_dashboard_neraca_kas" in connection.sql


def test_recent_finance_transactions_returns_five_latest_journal_rows():
    class FakeConnection:
        sql = ""

        async def fetch(self, sql, *args):
            self.sql = sql
            self.args = args
            return [
                {"tanggal": "2026-10-31T12:00:00+00:00", "keterangan": f"Jurnal {index}", "kode_akun": "1-10001", "debit": 0, "kredit": 100}
                for index in range(5)
            ]

    connection = FakeConnection()
    result = asyncio.run(get_recent_finance_transactions(connection, date(2026, 10, 1), date(2026, 10, 31)))

    assert len(result) == 5
    assert result[0]["keterangan"] == "Jurnal 0"
    assert "from public.jurnal_transaksi" in connection.sql
    assert "tanggal >= $1::date" in connection.sql
    assert "tanggal < ($2::date + interval '1 day')" in connection.sql
    assert connection.args == (date(2026, 10, 1), date(2026, 10, 31))
    assert "order by tanggal desc, id desc" in connection.sql
    assert "limit 5" in connection.sql
