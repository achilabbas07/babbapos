"""Regresi atribusi target item lintas shift (bug "kuantitas bergeser").

Bug yang dikunci:
- Shift 1: Pelayan A mencatat 5 item pada sebuah meja.
- Shift 2: pelayan bill diganti ke Pelayan B, atau Pelayan B menambah 2 item
  pada meja yang sama.
- Sebelum perbaikan, ``log_order_diff`` menulis ``-old`` ke pelayan lama lalu
  menulis **seluruh** item baru ke pelayan baru, sehingga 5 item historis
  ikut berpindah ke pelayan/shift aktif dan target Pelayan B terlihat
  tercapai padahal kontribusinya hanya 2.

Perbaikan: atribusi dihitung per **pemilik baris item** (``items_json``),
kuantitas yang sudah tercatat tidak pernah berpindah tangan, dan hanya
pertambahan yang dikreditkan ke pencatat.
"""

import asyncio
from types import SimpleNamespace

import pytest

import target_types as tt
import targets

WAITER_A = ("USR-A", "Pelayan A")
WAITER_B = ("USR-B", "Pelayan B")


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    def __aiter__(self):
        self._iter = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration

    async def to_list(self, _length=None):
        return list(self.rows)


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def find(self, flt=None, projection=None):
        return FakeCursor(self._matching(flt))

    async def find_one(self, flt=None, projection=None):
        rows = self._matching(flt)
        return rows[0] if rows else None

    async def count_documents(self, flt=None):
        return len(self._matching(flt))

    async def insert_many(self, docs, connection=None):
        self.rows.extend(dict(d) for d in docs)

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
            return True
        return value == cond


class FakeDb:
    """Database palsu minimal: order_logs, waiter_shifts, sales_targets, dll."""

    def __init__(self, shifts, logs=None, targets=None):
        self.waiter_shifts = FakeCollection(shifts)
        self.order_logs = FakeCollection(logs or [])
        self.sales_targets = FakeCollection(targets or [])
        self.transactions = FakeCollection([])
        self.open_bills = FakeCollection([])
        self.void_logs = FakeCollection([])


def shift(shift_id, user_id, user_name):
    return {
        "_id": shift_id, "userId": user_id, "userName": user_name,
        "openedAt": "2026-01-01T08:00:00+08:00", "status": "open",
    }


def item(product_id="PRD-1", qty=1, waiter=WAITER_A, item_id=None):
    return {
        "id": item_id or f"item-{product_id}",
        "productId": product_id,
        "productName": "Kopi",
        "qty": qty,
        "variantId": None,
        "variantName": "",
        "waiterId": waiter[0],
        "waiterName": waiter[1],
    }


def _logs_for(logs, waiter_id):
    return sum(log["qty"] for log in logs if log["waiterId"] == waiter_id)


# --------------------------------------------------------------------------
# 1. Tambah order di shift berikutnya tidak memindahkan riwayat
# --------------------------------------------------------------------------


def test_add_order_in_later_shift_does_not_move_history(monkeypatch):
    """Shift 1 (A: 5 item) + shift 2 (B menambah 2) → B hanya mendapat 2."""
    db = FakeDb([shift("WSHIFT-2", WAITER_B[0], WAITER_B[1])])
    monkeypatch.setattr(targets, "db", db)

    old_items = [item(qty=5, waiter=WAITER_A)]
    new_items = [
        item(qty=5, waiter=WAITER_A),      # baris lama, tetap milik A
        item(product_id="PRD-2", qty=2, waiter=WAITER_B, item_id="item-PRD-2"),
    ]

    asyncio.run(targets.log_order_diff(
        old_items, WAITER_A,
        new_items, WAITER_B,
        "bill_update", "BILL-1",
    ))

    assert _logs_for(db.order_logs.rows, WAITER_A[0]) == 0
    assert _logs_for(db.order_logs.rows, WAITER_B[0]) == 2
    # Tidak ada log negatif: riwayat A di shift 1 tidak dibatalkan.
    assert all(log["qty"] > 0 for log in db.order_logs.rows)


def test_waiter_change_on_bill_keeps_historical_qty_with_original_owner(monkeypatch):
    """Ganti pelayan bill: baris lama tetap milik A, hanya baris baru milik B."""
    db = FakeDb([shift("WSHIFT-2", WAITER_B[0], WAITER_B[1])])
    monkeypatch.setattr(targets, "db", db)

    old_items = [item(qty=5, waiter=WAITER_A)]
    new_items = [
        item(qty=5, waiter=WAITER_A),                      # sudah ada, milik A
        item(product_id="PRD-2", qty=3, waiter=WAITER_B, item_id="item-baru"),
    ]

    asyncio.run(targets.log_order_diff(
        old_items, WAITER_A,
        new_items, WAITER_B,
        "bill_update", "BILL-1",
    ))

    assert _logs_for(db.order_logs.rows, WAITER_A[0]) == 0
    assert _logs_for(db.order_logs.rows, WAITER_B[0]) == 3
    assert [log["shiftId"] for log in db.order_logs.rows] == ["WSHIFT-2"]


def test_reduction_debits_only_the_original_owner(monkeypatch):
    """Mengurangi item yang dicatat A harus mendebit A, bukan pelayan aktif."""
    db = FakeDb([shift("WSHIFT-2", WAITER_B[0], WAITER_B[1])])
    monkeypatch.setattr(targets, "db", db)

    old_items = [item(qty=5, waiter=WAITER_A)]
    new_items = [item(qty=3, waiter=WAITER_A)]

    asyncio.run(targets.log_order_diff(
        old_items, WAITER_A,
        new_items, WAITER_B,
        "bill_update", "BILL-1",
        actor_waiter=WAITER_B,
    ))

    assert _logs_for(db.order_logs.rows, WAITER_A[0]) == -2
    assert _logs_for(db.order_logs.rows, WAITER_B[0]) == 0


def test_same_waiter_addition_is_credited_to_that_waiter(monkeypatch):
    db = FakeDb([shift("WSHIFT-1", WAITER_A[0], WAITER_A[1])])
    monkeypatch.setattr(targets, "db", db)

    old_items = [item(qty=1)]
    new_items = [item(qty=4)]

    asyncio.run(targets.log_order_diff(old_items, WAITER_A, new_items, WAITER_A,
                                       "bill_update", "BILL-1"))

    assert _logs_for(db.order_logs.rows, WAITER_A[0]) == 3
    assert len(db.order_logs.rows) == 1


def test_no_change_writes_no_log(monkeypatch):
    db = FakeDb([shift("WSHIFT-1", WAITER_A[0], WAITER_A[1])])
    monkeypatch.setattr(targets, "db", db)

    items = [item(qty=2)]
    asyncio.run(targets.log_order_diff(items, WAITER_A, items, WAITER_A,
                                       "bill_update", "BILL-1"))

    assert db.order_logs.rows == []


def test_variant_rows_keep_their_owner(monkeypatch):
    db = FakeDb([shift("WSHIFT-2", WAITER_B[0], WAITER_B[1])])
    monkeypatch.setattr(targets, "db", db)

    old_items = [
        {"productId": "PRD-1", "productName": "Kopi", "qty": 2, "variantId": 10,
         "variantName": "Panas", "waiterId": WAITER_A[0], "waiterName": WAITER_A[1]},
    ]
    new_items = [
        old_items[0],
        {"productId": "PRD-1", "productName": "Kopi", "qty": 1, "variantId": 11,
         "variantName": "Dingin", "waiterId": WAITER_B[0], "waiterName": WAITER_B[1]},
    ]

    asyncio.run(targets.log_order_diff(old_items, WAITER_A, new_items, WAITER_B,
                                       "bill_update", "BILL-1"))

    rows = db.order_logs.rows
    assert [(r["waiterId"], r["variantId"], r["qty"]) for r in rows] == [
        (WAITER_B[0], 11, 1),
    ]


# --------------------------------------------------------------------------
# 2. Perubahan data pelayan (nama) tidak menggeser riwayat
# --------------------------------------------------------------------------


def test_renaming_a_waiter_does_not_move_shift_quantity(monkeypatch):
    """Nama pelayan berubah di tabel users → kuantitas shift tetap sama."""
    targets_rows = [{
        "_id": "TGT-1", "name": "Kopi", "productIds": ["PRD-1"], "productNames": ["Kopi"],
        "targetQty": 10, "waiterId": WAITER_A[0],
    }]
    logs = [{
        "productId": "PRD-1", "qty": 5, "shiftId": "WSHIFT-1",
        "waiterId": WAITER_A[0], "waiterName": "Pelayan A",
        "timestamp": "2026-01-01T09:00:00+08:00",
    }]
    db = FakeDb([shift("WSHIFT-1", WAITER_A[0], "Pelayan A (baru)")], logs, targets_rows)
    monkeypatch.setattr(targets, "db", db)

    progress = asyncio.run(targets.progress_for(db.waiter_shifts.rows[0]))

    assert progress["items"][0]["achieved"] == 5
    assert progress["waiterName"] == "Pelayan A (baru)"


def test_cross_shift_progress_is_not_polluted_by_later_shift(monkeypatch):
    """Progres shift 1 tetap 5 walau shift 2 menambah 2 item di meja yang sama."""
    targets_rows = [{
        "_id": "TGT-1", "name": "Kopi", "productIds": ["PRD-1", "PRD-2"],
        "productNames": ["Kopi", "Teh"], "targetQty": 10, "waiterId": WAITER_A[0],
    }]
    logs = [{
        "productId": "PRD-1", "qty": 5, "shiftId": "WSHIFT-1",
        "waiterId": WAITER_A[0], "waiterName": WAITER_A[1],
        "timestamp": "2026-01-01T09:00:00+08:00",
    }]
    db = FakeDb([shift("WSHIFT-1", WAITER_A[0], WAITER_A[1])], logs, targets_rows)
    monkeypatch.setattr(targets, "db", db)

    # Tambah order oleh pelayan lain di shift berikutnya.
    newer = FakeDb(
        [shift("WSHIFT-1", WAITER_A[0], WAITER_A[1]), shift("WSHIFT-2", WAITER_B[0], WAITER_B[1])],
        db.order_logs.rows,
        targets_rows,
    )
    newer.order_logs = db.order_logs
    monkeypatch.setattr(targets, "db", newer)
    asyncio.run(targets.log_order_diff(
        [item(qty=5, waiter=WAITER_A)],
        WAITER_A,
        [item(qty=5, waiter=WAITER_A),
         item(product_id="PRD-2", qty=2, waiter=WAITER_B, item_id="item-PRD-2")],
        WAITER_B,
        "bill_update", "BILL-1",
    ))

    shift1_progress = asyncio.run(targets.progress_for(newer.waiter_shifts.rows[0]))
    assert shift1_progress["items"][0]["achieved"] == 5

    # Dan log baru tidak masuk ke shift 1.
    shift1_logs = [l for l in newer.order_logs.rows if l["shiftId"] == "WSHIFT-1"]
    assert len(shift1_logs) == 1


# --------------------------------------------------------------------------
# 3. Evaluator kuantitas item tidak berubah (zero-regression)
# --------------------------------------------------------------------------


def test_item_quantity_evaluator_formula_is_untouched():
    target = {"_id": "TGT-1", "name": "Kopi", "productIds": ["PRD-1"],
              "productNames": ["Kopi"], "targetQty": 8,
              "targetType": tt.ITEM_QUANTITY}
    logs = [
        {"productId": "PRD-1", "productName": "Kopi", "qty": 3},
        {"productId": "PRD-1", "productName": "Kopi", "qty": 1},
    ]
    result = tt.evaluate_item_quantity(target, tt.TargetData(logs=logs))

    assert result["achieved"] == 4
    assert result["targetQty"] == 8
    assert result["pct"] == pytest.approx(50.0)
    assert result["breakdown"] == [{"productId": "PRD-1", "productName": "Kopi", "qty": 4}]


def test_zero_quantity_deltas_are_skipped(monkeypatch):
    """Baris dengan selisih 0 tidak menghasilkan log (menghindari noise)."""
    db = FakeDb([shift("WSHIFT-1", WAITER_A[0], WAITER_A[1])])
    monkeypatch.setattr(targets, "db", db)

    asyncio.run(targets.log_order_diff(
        [item(qty=2), item(product_id="PRD-2", qty=1, item_id="i2")], WAITER_A,
        [item(qty=2), item(product_id="PRD-2", qty=1, item_id="i2")], WAITER_A,
        "bill_update", "BILL-1",
    ))

    assert db.order_logs.rows == []
