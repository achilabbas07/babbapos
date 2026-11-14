"""Uji Target Global Tim (kolektif) vs target kuantitas item per pelayan.

Aturan yang dikunci:

1. Target **omzet (Rupiah)** dan **berbasis waktu/periode** dihitung dari total
   akumulasi transaksi/order **seluruh tim** — bukan lagi per ``waiterId``.
2. Progres kolektif tersebut tetap dikirim ke **setiap** shift pelayan yang
   aktif sehingga semua pelayan dapat memantau total tim secara real-time.
3. Target **kuantitas item per shift** tetap atributif per pelayan
   (zero-regression untuk perbaikan atribusi lintas shift).
"""

import asyncio
from types import SimpleNamespace

import pytest

import target_types as tt
import targets

WAITER_A = ("USR-A", "Pelayan A")
WAITER_B = ("USR-B", "Pelayan B")
WAITER_C = ("USR-C", "Pelayan C")


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _length=None):
        return list(self.rows)


class FakeCollection:
    """Koleksi palsu yang mencatat filter agar cakupan kueri bisa diperiksa."""

    def __init__(self, rows=None):
        self.rows = list(rows or [])
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


def fake_db(order_logs=None, transactions=None, sales_targets=None, waiter_shifts=None):
    return SimpleNamespace(
        order_logs=FakeCollection(order_logs),
        transactions=FakeCollection(transactions),
        sales_targets=FakeCollection(sales_targets),
        waiter_shifts=FakeCollection(waiter_shifts),
        open_bills=FakeCollection([]),
        void_logs=FakeCollection([]),
    )


def shift(shift_id, waiter):
    return {"_id": shift_id, "userId": waiter[0], "userName": waiter[1],
            "openedAt": "2026-01-02T08:00:00+08:00", "status": "open"}


def revenue_target(target_id="TGT-REV", period=None, amount=1000000):
    return {
        "_id": target_id, "name": "Omzet Tim", "productIds": [], "productNames": [],
        "targetQty": None, "targetType": tt.REVENUE_AMOUNT, "targetAmount": amount,
        "periodType": period or tt.PERIOD_DAILY,
    }


def item_target(target_id="TGT-ITEM", waiter_id=None):
    return {
        "_id": target_id, "name": "Kopi", "productIds": ["PRD-1"], "productNames": ["Kopi"],
        "targetQty": 10, "targetType": tt.ITEM_QUANTITY, "waiterId": waiter_id,
    }


def freeze_now(monkeypatch, moment="2026-01-02T12:00:00+08:00"):
    monkeypatch.setattr(targets, "now_local", lambda: tt._as_local(moment))


@pytest.fixture
def patch_db(monkeypatch):
    def _apply(db):
        monkeypatch.setattr(targets, "db", db)
        return db

    return _apply


# --------------------------------------------------------------------------
# 1. Omzet bersifat kolektif (seluruh tim)
# --------------------------------------------------------------------------


def test_revenue_target_sums_transactions_of_the_whole_team(monkeypatch, patch_db):
    freeze_now(monkeypatch)
    transactions = [
        {"total": 100000, "waiterId": WAITER_A[0], "shiftId": "SHIFT-1", "date": "2026-01-02T09:00:00+08:00"},
        {"total": 200000, "waiterId": WAITER_B[0], "shiftId": "SHIFT-1", "date": "2026-01-02T10:00:00+08:00"},
        {"total": 300000, "waiterId": WAITER_C[0], "shiftId": "SHIFT-1", "date": "2026-01-02T11:00:00+08:00"},
        # Hari lain → di luar periode harian.
        {"total": 500000, "waiterId": WAITER_B[0], "shiftId": "SHIFT-9", "date": "2026-01-05T10:00:00+08:00"},
    ]
    db = patch_db(fake_db(transactions=transactions, sales_targets=[revenue_target()]))

    item = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"][0]

    assert item["achieved"] == pytest.approx(600000)
    assert item["pct"] == pytest.approx(60.0)
    assert item["scope"] == "team"
    # Kueri omzet tim tidak boleh dipersempit ke satu pelayan.
    assert "waiterId" not in db.transactions.filters[0]
    assert "date" in db.transactions.filters[0]


def test_revenue_target_is_not_reduced_to_the_active_waiter(monkeypatch, patch_db):
    """Omzet pelayan lain tetap masuk hitungan (bukan hanya milik pelayan aktif)."""
    freeze_now(monkeypatch)
    transactions = [
        {"total": 400000, "waiterId": WAITER_B[0], "shiftId": "SHIFT-1", "date": "2026-01-02T09:00:00+08:00"},
    ]
    patch_db(fake_db(transactions=transactions, sales_targets=[revenue_target()]))

    item = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"][0]

    assert item["achieved"] == pytest.approx(400000)


# --------------------------------------------------------------------------
# 2. Target berbasis waktu/periode juga kolektif
# --------------------------------------------------------------------------


def test_time_bounded_item_metric_is_collective(monkeypatch, patch_db):
    """Berbasis waktu dengan metrik item memakai total tim, bukan per pelayan."""
    freeze_now(monkeypatch)
    sales_targets = [{
        "_id": "TGT-WEEK", "name": "Kopi Mingguan", "productIds": ["PRD-1"],
        "productNames": ["Kopi"], "targetQty": 20,
        "targetType": tt.TIME_BOUNDED, "metric": tt.METRIC_ITEM,
        "periodType": tt.PERIOD_WEEKLY, "startTime": "00:00", "endTime": "23:59",
    }]
    logs = [
        {"productId": "PRD-1", "qty": 5, "waiterId": WAITER_A[0], "timestamp": "2026-01-02T09:00:00+08:00"},
        {"productId": "PRD-1", "qty": 7, "waiterId": WAITER_B[0], "timestamp": "2026-01-02T10:00:00+08:00"},
    ]
    db = patch_db(fake_db(order_logs=logs, sales_targets=sales_targets))

    item = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"][0]

    assert item["achieved"] == 12
    assert item["scope"] == "team"
    assert "waiterId" not in db.order_logs.filters[0]


def test_time_bounded_revenue_is_collective(monkeypatch, patch_db):
    freeze_now(monkeypatch)
    sales_targets = [{
        "_id": "TGT-MONTH", "name": "Omzet Bulanan", "productIds": [], "productNames": [],
        "targetQty": None, "targetType": tt.TIME_BOUNDED, "metric": tt.METRIC_REVENUE,
        "targetAmount": 5000000, "periodType": tt.PERIOD_MONTHLY,
    }]
    transactions = [
        {"total": 1200000, "waiterId": WAITER_A[0], "date": "2026-01-02T09:00:00+08:00"},
        {"total": 800000, "waiterId": WAITER_B[0], "date": "2026-01-03T09:00:00+08:00"},
    ]
    patch_db(fake_db(transactions=transactions, sales_targets=sales_targets))

    item = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"][0]

    assert item["achieved"] == pytest.approx(2000000)
    assert item["periodType"] == tt.PERIOD_MONTHLY
    assert item["scope"] == "team"


# --------------------------------------------------------------------------
# 3. Progres kolektif terkirim ke setiap shift pelayan aktif
# --------------------------------------------------------------------------


def test_collective_progress_is_visible_in_every_active_shift(monkeypatch, patch_db):
    freeze_now(monkeypatch)
    transactions = [
        {"total": 150000, "waiterId": WAITER_A[0], "date": "2026-01-02T09:00:00+08:00"},
        {"total": 250000, "waiterId": WAITER_B[0], "date": "2026-01-02T10:00:00+08:00"},
    ]
    patch_db(fake_db(transactions=transactions, sales_targets=[revenue_target()]))

    items_a = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"]
    items_b = asyncio.run(targets.progress_for(shift("WSHIFT-2", WAITER_B)))["items"]

    assert len(items_a) == 1 and len(items_b) == 1
    # Angka progres tim identik di kedua shift yang aktif (real-time).
    assert items_a[0]["achieved"] == items_b[0]["achieved"] == pytest.approx(400000)


def test_shift_period_revenue_does_not_filter_by_waiter_shift_id(monkeypatch, patch_db):
    """Periode ``shift`` tidak boleh memakai ``shiftId`` untuk transaksi.

    ``transactions.shiftId`` menunjuk shift **kasir** (FK ke ``shifts``),
    sedangkan ``progress_for`` menerima shift **pelayan** (``WSHIFT-*``), jadi
    filter tersebut tidak akan pernah cocok. Omzet periode shift dihitung dari
    seluruh transaksi tim pada tanggal kalender WITA hari ini.
    """
    freeze_now(monkeypatch)
    db = patch_db(fake_db(
        transactions=[
            {"total": 120000, "shiftId": "SHIFT-20260102-001", "waiterId": WAITER_A[0],
             "date": "2026-01-02T09:00:00+08:00"},
            {"total": 80000, "shiftId": "SHIFT-20260102-001", "waiterId": WAITER_B[0],
             "date": "2026-01-02T11:00:00+08:00"},
            {"total": 999999, "shiftId": "SHIFT-20260102-001", "waiterId": WAITER_A[0],
             "date": "2026-01-03T09:00:00+08:00"},  # hari berikutnya, harus diabaikan
        ],
        sales_targets=[revenue_target(period=tt.PERIOD_SHIFT)],
    ))

    items = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"]

    assert items[0]["achieved"] == pytest.approx(200000)
    assert items[0]["scope"] == "team"
    flt = db.transactions.filters[0]
    assert "shiftId" not in flt
    assert "waiterId" not in flt
    assert "date" in flt


# --------------------------------------------------------------------------
# 4. Zero-regression: target kuantitas item tetap per pelayan
# --------------------------------------------------------------------------


def test_legacy_item_target_keeps_shift_scope_and_is_not_collective(monkeypatch, patch_db):
    """Target item lama (periode shift) tetap memakai shiftId dan bukan kolektif."""
    freeze_now(monkeypatch)
    sales_targets = [item_target()]
    logs = [
        {"productId": "PRD-1", "qty": 5, "shiftId": "WSHIFT-1", "waiterId": WAITER_A[0],
         "timestamp": "2026-01-02T09:00:00+08:00"},
        {"productId": "PRD-1", "qty": 99, "shiftId": "WSHIFT-2", "waiterId": WAITER_B[0],
         "timestamp": "2026-01-02T10:00:00+08:00"},
    ]
    db = patch_db(fake_db(order_logs=logs, sales_targets=sales_targets))

    items = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"]

    assert items[0]["achieved"] == 5
    assert items[0]["scope"] == "waiter"
    # Perilaku lama: kueri item memakai shiftId, bukan rentang tanggal.
    assert db.order_logs.filters[0] == {"shiftId": "WSHIFT-1", "productId": {"$in": ["PRD-1"]}}
    assert "date" not in db.order_logs.filters[0]


def test_item_target_with_calendar_period_stays_scoped_to_its_waiter(monkeypatch, patch_db):
    """Target item berperiode kalender tetap per pelayan (bukan kolektif)."""
    freeze_now(monkeypatch)
    sales_targets = [item_target(), item_target(target_id="TGT-ITEM-B", waiter_id=WAITER_B[0])]
    sales_targets[0]["periodType"] = tt.PERIOD_DAILY
    logs = [
        {"productId": "PRD-1", "qty": 5, "waiterId": WAITER_A[0], "timestamp": "2026-01-02T09:00:00+08:00"},
        {"productId": "PRD-1", "qty": 99, "waiterId": WAITER_B[0], "timestamp": "2026-01-02T10:00:00+08:00"},
    ]
    db = patch_db(fake_db(order_logs=logs, sales_targets=sales_targets))

    items = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"]

    # Target khusus Pelayan B tidak muncul di kartu Pelayan A, dan hanya log
    # Pelayan A yang dihitung untuk target miliknya.
    assert [i["targetId"] for i in items] == ["TGT-ITEM"]
    assert items[0]["achieved"] == 5
    assert items[0]["scope"] == "waiter"
    assert db.order_logs.filters[0]["waiterId"] == WAITER_A[0]
    assert "timestamp" in db.order_logs.filters[0]


def test_item_target_belonging_to_another_waiter_is_hidden(monkeypatch, patch_db):
    freeze_now(monkeypatch)
    sales_targets = [item_target(target_id="TGT-ITEM-B", waiter_id=WAITER_B[0])]
    patch_db(fake_db(sales_targets=sales_targets))

    items = asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"]

    assert items == []


def test_collective_and_waiter_targets_coexist(monkeypatch, patch_db):
    freeze_now(monkeypatch)
    sales_targets = [item_target(), revenue_target()]
    sales_targets[0]["periodType"] = tt.PERIOD_DAILY
    logs = [
        {"productId": "PRD-1", "qty": 4, "waiterId": WAITER_A[0], "timestamp": "2026-01-02T09:00:00+08:00"},
        {"productId": "PRD-1", "qty": 6, "waiterId": WAITER_B[0], "timestamp": "2026-01-02T09:30:00+08:00"},
    ]
    transactions = [
        {"total": 500000, "waiterId": WAITER_A[0], "date": "2026-01-02T10:00:00+08:00"},
        {"total": 500000, "waiterId": WAITER_B[0], "date": "2026-01-02T10:30:00+08:00"},
    ]
    patch_db(fake_db(order_logs=logs, transactions=transactions, sales_targets=sales_targets))

    items = {i["targetId"]: i for i in asyncio.run(targets.progress_for(shift("WSHIFT-1", WAITER_A)))["items"]}

    assert items["TGT-ITEM"]["achieved"] == 4        # hanya milik Pelayan A
    assert items["TGT-ITEM"]["scope"] == "waiter"
    assert items["TGT-REV"]["achieved"] == pytest.approx(1000000)  # seluruh tim
    assert items["TGT-REV"]["scope"] == "team"


# --------------------------------------------------------------------------
# 5. Aturan penetapan cakupan
# --------------------------------------------------------------------------


@pytest.mark.parametrize("target,expected", [
    ({"targetType": tt.ITEM_QUANTITY}, False),
    ({"targetType": tt.REVENUE_AMOUNT}, True),
    ({"targetType": tt.TIME_BOUNDED, "metric": tt.METRIC_REVENUE}, True),
    ({"targetType": tt.TIME_BOUNDED, "metric": tt.METRIC_ITEM}, True),
    ({}, False),                       # data lama tanpa targetType = item_quantity
    ({"targetType": "tidak_dikenal"}, False),
])
def test_is_collective_rules(target, expected):
    assert tt.is_collective(target) is expected
