"""Idempotensi transaksi berbasis `client_request_id` (Tahap 2 antrean offline).

Menguji:
- `TransactionIn` menerima `client_request_id` opsional.
- `Transaction.to_mongo()` MENGHILANGKAN kolom saat kosong (kompatibilitas
  mundur) dan MENYIMPANNYA saat diisi.
- `create_transaction` mengembalikan transaksi yang SUDAH tersimpan (tanpa
  membuat baru) ketika menerima `client_request_id` yang sudah ada.
- Skema lama (kolom `client_request_id` belum ada) TIDAK lagi memicu HTTP 500
    mentah: `asyncpg.exceptions.UndefinedColumnError` pada pemeriksaan
    idempotensi ditangani sebagai fallback aman (idempotensi dilewati,
    transaksi tetap diproses). Jalur ini melindungi alur Open Bill.
- Mirror Vercel (`api/index.py`) memuat guard yang sama.
- Migrasi SQL + revisi Alembic menambahkan kolom & indeks unik parsial.
"""
import asyncio
from pathlib import Path

import asyncpg
import server
from core import Transaction

MIRROR = Path(__file__).resolve().parents[2] / "api" / "index.py"
SQL = Path(__file__).resolve().parents[1] / "supabase" / "migrate_client_request_id.sql"


def _existing_trx():
    return {
        "_id": "TRX-20261122-0001",
        "date": "2026-11-22T01:00:00+00:00",
        "type": "Walk In",
        "method": "QRIS",
        "total": 15000,
        "items_json": [],
        "cashGiven": 15000,
        "client_request_id": "crq-existing",
    }


def test_transaction_in_accepts_optional_client_request_id():
    body = server.TransactionIn(
        type="Walk In",
        method="QRIS",
        items=[{"productId": "PRD-004", "qty": 1}],
    )
    assert body.client_request_id is None
    body2 = server.TransactionIn(
        type="Walk In",
        method="QRIS",
        items=[{"productId": "PRD-004", "qty": 1}],
        client_request_id="crq-123",
    )
    assert body2.client_request_id == "crq-123"


def test_to_mongo_omits_client_request_id_when_unset():
    """Alur transaksi normal (tanpa kunci) tidak boleh menulis kolom baru."""
    trx = Transaction(
        id="TRX-1",
        date="2026-11-22T01:00:00+00:00",
        type="Walk In",
        method="Cash",
        total=10000,
        items_json=[],
        cashGiven=10000,
    )
    assert "client_request_id" not in trx.to_mongo()

    trx2 = Transaction(
        id="TRX-2",
        date="2026-11-22T01:00:00+00:00",
        type="Walk In",
        method="Cash",
        total=10000,
        items_json=[],
        cashGiven=10000,
        client_request_id="crq-x",
    )
    assert trx2.to_mongo()["client_request_id"] == "crq-x"


def test_duplicate_client_request_id_returns_existing_without_insert(monkeypatch):
    calls = {"find_one": 0, "insert": 0, "auto": 0}

    class FakeCollection:
        async def find_one(self, flt, projection=None):
            calls["find_one"] += 1
            assert flt == {"client_request_id": "crq-existing"}
            return _existing_trx()

        async def insert_one(self, *_a, **_k):  # pragma: no cover - harus tak terpanggil
            calls["insert"] += 1
            raise AssertionError("insert_one tidak boleh dipanggil untuk request duplikat")

    monkeypatch.setattr(server.db, "transactions", FakeCollection(), raising=False)

    async def boom(*_a, **_k):
        raise AssertionError("alur normal tidak boleh berjalan untuk request duplikat")

    # Bila guard gagal, fungsi akan menabrak langkah normal ini.
    monkeypatch.setattr(server, "get_or_404", boom)
    monkeypatch.setattr(server, "get_open_shift", boom)

    body = server.TransactionIn(
        type="Walk In",
        method="QRIS",
        items=[{"productId": "PRD-004", "qty": 1}],
        client_request_id="crq-existing",
    )
    result = asyncio.run(server.create_transaction(body, request=None, user=None))

    assert result.id == "TRX-20261122-0001"
    assert result.client_request_id == "crq-existing"
    assert calls["find_one"] == 1
    assert calls["insert"] == 0
    assert calls["auto"] == 0


def test_vercel_mirror_carries_idempotency_guard():
    text = MIRROR.read_text(encoding="utf-8")
    assert "client_request_id: Optional[str] = None" in text
    assert 'existing = await db.transactions.find_one({"client_request_id": client_request_id})' in text
    assert "return Transaction.from_mongo(existing)" in text


def test_migration_adds_column_and_unique_index():
    sql = SQL.read_text(encoding="utf-8").lower()
    assert "add column if not exists client_request_id text" in sql
    assert "create unique index if not exists transactions_client_request_id_uidx" in sql
    assert "where client_request_id is not null" in sql


# ---------------------------------------------------------------------------
# Fallback skema lama: kolom `client_request_id` belum ada di tabel.
# ---------------------------------------------------------------------------
class _FakeCollection:
    """Collection transaksi palsu: mencatat `find_one`/`insert_one`."""

    def __init__(self, calls, find_one_impl):
        self.calls = calls
        self.find_one_impl = find_one_impl

    async def find_one(self, flt=None, projection=None):
        self.calls["find_one"] += 1
        return await self.find_one_impl(flt)

    async def insert_one(self, doc, connection=None):
        self.calls["insert"] += 1
        self.calls["inserted"] = doc
        return None

    async def delete_one(self, flt):
        return None


class _FakeCtx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    def transaction(self):
        return self


class _FakePool:
    def acquire(self):
        return _FakeCtx()


class _FakeDB:
    def __init__(self, calls, find_one_impl):
        self.pool = _FakePool()
        self.transactions = _FakeCollection(calls, find_one_impl)
        self.open_bills = _FakeCollection(calls, find_one_impl)

    async def connect(self):
        return None


def _install_checkout(monkeypatch, calls, find_one_impl):
    """Isi seluruh kolaborator DB agar alur mencapai tahap insert transaksi."""

    async def fake_build_items(items, order_type, ojol_markup=None):
        return [{
            "id": "ITEM-1", "is_printed": False, "productId": "PRD-004",
            "productName": "Kopi", "qty": 1, "price": 15000, "hpp": 4000,
            "notes": "", "subtotal": 15000, "variantId": None,
            "variantName": "", "variantPrice": 0, "waiterId": None, "waiterName": "",
        }], 15000

    async def _noop(*_a, **_k):
        return None

    async def _shift():
        return {"_id": "SHIFT-1"}

    async def _next_id(*_a, **_k):
        return "TRX-TEST-0001"

    monkeypatch.setattr(server, "db", _FakeDB(calls, find_one_impl), raising=False)
    monkeypatch.setattr(server, "get_open_shift", lambda *a, **k: _shift())
    monkeypatch.setattr(server, "build_items", fake_build_items)
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
    monkeypatch.setattr(server, "next_id", _next_id)
    monkeypatch.setattr(server, "post_checkout_journal_entries", _noop)
    monkeypatch.setattr(server, "post_finance_source", _noop)
    monkeypatch.setattr(server, "post_hpp_checkout", _noop)
    monkeypatch.setattr(server, "consume_checkout_stock", _noop)
    monkeypatch.setattr(server, "log_order_diff", _noop)


def _checkout_body(client_request_id):
    return server.TransactionIn(
        type="Walk In",
        method="Cash",
        items=[{"productId": "PRD-004", "qty": 1}],
        client_request_id=client_request_id,
    )


def _staff():
    return server.User(id="USR-KASIR", name="Kasir", role="kasir")


def test_missing_column_fallback_lets_checkout_proceed(monkeypatch):
    """Kolom belum ada → idempotensi dilewati, transaksi tetap dibuat (bukan 500)."""
    calls = {"find_one": 0, "insert": 0}

    async def find_one_impl(_flt):
        raise asyncpg.exceptions.UndefinedColumnError(
            'column "client_request_id" does not exist'
        )

    _install_checkout(monkeypatch, calls, find_one_impl)

    result = asyncio.run(
        server.create_transaction(_checkout_body("crq-legacy"), request=None, user=_staff())
    )

    assert result.id == "TRX-TEST-0001"
    assert calls["find_one"] == 1
    assert calls["insert"] == 1
    # Kuncinya dibuang agar INSERT tidak menyentuh kolom yang belum ada.
    assert "client_request_id" not in calls["inserted"]


def test_present_column_still_persists_and_returns_key(monkeypatch):
    """Kolom ada + belum ada duplikat → kunci tetap disimpan dan dikembalikan."""
    calls = {"find_one": 0, "insert": 0}

    async def find_one_impl(flt):
        assert flt == {"client_request_id": "crq-new"}
        return None

    _install_checkout(monkeypatch, calls, find_one_impl)

    result = asyncio.run(
        server.create_transaction(_checkout_body("crq-new"), request=None, user=_staff())
    )

    assert calls["insert"] == 1
    assert calls["inserted"]["client_request_id"] == "crq-new"
    assert result.client_request_id == "crq-new"


def test_missing_column_fallback_is_in_source():
    """Guard fallback harus ada di dalam badan `create_transaction`."""
    import inspect

    source = inspect.getsource(server.create_transaction)
    assert "except asyncpg.exceptions.UndefinedColumnError:" in source
    assert "client_request_id = None" in source


def test_vercel_mirror_carries_missing_column_fallback():
    text = MIRROR.read_text(encoding="utf-8")
    assert "except asyncpg.exceptions.UndefinedColumnError:" in text
    assert "melewati pemeriksaan idempotensi" in text
