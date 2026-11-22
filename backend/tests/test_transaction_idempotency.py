"""Idempotensi transaksi berbasis `client_request_id` (Tahap 2 antrean offline).

Menguji:
- `TransactionIn` menerima `client_request_id` opsional.
- `Transaction.to_mongo()` MENGHILANGKAN kolom saat kosong (kompatibilitas
  mundur) dan MENYIMPANNYA saat diisi.
- `create_transaction` mengembalikan transaksi yang SUDAH tersimpan (tanpa
  membuat baru) ketika menerima `client_request_id` yang sudah ada.
- Mirror Vercel (`api/index.py`) memuat guard yang sama.
- Migrasi SQL + revisi Alembic menambahkan kolom & indeks unik parsial.
"""
import asyncio
from pathlib import Path

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
