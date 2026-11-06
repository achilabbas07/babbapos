import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import User, db, require_roles

router = APIRouter(prefix="/api")
STAFF = require_roles("admin", "kasir")
CUSTOMER_STAFF = require_roles("admin", "kasir", "waiter")


class PromoCheckIn(BaseModel):
    code: str = Field(min_length=1)
    subtotal: float = Field(ge=0)
    adminPin: str


class PointsCheckIn(BaseModel):
    customerId: str
    adminPin: str


PERCENT_TYPES = ("percent", "percentage", "persen", "%")


def _as_number(value, default: float = 0) -> float:
    """Konversi nilai kolom DB (str/Decimal/None) menjadi float yang aman."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        text = str(value).strip().replace(" ", "")
        if not text:
            return default
        if "," in text and "." in text:
            # Pemisah terakhir dianggap penanda desimal (mendukung format ID maupun US).
            if text.rfind(",") > text.rfind("."):
                text = text.replace(".", "").replace(",", ".")
            else:
                text = text.replace(",", "")
        elif "," in text:
            # Format Indonesia: titik = ribuan, koma = desimal.
            text = text.replace(".", "").replace(",", ".")
        return float(text)
    except (TypeError, ValueError):
        return default


def _parse_timestamp(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def resolve_checkout_amounts(subtotal, promo_discount_value=0, points_discount_value=0) -> dict:
    """Hitung total akhir checkout dengan diskon bertingkat yang tidak pernah negatif.

    Diskon promo dipotong lebih dulu, lalu diskon poin dibatasi terhadap sisa setelah promo.
    Total 0 (mis. promo komplimen 100%) adalah transaksi yang sah.
    """
    subtotal_amount = _as_number(subtotal)
    promo_amount = _as_number(promo_discount_value)
    points_amount = _as_number(points_discount_value)
    if not math.isfinite(subtotal_amount) or subtotal_amount <= 0:
        raise ValueError("Nilai transaksi tidak valid")
    promo_amount = max(0.0, min(promo_amount, subtotal_amount))
    points_amount = max(0.0, min(points_amount, subtotal_amount - promo_amount))
    total = subtotal_amount - promo_amount - points_amount
    if not math.isfinite(total) or total < 0:
        raise ValueError("Nilai transaksi tidak valid")
    return {
        "subtotal": subtotal_amount,
        "promoDiscount": promo_amount,
        "pointsDiscount": points_amount,
        "discount": subtotal_amount - total,
        "total": total,
    }


async def promo_discount(code: str, subtotal: float) -> dict:
    wanted = (code or "").strip().upper()
    subtotal_amount = _as_number(subtotal)
    promos = await db.promos.find({"is_active": True}).to_list(None)
    promo = next((p for p in promos if (p["code"] or "").strip().upper() == wanted), None)
    if not promo:
        raise HTTPException(404, f"Kode promo {code} tidak ditemukan atau tidak aktif")
    expired_at = _parse_timestamp(promo.get("expired_at"))
    if expired_at and expired_at < datetime.now(timezone.utc):
        raise HTTPException(400, f"Kode promo {promo['code']} sudah kedaluwarsa")
    minimum = _as_number(promo.get("min_minimum_order"))
    if subtotal_amount < minimum:
        raise HTTPException(400, f"Minimal belanja untuk {promo['code']} adalah Rp {minimum:,.0f}".replace(",", "."))
    value = _as_number(promo.get("discount_value"))
    amount = subtotal_amount * value / 100 if (promo.get("discount_type") or "").lower() in PERCENT_TYPES else value
    max_discount = _as_number(promo.get("max_discount"))
    if max_discount > 0:
        amount = min(amount, max_discount)
    discount = max(0, round(min(amount, subtotal_amount)))
    return {"code": promo["code"], "description": promo.get("description") or "", "discount": discount}


async def points_discount(customer_id: Optional[str]) -> dict:
    if not customer_id:
        raise HTTPException(400, "Pilih pelanggan terlebih dahulu untuk tukar poin")
    cust = await db.customers.find_one({"_id": customer_id})
    if not cust:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    settings = await db.point_settings.find().sort("_id", 1).to_list(1)
    if not settings:
        raise HTTPException(500, "Pengaturan tukar poin belum ada di tabel point_settings")
    required = int(_as_number(settings[0].get("required_points")))
    reward = max(0, round(_as_number(settings[0].get("reward_value"))))
    if _as_number(cust.get("points")) < required:
        raise HTTPException(400, f"Poin {cust['name']} tidak cukup ({cust['points']} dari minimal {required})")
    return {"pointsRequired": required, "discount": reward, "customerPoints": cust["points"]}


async def verify_admin_pin(request: Request, pin: str):
    from server import check_pin  # late import to avoid circular dependency
    await check_pin(request, pin, "admin")


@router.post("/discounts/promo")
async def check_promo(body: PromoCheckIn, request: Request, _: User = Depends(STAFF)):
    await verify_admin_pin(request, body.adminPin)
    return await promo_discount(body.code, body.subtotal)


@router.post("/discounts/points")
async def check_points(body: PointsCheckIn, request: Request, _: User = Depends(CUSTOMER_STAFF)):
    await verify_admin_pin(request, body.adminPin)
    return await points_discount(body.customerId)
