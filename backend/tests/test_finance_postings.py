import asyncio
from datetime import date
from decimal import Decimal
import re
from uuid import UUID

from finance import (
    account_type_from_category,
    expense_account_codes,
    expense_lines,
    get_account_by_payment_method,
    get_dashboard_neraca_kas,
    get_chart_of_accounts,
    get_financial_position_summary,
    get_cash_bank_accounts,
    get_cash_bank_balances,
    get_funding_account_balance,
    get_recent_finance_transactions,
    is_cash_bank_account,
    post_cash_expense_journal,
    post_cash_movement_journal,
    post_checkout_journal_entries,
    post_debt_payment_journal,
    post_purchase_journal,
    post_purchase_payment_journal,
    post_finance_source,
    post_hpp_checkout,
    post_stok_pembelian,
    debt_payment_lines,
    purchase_journal_lines,
    purchase_lines,
    resolve_expense_account_code,
    transaction_account_codes,
    transaction_lines,
)


def test_chart_account_categories_map_to_journal_types():
    assert account_type_from_category("Aset Lancar") == "asset"
    assert account_type_from_category("Liabilitas Jangka Pendek") == "liability"
    assert account_type_from_category("Modal Pemilik") == "equity"
    assert account_type_from_category("Pendapatan Operasional") == "revenue"
    assert account_type_from_category("Beban Gaji") == "expense"
    assert account_type_from_category("cost_of_goods_sold") == "expense"
    assert account_type_from_category("operating_expense") == "expense"
    assert account_type_from_category("balance_sheet", "2-20001") == "liability"
    assert account_type_from_category("balance_sheet", "4-40001") == "revenue"
    assert account_type_from_category("Kas & Bank - Aset Lancar", "2-10001") == "asset"
    assert account_type_from_category("Unmapped", "6-60001") == "expense"
    assert account_type_from_category("Kategori Tidak Dikenal") is None


def test_cash_bank_classification_uses_category_or_specific_liquid_account_name():
    assert is_cash_bank_account("Kas & Bank - Aset Lancar", "8-10001", "Kas Usaha")
    assert is_cash_bank_account("Aset Lancar", "1-10001", "Kas Tunai")
    assert is_cash_bank_account("Aset Lancar", "1-10002", "Rekening Bank")
    assert not is_cash_bank_account("Aset Lancar", "1-10003", "Persediaan Bahan Baku")


def test_get_cash_bank_accounts_returns_only_classified_funding_accounts():
    class FakeConnection:
        async def fetch(self, query, account_code):
            assert "from public.chart_of_accounts" in query
            assert account_code is None
            return [
                {"account_code": "1-10001", "account_name": "Kas Tunai", "account_category": "Aset Lancar"},
                {"account_code": "1-10003", "account_name": "Persediaan Bahan Baku", "account_category": "Aset Lancar"},
                {"account_code": "2-10001", "account_name": "Bank", "account_category": "Kas & Bank"},
            ]

    accounts = asyncio.run(get_cash_bank_accounts(FakeConnection()))

    assert [account["account_code"] for account in accounts] == ["1-10001", "2-10001"]


def test_get_cash_bank_balances_groups_by_account_code_and_category():
    class FakeConnection:
        async def fetch(self, query):
            assert "from public.general_ledger as ledger" in query
            assert "from public.chart_of_accounts as account_row" in query
            assert "group by coalesce(account.account_code, ledger.account_code)" in query
            assert "lower(coalesce(account.account_category, '')) like '%bank%'" in query
            assert "coalesce(account.account_code, ledger.account_code) like '1-%'" in query
            return [{
                "account_code": "1-10001",
                "sumber_dana": "Kas Tunai",
                "saldo_berjalan": Decimal("800.00"),
            }]

    balances = asyncio.run(get_cash_bank_balances(FakeConnection()))

    assert balances == [{
        "account_code": "1-10001",
        "sumber_dana": "Kas Tunai",
        "saldo_berjalan": Decimal("800.00"),
    }]


def test_get_funding_account_balance_reads_general_ledger_with_dual_amount_columns():
    class FakeConnection:
        def __init__(self):
            self.queries = []

        async def fetchval(self, query, account_code):
            self.queries.append((query, account_code))
            return Decimal("4436250.00")

    connection = FakeConnection()
    balance = asyncio.run(get_funding_account_balance(connection, "1-10001"))

    assert balance == Decimal("4436250.00")
    query, account_code = connection.queries[0]
    assert account_code == "1-10001"
    assert "from public.general_ledger as ledger" in query
    assert "coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0)" in query
    assert "coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0)" in query
    assert "jurnal_transaksi" not in query


def test_get_funding_account_balance_returns_zero_for_blank_account_code():
    class ExplodingConnection:
        async def fetchval(self, query, account_code):
            raise AssertionError("query tidak boleh dijalankan untuk kode akun kosong")

    assert asyncio.run(get_funding_account_balance(ExplodingConnection(), "")) == Decimal("0.00")


def test_get_funding_account_balance_allows_negative_ledger_balance():
    class FakeConnection:
        async def fetchval(self, query, account_code):
            return Decimal("-1697801.00")

    balance = asyncio.run(get_funding_account_balance(FakeConnection(), "1-10001"))

    assert balance == Decimal("-1697801.00")


def test_pay_supplier_does_not_block_on_legacy_jurnal_transaksi_balance():
    """Regresi: pembayaran utang supplier tidak boleh ditolak karena saldo
    `jurnal_transaksi` negatif. Ledger resmi adalah `general_ledger`."""
    import inspect

    import server

    source = inspect.getsource(server.pay_supplier)
    assert "Saldo sumber dana tidak mencukupi" not in source
    assert "lock table public.jurnal_transaksi" not in source
    assert "from public.jurnal_transaksi" not in source
    assert "get_funding_account_balance" in source
    # Validasi kewajaran akun kas/bank tetap dipertahankan.
    assert "require_cash_bank_funding_account" in source


def test_pay_purchase_debt_reports_balance_without_blocking():
    import inspect

    import server

    source = inspect.getsource(server.pay_purchase_debt)
    assert "Saldo sumber dana tidak mencukupi" not in source
    assert "from public.jurnal_transaksi" not in source
    assert "get_funding_account_balance" in source


def _mirror_source():
    """Baca `api/index.py` (mirror Vercel) sebagai teks sumber."""
    from pathlib import Path

    mirror = Path(__file__).resolve().parents[2] / "api" / "index.py"
    assert mirror.is_file(), f"Mirror Vercel tidak ditemukan: {mirror}"
    return mirror.read_text(encoding="utf-8")


def test_vercel_mirror_exposes_debt_payment_endpoints():
    """Regresi: `api/index.py` harus memuat endpoint pelunasan utang supplier
    yang sama dengan `backend/server.py`, bukan hanya versi parsial."""
    source = _mirror_source()
    assert '@api.post("/v1/finance/debts/pay")' in source
    assert '@api.post("/v1/finance/pay-supplier")' in source
    assert "async def pay_purchase_debt(" in source
    assert "async def pay_supplier(" in source


def test_vercel_mirror_has_no_hardcoded_balance_gate():
    """Regresi: mirror tidak boleh mengunci transaksi karena saldo.

    Saldo hanya dilaporkan sebagai informasi; kas fisik bisa tersedia walau
    saldo ledger belum tercatat.
    """
    source = _mirror_source()
    assert "Saldo sumber dana tidak mencukupi" not in source
    assert "lock table public.jurnal_transaksi" not in source
    assert "from public.jurnal_transaksi" not in source
    # Saldo tetap dilaporkan pada response.
    assert "saldo_sumber_dana" in source
    assert "saldo_setelah_pembayaran" in source
    assert "saldo_minus" in source
    # Ledger resmi yang dipakai untuk membaca saldo.
    assert "get_funding_account_balance" in source


def test_vercel_mirror_purchase_model_supports_payment_method_and_funding_account():
    """Regresi: `PurchaseIn` di mirror harus mendukung `metode_pembayaran`
    dan `sumber_dana_akun` bebas (Kas & Bank), bukan literal dua akun."""
    source = _mirror_source()
    assert 'metode_pembayaran: Literal["cash", "credit"] = "cash"' in source
    assert "sumber_dana_akun: Optional[str]" in source
    assert 'Literal["1-10001", "1-10002"]' not in source
    assert "require_funding_account_for_cash" in source


def test_vercel_mirror_endpoints_match_server_implementation():
    """Regresi: badan fungsi di mirror harus identik dengan `server.py` agar
    perilaku Vercel dan server tidak pernah menyimpang."""
    import ast
    import inspect
    from pathlib import Path

    import server

    mirror_path = Path(__file__).resolve().parents[2] / "api" / "index.py"
    mirror_text = mirror_path.read_text(encoding="utf-8")
    mirror_tree = ast.parse(mirror_text)
    mirror_lines = mirror_text.splitlines()

    def mirror_body(name):
        for node in ast.walk(mirror_tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
                end = max(getattr(n, "end_lineno", node.lineno) for n in ast.walk(node))
                return mirror_lines[node.lineno - 1:end]
        raise AssertionError(f"Fungsi {name} tidak ditemukan di api/index.py")

    def body_only(lines):
        # Dekorator sengaja berbeda: server memakai `@app.post("/api/v1/...")`
        # sedangkan mirror memakai `@api.post("/v1/...")` karena router sudah
        # berprefix `/api`. Yang wajib identik adalah badan fungsinya.
        for index, line in enumerate(lines):
            if line.lstrip().startswith(("async def ", "def ")):
                return lines[index:]
        return lines

    for name in ("pay_purchase_debt", "pay_supplier", "create_purchase"):
        expected = body_only(inspect.getsource(getattr(server, name)).splitlines())
        assert body_only(mirror_body(name)) == expected, (
            f"{name} di api/index.py menyimpang dari backend/server.py"
        )


def test_check_pin_does_not_touch_dropped_login_attempts_table():
    """Regresi: tabel `login_attempts` sudah dihapus, sehingga `check_pin`
    tidak boleh lagi mengaksesnya (memicu KeyError 500 saat login).

    Logika autentikasi tetap: cari kredensial di tabel `users` lalu verifikasi
    PIN bcrypt dengan `verify_pin`.
    """
    import inspect

    import server

    source = inspect.getsource(server.check_pin)
    assert "login_attempts" not in source
    assert "db.users.find(" in source
    assert "verify_pin(pin, doc[\"pin\"])" in source

    mirror = _mirror_source()
    assert "login_attempts" not in mirror


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
    ) == ["1-10001", "4-40000", "5-50000", "1-10003"]
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


def test_post_stok_pembelian_inserts_inventory_and_payable_journal_pair():
    class FakeConnection:
        async def executemany(self, query, rows):
            self.query = query
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(post_stok_pembelian(connection, {
        "purchase_id": "PO-001",
        "supplier_id": UUID("00000000-0000-0000-0000-000000000123"),
        "total_harga": "12500.50",
    }))

    assert "insert into public.jurnal_transaksi" in connection.query
    assert "(kode_akun, debit, kredit, keterangan)" in connection.query
    assert "$1, $2, $3, $4" in connection.query
    assert [(row[:3]) for row in connection.rows] == [
        ("1-10003", Decimal("12500.50"), Decimal("0")),
        ("2-20001", Decimal("0"), Decimal("12500.50")),
    ]
    descriptions = [row[3] for row in connection.rows]
    assert descriptions[0] == descriptions[1]
    assert "Supplier: 00000000-0000-0000-0000-000000000123" in descriptions[0]
    assert re.search(r"Group_ID: [0-9a-f-]{36}$", descriptions[0])


def test_post_hpp_checkout_inserts_expense_and_inventory_journal_pair():
    class FakeConnection:
        async def executemany(self, query, rows):
            self.query = query
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(post_hpp_checkout(connection, {
        "id": 123,
        "total_hpp": 875.25,
    }))

    assert "insert into public.jurnal_transaksi" in connection.query
    assert "(kode_akun, debit, kredit, keterangan)" in connection.query
    assert "$1, $2, $3, $4" in connection.query
    assert [(row[:3]) for row in connection.rows] == [
        ("5-50000", Decimal("875.25"), Decimal("0")),
        ("1-10003", Decimal("0"), Decimal("875.25")),
    ]
    descriptions = [row[3] for row in connection.rows]
    assert descriptions[0] == descriptions[1]
    assert "Transaction: 123" in descriptions[0]
    assert re.search(r"Group: [0-9a-f-]{36}$", descriptions[0])


def test_new_journal_functions_reject_missing_ids_and_non_positive_amounts():
    class FakeConnection:
        async def executemany(self, _query, _rows):
            raise AssertionError("Invalid journal data must not execute SQL.")

    invalid_calls = (
        (post_stok_pembelian, {"total_harga": 100}),
        (post_stok_pembelian, {"id": "PO-001", "total_harga": 0}),
        (post_stok_pembelian, {"id": "PO-001", "total_harga": "invalid"}),
        (post_hpp_checkout, {"total_hpp": 100}),
        (post_hpp_checkout, {"id": "TRX-001", "total_hpp": -1}),
        (post_hpp_checkout, {"id": "TRX-001", "total_hpp": float("inf")}),
    )
    for journal_func, payload in invalid_calls:
        try:
            asyncio.run(journal_func(FakeConnection(), payload))
        except ValueError:
            pass
        else:
            raise AssertionError("Data jurnal tidak valid harus ditolak.")


def test_new_journal_functions_propagate_database_errors():
    class FailingConnection:
        async def executemany(self, _query, _rows):
            raise RuntimeError("journal insert failed")

    for journal_func, payload in (
        (post_stok_pembelian, {"id": "PO-001", "total_harga": 100}),
        (post_hpp_checkout, {"id": "TRX-001", "total_hpp": 100}),
    ):
        try:
            asyncio.run(journal_func(FailingConnection(), payload))
        except RuntimeError as error:
            assert str(error) == "journal insert failed"
        else:
            raise AssertionError("Database error harus diteruskan ke transaksi utama.")


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


def test_expense_account_codes_never_leave_the_expense_line_uncoded():
    assert expense_account_codes(350, "6-60203") == ["6-60203", "1-10001"]
    # Tanpa kode dari kategori, pengeluaran tetap dibukukan ke akun penampung
    # 6-9999 agar laporan laba rugi tidak kehilangan bebannya.
    assert expense_account_codes(350) == ["6-9999", "1-10001"]
    assert expense_account_codes(0, "6-60203") == []


def test_resolve_expense_account_code_prefers_category_id_then_name_then_fallback():
    class FakeConnection:
        async def fetchrow(self, query, category_id):
            assert "from public.expense_categories" in query
            if category_id == 5:
                return {"account_code": "6-60153"}
            if category_id == 99:
                return {"account_code": "   "}
            return None

        async def fetch(self, query, category):
            assert "from public.expense_categories" in query
            if category == "Uang Makan IMRAN":
                return [{"account_code": "6-60153"}]
            return []

    assert asyncio.run(
        resolve_expense_account_code(FakeConnection(), "Uang Makan IMRAN", 5)
    ) == "6-60153"
    assert asyncio.run(
        resolve_expense_account_code(FakeConnection(), "Uang Makan IMRAN")
    ) == "6-60153"
    assert asyncio.run(
        resolve_expense_account_code(FakeConnection(), "Kategori Asing", 99)
    ) == "6-9999"


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
        ("1-10003", Decimal("1200.00"), Decimal("0"), purchase_connection.rows[0][3]),
        ("1-10002", Decimal("0"), Decimal("1200.00"), purchase_connection.rows[0][3]),
    ]
    assert purchase_connection.rows[0][3] == purchase_connection.rows[1][3]
    assert re.search(r"Group_ID: [0-9a-f-]{36}$", purchase_connection.rows[0][3])

    asyncio.run(post_purchase_journal(
        purchase_connection, 1200, "credit", None, "Pembelian PO-001"
    ))
    assert [row[0] for row in purchase_connection.rows] == ["1-10003", "2-20001"]
    assert purchase_connection.rows[0][3] == purchase_connection.rows[1][3]
    assert re.search(r"Group_ID: [0-9a-f-]{36}$", purchase_connection.rows[0][3])
    assert "insert into public.jurnal_transaksi" in purchase_connection.sql

    payment_connection = FakeConnection()
    asyncio.run(post_debt_payment_journal(
        payment_connection, 450, "1-10002", "Pelunasan PO-001"
    ))
    assert [row[0] for row in payment_connection.rows] == ["2-20001", "1-10002"]


def test_cash_expense_posts_balanced_pair_to_jurnal_transaksi():
    class FakeConnection:
        sql = ""
        rows = []

        async def executemany(self, sql, rows):
            self.sql = sql
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(
        post_cash_expense_journal(
            connection, 150000, "Tagihan Listrik & Air", "6-60102"
        )
    )

    assert "insert into public.jurnal_transaksi" in connection.sql
    assert "(kode_akun, debit, kredit, keterangan)" in connection.sql
    assert "values ($1, $2, $3, $4)" in connection.sql
    keterangan = "Pembayaran Tunai Kasir: Tagihan Listrik & Air"
    assert connection.rows == [
        ("6-60102", Decimal("150000.00"), Decimal("0.00"), keterangan),
        ("1-10001", Decimal("0.00"), Decimal("150000.00"), keterangan),
    ]
    # Jurnal wajib seimbang: total debit == total kredit.
    assert sum(row[1] for row in connection.rows) == sum(row[2] for row in connection.rows)


def test_cash_expense_falls_back_to_container_account_and_skips_zero():
    class FakeConnection:
        rows = []

        async def executemany(self, sql, rows):
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(post_cash_expense_journal(connection, 25000, "Gas"))
    assert connection.rows[0][0] == "6-9999"

    empty = FakeConnection()
    asyncio.run(post_cash_expense_journal(empty, 0, "Gas"))
    assert empty.rows == []


def test_cash_movement_posts_category_mapped_balanced_pair_with_group_id():
    class FakeConnection:
        async def fetch(self, _sql, *_args):
            return []

        async def executemany(self, sql, rows):
            self.sql = sql
            self.rows = list(rows)

    for category, debit_code in (
        ("Pembelian Bahan Baku", "1-10003"),
        ("Biaya Operasional", "6-60000"),
        ("Biaya Angkut/Pengiriman", "5-50000"),
    ):
        connection = FakeConnection()
        group_id = asyncio.run(post_cash_movement_journal(
            connection,
            Decimal("1234.56"),
            category,
            "Catatan kasir",
        ))

        assert "insert into public.jurnal_transaksi" in connection.sql
        assert [row[:3] for row in connection.rows] == [
            (debit_code, Decimal("1234.56"), Decimal("0.00")),
            ("1-10001", Decimal("0.00"), Decimal("1234.56")),
        ]
        assert connection.rows[0][3] == connection.rows[1][3]
        assert connection.rows[0][3].startswith(f"{category} - Catatan kasir | Group_ID: ")
        assert connection.rows[0][3].endswith(group_id)
        assert str(UUID(group_id)) == group_id


def test_cash_movement_resolves_trimmed_case_insensitive_database_category():
    class FakeConnection:
        async def fetch(self, sql, *args):
            self.lookup_sql = sql
            self.lookup_args = args
            return [{"account_code": "6-60153"}]

        async def executemany(self, sql, rows):
            self.sql = sql
            self.rows = list(rows)

    connection = FakeConnection()
    asyncio.run(post_cash_movement_journal(
        connection,
        Decimal("25000"),
        "  uang makan  ",
        "Makan staf",
    ))

    assert "from public.expense_categories" in connection.lookup_sql
    assert "trim(name) ilike trim($1)" in connection.lookup_sql.lower()
    assert connection.lookup_args == ("uang makan",)
    assert connection.rows[0][:3] == (
        "6-60153",
        Decimal("25000.00"),
        Decimal("0.00"),
    )


def test_cash_movement_uses_logged_local_fallback_when_category_lookup_fails(caplog):
    class DisconnectedConnection:
        async def fetch(self, _sql, *_args):
            raise ConnectionError("database connection lost")

        async def executemany(self, sql, rows):
            self.sql = sql
            self.rows = list(rows)

    connection = DisconnectedConnection()
    asyncio.run(post_cash_movement_journal(
        connection,
        Decimal("25000"),
        " UANG MAKAN ",
        "Makan staf",
    ))

    assert connection.rows[0][0] == "6-60153"
    assert connection.rows[1][0] == "1-10001"
    assert "mencoba pemetaan lokal" in caplog.text


def test_cash_movement_rejects_unmapped_category_without_posting():
    class FakeConnection:
        async def fetch(self, _sql, *_args):
            return []

        async def executemany(self, _sql, _rows):
            raise AssertionError("Kategori yang tidak dipetakan tidak boleh diposting.")

    try:
        asyncio.run(post_cash_movement_journal(
            FakeConnection(),
            Decimal("100.00"),
            "Kategori Lain",
            "Catatan",
        ))
    except ValueError as error:
        assert "belum dipetakan" in str(error)
    else:
        raise AssertionError("Kategori yang tidak dipetakan harus ditolak.")


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

        async def fetch(self, sql, account_codes):
            assert account_codes == ["4-40000"]
            return []

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
    assert [row[6] for row in connection.rows] == [None, "4-40000"]


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


def test_financial_position_summary_uses_cumulative_ending_balances():
    class FakePool:
        def __init__(self):
            self.sql = ""
            self.args = ()

        async def fetch(self, sql, *args):
            self.sql = sql
            self.args = args
            return [
                {"account_code": "1-10001", "account_name": "Kas Tunai", "account_type": "asset", "balance": Decimal("500000")},
                {"account_code": "1-10002", "account_name": "Bank BCA", "account_type": "asset", "balance": Decimal("300000")},
                {"account_code": "1-10003", "account_name": "Persediaan Bahan Baku", "account_type": "asset", "balance": Decimal("200000")},
                {"account_code": "2-20000", "account_name": "Utang Usaha", "account_type": "liability", "balance": Decimal("150000")},
                {"account_code": "3-30000", "account_name": "Modal Pemilik", "account_type": "equity", "balance": Decimal("700000")},
                {"account_code": "4-40000", "account_name": "Pendapatan Penjualan", "account_type": "revenue", "balance": Decimal("400000")},
                {"account_code": "6-60000", "account_name": "Beban Operasional", "account_type": "expense", "balance": Decimal("250000")},
            ]

    pool = FakePool()
    result = asyncio.run(get_financial_position_summary(pool, date(2026, 10, 31)))

    # Saldo akhir kumulatif, bukan mutasi rentang tanggal.
    assert "ledger.transaction_date <= $1" in pool.sql
    assert pool.args == (date(2026, 10, 31),)

    assert result["cash_bank"] == Decimal("800000.00")
    assert result["inventory"] == Decimal("200000.00")
    assert result["total_assets"] == Decimal("1000000.00")
    assert result["total_liabilities"] == Decimal("150000.00")
    assert result["equity_accounts"] == Decimal("700000.00")
    # Laba berjalan kumulatif = pendapatan - beban.
    assert result["net_profit"] == Decimal("150000.00")
    assert result["total_equity"] == Decimal("850000.00")
    assert result["total_liabilities_equity"] == Decimal("1000000.00")
    assert result["difference"] == Decimal("0.00")
    assert result["as_of"] == "2026-10-31"


def test_financial_position_summary_without_end_date_reads_all_ledger_rows():
    class FakePool:
        def __init__(self):
            self.sql = ""
            self.args = ()

        async def fetch(self, sql, *args):
            self.sql = sql
            self.args = args
            return []

    pool = FakePool()
    result = asyncio.run(get_financial_position_summary(pool))

    assert pool.args == (None,)
    assert result["as_of"] is None
    assert result["total_assets"] == Decimal("0.00")
    assert result["total_liabilities_equity"] == Decimal("0.00")
    assert result["difference"] == Decimal("0.00")
    assert result["accounts"] == []


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
    # Rentang tanggal dikonversi ke kalender Asia/Makassar (WITA) lebih dulu.
    assert "(tanggal::timestamptz at time zone 'Asia/Makassar')::date >= $1::date" in connection.sql
    assert "(tanggal::timestamptz at time zone 'Asia/Makassar')::date <= $2::date" in connection.sql
    assert connection.args == (date(2026, 10, 1), date(2026, 10, 31))
    assert "order by tanggal desc, id desc" in connection.sql
    assert "limit 5" in connection.sql
