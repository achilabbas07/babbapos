# F&B POS API regression tests: auth/roles, open bills, transactions + stock, products/recipes/HPP,
# inventory, purchases, expenses, reports, customers, users, schema
import math
import os
import uuid

import pytest
import requests


def _load_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if not url:
        for line in open("/app/frontend/.env"):
            if line.startswith("REACT_APP_BACKEND_URL="):
                url = line.split("=", 1)[1].strip()
    return url.rstrip("/")


BASE = _load_url() + "/api"


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


def inv_map(s):
    return {i["id"]: i for i in s.get(f"{BASE}/inventory").json()}


def free_table(s):
    for t in s.get(f"{BASE}/tables").json():
        if t["status"] == "available":
            return t
    pytest.skip("no free table")


# ---------- Auth ----------
class TestAuth:
    @pytest.mark.parametrize("pin,role", [("1234", "admin"), ("2222", "kasir"), ("3333", "waiter")])
    def test_login_roles(self, pin, role):
        r = login(pin)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["role"] == role and isinstance(d["token"], str)
        assert "pin" not in d["user"]

    def test_wrong_pin_401(self):
        r = login("9999", xff=f"10.9.{uuid.uuid4().int % 250}.1")
        assert r.status_code == 401

    def test_me_and_unauth(self, admin):
        assert admin.get(f"{BASE}/auth/me").json()["id"] == "USR-ADMIN"
        assert requests.get(f"{BASE}/products").status_code == 401

    def test_lockout_after_5(self):
        ip = f"10.250.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
        codes = [login("9876", xff=ip).status_code for _ in range(6)]
        assert codes[:5] == [401] * 5 and codes[5] == 429
        # correct pin also locked
        assert login("1234", xff=ip).status_code == 429

    def test_forbidden_roles(self, kasir, waiter):
        assert waiter.get(f"{BASE}/transactions").status_code == 403
        assert waiter.get(f"{BASE}/inventory").status_code == 403
        assert kasir.get(f"{BASE}/inventory").status_code == 403
        assert kasir.get(f"{BASE}/reports/summary", params={"start": "2025-01-01", "end": "2030-01-01"}).status_code == 403
        assert kasir.get(f"{BASE}/users").status_code == 403
        assert kasir.get(f"{BASE}/transactions").status_code == 200


# ---------- Open bills & transactions ----------
class TestOrderFlow:
    def test_open_bill_occupy_and_pay_cash(self, admin, kasir):
        cust = admin.post(f"{BASE}/customers", json={"name": "TEST_Cust Flow"}).json()
        t = free_table(kasir)
        before = inv_map(admin)
        bill = kasir.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": t["id"], "customerId": cust["id"],
                                                      "items": [{"productId": "PRD-001", "qty": 2}, {"productId": "PRD-005", "qty": 3}]})
        assert bill.status_code == 200, bill.text
        b = bill.json()
        assert b["total"] == 25000 * 2 + 8000 * 3
        assert b["customerName"] == "TEST_Cust Flow"
        tbl = [x for x in kasir.get(f"{BASE}/tables").json() if x["id"] == t["id"]][0]
        assert tbl["status"] == "occupied" and tbl["orderData"]["openBillId"] == b["id"]
        # second bill same table -> 409
        r = kasir.post(f"{BASE}/open-bills", json={"type": "Dine In", "tableId": t["id"], "items": [{"productId": "PRD-005", "qty": 1}]})
        assert r.status_code == 409
        # update bill
        r = kasir.put(f"{BASE}/open-bills/{b['id']}", json={"type": "Dine In", "tableId": t["id"], "customerId": cust["id"],
                                                             "items": [{"productId": "PRD-001", "qty": 1}, {"productId": "PRD-005", "qty": 2}]})
        assert r.status_code == 200 and r.json()["total"] == 41000
        # insufficient cash
        pay = {"type": "Dine In", "tableId": t["id"], "customerId": cust["id"], "openBillId": b["id"], "method": "Cash",
               "items": [{"productId": "PRD-001", "qty": 1}, {"productId": "PRD-005", "qty": 2}]}
        r = kasir.post(f"{BASE}/transactions", json={**pay, "cashGiven": 40000})
        assert r.status_code == 400
        r = kasir.post(f"{BASE}/transactions", json={**pay, "cashGiven": 50000})
        assert r.status_code == 200, r.text
        trx = r.json()
        assert trx["id"].startswith("TRX-") and trx["change"] == 9000 and trx["cashGiven"] == 50000
        assert trx["tableId"] == t["id"] and trx["customerId"] == cust["id"]
        assert kasir.get(f"{BASE}/open-bills/{b['id']}").status_code == 404
        tbl = [x for x in kasir.get(f"{BASE}/tables").json() if x["id"] == t["id"]][0]
        assert tbl["status"] == "available" and tbl["orderData"] is None
        after = inv_map(admin)
        for iid, q in [("INV-001", 18), ("INV-002", 150), ("INV-003", 30), ("INV-010", 1), ("INV-011", 2)]:
            assert math.isclose(before[iid]["stock"] - after[iid]["stock"], q), iid
        c = [x for x in admin.get(f"{BASE}/customers").json() if x["id"] == cust["id"]][0]
        assert c["visits"] == 1 and c["total_spent"] == 41000 and c["points"] == 4
        assert kasir.get(f"{BASE}/transactions/{trx['id']}").json()["total"] == 41000
        admin.delete(f"{BASE}/customers/{cust['id']}")

    def test_qris_cashgiven_total(self, kasir):
        r = kasir.post(f"{BASE}/transactions", json={"type": "Takeaway", "method": "QRIS", "cashGiven": 0,
                                                     "items": [{"productId": "PRD-005", "qty": 1}]})
        assert r.status_code == 200
        assert r.json()["cashGiven"] == 8000 and r.json()["change"] == 0 and r.json()["tableId"] is None

    def test_insufficient_stock_no_partial(self, admin, kasir):
        before = inv_map(admin)
        qty = int(before["INV-010"]["stock"]) + 5  # cups insufficient
        r = kasir.post(f"{BASE}/transactions", json={"type": "Takeaway", "method": "QRIS",
                                                     "items": [{"productId": "PRD-001", "qty": qty}]})
        assert r.status_code == 400 and "tidak cukup" in r.json()["detail"]
        after = inv_map(admin)
        for k in before:
            assert before[k]["stock"] == after[k]["stock"]

    def test_waiter_bill_no_pay(self, waiter, kasir):
        r = waiter.post(f"{BASE}/open-bills", json={"type": "Takeaway", "items": [{"productId": "PRD-005", "qty": 1}]})
        assert r.status_code == 200 and r.json()["waiterName"] == "Waiter Demo"
        bid = r.json()["id"]
        r = waiter.post(f"{BASE}/transactions", json={"type": "Takeaway", "method": "QRIS", "openBillId": bid,
                                                      "items": [{"productId": "PRD-005", "qty": 1}]})
        assert r.status_code == 403
        assert waiter.delete(f"{BASE}/open-bills/{bid}").status_code == 403
        assert kasir.delete(f"{BASE}/open-bills/{bid}").status_code == 200


# ---------- Products / Recipes / Inventory / Purchases ----------
class TestCatalog:
    def test_product_recipe_hpp_inventory_purchase(self, admin):
        inv = admin.post(f"{BASE}/inventory", json={"name": "TEST_Bahan", "type": "Bahan Baku", "stock": 100, "unit": "gram",
                                                    "cost_per_unit": 10}).json()
        p = admin.post(f"{BASE}/products", json={"name": "TEST_Produk", "category": "Minuman", "price": 15000}).json()
        assert p["id"].startswith("PRD-")
        r = admin.put(f"{BASE}/products/{p['id']}/recipes", json=[{"inventoryId": inv["id"], "qty_needed": 5},
                                                                   {"inventoryId": "INV-002", "qty_needed": 100}])
        assert r.status_code == 200
        cost2 = inv_map(admin)["INV-002"]["cost_per_unit"]
        assert math.isclose(r.json()["product"]["hpp"], 5 * 10 + 100 * cost2)
        # dup recipe line
        assert admin.put(f"{BASE}/products/{p['id']}/recipes", json=[{"inventoryId": inv["id"], "qty_needed": 1}] * 2).status_code == 400
        # delete inventory used -> 409
        assert admin.delete(f"{BASE}/inventory/{inv['id']}").status_code == 409
        # change cost -> hpp recalc
        r = admin.put(f"{BASE}/inventory/{inv['id']}", json={"name": "TEST_Bahan", "type": "Bahan Baku", "stock": 100,
                                                             "unit": "gram", "cost_per_unit": 20})
        assert r.status_code == 200
        hpp = [x for x in admin.get(f"{BASE}/products").json() if x["id"] == p["id"]][0]["hpp"]
        assert math.isclose(hpp, 5 * 20 + 100 * cost2)
        # purchase -> stock up, cost updated, hpp recalc
        r = admin.post(f"{BASE}/purchases", json={"supplier": "TEST_Supplier", "items": [{"inventoryId": inv["id"], "qty": 50, "cost_per_unit": 30}]})
        assert r.status_code == 200 and r.json()["total_cost"] == 1500
        i2 = inv_map(admin)[inv["id"]]
        assert i2["stock"] == 150 and i2["cost_per_unit"] == 30
        hpp = [x for x in admin.get(f"{BASE}/products").json() if x["id"] == p["id"]][0]["hpp"]
        assert math.isclose(hpp, 5 * 30 + 100 * cost2)
        assert any(x["id"] == r.json()["id"] for x in admin.get(f"{BASE}/purchases").json())
        # delete product -> recipes deleted, then inventory deletable
        assert admin.delete(f"{BASE}/products/{p['id']}").status_code == 200
        assert admin.get(f"{BASE}/products/{p['id']}/recipes").json() == []
        assert admin.delete(f"{BASE}/inventory/{inv['id']}").status_code == 200
        assert admin.delete(f"{BASE}/products/{p['id']}").status_code == 404

    def test_product_update_and_invalid_inventory(self, admin):
        assert admin.post(f"{BASE}/products", json={"name": "TEST_X", "category": "A", "price": 1, "inventoryId": "INV-999"}).status_code == 404
        p = admin.post(f"{BASE}/products", json={"name": "TEST_Y", "category": "Snack", "price": 10000, "inventoryId": "INV-011"}).json()
        assert p["hpp"] == inv_map(admin)["INV-011"]["cost_per_unit"]
        r = admin.put(f"{BASE}/products/{p['id']}", json={"name": "TEST_Y2", "category": "Snack", "price": 12000, "inventoryId": "INV-011"})
        assert r.json()["name"] == "TEST_Y2" and r.json()["price"] == 12000
        admin.delete(f"{BASE}/products/{p['id']}")

    def test_kasir_cannot_create_product(self, kasir):
        assert kasir.post(f"{BASE}/products", json={"name": "TEST_K", "category": "A", "price": 1}).status_code == 403


# ---------- Expenses / Reports / Schema ----------
class TestFinance:
    def test_expense_and_report(self, admin):
        r = admin.get(f"{BASE}/reports/summary", params={"start": "2020-01-01T00:00:00Z", "end": "2030-01-01T00:00:00Z"})
        base = r.json()
        e = admin.post(f"{BASE}/expenses", json={"category": "TEST_Listrik", "description": "TEST_", "amount": 12345})
        assert e.status_code == 200
        r = admin.get(f"{BASE}/reports/summary", params={"start": "2020-01-01T00:00:00Z", "end": "2030-01-01T00:00:00Z"}).json()
        for k in ["revenue", "cogs", "gross_profit", "expenses", "net_profit", "top_products", "daily", "by_method"]:
            assert k in r
        assert math.isclose(r["expenses"] - base["expenses"], 12345)
        assert math.isclose(r["gross_profit"], r["revenue"] - r["cogs"])
        assert math.isclose(r["net_profit"], r["gross_profit"] - r["expenses"])
        assert admin.delete(f"{BASE}/expenses/{e.json()['id']}").status_code == 200
        assert admin.delete(f"{BASE}/expenses/{e.json()['id']}").status_code == 404

    def test_transactions_date_filter(self, kasir):
        all_ = kasir.get(f"{BASE}/transactions").json()
        none = kasir.get(f"{BASE}/transactions", params={"start": "2000-01-01", "end": "2000-01-02"}).json()
        assert len(all_) > 0 and none == []
        assert kasir.get(f"{BASE}/transactions", params={"start": "bad"}).status_code == 400

    def test_schema(self, admin):
        c = admin.get(f"{BASE}/schema").json()["counts"]
        assert len(c) == 10 and c["products"] >= 9


# ---------- Customers / Users ----------
class TestPeople:
    def test_customer_crud(self, admin, kasir, waiter):
        created = []
        for role_client, role in ((admin, "admin"), (kasir, "kasir"), (waiter, "waiter")):
            response = role_client.post(f"{BASE}/customers", json={"name": f"TEST_C_{role}", "wa": "0812"})
            assert response.status_code == 200, response.text
            created.append(response.json())

        c = next(customer for customer in created if customer["name"] == "TEST_C_kasir")
        assert c["points"] == 0
        r = waiter.put(f"{BASE}/customers/{c['id']}", json={"name": "TEST_C2", "wa": "0813", "email": "a@b.c"})
        assert r.json()["name"] == "TEST_C2"
        for customer in created:
            assert kasir.delete(f"{BASE}/customers/{customer['id']}").status_code == 403
            assert waiter.delete(f"{BASE}/customers/{customer['id']}").status_code == 403
            assert admin.delete(f"{BASE}/customers/{customer['id']}").status_code == 200

    def test_user_crud(self, admin):
        assert admin.post(f"{BASE}/users", json={"name": "TEST_dup", "role": "kasir", "pin": "2222"}).status_code == 409
        pin = f"{uuid.uuid4().int % 900000 + 100000}"
        u = admin.post(f"{BASE}/users", json={"name": "TEST_U", "role": "waiter", "pin": pin})
        assert u.status_code == 200 and "pin" not in u.json()
        uid = u.json()["id"]
        assert login(pin).json()["user"]["id"] == uid
        r = admin.put(f"{BASE}/users/{uid}", json={"name": "TEST_U2", "role": "kasir"})
        assert r.json()["role"] == "kasir"
        assert admin.put(f"{BASE}/users/{uid}", json={"name": "TEST_U2", "role": "kasir", "pin": "3333"}).status_code == 409
        assert admin.delete(f"{BASE}/users/USR-ADMIN").status_code == 400
        assert admin.delete(f"{BASE}/users/{uid}").status_code == 200
