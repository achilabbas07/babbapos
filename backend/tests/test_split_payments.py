"""Uji split payment: normalisasi, jurnal, dan kompatibilitas mundur.

Fokus pengujian:
- struktur ``payments: [{method, amount}]`` yang dikirim klien,
- jurnal multi-metode tetap seimbang dan memakai satu ``entry_id``,
- pembayaran tunggal (perilaku lama) tidak berubah sedikit pun.
"""

import asyncio
from decimal import Decimal

import pytest

from finance import (
    checkout_cash_amounts,
    checkout_journal_account_codes,
    checkout_journal_lines,
    legacy_checkout_journal_entries,
    normalize_checkout_payments,
    post_checkout_journal_entries,
    primary_checkout_method,
)


def _balance(lines):
    debit = sum(line[2] for line in lines)
    credit = sum(line[3] for line in lines)
    return debit, credit


# --- normalize_checkout_payments -------------------------------------------------


def test_single_method_normalizes_to_one_leg_of_the_full_total():
    assert normalize_checkout_payments(25000, None, "Cash") == [
        {"method": "Cash", "amount": 25000},
    ]
    assert normalize_checkout_payments(25000, [], "QRIS") == [
        {"method": "QRIS", "amount": 25000},
    ]


def test_split_payments_are_normalized_and_cash_is_sorted_first():
    payments = [
        {"method": "qris", "amount": 70000},
        {"method": "cash", "amount": 30000},
    ]
    assert normalize_checkout_payments(100000, payments, "QRIS") == [
        {"method": "Cash", "amount": 30000},
        {"method": "QRIS", "amount": 70000},
    ]


@pytest.mark.parametrize(
    "payments",
    [
        [{"method": "Cash", "amount": 30000}, {"method": "QRIS", "amount": 60000}],
            [{"method": "Cash", "amount": 100000}, {"method": "QRIS", "amount": 5000}],
    ],
)
def test_split_total_must_match_the_bill_exactly(payments):
    with pytest.raises(ValueError):
        normalize_checkout_payments(100000, payments, "Cash")


def test_split_rejects_unsupported_method_or_zero_amount():
    with pytest.raises(ValueError):
        normalize_checkout_payments(100000, [{"method": "Bitcoin", "amount": 100000}], "Cash")
    with pytest.raises(ValueError):
        normalize_checkout_payments(
            100000,
            [{"method": "Cash", "amount": 50000}, {"method": "QRIS", "amount": 0}],
            "Cash",
        )


# --- checkout_journal_lines / account codes --------------------------------------


def test_single_cash_checkout_lines_are_identical_to_legacy_behaviour():
    items = [{"hpp": 12.5, "qty": 2}, {"hpp": 3.25, "qty": 4}]
    legacy = checkout_journal_lines(1000, "Cash", items, None)
    assert legacy == [
        ("Kas Tunai", "asset", Decimal("1000.00"), Decimal("0")),
        ("Pendapatan", "revenue", Decimal("0"), Decimal("1000.00")),
        ("Beban HPP", "expense", Decimal("38.00"), Decimal("0")),
        ("Persediaan bahan baku", "asset", Decimal("0"), Decimal("38.00")),
    ]
    assert checkout_journal_account_codes(1000, "Cash", items, None) == [
        "1-10001", "4-40000", "5-50000", "1-10003",
    ]


def test_single_non_cash_checkout_lines_use_the_bank_account():
    assert checkout_journal_lines(12500, "QRIS", [], None) == [
        ("Bank", "asset", Decimal("12500.00"), Decimal("0")),
        ("Pendapatan", "revenue", Decimal("0"), Decimal("12500.00")),
    ]
    assert checkout_journal_account_codes(12500, "QRIS", [], None) == ["1-10002", "4-40000"]


def test_split_checkout_lines_record_each_payment_leg_and_stay_balanced():
    payments = normalize_checkout_payments(
        100000,
        [{"method": "Cash", "amount": 30000}, {"method": "QRIS", "amount": 70000}],
        "QRIS",
    )
    items = [{"hpp": 20000, "qty": 1}]
    lines = checkout_journal_lines(100000, "QRIS", items, payments)

    assert lines == [
        ("Kas Tunai", "asset", Decimal("30000"), Decimal("0")),
        ("Bank", "asset", Decimal("70000"), Decimal("0")),
        ("Pendapatan", "revenue", Decimal("0"), Decimal("100000")),
        ("Beban HPP", "expense", Decimal("20000"), Decimal("0")),
        ("Persediaan bahan baku", "asset", Decimal("0"), Decimal("20000")),
    ]
    debit, credit = _balance(lines)
    assert debit == credit == Decimal("120000")
    assert checkout_journal_account_codes(100000, "QRIS", items, payments) == [
        "1-10001", "1-10002", "4-40000", "5-50000", "1-10003",
    ]


def test_split_with_two_non_cash_methods_aggregates_into_a_single_bank_leg():
    payments = normalize_checkout_payments(
        60000,
        [{"method": "QRIS", "amount": 25000}, {"method": "Debit", "amount": 35000}],
        "QRIS",
    )
    lines = checkout_journal_lines(60000, "QRIS", [], payments)
    assert lines == [
        ("Bank", "asset", Decimal("60000"), Decimal("0")),
        ("Pendapatan", "revenue", Decimal("0"), Decimal("60000")),
    ]
    assert checkout_journal_account_codes(60000, "QRIS", [], payments) == ["1-10002", "4-40000"]


# --- primary_checkout_method -----------------------------------------------------


def test_primary_method_matches_the_transactions_check_constraint():
    split = normalize_checkout_payments(
        100000,
        [{"method": "Cash", "amount": 30000}, {"method": "QRIS", "amount": 70000}],
        "Cash",
    )
    assert primary_checkout_method(split, "Cash") == "QRIS"
    assert primary_checkout_method([{"method": "Cash", "amount": 100000}], "Cash") == "Cash"
    assert primary_checkout_method([], "Debit") == "Debit"


# --- checkout_cash_amounts -------------------------------------------------------


def test_cash_amounts_use_only_the_cash_leg_for_split_payments():
    payments = normalize_checkout_payments(
        100000,
        [{"method": "Cash", "amount": 30000}, {"method": "QRIS", "amount": 70000}],
        "Cash",
    )
    assert checkout_cash_amounts(payments, 100000, 50000) == (50000, 20000)
    assert checkout_cash_amounts(payments, 100000, None) == (30000, 0)


def test_non_cash_only_payments_keep_the_legacy_cash_given_behaviour():
    payments = normalize_checkout_payments(25000, [{"method": "QRIS", "amount": 25000}], "QRIS")
    assert checkout_cash_amounts(payments, 25000, None) == (25000, 0)


# --- legacy_checkout_journal_entries --------------------------------------------


def test_legacy_entries_keep_the_single_method_pair_unchanged():
    lines = checkout_journal_lines(12500, "QRIS", [], None)
    codes = checkout_journal_account_codes(12500, "QRIS", [], None)
    assert legacy_checkout_journal_entries(lines, codes) == [
        ("1-10002", "DEBIT", 12500.0),
        ("4-40000", "KREDIT", 12500.0),
    ]


def test_legacy_entries_split_each_method_against_the_same_revenue_leg():
    payments = normalize_checkout_payments(
        100000,
        [{"method": "Cash", "amount": 30000}, {"method": "QRIS", "amount": 70000}],
        "QRIS",
    )
    lines = checkout_journal_lines(100000, "QRIS", [], payments)
    codes = checkout_journal_account_codes(100000, "QRIS", [], payments)

    entries = legacy_checkout_journal_entries(lines, codes)
    assert entries == [
        ("1-10001", "DEBIT", 30000.0),
        ("1-10002", "DEBIT", 70000.0),
        ("4-40000", "KREDIT", 100000.0),
    ]
    # Jumlah debit dan kredit pada jurnal legacy tetap seimbang.
    debit = sum(amount for _code, position, amount in entries if position == "DEBIT")
    credit = sum(amount for _code, position, amount in entries if position == "KREDIT")
    assert debit == credit == 100000.0


# --- post_checkout_journal_entries ----------------------------------------------


class FakeConnection:
    def __init__(self):
        self.query = None
        self.rows = None

    async def executemany(self, query, rows):
        self.query = query
        self.rows = list(rows)


def test_post_checkout_journal_entries_accepts_explicit_split_rows():
    connection = FakeConnection()
    asyncio.run(post_checkout_journal_entries(connection, {
        "transaction_id": "TRX-SPLIT",
        "payment_method": "QRIS",
        "total": 100000,
        "journal_entries": [
            ("1-10001", "DEBIT", 30000),
            ("1-10002", "DEBIT", 70000),
            ("4-40000", "KREDIT", 100000),
        ],
    }))

    assert "insert into public.jurnal_entries" in connection.query
    assert connection.rows == [
        ("TRX-SPLIT", "1-10001", "DEBIT", 30000.0),
        ("TRX-SPLIT", "1-10002", "DEBIT", 70000.0),
        ("TRX-SPLIT", "4-40000", "KREDIT", 100000.0),
    ]


def test_post_checkout_journal_entries_rejects_malformed_split_rows():
    connection = FakeConnection()
    with pytest.raises(ValueError):
        asyncio.run(post_checkout_journal_entries(connection, {
            "transaction_id": "TRX-BAD",
            "payment_method": "Cash",
            "total": 100000,
            "journal_entries": [("1-10001", "DEBIT")],
        }))
    assert connection.rows is None
