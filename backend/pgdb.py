import json
from datetime import datetime
from decimal import Decimal

import asyncpg
from fastapi import HTTPException

PK = {"login_attempts": "identifier"}
NO_PK = {"recipes"}
OPS = {"$gte": ">=", "$gt": ">", "$lte": "<=", "$lt": "<"}


def q(name: str) -> str:
    return '"' + name + '"'


class Result:
    def __init__(self, n: int):
        self.modified_count = self.matched_count = self.deleted_count = n


def _db_error(e: Exception):
    msg = getattr(e, "message", None) or str(e)
    raise HTTPException(400, msg)


class Cursor:
    def __init__(self, coll, flt):
        self.c, self.flt, self.order = coll, flt or {}, []

    def sort(self, key, direction=1):
        items = key if isinstance(key, list) else [(key, direction)]
        self.order += [(self.c.col(k), d) for k, d in items]
        return self

    async def to_list(self, length=None):
        await self.c.db.connect()
        args = []
        sql = f"select * from {self.c.table} where {self.c.where(self.flt, args)}"
        if self.order:
            sql += " order by " + ", ".join(f"{q(k)} {'desc' if d < 0 else 'asc'}" for k, d in self.order)
        if length:
            sql += f" limit {int(length)}"
        return [self.c.decode(r) for r in await self.c.db.pool.fetch(sql, *args)]

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in await self.to_list(None):
            yield d


class Collection:
    """Mongo-style API over a real Postgres table (Supabase)."""

    def __init__(self, db, name):
        self.db, self.name = db, name

    @property
    def cols(self) -> dict:
        return self.db.columns[self.name]

    @property
    def pk(self):
        return None if self.name in NO_PK else PK.get(self.name, "id")

    def col(self, key):
        return self.pk if key == "_id" else key

    @property
    def table(self):
        return f"public.{q(self.name)}"

    def enc(self, col, v):
        t = self.cols.get(col)
        if v is None:
            return None
        if t == "timestamp with time zone" and isinstance(v, str):
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        if t in ("integer", "bigint") and isinstance(v, (float, Decimal)):
            return int(round(v))
        if t == "numeric" and isinstance(v, float):
            return Decimal(repr(v))
        return v

    def decode(self, row) -> dict:
        out = {}
        for k, v in row.items():
            if isinstance(v, datetime):
                v = v.isoformat()
            elif isinstance(v, Decimal):
                v = float(v)
            out["_id" if k == self.pk else k] = v
        return out

    def where(self, flt, args) -> str:
        parts = []
        for k, v in (flt or {}).items():
            if k == "$or":
                parts.append("(" + " or ".join(f"({self.where(f, args)})" for f in v) + ")")
                continue
            col = self.col(k)
            if isinstance(v, dict):
                for op, val in v.items():
                    if op == "$in":
                        args.append([self.enc(col, x) for x in val])
                        parts.append(f"{q(col)} = any(${len(args)})")
                    elif op == "$ne":
                        if val is None:
                            parts.append(f"{q(col)} is not null")
                        else:
                            args.append(self.enc(col, val))
                            parts.append(f"({q(col)} is null or {q(col)} <> ${len(args)})")
                    else:
                        args.append(self.enc(col, val))
                        parts.append(f"{q(col)} {OPS[op]} ${len(args)}")
            elif v is None:
                parts.append(f"{q(col)} is null")
            else:
                args.append(self.enc(col, v))
                parts.append(f"{q(col)} = ${len(args)}")
        return " and ".join(parts) or "true"

    def _check(self, col):
        if col not in self.cols:
            raise ValueError(f"Kolom {col} tidak ada di tabel {self.name}")

    def find(self, flt=None, projection=None):
        return Cursor(self, flt)

    async def find_one(self, flt=None, projection=None):
        rows = await Cursor(self, flt).to_list(1)
        return rows[0] if rows else None

    async def count_documents(self, flt=None):
        await self.db.connect()
        args = []
        return await self.db.pool.fetchval(f"select count(*) from {self.table} where {self.where(flt, args)}", *args)

    async def distinct(self, field, flt=None):
        await self.db.connect()
        args = []
        col = self.col(field)
        rows = await self.db.pool.fetch(f"select distinct {q(col)} as v from {self.table} where {self.where(flt, args)}", *args)
        return [r["v"] for r in rows]

    async def insert_one(self, doc, connection=None):
        await self.db.connect()
        cols, args = [], []
        for k, v in doc.items():
            col = self.col(k)
            if col is None:
                continue
            self._check(col)
            cols.append(col)
            args.append(self.enc(col, v))
        sql = f"insert into {self.table} ({', '.join(q(c) for c in cols)}) values ({', '.join(f'${i + 1}' for i in range(len(cols)))})"
        executor = connection if connection is not None else self.db.pool
        try:
            inserted = await executor.fetchval(f"{sql} returning 1", *args)
        except (asyncpg.RaiseError, asyncpg.CheckViolationError) as e:
            _db_error(e)
        if inserted != 1:
            raise RuntimeError(f"INSERT ke public.{self.name} tidak menghasilkan baris")
        return Result(1)

    async def insert_many(self, docs, connection=None):
        for d in docs:
            await self.insert_one(d, connection=connection)
        return Result(len(docs))

    async def update_one(self, flt, update, upsert=False, connection=None):
        await self.db.connect()
        sets, args = [], []
        for k, v in update.get("$set", {}).items():
            col = self.col(k)
            self._check(col)
            args.append(self.enc(col, v))
            sets.append(f"{q(col)} = ${len(args)}")
        for k, v in update.get("$inc", {}).items():
            col = self.col(k)
            self._check(col)
            args.append(self.enc(col, v))
            sets.append(f"{q(col)} = coalesce({q(col)}, 0) + ${len(args)}")
        if sets:
            sql = f"update {self.table} set {', '.join(sets)} where {self.where(flt, args)}"
            try:
                executor = connection if connection is not None else self.db.pool
                n = int((await executor.execute(sql, *args)).split()[-1])
            except (asyncpg.RaiseError, asyncpg.CheckViolationError) as e:
                _db_error(e)
        else:
            n = await self.count_documents(flt)
        if n == 0 and upsert:
            doc = {k: v for k, v in flt.items() if not k.startswith("$") and not isinstance(v, dict)}
            for key in ("$set", "$inc", "$setOnInsert"):
                doc.update(update.get(key, {}))
            await self.insert_one(doc, connection=connection)
        return Result(n)

    async def replace_one(self, flt, doc):
        return await self.update_one(flt, {"$set": {k: v for k, v in doc.items() if k != "_id"}})

    async def find_one_and_update(self, flt, update, upsert=False, return_document=None):
        await self.db.connect()
        seq = await self.db.pool.fetchval(
            "insert into public.counters (id, seq) values ($1, 1) on conflict (id) do update set seq = counters.seq + 1 returning seq",
            flt["_id"],
        )
        return {"_id": flt["_id"], "seq": seq}

    async def delete_one(self, flt):
        await self.db.connect()
        args = []
        sql = f"delete from {self.table} where ctid in (select ctid from {self.table} where {self.where(flt, args)} limit 1)"
        return Result(int((await self.db.pool.execute(sql, *args)).split()[-1]))

    async def delete_many(self, flt):
        await self.db.connect()
        args = []
        return Result(int((await self.db.pool.execute(f"delete from {self.table} where {self.where(flt, args)}", *args)).split()[-1]))

    async def create_index(self, *args, **kwargs):
        return None


class PGDatabase:
    def __init__(self, dsn: str):
        self.dsn, self.pool, self.columns, self.colls = dsn, None, {}, {}

    async def connect(self):
        if self.pool:
            return

        async def init(conn):
            await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")

        self.pool = await asyncpg.create_pool(self.dsn, min_size=1, max_size=10, statement_cache_size=0, init=init)
        rows = await self.pool.fetch("select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'")
        for r in rows:
            self.columns.setdefault(r["table_name"], {})[r["column_name"]] = r["data_type"]

    async def next_customer_seq(self) -> int:
        await self.connect()
        return await self.pool.fetchval(
            """
            insert into public.counters (id, seq)
            select 'CUST', coalesce(max(substring(id from '^CUST-([0-9]+)$')::bigint), 0) + 1
            from public.customers
            where id ~ '^CUST-[0-9]+$'
            on conflict (id) do update
            set seq = greatest(counters.seq + 1, excluded.seq)
            returning seq
            """
        )

    async def close(self):
        if self.pool:
            await self.pool.close()

    def __getitem__(self, name):
        return self.colls.setdefault(name, Collection(self, name))

    def __getattr__(self, name):
        if name.startswith("_") or name in ("dsn", "pool", "columns", "colls"):
            raise AttributeError(name)
        return self[name]
