import asyncio

import pytest
from fastapi import HTTPException

import reports
from core import User
from reports import router

ADMIN = User(id="admin", name="Admin", role="admin")
KASIR = User(id="kasir", name="Kasir", role="kasir")


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction=1):
        return self

    async def to_list(self, length=None):
        return list(self.rows)


class FakeCollection:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []

    def find(self, flt=None, projection=None):
        self.filters.append(flt)
        return FakeCursor(self.rows)


class FakeDB:
    def __init__(self, transactions=None):
        self.transactions = FakeCollection(transactions or [])


TRANSACTIONS = [
    {
        "_id": "TRX-20261110-0001",
        "date": "2026-11-10T03:00:00+00:00",  # 11:00 WITA
        "type": "Dine In",
        "method": "Cash",
        "total": 50000,
        "items_json": [{"qty": 2}, {"qty": 1}],
    },
    {
        "_id": "TRX-20261110-0002",
        "date": "2026-11-10T03:30:00+00:00",  # 11:30 WITA
        "type": "Ojek Online",
        "method": "QRIS",
        "total": 100000,
        "items_json": [{"qty": 3}],
    },
    {
        "_id": "TRX-20261110-0003",
        "date": "2026-11-10T18:00:00+00:00",  # 02:00 WITA hari berikutnya
        "type": "Takeaway",
        "method": "Cash",
        "total": 20000,
        "items_json": [{"qty": 1}],
        # Split payment: atribusi per leg.
        "payments": [
            {"method": "Cash", "amount": 10000},
            {"method": "Debit", "amount": 10000},
        ],
    },
]


def _run(fake_db, start="2026-11-01", end="2026-11-30"):
    original = reports.db
    reports.db = fake_db
    try:
        return asyncio.run(
            reports.customer_behavior_report(
                start_date=start, end_date=end, start=None, end=None, _=ADMIN
            )
        )
    finally:
        reports.db = original


def test_customer_behavior_route_registered():
    paths = [r.path for r in router.routes]
    assert "/api/reports/customer-behavior" in paths


def test_customer_behavior_reads_only_transactions_with_date_filter():
    fake = FakeDB(TRANSACTIONS)
    _run(fake)
    assert fake.transactions.filters, "endpoint harus membaca transactions"
    assert "date" in fake.transactions.filters[0]


def test_customer_behavior_channel_and_aov():
    report = _run(FakeDB(TRANSACTIONS))
    by_channel = {c["channel"]: c for c in report["channels"]}

    assert by_channel["Dine In"]["transactions"] == 1
    assert by_channel["Dine In"]["revenue"] == 50000
    assert by_channel["Dine In"]["aov"] == 50000
    assert by_channel["Ojek Online"]["revenue"] == 100000
    assert by_channel["Takeaway"]["revenue"] == 20000
    # Kanal teratas (omzet terbesar) di urutan pertama.
    assert report["channels"][0]["channel"] == "Ojek Online"


def test_customer_behavior_methods_handle_split_payments():
    report = _run(FakeDB(TRANSACTIONS))
    by_method = {m["method"]: m for m in report["methods"]}

    # Cash = 50.000 (trx 1) + 10.000 (leg split) = 60.000
    assert by_method["Cash"]["total"] == 60000
    assert by_method["QRIS"]["total"] == 100000
    assert by_method["Debit"]["total"] == 10000


def test_customer_behavior_basket_and_totals():
    report = _run(FakeDB(TRANSACTIONS))
    assert report["transaction_count"] == 3
    assert report["total_revenue"] == 170000
    assert report["total_items"] == 7
    assert report["average_basket_size"] == pytest.approx(round(7 / 3, 2))
    assert report["basket"]["max_items"] == 3
    assert report["basket"]["min_items"] == 1


def test_customer_behavior_peak_and_quiet_hours_use_wita():
    report = _run(FakeDB(TRANSACTIONS))
    # Jam lokal WITA: 11, 11, 02 -> jam sibuk 11, jam sepian 02.
    assert report["peak_hour"]["hour"] == 11
    assert report["quiet_hour"]["hour"] == 2
    assert len(report["hours"]) == 24


def test_customer_behavior_hours_use_order_time_not_payment_time():
    """Jam sibuk harus mengikuti waktu PESANAN DIBUAT (orderTime)."""
    rows = [
        {
            "_id": "TRX-A",
            # Pesanan dibuat 08:00 WITA, dibayar 20:00 WITA.
            "orderTime": "2026-11-10T00:00:00+00:00",
            "date": "2026-11-10T12:00:00+00:00",
            "type": "Dine In",
            "method": "Cash",
            "total": 10000,
            "items_json": [{"qty": 1}],
        },
        {
            "_id": "TRX-B",
            # Pesanan dibuat 09:00 WITA, dibayar 21:00 WITA.
            "orderTime": "2026-11-10T01:00:00+00:00",
            "date": "2026-11-10T13:00:00+00:00",
            "type": "Takeaway",
            "method": "QRIS",
            "total": 20000,
            "items_json": [{"qty": 1}],
        },
    ]
    report = _run(FakeDB(rows))
    by_hour = {h["hour"]: h["transactions"] for h in report["hours"]}
    assert by_hour[8] == 1
    assert by_hour[9] == 1
    # Tidak boleh jatuh ke jam pembayaran (20:00 / 21:00 WITA).
    assert by_hour[20] == 0
    assert by_hour[21] == 0
    assert report["peak_hour"]["hour"] == 9


def test_customer_behavior_hours_prefer_created_at_over_date():
    rows = [
        {
            "_id": "TRX-C",
            "created_at": "2026-11-10T02:00:00+00:00",  # 10:00 WITA
            "date": "2026-11-10T15:00:00+00:00",  # 23:00 WITA
            "type": "Walk In",
            "method": "Cash",
            "total": 5000,
            "items_json": [{"qty": 1}],
        },
    ]
    report = _run(FakeDB(rows))
    by_hour = {h["hour"]: h["transactions"] for h in report["hours"]}
    assert by_hour[10] == 1
    assert by_hour[23] == 0


def test_customer_behavior_hours_fall_back_to_date_for_legacy_rows():
    rows = [
        {
            "_id": "TRX-D",
            # Tanpa orderTime/created_at -> fallback ke waktu pembayaran.
            "date": "2026-11-10T04:00:00+00:00",  # 12:00 WITA
            "type": "Dine In",
            "method": "Cash",
            "total": 7000,
            "items_json": [{"qty": 1}],
        },
    ]
    report = _run(FakeDB(rows))
    assert report["peak_hour"]["hour"] == 12


def test_customer_behavior_insights_present():
    report = _run(FakeDB(TRANSACTIONS))
    assert report["insights"]
    assert any("Dine In" in line or "Ojek Online" in line for line in report["insights"])


def test_customer_behavior_empty_period():
    report = _run(FakeDB([]))
    assert report["transaction_count"] == 0
    assert report["channels"] == []
    assert report["methods"] == []
    assert report["peak_hour"] is None
    assert report["quiet_hour"] is None
    assert report["insights"]


def test_customer_behavior_accepts_legacy_start_end_alias():
    original = reports.db
    reports.db = FakeDB(TRANSACTIONS)
    try:
        report = asyncio.run(
            reports.customer_behavior_report(
                start_date=None, end_date=None, start="2026-11-01", end="2026-11-30", _=ADMIN
            )
        )
    finally:
        reports.db = original
    assert report["transaction_count"] == 3


def test_customer_behavior_requires_dates():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            reports.customer_behavior_report(
                start_date=None, end_date=None, start=None, end=None, _=ADMIN
            )
        )
    assert exc.value.status_code == 400
