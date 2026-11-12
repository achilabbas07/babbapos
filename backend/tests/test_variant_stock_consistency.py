"""Regresi: angka "Sisa" pada modal pilihan variasi harus berasal dari baris
`inventory` yang sama dengan halaman Inventaris.

Bug yang dicegah:
* Varian "Fanta (Klng)" menampilkan "Sisa 3" (stok Sprite INV-016) padahal
  halaman Inventaris menampilkan Fanta (INV-017) dengan stok 15.
* Ambang peringatan modal memakai angka tetap (`<= 5`) sementara halaman
  Inventaris memakai `stock <= min_stock`.
* Pembagian memakai `//` pada float sehingga sisa porsi terpotong tanpa
  hubungan dengan nilai stok bahan yang ditampilkan.
"""

import asyncio
import inspect

import pytest

from variants import variant_availability


MATERIALS = {
    "INV-017": {"stock": 15.0, "min_stock": 5.0, "unit": "btl"},
    "INV-016": {"stock": 3.0, "min_stock": 5.0, "unit": "btl"},
    "INV-002": {"stock": 5405.0, "min_stock": 500.0, "unit": "gram"},
}


def test_available_matches_inventory_stock_for_single_unit_ingredient():
    """Sisa porsi = stok bahan mentah ketika pemakaian 1 satuan per porsi."""
    state = variant_availability([{"inventory_id": "INV-017", "qty_needed": 1}], MATERIALS)
    assert state["available"] == 15
    assert state["stock"] == 15.0
    assert state["min_stock"] == 5.0
    assert state["unit"] == "btl"
    assert state["low"] is False


def test_low_flag_follows_inventory_min_stock_rule():
    """`stock <= min_stock` -> sama dengan status "Menipis" di Inventaris."""
    state = variant_availability([{"inventory_id": "INV-016", "qty_needed": 1}], MATERIALS)
    assert state["available"] == 3
    assert state["low"] is True


def test_limiting_ingredient_wins_over_larger_stock():
    state = variant_availability(
        [
            {"inventory_id": "INV-002", "qty_needed": 51},
            {"inventory_id": "INV-017", "qty_needed": 1},
        ],
        MATERIALS,
    )
    assert state["inventory_id"] == "INV-017"
    assert state["available"] == 15


def test_available_is_floor_of_fractional_portion_without_truncating_stock_report():
    state = variant_availability([{"inventory_id": "INV-002", "qty_needed": 49}], MATERIALS)
    assert state["available"] == 110
    # Nilai stok bahan tetap dilaporkan apa adanya agar sinkron dengan Inventaris.
    assert state["stock"] == 5405.0


def test_missing_material_does_not_produce_fake_zero_stock():
    """Bahan yang tidak ada di inventory tidak boleh membuat badge "Sisa 0"."""
    state = variant_availability([{"inventory_id": "INV-999", "qty_needed": 1}], MATERIALS)
    assert state is None


def test_variant_without_valid_ingredients_returns_none():
    assert variant_availability([], MATERIALS) is None
    assert variant_availability([{"inventory_id": "INV-017", "qty_needed": 0}], MATERIALS) is None


def test_list_menu_variants_reads_inventory_stock_min_stock_and_unit():
    """Endpoint modal harus membaca kolom yang sama dengan GET /api/inventory."""
    import variants

    source = inspect.getsource(variants.list_menu_variants)
    assert 'm.get("stock")' in source
    assert 'm.get("min_stock")' in source
    assert 'm.get("unit")' in source
    assert "variant_availability(" in source
    # Pembagian lama dengan floor division pada float tidak boleh kembali.
    assert "// float(" not in source


def test_inventory_endpoint_exposes_min_stock_used_by_low_stock_rule():
    """`min_stock` adalah sumber aturan "Menipis" di halaman Inventaris."""
    import server

    source = inspect.getsource(server.list_inventory)
    assert "InventoryItem.from_mongo" in source


def test_menu_variants_payload_shape(monkeypatch):
    """Payload harus memuat available/stock/min_stock/unit/low."""
    import variants

    class FakeCursor:
        def __init__(self, rows):
            self._rows = rows

        def sort(self, *args, **kwargs):
            return self

        async def to_list(self, limit):
            return list(self._rows)

        def __aiter__(self):
            self._iter = iter(self._rows)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration

    class FakeCollection:
        def __init__(self, rows):
            self._rows = rows

        def find(self, flt=None, projection=None):
            return FakeCursor(self._rows)

    class FakeDb:
        menu_variants = FakeCollection([{"_id": 30, "product_id": "PRD-025", "variant_name": "Fanta (Klng)", "additional_price": 0}])
        variant_ingredients = FakeCollection([{"variant_id": 30, "inventory_id": "INV-017", "qty_needed": 1}])
        inventory = FakeCollection([{"_id": "INV-017", "stock": 15.0, "min_stock": 5.0, "unit": "btl"}])

    monkeypatch.setattr(variants, "db", FakeDb())

    class FakeUser:
        role = "kasir"

    payload = asyncio.run(variants.list_menu_variants("PRD-025", FakeUser()))

    assert payload == [{
        "id": 30,
        "product_id": "PRD-025",
        "variant_name": "Fanta (Klng)",
        "additional_price": 0,
        "available": 15,
        "stock": 15.0,
        "min_stock": 5.0,
        "unit": "btl",
        "low": False,
    }]


def test_checkout_stock_consumption_is_untouched():
    """Perbaikan hanya menyentuh tampilan; logika pengurangan stok tidak berubah."""
    import variants

    source = inspect.getsource(variants.consume_checkout_stock)
    assert "UPDATE inventory i" in source
    assert "SET stock = i.stock - n.qty" in source
    assert "JOIN variant_ingredients vi" in source


def test_variant_stock_by_product_takes_minimum_across_variants(monkeypatch):
    """Kartu produk memakai sisa porsi TERKECIL di antara variannya."""
    import variants

    class FakeCursor:
        def __init__(self, rows):
            self._rows = rows

        def sort(self, *args, **kwargs):
            return self

        async def to_list(self, limit):
            return list(self._rows)

        def __aiter__(self):
            self._iter = iter(self._rows)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration

    class FakeCollection:
        def __init__(self, rows):
            self._rows = rows

        def find(self, flt=None, projection=None):
            return FakeCursor(self._rows)

    class FakeDb:
        variant_ingredients = FakeCollection([
            {"variant_id": 30, "inventory_id": "INV-017", "qty_needed": 1},
            {"variant_id": 31, "inventory_id": "INV-002", "qty_needed": 51},
            {"variant_id": 31, "inventory_id": "INV-017", "qty_needed": 1},
        ])
        menu_variants = FakeCollection([
            {"_id": 30, "product_id": "PRD-025", "variant_name": "Fanta (Klng)"},
            {"_id": 31, "product_id": "PRD-025", "variant_name": "Fanta Susu"},
        ])
        inventory = FakeCollection([
            {"_id": "INV-017", "stock": 15.0, "min_stock": 5.0, "unit": "btl"},
            {"_id": "INV-002", "stock": 5405.0, "min_stock": 500.0, "unit": "gram"},
        ])

    monkeypatch.setattr(variants, "db", FakeDb())

    assert asyncio.run(variants.variant_stock_by_product()) == {"PRD-025": 15}


def test_product_stock_uses_variant_source_for_products_with_variants():
    """`/products/stock` harus memakai sumber varian untuk produk bervarian."""
    import server

    source = inspect.getsource(server.product_stock)
    assert "variant_stock_by_product()" in source
    assert "if p[\"_id\"] in variant_stock:" in source


def test_vercel_mirror_product_stock_matches_server():
    """Mirror Vercel wajib memakai perhitungan stok yang sama."""
    from pathlib import Path

    mirror = (Path(__file__).resolve().parents[2] / "api" / "index.py").read_text(encoding="utf-8")
    assert "variant_stock_by_product" in mirror
    assert "if p[\"_id\"] in variant_stock:" in mirror
