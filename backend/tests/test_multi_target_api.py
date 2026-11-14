"""Validasi skema API Multi-Target Sales (``targets.TargetIn``).

Mengunci dua hal:
1. Payload LAMA (tanpa ``targetType``) tetap valid & tidak berubah perilakunya.
2. Payload tipe baru divalidasi sesuai tipenya.

Tidak menyentuh database — hanya model Pydantic.
"""

import pytest
from pydantic import ValidationError

import target_types as tt
from targets import TargetIn


def legacy_payload(**overrides):
    payload = {"name": "Paket Kopi", "productIds": ["PRD-1"], "targetQty": 5}
    payload.update(overrides)
    return payload


# --------------------------------------------------------------------------
# Kompatibilitas payload lama
# --------------------------------------------------------------------------


def test_legacy_payload_defaults_to_item_quantity_shift():
    body = TargetIn(**legacy_payload())

    assert body.targetType == tt.ITEM_QUANTITY
    assert body.periodType == tt.PERIOD_SHIFT
    assert body.targetAmount is None
    assert body.metric is None
    assert body.startTime is None and body.endTime is None
    assert body.productIds == ["PRD-1"] and body.targetQty == 5


def test_legacy_payload_still_requires_product_and_positive_qty():
    with pytest.raises(ValidationError):
        TargetIn(**legacy_payload(productIds=[]))
    with pytest.raises(ValidationError):
        TargetIn(**legacy_payload(targetQty=0))
    with pytest.raises(ValidationError):
        TargetIn(**legacy_payload(targetQty=-3))
    with pytest.raises(ValidationError):
        TargetIn(**legacy_payload(targetQty=None))


# --------------------------------------------------------------------------
# Tipe baru
# --------------------------------------------------------------------------


def test_revenue_target_accepts_amount_without_products():
    body = TargetIn(name="Omzet Harian", targetType=tt.REVENUE_AMOUNT, targetAmount=1500000)

    assert body.productIds == []
    assert body.targetQty is None
    assert body.targetAmount == 1500000


def test_revenue_target_requires_positive_amount():
    with pytest.raises(ValidationError):
        TargetIn(name="Omzet", targetType=tt.REVENUE_AMOUNT)
    with pytest.raises(ValidationError):
        TargetIn(name="Omzet", targetType=tt.REVENUE_AMOUNT, targetAmount=0)


def test_time_bounded_weekly_revenue():
    body = TargetIn(
        name="Omzet Mingguan",
        targetType=tt.TIME_BOUNDED,
        metric=tt.METRIC_REVENUE,
        targetAmount=5000000,
        periodType=tt.PERIOD_WEEKLY,
        startTime="08:00",
        endTime="17:00",
    )

    assert body.periodType == tt.PERIOD_WEEKLY
    assert body.startTime == "08:00" and body.endTime == "17:00"


def test_time_bounded_item_metric_requires_products_and_qty():
    with pytest.raises(ValidationError):
        TargetIn(name="Item", targetType=tt.TIME_BOUNDED, metric=tt.METRIC_ITEM)
    with pytest.raises(ValidationError):
        TargetIn(name="Item", targetType=tt.TIME_BOUNDED, metric=tt.METRIC_ITEM,
                 productIds=["PRD-1"], targetQty=0)

    body = TargetIn(name="Item", targetType=tt.TIME_BOUNDED, metric=tt.METRIC_ITEM,
                    productIds=["PRD-1"], targetQty=10, startTime="18:00", endTime="23:00")
    assert body.targetQty == 10


# --------------------------------------------------------------------------
# Nilai enum
# --------------------------------------------------------------------------


def test_unknown_target_type_is_rejected():
    with pytest.raises(ValidationError):
        TargetIn(**legacy_payload(targetType="bukan_tipe"))


def test_unknown_period_type_is_rejected():
    with pytest.raises(ValidationError):
        TargetIn(**legacy_payload(periodType="tahunan"))


def test_unknown_metric_is_rejected():
    with pytest.raises(ValidationError):
        TargetIn(name="X", targetType=tt.TIME_BOUNDED, metric="bukan_metrik", targetAmount=1000)
