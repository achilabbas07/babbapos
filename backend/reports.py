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

Sub-laporan keempat: *Analisa Perilaku Pelanggan* — agregasi kanal order,
metode pembayaran, ukuran keranjang, jam sibuk/sepian, dan wawasan aturan
(rule-based) untuk rentang tanggal terpilih.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import (
    WITA,
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


# ---------------------------------------------------------------------------
# Analisa Perilaku Pelanggan & Perputaran Warkop
# ---------------------------------------------------------------------------
# Endpoint di bawah ini murni BACA-SAJA: hanya membaca tabel ``transactions``
# pada rentang tanggal terpilih lalu mengagregasinya di memori. Tidak ada
# INSERT/UPDATE/DELETE, tidak menyentuh modul pembayaran, kasir, void, shift,
# maupun stok. Logika dijaga terpisah dari alur transaksional.

CHANNEL_LABELS = {
    "dine in": "Dine In",
    "takeaway": "Takeaway",
    "walk in": "Walk In",
    "ojek online": "Ojek Online",
    "ojol": "Ojek Online",
}

# Metode pembayaran yang dikenal POS. Nilai tak dikenal tetap ditampilkan apa
# adanya (dinormalisasi kapitalisasinya) agar laporan tidak kehilangan data.
KNOWN_METHODS = ("Cash", "QRIS", "Card", "Debit")


def _channel_label(raw) -> str:
    """Normalisasi tipe orderan menjadi label kanal yang konsisten."""
    text = (str(raw).strip() if raw is not None else "")
    if not text:
        return "Lainnya"
    return CHANNEL_LABELS.get(text.lower(), text)


def _method_label(raw) -> str:
    """Normalisasi nama metode pembayaran (legacy single maupun split)."""
    text = (str(raw).strip() if raw is not None else "")
    if not text:
        return "Lainnya"
    for known in KNOWN_METHODS:
        if text.lower() == known.lower():
            return known
    return text[:1].upper() + text[1:]


# Kolom waktu PESANAN DIBUAT (bukan waktu pembayaran).
# ``transactions."orderTime"`` diisi saat checkout: untuk open bill memakai
# waktu bill dibuka, sedangkan transaksi langsung (Walk In/Ojol/bayar di muka)
# memakai waktu transaksi. ``created_at``/``createdAt`` hanya dipakai bila
# suatu saat tersedia di skema. Kolom ``date`` adalah waktu PEMBAYARAN sehingga
# TIDAK boleh dijadikan acuan utama jam sibuk.
ORDER_TIMESTAMP_FIELDS = ("orderTime", "createdAt", "created_at")


def _parse_iso_local(value):
    """Parse ISO string/datetime menjadi datetime berzona WITA, atau None."""
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(WITA)


def _tx_order_datetime(tx):
    """Ambil waktu pesanan dibuat dalam zona WITA.

    Prioritas: ``orderTime`` -> ``createdAt`` -> ``created_at``. Bila seluruh
    kolom waktu pesanan kosong (data legacy), baru jatuh ke ``date`` (waktu
    pembayaran) agar transaksi lama tetap terhitung.
    """
    for field in ORDER_TIMESTAMP_FIELDS:
        parsed = _parse_iso_local(tx.get(field))
        if parsed is not None:
            return parsed
    return _parse_iso_local(tx.get("date"))


def _parse_tx_local_hour(tx) -> int:
    """Jam (0-23) waktu pesanan dibuat menurut kalender WITA.

    Transaksi dini hari harus jatuh pada jam lokal WITA, bukan UTC.
    """
    order_dt = _tx_order_datetime(tx)
    return order_dt.hour if order_dt is not None else 0


def _tx_item_qty(tx) -> float:
    """Total kuantitas item pada satu transaksi (ukuran keranjang)."""
    return sum(float(i.get("qty") or 0) for i in tx.get("items_json") or [])


def _payment_legs(tx):
    """Pecah satu transaksi menjadi leg pembayaran (mendukung split payment)."""
    legs = tx.get("payments") or []
    parsed = []
    for leg in legs:
        if not isinstance(leg, dict):
            continue
        amount = float(leg.get("amount") or 0)
        if amount <= 0:
            continue
        parsed.append({"method": leg.get("method"), "amount": amount})
    if parsed:
        return parsed
    # Legacy: satu metode, nominal = total transaksi.
    return [{"method": tx.get("method"), "amount": float(tx.get("total") or 0)}]


def _build_insights(summary) -> list:
    """Wawasan lokal berbasis aturan (rule-based) — tanpa memanggil LLM.

    Setiap aturan hanya mengembalikan kalimat bila datanya relevan, sehingga
    kotak wawasan tidak pernah berisi klaim kosong/ngawur.
    """
    insights = []
    tx_count = summary["transaction_count"]
    if tx_count == 0:
        return ["Belum ada transaksi pada rentang tanggal ini. Coba pilih rentang lain."]

    channels = summary["channels"]
    methods = summary["methods"]
    peak = summary["peak_hour"]
    quiet = summary["quiet_hour"]
    avg_basket = summary["average_basket_size"]
    avg_value = summary["average_order_value"]

    top_channel = max(channels, key=lambda c: c["revenue"]) if channels else None
    if top_channel and top_channel["revenue"] > 0:
        share = top_channel["revenue_share"]
        insights.append(
            f"Kanal {top_channel['channel']} mendominasi omzet "
            f"({share:.1f}%) dengan {top_channel['transactions']} transaksi "
            f"dan AOV {top_channel['aov']:,.0f}."
        )

    if len(channels) > 1:
        weakest = min(channels, key=lambda c: c["revenue"])
        if weakest["revenue"] > 0 and weakest["revenue_share"] < 5:
            insights.append(
                f"Kanal {weakest['channel']} masih sangat kecil "
                f"({weakest['revenue_share']:.1f}% omzet) — peluang promosi kanal."
            )

    top_method = max(methods, key=lambda m: m["total"]) if methods else None
    if top_method and top_method["total"] > 0:
        insights.append(
            f"Pembayaran {top_method['method']} menyumbang "
            f"{top_method['share']:.1f}% nilai transaksi."
        )

    if peak:
        insights.append(
            f"Jam sibuk di sekitar pukul {peak['hour']:02d}:00 "
            f"({peak['transactions']} transaksi). Siapkan staf & stok di jam ini."
        )
    if quiet and peak and quiet["hour"] != peak["hour"]:
        insights.append(
            f"Jam sepian sekitar pukul {quiet['hour']:02d}:00 "
            f"({quiet['transactions']} transaksi) — waktu ideal untuk persiapan."
        )

    insights.append(
        f"Rata-rata nilai belanja {avg_value:,.0f} dengan "
        f"{avg_basket:.1f} item per transaksi dari total {tx_count} transaksi."
    )
    return insights


@router.get("/reports/customer-behavior")
async def customer_behavior_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    _: User = Depends(ADMIN),
):
    """Analisa perilaku pelanggan & perputaran warkop (BACA-SAJA).

    Tanggal ``start``/``end`` adalah tanggal kalender Asia/Makassar
    (``YYYY-MM-DD``). Endpoint hanya membaca ``transactions`` dan tidak
    menulis/mengubah data apa pun sehingga terisolasi dari alur pembayaran.

    Mengembalikan:
    - ``channels``: Dine In / Takeaway / Walk In / Ojek Online + AOV & porsi omzet.
    - ``methods``: Cash / QRIS / Card / Debit (attribusi per leg split payment).
    - ``basket``: statistik ukuran keranjang (item per transaksi).
    - ``hours``: distribusi transaksi per jam + ``peak_hour`` / ``quiet_hour``.
    - ``insights``: wawasan ringkas berbasis aturan lokal.
    """
    # Kontrak utama memakai ``start_date``/``end_date``; ``start``/``end`` tetap
    # diterima sebagai alias agar konsisten dengan endpoint laporan lain.
    start = start_date or start
    end = end_date or end
    if not start or not end:
        raise HTTPException(400, "Parameter start_date dan end_date wajib diisi")

    # Batas tanggal memakai kalender WITA -- pola sama dengan laporan lain.
    query = date_range_query(start, end)
    txs = await db.transactions.find(query).to_list(None)

    channel_map = {}
    method_map = {}
    hour_counts = {h: {"transactions": 0, "revenue": 0.0} for h in range(24)}
    basket_sizes = []
    total_revenue = 0.0
    total_items = 0.0

    for tx in txs:
        total = float(tx.get("total") or 0)
        total_revenue += total

        qty = _tx_item_qty(tx)
        basket_sizes.append(qty)
        total_items += qty

        channel = _channel_label(tx.get("type"))
        ch = channel_map.setdefault(channel, {"transactions": 0, "revenue": 0.0})
        ch["transactions"] += 1
        ch["revenue"] += total

        for leg in _payment_legs(tx):
            method = _method_label(leg["method"])
            mt = method_map.setdefault(method, {"transactions": 0, "total": 0.0})
            mt["transactions"] += 1
            mt["total"] += leg["amount"]

        hour = _parse_tx_local_hour(tx)
        hour_counts[hour]["transactions"] += 1
        hour_counts[hour]["revenue"] += total

    tx_count = len(txs)

    def _share(value, base):
        return round(value / base * 100, 2) if base else 0.0

    channels = []
    for name, row in channel_map.items():
        channels.append({
            "channel": name,
            "transactions": row["transactions"],
            "revenue": round(row["revenue"], 2),
            "revenue_share": _share(row["revenue"], total_revenue),
            "aov": round(row["revenue"] / row["transactions"], 2) if row["transactions"] else 0.0,
        })
    channels.sort(key=lambda c: (-c["revenue"], c["channel"]))

    methods = []
    for name, row in method_map.items():
        methods.append({
            "method": name,
            "transactions": row["transactions"],
            "total": round(row["total"], 2),
            "share": _share(row["total"], total_revenue),
        })
    methods.sort(key=lambda m: (-m["total"], m["method"]))

    hours = [
        {
            "hour": h,
            "label": f"{h:02d}:00",
            "transactions": hour_counts[h]["transactions"],
            "revenue": round(hour_counts[h]["revenue"], 2),
        }
        for h in range(24)
    ]
    # Hanya jam yang benar-benar ada transaksinya yang layak jadi kandidat.
    active_hours = [h for h in hours if h["transactions"] > 0]
    peak_hour = max(active_hours, key=lambda h: (h["transactions"], h["revenue"])) if active_hours else None
    quiet_hour = min(active_hours, key=lambda h: (h["transactions"], h["revenue"])) if active_hours else None

    average_basket_size = round(total_items / tx_count, 2) if tx_count else 0.0
    average_order_value = round(total_revenue / tx_count, 2) if tx_count else 0.0
    max_basket = max(basket_sizes) if basket_sizes else 0.0
    min_basket = min(basket_sizes) if basket_sizes else 0.0

    summary = {
        "transaction_count": tx_count,
        "total_revenue": round(total_revenue, 2),
        "total_items": int(total_items) if float(total_items).is_integer() else round(total_items, 2),
        "average_order_value": average_order_value,
        "average_basket_size": average_basket_size,
        "channels": channels,
        "methods": methods,
        "peak_hour": peak_hour,
        "quiet_hour": quiet_hour,
    }

    return {
        "start": start,
        "end": end,
        **summary,
        "basket": {
            "average_items": average_basket_size,
            "max_items": int(max_basket) if float(max_basket).is_integer() else max_basket,
            "min_items": int(min_basket) if float(min_basket).is_integer() else min_basket,
        },
        "hours": hours,
        "insights": _build_insights(summary),
    }
