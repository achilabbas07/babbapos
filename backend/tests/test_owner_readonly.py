"""Uji endpoint Pantauan Pemilik (Mode Owner) — BACA-SAJA.

Fokus pengujian:
- endpoint terdaftar pada router laporan operasional (paritas server/mirror), 
- hanya memakai operasi baca pada seluruh koleksi yang diakses,
- perhitungan 5 bagian (omzet, open bill, stok bahan, shift aktif, laba-rugi),
- filter periode Bulan dan Tanggal memakai kalender WITA.
"""

import asyncio
import inspect
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException

import reports
from core import User, WITA
from reports import router


ADMIN = User(id="admin", name="Admin", role="admin")


def _parse(text):
    parsed = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _compare_iso(left, right):
    a, b = _parse(left), _parse(right)
    return (a > b) - (a < b)


def _matches(row, flt):
    """Terapkan filter ``$gte``/``$lt``/``$or`` ala ``date_range_query``."""
    for field, condition in (flt or {}).items():
        if field == "$or":
            if not any(_matches(row, branch) for branch in condition):
                return False
            continue
        if not isinstance(condition, dict):
            if row.get(field) != condition:
                return False
            continue
        value = row.get(field)
        for op, bound in condition.items():
            if op == "$in":
                if value not in bound:
                    return False
                continue
            if value is None:
                return False
            compare = _compare_iso(value, bound)
            if op == "$gte" and not compare >= 0:
                return False
            if op == "$lt" and not compare < 0:
                return False
    return True


class FakeCursor:
    def __init__(self, rows, flt=None):
        self.rows = rows
        self.flt = flt or {}

    def sort(self, key, direction=1):
        return self

    async def to_list(self, length=None):
        rows = [row for row in self.rows if _matches(row, self.flt)]
        return rows[:length] if length else rows


class FakeCollection:
    """Collection palsu: mencatat filter & MENOLAK setiap operasi tulis."""

    def __init__(self, rows=None):
        self.rows = rows or []
        self.filters = []

    def find(self, flt=None, projection=None):
        self.filters.append(flt)
        return FakeCursor(self.rows, flt)

    def __getattr__(self, name):
        raise AssertionError(f"Operasi '{name}' tidak diizinkan pada mode Owner (read-only)")


class FakePool:
    """Pool palsu; hanya dipakai sebagai penanda pemanggilan laporan P&L."""


class FakeDB:
    def __init__(
        self,
        transactions=None,
        open_bills=None,
        inventory=None,
        waiter_shifts=None,
        tables=None,
        order_logs=None,
        void_logs=None,
    ):
        self.transactions = FakeCollection(transactions)
        self.open_bills = FakeCollection(open_bills)
        self.inventory = FakeCollection(inventory)
        self.waiter_shifts = FakeCollection(waiter_shifts)
        self.tables = FakeCollection(tables)
        self.order_logs = FakeCollection(order_logs)
        self.void_logs = FakeCollection(void_logs)
        self.pool = FakePool()
        self.connect_calls = 0

    async def connect(self):
        self.connect_calls += 1
        return self.pool


TRANSACTIONS = [
    {
        "_id": "TRX-1",
        "date": "2026-11-10T04:00:00+00:00",  # 2026-11-10 12:00 WITA
        "orderTime": "2026-11-10T03:30:00+00:00",
        "total": 100000,
        "subtotal": 110000,
        "discount": 10000,
        "promoCode": "GRATIS10",
        "promoDiscount": 10000,
        "pointsRedeemed": 0,
        "pointsDiscount": 0,
        "waiterId": "W-1",
        "waiterName": "Pelayan Sari",
        "items_json": [{"productId": "P-1", "productName": "Kopi", "qty": 2}],
    },
    {
        "_id": "TRX-2",
        "date": "2026-11-11T02:00:00+00:00",  # 2026-11-11 10:00 WITA
        "total": 50000,
        "subtotal": 55000,
        "promoDiscount": 0,
        "pointsRedeemed": 20,
        "pointsDiscount": 5000,
        "waiterId": "W-1",
        "waiterName": "Pelayan Sari",
        "items_json": [{"productId": "P-2", "productName": "Teh", "qty": 3}],
    },
    {
        "_id": "TRX-OLD",
        "date": "2026-10-01T02:00:00+00:00",
        "total": 999999,
        "waiterId": "W-1",
        "items_json": [],
    },
]

OPEN_BILLS = [
    {
        "_id": "OB-1",
        "timestamp": "2026-11-10T05:00:00+00:00",
        "type": "Dine In",
        "total": 75000,
        "tableId": "T-1",
        "customerName": "Budi",
        "waiterName": "Pelayan Sari",
        "items_json": [{"qty": 2}, {"qty": 1}],
    },
    {
        "_id": "OB-2",
        "timestamp": "2026-11-10T06:00:00+00:00",
        "type": "Takeaway",
        "total": 25000,
        "tableId": None,
        "customerName": "",
        "waiterName": "",
        "items_json": [{"qty": 1}],
    },
]

INVENTORY = [
    {"_id": "I-1", "name": "Gula", "type": "bahan", "stock": 5, "unit": "kg",
     "cost_per_unit": 15000, "min_stock": 10},
    {"_id": "I-2", "name": "Kopi Robusta", "type": "bahan", "stock": 20, "unit": "kg",
     "cost_per_unit": 90000, "min_stock": 5},
]

WAITER_SHIFTS = [
    {"_id": "WSHIFT-1", "userId": "W-1", "userName": "Pelayan Sari",
     "openedAt": "2026-11-10T02:00:00+00:00", "status": "open"},
]

ORDER_LOGS = [
    {"_id": "L-1", "shiftId": "WSHIFT-1", "productId": "P-1", "variantName": "Kopi Susu",
     "variantId": None, "qty": 2, "source": "bill_create", "refId": "OB-1"},
    {"_id": "L-2", "shiftId": "WSHIFT-1", "productId": "P-2", "variantName": "Teh Manis",
     "variantId": None, "qty": 3, "source": "direct", "refId": "TRX-2"},
    {"_id": "L-3", "shiftId": "WSHIFT-1", "productId": "P-1", "variantName": "Kopi Susu",
     "variantId": None, "qty": -1, "source": "void", "refId": "OB-9"},
]

VOID_LOGS = [
    {"_id": "V-1", "billId": "OB-9", "reason": "Salah input",
     "items_json": [{"qty": 1, "productName": "Kopi", "variantName": "Kopi Susu",
                     "price": 20000, "subtotal": 20000}]},
]

PL_SUMMARY = {
    "revenue": Decimal("150000.00"),
    "sales_discount": Decimal("10000.00"),
    "hpp": Decimal("60000.00"),
    "expenses": Decimal("20000.00"),
    "net_profit": Decimal("60000.00"),
}


def _default_db(**overrides):
    kwargs = {
        "transactions": list(TRANSACTIONS),
        "open_bills": list(OPEN_BILLS),
        "inventory": list(INVENTORY),
        "waiter_shifts": list(WAITER_SHIFTS),
        "tables": [{"_id": "T-1", "name": "Meja 1", "area": "Utama"}],
        "order_logs": list(ORDER_LOGS),
        "void_logs": list(VOID_LOGS),
    }
    kwargs.update(overrides)
    return FakeDB(**kwargs)


def _run(fake_db, start=None, end=None, month=None, year=None, pl_result=None):
    original_db = reports.db
    original_pl = reports.get_profit_and_loss_report
    captured = {}

    async def fake_pl(pool, start_date, end_date):
        captured["pool"] = pool
        captured["start_date"] = start_date
        captured["end_date"] = end_date
        return pl_result if pl_result is not None else {"rows": [], "summary": dict(PL_SUMMARY)}

    reports.db = fake_db
    reports.get_profit_and_loss_report = fake_pl
    try:
        result = asyncio.run(
            reports.owner_monitor_report(start=start, end=end, month=month, year=year, _=ADMIN)
        )
    finally:
        reports.db = original_db
        reports.get_profit_and_loss_report = original_pl
    return result, captured


def test_owner_monitor_route_registered():
    assert "/api/reports/owner-monitor" in [r.path for r in router.routes]


def test_owner_monitor_uses_admin_guard():
    """Akun Owner tetap berrole admin sehingga guard laporan operasional berlaku."""
    source = inspect.getsource(reports.owner_monitor_report)
    assert "Depends(ADMIN)" in source


def test_owner_monitor_endpoint_is_read_only():
    """Tidak ada operasi tulis pada sumber kode endpoint (mode strictly read-only)."""
    source = inspect.getsource(reports.owner_monitor_report)
    for forbidden in (
        "insert_one",
        "insert_many",
        "update_one",
        "replace_one",
        "delete_one",
        "delete_many",
    ):
        assert forbidden not in source, f"Mode Owner tidak boleh memakai {forbidden}"


def test_owner_monitor_does_not_write_to_any_collection():
    """FakeCollection meledak bila koleksi dipanggil metode tulis."""
    fake = _default_db()
    _run(fake, month=11, year=2026)
    assert fake.connect_calls == 1


def test_owner_monitor_month_filter_omzet():
    report, _ = _run(_default_db(), month=11, year=2026)

    assert report["period"]["start"] == "2026-11-01"
    assert report["period"]["end"] == "2026-11-30"
    assert report["period"]["month"] == 11
    assert report["period"]["year"] == 2026
    assert report["readonly"] is True

    # TRX-OLD (Oktober) tidak ikut terhitung.
    assert report["omzet"]["total_revenue"] == 150000
    assert report["omzet"]["transaction_count"] == 2
    assert report["omzet"]["total_items"] == 5
    assert report["omzet"]["average_order_value"] == 75000


def test_owner_monitor_date_filter_is_inclusive_wita():
    report, _ = _run(_default_db(), start="2026-11-11", end="2026-11-11")

    assert report["period"]["start"] == "2026-11-11"
    assert report["period"]["end"] == "2026-11-11"
    assert report["omzet"]["total_revenue"] == 50000
    assert report["omzet"]["transaction_count"] == 1

    # Filter DB memakai batas hari kalender WITA (16:00 UTC hari sebelumnya).
    fake = _default_db()
    _run(fake, start="2026-11-11", end="2026-11-11")
    flt = fake.transactions.filters[0]
    assert flt["date"]["$gte"].startswith("2026-11-10T16:00:00")
    assert flt["date"]["$lt"].startswith("2026-11-11T16:00:00")


def test_owner_monitor_defaults_to_current_wita_month():
    report, _ = _run(_default_db())
    now = datetime.now(WITA)
    assert report["period"]["year"] == now.year
    assert report["period"]["month"] == now.month


def test_owner_monitor_open_bills_summary():
    report, _ = _run(_default_db(), month=11, year=2026)
    open_bills = report["open_bills"]

    assert open_bills["count"] == 2
    assert open_bills["total_value"] == 100000
    assert open_bills["truncated"] is False

    first = open_bills["items"][0]
    assert first["id"] == "OB-1"
    assert first["table_name"] == "Meja 1"
    assert first["item_count"] == 3
    assert first["total"] == 75000
    assert first["date"] == "2026-11-10"


def test_owner_monitor_inventory_stock_and_low_flag():
    report, _ = _run(_default_db(), month=11, year=2026)
    inventory = report["inventory"]

    assert inventory["count"] == 2
    assert inventory["low_stock_count"] == 1  # Gula: stok 5 <= min_stok 10
    assert inventory["total_stock_value"] == 1875000  # 5*15000 + 20*90000

    gula = next(row for row in inventory["items"] if row["name"] == "Gula")
    assert gula["is_low"] is True

    kopi = next(row for row in inventory["items"] if row["name"] == "Kopi Robusta")
    assert kopi["is_low"] is False


def test_owner_monitor_active_shift_section():
    report, _ = _run(_default_db(), month=11, year=2026)
    assert len(report["active_shifts"]) == 1

    shift = report["active_shifts"][0]
    assert shift["waiter_name"] == "Pelayan Sari"
    assert shift["total_orders"] == 2  # bill_create OB-1 + direct TRX-2
    assert shift["total_items_sold"] == 4  # 2 + 3 - 1 (log void bernilai negatif)
    assert shift["total_voids"] == 1
    assert shift["void_qty"] == 1
    assert shift["void_value"] == 20000

    # Promo & redeem dihitung dari transaksi pelayan sejak shift dibuka
    # (openedAt 2026-11-10 10:00 WITA).
    assert shift["promo_usage"]["count"] == 1
    assert shift["promo_usage"]["discount"] == 10000
    assert shift["redeem_points"]["count"] == 1
    assert shift["redeem_points"]["points"] == 20
    assert shift["redeem_points"]["discount"] == 5000


def test_owner_monitor_shift_activity_ignores_other_waiters():
    fake = _default_db(transactions=[{**TRANSACTIONS[0], "waiterId": "W-9"}])
    report, _ = _run(fake, month=11, year=2026)
    shift = report["active_shifts"][0]
    assert shift["promo_usage"]["count"] == 0
    assert shift["redeem_points"]["count"] == 0


def test_owner_monitor_profit_loss_summary():
    report, captured = _run(_default_db(), month=11, year=2026)

    assert report["profit_loss"] == {
        "revenue": 150000.0,
        "sales_discount": 10000.0,
        "hpp": 60000.0,
        "expenses": 20000.0,
        "net_profit": 60000.0,
    }

    # Rentang P&L memakai batas atas EKSKLUSIF (akhir bulan + 1 hari).
    assert captured["start_date"] == date(2026, 11, 1)
    assert captured["end_date"] == date(2026, 12, 1)
    assert isinstance(captured["pool"], FakePool)


def test_owner_monitor_profit_loss_date_range_bounds():
    _, captured = _run(_default_db(), start="2026-11-05", end="2026-11-07")
    assert captured["start_date"] == date(2026, 11, 5)
    assert captured["end_date"] == date(2026, 11, 8)


def test_owner_monitor_period_validation():
    with pytest.raises(HTTPException):
        _run(_default_db(), month=11)  # bulan tanpa tahun

    with pytest.raises(HTTPException):
        _run(_default_db(), start="2026-11-01", end="2026-11-01", month=11, year=2026)

    with pytest.raises(HTTPException):
        _run(_default_db(), start="2026-11-01")

    with pytest.raises(HTTPException):
        _run(_default_db(), start="2026-11-10", end="2026-11-01")


def test_owner_monitor_december_period_bounds():
    report, _ = _run(_default_db(), month=12, year=2026)
    assert report["period"]["start"] == "2026-12-01"
    assert report["period"]["end"] == "2026-12-31"


def test_owner_period_bounds_helper_wita_defaults():
    today = datetime.now(WITA).date()
    start, end = reports._owner_period_bounds(None, None, None, None)
    assert start == today.replace(day=1).isoformat()
    last_day = (
        date(today.year + (1 if today.month == 12 else 0), today.month % 12 + 1, 1)
        - timedelta(days=1)
    )
    assert end == last_day.isoformat()
