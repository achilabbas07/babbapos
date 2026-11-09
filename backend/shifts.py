from decimal import Decimal
from typing import Literal, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import BaseDocument, User, db, local_date_str, next_id, now_iso, require_roles
from finance import post_cash_movement_journal


def transaction_cash_portion(trx: dict) -> float:
    """Porsi tunai sebuah transaksi (mendukung split payment)."""
    payments = trx.get("payments") or []
    if payments:
        return sum(
            float(leg.get("amount") or 0)
            for leg in payments
            if (leg.get("method") or "") == "Cash"
        )
    return float(trx.get("total") or 0) if trx.get("method") == "Cash" else 0.0

router = APIRouter(prefix="/api")
STAFF = require_roles("admin", "kasir")
ADMIN = require_roles("admin")


class Shift(BaseDocument):
    userId: Optional[str] = None
    userName: str
    openedAt: str
    openingCash: float
    status: str = "open"
    closedAt: Optional[str] = None
    countedCash: Optional[float] = None
    expectedCash: Optional[float] = None
    difference: Optional[float] = None
    cashSales: float = 0
    nonCashSales: float = 0
    cashIn: float = 0
    cashOut: float = 0
    trxCount: int = 0
    note: str = ""


class CashMovement(BaseDocument):
    shiftId: str
    userId: Optional[str] = None
    userName: str
    type: str
    amount: float
    note: str = ""
    timestamp: str
    expense_category_id: Optional[int] = None


class OpenShiftIn(BaseModel):
    openingCash: float = Field(ge=0)


class MovementIn(BaseModel):
    type: Literal["in", "out"]
    amount: Decimal = Field(gt=0)
    note: str = Field(min_length=1)
    expense_category_id: Optional[int] = None
    shift_id: Optional[str] = None


class CloseShiftIn(BaseModel):
    countedCash: float = Field(ge=0)
    note: str = ""


async def get_open_shift(user_id: str) -> Optional[dict]:
    doc = await db.shifts.find_one({"userId": user_id, "status": "open"})
    return dict(doc) if doc else None


async def require_open_shift(user: User) -> dict:
    doc = await get_open_shift(user.id)
    if not doc:
        raise HTTPException(400, "Buka shift kasir terlebih dahulu")
    return doc


async def summarize(shift_id: str) -> dict:
    txs = await db.transactions.find({"shiftId": shift_id}).to_list(None)
    movs = await db.cash_movements.find({"shiftId": shift_id}).to_list(None)
    cash_sales = sum(transaction_cash_portion(t) for t in txs)
    total_sales = sum(float(t["total"]) for t in txs)
    return {
        "cashSales": cash_sales,
        "nonCashSales": total_sales - cash_sales,
        "cashIn": sum(m["amount"] for m in movs if m["type"] == "in"),
        "cashOut": sum(m["amount"] for m in movs if m["type"] == "out"),
        "trxCount": len(txs),
    }


def expected_cash(opening: float, s: dict) -> float:
    return opening + s["cashSales"] + s["cashIn"] - s["cashOut"]


@router.get("/shifts/current")
async def current_shift(user: User = Depends(STAFF)):
    doc = await get_open_shift(user.id)
    return {"shift": Shift.from_mongo(doc) if doc else None}


@router.post("/shifts/open")
async def open_shift(body: OpenShiftIn, user: User = Depends(STAFF)):
    if await get_open_shift(user.id):
        raise HTTPException(409, "Shift Anda masih terbuka")
    shift = Shift(id=await next_id(f"SHIFT-{local_date_str()}"), userId=user.id, userName=user.name,
                  openedAt=now_iso(), openingCash=body.openingCash)
    await db.shifts.insert_one(shift.to_mongo())
    return shift


@router.get("/shifts/current/movements")
async def current_movements(user: User = Depends(STAFF)):
    shift = await require_open_shift(user)
    docs = await db.cash_movements.find({"shiftId": shift["_id"]}).sort("timestamp", -1).to_list(None)
    return [CashMovement.from_mongo(d) for d in docs]


@router.post("/shifts/cash-movements")
async def add_movement(body: MovementIn, user: User = Depends(STAFF)):
    shift = await require_open_shift(user)
    if body.shift_id and body.shift_id != shift["_id"]:
        raise HTTPException(409, "Shift aktif sudah berganti. Muat ulang halaman.")
    cat_id = None
    category = None
    if body.type == "out":
        if body.expense_category_id is None:
            raise HTTPException(400, "Kategori pengeluaran wajib dipilih")
        category = await db.expense_categories.find_one({"_id": body.expense_category_id})
        if not category:
            raise HTTPException(400, "Kategori pengeluaran tidak ditemukan")
        cat_id = body.expense_category_id
    mov = CashMovement(id=await next_id("KAS", 4), shiftId=shift["_id"], userId=user.id, userName=user.name,
                       type=body.type, amount=body.amount, note=body.note, timestamp=now_iso(), expense_category_id=cat_id)
    if body.type == "out":
        await db.connect()
        try:
            async with db.pool.acquire() as conn:
                async with conn.transaction():
                    await db.cash_movements.insert_one(mov.to_mongo(), connection=conn)
                    await post_cash_movement_journal(
                        conn,
                        body.amount,
                        category["name"],
                        body.note,
                    )
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except asyncpg.PostgresError as error:
            raise HTTPException(
                400, f"Gagal mencatat kas keluar: {error}"
            ) from error
    else:
        await db.cash_movements.insert_one(mov.to_mongo())
    return mov


@router.post("/shifts/close")
async def close_shift(body: CloseShiftIn, user: User = Depends(STAFF)):
    shift = await require_open_shift(user)
    s = await summarize(shift["_id"])
    expected = expected_cash(shift["openingCash"], s)
    update = {**s, "status": "closed", "closedAt": now_iso(), "countedCash": body.countedCash,
              "expectedCash": expected, "difference": body.countedCash - expected, "note": body.note}
    await db.shifts.update_one({"_id": shift["_id"]}, {"$set": update})
    return Shift.from_mongo(await db.shifts.find_one({"_id": shift["_id"]}))


@router.get("/shifts")
async def list_shifts(_: User = Depends(ADMIN)):
    out = []
    for d in await db.shifts.find().sort("openedAt", -1).to_list(200):
        if d["status"] == "open":
            s = await summarize(d["_id"])
            d = {**d, **s, "expectedCash": expected_cash(d["openingCash"], s)}
        out.append(Shift.from_mongo(d))
    return out


@router.get("/shifts/{sid}/movements")
async def shift_movements(sid: str, _: User = Depends(ADMIN)):
    docs = await db.cash_movements.find({"shiftId": sid}).sort("timestamp", -1).to_list(None)
    return [CashMovement.from_mongo(d) for d in docs]
