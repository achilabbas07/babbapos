import os

from core import (Customer, InventoryItem, Product, Recipe, Table, db, hash_pin, is_hashed, next_id, recalc_hpp)

INVENTORY = [
    ("Biji Kopi Arabika", "Bahan Baku", 2000, "gram", 250, 300),
    ("Susu UHT", "Bahan Baku", 10000, "ml", 20, 2000),
    ("Gula Aren Cair", "Bahan Baku", 3000, "ml", 40, 500),
    ("Teh Hitam", "Bahan Baku", 500, "gram", 150, 100),
    ("Gula Pasir", "Bahan Baku", 5000, "gram", 16, 1000),
    ("Beras", "Bahan Baku", 20000, "gram", 14, 3000),
    ("Ayam Fillet", "Bahan Baku", 8000, "gram", 60, 1500),
    ("Telur Ayam", "Bahan Baku", 120, "pcs", 2200, 20),
    ("Mie Telur", "Bahan Baku", 5000, "gram", 30, 1000),
    ("Cup Plastik 16oz", "Kemasan", 500, "pcs", 800, 100),
    ("Air Mineral 600ml", "Barang Jadi", 48, "pcs", 3000, 12),
    ("Croissant Butter (frozen)", "Barang Jadi", 30, "pcs", 9000, 8),
]

# name, category, price, image, direct inventory index, [(inventory index, qty)]
PRODUCTS = [
    ("Kopi Susu Gula Aren", "Minuman", 25000, "kopi-susu", None, [(0, 18), (1, 150), (2, 30), (9, 1)]),
    ("Cafe Latte", "Minuman", 28000, "latte", None, [(0, 18), (1, 200), (9, 1)]),
    ("Americano", "Minuman", 22000, "americano", None, [(0, 18), (9, 1)]),
    ("Es Teh Manis", "Minuman", 12000, "es-teh", None, [(3, 5), (4, 20), (9, 1)]),
    ("Air Mineral", "Minuman", 8000, "air-mineral", 10, []),
    ("Nasi Goreng Spesial", "Makanan", 35000, "nasi-goreng", None, [(5, 150), (6, 80), (7, 1)]),
    ("Mie Goreng Jawa", "Makanan", 30000, "mie-goreng", None, [(8, 120), (6, 60), (7, 1)]),
    ("Ayam Geprek", "Makanan", 32000, "ayam-geprek", None, [(5, 150), (6, 150)]),
    ("Croissant Butter", "Snack", 22000, "croissant", 11, []),
]

TABLES = [(f"Meja {i}", "Indoor") for i in range(1, 7)] + [(f"Teras {i}", "Outdoor") for i in range(1, 4)] + [("VIP 1", "VIP Room")]


async def hash_plain_pins():
    # PIN yang diisi langsung di Supabase (teks biasa) dienkripsi tanpa mengubah nilainya
    async for u in db.users.find():
        if u.get("pin") and not is_hashed(u["pin"]):
            await db.users.update_one({"_id": u["_id"]}, {"$set": {"pin": hash_pin(str(u["pin"]).strip())}})


async def seed_admin():
    await hash_plain_pins()
    if not await db.users.find_one({"_id": "USR-ADMIN"}):
        await db.users.insert_one({"_id": "USR-ADMIN", "name": "Admin", "role": "admin", "pin": hash_pin(os.environ["ADMIN_PIN"])})


async def seed_demo():
    if await db.meta.find_one({"_id": "demo_seeded"}):
        return
    await db.meta.insert_one({"_id": "demo_seeded"})
    if await db.products.count_documents({}) > 0:
        return
    for uid, name, role, pin in [("USR-KASIR", "Kasir Demo", "kasir", "2222"), ("USR-WAITER", "Waiter Demo", "waiter", "3333")]:
        await db.users.update_one({"_id": uid}, {"$setOnInsert": {"name": name, "role": role, "pin": hash_pin(pin)}}, upsert=True)

    inv_ids = []
    for name, typ, stock, unit, cost, min_stock in INVENTORY:
        item = InventoryItem(id=await next_id("INV"), name=name, type=typ, stock=stock, unit=unit, cost_per_unit=cost, min_stock=min_stock)
        await db.inventory.insert_one(item.to_mongo())
        inv_ids.append(item.id)

    for name, cat, price, img, direct, recipe in PRODUCTS:
        p = Product(id=await next_id("PRD"), name=name, category=cat, price=price, type="both", image=f"/images/{img}.jpg",
                    inventoryId=inv_ids[direct] if direct is not None else None)
        await db.products.insert_one(p.to_mongo())
        for idx, qty in recipe:
            await db.recipes.insert_one(Recipe(productId=p.id, inventoryId=inv_ids[idx], qty_needed=qty).to_mongo())
        await recalc_hpp(p.id)

    for name, area in TABLES:
        await db.tables.insert_one(Table(id=await next_id("TBL"), name=name, area=area).to_mongo())

    for name, wa, email in [("Pelanggan Contoh", "081200000001", "contoh@example.com")]:
        await db.customers.insert_one(Customer(id=await next_id("CUST"), name=name, wa=wa, email=email).to_mongo())


async def create_indexes():
    await db.recipes.create_index("productId")
    await db.recipes.create_index("inventoryId")
    await db.products.create_index("inventoryId")
    await db.transactions.create_index("date")
    await db.transactions.create_index("customerId")
    await db.transactions.create_index("tableId")
    await db.open_bills.create_index("tableId")
    await db.purchases.create_index("date")
    await db.expenses.create_index("date")


async def seed_all():
    await create_indexes()
    await seed_admin()
    await seed_demo()
