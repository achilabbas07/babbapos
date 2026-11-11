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
    def __init__(self, void_logs=None, tables=None):
        self.void_logs = FakeCollection(void_logs or [])
        self.tables = FakeCollection(tables or [])


VOID_LOGS = [
    {
        "_id": "VOID-002",
        "billId": "BILL-020",
        "timestamp": "2026-11-10T17:30:00+00:00",  # 2026-11-11 01:30 WITA
        "tableId": "T2",
        "total": 10000,
        "items_json": [
            {"productId": "P2", "productName": "Es Teh", "qty": 2, "price": 5000, "subtotal": 10000, "variantName": ""},
        ],
        "reason": "Salah input",
        "requestedBy": "Kasir Sari",
        "authorizedBy": "Admin",
    },
    {
        "_id": "VOID-001",
        "billId": "BILL-010",
        "timestamp": "2026-11-09T04:00:00+00:00",  # 2026-11-09 12:00 WITA
        "tableId": "T1",
        "total": 45000,
        "items_json": [
            {"productId": "P1", "productName": "Kopi", "qty": 1, "price": 20000, "subtotal": 20000, "variantName": "Panas"},
            {"productId": "P2", "productName": "Es Teh", "qty": 5, "price": 5000, "subtotal": 25000},
        ],
        "reason": "Pelanggan batal",
        "requestedBy": "Kasir Budi",
        "authorizedBy": "Admin",
    },
]

TABLES = [
    {"_id": "T1", "name": "Meja 1"},
    {"_id": "T2", "name": "Meja 2"},
]


def _run(fake_db, start="2026-11-01", end="2026-11-30"):
    original = reports.db
    reports.db = fake_db
    try:
        return asyncio.run(reports.void_sales_report(start, end, _=ADMIN))
    finally:
        reports.db = original


def test_void_sales_route_registered():
    paths = [r.path for r in router.routes]
    assert "/api/reports/void-sales" in paths


def test_void_sales_filters_by_timestamp_range():
    fake = FakeDB(VOID_LOGS, TABLES)
    _run(fake)
    assert fake.void_logs.filters, "endpoint harus membaca void_logs dengan filter tanggal"
    assert "timestamp" in fake.void_logs.filters[0]


def test_void_sales_maps_rows_and_totals():
    report = _run(FakeDB(VOID_LOGS, TABLES))

    assert report["total_voids"] == 2
    assert report["total_items"] == 3
    assert report["total_qty"] == 8  # 2 + 1 + 5
    assert report["total_value"] == 55000  # 10000 + 20000 + 25000

    first = report["items"][0]
    assert first["void_id"] == "VOID-002"
    assert first["bill_id"] == "BILL-020"
    assert first["date"] == "2026-11-11"  # dikonversi ke kalender WITA
    assert first["table_name"] == "Meja 2"
    assert first["product_name"] == "Es Teh"
    assert first["qty"] == 2
    assert first["value"] == 10000
    assert first["cashier"] == "Kasir Sari"
    assert first["reason"] == "Salah input"

    variant_row = report["items"][1]
    assert variant_row["variant_name"] == "Panas"
    assert variant_row["table_name"] == "Meja 1"
    assert variant_row["cashier"] == "Kasir Budi"


def test_void_sales_handles_empty_period():
    report = _run(FakeDB([], []))
    assert report["total_voids"] == 0
    assert report["total_items"] == 0
    assert report["total_qty"] == 0
    assert report["total_value"] == 0
    assert report["items"] == []


def test_void_sales_admin_dependency_rejects_non_admin():
    admin_dep = next(
        d.call
        for r in router.routes
        if getattr(r, "path", None) == "/api/reports/void-sales"
        for d in r.dependant.dependencies
    )
    assert asyncio.run(admin_dep(user=ADMIN)) is ADMIN
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_dep(user=KASIR))
    assert exc.value.status_code == 403


def test_void_sales_admin_dependency_rejects_non_admin():
    admin_dep = next(
        d.call
        for r in router.routes
        if getattr(r, "path", None) == "/api/reports/void-sales"
        for d in r.dependant.dependencies
    )
    assert asyncio.run(admin_dep(user=ADMIN)) is ADMIN
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_dep(user=KASIR))
    assert exc.value.status_code == 403
