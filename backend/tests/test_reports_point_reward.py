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
        self.order = []

    def sort(self, key, direction=1):
        self.order.append((key, direction))
        return self

    async def to_list(self, length=None):
        return list(self.rows)


class FakeCollection:
    """Collection palsu: mencatat filter yang diterima endpoint."""

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
        "_id": "TRX-20261110-0007",
        "date": "2026-11-10T17:30:00+00:00",  # 2026-11-11 01:30 WITA
        "customerName": "Budi",
        "pointsRedeemed": 100,
        "pointsDiscount": 10000,
        "userName": "Kasir Sari",
    },
    {
        "_id": "TRX-20261109-0003",
        "date": "2026-11-09T04:00:00+00:00",  # 2026-11-09 12:00 WITA
        "customerName": "",
        "pointsRedeemed": 200,
        "pointsDiscount": 20000,
        "userName": "Kasir Budi",
    },
    {
        # Transaksi tanpa penukaran poin harus diabaikan.
        "_id": "TRX-20261109-0004",
        "date": "2026-11-09T05:00:00+00:00",
        "customerName": "Ani",
        "pointsRedeemed": 0,
        "pointsDiscount": 0,
        "userName": "Kasir Budi",
    },
]


def _run(fake_db, start="2026-11-01", end="2026-11-30"):
    original = reports.db
    reports.db = fake_db
    try:
        return asyncio.run(reports.point_reward_usage_report(start, end, _=ADMIN))
    finally:
        reports.db = original


def test_point_reward_route_registered():
    paths = [r.path for r in router.routes]
    assert "/api/reports/point-reward-usage" in paths


def test_point_reward_filters_by_date_range():
    fake = FakeDB(TRANSACTIONS)
    _run(fake)
    assert fake.transactions.filters, "endpoint harus membaca transactions dengan filter tanggal"
    assert "date" in fake.transactions.filters[0]


def test_point_reward_maps_rows_and_totals():
    report = _run(FakeDB(TRANSACTIONS))

    assert report["total_redemptions"] == 2  # baris tanpa poin diabaikan
    assert report["total_points_redeemed"] == 300
    assert report["total_discount_value"] == 30000

    first = report["items"][0]
    assert first["transaction_id"] == "TRX-20261110-0007"
    assert first["date"] == "2026-11-11"  # dikonversi ke kalender WITA
    assert first["customer_name"] == "Budi"
    assert first["points_redeemed"] == 100
    assert first["discount_value"] == 10000
    assert first["cashier"] == "Kasir Sari"

    second = report["items"][1]
    assert second["customer_name"] == ""
    assert second["points_redeemed"] == 200


def test_point_reward_handles_empty_period():
    report = _run(FakeDB([]))
    assert report["total_redemptions"] == 0
    assert report["total_points_redeemed"] == 0
    assert report["total_discount_value"] == 0
    assert report["items"] == []


def test_point_reward_admin_dependency_rejects_non_admin():
    admin_dep = next(
        d.call
        for r in router.routes
        if getattr(r, "path", None) == "/api/reports/point-reward-usage"
        for d in r.dependant.dependencies
    )
    assert asyncio.run(admin_dep(user=ADMIN)) is ADMIN
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_dep(user=KASIR))
    assert exc.value.status_code == 403
