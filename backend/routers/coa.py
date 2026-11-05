from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from core import User, db, require_roles

AccountType = Literal["Asset", "Liability", "Equity", "Revenue", "Expense"]

ACCOUNT_CATEGORIES: dict[AccountType, str] = {
    "Asset": "Aset Lancar",
    "Liability": "Kewajiban",
    "Equity": "Ekuitas",
    "Revenue": "Pendapatan",
    "Expense": "Beban Operasional",
}
NORMAL_BALANCES: dict[AccountType, str] = {
    "Asset": "debit",
    "Liability": "credit",
    "Equity": "credit",
    "Revenue": "credit",
    "Expense": "debit",
}
COA_COLUMN_CANDIDATES = {
    "id": ("id", "account_id"),
    "account_code": ("account_code", "kode_akun", "code", "kode"),
    "account_name": ("account_name", "nama_akun", "name"),
    "account_category": ("account_category", "kategori_akun", "category"),
    "normal_balance": ("normal_balance", "saldo_normal"),
}

router = APIRouter(prefix="/api/chart-of-accounts", tags=["Chart of Accounts"])
ADMIN = require_roles("admin")


class AccountIn(BaseModel):
    account_code: str = Field(min_length=1, max_length=32)
    account_name: str = Field(min_length=1, max_length=160)
    account_type: AccountType

    @field_validator("account_code", "account_name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Nilai tidak boleh kosong.")
        return value


def account_type_from_category(category: str | None) -> AccountType | None:
    normalized = (category or "").strip().casefold()
    if normalized.startswith(("aset", "aktiva", "asset")):
        return "Asset"
    if normalized.startswith(("kewajiban", "liabilitas", "utang", "hutang", "liability")):
        return "Liability"
    if normalized.startswith(("ekuitas", "modal", "equity")):
        return "Equity"
    if normalized.startswith(("pendapatan", "revenue")):
        return "Revenue"
    if normalized.startswith(("beban", "biaya", "expense")):
        return "Expense"
    return None


def _row_value(row: asyncpg.Record, *names: str):
    keys = row.keys()
    for name in names:
        if name in keys and row[name] is not None:
            return row[name]
    return None


def serialize_account(row: asyncpg.Record) -> dict:
    category = _row_value(row, "account_category", "kategori_akun", "category")
    account_code = _row_value(row, "account_code", "kode_akun", "code", "kode")
    return {
        "id": str(_row_value(row, "id", "account_id") or account_code),
        "account_code": account_code,
        "account_name": _row_value(row, "account_name", "nama_akun", "name"),
        "account_category": category,
        "account_type": account_type_from_category(category),
        "normal_balance": _row_value(row, "normal_balance", "saldo_normal"),
        "current_balance": _row_value(row, "current_balance"),
    }


def _quoted(column: str) -> str:
    return f'"{column}"'


def _account_schema() -> tuple[dict[str, str], dict[str, str]]:
    columns = db.columns.get("chart_of_accounts", {})
    resolved = {}
    for logical_name, candidates in COA_COLUMN_CANDIDATES.items():
        resolved[logical_name] = next((name for name in candidates if name in columns), "")
    required = ("account_code", "account_name", "account_category")
    missing = [name for name in required if not resolved[name]]
    if missing:
        raise HTTPException(500, "Skema chart_of_accounts tidak memiliki kolom akun yang diperlukan.")
    if not resolved["id"]:
        resolved["id"] = resolved["account_code"]
    return resolved, columns


def _account_key_value(value: str, column: str, columns: dict[str, str]):
    column_type = columns.get(column)
    try:
        if column_type == "uuid":
            return UUID(value)
        if column_type in ("smallint", "integer", "bigint"):
            return int(value)
    except ValueError as error:
        raise HTTPException(422, "ID akun tidak valid.") from error
    return value


async def ensure_unique_code(
    account_code: str,
    account_id: str | None = None,
    resolved: dict[str, str] | None = None,
    columns: dict[str, str] | None = None,
) -> None:
    await db.connect()
    if resolved is None or columns is None:
        resolved, columns = _account_schema()
    code_column = _quoted(resolved["account_code"])
    key_column = _quoted(resolved["id"])
    query = f"select 1 from public.chart_of_accounts where {code_column} = $1"
    args = [account_code]
    if account_id is not None:
        query += f" and {key_column} <> $2"
        args.append(_account_key_value(account_id, resolved["id"], columns))
    exists = await db.pool.fetchval(f"{query} limit 1", *args)
    if exists:
        raise HTTPException(409, "Kode akun sudah digunakan.")


@router.get("")
async def list_accounts(_: User = Depends(ADMIN)):
    await db.connect()
    rows = await db.pool.fetch(
        """
        with account_master as (
          select
            coalesce(
              to_jsonb(account)->>'id',
              to_jsonb(account)->>'account_id',
              to_jsonb(account)->>'account_code',
              to_jsonb(account)->>'kode_akun'
            ) as id,
            coalesce(
              to_jsonb(account)->>'account_code',
              to_jsonb(account)->>'kode_akun',
              to_jsonb(account)->>'code',
              to_jsonb(account)->>'kode'
            ) as account_code,
            coalesce(
              to_jsonb(account)->>'account_name',
              to_jsonb(account)->>'nama_akun',
              to_jsonb(account)->>'name'
            ) as account_name,
            coalesce(
              to_jsonb(account)->>'account_category',
              to_jsonb(account)->>'kategori_akun',
              to_jsonb(account)->>'category'
            ) as account_category,
            coalesce(
              to_jsonb(account)->>'normal_balance',
              to_jsonb(account)->>'saldo_normal'
            ) as normal_balance
          from public.chart_of_accounts as account
        )
        select
          account_master.id,
          account_master.account_code,
          account_master.account_name,
          account_master.account_category,
          account_master.normal_balance,
          coalesce((
            select sum(
              case
                when lower(btrim(coalesce(account_master.normal_balance, '')))
                  in ('debit', 'debet', 'dr')
                  or (
                    lower(btrim(coalesce(account_master.normal_balance, '')))
                      not in ('credit', 'kredit', 'cr')
                    and (
                      lower(btrim(coalesce(account_master.account_category, ''))) like 'asset%'
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'aset%'
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'aktiva%'
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'expense%'
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'beban%'
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'biaya%'
                    )
                  )
                  then ledger.debit - ledger.credit
                else ledger.credit - ledger.debit
              end
            )
            from public.general_ledger as ledger
            where ledger.account_code = account_master.account_code
              or (
                ledger.account_code is null
                and ledger.account_name = account_master.account_name
              )
          ), 0) as current_balance
        from account_master
        order by account_master.account_code
        """
    )
    return [serialize_account(row) for row in rows]


@router.post("", status_code=201)
async def create_account(body: AccountIn, _: User = Depends(ADMIN)):
    await db.connect()
    resolved, _ = _account_schema()
    await ensure_unique_code(body.account_code, resolved=resolved, columns=db.columns["chart_of_accounts"])
    category = ACCOUNT_CATEGORIES[body.account_type]
    normal_balance = NORMAL_BALANCES[body.account_type]
    values = [
        (resolved["account_code"], body.account_code),
        (resolved["account_name"], body.account_name),
        (resolved["account_category"], category),
    ]
    if resolved["normal_balance"]:
        values.append((resolved["normal_balance"], normal_balance))
    column_sql = ", ".join(_quoted(column) for column, _ in values)
    value_sql = ", ".join(f"${index}" for index in range(1, len(values) + 1))
    try:
        row = await db.pool.fetchrow(
            f"insert into public.chart_of_accounts ({column_sql}) values ({value_sql}) returning *",
            *(value for _, value in values),
        )
    except asyncpg.UniqueViolationError as error:
        raise HTTPException(409, "Kode akun sudah digunakan.") from error
    return serialize_account(row)


@router.put("/{account_id}")
async def update_account(account_id: str, body: AccountIn, _: User = Depends(ADMIN)):
    await db.connect()
    resolved, columns = _account_schema()
    key_column = _quoted(resolved["id"])
    account_key = _account_key_value(account_id, resolved["id"], columns)
    await ensure_unique_code(body.account_code, account_id, resolved, columns)
    category = ACCOUNT_CATEGORIES[body.account_type]
    normal_balance = NORMAL_BALANCES[body.account_type]
    values = [
        (resolved["account_code"], body.account_code),
        (resolved["account_name"], body.account_name),
        (resolved["account_category"], category),
    ]
    if resolved["normal_balance"]:
        values.append((resolved["normal_balance"], normal_balance))
    assignments = ", ".join(
        f"{_quoted(column)} = ${index}"
        for index, (column, _) in enumerate(values, start=1)
    )
    args = [value for _, value in values]
    args.append(account_key)
    try:
        row = await db.pool.fetchrow(
            f"update public.chart_of_accounts set {assignments} where {key_column} = ${len(args)} returning *",
            *args,
        )
    except asyncpg.UniqueViolationError as error:
        raise HTTPException(409, "Kode akun sudah digunakan.") from error
    if row is None:
        raise HTTPException(404, "Akun tidak ditemukan.")
    return serialize_account(row)


@router.delete("/{account_id}")
async def delete_account(account_id: str, _: User = Depends(ADMIN)):
    await db.connect()
    resolved, columns = _account_schema()
    key_column = _quoted(resolved["id"])
    account_key = _account_key_value(account_id, resolved["id"], columns)
    try:
        result = await db.pool.execute(
            f"delete from public.chart_of_accounts where {key_column} = $1",
            account_key,
        )
    except asyncpg.IntegrityConstraintViolationError as error:
        raise HTTPException(
            400,
            "Akun tidak dapat dihapus karena sudah digunakan dalam transaksi",
        ) from error
    if result.split()[-1] == "0":
        raise HTTPException(404, "Akun tidak ditemukan.")
    return {"message": "Akun berhasil dihapus."}
