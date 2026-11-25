"""Riwayat transaksi pelanggan (Opsi A: endpoint BACA-SAJA tanpa migrasi).

Menguji `GET /customers/{cid}/purchases` pada `backend/server.py` dan mirror
Vercel `api/index.py`:

- Route terdaftar di kedua entrypoint.
- Badan fungsi mirror identik dengan `server.py` (paritas Vercel).
- Tepat 7 informasi yang diminta dikembalikan: Tanggal (WITA), Waktu Order
  (WITA), Waktu Bayar (WITA), No. Meja, Total Item, Jumlah, Pelayan.
- Nama meja & pelayan di-resolve dari relasi (`tables`/`users`) dengan fallback
  `tableName`/`waiterName` dan `waiterName` per baris item.
- Filter tanggal memakai `date_range_query` (kalender WITA) dan menolak rentang
  terbalik dengan HTTP 400.
- Penandaan void membaca `void_logs` secara best-effort (tanpa kolom tautan
  baru) dan TIDAK pernah menghapus riwayat pelanggan.
- AKSES KHUSUS ADMIN: endpoint dibatasi `Depends(ADMIN)` sehingga kasir/waiter
    menerima HTTP 403. Diuji lewat `dependency_overrides` (izin admin lolos,
    non-admin ditolak) dan inspeksi AST sumber di kedua entrypoint.
- Endpoint bersifat baca-saja: tidak ada satu pun panggilan tulis (`insert_*`,
  `update_*`, `delete_*`) di dalamnya.
"""
import ast
import asyncio
import inspect
from pathlib import Path

import pytest
from fastapi import HTTPException

import core
import server

MIRROR = Path(__file__).resolve().parents[2] / "api" / "index.py"
SERVER = Path(__file__).resolve().parents[1] / "server.py"


# ---------------------------------------------------------------------------
# Doubles
# ---------------------------------------------------------------------------
class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.order = []

    def sort(self, key, direction=1):
        self.order.append((key, direction))
        return self

    async def to_list(self, length=None):
        return list(self.rows)


class FakeCollection:
    """Collection palsu: mencatat filter & jumlah panggilan."""

    def __init__(self, rows):
        self.rows = rows
        self.filters = []
        self.writes = 0

    def find(self, flt=None, projection=None):
        self.filters.append(flt)
        return FakeCursor(self.rows)

    async def find_one(self, flt=None, projection=None):
        self.filters.append(flt)
        return next((r for r in self.rows if r.get("_id") == (flt or {}).get("_id")), None)

    async def insert_one(self, *_a, **_k):  # pragma: no cover - baca-saja
        self.writes += 1
        raise AssertionError("endpoint riwayat pelanggan harus baca-saja")

    async def update_one(self, *_a, **_k):  # pragma: no cover - baca-saja
        self.writes += 1
        raise AssertionError("endpoint riwayat pelanggan harus baca-saja")

    async def delete_one(self, *_a, **_k):  # pragma: no cover - baca-saja
        self.writes += 1
        raise AssertionError("endpoint riwayat pelanggan harus baca-saja")


class FakeDB:
    def __init__(self, transactions=None, tables=None, users=None, void_logs=None):
        self.transactions = FakeCollection(transactions or [])
        self.tables = FakeCollection(tables or [])
        self.users = FakeCollection(users or [])
        self.void_logs = FakeCollection(void_logs or [])
        self.customers = FakeCollection([{"_id": "CUST-1", "name": "Budi"}])

    def __getitem__(self, name):
        return getattr(self, name)


# 2026-11-11 01:30 WITA (transaksi dini hari — harus tetap tanggal 11).
TRANSACTIONS = [
    {
        "_id": "TRX-20261111-0002",
        "date": "2026-11-10T17:30:00+00:00",
        "orderTime": "2026-11-10T17:00:00+00:00",
        "customerId": "CUST-1",
        "tableId": "T1",
        "tableName": "Nama Meja Lama",
        "total": 45000,
        "waiterId": "U1",
        "waiterName": "Nama Lama",
        "items_json": [
            {"productId": "P1", "qty": 1},
            {"productId": "P2", "qty": 5},
        ],
    },
    {
        "_id": "TRX-20261109-0001",
        "date": "2026-11-09T04:00:00+00:00",  # 2026-11-09 12:00 WITA
        "orderTime": None,
        "customerId": "CUST-1",
        "tableId": None,
        "tableName": "",
        "total": 15000,
        "waiterId": None,
        "waiterName": "",
        "items_json": [
            {"productId": "P3", "qty": 2, "waiterName": "Sari"},
        ],
    },
]

TABLES = [{"_id": "T1", "name": "Meja 1"}]
USERS = [{"_id": "U1", "name": "Budi Setiawan"}]
VOID_LOGS = [
    {
        "_id": "VOID-001",
        "billId": "BILL-9",
        "timestamp": "2026-11-10T17:45:00+00:00",  # 2026-11-11 01:45 WITA
        "tableId": "T1",
        "total": 45000,
        "items_json": [{"productId": "P1", "qty": 6}],
        "reason": "TEST",
    },
]


def _run(fake_db, monkeypatch, start=None, end=None):
    monkeypatch.setattr(server, "db", fake_db)
    return asyncio.run(server.customer_purchases("CUST-1", start=start, end=end, _=None))


def _row(rows, trx_id):
    return next(r for r in rows if r["id"] == trx_id)


# ---------------------------------------------------------------------------
# Route & paritas mirror
# ---------------------------------------------------------------------------
def test_route_registered_in_server_and_mirror():
    server_paths = [r.path for r in server.api.routes if hasattr(r, "path")]
    assert "/api/customers/{cid}/purchases" in server_paths

    mirror_text = MIRROR.read_text(encoding="utf-8")
    assert '@api.get("/customers/{cid}/purchases")' in mirror_text


def test_mirror_body_matches_server_body():
    mirror_text = MIRROR.read_text(encoding="utf-8")
    mirror_lines = mirror_text.splitlines()

    def mirror_body(name):
        tree = ast.parse(mirror_text)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
                end = max(getattr(n, "end_lineno", node.lineno) for n in ast.walk(node))
                return mirror_lines[node.lineno - 1:end]
        raise AssertionError(f"Fungsi {name} tidak ditemukan di api/index.py")

    def body_only(lines):
        for index, line in enumerate(lines):
            if line.lstrip().startswith(("async def ", "def ")):
                return lines[index:]
        return lines

    expected = body_only(inspect.getsource(server.customer_purchases).splitlines())
    assert body_only(mirror_body("customer_purchases")) == expected, (
        "customer_purchases di api/index.py menyimpang dari backend/server.py"
    )


def test_endpoint_is_read_only():
    source = inspect.getsource(server.customer_purchases)
    for forbidden in ("insert_one", "insert_many", "update_one", "replace_one", "delete_one", "delete_many"):
        assert forbidden not in source, f"endpoint riwayat pelanggan tidak boleh memanggil {forbidden}"


# ---------------------------------------------------------------------------
# Tujuh informasi yang diminta
# ---------------------------------------------------------------------------
def test_returns_exactly_seven_requested_fields(monkeypatch):
    rows = _run(FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS), monkeypatch)
    assert len(rows) == 2
    expected = {"id", "tanggal", "waktuOrder", "waktuBayar", "meja", "totalItem", "jumlah", "pelayan", "void"}
    for row in rows:
        assert set(row) == expected
    # Tanpa `id`/`void` (metadata internal) tepat 7 informasi yang diminta.
    assert expected - {"id", "void"} == {
        "tanggal", "waktuOrder", "waktuBayar", "meja", "totalItem", "jumlah", "pelayan",
    }


def test_times_and_dates_use_wita_calendar(monkeypatch):
    rows = _run(FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS), monkeypatch)
    early = _row(rows, "TRX-20261111-0002")
    # 17:30 UTC = 01:30 WITA keesokan harinya.
    assert early["tanggal"] == "2026-11-11"
    assert early["waktuBayar"] == "2026-11-11T01:30:00+08:00"
    assert early["waktuOrder"] == "2026-11-11T01:00:00+08:00"


def test_order_time_falls_back_to_payment_time(monkeypatch):
    rows = _run(FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS), monkeypatch)
    fallback = _row(rows, "TRX-20261109-0001")
    assert fallback["waktuOrder"] == fallback["waktuBayar"] == "2026-11-09T12:00:00+08:00"


def test_table_name_resolved_and_dash_for_non_table_orders(monkeypatch):
    rows = _run(FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS), monkeypatch)
    assert _row(rows, "TRX-20261111-0002")["meja"] == "Meja 1"
    assert _row(rows, "TRX-20261109-0001")["meja"] == "-"


def test_total_item_sums_item_quantities(monkeypatch):
    rows = _run(FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS), monkeypatch)
    assert _row(rows, "TRX-20261111-0002")["totalItem"] == 6
    assert _row(rows, "TRX-20261109-0001")["totalItem"] == 2
    assert _row(rows, "TRX-20261111-0002")["jumlah"] == 45000


def test_waiter_resolved_from_users_then_item_fallback(monkeypatch):
    rows = _run(FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS), monkeypatch)
    # Nama terbaru dari tabel users dipakai, bukan snapshot `waiterName`.
    assert _row(rows, "TRX-20261111-0002")["pelayan"] == "Budi Setiawan"
    # Tanpa waiterId: jatuh ke `waiterName` baris item, lalu "-" bila kosong.
    assert _row(rows, "TRX-20261109-0001")["pelayan"] == "Sari"


def test_waiter_dash_when_no_source_available(monkeypatch):
    trx = [{
        "_id": "TRX-X", "date": "2026-11-09T04:00:00+00:00", "customerId": "CUST-1",
        "total": 1000, "items_json": [{"productId": "P1", "qty": 1}],
    }]
    rows = _run(FakeDB(trx, [], [], []), monkeypatch)
    assert rows[0]["pelayan"] == "-"


# ---------------------------------------------------------------------------
# Filter tanggal WITA
# ---------------------------------------------------------------------------
def test_date_range_filter_uses_customer_and_wita_bounds(monkeypatch):
    fake = FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS)
    _run(fake, monkeypatch, start="2026-11-11", end="2026-11-11")
    flt = fake.transactions.filters[0]
    assert flt["customerId"] == "CUST-1"
    # 2026-11-11 00:00 WITA == 2026-11-10 16:00 UTC
    assert flt["date"]["$gte"] == "2026-11-10T16:00:00+00:00"
    # batas atas eksklusif: 2026-11-12 00:00 WITA == 2026-11-11 16:00 UTC
    assert flt["date"]["$lt"] == "2026-11-11T16:00:00+00:00"


def test_no_filter_query_when_range_empty(monkeypatch):
    fake = FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS)
    _run(fake, monkeypatch)
    assert fake.transactions.filters[0] == {"customerId": "CUST-1"}


def test_reversed_range_is_rejected(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        _run(FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS), monkeypatch, start="2026-11-30", end="2026-11-01")
    assert exc.value.status_code == 400


def test_unknown_customer_returns_404(monkeypatch):
    fake = FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS)
    fake.customers = FakeCollection([])
    with pytest.raises(HTTPException) as exc:
        _run(fake, monkeypatch)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Void (best-effort, tanpa kolom tautan baru)
# ---------------------------------------------------------------------------
def test_void_flag_is_best_effort_and_never_hides_history(monkeypatch):
    rows = _run(FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS), monkeypatch)
    assert len(rows) == 2, "transaksi void tetap ditampilkan"
    assert _row(rows, "TRX-20261111-0002")["void"] is True
    assert _row(rows, "TRX-20261109-0001")["void"] is False


def test_void_lookup_uses_timestamp_field(monkeypatch):
    fake = FakeDB(TRANSACTIONS, TABLES, USERS, VOID_LOGS)
    _run(fake, monkeypatch)
    assert fake.void_logs.filters, "endpoint harus membaca void_logs"
    assert "timestamp" in fake.void_logs.filters[0]


def test_no_void_logs_leaves_flag_false(monkeypatch):
    rows = _run(FakeDB(TRANSACTIONS, TABLES, USERS, []), monkeypatch)
    assert all(r["void"] is False for r in rows)


def test_no_schema_migration_introduced():
    """Opsi A: tidak boleh ada migrasi/SQL baru untuk fitur ini."""
    backend = Path(__file__).resolve().parents[1]
    sql_files = list((backend / "supabase").glob("*.sql"))
    versions = list((backend / "alembic" / "versions").glob("*.py"))
    assert sql_files and versions, "struktur migrasi tidak terdeteksi"
    for path in sql_files + versions:
        assert "customers_purchases" not in path.read_text(encoding="utf-8").lower()
        assert "customer_purchase" not in path.read_text(encoding="utf-8").lower(), (
            f"Opsi A tidak boleh menambah migrasi baru: {path.name}"
        )


# ---------------------------------------------------------------------------
# AKSES KHUSUS ADMIN (kasir & waiter ditolak, admin lolos)
# ---------------------------------------------------------------------------
def _invoke_guard(role):
    """Jalankan dependency `require_roles("admin")` persis seperti FastAPI.

    `get_current_user` (parameter default) diisi langsung dengan user ber-role
    tertentu sehingga hasilnya mencerminkan guard yang benar-benar dipasang di
    endpoint (`Depends(ADMIN)`), tanpa butuh server/DB/httpx."""
    guard = core.require_roles("admin")
    return asyncio.run(guard(core.User(id=f"U-{role}", name=f"Uji {role}", role=role)))


@pytest.mark.parametrize("role", ["kasir", "waiter"])
def test_guard_rejects_non_admin_roles(role):
    with pytest.raises(HTTPException) as exc:
        _invoke_guard(role)
    assert exc.value.status_code == 403


def test_guard_allows_admin_role():
    user = _invoke_guard("admin")
    assert user.role == "admin"


def test_endpoint_dependency_is_admin_only():
    """Guard endpoint harus `require_roles("admin")` -- bukan ANY/CUSTOMER_STAFF."""
    signature = inspect.signature(server.customer_purchases)
    dependency = signature.parameters["_"].default.dependency
    for role in ("admin",):
        assert asyncio.run(dependency(core.User(id="U", name="U", role=role))).role == role
    for role in ("kasir", "waiter"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(dependency(core.User(id="U", name="U", role=role)))
        assert exc.value.status_code == 403


@pytest.mark.parametrize("source", [SERVER, MIRROR])
def test_guard_is_depends_admin_in_both_entrypoints(source):
    text = source.read_text(encoding="utf-8")
    start = text.index("@api.get(\"/customers/{cid}/purchases\")")
    header = text[start:start + 400]
    assert "Depends(ADMIN)" in header, f"{source.name}: guard riwayat pelanggan bukan ADMIN"
    assert "Depends(ANY)" not in header, f"{source.name}: riwayat pelanggan tidak boleh ANY"
