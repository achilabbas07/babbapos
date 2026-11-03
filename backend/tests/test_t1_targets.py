# T1 iteration_1: waiter sales targets (multi-product), waiter shifts, order-time counting, void reduce, reset per shift.
import uuid

import pytest
import requests

from test_t1_full_pos import BASE, MDB, login  # noqa

XFF = f"10.88.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
W_PIN, K_PIN = "864311", "864312"
S = {}


def sess(uid, pin):
    r = requests.post(f"{BASE}/auth/login", json={"userId": uid, "pin": pin}, headers={"X-Forwarded-For": XFF}, timeout=30)
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}", "X-Forwarded-For": XFF})
    return s


@pytest.fixture(scope="module", autouse=True)
def setup():
    a = sess("USR-ADMIN", "1234")
    S["admin"] = a
    w = a.post(f"{BASE}/users", json={"name": "TEST_TgtWaiter", "role": "waiter", "pin": W_PIN}).json()
    k = a.post(f"{BASE}/users", json={"name": "TEST_TgtKasir", "role": "kasir", "pin": K_PIN}).json()
    S["wid"], S["kid"] = w["id"], k["id"]
    S["waiter"], S["kasir"] = sess(w["id"], W_PIN), sess(k["id"], K_PIN)
    S["tables"] = [a.post(f"{BASE}/tables", json={"name": f"TEST_TG{i}", "area": "TEST_Area"}).json()["id"] for i in range(2)]
    yield
    for b in a.get(f"{BASE}/open-bills").json():
        if b.get("tableId") in S["tables"]:
            a.post(f"{BASE}/open-bills/{b['id']}/void", json={"reason": "TEST cleanup"})
    for t in S["tables"]:
        a.put(f"{BASE}/tables/{t}/status", json={"status": "available"})
        a.delete(f"{BASE}/tables/{t}")
    if S.get("tgt"):
        a.delete(f"{BASE}/targets/{S['tgt']}")
    S["waiter"].post(f"{BASE}/waiter-shifts/close")
    S["kasir"].post(f"{BASE}/shifts/close", json={"countedCash": 0})
    a.delete(f"{BASE}/users/{S['wid']}")
    a.delete(f"{BASE}/users/{S['kid']}")
    MDB.login_attempts.delete_many({"identifier": {"$regex": "^10\\.88\\."}})


def my_target(s):
    prog = s.get(f"{BASE}/targets/progress").json()
    mine = [p for p in prog if p["waiterId"] == S["wid"]]
    if not mine:
        return None
    return next(i for i in mine[0]["items"] if i["targetId"] == S["tgt"])


def test_target_crud_validation():
    a = S["admin"]
    assert a.post(f"{BASE}/targets", json={"name": "TEST_x", "productIds": [], "targetQty": 5}).status_code == 422
    assert a.post(f"{BASE}/targets", json={"name": "TEST_x", "productIds": ["PRD-004"], "targetQty": 0}).status_code == 422
    assert a.post(f"{BASE}/targets", json={"name": "TEST_x", "productIds": ["NOPE"], "targetQty": 5}).status_code == 404
    assert S["waiter"].post(f"{BASE}/targets", json={"name": "TEST_x", "productIds": ["PRD-004"], "targetQty": 5}).status_code == 403
    r = a.post(f"{BASE}/targets", json={"name": "TEST_Target", "productIds": ["PRD-003", "PRD-004"], "targetQty": 10})
    assert r.status_code == 200, r.text
    d = r.json()
    S["tgt"] = d["id"]
    assert d["productIds"] == ["PRD-003", "PRD-004"] and len(d["productNames"]) == 2
    assert any(t["id"] == S["tgt"] for t in S["waiter"].get(f"{BASE}/targets").json())
    u = a.put(f"{BASE}/targets/{S['tgt']}", json={"name": "TEST_Target", "productIds": ["PRD-003", "PRD-004"], "targetQty": 8})
    assert u.status_code == 200 and u.json()["targetQty"] == 8


def test_orders_before_shift_not_counted_then_shift_open():
    w = S["waiter"]
    w.post(f"{BASE}/waiter-shifts/close")
    assert w.get(f"{BASE}/waiter-shifts/current").json()["shift"] is None
    assert w.get(f"{BASE}/targets/progress").json() == []
    r = w.post(f"{BASE}/waiter-shifts/open")
    assert r.status_code == 200
    assert w.post(f"{BASE}/waiter-shifts/open").status_code == 409
    assert my_target(w)["achieved"] == 0


def test_order_time_counting_multi_product():
    w, t = S["waiter"], S["tables"][0]
    r = w.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": t, "customerName": "TEST_TgtCust",
                                         "items": [{"productId": "PRD-003", "qty": 2}, {"productId": "PRD-004", "qty": 1}]})
    assert r.status_code == 200, r.text
    S["bill"] = r.json()["id"]
    assert r.json()["waiterId"] == S["wid"]
    assert my_target(w)["achieved"] == 3
    # add via update
    u = w.put(f"{BASE}/open-bills/{S['bill']}", json={"type": "Dine In", "tableId": t, "customerName": "TEST_TgtCust",
                                                   "items": [{"productId": "PRD-003", "qty": 2}, {"productId": "PRD-004", "qty": 3}]})
    assert u.status_code == 200, u.text
    it = my_target(w)
    assert it["achieved"] == 5
    assert {b["productId"]: b["qty"] for b in it["breakdown"]} == {"PRD-003": 2, "PRD-004": 3}
    # admin sees same progress
    assert my_target(S["admin"])["achieved"] == 5


def test_kasir_bill_with_waiter_id_credits_waiter_and_payment_no_double_count():
    k, t = S["kasir"], S["tables"][1]
    k.post(f"{BASE}/shifts/open", json={"openingCash": 0})
    r = k.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": t, "customerName": "TEST_TgtCust2", "waiterId": S["wid"],
                                         "items": [{"productId": "PRD-004", "qty": 1}]})
    assert r.status_code == 200, r.text
    assert r.json()["waiterName"] == "TEST_TgtWaiter"
    assert my_target(S["waiter"])["achieved"] == 6
    p = k.post(f"{BASE}/transactions", json={"type": "Dine In", "tableId": t, "method": "QRIS", "openBillId": r.json()["id"],
                                           "items": [{"productId": "PRD-004", "qty": 1}]})
    assert p.status_code == 200, p.text
    assert my_target(S["waiter"])["achieved"] == 6  # payment must not add
    S["admin"].put(f"{BASE}/tables/{t}/status", json={"status": "available"})


def test_void_reduces_count():
    w = S["waiter"]
    r = w.post(f"{BASE}/open-bills/{S['bill']}/void", json={"reason": "TEST void", "adminPin": "1234"})
    assert r.status_code == 200, r.text
    assert my_target(w)["achieved"] == 1


def test_close_and_reset():
    w = S["waiter"]
    c = w.post(f"{BASE}/waiter-shifts/close")
    assert c.status_code == 200
    res = next(x for x in c.json()["results"] if x["targetId"] == S["tgt"])
    assert res["achieved"] == 1
    report = w.get(f"{BASE}/waiter-shifts/{c.json()['id']}")
    assert report.status_code == 200
    assert report.json()["waiter_name"] == c.json()["userName"]
    assert report.json()["shift_id"] == c.json()["id"]
    assert set(report.json()["results"]) == {
        "total_orders", "active_tables", "orders_data", "voids", "target_sales_status"
    }
    assert any(x["id"] == c.json()["id"] for x in S["admin"].get(f"{BASE}/waiter-shifts").json())
    assert w.post(f"{BASE}/waiter-shifts/close").status_code == 400
    assert w.post(f"{BASE}/waiter-shifts/open").status_code == 200
    assert my_target(w)["achieved"] == 0


def test_kasir_cannot_see_progress():
    assert S["kasir"].get(f"{BASE}/targets/progress").status_code == 403
    assert S["kasir"].post(f"{BASE}/waiter-shifts/open").status_code == 403
