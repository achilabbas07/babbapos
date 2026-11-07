from core import (  # noqa: I001
    ALL_ROLES, Customer, Expense, InventoryItem, OpenBill, Product, Purchase, Recipe, Table, Transaction, User,
    client, create_token, db, hash_pin, next_id, now_iso, recalc_hpp, recalc_hpp_for_inventory, require_roles,
    to_utc_iso, verify_pin, get_current_user,
)
from seed import seed_all
from shifts import router as shifts_router, get_open_shift
from targets import router as targets_router, log_order_diff, resolve_waiter
from discounts import router as discounts_router, promo_discount, points_discount, resolve_checkout_amounts
from routers.coa import router as coa_router
from variants import (
    router as variants_router,
    load_variants,
    check_materials,
    consume_checkout_stock,
    product_num,
    variant_hpp,
)
from finance import (
    account_type_from_category,
    ACCOUNT_BEBAN_SELISIH_STOK_ID,
    ACCOUNT_PERSEDIAAN_BAHAN_ID,
    checkout_cash_amounts,
    checkout_journal_account_codes,
    checkout_journal_lines,
    debt_payment_lines,
    expense_account_codes,
    expense_lines,
    get_account_balances,
    get_cash_bank_accounts,
    get_cash_bank_balances,
    get_dashboard_neraca_kas,
    get_chart_of_accounts,
    get_laporan_arus_kas,
    get_profit_and_loss_report,
    get_recent_finance_transactions,
    legacy_checkout_journal_entries,
    normalize_payment_method,
    normalize_checkout_payments,
    primary_checkout_method,
    post_cash_expense_journal,
    post_checkout_journal_entries,
    post_debt_payment_journal,
    post_hpp_checkout,
    post_finance_source,
    post_purchase_journal,
    purchase_journal_lines,
    resolve_expense_account_code,
    transaction_account_codes,
    transaction_lines,
)

import logging
import asyncpg
import sys
import traceback
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, List, Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.middleware.cors import CORSMiddleware
import os

app = FastAPI(title="F&B POS API")
api = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

ADMIN = require_roles("admin")
STAFF = require_roles("admin", "kasir")
CUSTOMER_STAFF = require_roles("admin", "kasir", "waiter")
ANY = require_roles(*ALL_ROLES)


# ---------- Input schemas ----------
class LoginIn(BaseModel):
    userId: str = Field(min_length=1)
    pin: str = Field(pattern=r"^\d{4,6}$")


class NameLoginIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    pin: str = Field(pattern=r"^\d{4,6}$")


class UserIn(BaseModel):
    name: str = Field(min_length=1)
    role: Literal["admin", "kasir", "waiter"]
    pin: Optional[str] = Field(None, pattern=r"^\d{4,6}$")


ORDER_TYPES = Literal["Dine In", "Takeaway", "Walk In", "Ojek Online"]
DIRECT_PAY_TYPES = ("Walk In", "Ojek Online")


class ProductIn(BaseModel):
    name: str = Field(min_length=1)
    category: str = Field(min_length=1)
    price: float = Field(ge=0)
    price_ojol: float = Field(0, ge=0)
    type: Literal["dine_in", "takeaway", "both"] = "both"
    image: str = ""
    inventoryId: Optional[str] = None
    hpp: float = Field(0, ge=0)


class RecipeLine(BaseModel):
    inventoryId: str
    qty_needed: float = Field(gt=0)


class TableIn(BaseModel):
    name: str = Field(min_length=1)
    area: str = Field(min_length=1)
    kind: Literal["table", "fixture"] = "table"


class TableLayoutItem(BaseModel):
    id: str
    x: int = Field(ge=0, le=60)
    y: int = Field(ge=0, le=60)


class PinIn(BaseModel):
    pin: str = Field(pattern=r"^\d{4,6}$")


class JournalLineIn(BaseModel):
    accountName: str = Field(min_length=1, max_length=160)
    accountCode: Optional[str] = Field(None, min_length=1, max_length=32)
    accountType: Literal["asset", "liability", "equity", "revenue", "expense"]
    debit: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)
    credit: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)

    @model_validator(mode="after")
    def validate_line(self):
        if not self.accountName.strip():
            raise ValueError("Nama akun wajib diisi.")
        if (self.debit > 0) == (self.credit > 0):
            raise ValueError("Setiap baris jurnal harus memiliki debit atau kredit, bukan keduanya.")
        return self


class JournalIn(BaseModel):
    date: date
    description: str = Field(min_length=1, max_length=240)
    lines: List[JournalLineIn] = Field(min_length=2)

    @model_validator(mode="after")
    def validate_journal(self):
        if not self.description.strip():
            raise ValueError("Keterangan jurnal wajib diisi.")
        if sum((line.debit for line in self.lines), Decimal("0")) != sum(
            (line.credit for line in self.lines), Decimal("0")
        ):
            raise ValueError("Total debit harus sama dengan total kredit.")
        return self


class MergeIn(BaseModel):
    sourceBillId: str


class MoveIn(BaseModel):
    tableId: str


class VoidIn(BaseModel):
    adminPin: Optional[str] = None
    reason: str = ""


class TableStatusIn(BaseModel):
    status: Literal["available", "reserved"]


class CustomerIn(BaseModel):
    name: str = Field(min_length=1)
    wa: str = ""
    email: str = ""


class InventoryIn(BaseModel):
    name: str = Field(min_length=1)
    type: str = Field(min_length=1)
    stock: float = Field(0, ge=0)
    unit: str = Field(min_length=1)
    cost_per_unit: float = Field(ge=0)
    min_stock: float = Field(0, ge=0)


class StockOpnameItemIn(BaseModel):
    item_id: str = Field(min_length=1, max_length=100)
    physical_qty: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    notes: str = Field(default="", max_length=500)

    @field_validator("item_id")
    @classmethod
    def strip_item_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("ID bahan wajib diisi.")
        return value

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: str) -> str:
        return value.strip()


class OrderItemIn(BaseModel):
    id: Optional[str] = None
    is_printed: bool = False
    productId: str
    qty: int = Field(gt=0)
    notes: str = ""
    variantId: Optional[int] = None


class OpenBillIn(BaseModel):
    queueNumber: Optional[int] = None
    type: ORDER_TYPES
    tableId: Optional[str] = None
    customerId: Optional[str] = None
    customerName: str = ""
    waiterName: str = ""
    items: List[OrderItemIn] = Field(min_length=1)
    adminPin: Optional[str] = None
    waiterId: Optional[str] = None


class PaymentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    method: Literal["Cash", "QRIS", "Card", "Debit"]
    amount: float = Field(gt=0)

    @field_validator("method", mode="before")
    @classmethod
    def normalize_payment(cls, value):
        return normalize_payment_method(value)


class TransactionIn(OpenBillIn):
    method: Literal["Cash", "QRIS", "Card", "Debit"]
    cashGiven: float = Field(0, ge=0)
    payments: List[PaymentIn] = Field(default_factory=list)
    openBillId: Optional[str] = None
    partial: bool = False
    promoCode: Optional[str] = None
    redeemPoints: bool = False
    discountPin: Optional[str] = None

    @field_validator("method", mode="before")
    @classmethod
    def normalize_payment_method(cls, value):
        return normalize_payment_method(value)


class PurchaseItemIn(BaseModel):
    inventoryId: str
    qty: float = Field(gt=0)
    cost_per_unit: float = Field(ge=0)


class PurchaseIn(BaseModel):
    date: Optional[str] = None
    supplier_id: int = Field(gt=0)
    items: List[PurchaseItemIn] = Field(min_length=1)
    metode_pembayaran: Literal["cash", "credit"] = "cash"
    sumber_dana_akun: Optional[str] = Field(None, min_length=1, max_length=32)

    @model_validator(mode="after")
    def require_funding_account_for_cash(self):
        if self.metode_pembayaran == "cash" and self.sumber_dana_akun is None:
            raise ValueError("Sumber dana wajib dipilih untuk pembelian tunai.")
        return self


class DebtPaymentIn(BaseModel):
    purchase_id: str = Field(min_length=1)
    amount: int = Field(gt=0)
    sumber_dana_akun: str = Field(min_length=1, max_length=32)


class SupplierPaymentIn(BaseModel):
    purchase_id: str = Field(min_length=1)
    sumber_dana_akun: str = Field(min_length=1, max_length=32)
    jumlah_bayar: float = Field(gt=0)


class ExpenseIn(BaseModel):
    date: Optional[str] = None
    category_id: int
    description: str = ""
    amount: float = Field(gt=0)


# ---------- Helpers ----------
async def get_or_404(coll: str, doc_id: str, label: str) -> dict:
    doc = await db[coll].find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(404, f"{label} {doc_id} tidak ditemukan")
    return doc


def unit_price(p: Product, order_type: str) -> float:
    return p.price_ojol if order_type == "Ojek Online" and p.price_ojol > 0 else p.price


async def build_items(items: List[OrderItemIn], order_type: str):
    ids = list({i.productId for i in items})
    prods = {d["_id"]: Product.from_mongo(d) async for d in db.products.find({"_id": {"$in": ids}})}
    vids = list({i.variantId for i in items if i.variantId is not None})
    variants = await load_variants(vids)
    v_hpp = await variant_hpp(vids)
    out = []
    for i in items:
        p = prods.get(i.productId)
        if not p:
            raise HTTPException(404, f"Produk {i.productId} tidak ditemukan")
        v = variants.get(i.variantId) if i.variantId is not None else None
        if i.variantId is not None and (not v or product_num(v["product_id"]) != product_num(p.id)):
            raise HTTPException(400, f"Varian #{i.variantId} tidak cocok untuk {p.name}")
        extra = float(v.get("additional_price") or 0) if v else 0
        price = unit_price(p, order_type) + extra
        out.append({"id": i.id or str(uuid4()), "is_printed": i.is_printed,
                    "productId": p.id, "productName": p.name, "qty": i.qty, "price": price, "hpp": v_hpp.get(v["_id"], p.hpp) if v else p.hpp,
                    "notes": i.notes, "subtotal": price * i.qty, "variantId": i.variantId,
                    "variantName": v["variant_name"] if v else "", "variantPrice": extra})
    return out, sum(x["subtotal"] for x in out)


async def occupy_table(table_id: str, bill: OpenBill, connection=None):
    if connection is None:
        t = await get_or_404("tables", table_id, "Meja")
    else:
        row = await connection.fetchrow('select * from public."tables" where id = $1 for update', table_id)
        if not row:
            raise HTTPException(404, "Meja tidak ditemukan")
        t = db.tables.decode(row)
    if t.get("kind") == "fixture":
        raise HTTPException(400, f"{t['name']} bukan meja")
    od = t.get("orderData") or {}
    if t["status"] == "occupied" and od.get("openBillId") != bill.id:
        raise HTTPException(409, f"{t['name']} sedang terisi")
    order_data = {"openBillId": bill.id, "customerName": bill.customerName, "waiterName": bill.waiterName,
                  "total": bill.total, "itemCount": sum(i["qty"] for i in bill.items_json),
                  "startTime": od.get("startTime") if od.get("openBillId") == bill.id else bill.timestamp}
    await db.tables.update_one({"_id": table_id}, {"$set": {
        "status": "occupied",
        "open_bill_id": bill.id,
        "orderData": order_data,
    }}, connection=connection)


async def free_table(table_id: Optional[str]):
    if table_id:
        await db.tables.update_one({"_id": table_id}, {"$set": {"status": "available", "open_bill_id": None, "orderData": None}})


async def mark_paid(table_id: str, trx: Transaction):
    order_data = {"lastTransactionId": trx.id, "total": trx.total, "paidAt": trx.date}
    await db.tables.update_one({"_id": table_id}, {"$set": {"status": "paid", "open_bill_id": None, "orderData": order_data}})


def client_ident(request: Request) -> str:
    return (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()


async def check_pin(
    request: Request,
    pin: str,
    role: Optional[str] = None,
    user_id: Optional[str] = None,
    name: Optional[str] = None,
) -> dict:
    ident = client_ident(request)
    now = datetime.now(timezone.utc)
    att = await db.login_attempts.find_one({"identifier": ident}) or {}
    locked = att.get("locked_until")
    if locked and datetime.fromisoformat(locked) > now:
        raise HTTPException(429, "Terlalu banyak percobaan PIN salah. Coba lagi dalam 15 menit.")
    query = {"role": role} if role else {}
    if user_id:
        query["_id"] = user_id
    if name:
        query["name"] = name
    async for doc in db.users.find(query):
        if verify_pin(pin, doc["pin"]):
            await db.login_attempts.delete_one({"identifier": ident})
            return doc
    count = 1 if locked else att.get("count", 0) + 1
    update = {"count": count, "locked_until": (now + timedelta(minutes=15)).isoformat() if count >= 5 else None}
    await db.login_attempts.update_one({"identifier": ident}, {"$set": update}, upsert=True)
    if name:
        detail = "Nama atau PIN salah"
    else:
        detail = "PIN admin salah" if role else "PIN salah"
    raise HTTPException(401, detail)


async def pin_in_use(pin: str, exclude: Optional[str] = None) -> bool:
    async for d in db.users.find({}):
        if d["_id"] != exclude and verify_pin(pin, d["pin"]):
            return True
    return False


# ---------- Auth ----------
@api.get("/")
async def root():
    return {"message": "F&B POS API"}


@api.get("/auth/users")
async def login_users():
    docs = await db.users.find({}, {"name": 1, "role": 1}).sort([("role", 1), ("name", 1)]).to_list(None)
    return [{"id": d["_id"], "name": d["name"], "role": d["role"]} for d in docs]


@api.post("/login")
async def login_by_name(body: NameLoginIn, request: Request):
    user = User.from_mongo(await check_pin(request, body.pin, name=body.name))
    return {
        "token": create_token(user.id),
        "user": {"id": user.id, "name": user.name, "role": user.role},
    }


@api.post("/auth/login")
async def login(body: LoginIn, request: Request):
    user = User.from_mongo(await check_pin(request, body.pin, user_id=body.userId))
    return {"token": create_token(user.id), "user": user}


@api.post("/auth/verify-admin")
async def verify_admin(body: PinIn, request: Request, _: User = Depends(ANY)):
    doc = await check_pin(request, body.pin, "admin")
    return {"ok": True, "adminName": doc["name"]}


@api.get("/auth/me")
async def me(user: User = Depends(get_current_user)):
    return user


# ---------- Users ----------
@api.get("/users")
async def list_users(_: User = Depends(ADMIN)):
    return [User.from_mongo(d) for d in await db.users.find().sort("_id").to_list(None)]


@api.get("/users/waiters")
async def list_waiters(_: User = Depends(ANY)):
    return [{"id": d["_id"], "name": d["name"]} async for d in db.users.find({"role": "waiter"}).sort("name", 1)]


@api.post("/users")
async def create_user(body: UserIn, _: User = Depends(ADMIN)):
    if not body.pin:
        raise HTTPException(400, "PIN wajib diisi (4-6 digit)")
    if await pin_in_use(body.pin):
        raise HTTPException(409, "PIN sudah digunakan pengguna lain")
    user = User(id=await next_id("USR"), name=body.name, role=body.role)
    await db.users.insert_one({**user.to_mongo(), "pin": hash_pin(body.pin)})
    return user


@api.put("/users/{uid}")
async def update_user(uid: str, body: UserIn, current: User = Depends(ADMIN)):
    await get_or_404("users", uid, "Pengguna")
    if uid == current.id and body.role != "admin":
        raise HTTPException(400, "Tidak bisa menurunkan peran akun sendiri")
    update = {"name": body.name, "role": body.role}
    if body.pin:
        if await pin_in_use(body.pin, exclude=uid):
            raise HTTPException(409, "PIN sudah digunakan pengguna lain")
        update["pin"] = hash_pin(body.pin)
    await db.users.update_one({"_id": uid}, {"$set": update})
    return User.from_mongo(await db.users.find_one({"_id": uid}))


@api.delete("/users/{uid}")
async def delete_user(uid: str, current: User = Depends(ADMIN)):
    if uid == current.id:
        raise HTTPException(400, "Tidak bisa menghapus akun sendiri")
    res = await db.users.delete_one({"_id": uid})
    if not res.deleted_count:
        raise HTTPException(404, "Pengguna tidak ditemukan")
    return {"ok": True}


# ---------- Products & Recipes ----------
async def validate_inventory_ref(inv_id: Optional[str]):
    if inv_id:
        await get_or_404("inventory", inv_id, "Bahan")


@api.get("/products")
async def list_products(_: User = Depends(ANY)):
    docs = await db.products.find().sort([("category", 1), ("name", 1)]).to_list(None)
    return [Product.from_mongo(d) for d in docs]


@api.get("/products/stock")
async def product_stock(_: User = Depends(ANY)):
    inv = {d["_id"]: float(d["stock"] or 0) async for d in db.inventory.find()}
    by_prod = defaultdict(list)
    async for r in db.recipes.find():
        by_prod[r["productId"]].append(r)
    out = {}
    async for p in db.products.find():
        recipe = [r for r in by_prod.get(p["_id"], []) if float(r["qty_needed"] or 0) > 0]
        if recipe:
            out[p["_id"]] = min(inv.get(r["inventoryId"], 0) / float(r["qty_needed"]) for r in recipe)
        elif p.get("inventoryId"):
            out[p["_id"]] = inv.get(p["inventoryId"], 0)
    return out


@api.post("/products")
async def create_product(body: ProductIn, _: User = Depends(ADMIN)):
    await validate_inventory_ref(body.inventoryId)
    product = Product(id=await next_id("PRD"), **body.model_dump())
    await db.products.insert_one(product.to_mongo())
    await recalc_hpp(product.id)
    return Product.from_mongo(await db.products.find_one({"_id": product.id}))


@api.put("/products/{pid}")
async def update_product(pid: str, body: ProductIn, _: User = Depends(ADMIN)):
    await get_or_404("products", pid, "Produk")
    await validate_inventory_ref(body.inventoryId)
    await db.products.update_one({"_id": pid}, {"$set": body.model_dump()})
    await recalc_hpp(pid)
    return Product.from_mongo(await db.products.find_one({"_id": pid}))


@api.delete("/products/{pid}")
async def delete_product(pid: str, _: User = Depends(ADMIN)):
    res = await db.products.delete_one({"_id": pid})
    if not res.deleted_count:
        raise HTTPException(404, "Produk tidak ditemukan")
    await db.recipes.delete_many({"productId": pid})
    return {"ok": True}


@api.get("/recipes")
async def list_recipes(_: User = Depends(ANY)):
    return [Recipe.from_mongo(d) for d in await db.recipes.find().to_list(None)]


@api.get("/products/{pid}/recipes")
async def product_recipes(pid: str, _: User = Depends(ANY)):
    return [Recipe.from_mongo(d) for d in await db.recipes.find({"productId": pid}).to_list(None)]


@api.put("/products/{pid}/recipes")
async def set_recipes(pid: str, lines: List[RecipeLine], _: User = Depends(ADMIN)):
    await get_or_404("products", pid, "Produk")
    ids = [ln.inventoryId for ln in lines]
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "Bahan yang sama tidak boleh muncul dua kali dalam resep")
    for inv_id in ids:
        await get_or_404("inventory", inv_id, "Bahan")
    await db.recipes.delete_many({"productId": pid})
    recipes = [Recipe(productId=pid, inventoryId=ln.inventoryId, qty_needed=ln.qty_needed) for ln in lines]
    if recipes:
        await db.recipes.insert_many([r.to_mongo() for r in recipes])
    await recalc_hpp(pid)
    return {"product": Product.from_mongo(await db.products.find_one({"_id": pid})), "recipes": recipes}


# ---------- Inventory ----------
@api.get("/inventory")
async def list_inventory(_: User = Depends(ADMIN)):
    return [InventoryItem.from_mongo(d) for d in await db.inventory.find().sort("_id").to_list(None)]


@api.post("/inventory")
async def create_inventory(body: InventoryIn, _: User = Depends(ADMIN)):
    item = InventoryItem(id=await next_id("INV"), **body.model_dump())
    await db.inventory.insert_one(item.to_mongo())
    return item


@api.put("/inventory/{iid}")
async def update_inventory(iid: str, body: InventoryIn, _: User = Depends(ADMIN)):
    old = await get_or_404("inventory", iid, "Bahan")
    await db.inventory.update_one({"_id": iid}, {"$set": body.model_dump()})
    if old["cost_per_unit"] != body.cost_per_unit:
        await recalc_hpp_for_inventory(iid)
    return InventoryItem.from_mongo(await db.inventory.find_one({"_id": iid}))


@api.delete("/inventory/{iid}")
async def delete_inventory(iid: str, _: User = Depends(ADMIN)):
    await get_or_404("inventory", iid, "Bahan")
    pids = set(await db.recipes.distinct("productId", {"inventoryId": iid}))
    pids |= set(await db.products.distinct("_id", {"inventoryId": iid}))
    if pids:
        names = [d["name"] async for d in db.products.find({"_id": {"$in": list(pids)}})]
        raise HTTPException(409, f"Bahan masih dipakai oleh produk: {', '.join(names)}")
    await db.inventory.delete_one({"_id": iid})
    return {"ok": True}


@api.post("/inventory/opname", status_code=201)
async def create_inventory_opname(
    body: List[StockOpnameItemIn] = Body(..., min_length=1, max_length=500),
    user: User = Depends(ADMIN),
):
    item_ids = [line.item_id for line in body]
    if len(item_ids) != len(set(item_ids)):
        raise HTTPException(422, "Bahan yang sama tidak boleh muncul dua kali dalam satu opname.")

    await db.connect()
    session_id = uuid4()
    created_at = datetime.now(timezone.utc)
    opname_rows = []
    stage = "membaca akun Chart of Accounts"
    try:
        async with db.pool.acquire() as connection:
            async with connection.transaction():
                accounts = await connection.fetch(
                    """
                    select
                      coalesce(
                        nullif(to_jsonb(account)->>'account_code', ''),
                        nullif(to_jsonb(account)->>'kode_akun', ''),
                        nullif(to_jsonb(account)->>'code', ''),
                        nullif(to_jsonb(account)->>'kode', '')
                      ) as account_code,
                      coalesce(
                        nullif(btrim(to_jsonb(account)->>'account_name'), ''),
                        nullif(btrim(to_jsonb(account)->>'nama_akun'), ''),
                        nullif(btrim(to_jsonb(account)->>'name'), '')
                      ) as account_name,
                      coalesce(
                        nullif(btrim(to_jsonb(account)->>'account_category'), ''),
                        nullif(btrim(to_jsonb(account)->>'kategori_akun'), ''),
                        nullif(btrim(to_jsonb(account)->>'category'), '')
                      ) as account_category
                    from public.chart_of_accounts as account
                    where coalesce(
                      nullif(to_jsonb(account)->>'account_code', ''),
                      nullif(to_jsonb(account)->>'kode_akun', ''),
                      nullif(to_jsonb(account)->>'code', ''),
                      nullif(to_jsonb(account)->>'kode', '')
                    ) = any($1::text[])
                    """,
                    [ACCOUNT_BEBAN_SELISIH_STOK_ID, ACCOUNT_PERSEDIAAN_BAHAN_ID],
                )
                accounts_by_code = {row["account_code"]: row for row in accounts}
                expense_account = accounts_by_code.get(ACCOUNT_BEBAN_SELISIH_STOK_ID)
                inventory_account = accounts_by_code.get(ACCOUNT_PERSEDIAAN_BAHAN_ID)
                if (
                    len(accounts) != 2
                    or not expense_account
                    or not expense_account["account_name"]
                    or account_type_from_category(expense_account["account_category"]) != "expense"
                    or not inventory_account
                    or not inventory_account["account_name"]
                    or account_type_from_category(inventory_account["account_category"]) != "asset"
                ):
                    raise HTTPException(
                        422,
                        "Akun Beban Selisih Stok (5-51099) atau Persediaan Bahan Baku (1-10003) "
                        "belum tersedia dengan tipe akun yang sesuai di Chart of Accounts.",
                    )

                stage = "membaca dan mengunci stok bahan"
                inventory_rows = await connection.fetch(
                    """
                    select id, name, type, unit, stock, cost_per_unit
                    from public.inventory
                    where id = any($1::text[])
                    order by id
                    for update
                    """,
                    item_ids,
                )
                inventory_by_id = {row["id"]: row for row in inventory_rows}
                missing_ids = [item_id for item_id in item_ids if item_id not in inventory_by_id]
                if missing_ids:
                    raise HTTPException(404, f"Bahan tidak ditemukan: {', '.join(missing_ids)}.")

                for line in body:
                    item = inventory_by_id[line.item_id]
                    if (item["type"] or "").strip().casefold() != "bahan baku":
                        raise HTTPException(422, f"{item['name']} bukan bahan baku dan tidak dapat diopname.")

                    system_qty = Decimal(str(item["stock"]))
                    difference = line.physical_qty - system_qty
                    cost_per_unit = Decimal(str(item["cost_per_unit"]))
                    loss_value = (
                        abs(difference * cost_per_unit).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                        if difference < 0
                        else Decimal("0.00")
                    )
                    opname_rows.append({
                        "item_id": line.item_id,
                        "item_name": item["name"],
                        "unit": item["unit"],
                        "system_qty": system_qty,
                        "physical_qty": line.physical_qty,
                        "difference": difference,
                        "cost_per_unit": cost_per_unit,
                        "loss_value": loss_value,
                        "notes": line.notes,
                    })

                stage = "memperbarui stok bahan"
                await connection.executemany(
                    """
                    update public.inventory
                    set stock = $1
                    where id = $2
                    """,
                    [(row["physical_qty"], row["item_id"]) for row in opname_rows],
                )
                stage = "menyimpan riwayat stok opname"
                await connection.executemany(
                    """
                    insert into public.stock_adjustments
                      (session_id, item_id, item_name, item_unit, system_qty, physical_qty,
                       difference, cost_per_unit, loss_value, notes, created_by, created_at)
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """,
                    [
                        (
                            session_id,
                            row["item_id"],
                            row["item_name"],
                            row["unit"],
                            row["system_qty"],
                            row["physical_qty"],
                            row["difference"],
                            row["cost_per_unit"],
                            row["loss_value"],
                            row["notes"],
                            user.id,
                            created_at,
                        )
                        for row in opname_rows
                    ],
                )

                loss_rows = [row for row in opname_rows if row["loss_value"] > 0]
                total_loss = sum((row["loss_value"] for row in loss_rows), Decimal("0.00"))
                if total_loss > 0:
                    stage = "membuat jurnal kerugian stok"
                    description = "; ".join(
                        f"{row['item_name']}: {row['notes'] or 'Selisih stok opname'}"
                        for row in loss_rows
                    )
                    await post_finance_source(
                        connection,
                        "stock_opname",
                        str(session_id),
                        created_at.date(),
                        description,
                        user.id,
                        [
                            (expense_account["account_name"], "expense", total_loss, Decimal("0.00")),
                            (inventory_account["account_name"], "asset", Decimal("0.00"), total_loss),
                        ],
                        account_codes=[ACCOUNT_BEBAN_SELISIH_STOK_ID, ACCOUNT_PERSEDIAAN_BAHAN_ID],
                    )
    except HTTPException:
        raise
    except Exception as error:
        error_id = uuid4()
        print(
            f"STOCK_OPNAME_FAILURE error_id={error_id} session_id={session_id} stage={stage} error={error!r}",
            file=sys.stderr,
            flush=True,
        )
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(
            500,
            f"Stok opname gagal disimpan. Perubahan telah dibatalkan. ID insiden: {error_id}.",
        ) from error

    return {
        "session_id": str(session_id),
        "created_at": created_at.isoformat(),
        "created_by": user.id,
        "item_count": len(opname_rows),
        "loss_total": sum((row["loss_value"] for row in opname_rows), Decimal("0.00")),
        "items": opname_rows,
    }


@api.get("/inventory/opname")
async def list_inventory_opname(_: User = Depends(ADMIN)):
    await db.connect()
    rows = await db.pool.fetch(
        """
        select
          session_id,
          min(created_at) as created_at,
          (array_agg(created_by order by created_at desc))[1] as created_by,
          count(*) as item_count,
          coalesce(sum(loss_value), 0) as loss_total,
          jsonb_agg(
            jsonb_build_object(
              'item_id', item_id,
              'item_name', item_name,
              'unit', item_unit,
              'system_qty', system_qty,
              'physical_qty', physical_qty,
              'difference', difference,
              'cost_per_unit', cost_per_unit,
              'loss_value', loss_value,
              'notes', notes
            ) order by item_name
          ) as items
        from public.stock_adjustments
        group by session_id
        order by min(created_at) desc
        limit 20
        """
    )
    return [
        {
            "session_id": str(row["session_id"]),
            "created_at": row["created_at"].isoformat(),
            "created_by": row["created_by"],
            "item_count": row["item_count"],
            "loss_total": row["loss_total"],
            "items": row["items"],
        }
        for row in rows
    ]


# ---------- Tables ----------
@api.get("/tables")
async def list_tables(_: User = Depends(ANY)):
    return [Table.from_mongo(d) for d in await db.tables.find().sort([("area", 1), ("_id", 1)]).to_list(None)]


@api.post("/tables")
async def create_table(body: TableIn, _: User = Depends(ADMIN)):
    table = Table(id=await next_id("TBL"), **body.model_dump())
    await db.tables.insert_one(table.to_mongo())
    return table


@api.put("/tables/layout")
async def save_table_layout(items: List[TableLayoutItem], _: User = Depends(ADMIN)):
    for it in items:
        await db.tables.update_one({"_id": it.id}, {"$set": {"x": it.x, "y": it.y}})
    return {"ok": True, "updated": len(items)}


@api.put("/tables/{tid}")
async def update_table(tid: str, body: TableIn, _: User = Depends(ADMIN)):
    await get_or_404("tables", tid, "Meja")
    await db.tables.update_one({"_id": tid}, {"$set": body.model_dump()})
    return Table.from_mongo(await db.tables.find_one({"_id": tid}))


@api.put("/tables/{tid}/status")
async def set_table_status(tid: str, body: TableStatusIn, _: User = Depends(ANY)):
    t = await get_or_404("tables", tid, "Meja")
    if t["status"] == "occupied":
        raise HTTPException(409, "Meja sedang terisi, selesaikan atau batalkan open bill terlebih dahulu")
    await db.tables.update_one({"_id": tid}, {"$set": {"status": body.status}})
    return Table.from_mongo(await db.tables.find_one({"_id": tid}))


@api.delete("/tables/{tid}")
async def delete_table(tid: str, _: User = Depends(ADMIN)):
    t = await get_or_404("tables", tid, "Meja")
    if t["status"] == "occupied":
        raise HTTPException(409, "Meja sedang terisi, tidak bisa dihapus")
    await db.tables.delete_one({"_id": tid})
    return {"ok": True}


# ---------- Customers ----------
@api.get("/customers")
async def list_customers(_: User = Depends(ANY)):
    return [Customer.from_mongo(d) for d in await db.customers.find().sort("name", 1).to_list(None)]


@api.get("/customers/top")
async def top_customers(_: User = Depends(ANY)):
    docs = await db.customers.find({"total_spent": {"$gt": 0}}).sort([("total_spent", -1), ("points", -1)]).to_list(10)
    return [Customer.from_mongo(d) for d in docs]


@api.post("/customers")
async def create_customer(body: CustomerIn, _: User = Depends(CUSTOMER_STAFF)):
    c = Customer(id=await next_id("CUST"), **body.model_dump())
    await db.customers.insert_one(c.to_mongo())
    return c


@api.put("/customers/{cid}")
async def update_customer(cid: str, body: CustomerIn, _: User = Depends(CUSTOMER_STAFF)):
    await get_or_404("customers", cid, "Pelanggan")
    await db.customers.update_one({"_id": cid}, {"$set": body.model_dump()})
    return Customer.from_mongo(await db.customers.find_one({"_id": cid}))


@api.delete("/customers/{cid}")
async def delete_customer(cid: str, _: User = Depends(ADMIN)):
    res = await db.customers.delete_one({"_id": cid})
    if not res.deleted_count:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    return {"ok": True}


# ---------- Open Bills ----------
async def compose_bill(body: OpenBillIn, user: User, bill_id: str, timestamp: str) -> OpenBill:
    if body.type in DIRECT_PAY_TYPES:
        raise HTTPException(400, f"Pesanan {body.type} harus langsung dibayar, tidak bisa disimpan sebagai open bill")
    items, total = await build_items(body.items, body.type)
    cust = await get_or_404("customers", body.customerId, "Pelanggan") if body.customerId else None
    wid, wname = await resolve_waiter(body.waiterId, body.waiterName, user)
    return OpenBill(
        id=bill_id, timestamp=timestamp, type=body.type, total=total, items_json=items,
        queueNumber=str(body.queueNumber) if body.queueNumber is not None else None,
        customerName=body.customerName or (cust["name"] if cust else ""), customerId=body.customerId,
        tableId=body.tableId if body.type == "Dine In" else None, userId=user.id, userName=user.name,
        waiterName=wname, waiterId=wid,
    )


@api.get("/open-bills")
async def list_open_bills(_: User = Depends(ANY)):
    return [OpenBill.from_mongo(d) for d in await db.open_bills.find().sort("timestamp", -1).to_list(None)]


@api.get("/open-bills/{bid}")
async def get_open_bill(bid: str, _: User = Depends(ANY)):
    bill = OpenBill.from_mongo(await get_or_404("open_bills", bid, "Open bill"))
    if not bill.customerName and bill.customerId:
        customer = await db.customers.find_one({"_id": bill.customerId})
        if customer and customer.get("name"):
            bill = bill.model_copy(update={"customerName": customer["name"]})
    return bill


@api.post("/open-bills")
async def create_open_bill(body: OpenBillIn, user: User = Depends(ANY)):
    stage = "preparing bill"
    try:
        bill = await compose_bill(body, user, await next_id("BILL"), now_iso())
        stage = "checking variant ingredients"
        await check_materials(bill.items_json)
        await db.connect()
        async with db.pool.acquire() as connection:
            async with connection.transaction():
                stage = "inserting open bill"
                await db.open_bills.insert_one(bill.to_mongo(), connection=connection)
                if bill.tableId:
                    stage = "verifying inserted open bill"
                    inserted_bill_id = await connection.fetchval(
                        "SELECT id FROM public.open_bills WHERE id = $1",
                        bill.id,
                    )
                    if inserted_bill_id != bill.id:
                        raise RuntimeError(
                            f"Open bill {bill.id} tidak ditemukan setelah INSERT "
                            "pada transaksi checkout yang sama"
                        )
                    stage = "updating table relation"
                    await occupy_table(bill.tableId, bill, connection=connection)
                stage = "inserting waiter order log"
                await log_order_diff(
                    [],
                    (None, ""),
                    bill.items_json,
                    (bill.waiterId, bill.waiterName),
                    "bill_create",
                    bill.id,
                    connection=connection,
                )
        return bill
    except HTTPException as err:
        return JSONResponse(status_code=err.status_code, content={"detail": err.detail}, headers=err.headers)
    except Exception as err:
        logger.exception("Failed to create open bill during %s", stage)
        return JSONResponse(
            status_code=500,
            content={"error": str(err), "stage": stage},
        )


async def authorize_reduction(request: Request, user: User, bill: OpenBill, items: List[OrderItemIn], admin_pin: Optional[str]):
    if user.role == "admin":
        return
    new_qty = defaultdict(int)
    for i in items:
        new_qty[(i.productId, i.variantId)] += i.qty
    reduced = [o["productName"] for o in bill.items_json if new_qty.get((o["productId"], o.get("variantId")), 0) < o["qty"]]
    if not reduced:
        return
    if not admin_pin:
        raise HTTPException(403, f"Mengurangi/menghapus item tersimpan ({', '.join(reduced)}) butuh otorisasi PIN admin")
    await check_pin(request, admin_pin, "admin")


@api.put("/open-bills/{bid}")
async def update_open_bill(bid: str, body: OpenBillIn, request: Request, user: User = Depends(ANY)):
    old = OpenBill.from_mongo(await get_or_404("open_bills", bid, "Open bill"))
    await authorize_reduction(request, user, old, body.items, body.adminPin)
    bill = await compose_bill(body, user, bid, old.timestamp)
    if body.queueNumber is None:
        bill.queueNumber = old.queueNumber
    printed_by_id = {
        item.get("id"): item.get("is_printed", False)
        for item in old.items_json
        if item.get("id")
    }
    for item in bill.items_json:
        if printed_by_id.get(item["id"], False):
            item["is_printed"] = True
    await check_materials(bill.items_json)
    bill.userId, bill.userName = old.userId, old.userName
    if bill.tableId:
        await occupy_table(bill.tableId, bill)
    if old.tableId and old.tableId != bill.tableId:
        await free_table(old.tableId)
    await db.open_bills.replace_one({"_id": bid}, bill.to_mongo())
    actor_waiter = (user.id, user.name) if user.role == "waiter" else None
    await log_order_diff(
        old.items_json,
        (old.waiterId, old.waiterName),
        bill.items_json,
        (bill.waiterId, bill.waiterName),
        "bill_update",
        bid,
        actor_waiter=actor_waiter,
    )
    return bill


async def save_bill_items(bill: OpenBill, items: List[OrderItemIn]) -> OpenBill:
    new_items, total = await build_items(items, bill.type)
    updated = bill.model_copy(update={"items_json": new_items, "total": total})
    await db.open_bills.replace_one({"_id": bill.id}, updated.to_mongo())
    if updated.tableId:
        await occupy_table(updated.tableId, updated)
    return updated


def remaining_items(bill_items: List[dict], paid: List[dict]) -> List[OrderItemIn]:
    if bill_items and paid and all(item.get("id") for item in bill_items + paid):
        paid_by_id = defaultdict(int)
        for item in paid:
            paid_by_id[item["id"]] += item["qty"]
        remaining = []
        for item in bill_items:
            paid_qty = paid_by_id.pop(item["id"], 0)
            if paid_qty > item["qty"]:
                raise HTTPException(400, f"Jumlah {item['productName']} melebihi pesanan di bill")
            qty = item["qty"] - paid_qty
            if qty > 0:
                remaining.append(OrderItemIn(
                    id=item["id"],
                    is_printed=item.get("is_printed", False),
                    productId=item["productId"],
                    variantId=item.get("variantId"),
                    qty=qty,
                    notes=item.get("notes", ""),
                ))
        if paid_by_id:
            raise HTTPException(400, "Item yang dibayar tidak ditemukan di bill")
        return remaining

    left, notes, item_ids, printed = defaultdict(int), {}, {}, {}
    for i in bill_items:
        k = (i["productId"], i.get("variantId"))
        left[k] += i["qty"]
        notes[k] = notes.get(k) or i.get("notes", "")
        item_ids[k] = item_ids.get(k) or i.get("id")
        printed[k] = printed.get(k, False) or i.get("is_printed", False)
    for p in paid:
        k = (p["productId"], p.get("variantId"))
        if left.get(k, 0) < p["qty"]:
            raise HTTPException(400, f"Jumlah {p['productName']} melebihi pesanan di bill")
        left[k] -= p["qty"]
    return [
        OrderItemIn(
            id=item_ids.get(k), is_printed=printed.get(k, False),
            productId=k[0], variantId=k[1], qty=v, notes=notes.get(k, ""),
        )
        for k, v in left.items() if v > 0
    ]


@api.post("/open-bills/{bid}/void")
async def void_open_bill(bid: str, body: VoidIn, request: Request, user: User = Depends(ANY)):
    bill = await get_or_404("open_bills", bid, "Open bill")
    if user.role == "admin":
        approver = user.name
    else:
        if not body.adminPin:
            raise HTTPException(403, "Void membutuhkan otorisasi PIN admin")
        approver = (await check_pin(request, body.adminPin, "admin"))["name"]
    await db.void_logs.insert_one({
        "_id": await next_id("VOID"), "billId": bid, "timestamp": now_iso(), "tableId": bill.get("tableId"),
        "total": bill["total"], "items_json": bill["items_json"], "reason": body.reason,
        "requestedBy": user.name, "authorizedBy": approver,
    })
    await db.open_bills.delete_one({"_id": bid})
    await free_table(bill.get("tableId"))
    await log_order_diff(bill["items_json"], (bill.get("waiterId"), bill.get("waiterName", "")), [], (bill.get("waiterId"), ""), "void", bid)
    return {"ok": True, "authorizedBy": approver}


@api.post("/open-bills/{bid}/merge")
async def merge_open_bills(bid: str, body: MergeIn, _: User = Depends(ANY)):
    if body.sourceBillId == bid:
        raise HTTPException(400, "Tidak bisa menggabungkan bill dengan dirinya sendiri")
    target = OpenBill.from_mongo(await get_or_404("open_bills", bid, "Open bill"))
    source = OpenBill.from_mongo(await get_or_404("open_bills", body.sourceBillId, "Open bill"))
    qty, notes = defaultdict(int), {}
    for i in target.items_json + source.items_json:
        k = (i["productId"], i.get("variantId"))
        qty[k] += i["qty"]
        notes[k] = notes.get(k) or i.get("notes", "")
    await db.open_bills.delete_one({"_id": source.id})
    await free_table(source.tableId)
    return await save_bill_items(target, [OrderItemIn(productId=k[0], variantId=k[1], qty=v, notes=notes[k]) for k, v in qty.items()])


@api.post("/open-bills/{bid}/move")
async def move_open_bill(bid: str, body: MoveIn, _: User = Depends(ANY)):
    bill = OpenBill.from_mongo(await get_or_404("open_bills", bid, "Open bill"))
    if body.tableId == bill.tableId:
        raise HTTPException(400, "Meja tujuan sama dengan meja saat ini")
    moved = bill.model_copy(update={"tableId": body.tableId, "type": "Dine In"})
    await occupy_table(body.tableId, moved)
    await db.open_bills.update_one({"_id": bid}, {"$set": {"tableId": body.tableId, "type": "Dine In"}})
    await free_table(bill.tableId)
    return moved


# ---------- Transactions ----------
@api.get("/transactions")
async def list_transactions(start: Optional[str] = None, end: Optional[str] = None, customerId: Optional[str] = None,
                            _: User = Depends(ADMIN)):
    query = {}
    if start or end:
        query["date"] = {}
        if start:
            query["date"]["$gte"] = to_utc_iso(start)
        if end:
            query["date"]["$lt"] = to_utc_iso(end)
    if customerId:
        query["customerId"] = customerId
    docs = await db.transactions.find(query).sort("date", -1).to_list(1000)
    return [Transaction.from_mongo(d) for d in docs]


@api.get("/transactions/{tid}")
async def get_transaction(tid: str, _: User = Depends(STAFF)):
    return Transaction.from_mongo(await get_or_404("transactions", tid, "Transaksi"))


@api.post("/transactions")
async def create_transaction(body: TransactionIn, request: Request, user: User = Depends(STAFF)):
    bill = OpenBill.from_mongo(await get_or_404("open_bills", body.openBillId, "Open bill")) if body.openBillId else None
    if body.partial and not bill:
        raise HTTPException(400, "Pisah bill membutuhkan open bill")
    if bill and not body.partial:
        await authorize_reduction(request, user, bill, body.items, body.adminPin)
    table_id = (body.tableId or (bill.tableId if bill else None)) if body.type == "Dine In" else None
    customer_id = body.customerId or (bill.customerId if bill else None)
    table = await get_or_404("tables", table_id, "Meja") if table_id else None
    stale_table_occupancy = False
    if table and table["status"] == "occupied" and (table.get("orderData") or {}).get("openBillId") != (bill.id if bill else None):
        if not bill or bill.tableId != table_id:
            raise HTTPException(409, f"{table['name']} sedang terisi oleh open bill lain")
        other_bill = await db.open_bills.find_one({"tableId": table_id, "_id": {"$ne": bill.id}})
        if other_bill:
            raise HTTPException(409, f"{table['name']} sedang terisi oleh open bill lain")
        stale_table_occupancy = True
    customer = await get_or_404("customers", customer_id, "Pelanggan") if customer_id else None
    shift = await get_open_shift(user.id)
    if user.role == "kasir" and not shift:
        raise HTTPException(400, "Buka shift kasir terlebih dahulu")
    items, subtotal = await build_items(body.items, body.type)
    remaining = remaining_items(bill.items_json, items) if body.partial else []
    promo = {"code": None, "discount": 0}
    pts = {"pointsRequired": 0, "discount": 0}
    if body.promoCode or body.redeemPoints:
        if not body.discountPin:
            raise HTTPException(403, "Diskon & hadiah membutuhkan otorisasi PIN admin")
        await check_pin(request, body.discountPin, "admin")
        if body.promoCode:
            promo = await promo_discount(body.promoCode, subtotal)
        if body.redeemPoints:
            pts = await points_discount(customer_id)
    try:
        amounts = resolve_checkout_amounts(subtotal, promo.get("discount"), pts.get("discount"))
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    promo_amount = amounts["promoDiscount"]
    points_amount = amounts["pointsDiscount"]
    total = amounts["total"]
    try:
        checkout_payments = normalize_checkout_payments(
            total,
            [payment.model_dump() for payment in body.payments] if body.payments else None,
            body.method,
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    method = primary_checkout_method(checkout_payments, body.method)
    cash, change = checkout_cash_amounts(checkout_payments, total, body.cashGiven)
    if method == "Cash" and cash < total:
        raise HTTPException(400, "Uang tunai kurang dari total")

    if body.waiterId:
        wid, wname = await resolve_waiter(body.waiterId, "", user)
    elif bill:
        wid, wname = bill.waiterId, body.waiterName or bill.waiterName
    else:
        wid, wname = None, body.waiterName

    queue_number = body.queueNumber
    if queue_number is None and bill:
        queue_number = bill.queueNumber
    transaction_time = now_iso()
    trx = Transaction(
        id=await next_id(f"TRX-{datetime.now(timezone.utc):%Y%m%d}", 4), date=transaction_time,
        orderTime=bill.timestamp if bill else transaction_time, type=body.type,
        method=method, tableId=table_id, customerId=customer_id, total=total, items_json=items,
        userId=user.id, userName=user.name, cashGiven=cash, change=change, shiftId=shift["_id"] if shift else None,
        waiterName=wname, waiterId=wid, subtotal=subtotal, discount=subtotal - total, promoCode=promo["code"],
        promoDiscount=promo_amount, pointsRedeemed=pts["pointsRequired"], pointsDiscount=points_amount,
        tableName=table["name"] if table else "",
        customerName=customer["name"] if customer else (body.customerName or (bill.customerName if bill else "")),
        queueNumber=str(queue_number) if queue_number is not None else None,
        payments=checkout_payments,
    )
    checkout_lines = checkout_journal_lines(total, method, items, checkout_payments)
    checkout_codes = checkout_journal_account_codes(total, method, items, checkout_payments)
    try:
        await db.connect()
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await db.transactions.insert_one(trx.to_mongo(), connection=conn)
                if trx.total > 0:
                    await post_checkout_journal_entries(
                        conn,
                        {
                            "transaction_id": trx.id,
                            "payment_method": trx.method,
                            "total": trx.total,
                            "journal_entries": legacy_checkout_journal_entries(checkout_lines, checkout_codes),
                        },
                    )
                await post_finance_source(
                    conn,
                    "transaction",
                    trx.id,
                    date.fromisoformat(trx.date[:10]),
                    f"Penjualan {trx.id}",
                    user.id,
                    checkout_lines,
                    checkout_codes,
                )
                await consume_checkout_stock(conn, items)
                total_hpp = sum(
                    Decimal(str(item.get("hpp", 0) or 0))
                    * Decimal(str(item.get("qty", 0) or 0))
                    for item in items
                )
                if total_hpp > 0:
                    await post_hpp_checkout(
                        conn,
                        {"transaction_id": trx.id, "total_hpp": total_hpp},
                    )
    except asyncpg.PostgresError as err:
        message = getattr(err, "message", None) or str(err)
        raise HTTPException(400, f"Checkout gagal: {message}") from err
    except ValueError as err:
        raise HTTPException(400, f"Checkout gagal: {err}") from err
    if not body.partial:
        old_items, old_w = (bill.items_json, (bill.waiterId, bill.waiterName)) if bill else ([], (None, ""))
        await log_order_diff(old_items, old_w, items, (wid, wname), "payment" if bill else "direct", trx.id)
    if remaining:
        if stale_table_occupancy:
            await free_table(table_id)
        await save_bill_items(bill, remaining)
    else:
        if bill:
            await db.open_bills.delete_one({"_id": bill.id})
        for tid in {bill.tableId if bill else None, table_id} - {None}:
            await mark_paid(tid, trx)
    return trx


# ---------- Purchases ----------
@api.get("/purchases")
async def list_purchases(_: User = Depends(ADMIN)):
    return [Purchase.from_mongo(d) for d in await db.purchases.find().sort("date", -1).to_list(1000)]


@api.post("/purchases")
async def create_purchase(body: PurchaseIn, user: User = Depends(ADMIN)):
    await db.connect()
    supplier = await db.pool.fetchrow(
        "select id, nama_supplier from public.master_suppliers where id = $1",
        body.supplier_id,
    )
    if supplier is None:
        raise HTTPException(404, "Supplier tidak ditemukan.")
    ids = list({i.inventoryId for i in body.items})
    inv = {d["_id"]: d async for d in db.inventory.find({"_id": {"$in": ids}})}
    missing = [i for i in ids if i not in inv]
    if missing:
        raise HTTPException(404, f"Bahan tidak ditemukan: {', '.join(missing)}")
    items = [{"inventoryId": i.inventoryId, "name": inv[i.inventoryId]["name"], "unit": inv[i.inventoryId]["unit"],
              "qty": i.qty, "cost_per_unit": i.cost_per_unit, "subtotal": i.qty * i.cost_per_unit} for i in body.items]
    total_cost = int(round(sum(i["subtotal"] for i in items)))
    purchase = Purchase(id=await next_id(f"PO-{datetime.now(timezone.utc):%Y%m%d}"),
                        date=to_utc_iso(body.date) if body.date else now_iso(),
                        supplier=supplier["nama_supplier"], supplier_id=supplier["id"],
                        items_json=items, total_cost=total_cost,
                        metode_pembayaran=body.metode_pembayaran,
                        status_pembayaran="belum_lunas" if body.metode_pembayaran == "credit" else "lunas",
                        sisa_utang=total_cost if body.metode_pembayaran == "credit" else 0,
                        userId=user.id, userName=user.name)
    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                if body.metode_pembayaran == "cash":
                    await require_cash_bank_funding_account(conn, body.sumber_dana_akun)
                await db.purchases.insert_one(purchase.to_mongo(), connection=conn)
                await post_finance_source(
                    conn,
                    "purchase",
                    purchase.id,
                    date.fromisoformat(purchase.date[:10]),
                    f"Pembelian persediaan {purchase.id}",
                    user.id,
                    purchase_journal_lines(
                        purchase.total_cost,
                        body.metode_pembayaran,
                        body.sumber_dana_akun,
                    ),
                    account_codes=[
                        ACCOUNT_PERSEDIAAN_BAHAN_ID,
                        "2-20001" if body.metode_pembayaran == "credit" else body.sumber_dana_akun,
                    ],
                )
                await post_purchase_journal(
                    conn,
                    purchase.total_cost,
                    body.metode_pembayaran,
                    body.sumber_dana_akun,
                    f"Pembelian persediaan {purchase.id} - {purchase.supplier}",
                )
    except asyncpg.PostgresError:
        logger.exception(
            "Gagal menyimpan pembelian %s dengan metode %s",
            purchase.id,
            body.metode_pembayaran,
        )
        raise
    for inv_id in ids:
        await recalc_hpp_for_inventory(inv_id)
    return purchase


@app.get("/api/v1/finance/suppliers")
async def finance_suppliers(_: User = Depends(ADMIN)):
    await db.connect()
    rows = await db.pool.fetch(
        "select id, nama_supplier from public.master_suppliers order by nama_supplier"
    )
    return [dict(row) for row in rows]


@app.post("/api/v1/finance/debts/pay")
async def pay_purchase_debt(body: DebtPaymentIn, user: User = Depends(ADMIN)):
    await db.connect()
    payment_id = str(uuid4())
    paid_at = datetime.now(timezone.utc).date()
    description = f"Pelunasan utang pembelian {body.purchase_id}"

    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await require_cash_bank_funding_account(conn, body.sumber_dana_akun)
            purchase = await conn.fetchrow(
                """
                select id, sisa_utang, status_pembayaran
                from public.purchases
                where id = $1
                for update
                """,
                body.purchase_id,
            )
            if purchase is None:
                raise HTTPException(404, "Nota pembelian tidak ditemukan.")
            outstanding = int(purchase["sisa_utang"] or 0)
            if outstanding <= 0 or purchase["status_pembayaran"] == "lunas":
                raise HTTPException(409, "Nota pembelian sudah lunas.")
            if body.amount > outstanding:
                raise HTTPException(422, "Jumlah pembayaran melebihi sisa utang.")

            remaining = outstanding - body.amount
            status = "lunas" if remaining <= 0 else "belum_lunas"
            await conn.execute(
                """
                update public.purchases
                set sisa_utang = $2, status_pembayaran = $3
                where id = $1
                """,
                body.purchase_id,
                remaining,
                status,
            )
            await post_finance_source(
                conn,
                "purchase_debt_payment",
                payment_id,
                paid_at,
                description,
                user.id,
                debt_payment_lines(body.amount, body.sumber_dana_akun),
                account_codes=["2-20001", body.sumber_dana_akun],
            )
            await post_debt_payment_journal(
                conn,
                body.amount,
                body.sumber_dana_akun,
                description,
            )

    return {
        "payment_id": payment_id,
        "purchase_id": body.purchase_id,
        "amount_paid": body.amount,
        "sisa_utang": remaining,
        "status_pembayaran": status,
    }


@app.post("/api/v1/finance/pay-supplier")
async def pay_supplier(body: SupplierPaymentIn, user: User = Depends(ADMIN)):
    amount = Decimal(str(body.jumlah_bayar))
    if amount != amount.to_integral_value():
        raise HTTPException(422, "Jumlah pembayaran harus berupa Rupiah bulat.")
    amount_int = int(amount)
    await db.connect()

    payment_id = uuid4()
    paid_at = datetime.now(timezone.utc).date()
    description = f"Pembayaran utang supplier {body.purchase_id}"

    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await require_cash_bank_funding_account(conn, body.sumber_dana_akun)
            purchase = await conn.fetchrow(
                """
                select id, sisa_utang, status_pembayaran
                from public.purchases
                where id = $1
                for update
                """,
                body.purchase_id,
            )
            if purchase is None:
                raise HTTPException(404, "Nota pembelian tidak ditemukan.")

            outstanding = Decimal(str(purchase["sisa_utang"] or 0))
            if outstanding <= 0 or purchase["status_pembayaran"] == "lunas":
                raise HTTPException(409, "Nota pembelian sudah lunas.")
            if amount > outstanding:
                raise HTTPException(400, "Jumlah pembayaran melebihi sisa utang aktual.")

            await conn.execute(
                "lock table public.jurnal_transaksi in share row exclusive mode"
            )
            cash_balance = await conn.fetchval(
                """
                select coalesce(sum(debit), 0) - coalesce(sum(kredit), 0)
                from public.jurnal_transaksi
                where kode_akun = $1
                """,
                body.sumber_dana_akun,
            )
            if Decimal(str(cash_balance or 0)) < amount:
                raise HTTPException(400, "Saldo sumber dana tidak mencukupi.")

            updated_purchase = await conn.fetchrow(
                """
                update public.purchases
                set
                  sisa_utang = sisa_utang - $2::numeric,
                  status_pembayaran = case
                    when (sisa_utang - $2::numeric) <= 0 then 'lunas'
                    else 'belum_lunas'
                  end
                where id = $1
                returning sisa_utang, status_pembayaran
                """,
                body.purchase_id,
                amount,
            )
            remaining = int(updated_purchase["sisa_utang"])
            status = updated_purchase["status_pembayaran"]
            await conn.execute(
                """
                insert into public.supplier_payments
                  (id, purchase_id, sumber_dana_akun, jumlah_bayar)
                values ($1, $2, $3, $4)
                """,
                payment_id,
                body.purchase_id,
                body.sumber_dana_akun,
                amount_int,
            )
            await post_finance_source(
                conn,
                "purchase_debt_payment",
                str(payment_id),
                paid_at,
                description,
                user.id,
                debt_payment_lines(amount, body.sumber_dana_akun),
                account_codes=["2-20001", body.sumber_dana_akun],
            )
            await post_debt_payment_journal(
                conn,
                amount,
                body.sumber_dana_akun,
                description,
            )

    return {
        "payment_id": str(payment_id),
        "purchase_id": body.purchase_id,
        "jumlah_bayar": amount_int,
        "sisa_utang": int(remaining),
        "status_pembayaran": status,
    }


# ---------- Expenses ----------
class AppProfileIn(BaseModel):
    app_name: str = Field(min_length=1, max_length=120)
    logo_url: str = Field("", max_length=1000)
    address: str = Field("", max_length=500)
    phone: str = Field("", max_length=50)
    additional_info: str = Field("", max_length=1000)
    printerDapur: str = Field("", max_length=120)
    printerKasir: str = Field("", max_length=120)
    cetakOtomatis: bool = False


class AppProfilePrintersIn(BaseModel):
    printerDapur: Optional[str] = Field(None, max_length=120)
    printerKasir: Optional[str] = Field(None, max_length=120)


PROFILE_TEXT_FIELDS = ("app_name", "logo_url", "address", "phone", "additional_info", "printerDapur", "printerKasir")


@api.get("/app-profile")
async def get_app_profile(_: User = Depends(ANY)):
    try:
        d = await db.app_profile.find_one({"_id": 1}) or {}
        return {**{k: d.get(k) or "" for k in PROFILE_TEXT_FIELDS}, "cetakOtomatis": bool(d.get("cetakOtomatis", False))}
    except Exception as err:
        logger.exception("Failed to load app profile")
        return JSONResponse(status_code=500, content={"error": str(err)})


@api.get("/app-profile/branding")
async def get_app_branding():
    try:
        d = await db.app_profile.find_one({"_id": 1}) or {}
        return {"app_name": d.get("app_name") or "", "logo_url": d.get("logo_url") or ""}
    except Exception as err:
        logger.exception("Failed to load app branding")
        return JSONResponse(status_code=500, content={"error": str(err)})


@api.put("/app-profile")
async def update_app_profile(body: AppProfileIn, _: User = Depends(ADMIN)):
    try:
        data = {k: getattr(body, k).strip() for k in PROFILE_TEXT_FIELDS}
        data["cetakOtomatis"] = body.cetakOtomatis
        await db.app_profile.update_one({"_id": 1}, {"$set": data}, upsert=True)
        return data
    except Exception as err:
        logger.exception("Failed to save app profile")
        return JSONResponse(status_code=500, content={"error": str(err)})


@api.put("/app-profile/printers")
async def update_app_profile_printers(body: AppProfilePrintersIn, _: User = Depends(ANY)):
    try:
        data = body.model_dump(exclude_unset=True)
        if not data or any(value is None or not value.strip() for value in data.values()):
            raise HTTPException(422, "Pilih setidaknya satu nama printer yang valid")
        data = {key: value.strip() for key, value in data.items()}
        await db.app_profile.update_one({"_id": 1}, {"$set": data}, upsert=True)
        return data
    except HTTPException:
        raise
    except Exception as err:
        logger.exception("Failed to save printer settings")
        return JSONResponse(status_code=500, content={"error": str(err)})


@api.get("/expenses")
async def list_expenses(_: User = Depends(ADMIN)):
    return [Expense.from_mongo(d) for d in await db.expenses.find().sort("date", -1).to_list(1000)]


@api.get("/expense-categories")
async def list_expense_categories(_: User = Depends(STAFF)):
    return [{"id": d["_id"], "name": d["name"]} for d in await db.expense_categories.find().sort("_id", 1).to_list(None)]


@api.post("/expenses")
async def create_expense(body: ExpenseIn, user: User = Depends(ADMIN)):
    cat = await db.expense_categories.find_one({"_id": body.category_id})
    if not cat:
        raise HTTPException(400, "Kategori pengeluaran tidak ditemukan")
    exp = Expense(id=await next_id("EXP"), date=to_utc_iso(body.date) if body.date else now_iso(), category=cat["name"],
                  category_id=cat["_id"], description=body.description, amount=body.amount, userId=user.id, userName=user.name)
    await db.connect()
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await db.expenses.insert_one(exp.to_mongo(), connection=conn)
            expense_account_code = await resolve_expense_account_code(
                conn, exp.category, exp.category_id
            )
            await post_finance_source(
                conn,
                "expense",
                exp.id,
                date.fromisoformat(exp.date[:10]),
                exp.description.strip() or f"Pengeluaran {exp.category}",
                user.id,
                expense_lines(exp.category, exp.amount),
                expense_account_codes(exp.amount, expense_account_code),
            )
            expense_description = " - ".join(
                part for part in (exp.category.strip(), exp.description.strip()) if part
            )
            await post_cash_expense_journal(
                conn, exp.amount, expense_description, expense_account_code
            )
    return exp


@api.delete("/expenses/{eid}")
async def delete_expense(eid: str, _: User = Depends(ADMIN)):
    await db.connect()
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            deleted = await conn.fetchval(
                "delete from public.expenses where id = $1 returning id",
                eid,
            )
            if deleted is None:
                raise HTTPException(404, "Pengeluaran tidak ditemukan")
            await conn.execute(
                "delete from public.general_ledger where source_type = 'expense' and source_id = $1",
                eid,
            )
    return {"ok": True}


# ---------- Financial accounting ----------
def finance_period_bounds(
    start: Optional[date],
    end: Optional[date],
    month: Optional[int],
    year: Optional[int],
):
    if (start is None) != (end is None):
        raise HTTPException(422, "Tanggal mulai dan tanggal selesai harus diisi bersama.")
    if (month is None) != (year is None):
        raise HTTPException(422, "Bulan dan tahun harus diisi bersama.")
    if start is not None and month is not None:
        raise HTTPException(422, "Gunakan rentang tanggal atau periode bulan, bukan keduanya.")
    if start is not None:
        if end is None or end < start:
            raise HTTPException(422, "Tanggal selesai tidak boleh sebelum tanggal mulai.")
        return start, end + timedelta(days=1)
    if month is not None:
        if year is None or not 1 <= month <= 12 or not 1 <= year <= 9999:
            raise HTTPException(422, "Bulan atau tahun tidak valid.")
        try:
            period_start = date(year, month, 1)
            period_end = date(year + (1 if month == 12 else 0), month % 12 + 1, 1)
        except ValueError as error:
            raise HTTPException(422, "Bulan atau tahun tidak valid.") from error
        return period_start, period_end
    return None, None


async def require_cash_bank_funding_account(connection, account_code: str) -> dict[str, Any]:
    accounts = await get_cash_bank_accounts(connection, account_code)
    if len(accounts) != 1:
        raise HTTPException(422, "Sumber dana harus berupa akun kas atau bank yang valid.")
    return accounts[0]


@api.post("/finance/journals")
async def create_finance_journal(body: JournalIn, user: User = Depends(ADMIN)):
    await db.connect()
    account_names = list({line.accountName.strip() for line in body.lines})
    account_codes = list({line.accountCode.strip() for line in body.lines if line.accountCode})
    accounts = await db.pool.fetch(
        """
        select
          account_name,
          account_code,
          account_category
        from public.chart_of_accounts
        where account_name = any($1::text[])
           or account_code = any($2::text[])
        """,
        account_names,
        account_codes,
    )
    accounts_by_code = {row["account_code"]: row for row in accounts}
    accounts_by_name = {}
    for row in accounts:
        accounts_by_name.setdefault(row["account_name"], []).append(row)

    resolved_lines = []
    for line in body.lines:
        if line.accountCode:
            account = accounts_by_code.get(line.accountCode.strip())
        else:
            matches = accounts_by_name.get(line.accountName.strip(), [])
            account = matches[0] if len(matches) == 1 else None
        expected_type = (
            account_type_from_category(account["account_category"], account["account_code"])
            if account is not None
            else None
        )
        if expected_type is None:
            raise HTTPException(
                422,
                f"Akun '{line.accountName}' tidak ditemukan, ambigu, atau kategorinya belum didukung.",
            )
        if line.accountType != expected_type:
            raise HTTPException(422, f"Kelompok akun '{line.accountName}' tidak sesuai dengan chart of accounts.")
        resolved_lines.append((line, account))

    entry_id = uuid4()
    values = [
        (
            entry_id,
            body.date,
            body.description.strip(),
            account["account_name"],
            line.accountType,
            account["account_code"],
            line.debit,
            line.credit,
            user.id,
        )
        for line, account in resolved_lines
    ]
    async with db.pool.acquire() as connection:
        async with connection.transaction():
            await connection.executemany(
                """
                insert into public.general_ledger
                                    (entry_id, transaction_date, entry_date, description, account_name, account_type, account_code,
                                     debit, credit, debit_amount, credit_amount, created_by)
                                values ($1, $2, $2, $3, $4, $5, $6, $7, $8, $7, $8, $9)
                """,
                values,
            )
    return {"entryId": str(entry_id), "rowsInserted": len(values)}


@api.get("/finance/accounts")
async def finance_accounts(_: User = Depends(ADMIN)):
    await db.connect()
    rows = await db.pool.fetch(
        """
        select account_name, account_code, account_category
        from public.chart_of_accounts
        where nullif(btrim(account_name), '') is not null
        order by account_name, account_code
        """
    )
    return [
        {
            **dict(row),
            "account_type": account_type_from_category(row["account_category"], row["account_code"]),
        }
        for row in rows
    ]


@api.get("/finance/funding-accounts")
async def finance_funding_accounts(_: User = Depends(ADMIN)):
    await db.connect()
    return await get_cash_bank_accounts(db.pool)


@api.get("/finance/account-balances")
async def finance_account_balances(_: User = Depends(ADMIN)):
    await db.connect()
    return await get_account_balances(db.pool)


@api.get("/finance/chart-of-accounts")
async def finance_chart_of_accounts(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    _: User = Depends(ADMIN),
):
    if (start_date is None) != (end_date is None):
        raise HTTPException(422, "Tanggal mulai dan tanggal selesai harus diisi bersama.")
    if start_date and end_date and end_date < start_date:
        raise HTTPException(422, "Tanggal selesai tidak boleh sebelum tanggal mulai.")
    await db.connect()
    return await get_chart_of_accounts(db.pool, start_date, end_date)


@api.get("/finance/cash-flow")
async def finance_cash_flow(_: User = Depends(ADMIN)):
    await db.connect()
    return await get_cash_bank_balances(db.pool)


@app.get("/api/v1/finance/dashboard-summary")
async def finance_dashboard_summary(response: Response, _: User = Depends(ADMIN)):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    try:
        await db.connect()
        data = await get_dashboard_neraca_kas(db.pool)
    except Exception as error:
        logger.exception("Failed to load finance dashboard summary")
        raise HTTPException(500, "Gagal memuat ringkasan dashboard keuangan.") from error
    return {"status": "success", "data": data}


@app.get("/api/v1/finance/recent-transactions")
async def finance_recent_transactions(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    _: User = Depends(ADMIN),
):
    if (start_date is None) != (end_date is None):
        raise HTTPException(422, "Tanggal mulai dan tanggal selesai harus diisi bersama.")
    if start_date and end_date and end_date < start_date:
        raise HTTPException(422, "Tanggal selesai tidak boleh sebelum tanggal mulai.")
    try:
        await db.connect()
        data = await get_recent_finance_transactions(db.pool, start_date, end_date)
    except Exception as error:
        logger.exception("Failed to load recent finance transactions")
        raise HTTPException(500, "Gagal memuat transaksi keuangan terbaru.") from error
    return {"status": "success", "data": data}


@api.get("/finance/cash-flow-statement")
async def finance_cash_flow_statement(
    start: date,
    end: date,
    _: User = Depends(ADMIN),
):
    if end < start:
        raise HTTPException(422, "Tanggal selesai tidak boleh sebelum tanggal mulai.")
    await db.connect()
    return await get_laporan_arus_kas(db.pool, start, end)


@api.get("/finance/balance-sheet")
async def finance_balance_sheet(
    start: Optional[date] = None,
    end: Optional[date] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    _: User = Depends(ADMIN),
):
    period_start, period_end = finance_period_bounds(start, end, month, year)
    await db.connect()
    rows = await db.pool.fetch(
        """
        with classified_ledger as (
          select
            ledger.account_code,
            ledger.account_name,
                        coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0) as debit,
                        coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0) as credit,
            case
              when lower(coalesce(account.account_category, '')) = 'balance_sheet'
                then case left(ledger.account_code, 1)
                  when '1' then 'asset'
                  when '2' then 'liability'
                  when '3' then 'equity'
                  when '4' then 'revenue'
                  when '5' then 'expense'
                  when '6' then 'expense'
                                    when '8' then 'expense'
                  else ledger.account_type
                end
              when lower(coalesce(account.account_category, '')) like 'asset%'
                or lower(coalesce(account.account_category, '')) like 'aset%'
                or lower(coalesce(account.account_category, '')) like 'aktiva%'
                or lower(coalesce(account.account_category, '')) like 'kas%'
                or lower(coalesce(account.account_category, '')) like 'cash%'
                then 'asset'
              when lower(coalesce(account.account_category, '')) like 'liabilit%'
                or lower(coalesce(account.account_category, '')) like 'kewajiban%'
                or lower(coalesce(account.account_category, '')) like 'utang%'
                or lower(coalesce(account.account_category, '')) like 'hutang%'
                then 'liability'
              when lower(coalesce(account.account_category, '')) like 'equity%'
                or lower(coalesce(account.account_category, '')) like 'ekuitas%'
                or lower(coalesce(account.account_category, '')) like 'modal%'
                then 'equity'
              when lower(coalesce(account.account_category, '')) like 'revenue%'
                or lower(coalesce(account.account_category, '')) like 'pendapatan%'
                or lower(coalesce(account.account_category, '')) like 'income%'
                then 'revenue'
              when lower(coalesce(account.account_category, '')) like 'expense%'
                or lower(coalesce(account.account_category, '')) like 'beban%'
                or lower(coalesce(account.account_category, '')) like 'biaya%'
                or lower(coalesce(account.account_category, '')) in ('cost_of_goods_sold', 'operating_expense')
                then 'expense'
              when ledger.account_code like '1-%' then 'asset'
              when ledger.account_code like '2-%' then 'liability'
              when ledger.account_code like '3-%' then 'equity'
              when ledger.account_code like '4-%' then 'revenue'
                            when ledger.account_code like '5-%'
                                or ledger.account_code like '6-%'
                                or ledger.account_code like '8-%' then 'expense'
              else ledger.account_type
            end as account_type
          from public.general_ledger as ledger
          left join lateral (
            select coalesce(
                     nullif(btrim(to_jsonb(account_row)->>'account_category'), ''),
                     nullif(btrim(to_jsonb(account_row)->>'kategori_akun'), ''),
                     nullif(btrim(to_jsonb(account_row)->>'category'), '')
                   ) as account_category
            from public.chart_of_accounts as account_row
            where coalesce(
                    nullif(btrim(to_jsonb(account_row)->>'account_code'), ''),
                    nullif(btrim(to_jsonb(account_row)->>'kode_akun'), ''),
                    nullif(btrim(to_jsonb(account_row)->>'code'), ''),
                    nullif(btrim(to_jsonb(account_row)->>'kode'), '')
                  ) = ledger.account_code
            limit 1
          ) as account on true
          where ($1::date is null or ledger.transaction_date >= $1)
            and ($2::date is null or ledger.transaction_date < $2)
        ),
        account_balances as (
          select
            account_code,
            account_name,
            account_type,
            sum(case when account_type = 'asset' then debit - credit else credit - debit end) as balance
          from classified_ledger
          where account_type in ('asset', 'liability', 'equity')
          group by account_code, account_name, account_type
          having sum(case when account_type = 'asset' then debit - credit else credit - debit end) <> 0
        ),
        profit_loss as (
          select coalesce(sum(
            case when account_type = 'revenue' then credit - debit else debit - credit end
          ), 0) as net_profit
          from classified_ledger
          where account_type in ('revenue', 'expense')
        )
        select account_code, account_name, account_type, balance
        from account_balances
        union all
        select null, 'Laba tahun berjalan', 'equity', net_profit
        from profit_loss
        where net_profit <> 0
        order by account_type, account_name
        """,
        period_start,
        period_end,
    )
    return [dict(row) for row in rows]


@api.get("/finance/profit-loss")
async def finance_profit_loss(
    start: Optional[date] = None,
    end: Optional[date] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    _: User = Depends(ADMIN),
):
    period_start, period_end = finance_period_bounds(start, end, month, year)
    if period_start is None or period_end is None:
        today = date.today()
        period_start, period_end = finance_period_bounds(None, None, today.month, today.year)
    await db.connect()
    return await get_profit_and_loss_report(db.pool, period_start, period_end)


# ---------- Reports ----------
@api.get("/reports/summary")
async def report_summary(start: str, end: str, tz_offset: int = 0, _: User = Depends(ADMIN)):
    rng = {"$gte": to_utc_iso(start), "$lt": to_utc_iso(end)}
    txs = await db.transactions.find({"date": rng}).to_list(None)
    exps = await db.expenses.find({"date": rng}).to_list(None)
    purchases = await db.purchases.find({"date": rng}).to_list(None)

    by_method, by_type, exp_cat = defaultdict(float), defaultdict(float), defaultdict(float)
    products = {}
    daily = defaultdict(lambda: {"revenue": 0.0, "cogs": 0.0, "count": 0})
    revenue = cogs = 0.0
    for t in txs:
        t_cogs = sum(i["hpp"] * i["qty"] for i in t["items_json"])
        revenue += t["total"]
        cogs += t_cogs
        legs = t.get("payments") or [{"method": t["method"], "amount": t["total"]}]
        for leg in legs:
            by_method[leg["method"]] += leg["amount"]
        by_type[t["type"]] += t["total"]
        day = (datetime.fromisoformat(t["date"]) - timedelta(minutes=tz_offset)).strftime("%Y-%m-%d")
        daily[day]["revenue"] += t["total"]
        daily[day]["cogs"] += t_cogs
        daily[day]["count"] += 1
        for i in t["items_json"]:
            variant_id = i.get("variantId")
            variant_name = i.get("variantName") or ""
            product_key = (i["productId"], variant_id if variant_id is not None else variant_name)
            p = products.setdefault(product_key, {
                "productId": i["productId"], "variantId": variant_id, "name": i["productName"],
                "variantName": variant_name, "qty": 0, "revenue": 0.0, "profit": 0.0,
            })
            p["qty"] += i["qty"]
            p["revenue"] += i["price"] * i["qty"]
            p["profit"] += (i["price"] - i["hpp"]) * i["qty"]
    for e in exps:
        exp_cat[e["category"]] += e["amount"]
    expense_total = sum(exp_cat.values())
    return {
        "revenue": revenue, "cogs": cogs, "gross_profit": revenue - cogs, "expenses": expense_total,
        "net_profit": revenue - cogs - expense_total, "purchases": sum(p["total_cost"] for p in purchases),
        "transaction_count": len(txs), "avg_ticket": revenue / len(txs) if txs else 0,
        "by_method": [{"method": k, "total": v} for k, v in sorted(by_method.items(), key=lambda x: -x[1])],
        "by_type": [{"type": k, "total": v} for k, v in by_type.items()],
        "top_products": sorted(products.values(), key=lambda x: -x["qty"])[:8],
        "daily": [{"date": k, **v, "profit": v["revenue"] - v["cogs"]} for k, v in sorted(daily.items())],
        "expenses_by_category": [{"category": k, "total": v} for k, v in sorted(exp_cat.items(), key=lambda x: -x[1])],
    }


# ---------- Schema ----------
COLLECTIONS = ["products", "tables", "transactions", "customers", "inventory", "recipes", "purchases", "expenses", "users", "open_bills", "void_logs", "shifts", "cash_movements", "sales_targets", "waiter_shifts", "order_logs"]


@api.get("/schema")
async def schema_counts(_: User = Depends(ADMIN)):
    return {"counts": {c: await db[c].count_documents({}) for c in COLLECTIONS}}


app.include_router(api)
app.include_router(shifts_router)
app.include_router(targets_router)
app.include_router(discounts_router)
app.include_router(variants_router)
app.include_router(coa_router)

configured_origins = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
for origin in ("https://babbapos.vercel.app", "http://localhost:3000", "http://127.0.0.1:3000"):
    if origin not in configured_origins:
        configured_origins.append(origin)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


@app.on_event("startup")
async def startup():
    await seed_all()


@app.on_event("shutdown")
async def shutdown_db_client():
    await client.close()


app = CORSMiddleware(
    app=app,
    allow_credentials=True,
    allow_origins=configured_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
