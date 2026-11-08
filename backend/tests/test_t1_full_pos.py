# T1 iteration_1 regression: auth (user+PIN), roles, shifts/cash, open bills, reduction guard,
# table ops (split/merge/move/void/clear), ojol pricing, stock decrement, layout, fixture, reports/schema.
# Only TEST_ records are created and cleaned up.
import os
import uuid

import pytest
import requests
from pymongo import MongoClient


def _env(path, key):
    for line in open(path):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')


BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _env("/app/frontend/.env", "REACT_APP_BACKEND_URL")).rstrip("/") + "/api"
MDB = MongoClient(_env("/app/backend/.env", "MONGO_URL"))[_env("/app/backend/.env", "DB_NAME")]
XFF = f"10.88.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
K_PIN, W_PIN = "864297", "864298"
S = {}


def login(uid, pin, xff=XFF):
    return requests.post(f"{BASE}/auth/login", json={"userId": uid, "pin": pin}, headers={"X-Forwarded-For": xff}, timeout=30)


def sess(uid, pin):
    r = login(uid, pin)
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    s.headers["X-Forwarded-For"] = XFF
    return s


@pytest.fixture(scope="module", autouse=True)
def setup():
    a = sess("USR-ADMIN", "1234")
    S["admin"] = a
    k = a.post(f"{BASE}/users", json={"name": "TEST_Kasir", "role": "kasir", "pin": K_PIN}).json()
    w = a.post(f"{BASE}/users", json={"name": "TEST_Waiter", "role": "waiter", "pin": W_PIN}).json()
    S["kid"], S["wid"] = k["id"], w["id"]
    S["kasir"], S["waiter"] = sess(k["id"], K_PIN), sess(w["id"], W_PIN)
    S["tables"] = [a.post(f"{BASE}/tables", json={"name": f"TEST_T{i}", "area": "TEST_Area"}).json()["id"] for i in range(4)]
    S["cust"] = a.post(f"{BASE}/customers", json={"name": "TEST_Cust"}).json()["id"]
    yield
    for b in a.get(f"{BASE}/open-bills").json():
        if b.get("tableId") in S["tables"] or b.get("customerName", "").startswith("TEST_"):
            a.post(f"{BASE}/open-bills/{b['id']}/void", json={"reason": "TEST cleanup"})
    for t in S["tables"]:
        a.put(f"{BASE}/tables/{t}/status", json={"status": "available"})
        a.delete(f"{BASE}/tables/{t}")
    if S.get("fixture"):
        a.delete(f"{BASE}/tables/{S['fixture']}")
    S["kasir"].post(f"{BASE}/shifts/close", json={"countedCash": 0})
    a.delete(f"{BASE}/customers/{S['cust']}")
    a.delete(f"{BASE}/users/{S['kid']}")
    a.delete(f"{BASE}/users/{S['wid']}")


def bill(s, table, items, name="TEST_Bill", **kw):
    return s.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": table, "customerName": name, "items": items, **kw})


# ---- auth ----
def test_auth_users_public():
    r = requests.get(f"{BASE}/auth/users")
    assert r.status_code == 200
    d = r.json()
    assert any(u["id"] == "USR-ADMIN" for u in d) and all("pin" not in u for u in d)


def test_login_wrong_pin_and_other_user_pin():
    assert login("USR-ADMIN", "9999").status_code == 401
    # kasir PIN with admin userId must fail
    assert login("USR-ADMIN", K_PIN).status_code == 401
    assert login("USR-ADMIN", "1234").status_code == 200


def test_pin_hash_bcrypt():
    assert MDB.users.find_one({"_id": "USR-ADMIN"})["pin"].startswith("$2b$")


def test_role_access():
    assert S["kasir"].get(f"{BASE}/transactions").status_code == 403
    assert S["waiter"].get(f"{BASE}/transactions").status_code == 403
    assert S["admin"].get(f"{BASE}/transactions").status_code == 200
    assert S["waiter"].post(f"{BASE}/transactions", json={"type": "Walk In", "method": "QRIS", "items": [{"productId": "PRD-004", "qty": 1}]}).status_code == 403
    w = S["kasir"].get(f"{BASE}/users/waiters").json()
    assert any(x["id"] == S["wid"] for x in w)


# ---- shift ----
def test_kasir_pay_without_shift_400():
    r = S["kasir"].post(f"{BASE}/transactions", json={"type": "Walk In", "method": "QRIS", "items": [{"productId": "PRD-004", "qty": 1}]})
    assert r.status_code == 400 and "shift" in r.text.lower()


def test_shift_open_movements_close_math():
    k = S["kasir"]
    assert k.get(f"{BASE}/shifts/current").json()["shift"] is None
    r = k.post(f"{BASE}/shifts/open", json={"openingCash": 100000})
    assert r.status_code == 200
    S["shift"] = r.json()["id"]
    assert k.post(f"{BASE}/shifts/open", json={"openingCash": 1}).status_code == 409
    assert k.post(f"{BASE}/shifts/cash-movements", json={"type": "in", "amount": 50000, "note": "TEST in"}).status_code == 200
    assert k.post(f"{BASE}/shifts/cash-movements", json={"type": "out", "amount": 20000, "note": "TEST out"}).status_code == 200
    assert k.post(f"{BASE}/shifts/cash-movements", json={"type": "out", "amount": 1, "note": ""}).status_code == 422
    t = k.post(f"{BASE}/transactions", json={"type": "Walk In", "method": "Cash", "cashGiven": 20000, "customerId": S["cust"],
                                             "items": [{"productId": "PRD-004", "qty": 1}]})
    assert t.status_code == 200, t.text
    assert t.json()["shiftId"] == S["shift"] and t.json()["change"] == 8000
    q = k.post(f"{BASE}/transactions", json={"type": "Walk In", "method": "QRIS", "items": [{"productId": "PRD-004", "qty": 1}]})
    assert q.status_code == 200
    c = MDB.customers.find_one({"_id": S["cust"]})
    assert c["visits"] == 1 and c["points"] == 1 and c["total_spent"] == 12000
    shifts = S["admin"].get(f"{BASE}/shifts").json()
    mine = next(x for x in shifts if x["id"] == S["shift"])
    assert mine["expectedCash"] == 100000 + 12000 + 50000 - 20000
    S["kasir_open"] = True


# ---- ojol / walk-in ----
def test_ojol_price_and_no_open_bill():
    a = S["admin"]
    p = a.get(f"{BASE}/products").json()
    p4 = next(x for x in p if x["id"] == "PRD-004")
    orig = p4.get("price_ojol", 0)
    body = {k: p4[k] for k in ("name", "category", "price", "type", "image", "inventoryId", "hpp")}
    a.put(f"{BASE}/products/PRD-004", json={**body, "price_ojol": 15000})
    try:
        r = a.post(f"{BASE}/transactions", json={"type": "Ojek Online", "method": "QRIS", "items": [{"productId": "PRD-004", "qty": 2}]})
        assert r.status_code == 200 and r.json()["total"] == 30000 and r.json()["tableId"] is None
    finally:
        a.put(f"{BASE}/products/PRD-004", json={**body, "price_ojol": orig})
    r = a.post(f"{BASE}/open-bills", json={"type": "Walk In", "items": [{"productId": "PRD-004", "qty": 1}]})
    assert r.status_code == 400


def test_stock_decrements_on_payment():
    a = S["admin"]
    recs = a.get(f"{BASE}/products/PRD-003/recipes").json()
    before = {i["id"]: i["stock"] for i in a.get(f"{BASE}/inventory").json()}
    r = a.post(f"{BASE}/transactions", json={"type": "Takeaway", "method": "Card", "items": [{"productId": "PRD-003", "qty": 2}]})
    assert r.status_code == 200
    after = {i["id"]: i["stock"] for i in a.get(f"{BASE}/inventory").json()}
    for rc in recs:
        assert abs(before[rc["inventoryId"]] - after[rc["inventoryId"]] - rc["qty_needed"] * 2) < 1e-6


# ---- open bill + reduction guard ----
def test_open_bill_occupies_and_reduction_guard():
    k, t = S["kasir"], S["tables"][0]
    r = bill(k, t, [{"productId": "PRD-004", "qty": 3}])
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    S["bill0"] = bid
    tb = next(x for x in k.get(f"{BASE}/tables").json() if x["id"] == t)
    assert tb["status"] == "occupied" and tb["orderData"]["openBillId"] == bid and tb["orderData"]["customerName"] == "TEST_Bill"
    assert bill(k, t, [{"productId": "PRD-004", "qty": 1}]).status_code == 409
    base = {"type": "Dine In", "tableId": t, "customerName": "TEST_Bill"}
    assert k.put(f"{BASE}/open-bills/{bid}", json={**base, "items": [{"productId": "PRD-004", "qty": 4}]}).status_code == 200
    assert k.put(f"{BASE}/open-bills/{bid}", json={**base, "items": [{"productId": "PRD-004", "qty": 2}]}).status_code == 403
    assert S["waiter"].put(f"{BASE}/open-bills/{bid}", json={**base, "items": [{"productId": "PRD-003", "qty": 1}]}).status_code == 403
    assert k.put(f"{BASE}/open-bills/{bid}", json={**base, "items": [{"productId": "PRD-004", "qty": 2}], "adminPin": "1234"}).status_code == 200
    assert k.get(f"{BASE}/open-bills/{bid}").json()["items_json"][0]["qty"] == 2
    # pay full bill with reduced items without PIN -> 403
    r = k.post(f"{BASE}/transactions", json={**base, "method": "QRIS", "openBillId": bid, "items": [{"productId": "PRD-004", "qty": 1}]})
    assert r.status_code == 403


def test_split_then_full_pay_then_clear():
    k, t, bid = S["kasir"], S["tables"][0], S["bill0"]
    k.put(f"{BASE}/open-bills/{bid}", json={"type": "Dine In", "tableId": t, "customerName": "TEST_Bill",
                                            "items": [{"productId": "PRD-004", "qty": 2}, {"productId": "PRD-003", "qty": 1}]})
    r = k.post(f"{BASE}/transactions", json={"type": "Dine In", "tableId": t, "method": "QRIS", "openBillId": bid, "partial": True,
                                             "items": [{"productId": "PRD-004", "qty": 1}]})
    assert r.status_code == 200, r.text
    b = k.get(f"{BASE}/open-bills/{bid}").json()
    assert {i["productId"]: i["qty"] for i in b["items_json"]} == {"PRD-004": 1, "PRD-003": 1}
    assert b["total"] == 12000 + 22000
    r = k.post(f"{BASE}/transactions", json={"type": "Dine In", "tableId": t, "method": "Cash", "cashGiven": 50000, "openBillId": bid,
                                             "items": [{"productId": "PRD-004", "qty": 1}, {"productId": "PRD-003", "qty": 1}]})
    assert r.status_code == 200
    assert k.get(f"{BASE}/open-bills/{bid}").status_code == 404
    tb = next(x for x in k.get(f"{BASE}/tables").json() if x["id"] == t)
    assert tb["status"] == "paid"
    assert k.put(f"{BASE}/tables/{t}/status", json={"status": "available"}).json()["status"] == "available"


def test_merge_move_void():
    a, w = S["admin"], S["waiter"]
    t1, t2, t3 = S["tables"][1], S["tables"][2], S["tables"][3]
    b1 = bill(w, t1, [{"productId": "PRD-004", "qty": 1}]).json()["id"]
    b2 = bill(w, t2, [{"productId": "PRD-004", "qty": 2}, {"productId": "PRD-005", "qty": 1}]).json()["id"]
    r = w.post(f"{BASE}/open-bills/{b1}/merge", json={"sourceBillId": b2})
    assert r.status_code == 200
    assert {i["productId"]: i["qty"] for i in r.json()["items_json"]} == {"PRD-004": 3, "PRD-005": 1}
    tabs = {x["id"]: x for x in w.get(f"{BASE}/tables").json()}
    assert tabs[t2]["status"] == "available" and tabs[t1]["orderData"]["itemCount"] == 4
    r = w.post(f"{BASE}/open-bills/{b1}/move", json={"tableId": t3})
    assert r.status_code == 200
    tabs = {x["id"]: x for x in w.get(f"{BASE}/tables").json()}
    assert tabs[t1]["status"] == "available" and tabs[t3]["orderData"]["openBillId"] == b1
    # void by waiter without / wrong / correct admin pin
    assert w.post(f"{BASE}/open-bills/{b1}/void", json={"reason": "x"}).status_code == 403
    assert w.post(f"{BASE}/open-bills/{b1}/void", json={"adminPin": "1234", "reason": "TEST void"}).status_code == 200
    assert MDB.void_logs.find_one({"billId": b1})["authorizedBy"] == "Admin"
    assert next(x for x in a.get(f"{BASE}/tables").json() if x["id"] == t3)["status"] == "available"


def test_verify_admin_pin():
    assert S["waiter"].post(f"{BASE}/auth/verify-admin", json={"pin": "1234"}).status_code == 200
    assert S["waiter"].post(f"{BASE}/auth/verify-admin", json={"pin": K_PIN}).status_code == 401
    assert S["waiter"].post(f"{BASE}/auth/verify-admin", json={"pin": "1234"}).status_code == 200  # reset counter


# ---- layout / fixture ----
def test_layout_and_fixture():
    a = S["admin"]
    t = S["tables"][0]
    assert a.put(f"{BASE}/tables/layout", json=[{"id": t, "x": 7, "y": 9}]).status_code == 200
    tb = next(x for x in a.get(f"{BASE}/tables").json() if x["id"] == t)
    assert (tb["x"], tb["y"]) == (7, 9)
    f = a.post(f"{BASE}/tables", json={"name": "TEST_Bar", "area": "TEST_Area", "kind": "fixture"}).json()
    S["fixture"] = f["id"]
    assert f["kind"] == "fixture"
    assert bill(a, f["id"], [{"productId": "PRD-004", "qty": 1}]).status_code == 400
    assert S["kasir"].put(f"{BASE}/tables/layout", json=[{"id": t, "x": 1, "y": 1}]).status_code == 403


# ---- close shift ----
def test_close_shift_blind():
    r = S["kasir"].post(f"{BASE}/shifts/close", json={"countedCash": 200000})
    assert r.status_code == 200
    d = r.json()
    # opening 100000 + cash sales (12000 + 40000 cash pay of split remaining: 34000) + 50000 - 20000
    assert d["expectedCash"] == 100000 + 12000 + 34000 + 50000 - 20000
    assert d["difference"] == 200000 - d["expectedCash"] and d["status"] == "closed"


def test_reports_schema_purchase_expense():
    a = S["admin"]
    assert a.get(f"{BASE}/reports/summary", params={"start": "2020-01-01T00:00:00", "end": "2100-01-01T00:00:00"}).status_code == 200
    c = a.get(f"{BASE}/schema").json()["counts"]
    assert "shifts" in c and "cash_movements" in c
    assert S["kasir"].get(f"{BASE}/inventory").status_code == 403
