# F&B POS API regression tests that ONLY touch TEST_ records (real customer data in DB).
# Covers: auth/roles, waiters list, order types (Walk In / Ojol), ojol pricing, open bill->table->pay,
# stock decrement (recipe + direct), insufficient stock, purchases (stock/cost/hpp), customer linkage,
# recipe 409 on inventory delete, reports & schema.
import math
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
CREATED = {"products": [], "inventory": [], "customers": [], "tables": [], "users": [], "open_bills": [],
           "transactions": [], "purchases": [], "expenses": []}
TEST_IP = f"10.77.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"


def login(pin, xff=None):
    h = {"X-Forwarded-For": xff} if xff else {}
    return requests.post(f"{BASE}/auth/login", json={"pin": pin}, headers=h, timeout=30)


def client(pin):
    r = login(pin)
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s


@pytest.fixture(scope="session")
def admin():
    return client("1234")


@pytest.fixture(scope="session")
def kasir():
    return client("2222")


@pytest.fixture(scope="session")
def waiter():
    return client("3333")


def inv(admin, iid):
    return [i for i in admin.get(f"{BASE}/inventory").json() if i["id"] == iid][0]


def prod(admin, pid):
    return [p for p in admin.get(f"{BASE}/products").json() if p["id"] == pid][0]


@pytest.fixture(scope="session")
def data(admin):
    a = admin.post(f"{BASE}/inventory", json={"name": "TEST_BahanA", "type": "Bahan Baku", "stock": 100, "unit": "gram", "cost_per_unit": 10}).json()
    b = admin.post(f"{BASE}/inventory", json={"name": "TEST_BarangB", "type": "Barang Jadi", "stock": 10, "unit": "pcs", "cost_per_unit": 500}).json()
    CREATED["inventory"] += [a["id"], b["id"]]
    p1 = admin.post(f"{BASE}/products", json={"name": "TEST_Kopi", "category": "TEST_Cat", "price": 20000, "price_ojol": 25000}).json()
    p2 = admin.post(f"{BASE}/products", json={"name": "TEST_Air", "category": "TEST_Cat", "price": 10000, "price_ojol": 0, "inventoryId": b["id"]}).json()
    CREATED["products"] += [p1["id"], p2["id"]]
    r = admin.put(f"{BASE}/products/{p1['id']}/recipes", json=[{"inventoryId": a["id"], "qty_needed": 5}])
    assert r.status_code == 200
    c = admin.post(f"{BASE}/customers", json={"name": "TEST_Cust"}).json()
    CREATED["customers"].append(c["id"])
    t = admin.post(f"{BASE}/tables", json={"name": "TEST_Meja", "area": "TEST_Area"}).json()
    CREATED["tables"].append(t["id"])
    pin = f"{uuid.uuid4().int % 900000 + 100000}"
    u = admin.post(f"{BASE}/users", json={"name": "TEST_Waiter", "role": "waiter", "pin": pin}).json()
    CREATED["users"].append(u["id"])
    yield {"a": a, "b": b, "p1": p1, "p2": p2, "c": c, "t": t, "u": u}
    # teardown
    MDB.transactions.delete_many({"items_json.productName": {"$regex": "^TEST_"}})
    MDB.purchases.delete_many({"supplier": {"$regex": "^TEST_"}})
    MDB.open_bills.delete_many({"items_json.productName": {"$regex": "^TEST_"}})
    for coll in ["products", "inventory", "customers", "tables", "users"]:
        MDB[coll].delete_many({"_id": {"$in": CREATED[coll]}})
    MDB.recipes.delete_many({"productId": {"$in": CREATED["products"]}})
    MDB.expenses.delete_many({"category": {"$regex": "^TEST_"}})
    MDB.login_attempts.delete_many({"identifier": TEST_IP})


# ---------- Auth / roles ----------
class TestAuth:
    @pytest.mark.parametrize("pin,role", [("1234", "admin"), ("2222", "kasir"), ("3333", "waiter")])
    def test_login_roles(self, pin, role):
        r = login(pin)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == role and "pin" not in r.json()["user"]

    def test_wrong_pin(self):
        assert login("9999", xff=TEST_IP).status_code == 401

    def test_forbidden(self, admin, kasir, waiter, data):
        body = {"type": "Takeaway", "method": "QRIS", "items": [{"productId": data["p1"]["id"], "qty": 1}]}
        assert waiter.post(f"{BASE}/transactions", json=body).status_code == 403
        assert kasir.get(f"{BASE}/inventory").status_code == 403
        assert waiter.get(f"{BASE}/customers").status_code == 200  # list allowed
        assert waiter.put(f"{BASE}/customers/{data['c']['id']}", json={"name": "TEST_Cust_Updated"}).status_code == 200
        assert kasir.get(f"{BASE}/schema").status_code == 403
        assert requests.get(f"{BASE}/products").status_code == 401

    def test_waiters_list_all_roles(self, admin, kasir, waiter, data):
        for s in (admin, kasir, waiter):
            r = s.get(f"{BASE}/users/waiters")
            assert r.status_code == 200
            ids = [w["id"] for w in r.json()]
            assert data["u"]["id"] in ids and "USR-WAITER" in ids and "USR-ADMIN" not in ids
            assert all(set(w) == {"id", "name"} for w in r.json())


# ---------- Order types / pricing ----------
class TestOrderTypes:
    @pytest.mark.parametrize("typ", ["Walk In", "Ojek Online"])
    def test_direct_types_no_open_bill(self, kasir, data, typ):
        r = kasir.post(f"{BASE}/open-bills", json={"type": typ, "items": [{"productId": data["p1"]["id"], "qty": 1}]})
        assert r.status_code == 400

    def test_ojol_price_and_fallback(self, admin, kasir, data):
        a0 = inv(admin, data["a"]["id"])["stock"]
        b0 = inv(admin, data["b"]["id"])["stock"]
        r = kasir.post(f"{BASE}/transactions", json={"type": "Ojek Online", "method": "QRIS", "tableId": data["t"]["id"],
                                                     "items": [{"productId": data["p1"]["id"], "qty": 2}, {"productId": data["p2"]["id"], "qty": 1}]})
        assert r.status_code == 200, r.text
        t = r.json()
        CREATED["transactions"].append(t["id"])
        assert t["tableId"] is None
        prices = {i["productId"]: i["price"] for i in t["items_json"]}
        assert prices[data["p1"]["id"]] == 25000 and prices[data["p2"]["id"]] == 10000
        assert t["total"] == 60000
        assert math.isclose(a0 - inv(admin, data["a"]["id"])["stock"], 10)
        assert math.isclose(b0 - inv(admin, data["b"]["id"])["stock"], 1)

    def test_walk_in_normal_price(self, kasir, data):
        r = kasir.post(f"{BASE}/transactions", json={"type": "Walk In", "method": "Cash", "cashGiven": 50000,
                                                     "items": [{"productId": data["p1"]["id"], "qty": 1}]})
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 20000 and r.json()["change"] == 30000

    def test_insufficient_stock(self, admin, kasir, data):
        b0 = inv(admin, data["b"]["id"])["stock"]
        r = kasir.post(f"{BASE}/transactions", json={"type": "Takeaway", "method": "QRIS",
                                                     "items": [{"productId": data["p2"]["id"], "qty": int(b0) + 5}]})
        assert r.status_code == 400 and "tidak cukup" in r.json()["detail"]
        assert inv(admin, data["b"]["id"])["stock"] == b0


# ---------- Dine-in open bill flow ----------
class TestDineIn:
    def test_open_bill_resume_pay(self, admin, kasir, waiter, data):
        tid = data["t"]["id"]
        r = waiter.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": tid, "customerId": data["c"]["id"],
                                                    "items": [{"productId": data["p1"]["id"], "qty": 3, "notes": "less sugar"}]})
        assert r.status_code == 200, r.text
        b = r.json()
        CREATED["open_bills"].append(b["id"])
        assert b["total"] == 60000 and b["waiterName"] == "Waiter Demo"
        t = [x for x in kasir.get(f"{BASE}/tables").json() if x["id"] == tid][0]
        assert t["status"] == "occupied"
        assert t["open_bill_id"] == b["id"] and t["orderData"]["openBillId"] == b["id"]
        assert kasir.get(f"{BASE}/open-bills/{b['id']}").json()["items_json"][0]["notes"] == "less sugar"
        # someone else's bill on same table blocked
        assert kasir.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": tid, "items": [{"productId": data["p1"]["id"], "qty": 1}]}).status_code == 409
        c0 = [x for x in admin.get(f"{BASE}/customers").json() if x["id"] == data["c"]["id"]][0]
        pay = {"type": "Dine In", "tableId": tid, "customerId": data["c"]["id"], "openBillId": b["id"], "method": "Cash",
               "items": [{"productId": data["p1"]["id"], "qty": 3}]}
        assert kasir.post(f"{BASE}/transactions", json={**pay, "cashGiven": 1000}).status_code == 400
        r = kasir.post(f"{BASE}/transactions", json={**pay, "cashGiven": 100000})
        assert r.status_code == 200, r.text
        trx = r.json()
        assert trx["change"] == 40000 and trx["waiterName"] == "Waiter Demo" and trx["tableName"] == "TEST_Meja"
        assert kasir.get(f"{BASE}/open-bills/{b['id']}").status_code == 404
        t = [x for x in kasir.get(f"{BASE}/tables").json() if x["id"] == tid][0]
        assert t["status"] == "available" and t["orderData"] is None and t["open_bill_id"] is None
        c1 = [x for x in admin.get(f"{BASE}/customers").json() if x["id"] == data["c"]["id"]][0]
        assert c1["visits"] == c0["visits"] + 1 and c1["total_spent"] == c0["total_spent"] + 60000 and c1["points"] == c0["points"] + 6

    def test_pay_repairs_stale_table_owner(self, kasir, data):
        tid = data["t"]["id"]
        r = kasir.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": tid,
                                                   "items": [{"productId": data["p2"]["id"], "qty": 1}]})
        assert r.status_code == 200, r.text
        bill = r.json()
        CREATED["open_bills"].append(bill["id"])
        stale_owner_id = f"BILL-STALE-{uuid.uuid4().hex[:8]}"
        MDB.tables.update_one({"_id": tid}, {"$set": {"orderData.openBillId": stale_owner_id}})

        payload = {"type": "Dine In", "tableId": tid, "openBillId": bill["id"], "method": "Cash",
                   "items": [{"productId": data["p2"]["id"], "qty": 1}]}
        r = kasir.post(f"{BASE}/transactions", json={**payload, "cashGiven": 1})
        assert r.status_code == 400
        assert MDB.tables.find_one({"_id": tid})["orderData"]["openBillId"] == stale_owner_id

        r = kasir.post(f"{BASE}/transactions", json={**payload, "cashGiven": 10000})
        assert r.status_code == 200, r.text
        table = kasir.get(f"{BASE}/tables").json()
        table = next(t for t in table if t["id"] == tid)
        assert table["status"] == "paid"
        assert kasir.get(f"{BASE}/open-bills/{bill['id']}").status_code == 404

    def test_cancel_bill_frees_table(self, kasir, data):
        tid = data["t"]["id"]
        b = kasir.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": tid, "items": [{"productId": data["p2"]["id"], "qty": 1}]}).json()
        assert kasir.delete(f"{BASE}/open-bills/{b['id']}").status_code == 200
        t = [x for x in kasir.get(f"{BASE}/tables").json() if x["id"] == tid][0]
        assert t["status"] == "available"


# ---------- Catalog / purchases ----------
class TestCatalog:
    def test_hpp_purchase_and_409(self, admin, data):
        p1 = prod(admin, data["p1"]["id"])
        assert math.isclose(p1["hpp"], 5 * inv(admin, data["a"]["id"])["cost_per_unit"])
        assert admin.delete(f"{BASE}/inventory/{data['a']['id']}").status_code == 409
        assert admin.delete(f"{BASE}/inventory/{data['b']['id']}").status_code == 409
        s0 = inv(admin, data["a"]["id"])["stock"]
        r = admin.post(f"{BASE}/purchases", json={"supplier": "TEST_Supp", "items": [{"inventoryId": data["a"]["id"], "qty": 50, "cost_per_unit": 30}]})
        assert r.status_code == 200 and r.json()["total_cost"] == 1500
        a = inv(admin, data["a"]["id"])
        assert a["stock"] == s0 + 50 and a["cost_per_unit"] == 30
        assert math.isclose(prod(admin, data["p1"]["id"])["hpp"], 150)
        # recipe change -> hpp recalcs
        r = admin.put(f"{BASE}/products/{data['p1']['id']}/recipes", json=[{"inventoryId": data["a"]["id"], "qty_needed": 2}])
        assert r.status_code == 200 and math.isclose(r.json()["product"]["hpp"], 60)

    def test_price_ojol_update(self, admin, data):
        r = admin.put(f"{BASE}/products/{data['p2']['id']}", json={"name": "TEST_Air", "category": "TEST_Cat", "price": 10000,
                                                                   "price_ojol": 12000, "inventoryId": data["b"]["id"]})
        assert r.status_code == 200 and r.json()["price_ojol"] == 12000 and r.json()["hpp"] == 500
        assert admin.put(f"{BASE}/products/{data['p2']['id']}", json={"name": "TEST_Air", "category": "TEST_Cat", "price": 1,
                                                                      "price_ojol": -1}).status_code == 422
        admin.put(f"{BASE}/products/{data['p2']['id']}", json={"name": "TEST_Air", "category": "TEST_Cat", "price": 10000,
                                                               "price_ojol": 0, "inventoryId": data["b"]["id"]})


# ---------- Reports / schema ----------
class TestReports:
    def test_report_and_schema(self, admin, data):
        r = admin.get(f"{BASE}/reports/summary", params={"start": "2020-01-01T00:00:00Z", "end": "2030-01-01T00:00:00Z", "tz_offset": -420})
        assert r.status_code == 200
        d = r.json()
        assert math.isclose(d["gross_profit"], d["revenue"] - d["cogs"])
        assert math.isclose(d["net_profit"], d["gross_profit"] - d["expenses"])
        assert any(x["type"] == "Ojek Online" for x in d["by_type"])
        c = admin.get(f"{BASE}/schema").json()["counts"]
        assert len(c) == 10
