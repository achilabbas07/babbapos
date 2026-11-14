"""Uji ``targets.progress_for`` dengan database palsu (tanpa Supabase).

Mengunci tiga hal:
1. Target lama (tanpa ``targetType``) menghasilkan bentuk data yang sama persis.
2. Target omzet membaca ``transactions`` shift, bukan ``order_logs``.
3. Target berbasis waktu membaca rentang periode + jam operasional.
"""

import asyncio
from types import SimpleNamespace

import pytest

import target_types as tt
import targets


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.filter = None

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _length=None):
        return self.rows


class FakeCollection:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []

    def find(self, flt=None, projection=None):
        self.filters.append(flt)
        return FakeCursor(self._matching(flt))

    async def find_one(self, flt=None, projection=None):
        rows = self._matching(flt)
        return rows[0] if rows else None

    async def count_documents(self, flt=None):
        return len(self._matching(flt))

    def _matching(self, flt):
        if not flt:
            return list(self.rows)
        return [r for r in self.rows if all(self._match(r, k, v) for k, v in flt.items())]

    @staticmethod
    def _match(row, key, cond):
        if key == "$or":
            return any(all(FakeCollection._match(row, k, v) for k, v in f.items()) for f in cond)
        value = row.get(key)
        if isinstance(cond, dict):
            for op, expected in cond.items():
                if op == "$in":
                    if value not in expected:
                        return False
                elif op == "$gte":
                    if value is None or str(value) < str(expected):
                        return False
                elif op == "$lt":
                    if value is None or str(value) >= str(expected):
                        return False
                elif op == "$ne":
                    if value == expected:
                        return False
            return True
        return value == cond


def fake_db(order_logs, transactions, sales_targets):
    return SimpleNamespace(
        order_logs=FakeCollection(order_logs),
        transactions=FakeCollection(transactions),
        sales_targets=FakeCollection(sales_targets),
        open_bills=FakeCollection([]),
        void_logs=FakeCollection([]),
    )


SHIFT = {"_id": "WSHIFT-1", "userId": "USR-W1", "userName": "Pelayan Satu", "openedAt": "2026-01-01T08:00:00+08:00"}


@pytest.fixture
def patch_db(monkeypatch):
    def _apply(db):
        monkeypatch.setattr(targets, "db", db)
        return db

    return _apply


# --------------------------------------------------------------------------
# Target lama — bentuk output harus identik dengan sebelumnya
# --------------------------------------------------------------------------


def test_legacy_item_target_output_shape_is_unchanged(patch_db):
    sales_targets = [{
        "_id": "TGT-1", "name": "Paket Kopi", "productIds": ["PRD-1", "PRD-2"],
        "productNames": ["Kopi", "Teh"], "targetQty": 10, "waiterId": None, "waiterName": "",
    }]
    logs = [
        {"productId": "PRD-1", "qty": 3, "shiftId": "WSHIFT-1", "timestamp": "2026-01-01T09:00:00+08:00"},
        {"productId": "PRD-2", "qty": 2, "shiftId": "WSHIFT-1", "timestamp": "2026-01-01T09:10:00+08:00"},
        {"productId": "PRD-9", "qty": 99, "shiftId": "WSHIFT-1", "timestamp": "2026-01-01T09:10:00+08:00"},
    ]
    db = patch_db(fake_db(logs, [], sales_targets))

    progress = asyncio.run(targets.progress_for(SHIFT))
    item = progress["items"][0]

    # Field inti yang dipakai UI lama tetap ada dan nilainya sama.
    assert progress["shiftId"] == "WSHIFT-1"
    assert progress["waiterId"] == "USR-W1"
    assert progress["waiterName"] == "Pelayan Satu"
    assert item["targetId"] == "TGT-1"
    assert item["name"] == "Paket Kopi"
    assert item["targetQty"] == 10
    assert item["achieved"] == 5
    assert item["pct"] == pytest.approx(50.0)
    assert {b["productId"]: b["qty"] for b in item["breakdown"]} == {"PRD-1": 3, "PRD-2": 2}

    # Transaksi tidak boleh dibaca untuk target kuantitas item.
    assert db.transactions.filters == []


def test_progress_without_targets_returns_empty_items(patch_db):
    patch_db(fake_db([], [], []))
    progress = asyncio.run(targets.progress_for(SHIFT))
    assert progress["items"] == []


# --------------------------------------------------------------------------
# Target omzet
# --------------------------------------------------------------------------


def test_revenue_target_reads_transactions_of_the_shift(patch_db):
    sales_targets = [{
        "_id": "TGT-REV", "name": "Omzet Shift", "productIds": [], "productNames": [],
        "targetQty": None, "targetType": tt.REVENUE_AMOUNT, "targetAmount": 1000000,
        "periodType": tt.PERIOD_SHIFT,
    }]
    transactions = [
        {"total": 250000, "shiftId": "WSHIFT-1", "date": "2026-01-01T10:00:00+08:00"},
        {"total": 150000, "shiftId": "WSHIFT-1", "date": "2026-01-01T11:00:00+08:00"},
        {"total": 999999, "shiftId": "WSHIFT-2", "date": "2026-01-01T12:00:00+08:00"},
    ]
    patch_db(fake_db([], transactions, sales_targets))

    item = asyncio.run(targets.progress_for(SHIFT))["items"][0]

    assert item["achieved"] == pytest.approx(400000)
    assert item["targetValue"] == pytest.approx(1000000)
    assert item["unit"] == tt.UNIT_CURRENCY
    assert item["pct"] == pytest.approx(40.0)


def test_revenue_and_item_targets_coexist(patch_db):
    """Kedua tipe berdampingan tanpa saling mengganggu."""
    sales_targets = [
        {"_id": "TGT-ITEM", "name": "Kopi", "productIds": ["PRD-1"], "productNames": ["Kopi"],
         "targetQty": 10, "targetType": tt.ITEM_QUANTITY},
        {"_id": "TGT-REV", "name": "Omzet", "productIds": [], "productNames": [],
         "targetQty": None, "targetType": tt.REVENUE_AMOUNT, "targetAmount": 100000,
         "periodType": tt.PERIOD_SHIFT},
    ]
    logs = [{"productId": "PRD-1", "qty": 4, "shiftId": "WSHIFT-1", "timestamp": "2026-01-01T09:00:00+08:00"}]
    transactions = [{"total": 50000, "shiftId": "WSHIFT-1", "date": "2026-01-01T10:00:00+08:00"}]
    patch_db(fake_db(logs, transactions, sales_targets))

    items = {i["targetId"]: i for i in asyncio.run(targets.progress_for(SHIFT))["items"]}

    assert items["TGT-ITEM"]["achieved"] == 4
    assert items["TGT-ITEM"]["pct"] == pytest.approx(40.0)
    assert items["TGT-REV"]["achieved"] == pytest.approx(50000)
    assert items["TGT-REV"]["pct"] == pytest.approx(50.0)


# --------------------------------------------------------------------------
# Target berbasis waktu
# --------------------------------------------------------------------------


def test_time_bounded_uses_period_window(monkeypatch, patch_db):
    monkeypatch.setattr(targets, "now_local", lambda: tt._as_local("2026-01-02T12:00:00+08:00"))
    sales_targets = [{
        "_id": "TGT-TIME", "name": "Omzet Malam", "productIds": [], "productNames": [],
        "targetQty": None, "targetType": tt.TIME_BOUNDED, "targetAmount": 500000,
        "metric": tt.METRIC_REVENUE, "periodType": tt.PERIOD_DAILY,
        "startTime": "22:00", "endTime": "02:00",
    }]
    transactions = [
        # 2026-01-02 01:00 WITA (masih dalam jendela malam 1 Jan) → masuk
        {"total": 100000, "waiterId": "USR-W1", "date": "2026-01-02T01:00:00+08:00"},
        # 2026-01-02 23:00 WITA → masuk
        {"total": 150000, "waiterId": "USR-W1", "date": "2026-01-02T23:00:00+08:00"},
        # 2026-01-02 12:00 WITA → di luar jam operasional
        {"total": 900000, "waiterId": "USR-W1", "date": "2026-01-02T12:00:00+08:00"},
        # hari lain → di luar periode harian
        {"total": 700000, "waiterId": "USR-W1", "date": "2026-01-05T23:00:00+08:00"},
    ]
    patch_db(fake_db([], transactions, sales_targets))

    item = asyncio.run(targets.progress_for(SHIFT))["items"][0]

    assert item["achieved"] == pytest.approx(250000)
    assert item["pct"] == pytest.approx(50.0)
    assert item["periodType"] == tt.PERIOD_DAILY


def test_time_bounded_item_metric_reads_logs_not_transactions(monkeypatch, patch_db):
    monkeypatch.setattr(targets, "now_local", lambda: tt._as_local("2026-01-02T12:00:00+08:00"))
    sales_targets = [{
        "_id": "TGT-TIME-ITEM", "name": "Kopi Malam", "productIds": ["PRD-1"],
        "productNames": ["Kopi"], "targetQty": 20,
        "targetType": tt.TIME_BOUNDED, "metric": tt.METRIC_ITEM,
        "periodType": tt.PERIOD_DAILY, "startTime": "18:00", "endTime": "23:00",
    }]
    logs = [
        {"productId": "PRD-1", "qty": 6, "waiterId": "USR-W1", "timestamp": "2026-01-02T19:00:00+08:00"},
        {"productId": "PRD-1", "qty": 4, "waiterId": "USR-W1", "timestamp": "2026-01-02T22:30:00+08:00"},
        {"productId": "PRD-1", "qty": 99, "waiterId": "USR-W1", "timestamp": "2026-01-02T10:00:00+08:00"},
    ]
    db = patch_db(fake_db(logs, [], sales_targets))

    item = asyncio.run(targets.progress_for(SHIFT))["items"][0]

    assert item["achieved"] == 10
    assert item["pct"] == pytest.approx(50.0)
    assert item["unit"] == tt.UNIT_ITEM
    assert db.transactions.filters == []


# --------------------------------------------------------------------------
# Status laporan tutup shift
# --------------------------------------------------------------------------


def test_shift_report_status_handles_mixed_target_types():
    results = [
        {"achieved": 10, "targetQty": 10, "targetValue": 10},
        {"achieved": 500000, "targetQty": None, "targetValue": 400000},
    ]
    assert all(tt.is_achieved(r) for r in results) is True

    results[1]["achieved"] = 100000
    assert all(tt.is_achieved(r) for r in results) is False
