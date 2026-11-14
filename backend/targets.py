import uuid
from collections import defaultdict
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from core import BaseDocument, User, db, get_current_user, next_id, now_iso, now_local, require_roles
from target_types import (
    DEFAULT_TARGET_TYPE,
    ITEM_QUANTITY,
    METRIC_ITEM,
    METRICS,
    PERIOD_SHIFT,
    PERIODS,
    REVENUE_AMOUNT,
    TARGET_TYPES,
    TIME_BOUNDED,
    TargetData,
    evaluate_target,
    is_achieved,
    needs_logs,
    needs_revenue,
    period_bounds,
    period_of,
)

router = APIRouter(prefix="/api")
ADMIN = require_roles("admin")
WAITER = require_roles("waiter")
ANY = require_roles("admin", "kasir", "waiter")


class SalesTarget(BaseDocument):
    name: str
    productIds: List[str] = Field(default_factory=list)
    productNames: List[str] = Field(default_factory=list)
    targetQty: Optional[int] = None
    waiterId: Optional[str] = None
    waiterName: str = ""
    # --- Multi-target (opsional, nullable) -------------------------------
    # Semua kolom di bawah ini boleh kosong sehingga target lama (yang hanya
    # menyimpan targetQty) tetap terbaca dan berperilaku sama seperti dulu.
    targetType: str = DEFAULT_TARGET_TYPE
    targetAmount: Optional[float] = None
    periodType: str = PERIOD_SHIFT
    metric: Optional[str] = None
    startTime: Optional[str] = None
    endTime: Optional[str] = None


class WaiterShift(BaseDocument):
    userId: Optional[str] = None
    userName: str
    openedAt: str
    status: str = "open"
    closedAt: Optional[str] = None
    results: List[dict] = []
    report: Optional[dict] = None


class TargetIn(BaseModel):
    name: str = ""
    productIds: List[str] = Field(default_factory=list)
    targetQty: Optional[int] = None
    waiterId: Optional[str] = None
    targetType: str = DEFAULT_TARGET_TYPE
    targetAmount: Optional[float] = None
    periodType: str = PERIOD_SHIFT
    metric: Optional[str] = None
    startTime: Optional[str] = None
    endTime: Optional[str] = None

    @model_validator(mode="after")
    def _check_type_fields(self):
        """Validasi bergantung tipe target (kompatibel dengan payload lama)."""
        if self.targetType not in TARGET_TYPES:
            raise ValueError(f"targetType harus salah satu dari {', '.join(TARGET_TYPES)}")
        if self.periodType not in PERIODS:
            raise ValueError(f"periodType harus salah satu dari {', '.join(PERIODS)}")
        if self.metric is not None and self.metric not in METRICS:
            raise ValueError(f"metric harus salah satu dari {', '.join(METRICS)}")
        wants_items = self.targetType == ITEM_QUANTITY or self.metric == METRIC_ITEM
        wants_revenue = self.targetType == REVENUE_AMOUNT or (
            self.targetType == TIME_BOUNDED and self.metric != METRIC_ITEM
        )
        if wants_items:
            if not self.productIds:
                raise ValueError("productIds wajib diisi untuk target kuantitas item")
            if not self.targetQty or self.targetQty <= 0:
                raise ValueError("targetQty harus lebih besar dari 0")
        if wants_revenue and (self.targetAmount is None or self.targetAmount <= 0):
            raise ValueError("targetAmount harus lebih besar dari 0 untuk target omzet")
        return self


async def resolve_waiter(waiter_id: Optional[str], fallback_name: str, user: User) -> Tuple[Optional[str], str]:
    wid = waiter_id or (user.id if user.role == "waiter" else None)
    if not wid:
        return None, fallback_name
    doc = await db.users.find_one({"_id": wid, "role": "waiter"})
    if not doc:
        raise HTTPException(404, "Pelayan tidak ditemukan")
    return wid, doc["name"]


def _qty_map(items: List[dict]) -> dict:
    m = defaultdict(lambda: [0, "", "", None])
    for i in items:
        variant_name = i.get("variantName") or ""
        key = (i["productId"], _variant_key(i))
        if key not in m:
            m[key] = [0, i["productName"], variant_name, i.get("variantId")]
        m[key][0] += i["qty"]
        m[key][1] = i["productName"]
        m[key][2] = variant_name
    return m


def _variant_key(row: dict) -> tuple:
    """Kunci varian yang konsisten: pakai ``variantId`` bila ada, jika tidak nama."""
    variant_id = row.get("variantId")
    if variant_id is not None:
        return ("id", str(variant_id))
    return ("name", row.get("variantName") or "")


def _log_owner(item: dict, fallback: Tuple[Optional[str], str]) -> Tuple[Optional[str], str]:
    """Pelayan pemilik satu baris item (bukan pelayan level bill).

    Baris yang sudah menyimpan pelayan sendiri memakai data itu; baris legacy
    tanpa data pelayan mewarisi pelayan bill saat ini (identik dengan
    ``server._item_owner``).
    """
    wid = item.get("waiterId", fallback[0])
    return wid, (item.get("waiterName") or fallback[1] or "")


def _owner_qty_map(items: List[dict], fallback: Tuple[Optional[str], str]) -> dict:
    """Akumulasi kuantitas per pelayan pemilik baris + produk + varian.

    Berbeda dari :func:`_qty_map` (level bill), peta ini menjaga riwayat
    kontribusi tiap pelayan agar tidak berpindah tangan hanya karena pelayan
    bill diganti di tengah umur pesanan.
    """
    m = defaultdict(lambda: [0, "", "", None, ""])
    for i in items or []:
        wid, wname = _log_owner(i, fallback)
        variant_name = i.get("variantName") or ""
        key = (wid, i["productId"], _variant_key(i))
        if key not in m:
            m[key] = [0, i["productName"], variant_name, i.get("variantId"), wname]
        row = m[key]
        row[0] += i["qty"]
        row[1] = i["productName"]
        row[2] = variant_name
        row[4] = wname or row[4]
    return m


async def _write_logs(waiter: Tuple[Optional[str], str], deltas: dict, source: str, ref: str, connection=None):
    wid, wname = waiter
    if not wid:
        return
    active_shifts = await db.waiter_shifts.find(
        {"userId": wid, "status": "open"},
    ).sort("openedAt", -1).to_list(1)
    shift = active_shifts[0] if active_shifts else None
    ts = now_iso()
    docs = [{
        "_id": str(uuid.uuid4()),
        "timestamp": ts,
        "waiterId": wid,
        "waiterName": wname,
        "productId": product_id,
        "productName": name,
        "variantId": variant_id,
        "variantName": variant_name,
        "qty": qty,
        "source": source,
        "refId": ref,
        "shiftId": shift["_id"] if shift else None,
    } for (product_id, _), (qty, name, variant_name, variant_id) in deltas.items() if qty]
    if docs:
        await db.order_logs.insert_many(docs, connection=connection)


async def log_order_diff(
    old_items: List[dict],
    old_waiter: Tuple,
    new_items: List[dict],
    new_waiter: Tuple,
    source: str,
    ref: str,
    connection=None,
    actor_waiter: Optional[Tuple[Optional[str], str]] = None,
):
    """Catat selisih pesanan ke ``order_logs`` dengan atribusi per pemilik item.

    Prinsip (mengunci bug lintas shift):
    - Kuantitas yang **sudah tercatat** tetap milik pelayan pemilik barisnya.
      Mengganti pelayan bill atau menambah order di shift berikutnya tidak
      memindahkan riwayat tersebut.
    - Hanya **pertambahan** kuantitas yang dikreditkan (ke pelayan yang
      mencatat, ``actor_waiter``, atau pelayan bill).
    - **Pengurangan** selalu didebit dari pelayan pemilik baris aslinya.
    """
    old_fallback = old_waiter or (None, "")
    new_fallback = new_waiter or (None, "")
    credit_waiter = actor_waiter or new_fallback
    old_owned = _owner_qty_map(old_items, old_fallback)
    new_owned = _owner_qty_map(new_items, new_fallback)

    # waiter -> {(productId, variant_key): [qty, productName, variantName, variantId]}
    buckets: dict = {}
    for key in set(old_owned) | set(new_owned):
        wid, product_id, variant_key = key
        old_row = old_owned.get(key)
        new_row = new_owned.get(key)
        row = new_row or old_row
        delta = (new_row[0] if new_row else 0) - (old_row[0] if old_row else 0)
        if not delta:
            continue
        # Pertambahan dikreditkan ke pencatat (atau pelayan bill); pengurangan
        # selalu didebit dari pelayan pemilik baris aslinya.
        waiter = (credit_waiter if credit_waiter[0] else (wid, row[4])) if delta > 0 else (wid, row[4])
        bucket = buckets.setdefault(waiter, {})
        cell = bucket.setdefault((product_id, variant_key), [0, row[1], row[2], row[3]])
        cell[0] += delta

    for waiter, deltas in buckets.items():
        await _write_logs(waiter, deltas, source, ref, connection=connection)


async def _target_data(target: dict, shift: dict) -> TargetData:
    """Muat data pencapaian satu target sesuai tipe & periodenya.

    - ``periodType == "shift"``  → memakai ``shiftId`` (perilaku lama, tidak berubah).
    - periode harian/mingguan/bulanan → memakai rentang waktu kalender WITA.

    ``order_logs`` dipakai untuk metrik kuantitas item, ``transactions`` untuk
    metrik omzet.
    """
    pids = list({pid for pid in (target.get("productIds") or [])}) if needs_logs(target) else []
    wants_revenue = needs_revenue(target)
    if not pids and not wants_revenue:
        return TargetData()

    if period_of(target) == PERIOD_SHIFT:
        log_filter = {"shiftId": shift["_id"]}
        trx_filter = {"shiftId": shift["_id"]}
        logs: List[dict] = []
        transactions: List[dict] = []
        if pids:
            logs = await db.order_logs.find({**log_filter, "productId": {"$in": pids}}).to_list(None)
        if wants_revenue:
            transactions = await db.transactions.find(trx_filter).to_list(None)
        return TargetData(logs=logs, transactions=transactions)

    start, end = period_bounds(period_of(target), now_local())
    window = {"$gte": start.isoformat(), "$lt": end.isoformat()}
    logs = []
    transactions = []
    if pids:
        logs = await db.order_logs.find({
            "waiterId": shift["userId"], "timestamp": window, "productId": {"$in": pids},
        }).to_list(None)
    if wants_revenue:
        transactions = await db.transactions.find({
            "waiterId": shift["userId"], "date": window,
        }).to_list(None)
    return TargetData(logs=logs, transactions=transactions)


async def progress_for(shift: dict) -> dict:
    targets = await db.sales_targets.find({"$or": [{"waiterId": None}, {"waiterId": shift["userId"]}]}).to_list(None)
    items = [evaluate_target(t, await _target_data(t, shift)) for t in targets]
    return {"shiftId": shift["_id"], "waiterId": shift["userId"], "waiterName": shift["userName"],
            "openedAt": shift["openedAt"], "items": items}


async def waiter_shift_report(shift: dict, target_results: List[dict]) -> dict:
    logs = await db.order_logs.find({"shiftId": shift["_id"]}).to_list(None)
    # Payment logs settle bills; these sources track ordered-quantity changes.
    sales_sources = {"bill_create", "bill_update", "void", "direct"}
    product_totals = defaultdict(int)
    product_names = {}
    order_ids = set()
    void_ids = set()

    for log in logs:
        source = log.get("source")
        ref_id = log.get("refId")
        if source in {"bill_create", "direct"} and ref_id:
            order_ids.add(ref_id)
        if source == "void" and ref_id:
            void_ids.add(ref_id)
        if source not in sales_sources:
            continue
        variant_id = log.get("variantId")
        variant_name = log.get("variantName") or ""
        variant_key = ("id", str(variant_id)) if variant_id is not None else ("name", variant_name)
        key = (log.get("productId"), variant_key)
        product_totals[key] += log.get("qty", 0)
        product_names[key] = variant_name or log.get("productName") or "Menu"

    void_logs = await db.void_logs.find({"billId": {"$in": list(void_ids)}}).to_list(None) if void_ids else []
    void_details = [
        {
            "qty": item.get("qty", 0),
            "name": item.get("variantName") or item.get("productName") or "Menu",
            "reason": void.get("reason") or "-",
        }
        for void in void_logs
        for item in void.get("items_json", [])
    ]
    target_status = (
        "TIDAK ADA TARGET"
        if not target_results
        else "TERCAPAI"
        if all(is_achieved(item) for item in target_results)
        else "BELUM TERCAPAI"
    )

    return {
        "total_orders": len(order_ids),
        "active_tables": await db.open_bills.count_documents({
            "waiterId": shift.get("userId"),
            "tableId": {"$ne": None},
        }),
        "orders_data": [
            {"variant_name": product_names[key], "qty": qty}
            for key, qty in sorted(product_totals.items(), key=lambda entry: product_names[entry[0]].casefold())
            if qty > 0
        ],
        "voids": {"total": len(void_logs), "details": void_details},
        "target_sales_status": target_status,
    }


@router.get("/targets")
async def list_targets(_: User = Depends(ANY)):
    return [SalesTarget.from_mongo(d) for d in await db.sales_targets.find().sort("name", 1).to_list(None)]


async def _target_doc(body: TargetIn, target_id: str) -> SalesTarget:
    ids = list(dict.fromkeys(body.productIds))
    prods = {d["_id"]: d["name"] async for d in db.products.find({"_id": {"$in": ids}})}
    missing = [i for i in ids if i not in prods]
    if missing:
        raise HTTPException(404, f"Produk tidak ditemukan: {', '.join(missing)}")
    names = [prods[i] for i in ids]
    wname = ""
    if body.waiterId:
        w = await db.users.find_one({"_id": body.waiterId, "role": "waiter"})
        if not w:
            raise HTTPException(404, "Pelayan tidak ditemukan")
        wname = w["name"]
    default_name = " + ".join(names) or (
        f"Omzet {body.periodType}" if body.targetType != TIME_BOUNDED else "Target periode"
    )
    return SalesTarget(id=target_id, name=body.name.strip() or default_name, productIds=ids, productNames=names,
                       targetQty=body.targetQty, waiterId=body.waiterId, waiterName=wname,
                       targetType=body.targetType, targetAmount=body.targetAmount,
                       periodType=body.periodType, metric=body.metric or (
                           METRIC_ITEM if body.targetType == ITEM_QUANTITY else None),
                       startTime=body.startTime, endTime=body.endTime)


async def _persistable(doc: dict) -> dict:
    """Buang kolom yang belum ada di tabel Supabase.

    Kolom multi-target ditambahkan lewat migrasi opsional. Bila migrasi belum
    dijalankan, penyimpanan tetap berhasil untuk kolom lama (non-destruktif)
    alih-alih gagal dengan error "kolom tidak ada".
    """
    await db.connect()
    cols = db.columns.get("sales_targets") or {}
    return {k: v for k, v in doc.items() if k == "_id" or k in cols}


@router.post("/targets")
async def create_target(body: TargetIn, _: User = Depends(ADMIN)):
    t = await _target_doc(body, await next_id("TGT"))
    await db.sales_targets.insert_one(await _persistable(t.to_mongo()))
    return t


@router.put("/targets/{tid}")
async def update_target(tid: str, body: TargetIn, _: User = Depends(ADMIN)):
    existing = await db.sales_targets.find_one({"_id": tid})
    if not existing:
        raise HTTPException(404, "Target tidak ditemukan")
    t = await _target_doc(body, tid)
    await db.sales_targets.replace_one({"_id": tid}, await _persistable(t.to_mongo()))
    return t


@router.delete("/targets/{tid}")
async def delete_target(tid: str, _: User = Depends(ADMIN)):
    res = await db.sales_targets.delete_one({"_id": tid})
    if not res.deleted_count:
        raise HTTPException(404, "Target tidak ditemukan")
    return {"ok": True}


@router.get("/targets/progress")
async def targets_progress(user: User = Depends(get_current_user)):
    if user.role == "waiter":
        shift = await db.waiter_shifts.find_one({"userId": user.id, "status": "open"})
        return [await progress_for(shift)] if shift else []
    if user.role != "admin":
        raise HTTPException(403, "Akses ditolak untuk peran ini")
    return [await progress_for(s) for s in await db.waiter_shifts.find({"status": "open"}).sort("openedAt", 1).to_list(None)]


@router.get("/waiter-shifts/current")
async def current_waiter_shift(user: User = Depends(WAITER)):
    doc = await db.waiter_shifts.find_one({"userId": user.id, "status": "open"})
    return {"shift": WaiterShift.from_mongo(doc) if doc else None}


@router.post("/waiter-shifts/open")
async def open_waiter_shift(user: User = Depends(WAITER)):
    if await db.waiter_shifts.find_one({"userId": user.id, "status": "open"}):
        raise HTTPException(409, "Shift Anda masih terbuka")
    shift = WaiterShift(id=await next_id("WSHIFT"), userId=user.id, userName=user.name, openedAt=now_iso())
    await db.waiter_shifts.insert_one(shift.to_mongo())
    return shift


@router.post("/waiter-shifts/close")
async def close_waiter_shift(user: User = Depends(WAITER)):
    doc = await db.waiter_shifts.find_one({"userId": user.id, "status": "open"})
    if not doc:
        raise HTTPException(400, "Tidak ada shift terbuka")
    results = (await progress_for(doc))["items"]
    report = await waiter_shift_report(doc, results)
    await db.waiter_shifts.update_one({"_id": doc["_id"]}, {"$set": {
        "status": "closed",
        "closedAt": now_iso(),
        "results": results,
        "report": report,
    }})
    return WaiterShift.from_mongo(await db.waiter_shifts.find_one({"_id": doc["_id"]}))


@router.get("/waiter-shifts")
async def list_waiter_shifts(_: User = Depends(ADMIN)):
    docs = await db.waiter_shifts.find({"status": "closed"}).sort("closedAt", -1).to_list(100)
    return [WaiterShift.from_mongo(d) for d in docs]


@router.get("/waiter-shifts/{shift_id}")
async def get_waiter_shift_report(shift_id: str, user: User = Depends(get_current_user)):
    shift = await db.waiter_shifts.find_one({"_id": shift_id})
    if not shift:
        raise HTTPException(404, "Shift pelayan tidak ditemukan")
    if user.role != "admin" and (user.role != "waiter" or shift.get("userId") != user.id):
        raise HTTPException(403, "Akses ditolak untuk shift ini")
    if shift.get("status") != "closed":
        raise HTTPException(409, "Laporan tersedia setelah shift ditutup")

    report = shift.get("report")
    if report is None:
        report = await waiter_shift_report(shift, shift.get("results") or [])
    return {
        "id": shift["_id"],
        "waiter_name": shift.get("userName", ""),
        "shift_id": shift["_id"],
        "opened_at": shift.get("openedAt"),
        "closed_at": shift.get("closedAt"),
        "results": report,
    }
