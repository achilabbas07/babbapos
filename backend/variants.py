import math
import re
from collections import defaultdict
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import User, db, require_roles

router = APIRouter(prefix="/api")
ANY = require_roles("admin", "kasir", "waiter")
ADMIN = require_roles("admin")


class IngredientIn(BaseModel):
    inventory_id: str = Field(min_length=1)
    qty_needed: int = Field(gt=0)


class VariantIn(BaseModel):
    product_id: str = Field(min_length=1)
    variant_name: str = Field(min_length=1, max_length=100)
    additional_price: int = Field(0, ge=0)
    ingredients: List[IngredientIn] = Field(min_length=1)


class VariantUpdateIn(BaseModel):
    variant_name: str = Field(min_length=1, max_length=100)
    additional_price: int = Field(0, ge=0)
    ingredients: List[IngredientIn] = Field(min_length=1)


async def validate_ingredients(ingredients: List[IngredientIn]):
    mids = list({i.inventory_id for i in ingredients})
    if len(mids) != len(ingredients):
        raise HTTPException(400, "Bahan baku yang sama dipilih lebih dari sekali")
    if await db.inventory.count_documents({"_id": {"$in": mids}, "type": "Bahan Baku"}) != len(mids):
        raise HTTPException(400, "Ada bahan baku yang tidak ditemukan di inventory (kategori Bahan Baku)")


async def validate_variant_data(product_id: str, ingredients: List[IngredientIn]):
    if not await db.products.find_one({"_id": {"$in": product_keys(product_id)}}):
        raise HTTPException(404, "Menu tidak ditemukan")
    await validate_ingredients(ingredients)


@router.post("/menu-variants")
async def create_menu_variant(body: VariantIn, _: User = Depends(ADMIN)):
    await validate_variant_data(body.product_id, body.ingredients)
    await db.connect()
    async with db.pool.acquire() as con, con.transaction():
        vid = await con.fetchval("insert into menu_variants (product_id, variant_name, additional_price) values ($1, $2, $3) returning id",
                                 body.product_id, body.variant_name.strip(), body.additional_price)
        for i in body.ingredients:
            await con.execute("insert into variant_ingredients (variant_id, inventory_id, qty_needed) values ($1, $2, $3)", vid, i.inventory_id, i.qty_needed)
    return {"id": vid, "product_id": body.product_id, "variant_name": body.variant_name.strip(),
            "additional_price": body.additional_price, "ingredients": [i.model_dump() for i in body.ingredients]}


def product_num(product_id) -> int:
    digits = re.sub(r"\D", "", str(product_id or ""))
    return int(digits) if digits else -1


def product_keys(product_id: str) -> list:
    n = product_num(product_id)
    return list({product_id, str(n), f"{n:03d}", f"PRD-{n:03d}"}) if n >= 0 else [product_id]


def variant_availability(ingredients, materials):
    """Hitung sisa porsi satu varian dari baris `variant_ingredients`.

    `materials` adalah peta `inventory_id` -> {"stock", "min_stock", "unit"} yang
    berasal dari tabel `inventory` -- sumber data yang sama dengan halaman
    Inventaris. Dengan begitu angka "Sisa" pada modal varian selalu sinkron
    dengan stok bahan yang ditampilkan di halaman Inventaris.

    Ambang stok menipis mengikuti aturan halaman Inventaris
    (`stock <= min_stock`), bukan angka tetap. Perbandingan dilakukan pada
    satuan bahan baku, sehingga tidak terpengaruh jumlah pemakaian per porsi.

    Mengembalikan `None` bila varian tidak punya bahan valid (sama seperti
    perilaku lama: badge disembunyikan).
    """
    caps = []
    for ing in ingredients:
        qty = float(ing.get("qty_needed") or 0)
        if qty <= 0:
            continue
        inv_id = ing.get("inventory_id")
        mat = materials.get(inv_id)
        if mat is None:
            continue
        caps.append((float(mat.get("stock") or 0) / qty, inv_id, mat))
    if not caps:
        return None

    per_portion, inv_id, mat = min(caps, key=lambda c: c[0])
    stock = float(mat.get("stock") or 0)
    min_stock = float(mat.get("min_stock") or 0)
    return {
        "available": math.floor(per_portion),
        "stock": stock,
        "min_stock": min_stock,
        "unit": mat.get("unit"),
        "inventory_id": inv_id,
        "low": stock <= min_stock,
    }


@router.get("/menu-variants")
async def list_menu_variants(product_id: str, _: User = Depends(ANY)):
    rows = await db.menu_variants.find({"product_id": {"$in": product_keys(product_id)}}).sort("_id", 1).to_list(None)
    by_variant = defaultdict(list)
    if rows:
        async for r in db.variant_ingredients.find({"variant_id": {"$in": [r["_id"] for r in rows]}}):
            by_variant[r["variant_id"]].append(r)
    mids = list({r["inventory_id"] for lst in by_variant.values() for r in lst})
    mats = {
        m["_id"]: {"stock": m.get("stock"), "min_stock": m.get("min_stock"), "unit": m.get("unit")}
        async for m in db.inventory.find({"_id": {"$in": mids}})
    } if mids else {}
    out = []
    for r in rows:
        state = variant_availability(by_variant[r["_id"]], mats)
        out.append({"id": r["_id"], "product_id": r["product_id"], "variant_name": r["variant_name"],
                    "additional_price": r.get("additional_price") or 0,
                    "available": state["available"] if state else None,
                    "stock": state["stock"] if state else None,
                    "min_stock": state["min_stock"] if state else None,
                    "unit": state["unit"] if state else None,
                    "low": state["low"] if state else None})
    return out


async def variant_stock_by_product() -> dict:
    """Sisa porsi per produk untuk produk yang punya varian.

    Nilainya adalah `min(available)` seluruh varian produk tersebut, dihitung
    dengan `variant_availability` -- fungsi yang sama dengan badge modal varian.
    Dipakai `GET /products/stock` agar badge stok di kartu produk dan di modal
    varian tidak pernah berbeda untuk produk yang sama.

    Produk yang tidak punya varian tidak muncul di hasil (pemanggil memakai
    perhitungan resep biasa), sehingga perilaku produk non-varian tidak berubah.
    """
    by_variant = defaultdict(list)
    async for r in db.variant_ingredients.find():
        by_variant[r["variant_id"]].append(r)
    if not by_variant:
        return {}

    variants = await db.menu_variants.find({"_id": {"$in": list(by_variant)}}).to_list(None)
    if not variants:
        return {}

    mids = list({r["inventory_id"] for lst in by_variant.values() for r in lst})
    mats = {
        m["_id"]: {"stock": m.get("stock"), "min_stock": m.get("min_stock"), "unit": m.get("unit")}
        async for m in db.inventory.find({"_id": {"$in": mids}})
    } if mids else {}

    out = {}
    for v in variants:
        state = variant_availability(by_variant[v["_id"]], mats)
        if state is None:
            continue
        key = str(v["product_id"])
        out[key] = state["available"] if key not in out else min(out[key], state["available"])
    return out


@router.get("/products/{product_id}/variants")
async def get_product_variants(product_id: str, _: User = Depends(ANY)):
    await db.connect()
    rows = await db.pool.fetch(
        """
        select mv.id, mv.product_id, mv.variant_name, mv.additional_price,
               vi.inventory_id, vi.qty_needed, i.name as inventory_name
        from menu_variants mv
        left join variant_ingredients vi on vi.variant_id = mv.id
        left join inventory i on i.id = vi.inventory_id
        where mv.product_id = any($1::text[])
        order by mv.id, vi.inventory_id
        """,
        product_keys(product_id),
    )
    variants = {}
    for row in rows:
        variant = variants.setdefault(
            row["id"],
            {
                "id": row["id"],
                "product_id": row["product_id"],
                "variant_name": row["variant_name"],
                "additional_price": row["additional_price"] or 0,
                "ingredients": [],
            },
        )
        if row["inventory_id"] is not None:
            variant["ingredients"].append(
                {
                    "inventory_id": row["inventory_id"],
                    "inventory_name": row["inventory_name"],
                    "qty_needed": float(row["qty_needed"]),
                }
            )
    return list(variants.values())


@router.post("/variants")
async def create_variant(body: VariantIn, _: User = Depends(ADMIN)):
    await validate_variant_data(body.product_id, body.ingredients)
    variant_name = body.variant_name.strip()
    if not variant_name:
        raise HTTPException(422, "Nama varian wajib diisi")

    await db.connect()
    async with db.pool.acquire() as con, con.transaction():
        variant_id = await con.fetchval(
            """
            insert into menu_variants (product_id, variant_name, additional_price)
            values ($1, $2, $3)
            returning id
            """,
            body.product_id,
            variant_name,
            body.additional_price,
        )
        await con.executemany(
            "insert into variant_ingredients (variant_id, inventory_id, qty_needed) values ($1, $2, $3)",
            [(variant_id, item.inventory_id, item.qty_needed) for item in body.ingredients],
        )
    return {
        "id": variant_id,
        "product_id": body.product_id,
        "variant_name": variant_name,
        "additional_price": body.additional_price,
        "ingredients": [item.model_dump() for item in body.ingredients],
    }


@router.put("/variants/{variant_id}")
async def update_variant(variant_id: int, body: VariantUpdateIn, _: User = Depends(ADMIN)):
    await validate_ingredients(body.ingredients)
    variant_name = body.variant_name.strip()
    if not variant_name:
        raise HTTPException(422, "Nama varian wajib diisi")

    await db.connect()
    async with db.pool.acquire() as con, con.transaction():
        existing = await con.fetchrow("select id from menu_variants where id = $1 for update", variant_id)
        if not existing:
            raise HTTPException(404, "Varian tidak ditemukan")
        await con.execute(
            "update menu_variants set variant_name = $2, additional_price = $3 where id = $1",
            variant_id,
            variant_name,
            body.additional_price,
        )
        await con.execute("delete from variant_ingredients where variant_id = $1", variant_id)
        await con.executemany(
            "insert into variant_ingredients (variant_id, inventory_id, qty_needed) values ($1, $2, $3)",
            [(variant_id, item.inventory_id, item.qty_needed) for item in body.ingredients],
        )
    return {
        "id": variant_id,
        "variant_name": variant_name,
        "additional_price": body.additional_price,
        "ingredients": [item.model_dump() for item in body.ingredients],
    }


@router.delete("/variants/{variant_id}")
async def delete_variant(variant_id: int, _: User = Depends(ADMIN)):
    await db.connect()
    async with db.pool.acquire() as con, con.transaction():
        exists = await con.fetchval("select 1 from menu_variants where id = $1 for update", variant_id)
        if not exists:
            raise HTTPException(404, "Varian tidak ditemukan")
        await con.execute("delete from variant_ingredients where variant_id = $1", variant_id)
        await con.execute("delete from menu_variants where id = $1", variant_id)
    return {"message": "Varian berhasil dihapus", "id": variant_id}


async def load_variants(ids: List[int]) -> dict:
    if not ids:
        return {}
    return {r["_id"]: r async for r in db.menu_variants.find({"_id": {"$in": ids}})}


async def variant_hpp(ids: List[int]) -> dict:
    if not ids:
        return {}
    rows = await db.variant_ingredients.find({"variant_id": {"$in": ids}}).to_list(None)
    cost = {d["_id"]: float(d["cost_per_unit"] or 0) async for d in db.inventory.find({"_id": {"$in": list({r["inventory_id"] for r in rows})}})} if rows else {}
    out = defaultdict(float)
    for r in rows:
        out[r["variant_id"]] += float(r["qty_needed"] or 0) * cost.get(r["inventory_id"], 0)
    return {k: round(v, 2) for k, v in out.items()}


def variant_qty(items: List[dict]) -> dict:
    out = defaultdict(int)
    for it in items:
        if it.get("variantId") is not None:
            out[it["variantId"]] += it["qty"]
    return out


async def check_materials(items: List[dict]):
    vq = variant_qty(items)
    if not vq:
        return
    needs = defaultdict(float)
    async for r in db.variant_ingredients.find({"variant_id": {"$in": list(vq)}}):
        needs[r["inventory_id"]] += float(r["qty_needed"]) * vq[r["variant_id"]]
    if not needs:
        return
    mats = {m["_id"]: m async for m in db.inventory.find({"_id": {"$in": list(needs)}})}
    for mid, qty in needs.items():
        m = mats.get(mid)
        if not m:
            raise HTTPException(400, f"Bahan baku {mid} tidak ditemukan di inventory")


async def consume_checkout_stock(conn, items: List[dict]):
    await conn.execute(
        """
        WITH checkout_items AS (
            SELECT "productId", qty, "variantId"
            FROM jsonb_to_recordset($1::jsonb) AS item(
                "productId" text,
                qty numeric,
                "variantId" integer
            )
        ),
        inventory_needs AS (
            SELECT vi.inventory_id, SUM(ci.qty * vi.qty_needed) AS qty
            FROM checkout_items ci
            JOIN variant_ingredients vi ON vi.variant_id = ci."variantId"
            WHERE ci."variantId" IS NOT NULL
            GROUP BY vi.inventory_id

            UNION ALL

            SELECT r."inventoryId", SUM(ci.qty * r.qty_needed) AS qty
            FROM checkout_items ci
            JOIN recipes r ON r."productId" = ci."productId"
            WHERE ci."variantId" IS NULL
            GROUP BY r."inventoryId"

            UNION ALL

            SELECT p."inventoryId", SUM(ci.qty) AS qty
            FROM checkout_items ci
            JOIN products p ON p.id = ci."productId"
            WHERE ci."variantId" IS NULL
              AND p."inventoryId" IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM recipes r WHERE r."productId" = p.id
              )
            GROUP BY p."inventoryId"
        ),
        total_needs AS (
            SELECT inventory_id, SUM(qty) AS qty
            FROM inventory_needs
            GROUP BY inventory_id
        )
        UPDATE inventory i
        SET stock = i.stock - n.qty
        FROM total_needs n
        WHERE i.id = n.inventory_id
        """,
        items,
    )
