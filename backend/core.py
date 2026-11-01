from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os  # noqa: E402
from datetime import datetime, timezone, timedelta  # noqa: E402
from typing import Optional, List  # noqa: E402

import bcrypt  # noqa: E402
import jwt  # noqa: E402
from fastapi import Depends, HTTPException, Request  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402,F401
from pgdb import PGDatabase  # noqa: E402
from pydantic import AliasChoices, BaseModel, ConfigDict, Field  # noqa: E402
from pymongo import ReturnDocument  # noqa: E402

db = PGDatabase(os.environ["DATABASE_URL"])
client = db

JWT_ALGORITHM = "HS256"
TOKEN_HOURS = 12
ALL_ROLES = ("admin", "kasir", "waiter")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_utc_iso(value: str) -> str:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"Format tanggal tidak valid: {value}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def is_hashed(pin: str) -> bool:
    return str(pin or "").startswith("$2")


def verify_pin(pin: str, hashed: str) -> bool:
    if not is_hashed(hashed):
        return False
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_token(user_id: str) -> str:
    payload = {"sub": user_id, "type": "access", "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


async def next_id(prefix: str, width: int = 3) -> str:
    if prefix == "CUST":
        seq = await db.next_customer_seq()
    else:
        doc = await db.counters.find_one_and_update(
            {"_id": prefix}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
        )
        seq = doc["seq"]
    return f"{prefix}-{seq:0{width}d}"


class BaseDocument(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    id: str = Field(validation_alias=AliasChoices("_id", "id"))

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)

    def to_mongo(self) -> dict:
        data = self.model_dump()
        data["_id"] = data.pop("id")
        return data


class User(BaseDocument):
    name: str
    role: str


class Product(BaseDocument):
    name: str
    category: str
    price: float
    price_ojol: float = 0
    type: str = "both"
    image: str = ""
    inventoryId: Optional[str] = None
    hpp: float = 0


class Table(BaseDocument):
    name: str
    area: str
    status: str = "available"
    orderData: Optional[dict] = None
    open_bill_id: Optional[str] = None
    kind: str = "table"
    x: Optional[int] = None
    y: Optional[int] = None


class Customer(BaseDocument):
    name: str
    wa: str = ""
    email: str = ""
    points: int = 0
    visits: int = 0
    total_spent: float = 0


class InventoryItem(BaseDocument):
    name: str
    type: str
    stock: float = 0
    unit: str
    cost_per_unit: float = 0
    min_stock: float = 0


class Recipe(BaseModel):
    model_config = ConfigDict(extra="ignore")
    productId: str
    inventoryId: str
    qty_needed: float

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)

    def to_mongo(self) -> dict:
        return {"_id": f"{self.productId}:{self.inventoryId}", **self.model_dump()}


class Transaction(BaseDocument):
    date: str
    orderTime: Optional[str] = None
    type: str
    method: str
    tableId: Optional[str] = None
    customerId: Optional[str] = None
    total: float
    items_json: List[dict]
    userId: Optional[str] = None
    cashGiven: float
    waiterName: str = ""
    change: float = 0
    tableName: str = ""
    customerName: str = ""
    userName: str = ""
    shiftId: Optional[str] = None
    waiterId: Optional[str] = None
    subtotal: float = 0
    discount: float = 0
    promoCode: Optional[str] = None
    promoDiscount: float = 0
    pointsRedeemed: int = 0
    pointsDiscount: float = 0
    queueNumber: Optional[str] = None

    def to_mongo(self) -> dict:
        data = super().to_mongo()
        if data["queueNumber"] is not None:
            data["queueNumber"] = str(data["queueNumber"])
        return data


class Purchase(BaseDocument):
    date: str
    supplier: str
    supplier_id: Optional[int] = None
    items_json: List[dict]
    total_cost: float
    metode_pembayaran: str = "cash"
    status_pembayaran: str = "lunas"
    sisa_utang: int = 0
    userId: Optional[str] = None
    userName: str = ""


class Expense(BaseDocument):
    date: str
    category: str
    category_id: Optional[int] = None
    description: str = ""
    amount: float
    userId: Optional[str] = None
    userName: str = ""


class OpenBill(BaseDocument):
    timestamp: str
    type: str
    customerName: str = ""
    total: float
    items_json: List[dict]
    userId: Optional[str] = None
    waiterName: str = ""
    tableId: Optional[str] = None
    customerId: Optional[str] = None
    userName: str = ""
    waiterId: Optional[str] = None
    queueNumber: Optional[str] = None

    def to_mongo(self) -> dict:
        data = super().to_mongo()
        if data["queueNumber"] is not None:
            data["queueNumber"] = str(data["queueNumber"])
        return data


async def get_current_user(request: Request) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Belum login")
    try:
        payload = jwt.decode(auth[7:], os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sesi berakhir, silakan login ulang")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token tidak valid")
    if payload.get("type") != "access":
        raise HTTPException(401, "Token tidak valid")
    doc = await db.users.find_one({"_id": payload["sub"]})
    if not doc:
        raise HTTPException(401, "Pengguna tidak ditemukan")
    return User.from_mongo(doc)


def require_roles(*roles):
    async def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Akses ditolak untuk peran ini")
        return user

    return dependency


async def recalc_hpp(product_id: str):
    product = await db.products.find_one({"_id": product_id})
    if not product:
        return
    recipes = await db.recipes.find({"productId": product_id}).to_list(None)
    if recipes:
        ids = [r["inventoryId"] for r in recipes]
        inv = {d["_id"]: d async for d in db.inventory.find({"_id": {"$in": ids}})}
        hpp = sum(r["qty_needed"] * inv[r["inventoryId"]]["cost_per_unit"] for r in recipes if r["inventoryId"] in inv)
    elif product.get("inventoryId"):
        inv = await db.inventory.find_one({"_id": product["inventoryId"]})
        if not inv:
            return
        hpp = inv["cost_per_unit"]
    else:
        return
    await db.products.update_one({"_id": product_id}, {"$set": {"hpp": round(hpp, 2)}})


async def recalc_hpp_for_inventory(inventory_id: str):
    pids = set(await db.recipes.distinct("productId", {"inventoryId": inventory_id}))
    pids |= set(await db.products.distinct("_id", {"inventoryId": inventory_id}))
    for pid in pids:
        await recalc_hpp(pid)
