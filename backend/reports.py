"""Laporan operasional (Analisa Operasional).

Modul ini HANYA menyediakan endpoint baca-saja (read-only) untuk kebutuhan
laporan/analisa. Ia tidak menulis apa pun ke database sehingga tidak menyentuh
logika transaksional, pembayaran, cetak struk, maupun alur POS lainnya.

Sub-laporan pertama: *Laporan Penjualan Produk* — itemized penjualan per produk
dan varian untuk rentang tanggal tertentu.

Sub-laporan kedua: *Laporan Void* — riwayat pembatalan (void) open bill beserta
qty dan nilai rupiah item yang dibatalkan.

Sub-laporan ketiga: *Laporan Point Reward* — riwayat penukaran poin pelanggan
pada saat checkout beserta jumlah poin dan nilai diskonnya.
"""

from fastapi import APIRouter, Depends

from core import (
    User,
    date_range_query,
    db,
    require_roles,
    to_local_date,
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


@router.get("/reports/void-sales")
async def void_sales_report(start: str, end: str, _: User = Depends(ADMIN)):
    """Riwayat void/pembatalan open bill pada rentang tanggal (WITA).

    Tanggal ``start``/``end`` adalah tanggal kalender Asia/Makassar (``YYYY-MM-DD``).
    Baca-saja: hanya membaca ``void_logs`` (audit void open bill) sehingga tidak
    menyentuh logika transaksional, pembayaran, maupun cetak struk.

    Mengembalikan daftar item yang dibatalkan (per baris void) beserta qty dan
    nilai rupiahnya, plus ringkasan total transaksi void dan total nilai void.
    """
    # Batas tanggal memakai kalender WITA supaya void dini hari tidak jatuh ke
    # hari sebelumnya -- pola yang sama dipakai endpoint /reports/product-sales.
    query = date_range_query(start, end, field="timestamp")
    logs = await db.void_logs.find(query).sort("timestamp", -1).to_list(None)

    table_ids = list({v.get("tableId") for v in logs if v.get("tableId")})
    table_names = {}
    if table_ids:
        for t in await db.tables.find({"_id": {"$in": table_ids}}).to_list(None):
            table_names[t["_id"]] = t.get("name") or ""

    rows = []
    total_value = 0.0
    total_qty = 0.0
    for log in logs:
        ts = log.get("timestamp")
        local_date = to_local_date(ts).isoformat() if ts else ""
        table_name = table_names.get(log.get("tableId")) or ""
        cashier = log.get("requestedBy") or log.get("authorizedBy") or ""
        reason = log.get("reason") or ""
        for item in log.get("items_json") or []:
            qty = float(item.get("qty") or 0)
            price = float(item.get("price") or 0)
            subtotal = item.get("subtotal")
            subtotal = float(subtotal) if subtotal is not None else price * qty
            rows.append({
                "void_id": log.get("_id"),
                "bill_id": log.get("billId") or "",
                "date": local_date,
                "timestamp": ts,
                "table_id": log.get("tableId"),
                "table_name": table_name,
                "product_name": item.get("productName") or "",
                "variant_name": item.get("variantName") or "",
                "qty": int(qty) if float(qty).is_integer() else qty,
                "price": round(price, 2),
                "value": round(subtotal, 2),
                "cashier": cashier,
                "authorized_by": log.get("authorizedBy") or "",
                "reason": reason,
            })
            total_value += subtotal
            total_qty += qty

    return {
        "start": start,
        "end": end,
        "total_voids": len(logs),
        "total_items": len(rows),
        "total_qty": int(total_qty) if float(total_qty).is_integer() else total_qty,
        "total_value": round(total_value, 2),
        "items": rows,
    }


@router.get("/reports/point-reward-usage")
async def point_reward_usage_report(start: str, end: str, _: User = Depends(ADMIN)):
    """Riwayat penukaran poin (point reward) pada rentang tanggal (WITA).

    Tanggal ``start``/``end`` adalah tanggal kalender Asia/Makassar (``YYYY-MM-DD``).
    Baca-saja: hanya membaca kolom penukaran poin pada ``transactions`` sehingga
    tidak menyentuh logika transaksional, pembayaran, maupun cetak struk.

    Mengembalikan daftar transaksi yang menukar poin (``pointsRedeemed`` > 0)
    beserta jumlah poin, nilai diskon, pelanggan, dan kasir, plus ringkasan
    total poin yang ditukar dan total nilai rupiah diskonnya.
    """
    # Batas tanggal memakai kalender WITA supaya penukaran dini hari tidak jatuh
    # ke hari sebelumnya -- pola yang sama dipakai endpoint /reports/void-sales.
    query = date_range_query(start, end)
    # Filter penukaran poin dilakukan di Python agar payload ``transactions``
    # tetap dibaca lewat abstraksi yang sama dengan laporan operasional lain.
    txs = await db.transactions.find(query).sort("date", -1).to_list(None)

    rows = []
    total_points = 0.0
    total_discount = 0.0
    for t in txs:
        points = float(t.get("pointsRedeemed") or 0)
        if points <= 0:
            continue
        ts = t.get("date")
        rows.append({
            "transaction_id": t.get("_id"),
            "date": to_local_date(ts).isoformat() if ts else "",
            "timestamp": ts,
            "customer_name": (t.get("customerName") or "").strip(),
            "points_redeemed": int(points) if points.is_integer() else points,
            "discount_value": round(float(t.get("pointsDiscount") or 0), 2),
            "cashier": (t.get("userName") or "").strip(),
        })
        total_points += points
        total_discount += float(t.get("pointsDiscount") or 0)

    return {
        "start": start,
        "end": end,
        "total_redemptions": len(rows),
        "total_points_redeemed": int(total_points) if float(total_points).is_integer() else total_points,
        "total_discount_value": round(total_discount, 2),
        "items": rows,
    }
