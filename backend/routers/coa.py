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


def account_type_from_category(category: str) -> AccountType | None:
    normalized = category.strip().casefold()
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


def serialize_account(row: asyncpg.Record) -> dict:
    category = row["account_category"]
    return {
        "id": str(row["id"]),
        "account_code": row["account_code"],
        "account_name": row["account_name"],
        "account_category": category,
        "account_type": account_type_from_category(category),
        "normal_balance": row["normal_balance"],
        "current_balance": row["current_balance"],
    }


async def ensure_unique_code(account_code: str, account_id: UUID | None = None) -> None:
    await db.connect()
    if account_id is None:
        exists = await db.pool.fetchval(
            "select 1 from public.chart_of_accounts where account_code = $1 limit 1",
            account_code,
        )
    else:
        exists = await db.pool.fetchval(
            "select 1 from public.chart_of_accounts where account_code = $1 and id <> $2 limit 1",
            account_code,
            account_id,
        )
    if exists:
        raise HTTPException(409, "Kode akun sudah digunakan.")


@router.get("")
async def list_accounts(_: User = Depends(ADMIN)):
    await db.connect()
    rows = await db.pool.fetch(
        """
        select id, account_code, account_name, account_category, normal_balance, current_balance
        from public.chart_of_accounts
        order by account_code
        """
    )
    return [serialize_account(row) for row in rows]


@router.post("", status_code=201)
async def create_account(body: AccountIn, _: User = Depends(ADMIN)):
    await ensure_unique_code(body.account_code)
    category = ACCOUNT_CATEGORIES[body.account_type]
    normal_balance = NORMAL_BALANCES[body.account_type]
    try:
        row = await db.pool.fetchrow(
            """
            insert into public.chart_of_accounts
              (account_code, account_name, account_category, normal_balance)
            values ($1, $2, $3, $4)
            returning id, account_code, account_name, account_category, normal_balance, current_balance
            """,
            body.account_code,
            body.account_name,
            category,
            normal_balance,
        )
    except asyncpg.UniqueViolationError as error:
        raise HTTPException(409, "Kode akun sudah digunakan.") from error
    return serialize_account(row)


@router.put("/{account_id}")
async def update_account(account_id: UUID, body: AccountIn, _: User = Depends(ADMIN)):
    await db.connect()
    exists = await db.pool.fetchval(
        "select 1 from public.chart_of_accounts where id = $1",
        account_id,
    )
    if not exists:
        raise HTTPException(404, "Akun tidak ditemukan.")
    await ensure_unique_code(body.account_code, account_id)
    category = ACCOUNT_CATEGORIES[body.account_type]
    normal_balance = NORMAL_BALANCES[body.account_type]
    try:
        row = await db.pool.fetchrow(
            """
            update public.chart_of_accounts
            set account_code = $1,
                account_name = $2,
                account_category = $3,
                normal_balance = $4
            where id = $5
            returning id, account_code, account_name, account_category, normal_balance, current_balance
            """,
            body.account_code,
            body.account_name,
            category,
            normal_balance,
            account_id,
        )
    except asyncpg.UniqueViolationError as error:
        raise HTTPException(409, "Kode akun sudah digunakan.") from error
    if row is None:
        raise HTTPException(404, "Akun tidak ditemukan.")
    return serialize_account(row)


@router.delete("/{account_id}")
async def delete_account(account_id: UUID, _: object = Depends(ADMIN)):
    await db.connect()
    try:
        result = await db.pool.execute(
            "delete from public.chart_of_accounts where id = $1",
            account_id,
        )
    except asyncpg.IntegrityConstraintViolationError as error:
        raise HTTPException(
            400,
            "Akun tidak dapat dihapus karena sudah digunakan dalam transaksi",
        ) from error
    if result.split()[-1] == "0":
        raise HTTPException(404, "Akun tidak ditemukan.")
    return {"message": "Akun berhasil dihapus."}
