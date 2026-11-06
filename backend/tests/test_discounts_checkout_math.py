import asyncio

import pytest
from fastapi import HTTPException

from discounts import (
    _as_number,
    _parse_timestamp,
    promo_discount,
    resolve_checkout_amounts,
)


class TestResolveCheckoutAmounts:
    def test_no_discount_keeps_subtotal(self):
        assert resolve_checkout_amounts(52000) == {
            "subtotal": 52000.0,
            "promoDiscount": 0.0,
            "pointsDiscount": 0.0,
            "discount": 0.0,
            "total": 52000.0,
        }

    def test_promo_and_points_stack_like_prd(self):
        result = resolve_checkout_amounts(52000, 5200, 10000)
        assert result["promoDiscount"] == 5200
        assert result["pointsDiscount"] == 10000
        assert result["discount"] == 15200
        assert result["total"] == 36800

    def test_full_comp_promo_yields_zero_total(self):
        result = resolve_checkout_amounts(52000, 52000, 0)
        assert result["total"] == 0
        assert result["promoDiscount"] == 52000
        assert result["discount"] == 52000

    def test_discounts_never_push_total_negative(self):
        result = resolve_checkout_amounts(30000, 30000, 10000)
        assert result["total"] == 0
        assert result["discount"] == 30000
        assert result["promoDiscount"] + result["pointsDiscount"] == 30000

    def test_points_are_capped_against_remaining_after_promo(self):
        result = resolve_checkout_amounts(10000, 4000, 10000)
        assert result["promoDiscount"] == 4000
        assert result["pointsDiscount"] == 6000
        assert result["total"] == 0

    def test_promo_larger_than_subtotal_is_capped(self):
        result = resolve_checkout_amounts(5000, 8000, 0)
        assert result["promoDiscount"] == 5000
        assert result["total"] == 0

    @pytest.mark.parametrize("subtotal", [0, -1, None, "abc"])
    def test_non_positive_or_invalid_subtotal_is_rejected(self, subtotal):
        with pytest.raises(ValueError):
            resolve_checkout_amounts(subtotal)


class TestNumericHelpers:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (None, 0.0),
            (1000, 1000.0),
            ("1000", 1000.0),
            (" 25000 ", 25000.0),
            ("1.000,5", 1000.5),
            ("1,000.5", 1000.5),
            ("abc", 0.0),
        ],
    )
    def test_as_number(self, value, expected):
        assert _as_number(value) == expected

    def test_parse_timestamp_handles_zulu_and_space_formats(self):
        assert _parse_timestamp("2026-11-30T04:00:00Z").isoformat() == "2026-11-30T04:00:00+00:00"
        assert _parse_timestamp("2026-11-30 04:00:00").isoformat() == "2026-11-30T04:00:00+00:00"
        assert _parse_timestamp("not-a-date") is None


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, _limit):
        return list(self._rows)

    def sort(self, *_args):
        return self


class _FakeCollection:
    def __init__(self, rows):
        self._rows = rows

    def find(self, _flt=None):
        return _FakeCursor(self._rows)


class _FakeDb:
    def __init__(self, promos):
        self.promos = _FakeCollection(promos)


class TestPromoDiscount:
    def test_percent_promo_is_computed_and_rounded(self, monkeypatch):
        import discounts

        monkeypatch.setattr(discounts, "db", _FakeDb([
            {"code": "TEST10", "discount_type": "percent", "discount_value": 10,
             "max_discount": None, "min_minimum_order": 30000, "expired_at": None},
        ]))
        result = asyncio.run(promo_discount("test10", 52000))
        assert result["discount"] == 5200

    def test_string_numeric_fields_do_not_break_arithmetic(self, monkeypatch):
        import discounts

        monkeypatch.setattr(discounts, "db", _FakeDb([
            {"code": "FIXED", "discount_type": "fixed", "discount_value": "5000",
             "max_discount": None, "min_minimum_order": "10000", "expired_at": None},
        ]))
        result = asyncio.run(promo_discount("FIXED", 52000))
        assert result["discount"] == 5000

    def test_expired_promo_is_rejected(self, monkeypatch):
        import discounts

        monkeypatch.setattr(discounts, "db", _FakeDb([
            {"code": "OLD", "discount_type": "fixed", "discount_value": 1000,
             "max_discount": None, "min_minimum_order": 0, "expired_at": "2020-01-01T00:00:00+00:00"},
        ]))
        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(promo_discount("OLD", 52000))
        assert excinfo.value.status_code == 400

    def test_below_minimum_order_is_rejected(self, monkeypatch):
        import discounts

        monkeypatch.setattr(discounts, "db", _FakeDb([
            {"code": "MIN", "discount_type": "fixed", "discount_value": 1000,
             "max_discount": None, "min_minimum_order": 30000, "expired_at": None},
        ]))
        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(promo_discount("MIN", 20000))
        assert excinfo.value.status_code == 400
