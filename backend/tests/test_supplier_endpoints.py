import asyncio

import pytest
from fastapi import HTTPException

import server
from core import User


ADMIN = User(id="admin", name="Admin", role="admin")


def _patch_pool(monkeypatch, pool):
    async def connect():
        return None

    monkeypatch.setattr(server.db, "connect", connect)
    monkeypatch.setattr(server.db, "pool", pool)


def test_create_supplier_persists_contact_fields(monkeypatch):
    class FakePool:
        async def fetchval(self, query, *args):
            assert "lower(btrim(nama_supplier))" in query
            return None

        async def fetchrow(self, query, *args):
            assert "insert into public.master_suppliers" in query
            assert args == ("Toko Sumber Rejeki", "Budi", "08123456789", "Jl. Merdeka 1")
            return {
                "id": 7,
                "nama_supplier": "Toko Sumber Rejeki",
                "kontak_person": "Budi",
                "nomor_telp": "08123456789",
                "alamat": "Jl. Merdeka 1",
            }

    _patch_pool(monkeypatch, FakePool())

    created = asyncio.run(server.create_supplier(
        server.SupplierIn(
            nama_supplier="  Toko Sumber Rejeki  ",
            kontak_person="Budi",
            nomor_telp="08123456789",
            alamat="Jl. Merdeka 1",
        ),
        _=ADMIN,
    ))

    assert created["id"] == 7
    assert created["nama_supplier"] == "Toko Sumber Rejeki"


def test_create_supplier_rejects_duplicate_name(monkeypatch):
    class FakePool:
        async def fetchval(self, query, *args):
            return 1

        async def fetchrow(self, query, *args):
            raise AssertionError("Insert tidak boleh dijalankan untuk nama duplikat.")

    _patch_pool(monkeypatch, FakePool())

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.create_supplier(
            server.SupplierIn(nama_supplier="Toko Sumber Rejeki"),
            _=ADMIN,
        ))

    assert error.value.status_code == 409


def test_finance_suppliers_returns_contact_columns(monkeypatch):
    class FakePool:
        async def fetch(self, query):
            assert "kontak_person" in query
            assert "nomor_telp" in query
            assert "alamat" in query
            return [
                {
                    "id": 1,
                    "nama_supplier": "Toko A",
                    "kontak_person": None,
                    "nomor_telp": None,
                    "alamat": None,
                }
            ]

    _patch_pool(monkeypatch, FakePool())

    rows = asyncio.run(server.finance_suppliers(_=ADMIN))

    assert rows == [
        {
            "id": 1,
            "nama_supplier": "Toko A",
            "kontak_person": None,
            "nomor_telp": None,
            "alamat": None,
        }
    ]
