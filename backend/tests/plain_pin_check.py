import asyncio
import os
import sys

import asyncpg
import httpx
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")
from core import hash_pin  # noqa: E402

API = "http://localhost:8001/api"


async def main():
    c = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    await c.execute("insert into users(id,name,role,pin) values('USR-TEST-PLAIN','TEST_Plain','kasir','4321') on conflict (id) do update set pin='4321'")
    try:
        h = httpx.Client(base_url=API, timeout=30)
        print("USERS OK", h.get("/auth/users").status_code)
        r = h.post("/auth/login", json={"userId": "USR-TEST-PLAIN", "pin": "4321"})
        print("LOGIN PLAIN (belum di-hash, harus 401 tanpa crash)", r.status_code)
        await c.execute("update users set pin=$1 where id='USR-TEST-PLAIN'", hash_pin("4321"))
        r = h.post("/auth/login", json={"userId": "USR-TEST-PLAIN", "pin": "4321"})
        print("LOGIN HASHED", r.status_code)
    finally:
        await c.execute("delete from users where id='USR-TEST-PLAIN'")
        await c.close()
        print("CLEANED")

asyncio.run(main())
