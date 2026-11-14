"""Regresi atribusi pelayan per batch order ("tambah order" setelah over shift).

Bug yang dikunci oleh tes ini:
- Pesanan batch pertama dibuat oleh Pelayan 1.
- Kasir melakukan "tambah order" lalu mengganti pelayan menjadi Pelayan 2.
- Sebelum perbaikan, SELURUH item pada bill ikut berpindah nama menjadi
  Pelayan 2 karena `update_open_bill` menimpa dokumen bill secara utuh.

Perbaikan menyimpan pelayan pada level baris item (`items_json`) sehingga item
lama tetap milik Pelayan 1 dan hanya baris baru yang menjadi milik Pelayan 2.
Perhitungan target sales pelayan (`targets.log_order_diff`) TIDAK diubah.
"""

import asyncio
from types import SimpleNamespace

import pytest

import server
from server import (
    OpenBillIn,
    OrderItemIn,
    _item_owner,
    _stamp_item_waiter,
    item_waiter_summary,
    preserve_item_waiters,
)

WAITER_1 = ("W-1", "Pelayan Satu")
WAITER_2 = ("W-2", "Pelayan Dua")


# ---------- helper level item ----------


def test_stamp_sets_waiter_on_items_without_owner():
    items = [OrderItemIn(productId="PRD-1", qty=1), OrderItemIn(productId="PRD-2", qty=2)]

    stamped = _stamp_item_waiter(items, WAITER_1)

    assert [(i.waiterId, i.waiterName) for i in stamped] == [WAITER_1, WAITER_1]
    # Model asli tidak dimutasi.
    assert items[0].waiterId is None


def test_stamp_does_not_overwrite_existing_item_owner():
    items = [OrderItemIn(productId="PRD-1", qty=1, waiterId="W-9", waiterName="Pelayan Lama")]

    stamped = _stamp_item_waiter(items, WAITER_2)

    assert (stamped[0].waiterId, stamped[0].waiterName) == ("W-9", "Pelayan Lama")


def test_stamp_is_noop_when_no_waiter_selected():
    items = [OrderItemIn(productId="PRD-1", qty=1)]

    stamped = _stamp_item_waiter(items, (None, ""))

    assert stamped[0].waiterId is None
    assert stamped[0].waiterName == ""


# ---------- preservasi pelayan saat tambah order ----------


def test_existing_items_keep_original_waiter_when_waiter_changes():
    old_items = [
        {"id": "item-1", "productId": "PRD-1", "qty": 1,
         "waiterId": "W-1", "waiterName": "Pelayan Satu"},
    ]
    # `compose_bill` sudah menstamp semua baris dengan pelayan baru (Pelayan 2).
    new_items = [
        {"id": "item-1", "productId": "PRD-1", "qty": 1,
         "waiterId": "W-2", "waiterName": "Pelayan Dua"},
    ]

    preserve_item_waiters(new_items, old_items, WAITER_2)

    assert (new_items[0]["waiterId"], new_items[0]["waiterName"]) == WAITER_1


def test_only_new_items_receive_the_newly_selected_waiter():
    old_items = [
        {"id": "item-1", "productId": "PRD-1", "qty": 1,
         "waiterId": "W-1", "waiterName": "Pelayan Satu"},
    ]
    new_items = [
        {"id": "item-1", "productId": "PRD-1", "qty": 1,
         "waiterId": "W-2", "waiterName": "Pelayan Dua"},
        {"id": "item-2", "productId": "PRD-2", "qty": 2,
         "waiterId": "W-2", "waiterName": "Pelayan Dua"},
    ]

    preserve_item_waiters(new_items, old_items, WAITER_2)

    assert (new_items[0]["waiterId"], new_items[0]["waiterName"]) == WAITER_1
    assert (new_items[1]["waiterId"], new_items[1]["waiterName"]) == WAITER_2


def test_legacy_items_without_item_waiter_fall_back_to_bill_waiter():
    old_items = [{"id": "item-1", "productId": "PRD-1", "qty": 1}]
    new_items = [{"id": "item-1", "productId": "PRD-1", "qty": 1,
                  "waiterId": "W-2", "waiterName": "Pelayan Dua"}]

    preserve_item_waiters(new_items, old_items, WAITER_1)

    assert (new_items[0]["waiterId"], new_items[0]["waiterName"]) == WAITER_1


def test_legacy_items_keep_current_selection_when_bill_has_no_waiter():
    # Bill lama tanpa pelayan sama sekali: jangan diosongkan.
    old_items = [{"id": "item-1", "productId": "PRD-1", "qty": 1}]
    new_items = [{"id": "item-1", "productId": "PRD-1", "qty": 1,
                  "waiterId": "W-2", "waiterName": "Pelayan Dua"}]

    preserve_item_waiters(new_items, old_items, (None, ""))

    assert (new_items[0]["waiterId"], new_items[0]["waiterName"]) == WAITER_2


def test_legacy_items_without_ids_are_matched_by_product_and_variant():
    old_items = [{"productId": "PRD-1", "variantId": 5, "qty": 2,
                  "waiterId": "W-1", "waiterName": "Pelayan Satu"}]
    new_items = [{"productId": "PRD-1", "variantId": 5, "qty": 2,
                  "waiterId": "W-2", "waiterName": "Pelayan Dua"}]

    preserve_item_waiters(new_items, old_items, WAITER_2)

    assert (new_items[0]["waiterId"], new_items[0]["waiterName"]) == WAITER_1


# ---------- ringkasan tampilan ----------


def test_item_owner_falls_back_to_bill_level_waiter():
    assert _item_owner({"waiterId": "W-1", "waiterName": "A"}, WAITER_2) == ("W-1", "A")
    assert _item_owner({}, WAITER_2) == WAITER_2


def test_item_waiter_summary_lists_each_distinct_waiter_once():
    items = [
        {"waiterName": "Pelayan Satu"},
        {"waiterName": "Pelayan Satu"},
        {"waiterName": "Pelayan Dua"},
    ]

    assert item_waiter_summary(items, WAITER_1) == "Pelayan Satu / Pelayan Dua"
    assert item_waiter_summary([], WAITER_1) == "Pelayan Satu"


# ---------- compose_bill menyimpan pelayan per item ----------


def test_compose_bill_stamps_every_item_with_the_batch_waiter(monkeypatch):
    recorded = []

    async def fake_get_or_404(*_args, **_kwargs):
        return None

    async def fake_resolve_waiter(_waiter_id, _fallback_name, _user):
        return WAITER_2

    async def fake_build_items(items, _order_type, ojol_markup=None):
        recorded.extend(items)
        return [{"productId": i.productId, "productName": "Nama", "qty": i.qty} for i in items], 0

    monkeypatch.setattr(server, "get_or_404", fake_get_or_404)
    monkeypatch.setattr(server, "resolve_waiter", fake_resolve_waiter)
    monkeypatch.setattr(server, "build_items", fake_build_items)

    body = OpenBillIn(type="Dine In", waiterId="W-2", items=[
        OrderItemIn(productId="PRD-1", qty=1),
        OrderItemIn(productId="PRD-2", qty=2),
    ])
    user = SimpleNamespace(id="USR-1", name="Kasir", role="kasir")

    asyncio.run(server.compose_bill(body, user, "BILL-1", "2026-01-01T00:00:00+08:00"))

    assert [(i.waiterId, i.waiterName) for i in recorded] == [WAITER_2, WAITER_2]


def test_build_items_keeps_item_level_waiter_in_payload(monkeypatch):
    """`build_items` menyalin atribusi pelayan per baris ke items_json."""

    class ProductCursor:
        def __init__(self, rows):
            self._rows = rows

        def __aiter__(self):
            self._iter = iter(self._rows)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration

    class Products:
        def find(self, _query):
            return ProductCursor([{
                "_id": "PRD-1", "name": "Kopi", "price": 10000, "hpp": 4000,
                "price_ojol": 0, "category": "Minuman", "is_active": True,
            }])

    monkeypatch.setattr(server, "db", SimpleNamespace(products=Products()))

    async def no_variants(_vids):
        return {}

    async def no_hpp(_vids):
        return {}

    monkeypatch.setattr(server, "load_variants", no_variants)
    monkeypatch.setattr(server, "variant_hpp", no_hpp)

    items = [OrderItemIn(productId="PRD-1", qty=1, waiterId="W-1", waiterName="Pelayan Satu")]

    out, _total = asyncio.run(server.build_items(items, "Dine In", ojol_markup=0))

    assert out[0]["waiterId"] == "W-1"
    assert out[0]["waiterName"] == "Pelayan Satu"


def test_build_items_signature_still_accepts_two_positional_arguments(monkeypatch):
    """Kompatibilitas: pemanggil lama memakai `(items, order_type)` saja."""
    calls = {}

    async def fake_load_markup():
        calls["markup"] = True
        return 0.0

    class ProductCursor:
        def __init__(self, rows):
            self._rows = rows

        def __aiter__(self):
            self._iter = iter(self._rows)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration

    class Products:
        def find(self, _query):
            return ProductCursor([{
                "_id": "PRD-1", "name": "Kopi", "price": 10000, "hpp": 4000,
                "price_ojol": 0, "category": "Minuman", "is_active": True,
            }])

    monkeypatch.setattr(server, "db", SimpleNamespace(products=Products()))
    monkeypatch.setattr(server, "load_ojol_markup_percent", fake_load_markup)

    async def no_variants(_vids):
        return {}

    async def no_hpp(_vids):
        return {}

    monkeypatch.setattr(server, "load_variants", no_variants)
    monkeypatch.setattr(server, "variant_hpp", no_hpp)

    out, total = asyncio.run(server.build_items([OrderItemIn(productId="PRD-1", qty=1)], "Dine In"))

    assert total == 10000
    assert out[0]["waiterId"] is None


# ---------- mirror parity ----------


def test_vercel_mirror_has_item_level_waiter_attribution():
    from pathlib import Path

    mirror = (Path(__file__).resolve().parents[2] / "api" / "index.py").read_text(encoding="utf-8")

    assert "def preserve_item_waiters(" in mirror
    assert "def _stamp_item_waiter(" in mirror
    assert '"waiterId": i.waiterId' in mirror
    assert 'preserve_item_waiters(bill.items_json, old.items_json' in mirror


def test_log_order_diff_still_credits_old_waiter_when_bill_waiter_changes(monkeypatch):
    """Constraint: kredit target sales pelayan lama TIDAK berubah."""
    import targets

    inserts = []

    class ShiftCursor:
        def sort(self, _field, _direction):
            return self

        async def to_list(self, _limit):
            return [{"_id": "SHIFT-X"}]

    class WaiterShifts:
        def find(self, _query):
            return ShiftCursor()

    class OrderLogs:
        async def insert_many(self, docs, connection=None):
            inserts.extend(docs)

    monkeypatch.setattr(
        targets,
        "db",
        SimpleNamespace(waiter_shifts=WaiterShifts(), order_logs=OrderLogs()),
    )

    old_item = {"productId": "PRD-1", "productName": "Kopi", "qty": 1}
    asyncio.run(targets.log_order_diff(
        [old_item], WAITER_1,
        [old_item], WAITER_2,
        "bill_update", "BILL-1",
    ))

    credited = {(row["waiterId"], row["qty"]) for row in inserts}
    assert ("W-1", -1) in credited
    assert ("W-2", 1) in credited
