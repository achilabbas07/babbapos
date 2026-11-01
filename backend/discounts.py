from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import User, db, now_iso, require_roles

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


async def promo_discount(code: str, subtotal: float) -> dict:
    wanted = code.strip().upper()
    promos = await db.promos.find({"is_active": True}).to_list(None)
    promo = next((p for p in promos if (p["code"] or "").strip().upper() == wanted), None)
    if not promo:
        raise HTTPException(404, f"Kode promo {code} tidak ditemukan atau tidak aktif")
    if promo.get("expired_at") and promo["expired_at"] < now_iso():
        raise HTTPException(400, f"Kode promo {promo['code']} sudah kedaluwarsa")
    minimum = promo.get("min_minimum_order") or 0
    if subtotal < minimum:
        raise HTTPException(400, f"Minimal belanja untuk {promo['code']} adalah Rp {minimum:,.0f}".replace(",", "."))
    value = promo["discount_value"] or 0
    amount = subtotal * value / 100 if (promo.get("discount_type") or "").lower() in PERCENT_TYPES else value
    if promo.get("max_discount"):
        amount = min(amount, promo["max_discount"])
    return {"code": promo["code"], "description": promo.get("description") or "", "discount": round(min(amount, subtotal))}


async def points_discount(customer_id: Optional[str]) -> dict:
    if not customer_id:
        raise HTTPException(400, "Pilih pelanggan terlebih dahulu untuk tukar poin")
    cust = await db.customers.find_one({"_id": customer_id})
    if not cust:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    settings = await db.point_settings.find().sort("_id", 1).to_list(1)
    if not settings:
        raise HTTPException(500, "Pengaturan tukar poin belum ada di tabel point_settings")
    required, reward = settings[0]["required_points"], round(settings[0]["reward_value"])
    if cust["points"] < required:
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
