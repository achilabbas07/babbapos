"""Checkout open bill tidak boleh membalas HTTP 500.

Bug yang dijaga di sini terjadi HANYA pada alur pembayaran yang dimulai dari
tombol "Lanjutkan / Bayar" di halaman Open Bill (POS dikirim `openBillId`),
sementara alur Meja / pesanan langsung berjalan normal.

Penyebabnya: blok pasca-commit `create_transaction`
(`log_order_diff` / `save_bill_items` / `db.open_bills.delete_one` /
`mark_paid`) berada DI LUAR semua `except` transaksi database. Hanya jalur
open bill yang menjalankan blok itu, dan helper-nya memakai `pgdb.update_one`
yang melempar ``ValueError("Kolom ... tidak ada di tabel ...")`` untuk kolom
yang tidak ada. Akibatnya exception lolos sebagai HTTP 500 mentah.

Pengujian:
- Error apa pun selain HTTPException pada tahap pasca-commit → `HTTPException`
    400 berisi pesan "Checkout gagal" (bukan 500 tanpa jejak, bukan exception
    mentah yang lolos keluar).
- HTTPException yang sudah terklasifikasi (400/403/404/409) tetap lolos apa
  adanya, sehingga perilaku lama tidak berubah.
- Pelayan yang tersimpan di bill tetapi sudah tidak valid TIDAK menggagalkan
  checkout open bill (404 lama) — identitas pelayan hanya atribusi.
- Mirror Vercel (`api/index.py`) memuat handler + toleransi yang sama.
"""
import asyncio
from pathlib import Path
from typing import Optional

import pytest
from fastapi import HTTPException

import server

MIRROR = Path(__file__).resolve().parents[2] / "api" / "index.py"

BILL_ID = "BILL-1"
TABLE_ID = "TBL-1"


class _AsyncCtx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    def transaction(self):
        return _AsyncCtx()


class FakeCollection:
    """Collection palsu: `find_one` selalu kosong, `insert_one` dicatat."""

    def __init__(self, calls):
        self.calls = calls

    async def find_one(self, flt=None, projection=None):
        return None

    async def insert_one(self, doc, connection=None):
        self.calls["insert"] += 1
        self.calls["inserted"] = doc
        return None

    async def delete_one(self, flt):
        self.calls["delete"] += 1
        return None


class FakePool:
    def acquire(self):
        return _AsyncCtx()


class FakeDB:
    def __init__(self, calls):
        self.calls = calls
        self.pool = FakePool()
        self.transactions = FakeCollection(calls)
        self.open_bills = FakeCollection(calls)

    async def connect(self):
        return None


def _bill_doc(waiter_id: Optional[str] = "USR-WAITER"):
    return {
        "_id": BILL_ID,
        "timestamp": "2026-11-22T01:00:00+00:00",
        "type": "Dine In",
        "customerName": "",
        "customerId": None,
        "total": 15000,
        "userName": "Admin",
        "userId": "USR-ADMIN",
        "waiterName": "Pelayan Bill",
        "waiterId": waiter_id,
        "tableId": TABLE_ID,
        "queueNumber": "12",
        "items_json": [{
            "id": "ITEM-1",
            "is_printed": False,
            "productId": "PRD-004",
            "productName": "Kopi",
            "qty": 1,
            "price": 15000,
            "hpp": 4000,
            "notes": "",
            "subtotal": 15000,
            "variantId": None,
            "variantName": "",
            "variantPrice": 0,
            "waiterId": waiter_id,
            "waiterName": "Pelayan Bill",
        }],
    }


def _table_doc():
    return {
        "_id": TABLE_ID,
        "name": "Meja 1",
        "status": "occupied",
        "orderData": {"openBillId": BILL_ID},
        "kind": "table",
    }


def _install_happy_collaborators(monkeypatch, calls, waiter_lookup="ok"):
    """Ganti seluruh kolaborator DB sehingga alur mencapai tahap pasca-commit."""

    async def fake_get_or_404(name, ident, label):
        if ident is None:
            return None
        if name == "open_bills":
            return _bill_doc()
        if name == "tables":
            return _table_doc()
        return None

    async def fake_resolve_waiter(waiter_id, fallback_name, user):
        if waiter_lookup == "stale":
            raise HTTPException(404, "Pelayan tidak ditemukan")
        return waiter_id, "Pelayan Bill"

    async def fake_build_items(items, order_type, ojol_markup=None):
        built = [{
            "id": "ITEM-1",
            "is_printed": False,
            "productId": "PRD-004",
            "productName": "Kopi",
            "qty": 1,
            "price": 15000,
            "hpp": 4000,
            "notes": "",
            "subtotal": 15000,
            "variantId": None,
            "variantName": "",
            "variantPrice": 0,
            "waiterId": "USR-WAITER",
            "waiterName": "Pelayan Bill",
        }]
        return built, 15000

    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr(server, "db", FakeDB(calls), raising=False)
    monkeypatch.setattr(server, "get_or_404", fake_get_or_404)
    monkeypatch.setattr(server, "get_open_shift", lambda *a, **k: _shift())
    monkeypatch.setattr(server, "authorize_reduction", _noop)
    monkeypatch.setattr(server, "resolve_waiter", fake_resolve_waiter)
    monkeypatch.setattr(server, "build_items", fake_build_items)
    monkeypatch.setattr(server, "preserve_item_waiters", lambda *a, **k: None)
    monkeypatch.setattr(server, "resolve_checkout_amounts", lambda *a, **k: {
        "promoDiscount": 0, "pointsDiscount": 0, "total": 15000,
    })
    monkeypatch.setattr(server, "normalize_checkout_payments", lambda *a, **k: [
        {"method": "Cash", "amount": 15000},
    ])
    monkeypatch.setattr(server, "primary_checkout_method", lambda *a, **k: "Cash")
    monkeypatch.setattr(server, "checkout_cash_amounts", lambda *a, **k: (15000, 0))
    monkeypatch.setattr(server, "checkout_journal_lines", lambda *a, **k: [])
    monkeypatch.setattr(server, "checkout_journal_account_codes", lambda *a, **k: [])
    monkeypatch.setattr(server, "legacy_checkout_journal_entries", lambda *a, **k: [])
    monkeypatch.setattr(server, "next_id", lambda *a, **k: _next_id())
    monkeypatch.setattr(server, "post_checkout_journal_entries", _noop)
    monkeypatch.setattr(server, "post_finance_source", _noop)
    monkeypatch.setattr(server, "post_hpp_checkout", _noop)
    monkeypatch.setattr(server, "consume_checkout_stock", _noop)
    monkeypatch.setattr(server, "log_order_diff", _noop)


async def _shift():
    return {"_id": "SHIFT-1", "kas_awal": 0}


async def _next_id():
    return "TRX-TEST-0001"


def _bill_payment_body(waiter_id="USR-WAITER"):
    """Payload persis seperti yang dikirim POS saat membayar open bill."""
    return server.TransactionIn(
        type="Dine In",
        method="Cash",
        cashGiven=15000,
        tableId=TABLE_ID,
        openBillId=BILL_ID,
        queueNumber=None,
        waiterId=waiter_id,
        customerName="",
        items=[{"id": "ITEM-1", "is_printed": False, "productId": "PRD-004", "qty": 1, "variantId": None}],
        client_request_id="crq-open-bill-1",
    )


def test_post_commit_error_returns_400_not_500(monkeypatch):
    """Penulisan pasca-commit gagal → HTTPException 400, bukan HTTP 500."""
    calls = {"insert": 0, "delete": 0}

    async def failing_mark_paid(table_id, trx):
        # Meniru `pgdb.update_one` yang melempar ValueError kolom tak dikenal.
        raise ValueError("Kolom lastTransactionId tidak ada di tabel tables")

    _install_happy_collaborators(monkeypatch, calls)
    monkeypatch.setattr(server, "mark_paid", failing_mark_paid)

    with pytest.raises(HTTPException) as err:
        asyncio.run(server.create_transaction(_bill_payment_body(), request=None, user=_user()))

    assert err.value.status_code == 400
    assert "Checkout gagal" in str(err.value.detail)
    # Transaksi tetap tercatat (tidak ada percobaan kedua yang menduplikasi).
    assert calls["insert"] == 1


def test_classified_httpexception_still_propagates():
    """400 yang sudah terklasifikasi tidak boleh berubah jadi 400 generik."""
    body = server.TransactionIn(
        type="Dine In",
        method="Cash",
        items=[{"productId": "PRD-004", "qty": 1}],
        partial=True,  # partial tanpa openBillId → 400 "Pisah bill ..."
    )
    with pytest.raises(HTTPException) as err:
        asyncio.run(server.create_transaction(body, request=None, user=_user()))
    assert err.value.status_code == 400
    assert "Pisah bill" in str(err.value.detail)


def test_stale_bill_waiter_does_not_fail_checkout(monkeypatch):
    """Pelayan bill yang sudah tidak valid tidak boleh menggagalkan pembayaran."""
    calls = {"insert": 0, "delete": 0}

    async def _noop(*_a, **_k):
        return None

    _install_happy_collaborators(monkeypatch, calls, waiter_lookup="stale")
    monkeypatch.setattr(server, "mark_paid", _noop)

    result = asyncio.run(server.create_transaction(_bill_payment_body(), request=None, user=_user()))

    assert getattr(result, "id", None) == "TRX-TEST-0001"
    assert calls["insert"] == 1


def test_stale_waiter_still_rejected_for_direct_order(monkeypatch):
    """Tanpa open bill, pelayan tidak valid tetap ditolak seperti sebelumnya."""
    calls = {"insert": 0, "delete": 0}

    async def fake_resolve_waiter(*_a, **_k):
        raise HTTPException(404, "Pelayan tidak ditemukan")

    _install_happy_collaborators(monkeypatch, calls)
    monkeypatch.setattr(server, "resolve_waiter", fake_resolve_waiter)
    body = server.TransactionIn(
        type="Walk In",
        method="Cash",
        items=[{"productId": "PRD-004", "qty": 1}],
        waiterId="USR-GONE",
    )
    with pytest.raises(HTTPException) as err:
        asyncio.run(server.create_transaction(body, request=None, user=_user()))
    assert err.value.status_code == 404


def test_vercel_mirror_carries_same_checkout_guard():
    text = MIRROR.read_text(encoding="utf-8")
    assert 'raise HTTPException(400, f"Checkout gagal: {err}") from err' in text
    assert "Checkout gagal saat menyelesaikan open bill" in text
    assert "if not bill:" in text and "wid, wname = body.waiterId, body.waiterName or bill.waiterName" in text


def _user():
    return server.User(id="USR-KASIR", name="Kasir", role="kasir")
