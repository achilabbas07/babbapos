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

Sub-laporan kelima: *Laporan Promo* — riwayat transaksi yang memakai kode promo
beserta nilai diskon promonya dan rekap per kode promo pada rentang tanggal.

Sub-laporan keenam: *Pantauan Pemilik (Mode Owner)* — satu endpoint gabungan
baca-saja untuk halaman pemantauan pemilik: omzet, total open bill, stok bahan,
shift pelayan yang sedang aktif, dan ringkasan laporan laba-rugi.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import (
    WITA,
    User,
    date_range_query,
    db,
    now_local,
    require_roles,
    to_local_date,
    today_local,
)
from finance import exclude_void_transactions, get_profit_and_loss_report

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
    # Transaksi void tidak dihitung (penjualan + HPP-nya sudah dibalik jurnal).
    txs = exclude_void_transactions(txs)

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
    # Transaksi void tidak dihitung (penjualan + HPP-nya sudah dibalik jurnal).
    txs = exclude_void_transactions(txs)

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


@router.get("/reports/promo-usage")
async def promo_usage_report(start: str, end: str, _: User = Depends(ADMIN)):
    """Riwayat pemakaian PROMO (kode promo) pada rentang tanggal (WITA).

    Tanggal ``start``/``end`` adalah tanggal kalender Asia/Makassar (``YYYY-MM-DD``).
    Baca-saja: hanya membaca kolom promo pada ``transactions``
    (``promoCode`` / ``promoDiscount``) sehingga tidak menyentuh logika
    transaksional, pembayaran, cetak struk, maupun alur POS lainnya.

    Mengembalikan daftar transaksi yang memakai promo (``promoDiscount`` > 0)
    beserta kode promo, nilai diskon, nilai transaksi terkait, pelanggan, dan
    kasir, plus ringkasan:
    - ``total_transactions``: jumlah transaksi ber-promo,
    - ``total_promo_discount``: total rupiah diskon promo,
    - ``total_transaction_value``: total nilai transaksi ber-promo (``total``),
    - ``promos``: rekap per kode promo (jumlah transaksi, diskon, nilai transaksi),
    - ``items``: rincian transaksi (terbaru lebih dulu).
    """
    # Batas tanggal memakai kalender WITA supaya transaksi dini hari tidak jatuh
    # ke hari sebelumnya -- pola yang sama dipakai /reports/point-reward-usage.
    query = date_range_query(start, end)
    # Filter promo dilakukan di Python agar payload ``transactions`` tetap
    # dibaca lewat abstraksi yang sama dengan laporan operasional lain.
    txs = await db.transactions.find(query).sort("date", -1).to_list(None)
    # Transaksi void tidak dihitung (nilai + diskonnya sudah dibalik jurnal).
    txs = exclude_void_transactions(txs)

    rows = []
    promo_map = {}
    total_discount = 0.0
    total_value = 0.0
    for t in txs:
        promo_discount = float(t.get("promoDiscount") or 0)
        if promo_discount <= 0:
            continue
        ts = t.get("date")
        code = (t.get("promoCode") or "").strip()
        total = float(t.get("total") or 0)
        rows.append({
            "transaction_id": t.get("_id"),
            "date": to_local_date(ts).isoformat() if ts else "",
            "timestamp": ts,
            "promo_code": code,
            "promo_discount": round(promo_discount, 2),
            "subtotal": round(float(t.get("subtotal") or 0), 2),
            "discount": round(float(t.get("discount") or 0), 2),
            "total": round(total, 2),
            "customer_name": (t.get("customerName") or "").strip(),
            "cashier": (t.get("userName") or "").strip(),
        })
        # Rekap per kode promo (kode kosong dikelompokkan sebagai "-").
        bucket_key = code or "-"
        bucket = promo_map.setdefault(bucket_key, {"code": bucket_key, "transactions": 0, "promo_discount": 0.0, "transaction_value": 0.0})
        bucket["transactions"] += 1
        bucket["promo_discount"] += promo_discount
        bucket["transaction_value"] += total
        total_discount += promo_discount
        total_value += total

    promos = [
        {
            "code": b["code"],
            "transactions": b["transactions"],
            "promo_discount": round(b["promo_discount"], 2),
            "transaction_value": round(b["transaction_value"], 2),
        }
        for b in sorted(promo_map.values(), key=lambda r: (-r["promo_discount"], r["code"]))
    ]

    return {
        "start": start,
        "end": end,
        "total_transactions": len(rows),
        "total_promo_discount": round(total_discount, 2),
        "total_transaction_value": round(total_value, 2),
        "promo_count": len(promos),
        "promos": promos,
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


def _report_range_bounds(start: str, end: str):
    """Batas kalender WITA (inklusif) dari ``start``/``end`` sebagai ``date``.

    Dipakai untuk memvalidasi rentang sekaligus menyaring transaksi di Python
    berdasarkan tanggal PESANAN (bukan tanggal pembayaran).
    """
    try:
        start_day = date.fromisoformat(str(start)[:10])
        end_day = date.fromisoformat(str(end)[:10])
    except ValueError:
        raise HTTPException(400, "Format tanggal tidak valid")
    if start_day > end_day:
        raise HTTPException(400, "Tanggal mulai tidak boleh melebihi tanggal akhir")
    return start_day, end_day


def _report_date_query(start: str, end: str) -> dict:
    """Filter superset di DB untuk rentang tanggal kalender WITA.

    Laporan ini mengagregasi jam berdasarkan WAKTU PESANAN DIBUAT
    (``orderTime``), sedangkan kolom ``date`` menyimpan WAKTU PEMBAYARAN.
    Keduanya bisa jatuh pada hari kalender berbeda (mis. pesanan 20:42 lalu
    dibayar 00:20 dini hari berikutnya), sehingga filter harus mencakup baris
    yang salah satu waktunya berada di rentang. Penyaringan presisi dilakukan
    di Python memakai tanggal pesanan.
    """
    payment_range = date_range_query(start, end, field="date")
    # ``orderTime`` boleh NULL pada data legacy; baris tersebut tetap tertangkap
    # oleh cabang ``date`` dan pembacaan jam memakai fallback ``date``.
    order_range = date_range_query(start, end, field="orderTime")
    if not payment_range or not order_range:
        return payment_range or order_range
    return {"$or": [payment_range, order_range]}


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


DEFAULT_SPEND_DROP_THRESHOLD = 40.0
# Window pembanding (2-3 transaksi sebelum transaksi terakhir) default 30 hari.
DEFAULT_SPEND_BASELINE_DAYS = 30
# Minimal transaksi SEBELUM transaksi terakhir agar penurunan dinilai adil.
# Pelanggan dengan kurang dari 2 transaksi sebelumnya dilewati.
DEFAULT_SPEND_MIN_BASELINE_TX = 2
# Maksimal transaksi sebelumnya yang dipakai sebagai pembanding rentang.
SPEND_PREV_MAX_TX = 3
# Batas jumlah pelanggan yang dikembalikan/ditampilkan (prioritas penurunan).
SPEND_ALERTS_LIMIT = 20


def _tx_customer_identity(tx):
    """Identitas pelanggan satu transaksi (kunci pengelompokan).

    Prioritas ``customerId`` (pelanggan terdaftar). Bila kosong, jatuh ke
    ``customerName`` yang dinormalisasi (huruf kecil tanpa spasi berlebih)
    supaya "Budi" dan "budi " tetap satu pelanggan. Transaksi tanpa keduanya
    (walk-in tanpa nama) dilewati karena tidak dapat dikaitkan ke pelanggan
    tertentu.
    """
    cid = tx.get("customerId")
    name = str(tx.get("customerName") or "").strip()
    if cid:
        return {
            "key": f"id:{cid}",
            "customer_id": cid,
            "name": name or cid,
            "identity": "customerId",
        }
    if name:
        return {
            "key": f"name:{name.lower()}",
            "customer_id": None,
            "name": name,
            "identity": "customerName",
        }
    return None


def _tx_waiter_name(tx):
    """Nama PELAYAN satu transaksi (field terpisah), bukan kasir.

    Transaksi menyimpan pelayan pada ``waiterName`` (level transaksi) dan,
    untuk atribusi per baris item (mis. bill digabung / pelayan diganti saat
    "tambah order"), pada ``items_json[].waiterName``. Prioritas: ``waiterName``
    transaksi, lalu pelayan pertama yang tercatat pada baris item. Mengembalikan
    string kosong bila transaksi memang tidak punya data pelayan (mis. pesanan
    langsung tanpa pelayan) sehingga UI dapat jatuh ke ``userName`` kasir.
    """
    name = str(tx.get("waiterName") or "").strip()
    if name:
        return name
    for item in tx.get("items_json") or []:
        item_name = str((item or {}).get("waiterName") or "").strip()
        if item_name:
            return item_name
    return ""


def _customer_spend_alerts(txs, baseline_txs, threshold, min_baseline_tx):
    """Bandingkan TRANSAKSI TERAKHIR vs 2-3 transaksi sebelumnya per pelanggan.

    Murni agregasi Python atas transaksi yang SUDAH dibaca dari DB (read-only).
    ``txs`` berisi transaksi pada rentang terpilih, ``baseline_txs`` berisi
    transaksi window sebelum rentang (``baseline_days``).

    Untuk tiap pelanggan: ambil transaksi terakhir (``last_tx``) pada rentang
    terpilih, lalu maksimal 3 transaksi tepat sebelumnya (``prev_txs``) dari
    awal window sampai sebelum ``last_tx``. Ringkasan rentang nilai transaksi
    sebelumnya dibentuk dari nilai MINIMUM & MAKSIMUM (``prev_total_min`` /
    ``prev_total_max``) sebagai acuan pembanding; ``drop_pct`` = persentase
    penurunan nilai transaksi terakhir terhadap acuan median 2-3 transaksi
    sebelumnya. Pelanggan dengan kurang dari ``min_baseline_tx`` (default 2)
    transaksi sebelumnya dilewati. Hasil dibatasi maksimal
    ``SPEND_ALERTS_LIMIT`` (20) pelanggan, diurutkan penurunan terbesar agar
    20 teratas paling relevan.
    """

    def _total(tx):
        return float(tx.get("total") or 0)

    def _when(tx):
        return _parse_iso_local(tx.get("orderTime") or tx.get("date"))

    buckets = {}
    for source in (baseline_txs, txs):
        for tx in source or []:
            ident = _tx_customer_identity(tx)
            if not ident:
                continue
            when = _when(tx)
            if when is None:
                # Tanpa stempel waktu, transaksi tidak dapat diurutkan.
                continue
            row = buckets.setdefault(ident["key"], {
                "customer_id": ident["customer_id"],
                "name": ident["name"],
                "identity": ident["identity"],
                "recent": [],
                "previous": [],
            })
            record = {
                "when": when,
                "total": _total(tx),
                "items": _tx_item_qty(tx),
                # Pelayan (bila ada field terpisah) dan kasir pembayar disimpan
                # berdampingan supaya UI dapat memprioritaskan PELAYAN.
                "waiter_name": _tx_waiter_name(tx),
                "user_name": str(tx.get("userName") or "").strip(),
                "shift_id": tx.get("shiftId"),
            }
            if source is txs:
                row["recent"].append(record)
            else:
                row["previous"].append(record)

    alerts = []
    for row in buckets.values():
        recent = sorted(row["recent"], key=lambda r: r["when"])
        if not recent:
            # Pelanggan hanya muncul di window kebiasaan -> tidak ada
            # transaksi terakhir untuk dibandingkan.
            continue
        last_tx = recent[-1]
        # 2-3 transaksi tepat SEBELUM transaksi terakhir, dari seluruh window
        # (kebiasaan + periode terpilih), maksimal ``SPEND_PREV_MAX_TX``.
        candidates = [
            r for r in (row["previous"] + recent[:-1]) if r["when"] < last_tx["when"]
        ]
        candidates.sort(key=lambda r: r["when"])
        prev_txs = candidates[-SPEND_PREV_MAX_TX:]
        if len(prev_txs) < min_baseline_tx:
            # Tanpa 2 transaksi sebelumnya, penurunan tidak dinilai adil.
            continue

        prev_totals = sorted(float(r["total"]) for r in prev_txs)
        prev_items = [float(r["items"]) for r in prev_txs]
        n = len(prev_totals)
        prev_min = prev_totals[0]
        prev_max = prev_totals[-1]
        # Acuan = median nilai 2-3 transaksi sebelumnya.
        if n % 2:
            baseline_total = prev_totals[n // 2]
        else:
            baseline_total = (prev_totals[n // 2 - 1] + prev_totals[n // 2]) / 2
        baseline_items = sum(prev_items) / n
        last_total = float(last_tx["total"])
        last_items = float(last_tx["items"])

        change = None
        if baseline_total > 0:
            change = round((last_total - baseline_total) / baseline_total * 100, 2)
        drop_pct = round(-change, 2) if change is not None and change < 0 else 0.0

        alerts.append({
            "customer_id": row["customer_id"],
            "customer_name": row["name"],
            "identity": row["identity"],
            "baseline_tx_count": n,
            "baseline_total": round(baseline_total, 2),
            "baseline_aov": round(baseline_total, 2),
            "baseline_avg_items": round(baseline_items, 2),
            "prev_tx_count": n,
            "prev_total_min": round(prev_min, 2),
            "prev_total_max": round(prev_max, 2),
            "last_total": round(last_total, 2),
            "recent_tx_count": 1,
            "recent_aov": round(last_total, 2),
            "recent_avg_items": round(last_items, 2),
            "change_pct": change,
            "aov_change_pct": change,
            "drop_pct": round(drop_pct, 2),
            "is_drastic_drop": drop_pct >= threshold,
            "last_items": round(last_items, 2),
            "last_visit": last_tx["when"].date().isoformat(),
            "last_time": last_tx["when"].strftime("%H:%M"),
            "last_waiter": last_tx["waiter_name"],
            "last_cashier": last_tx["user_name"],
            "last_shift_id": last_tx["shift_id"],
        })

    # Urutkan penurunan terbesar dulu, lalu belanja terakhir terbesar, dan
    # batasi 20 pelanggan teratas agar daftar tetap relevan.
    alerts.sort(key=lambda a: (-a["drop_pct"], -a["last_total"], a["customer_name"]))
    return alerts[:SPEND_ALERTS_LIMIT]


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
    baseline_days: int = DEFAULT_SPEND_BASELINE_DAYS,
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
    - ``spend_alerts``: pemantauan perubahan perilaku belanja per pelanggan —
        transaksi TERAKHIR pelanggan pada rentang terpilih dibandingkan 2-3
        transaksi sebelumnya (dalam window ``baseline_days`` hari sebelum
        rentang), lengkap dengan rentang nilai transaksi sebelumnya
        (``prev_total_min`` / ``prev_total_max``), ``drop_pct``, dan penanda
        ``is_drastic_drop`` (penurunan drastis). Maksimal 20 pelanggan
        (``SPEND_ALERTS_LIMIT``) diurutkan penurunan terbesar.
    - ``insights``: wawasan ringkas berbasis aturan lokal.
    """
    # Kontrak utama memakai ``start_date``/``end_date``; ``start``/``end`` tetap
    # diterima sebagai alias agar konsisten dengan endpoint laporan lain.
    start = start_date or start
    end = end_date or end
    if not start or not end:
        raise HTTPException(400, "Parameter start_date dan end_date wajib diisi")

    # Rentang kalender WITA untuk tanggal PESANAN (acuan jam sibuk). Query DB
    # hanya mengambil superset (lunas ATAU dipesan dalam rentang), lalu
    # disaring presisi di bawah agar pesanan yang dibayar dini hari berikutnya
    # tidak ikut menggeser distribusi jam ke hari yang salah.
    start_day, end_day = _report_range_bounds(start, end)
    query = _report_date_query(start, end)
    raw_txs = await db.transactions.find(query).to_list(None)
    # Transaksi void tidak dihitung (pendapatan/metodenya sudah dibalik jurnal).
    raw_txs = exclude_void_transactions(raw_txs)
    txs = []
    for tx in raw_txs:
        order_day = _tx_order_datetime(tx)
        if order_day is not None and start_day <= order_day.date() <= end_day:
            txs.append(tx)

    # Window pembanding: ``baseline_days`` hari tepat sebelum rentang. Dipakai
    # sebagai sumber 2-3 transaksi sebelumnya per pelanggan (bukan rata-rata
    # seluruh pelanggan).
    baseline_days = max(1, min(int(baseline_days or DEFAULT_SPEND_BASELINE_DAYS), 365))
    baseline_start = (start_day - timedelta(days=baseline_days)).isoformat()
    baseline_end = (start_day - timedelta(days=1)).isoformat()
    baseline_txs = []
    if baseline_start <= baseline_end:
        baseline_start_day = date.fromisoformat(baseline_start)
        baseline_end_day = date.fromisoformat(baseline_end)
        baseline_raw = await db.transactions.find(
            _report_date_query(baseline_start, baseline_end)
        ).to_list(None)
        baseline_raw = exclude_void_transactions(baseline_raw)
        for tx in baseline_raw:
            order_day = _tx_order_datetime(tx)
            if order_day is not None and baseline_start_day <= order_day.date() <= baseline_end_day:
                baseline_txs.append(tx)

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

    spend_alerts = _customer_spend_alerts(
        txs, baseline_txs, DEFAULT_SPEND_DROP_THRESHOLD, DEFAULT_SPEND_MIN_BASELINE_TX
    )

    return {
        "start": start,
        "end": end,
        **summary,
        "baseline": {
            "start": baseline_start,
            "end": baseline_end,
            "days": baseline_days,
            "min_baseline_tx": DEFAULT_SPEND_MIN_BASELINE_TX,
            "max_prev_tx": SPEND_PREV_MAX_TX,
            "limit": SPEND_ALERTS_LIMIT,
        },
        "spend_drop_threshold": DEFAULT_SPEND_DROP_THRESHOLD,
        "spend_alerts_limit": SPEND_ALERTS_LIMIT,
        "spend_alerts": spend_alerts,
        "basket": {
            "average_items": average_basket_size,
            "max_items": int(max_basket) if float(max_basket).is_integer() else max_basket,
            "min_items": int(min_basket) if float(min_basket).is_integer() else min_basket,
        },
        "hours": hours,
        "insights": _build_insights(summary),
    }


# ---------------------------------------------------------------------------
# Pantauan Pemilik (Mode Owner) — SATU endpoint gabungan, BACA-SAJA.
# ---------------------------------------------------------------------------

# Batas jumlah baris yang dikirim untuk daftar (agar payload tetap ringan
# ketika pemilik membuka halaman dari perangkat Android).
OWNER_LIST_LIMIT = 200


def _owner_period_bounds(
    start: Optional[str],
    end: Optional[str],
    month: Optional[int],
    year: Optional[int],
):
    """Rentang kalender WITA (inklusif) untuk Pantauan Pemilik.

    Mendukung dua gaya filter yang dipakai halaman pemilik:
    - ``month``/``year`` (filter **Bulan**), dan
    - ``start``/``end`` (filter **Tanggal**).

    Bila keduanya kosong, dipakai bulan berjalan menurut kalender WITA supaya
    halaman selalu menampilkan periode yang bermakna.
    """
    if (month is None) != (year is None):
        raise HTTPException(400, "Bulan dan tahun harus diisi bersama")
    if start and month is not None:
        raise HTTPException(400, "Gunakan rentang tanggal atau periode bulan, bukan keduanya")
    if month is not None:
        try:
            month_value, year_value = int(month), int(year)
        except (TypeError, ValueError):
            raise HTTPException(400, "Bulan atau tahun tidak valid")
        if not 1 <= month_value <= 12 or not 1 <= year_value <= 9999:
            raise HTTPException(400, "Bulan atau tahun tidak valid")
        first = date(year_value, month_value, 1)
        last = date(
            year_value + (1 if month_value == 12 else 0),
            month_value % 12 + 1,
            1,
        ) - timedelta(days=1)
        return first.isoformat(), last.isoformat()
    if start or end:
        if not start or not end:
            raise HTTPException(400, "Tanggal mulai dan tanggal selesai harus diisi bersama")
        start_day, end_day = _report_range_bounds(start, end)
        return start_day.isoformat(), end_day.isoformat()
    today = today_local()
    first = today.replace(day=1)
    next_month = date(today.year + (1 if today.month == 12 else 0), today.month % 12 + 1, 1)
    return first.isoformat(), (next_month - timedelta(days=1)).isoformat()


def _owner_omzet(txs) -> dict:
    """Ringkasan omzet dari daftar transaksi (total, jumlah nota, item, AOV)."""
    total_revenue = 0.0
    total_items = 0.0
    for tx in txs:
        total_revenue += float(tx.get("total") or 0)
        total_items += _tx_item_qty(tx)
    count = len(txs)
    return {
        "total_revenue": round(total_revenue, 2),
        "transaction_count": count,
        "total_items": int(total_items) if float(total_items).is_integer() else round(total_items, 2),
        "average_order_value": round(total_revenue / count, 2) if count else 0.0,
    }


def _owner_open_bills(bills, table_names) -> dict:
    """Jumlah + total nilai open bill yang belum dibayar (BACA-SAJA)."""
    items = []
    total_value = 0.0
    for bill in bills[:OWNER_LIST_LIMIT]:
        total = float(bill.get("total") or 0)
        total_value += total
        items.append({
            "id": bill.get("_id"),
            "timestamp": bill.get("timestamp"),
            "date": to_local_date(bill["timestamp"]).isoformat() if bill.get("timestamp") else "",
            "type": bill.get("type") or "",
            "table_id": bill.get("tableId"),
            "table_name": table_names.get(bill.get("tableId")) or "",
            "customer_name": (bill.get("customerName") or "").strip(),
            "waiter_name": (bill.get("waiterName") or "").strip(),
            "item_count": int(_tx_item_qty(bill)),
            "total": round(total, 2),
        })
    return {
        "count": len(bills),
        "total_value": round(total_value, 2),
        "items": items,
        "truncated": len(bills) > OWNER_LIST_LIMIT,
    }


def _owner_inventory(stocks) -> dict:
    """Stok bahan mentah + penanda stok menipis (BACA-SAJA)."""
    items = []
    stock_value = 0.0
    low_stock_count = 0
    for raw in stocks:
        stock = float(raw.get("stock") or 0)
        cost = float(raw.get("cost_per_unit") or 0)
        min_stock = float(raw.get("min_stock") or 0)
        is_low = min_stock > 0 and stock <= min_stock
        if is_low:
            low_stock_count += 1
        stock_value += stock * cost
        items.append({
            "id": raw.get("_id"),
            "name": raw.get("name") or "",
            "type": raw.get("type") or "",
            "stock": stock,
            "unit": raw.get("unit") or "",
            "cost_per_unit": round(cost, 2),
            "min_stock": min_stock,
            "stock_value": round(stock * cost, 2),
            "is_low": is_low,
        })
    return {
        "count": len(items),
        "low_stock_count": low_stock_count,
        "total_stock_value": round(stock_value, 2),
        "items": items[:OWNER_LIST_LIMIT],
        "truncated": len(items) > OWNER_LIST_LIMIT,
    }


def _owner_shift_activity(shift, txs) -> dict:
    """Item terjual, void, promo, dan poin untuk SATU shift pelayan aktif.

    Promo & poin dihitung dari transaksi pelayan tersebut sejak shift dibuka
    (``transactions.waiterId`` + waktu pembayaran >= ``openedAt``), karena
    ``transactions.shiftId`` menunjuk shift KASIR sehingga tidak dapat dipakai
    untuk atribusi shift pelayan.
    """
    opened_at = _parse_iso_local(shift.get("openedAt"))
    promo_count = 0
    promo_discount = 0.0
    redemption_count = 0
    points_redeemed = 0.0
    points_discount = 0.0
    for tx in txs:
        if tx.get("waiterId") != shift.get("userId"):
            continue
        paid_at = _parse_iso_local(tx.get("date"))
        if opened_at is not None and (paid_at is None or paid_at < opened_at):
            continue
        promo_value = float(tx.get("promoDiscount") or 0)
        if promo_value > 0:
            promo_count += 1
            promo_discount += promo_value
        points_value = float(tx.get("pointsRedeemed") or 0)
        if points_value > 0:
            redemption_count += 1
            points_redeemed += points_value
            points_discount += float(tx.get("pointsDiscount") or 0)
    return {
        "promo_count": promo_count,
        "promo_discount": round(promo_discount, 2),
        "redemption_count": redemption_count,
        "points_redeemed": int(points_redeemed) if float(points_redeemed).is_integer() else points_redeemed,
        "points_discount": round(points_discount, 2),
    }


@router.get("/reports/owner-monitor")
async def owner_monitor_report(
    start: Optional[str] = None,
    end: Optional[str] = None,
    month: Optional[int] = None,
    year: Optional[int] = None,
    _: User = Depends(ADMIN),
):
    """Pantauan pemilik (mode Owner) — gabungan 5 bagian, BACA-SAJA.

    Endpoint ini **hanya membaca**. Tidak ada penulisan, perubahan, void,
    penutupan shift, maupun opname — sehingga mode Owner tidak dapat mengubah
    data apa pun.

    Bagian yang dikembalikan:
    - ``omzet``: total omzet + jumlah nota + item + rata-rata nilai nota.
    - ``open_bills``: jumlah dan total nilai open bill yang belum dibayar.
    - ``inventory``: stok bahan mentah (dengan penanda stok menipis).
    - ``active_shifts``: shift pelayan yang sedang aktif beserta nama pelayan,
      total item terjual, total void, pemakaian promo, dan penukaran poin.
    - ``profit_loss``: ringkasan laba-rugi (pendapatan, potongan penjualan,
      HPP, beban, laba bersih) dari modul finance.

    Filter periode memakai kalender Asia/Makassar (WITA): ``month``/``year``
    (filter Bulan) atau ``start``/``end`` (filter Tanggal).
    """
    period_start, period_end = _owner_period_bounds(start, end, month, year)

    # --- Omzet: memakai waktu PEMBAYARAN (kolom ``date``) agar konsisten
    # dengan /reports/summary dan laporan laba-rugi (transaction_date).
    txs = await db.transactions.find(date_range_query(period_start, period_end)).to_list(None)
    # Transaksi void tidak dihitung (penjualan + HPP-nya sudah dibalik jurnal).
    txs = exclude_void_transactions(txs)

    # --- Open bill: hitung seluruh bill terbuka (tanpa filter tanggal).
    bills = await db.open_bills.find().sort("timestamp", -1).to_list(None)
    bill_table_ids = list({b.get("tableId") for b in bills if b.get("tableId")})
    bill_table_names = {}
    if bill_table_ids:
        for t in await db.tables.find({"_id": {"$in": bill_table_ids}}).to_list(None):
            bill_table_names[t["_id"]] = t.get("name") or ""

    # --- Stok bahan: seluruh item inventaris, urut nama.
    stocks = await db.inventory.find().sort("name", 1).to_list(None)

    # --- Shift pelayan yang sedang aktif.
    active_shifts = []
    for shift in await db.waiter_shifts.find({"status": "open"}).sort("openedAt", 1).to_list(None):
        logs = await db.order_logs.find({"shiftId": shift.get("_id")}).to_list(None)
        item_totals = {}
        order_ids = set()
        void_ids = set()
        for log in logs:
            source = log.get("source")
            if source not in ("bill_create", "bill_update", "void", "direct"):
                continue
            if source in ("bill_create", "direct") and log.get("refId"):
                order_ids.add(log["refId"])
            if source == "void" and log.get("refId"):
                void_ids.add(log["refId"])
            key = (log.get("productId"), log.get("variantName") or "", log.get("variantId"))
            item_totals[key] = item_totals.get(key, 0) + float(log.get("qty") or 0)

        total_items_sold = sum(qty for qty in item_totals.values() if qty > 0)
        orders = [
            {
                "variant_name": (key[1] or key[2] or "Menu"),
                "qty": int(qty) if float(qty).is_integer() else qty,
            }
            for key, qty in sorted(item_totals.items(), key=lambda entry: (entry[0][1] or "").casefold())
            if qty > 0
        ]

        void_logs = (
            await db.void_logs.find({"billId": {"$in": list(void_ids)}}).to_list(None)
            if void_ids
            else []
        )
        void_details = [
            {
                "qty": int(item.get("qty") or 0),
                "name": item.get("variantName") or item.get("productName") or "Menu",
                "reason": void.get("reason") or "-",
            }
            for void in void_logs
            for item in (void.get("items_json") or [])
        ]
        void_value = sum(
            float(item.get("subtotal") if item.get("subtotal") is not None else (float(item.get("price") or 0) * float(item.get("qty") or 0)))
            for void in void_logs
            for item in (void.get("items_json") or [])
        )

        activity = _owner_shift_activity(shift, txs)
        active_shifts.append({
            "shift_id": shift.get("_id"),
            "waiter_id": shift.get("userId"),
            "waiter_name": shift.get("userName") or "",
            "opened_at": shift.get("openedAt"),
            "total_orders": len(order_ids),
            "total_items_sold": int(total_items_sold) if float(total_items_sold).is_integer() else total_items_sold,
            "total_voids": len(void_logs),
            "void_qty": sum(int(item.get("qty") or 0) for void in void_logs for item in (void.get("items_json") or [])),
            "void_value": round(void_value, 2),
            "void_details": void_details,
            "orders": orders,
            "promo_usage": {"count": activity["promo_count"], "discount": activity["promo_discount"]},
            "redeem_points": {
                "count": activity["redemption_count"],
                "points": activity["points_redeemed"],
                "discount": activity["points_discount"],
            },
        })

    # --- Laba-rugi: memakai modul finance yang sama dengan /finance/profit-loss
    # (read-only; batas atas eksklusif sehingga ditambah satu hari).
    start_day = date.fromisoformat(period_start)
    end_day_exclusive = date.fromisoformat(period_end) + timedelta(days=1)
    await db.connect()
    profit_loss = await get_profit_and_loss_report(db.pool, start_day, end_day_exclusive)
    pl_summary = profit_loss.get("summary") or {}

    return {
        "period": {
            "start": period_start,
            "end": period_end,
            "month": start_day.month,
            "year": start_day.year,
            "label": f"{period_start} s.d. {period_end}",
            "generated_at": now_local().isoformat(),
        },
        "readonly": True,
        "omzet": _owner_omzet(txs),
        "open_bills": _owner_open_bills(bills, bill_table_names),
        "inventory": _owner_inventory(stocks),
        "active_shifts": active_shifts,
        "profit_loss": {
            "revenue": float(pl_summary.get("revenue") or 0),
            "sales_discount": float(pl_summary.get("sales_discount") or 0),
            "hpp": float(pl_summary.get("hpp") or 0),
            "expenses": float(pl_summary.get("expenses") or 0),
            "net_profit": float(pl_summary.get("net_profit") or 0),
        },
    }
