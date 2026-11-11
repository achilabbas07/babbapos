"""Laporan operasional (Analisa Operasional).

Modul ini HANYA menyediakan endpoint baca-saja (read-only) untuk kebutuhan
laporan/analisa. Ia tidak menulis apa pun ke database sehingga tidak menyentuh
logika transaksional, pembayaran, cetak struk, maupun alur POS lainnya.

Sub-laporan pertama: *Laporan Penjualan Produk* — itemized penjualan per produk
dan varian untuk rentang tanggal tertentu.
"""

from fastapi import APIRouter, Depends

from core import (
    User,
    date_range_query,
    db,
    require_roles,
)

router = APIRouter(prefix="/api")
ADMIN = require_roles("admin")


@router.get("/reports/product-sales")
async def product_sales_report(start: str, end: str, _: User = Depends(ADMIN)):
    """Rekap penjualan per produk & varian pada rentang tanggal (WITA).

    Tanggal ``start``/``end`` adalah tanggal kalender Asia/Makassar (``YYYY-MM-DD``).
    Mengembalikan daftar produk/varian dengan qty, omzet kotor, dan kontribusi
    terhadap total omzet, sudah diurutkan dari yang paling laris.
    """
    # Batas tanggal memakai kalender WITA supaya transaksi dini hari tidak jatuh
    # ke hari sebelumnya -- pola yang sama dipakai endpoint /transactions.
    query = date_range_query(start, end)
    txs = await db.transactions.find(query).to_list(None)

    items = {}
    total_qty = 0
    gross_sales = 0.0
    product_ids, variant_ids = set(), set()
    for t in txs:
        for i in t.get("items_json") or []:
            product_id = i.get("productId")
            variant_id = i.get("variantId")
            variant_name = i.get("variantName") or ""
            key = (product_id, variant_id if variant_id is not None else variant_name)
            row = items.setdefault(key, {
                "productId": product_id,
                "variantId": variant_id,
                "name": i.get("productName") or "",
                "variantName": variant_name,
                "category": "",
                "qty": 0.0,
                "revenue": 0.0,
            })
            qty = float(i.get("qty") or 0)
            price = float(i.get("price") or 0)
            row["qty"] += qty
            row["revenue"] += price * qty
            total_qty += qty
            gross_sales += price * qty
            if product_id is not None:
                product_ids.add(product_id)
            if variant_id is not None and not variant_name:
                variant_ids.add(variant_id)

    # Kategori produk & nama varian (untuk pelacakan kategori/varian menu).
    # Hanya memuat baris yang benar-benar direferensikan transaksi.
    if product_ids:
        for p in await db.products.find({"_id": {"$in": list(product_ids)}}).to_list(None):
            for row in items.values():
                if row["productId"] == p["_id"]:
                    row["category"] = p.get("category") or ""

    if variant_ids:
        try:
            for v in await db.menu_variants.find({"_id": {"$in": list(variant_ids)}}).to_list(None):
                name = v.get("variant_name") or ""
                if not name:
                    continue
                for row in items.values():
                    if row["variantId"] == v["_id"]:
                        row["variantName"] = name
        except Exception:  # pragma: no cover - varian opsional bila tabel belum ada
            pass

    rows = []
    for row in sorted(items.values(), key=lambda r: (-r["qty"], r["name"], r["variantName"])):
        contribution = (row["revenue"] / gross_sales * 100) if gross_sales else 0.0
        rows.append({
            **row,
            "qty": int(row["qty"]) if float(row["qty"]).is_integer() else row["qty"],
            "revenue": round(row["revenue"], 2),
            "contribution": round(contribution, 2),
        })

    return {
        "start": start,
        "end": end,
        "total_qty": int(total_qty) if float(total_qty).is_integer() else total_qty,
        "gross_sales": round(gross_sales, 2),
        "transaction_count": len(txs),
        "item_count": len(rows),
        "items": rows,
    }
