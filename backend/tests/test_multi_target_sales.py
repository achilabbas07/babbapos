"""Unit test Multi-Target Sales (target_types) — murni, tanpa database.

Semua test di sini memanggil fungsi murni dari ``target_types`` sehingga tidak
membutuhkan Supabase. Tujuannya mengunci perilaku tipe target baru SEKALIGUS
memastikan tipe lama (``item_quantity``) tidak berubah.
"""

from datetime import datetime, timedelta

import pytest

from core import WITA
import target_types as tt
from target_types import TargetData


DEFAULT_PRODUCT_IDS = ["PRD-1", "PRD-2"]
DEFAULT_PRODUCT_NAMES = ["Kopi Susu", "Teh Manis"]


def item_target(**overrides):
    target = {
        "_id": "TGT-1",
        "name": "Paket Kopi",
        "productIds": DEFAULT_PRODUCT_IDS,
        "productNames": DEFAULT_PRODUCT_NAMES,
        "targetQty": 10,
        "waiterId": None,
        "waiterName": "",
    }
    target.update(overrides)
    return target


def revenue_target(**overrides):
    target = {
        "_id": "TGT-REV",
        "name": "Omzet Harian",
        "productIds": [],
        "productNames": [],
        "targetQty": None,
        "targetType": tt.REVENUE_AMOUNT,
        "targetAmount": 1000000,
        "periodType": tt.PERIOD_SHIFT,
    }
    target.update(overrides)
    return target


def time_target(**overrides):
    target = {
        "_id": "TGT-TIME",
        "name": "Omzet Malam",
        "productIds": [],
        "productNames": [],
        "targetQty": None,
        "targetType": tt.TIME_BOUNDED,
        "targetAmount": 500000,
        "metric": tt.METRIC_REVENUE,
        "periodType": tt.PERIOD_DAILY,
        "startTime": "22:00",
        "endTime": "02:00",
    }
    target.update(overrides)
    return target


def log(product_id, qty, timestamp=None):
    return {"productId": product_id, "qty": qty, "timestamp": timestamp or "2026-01-01T10:00:00+08:00"}


def trx(total, date=None):
    return {"total": total, "date": date or "2026-01-01T10:00:00+08:00"}


# --------------------------------------------------------------------------
# Kompatibilitas tipe lama (item_quantity)
# --------------------------------------------------------------------------


def test_target_without_type_defaults_to_item_quantity():
    """Target lama tanpa kolom targetType harus dianggap item_quantity."""
    legacy = {"_id": "TGT-OLD", "name": "Lama", "productIds": ["PRD-1"], "productNames": ["Kopi"], "targetQty": 5}
    assert tt.target_type_of(legacy) == tt.ITEM_QUANTITY
    assert tt.target_type_of({}) == tt.ITEM_QUANTITY
    assert tt.target_type_of({"targetType": "tidak_dikenal"}) == tt.ITEM_QUANTITY


def test_item_quantity_achieved_and_pct_unchanged():
    target = item_target()
    data = TargetData(logs=[log("PRD-1", 3), log("PRD-2", 2), log("PRD-1", 1)])
    result = tt.evaluate_target(target, data)

    assert result["achieved"] == 6
    assert result["targetQty"] == 10
    assert result["pct"] == pytest.approx(60.0)
    assert result["unit"] == tt.UNIT_ITEM
    assert result["targetType"] == tt.ITEM_QUANTITY
    assert {b["productId"]: b["qty"] for b in result["breakdown"]} == {"PRD-1": 4, "PRD-2": 2}


def test_item_quantity_pct_capped_at_100_and_never_negative():
    target = item_target(targetQty=2)
    result = tt.evaluate_target(target, TargetData(logs=[log("PRD-1", 9)]))
    assert result["pct"] == 100.0

    # Log negatif (void) tidak boleh menghasilkan pencapaian negatif.
    result2 = tt.evaluate_target(target, TargetData(logs=[log("PRD-1", -5)]))
    assert result2["achieved"] == 0
    assert result2["pct"] == 0.0


def test_item_quantity_zero_target_does_not_divide_by_zero():
    result = tt.evaluate_target(item_target(targetQty=0), TargetData(logs=[log("PRD-1", 5)]))
    assert result["pct"] == 0.0


def test_item_quantity_ignores_transactions():
    """Tipe lama tetap murni dari order_logs, tidak terpengaruh transaksi."""
    target = item_target()
    result = tt.evaluate_target(target, TargetData(logs=[log("PRD-1", 4)], transactions=[trx(9999999)]))
    assert result["achieved"] == 4


# --------------------------------------------------------------------------
# Target omzet (revenue_amount)
# --------------------------------------------------------------------------


def test_revenue_target_sums_transactions_and_returns_currency_unit():
    result = tt.evaluate_target(revenue_target(), TargetData(transactions=[trx(250000), trx(150000)]))

    assert result["achieved"] == pytest.approx(400000)
    assert result["targetValue"] == pytest.approx(1000000)
    assert result["unit"] == tt.UNIT_CURRENCY
    assert result["pct"] == pytest.approx(40.0)
    assert result["breakdown"] == []
    assert result["targetQty"] is None


def test_revenue_target_ignores_order_logs():
    result = tt.evaluate_target(revenue_target(), TargetData(logs=[log("PRD-1", 100)], transactions=[trx(50000)]))
    assert result["achieved"] == pytest.approx(50000)


def test_revenue_target_reached():
    result = tt.evaluate_target(revenue_target(targetAmount=100000), TargetData(transactions=[trx(120000)]))
    assert result["pct"] == 100.0
    assert tt.is_achieved(result) is True


def test_revenue_target_without_target_amount_is_not_achieved():
    result = tt.evaluate_target(revenue_target(targetAmount=None), TargetData(transactions=[trx(120000)]))
    assert result["pct"] == 0.0
    assert tt.is_achieved(result) is False


# --------------------------------------------------------------------------
# Target berbasis waktu (time_bounded)
# --------------------------------------------------------------------------


def test_parse_hhmm_and_invalid_values():
    assert tt.parse_hhmm("08:30") == 8 * 60 + 30
    assert tt.parse_hhmm("00:00") == 0
    assert tt.parse_hhmm("24:00") is None
    assert tt.parse_hhmm("08:75") is None
    assert tt.parse_hhmm("08") is None
    assert tt.parse_hhmm("abc") is None
    assert tt.parse_hhmm(None) is None


def test_in_time_window_normal_range():
    assert tt.in_time_window("2026-01-01T10:00:00+08:00", "08:00", "12:00") is True
    assert tt.in_time_window("2026-01-01T12:00:00+08:00", "08:00", "12:00") is False  # end eksklusif
    assert tt.in_time_window("2026-01-01T07:59:00+08:00", "08:00", "12:00") is False


def test_in_time_window_crosses_midnight():
    # 22:00-02:00 harus mencakup 23:30 dan 00:30, tetapi bukan 12:00.
    assert tt.in_time_window("2026-01-01T23:30:00+08:00", "22:00", "02:00") is True
    assert tt.in_time_window("2026-01-02T00:30:00+08:00", "22:00", "02:00") is True
    assert tt.in_time_window("2026-01-01T12:00:00+08:00", "22:00", "02:00") is False


def test_in_time_window_without_bounds_allows_everything():
    assert tt.in_time_window("2026-01-01T03:00:00+08:00", None, None) is True
    assert tt.in_time_window(None, "08:00", "12:00") is True  # data tanpa waktu tidak dibuang


def test_in_time_window_converts_utc_to_wita():
    # 15:00 UTC == 23:00 WITA → masuk jendela 22:00-02:00.
    assert tt.in_time_window("2026-01-01T15:00:00+00:00", "22:00", "02:00") is True


def test_period_bounds_daily_weekly_monthly():
    now = datetime(2026, 3, 15, 14, 30, tzinfo=WITA)  # Minggu
    day_start, day_end = tt.period_bounds(tt.PERIOD_DAILY, now)
    assert (day_start, day_end) == (
        datetime(2026, 3, 15, 0, 0, tzinfo=WITA),
        datetime(2026, 3, 16, 0, 0, tzinfo=WITA),
    )

    week_start, week_end = tt.period_bounds(tt.PERIOD_WEEKLY, now)
    assert week_start.weekday() == 0  # Senin
    assert week_start == datetime(2026, 3, 9, 0, 0, tzinfo=WITA)
    assert week_end - week_start == timedelta(days=7)

    month_start, month_end = tt.period_bounds(tt.PERIOD_MONTHLY, now)
    assert month_start == datetime(2026, 3, 1, 0, 0, tzinfo=WITA)
    assert month_end == datetime(2026, 4, 1, 0, 0, tzinfo=WITA)


def test_period_bounds_handles_december_month_rollover():
    now = datetime(2026, 12, 20, 9, 0, tzinfo=WITA)
    start, end = tt.period_bounds(tt.PERIOD_MONTHLY, now)
    assert start == datetime(2026, 12, 1, 0, 0, tzinfo=WITA)
    assert end == datetime(2027, 1, 1, 0, 0, tzinfo=WITA)


def test_time_bounded_revenue_only_counts_window():
    target = time_target()
    data = TargetData(transactions=[
        trx(100000, "2026-01-01T23:00:00+08:00"),  # masuk
        trx(50000, "2026-01-02T01:00:00+08:00"),   # masuk (lewati tengah malam)
        trx(999000, "2026-01-01T12:00:00+08:00"),  # di luar jendela
    ])
    result = tt.evaluate_target(target, data)

    assert result["achieved"] == pytest.approx(150000)
    assert result["pct"] == pytest.approx(30.0)
    assert result["metric"] == tt.METRIC_REVENUE
    assert result["unit"] == tt.UNIT_CURRENCY
    assert result["periodType"] == tt.PERIOD_DAILY


def test_time_bounded_item_metric_counts_qty_in_window():
    target = time_target(metric=tt.METRIC_ITEM, productIds=DEFAULT_PRODUCT_IDS,
                         productNames=DEFAULT_PRODUCT_NAMES, targetQty=10, targetAmount=None)
    data = TargetData(logs=[
        log("PRD-1", 2, "2026-01-01T23:10:00+08:00"),
        log("PRD-2", 3, "2026-01-02T00:40:00+08:00"),
        log("PRD-1", 100, "2026-01-01T09:00:00+08:00"),  # di luar jendela
    ])
    result = tt.evaluate_target(target, data)

    assert result["achieved"] == 5
    assert result["targetQty"] == 10
    assert result["unit"] == tt.UNIT_ITEM
    assert result["pct"] == pytest.approx(50.0)
    assert {b["productId"]: b["qty"] for b in result["breakdown"]} == {"PRD-1": 2, "PRD-2": 3}


# --------------------------------------------------------------------------
# Dispatch, kebutuhan data, dan helper status
# --------------------------------------------------------------------------


def test_evaluate_target_dispatch_per_type():
    data = TargetData()
    assert tt.evaluate_target(item_target(), data)["targetType"] == tt.ITEM_QUANTITY
    assert tt.evaluate_target(revenue_target(), data)["targetType"] == tt.REVENUE_AMOUNT
    assert tt.evaluate_target(time_target(), data)["targetType"] == tt.TIME_BOUNDED


def test_unknown_type_falls_back_to_item_quantity():
    target = item_target(targetType="entah")
    assert tt.evaluate_target(target, TargetData(logs=[log("PRD-1", 2)]))["targetType"] == tt.ITEM_QUANTITY


def test_needs_logs_and_needs_revenue_per_type():
    assert tt.needs_logs(item_target()) is True
    assert tt.needs_revenue(item_target()) is False
    assert tt.needs_logs(revenue_target()) is False
    assert tt.needs_revenue(revenue_target()) is True
    assert tt.needs_logs(time_target(metric=tt.METRIC_ITEM)) is True
    assert tt.needs_revenue(time_target(metric=tt.METRIC_ITEM)) is False
    assert tt.needs_logs(time_target(metric=tt.METRIC_REVENUE)) is False
    assert tt.needs_revenue(time_target(metric=tt.METRIC_REVENUE)) is True


def test_period_and_metric_defaults_are_safe():
    assert tt.period_of({}) == tt.PERIOD_SHIFT
    assert tt.period_of({"periodType": "tahunan"}) == tt.PERIOD_SHIFT
    assert tt.metric_of({}) == tt.METRIC_REVENUE
    assert tt.metric_of({"metric": "entah"}) == tt.METRIC_REVENUE


def test_is_achieved_handles_missing_and_zero_values():
    assert tt.is_achieved({"achieved": 5, "targetQty": 5}) is True
    assert tt.is_achieved({"achieved": 4, "targetQty": 5}) is False
    assert tt.is_achieved({"achieved": 5, "targetValue": 5}) is True
    assert tt.is_achieved({"achieved": 500, "targetQty": None, "targetValue": None}) is False
    assert tt.is_achieved({"achieved": 5, "targetQty": 0}) is False
