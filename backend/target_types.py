"""Tipe target sales (polymorphic, non-destruktif).

Modul ini sengaja dibuat **murni** (tanpa akses database) supaya mudah diuji
tanpa server maupun koneksi Supabase. ``targets.py`` bertugas memuat data lalu
memanggil evaluator yang sesuai dengan ``targetType`` milik target.

Tipe yang didukung:

``item_quantity``
    Target jumlah item per shift. Ini perilaku LAMA dan rumusnya dipertahankan
    persis (breakdown per produk, ``achieved`` = total qty, ``pct`` dibatasi
    100). Target lama yang belum punya kolom ``targetType`` otomatis dibaca
    sebagai tipe ini.

``revenue_amount``
    Target omzet (Rupiah) per shift. Diambil dari ``transactions.total`` pada
    shift berjalan, bukan dari ``order_logs`` (yang hanya menyimpan kuantitas).

``time_bounded``
    Target dengan batas waktu/periode. Metriknya bisa omzet (``revenue``) atau
    jumlah item (``item_quantity``), periodenya ``shift``/``daily``/``weekly``/
    ``monthly``, dan opsional dibatasi jam operasional ``startTime``-``endTime``
    (mendukung jam yang melewati tengah malam, mis. 22:00-02:00).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple

from core import WITA

ITEM_QUANTITY = "item_quantity"
REVENUE_AMOUNT = "revenue_amount"
TIME_BOUNDED = "time_bounded"
TARGET_TYPES = (ITEM_QUANTITY, REVENUE_AMOUNT, TIME_BOUNDED)
DEFAULT_TARGET_TYPE = ITEM_QUANTITY

METRIC_REVENUE = "revenue"
METRIC_ITEM = "item_quantity"
METRICS = (METRIC_REVENUE, METRIC_ITEM)

PERIOD_SHIFT = "shift"
PERIOD_DAILY = "daily"
PERIOD_WEEKLY = "weekly"
PERIOD_MONTHLY = "monthly"
PERIODS = (PERIOD_SHIFT, PERIOD_DAILY, PERIOD_WEEKLY, PERIOD_MONTHLY)

UNIT_ITEM = "item"
UNIT_CURRENCY = "currency"


@dataclass
class TargetData:
    """Data mentah yang dibutuhkan evaluator (sudah dimuat oleh ``targets.py``)."""

    logs: List[dict] = field(default_factory=list)
    transactions: List[dict] = field(default_factory=list)
    now: Optional[datetime] = None


def _as_local(value) -> Optional[datetime]:
    """Konversi timestamp apa pun ke datetime ber-zona WITA."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=WITA)
    return dt.astimezone(WITA)


def parse_hhmm(value: Optional[str]) -> Optional[int]:
    """Ubah ``"HH:MM"`` menjadi menit sejak tengah malam (None bila tidak valid)."""
    if not value:
        return None
    parts = str(value).strip().split(":")
    if len(parts) < 2:
        return None
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except (TypeError, ValueError):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour * 60 + minute


def in_time_window(value, start: Optional[str], end: Optional[str]) -> bool:
    """Apakah ``value`` jatuh di dalam jam operasional ``start``-``end``.

    ``start``/``end`` kosong berarti tanpa batas. Bila ``start > end`` dianggap
    jendela melewati tengah malam (mis. 22:00-02:00). Nilai waktu yang tidak
    bisa diparse dianggap lolos agar data lama tidak hilang dari hitungan.
    """
    start_m, end_m = parse_hhmm(start), parse_hhmm(end)
    if start_m is None and end_m is None:
        return True
    dt = _as_local(value)
    if dt is None:
        return True
    minute = dt.hour * 60 + dt.minute
    if start_m is None:
        return minute < end_m
    if end_m is None:
        return minute >= start_m
    if start_m <= end_m:
        return start_m <= minute < end_m
    return minute >= start_m or minute < end_m


def period_bounds(period: str, now: datetime) -> Tuple[datetime, datetime]:
    """Rentang kalender WITA untuk sebuah periode (``[start, end)``)."""
    local = _as_local(now) or datetime.now(WITA)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == PERIOD_WEEKLY:
        start = day_start - timedelta(days=day_start.weekday())  # Senin
        return start, start + timedelta(days=7)
    if period == PERIOD_MONTHLY:
        start = day_start.replace(day=1)
        return start, (start + timedelta(days=32)).replace(day=1)
    return day_start, day_start + timedelta(days=1)


def target_type_of(target: dict) -> str:
    """Tipe target dengan fallback aman ke ``item_quantity`` (data lama)."""
    value = (target or {}).get("targetType") or DEFAULT_TARGET_TYPE
    return value if value in TARGET_TYPES else DEFAULT_TARGET_TYPE


def period_of(target: dict) -> str:
    value = (target or {}).get("periodType") or PERIOD_SHIFT
    return value if value in PERIODS else PERIOD_SHIFT


def metric_of(target: dict) -> str:
    value = (target or {}).get("metric") or METRIC_REVENUE
    return value if value in METRICS else METRIC_REVENUE


def needs_logs(target: dict) -> bool:
    """Apakah target butuh ``order_logs`` (kuantitas item)."""
    ttype = target_type_of(target)
    if ttype == ITEM_QUANTITY:
        return True
    if ttype == TIME_BOUNDED:
        return metric_of(target) == METRIC_ITEM
    return False


def needs_revenue(target: dict) -> bool:
    """Apakah target butuh ``transactions`` (omzet Rupiah)."""
    ttype = target_type_of(target)
    if ttype == REVENUE_AMOUNT:
        return True
    if ttype == TIME_BOUNDED:
        return metric_of(target) == METRIC_REVENUE
    return False


def _pct(achieved: float, target_value: float) -> float:
    if not target_value or target_value <= 0:
        return 0.0
    return min(100.0, achieved / target_value * 100)


def _qty_by_product(logs: List[dict], start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, int]:
    got: Dict[str, int] = defaultdict(int)
    for log in logs or []:
        if not in_time_window(log.get("timestamp"), start, end):
            continue
        product_id = log.get("productId")
        if product_id is None:
            continue
        got[product_id] += int(log.get("qty") or 0)
    return got


def _revenue(transactions: List[dict], start: Optional[str] = None, end: Optional[str] = None) -> float:
    total = 0.0
    for trx in transactions or []:
        if not in_time_window(trx.get("date"), start, end):
            continue
        total += float(trx.get("total") or 0)
    return total


def _breakdown(product_ids: List[str], product_names: List[str], got: Dict[str, int]) -> List[dict]:
    return [
        {"productId": pid, "productName": name, "qty": max(0, got.get(pid, 0))}
        for pid, name in zip(product_ids, product_names)
    ]


def evaluate_item_quantity(target: dict, data: TargetData) -> dict:
    """Target kuantitas item per shift — rumus lama, tidak diubah."""
    product_ids = list(target.get("productIds") or [])
    product_names = list(target.get("productNames") or [])
    got = _qty_by_product(data.logs)
    achieved = max(0, sum(got.get(pid, 0) for pid in product_ids))
    target_qty = int(target.get("targetQty") or 0)
    return {
        "targetId": target["_id"],
        "name": target.get("name") or "",
        "targetType": ITEM_QUANTITY,
        "unit": UNIT_ITEM,
        "productIds": product_ids,
        "breakdown": _breakdown(product_ids, product_names, got),
        "targetQty": target_qty,
        "targetValue": target_qty,
        "achieved": achieved,
        "pct": _pct(achieved, target_qty),
    }


def evaluate_revenue_amount(target: dict, data: TargetData) -> dict:
    """Target omzet (Rupiah) per shift."""
    amount = float(target.get("targetAmount") or 0)
    achieved = _revenue(data.transactions)
    return {
        "targetId": target["_id"],
        "name": target.get("name") or "",
        "targetType": REVENUE_AMOUNT,
        "unit": UNIT_CURRENCY,
        "productIds": [],
        "breakdown": [],
        "targetQty": None,
        "targetValue": amount,
        "achieved": achieved,
        "pct": _pct(achieved, amount),
    }


def evaluate_time_bounded(target: dict, data: TargetData) -> dict:
    """Target dengan batas periode dan/atau jam operasional."""
    metric = metric_of(target)
    start, end = target.get("startTime"), target.get("endTime")
    product_ids: List[str] = []
    breakdown: List[dict] = []
    if metric == METRIC_ITEM:
        product_ids = list(target.get("productIds") or [])
        product_names = list(target.get("productNames") or [])
        got = _qty_by_product(data.logs, start, end)
        achieved = max(0, sum(got.get(pid, 0) for pid in product_ids))
        target_value = int(target.get("targetQty") or 0)
        unit = UNIT_ITEM
        breakdown = _breakdown(product_ids, product_names, got)
    else:
        achieved = _revenue(data.transactions, start, end)
        target_value = float(target.get("targetAmount") or 0)
        unit = UNIT_CURRENCY
    return {
        "targetId": target["_id"],
        "name": target.get("name") or "",
        "targetType": TIME_BOUNDED,
        "unit": unit,
        "metric": metric,
        "periodType": period_of(target),
        "startTime": start,
        "endTime": end,
        "productIds": product_ids,
        "breakdown": breakdown,
        "targetQty": target_value if unit == UNIT_ITEM else None,
        "targetValue": target_value,
        "achieved": achieved,
        "pct": _pct(achieved, target_value),
    }


EVALUATORS: Dict[str, Callable[[dict, TargetData], dict]] = {
    ITEM_QUANTITY: evaluate_item_quantity,
    REVENUE_AMOUNT: evaluate_revenue_amount,
    TIME_BOUNDED: evaluate_time_bounded,
}


def evaluate_target(target: dict, data: TargetData) -> dict:
    """Dispatch ke evaluator sesuai ``targetType`` (fallback: item_quantity)."""
    return EVALUATORS[target_type_of(target)](target, data)


def is_achieved(item: dict) -> bool:
    """Apakah sebuah hasil target sudah tercapai (aman untuk targetValue None)."""
    value = item.get("targetValue")
    if value is None:
        value = item.get("targetQty")
    try:
        value = float(value or 0)
    except (TypeError, ValueError):
        return False
    return value > 0 and float(item.get("achieved") or 0) >= value
