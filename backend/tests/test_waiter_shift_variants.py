import asyncio
from types import SimpleNamespace

import targets
from targets import _qty_map


def test_sold_item_quantity_is_grouped_by_product_and_variant_id():
    grouped = _qty_map([
        {
            "productId": "PRD-001",
            "productName": "Kopi",
            "variantId": 10,
            "variantName": "Panas",
            "qty": 2,
        },
        {
            "productId": "PRD-001",
            "productName": "Kopi",
            "variantId": 10,
            "variantName": "Panas",
            "qty": 3,
        },
        {
            "productId": "PRD-001",
            "productName": "Kopi",
            "variantId": 11,
            "variantName": "Dingin",
            "qty": 1,
        },
        {
            "productId": "PRD-002",
            "productName": "Teh",
            "variantId": None,
            "variantName": "",
            "qty": 4,
        },
    ])

    assert len(grouped) == 3
    assert grouped[("PRD-001", ("id", "10"))] == [5, "Kopi", "Panas", 10]
    assert grouped[("PRD-001", ("id", "11"))] == [1, "Kopi", "Dingin", 11]
    assert grouped[("PRD-002", ("name", ""))] == [4, "Teh", "", None]


def test_open_bill_update_logs_delta_to_requesting_waiters_active_shift(monkeypatch):
    inserted_logs = []
    active_shift_id = "WSHIFT-CURRENT"

    class ShiftCursor:
        def sort(self, _field, _direction):
            return self

        async def to_list(self, limit):
            assert limit == 1
            return [{"_id": active_shift_id}]

    class WaiterShifts:
        def find(self, query):
            assert query == {"userId": "WAITER-REQUESTER", "status": "open"}
            return ShiftCursor()

    class OrderLogs:
        async def insert_many(self, docs, connection=None):
            inserted_logs.extend(docs)

    monkeypatch.setattr(
        targets,
        "db",
        SimpleNamespace(waiter_shifts=WaiterShifts(), order_logs=OrderLogs()),
    )

    item = {"productId": "PRD-001", "productName": "Kopi", "qty": 1}
    asyncio.run(
        targets.log_order_diff(
            [item],
            ("WAITER-ORDER-OWNER", "Owner"),
            [{**item, "qty": 2}],
            ("WAITER-ORDER-OWNER", "Owner"),
            "bill_update",
            "BILL-001",
            actor_waiter=("WAITER-REQUESTER", "Requester"),
        )
    )

    assert len(inserted_logs) == 1
    assert inserted_logs[0]["qty"] == 1
    assert inserted_logs[0]["waiterId"] == "WAITER-REQUESTER"
    assert inserted_logs[0]["shiftId"] == active_shift_id
