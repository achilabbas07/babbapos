import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

import server
from core import User


ADMIN = User(id="admin-1", name="Admin", role="admin")
KASIR = User(id="kasir-1", name="Kasir", role="kasir")


def _transaction_body():
    return server.TransactionIn(
        type="Walk In",
        method="QRIS",
        items=[{"productId": "PRD-004", "qty": 1}],
    )


def _patch_shift(monkeypatch, shift):
    async def fake_get_open_shift(_user_id):
        return shift

    monkeypatch.setattr(server, "get_open_shift", fake_get_open_shift)


def test_admin_without_shift_is_rejected_with_shift_not_open_code(monkeypatch):
    _patch_shift(monkeypatch, None)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.create_transaction(
            _transaction_body(),
            request=None,
            user=ADMIN,
        ))

    assert error.value.status_code == 400
    assert error.value.detail["code"] == "SHIFT_NOT_OPEN"
    assert "kas awal" in error.value.detail["message"]


def test_kasir_without_shift_keeps_existing_plain_message(monkeypatch):
    """Aturan kasir tidak boleh berubah: pesan tetap string biasa tanpa kode."""
    _patch_shift(monkeypatch, None)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.create_transaction(
            _transaction_body(),
            request=None,
            user=KASIR,
        ))

    assert error.value.status_code == 400
    assert error.value.detail == "Buka shift kasir terlebih dahulu"


def test_admin_with_open_shift_passes_the_guard(monkeypatch):
    _patch_shift(monkeypatch, {"_id": "SHIFT-1", "openingCash": 100000})

    async def fake_build_items(_items, _order_type):
        raise RuntimeError("guard passed")

    monkeypatch.setattr(server, "build_items", fake_build_items)

    with pytest.raises(RuntimeError, match="guard passed"):
        asyncio.run(server.create_transaction(
            _transaction_body(),
            request=None,
            user=ADMIN,
        ))


def test_admin_shift_guard_is_mirrored_in_vercel_entrypoint():
    mirror = (
        Path(__file__).resolve().parents[2] / "api" / "index.py"
    ).read_text(encoding="utf-8")

    assert 'if user.role == "kasir" and not shift:' in mirror
    assert 'if user.role == "admin" and not shift:' in mirror
    assert '"code": "SHIFT_NOT_OPEN"' in mirror
