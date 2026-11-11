"""Regresi: markup Ojol GLOBAL untuk menu ber-varian (tanpa tabel DB baru).

Menguji helper harga murni ``ojol_variant_unit_price`` dan integrasinya di
``build_items`` memakai DB tiruan, sehingga tes tetap ringan (tanpa koneksi DB).
Tidak menyentuh logika transaksional/pembayaran/cetak struk.
"""

import asyncio

import server
from server import OrderItemIn, ojol_variant_unit_price, ojol_markup_percent


# ---------- helper harga murni ----------
class TestOjolVariantUnitPrice:
    def test_applies_global_markup_when_no_specific_ojol_price(self):
        # 22.000 * (1 + 20/100) = 26.400
        assert ojol_variant_unit_price(22000, 0, 20) == 26400

    def test_zero_markup_is_regular_price(self):
        assert ojol_variant_unit_price(22000, 0, 0) == 22000

    def test_specific_ojol_price_overrides_markup(self):
        # Harga Ojol khusus per produk tetap diutamakan (tanpa markup) + surcharge.
        assert ojol_variant_unit_price(22000, 25000, 20, extra=2000) == 27000

    def test_markup_scales_with_regular_price(self):
        assert ojol_variant_unit_price(10000, 0, 20) == 12000
        assert ojol_variant_unit_price(10000, 0, 50) == 15000


# ---------- konfigurasi env ----------
class TestOjolMarkupPercent:
    def test_default_is_global_constant(self):
        assert ojol_markup_percent() == float(server.OJOL_MARKUP_PERCENT)

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("OJOL_MARKUP_PERCENT", "35")
        assert ojol_markup_percent() == 35

    def test_invalid_env_falls_back(self, monkeypatch):
        monkeypatch.setenv("OJOL_MARKUP_PERCENT", "abc")
        assert ojol_markup_percent() == float(server.OJOL_MARKUP_PERCENT)

    def test_negative_env_clamped_to_zero(self, monkeypatch):
        monkeypatch.setenv("OJOL_MARKUP_PERCENT", "-5")
        assert ojol_markup_percent() == 0


class TestNormalizeOjolMarkup:
    def test_clamps_to_safe_range(self):
        assert server.normalize_ojol_markup(25) == 25
        assert server.normalize_ojol_markup(-5) == 0
        assert server.normalize_ojol_markup(5000) == 1000

    def test_accepts_numeric_strings_and_decimals(self):
        assert server.normalize_ojol_markup("12.5") == 12.5

    def test_invalid_value_uses_fallback(self):
        assert server.normalize_ojol_markup("abc", fallback=30) == 30


# ---------- build_items (DB tiruan) ----------
class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for r in self.rows:
            yield r


class FakeProducts:
    def __init__(self, rows):
        self.rows = rows

    def find(self, flt=None, projection=None):
        return FakeCursor(self.rows)


class FakeDB:
    def __init__(self, rows):
        self.products = FakeProducts(rows)
        self.app_profile = FakeProfile()


class FakeProfile:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, flt=None, projection=None):
        return self.doc


def _product(pid="PRD-001", price=20000, price_ojol=0):
    return {"_id": pid, "name": "Kopi", "category": "Minuman", "price": price,
            "price_ojol": price_ojol, "type": "both", "image": "", "inventoryId": None, "hpp": 5000}


def _run_build_items(rows, items, order_type, ojol_markup=20, variants=None):
    original_db, original_load, original_hpp = server.db, server.load_variants, server.variant_hpp
    server.db = FakeDB(rows)
    server.load_variants = lambda ids: _async_value(variants or {})
    server.variant_hpp = lambda ids: _async_value({})
    try:
        return asyncio.run(server.build_items(items, order_type, ojol_markup=ojol_markup))
    finally:
        server.db, server.load_variants, server.variant_hpp = original_db, original_load, original_hpp


async def _async_value(value):
    return value


VARIANT = {5: {"_id": 5, "product_id": "PRD-001", "variant_name": "Panas", "additional_price": 2000}}


class TestBuildItemsVariants:
    def test_ojol_variant_uses_global_markup(self):
        items = [OrderItemIn(productId="PRD-001", qty=1, variantId=5)]
        out, total = _run_build_items([_product()], items, "Ojek Online", variants=VARIANT)
        # regular 20.000 + 2.000 varian = 22.000; +20% => 26.400
        assert out[0]["price"] == 26400
        assert out[0]["variantPrice"] == 2000
        assert total == 26400

    def test_ojol_variant_specific_price_overrides_markup(self):
        items = [OrderItemIn(productId="PRD-001", qty=2, variantId=5)]
        out, total = _run_build_items([_product(price_ojol=25000)], items, "Ojek Online", variants=VARIANT)
        # 25.000 spesifik + 2.000 varian = 27.000 (tanpa markup) x 2
        assert out[0]["price"] == 27000
        assert total == 54000

    def test_non_ojol_variant_keeps_regular_price(self):
        items = [OrderItemIn(productId="PRD-001", qty=1, variantId=5)]
        out, _ = _run_build_items([_product()], items, "Dine In", variants=VARIANT)
        assert out[0]["price"] == 22000  # 20.000 + 2.000, tanpa markup

    def test_non_variant_ojol_unchanged(self):
        # Menu tanpa varian: perilaku lama dipertahankan (price_ojol apa adanya).
        items = [OrderItemIn(productId="PRD-001", qty=1)]
        out, _ = _run_build_items([_product(price_ojol=25000)], items, "Ojek Online")
        assert out[0]["price"] == 25000

    def test_non_variant_ojol_without_specific_price_has_no_markup(self):
        items = [OrderItemIn(productId="PRD-001", qty=1)]
        out, _ = _run_build_items([_product(price_ojol=0)], items, "Ojek Online")
        assert out[0]["price"] == 20000


def test_ojol_markup_route_registered():
    paths = [getattr(r, "path", "") for r in server.api.routes]
    assert "/api/settings/ojol-markup" in paths


def test_ojol_markup_route_supports_put():
    methods = {getattr(r, "path", ""): getattr(r, "methods", set()) for r in server.api.routes}
    assert "PUT" in methods.get("/api/settings/ojol-markup", set())


class TestLoadOjolMarkupFromProfile:
    def test_reads_value_from_app_profile(self):
        original = server.db
        server.db = FakeDB([])
        server.db.app_profile = FakeProfile({"_id": 1, "ojol_markup_percent": 27.5})
        try:
            assert asyncio.run(server.load_ojol_markup_percent()) == 27.5
        finally:
            server.db = original

    def test_falls_back_when_row_missing(self):
        original = server.db
        server.db = FakeDB([])
        server.db.app_profile = FakeProfile(None)
        try:
            assert asyncio.run(server.load_ojol_markup_percent()) == float(server.OJOL_MARKUP_PERCENT)
        finally:
            server.db = original

    def test_build_items_uses_profile_value_when_not_passed(self):
        original_db, original_load, original_hpp = server.db, server.load_variants, server.variant_hpp
        server.db = FakeDB([_product()])
        server.db.app_profile = FakeProfile({"_id": 1, "ojol_markup_percent": 25})
        server.load_variants = lambda ids: _async_value(VARIANT)
        server.variant_hpp = lambda ids: _async_value({})
        try:
            items = [OrderItemIn(productId="PRD-001", qty=1, variantId=5)]
            out, _ = asyncio.run(server.build_items(items, "Ojek Online"))
            assert out[0]["price"] == 27500  # (20.000 + 2.000) * 1.25
        finally:
            server.db, server.load_variants, server.variant_hpp = original_db, original_load, original_hpp
