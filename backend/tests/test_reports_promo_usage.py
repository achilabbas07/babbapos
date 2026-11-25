import asyncio

import pytest
from fastapi import HTTPException

import reports
from core import User
from reports import router


ADMIN = User(id="admin", name="Admin", role="admin")
KASIR = User(id="kasir", name="Kasir", role="kasir")
WAITER = User(id="waiter", name="Waiter", role="waiter")


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
        "promoCode": "GRATIS10",
        "promoDiscount": 10000,
        "subtotal": 60000,
        "discount": 10000,
        "total": 50000,
        "customerName": "Budi",
        "userName": "Kasir Sari",
    },
    {
        "_id": "TRX-20261109-0003",
        "date": "2026-11-09T04:00:00+00:00",  # 2026-11-09 12:00 WITA
        "promoCode": "GRATIS10",
        "promoDiscount": 20000,
        "subtotal": 90000,
        "discount": 20000,
        "total": 70000,
        "customerName": "",
        "userName": "Kasir Budi",
    },
    {
        # Transaksi tanpa promo harus diabaikan.
        "_id": "TRX-20261109-0004",
        "date": "2026-11-09T05:00:00+00:00",
        "promoCode": None,
        "promoDiscount": 0,
        "total": 30000,
        "customerName": "Ani",
        "userName": "Kasir Budi",
    },
]


def _run(fake_db, start="2026-11-01", end="2026-11-30"):
    original = reports.db
    reports.db = fake_db
    try:
        return asyncio.run(reports.promo_usage_report(start, end, _=ADMIN))
    finally:
        reports.db = original


def test_promo_usage_route_registered():
    paths = [r.path for r in router.routes]
    assert "/api/reports/promo-usage" in paths


def test_promo_usage_filters_by_date_range():
    fake = FakeDB(TRANSACTIONS)
    _run(fake)
    assert fake.transactions.filters, "endpoint harus membaca transactions dengan filter tanggal"
    assert "date" in fake.transactions.filters[0]


def test_promo_usage_maps_rows_and_totals():
    report = _run(FakeDB(TRANSACTIONS))

    assert report["total_transactions"] == 2  # baris tanpa promo diabaikan
    assert report["total_promo_discount"] == 30000
    assert report["total_transaction_value"] == 120000
    assert report["promo_count"] == 1  # satu kode promo (GRATIS10)

    first = report["items"][0]
    assert first["transaction_id"] == "TRX-20261110-0007"
    assert first["date"] == "2026-11-11"  # dikonversi ke kalender WITA
    assert first["promo_code"] == "GRATIS10"
    assert first["promo_discount"] == 10000
    assert first["total"] == 50000
    assert first["customer_name"] == "Budi"
    assert first["cashier"] == "Kasir Sari"

    second = report["items"][1]
    assert second["customer_name"] == ""
    assert second["promo_discount"] == 20000


def test_promo_usage_recap_per_code():
    report = _run(FakeDB(TRANSACTIONS))

    assert len(report["promos"]) == 1
    recap = report["promos"][0]
    assert recap["code"] == "GRATIS10"
    assert recap["transactions"] == 2
    assert recap["promo_discount"] == 30000
    assert recap["transaction_value"] == 120000


def test_promo_usage_recap_orders_by_discount_desc():
    rows = [
        {"_id": "A", "date": "2026-11-09T04:00:00+00:00", "promoCode": "KECIL", "promoDiscount": 5000, "total": 20000},
        {"_id": "B", "date": "2026-11-09T05:00:00+00:00", "promoCode": "BESAR", "promoDiscount": 30000, "total": 90000},
        {"_id": "C", "date": "2026-11-09T06:00:00+00:00", "promoCode": None, "promoDiscount": 4000, "total": 15000},
    ]
    report = _run(FakeDB(rows))
    # Kode kosong (None) dikelompokkan sebagai "-" dan tetap dihitung.
    assert [p["code"] for p in report["promos"]] == ["BESAR", "KECIL", "-"]
    assert report["promo_count"] == 3


def test_promo_usage_handles_empty_period():
    report = _run(FakeDB([]))
    assert report["total_transactions"] == 0
    assert report["total_promo_discount"] == 0
    assert report["total_transaction_value"] == 0
    assert report["promos"] == []
    assert report["items"] == []


def test_promo_usage_admin_dependency_rejects_non_admin():
    admin_dep = next(
        d.call
        for r in router.routes
        if getattr(r, "path", None) == "/api/reports/promo-usage"
        for d in r.dependant.dependencies
    )
    assert asyncio.run(admin_dep(user=ADMIN)) is ADMIN
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_dep(user=KASIR))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_dep(user=WAITER))
    assert exc.value.status_code == 403


def test_promo_usage_mounted_on_both_entrypoints():
    """Router laporan dipakai bersama server.py & api/index.py (paritas otomatis).

    Endpoint promo berada di modul `reports.py` yang sama sehingga tidak perlu
    duplikasi di mirror Vercel -- cukup pastikan keduanya memasang router itu.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    for entrypoint in (root / "backend" / "server.py", root / "api" / "index.py"):
        source = entrypoint.read_text(encoding="utf-8")
        assert "from reports import router as reports_router" in source
        assert "app.include_router(reports_router)" in source
