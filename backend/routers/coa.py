from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator

from core import User, db, require_roles
from finance import canonical_account_category

AccountType = Literal["Asset", "Liability", "Equity", "Revenue", "Expense"]

# Tabel public.general_ledger punya DUA pasangan kolom nominal:
#   - debit / credit            (warisan, NOT NULL DEFAULT 0, ditulis backend lama)
#   - debit_amount / credit_amount (nullable, ditulis trigger POS & view DB)
# Sebagian besar baris hanya terisi di salah satu pasangan, sehingga query yang
# hanya membaca satu pasangan akan menghasilkan 0. Ekspresi di bawah menyatukan
# keduanya: pakai *_amount bila bernilai, jika tidak jatuh ke kolom warisan.
LEDGER_DEBIT_SQL = "coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0)"
LEDGER_CREDIT_SQL = "coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0)"

ACCOUNT_CATEGORIES: dict[AccountType, str] = {
    "Asset": "Aset Lancar",
    "Liability": "Kewajiban",
    "Equity": "Ekuitas",
    "Revenue": "Pendapatan",
    "Expense": "Beban Operasional",
}
LEGACY_CATEGORY_TYPES: dict[str, AccountType] = {
    "asset": "Asset",
    "liability": "Liability",
    "equity": "Equity",
    "revenue": "Revenue",
    "cost_of_goods_sold": "Expense",
    "operating_expense": "Expense",
    "beban pokok pendapatan": "Expense",
    "beban operasional": "Expense",
    "bahan penunjang": "Expense",
    "expense": "Expense",
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
    account_category: str | None = Field(
        default=None,
        min_length=1,
        max_length=80,
        validation_alias=AliasChoices("account_category", "accountCategory"),
    )
    account_type: AccountType | None = None

    @model_validator(mode="after")
    def require_account_category(self):
        if self.account_category is None and self.account_type is None:
            raise ValueError("Jenis akun wajib dipilih.")
        if self.account_category is None:
            self.account_category = ACCOUNT_CATEGORIES[self.account_type]
        else:
            self.account_category = self.account_category.strip()
            if not self.account_category:
                raise ValueError("Jenis akun wajib dipilih.")
        return self

    @field_validator("account_code", "account_name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Nilai tidak boleh kosong.")
        return value


def account_type_from_category(
    category: str | None,
    account_code: str | None = None,
) -> AccountType | None:
    normalized = (category or "").strip().casefold()
    legacy_type = LEGACY_CATEGORY_TYPES.get(normalized)
    if legacy_type is not None and normalized != "balance_sheet":
        return legacy_type
    if normalized == "balance_sheet":
        code_prefix = (account_code or "").strip()[:1]
        return {
            "1": "Asset",
            "2": "Liability",
            "3": "Equity",
            "4": "Revenue",
            "5": "Expense",
            "6": "Expense",
            "8": "Expense",
        }.get(code_prefix)
    if normalized.startswith(("kas", "cash", "bank")):
        return "Asset"
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
    return {
        "1": "Asset",
        "2": "Liability",
        "3": "Equity",
        "4": "Revenue",
        "5": "Expense",
        "6": "Expense",
        "8": "Expense",
    }.get((account_code or "").strip()[:1])


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
        # Nilai baku berbahasa Indonesia dipakai untuk seluruh tampilan & filter.
        # Nilai mentah tetap dikirim agar data warisan masih bisa ditelusuri.
        "account_category": canonical_account_category(category, account_code),
        "account_category_raw": category,
        "account_type": account_type_from_category(category, account_code),
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
async def list_accounts(
    start_date: date | None = None,
    end_date: date | None = None,
    _: User = Depends(ADMIN),
):
    if start_date and end_date and end_date < start_date:
        raise HTTPException(422, "Tanggal selesai tidak boleh sebelum tanggal mulai.")
    await db.connect()
    rows = await db.pool.fetch(
        f"""
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
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'kas%'
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'cash%'
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'expense%'
                      or lower(btrim(coalesce(account_master.account_category, '')))
                        in ('asset', 'cost_of_goods_sold', 'operating_expense')
                      or (
                        lower(btrim(coalesce(account_master.account_category, ''))) = 'balance_sheet'
                                                and left(account_master.account_code, 1) in ('1', '5', '6', '8')
                      )
                                            or left(account_master.account_code, 1) in ('1', '5', '6', '8')
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'beban%'
                      or lower(btrim(coalesce(account_master.account_category, ''))) like 'biaya%'
                    )
                  )
                                    then {LEDGER_DEBIT_SQL} - {LEDGER_CREDIT_SQL}
                                else {LEDGER_CREDIT_SQL} - {LEDGER_DEBIT_SQL}
              end
            )
            from public.general_ledger as ledger
                        where (
                                ledger.account_code = account_master.account_code
                                or (
                                    ledger.account_code is null
                                    and ledger.account_name = account_master.account_name
                                )
                            )
                            and ($1::date is null or ledger.transaction_date >= $1)
                            and ($2::date is null or ledger.transaction_date <= $2)
          ), 0) as current_balance
        from account_master
        order by account_master.account_code
                """,
                start_date,
                end_date,
        )
    return [serialize_account(row) for row in rows]


DEBIT_NORMAL_CATEGORY_PREFIXES = (
    "asset", "aset", "aktiva", "kas", "cash", "expense", "beban", "biaya", "bahan penunjang",
)
DEBIT_NORMAL_CATEGORIES = ("asset", "cost_of_goods_sold", "operating_expense")


def normal_balance_side(account: dict) -> str:
    """Tentukan sisi saldo normal akun (debit/credit) mengikuti aturan list_accounts."""
    normal_balance = str(account.get("normal_balance") or "").strip().lower()
    if normal_balance in ("debit", "debet", "dr"):
        return "debit"
    if normal_balance in ("credit", "kredit", "cr"):
        return "credit"
    category = str(account.get("account_category") or "").strip().lower()
    if category.startswith(DEBIT_NORMAL_CATEGORY_PREFIXES):
        return "debit"
    if category in DEBIT_NORMAL_CATEGORIES:
        return "debit"
    code_prefix = str(account.get("account_code") or "").strip()[:1]
    if code_prefix in ("1", "5", "6", "8"):
        return "debit"
    return "credit"


@router.get("/{account_code}/transactions")
async def list_account_transactions(
    account_code: str,
    start_date: date | None = None,
    end_date: date | None = None,
    _: User = Depends(ADMIN),
):
    if start_date and end_date and end_date < start_date:
        raise HTTPException(422, "Tanggal selesai tidak boleh sebelum tanggal mulai.")
    code = (account_code or "").strip()
    if not code:
        raise HTTPException(422, "Kode akun wajib diisi.")
    await db.connect()
    account_row = await db.pool.fetchrow(
        """
        select
          coalesce(
            nullif(btrim(to_jsonb(account)->>'account_code'), ''),
            nullif(btrim(to_jsonb(account)->>'kode_akun'), ''),
            nullif(btrim(to_jsonb(account)->>'code'), ''),
            nullif(btrim(to_jsonb(account)->>'kode'), '')
          ) as account_code,
          coalesce(
            nullif(btrim(to_jsonb(account)->>'account_name'), ''),
            nullif(btrim(to_jsonb(account)->>'nama_akun'), ''),
            nullif(btrim(to_jsonb(account)->>'name'), '')
          ) as account_name,
          coalesce(
            nullif(btrim(to_jsonb(account)->>'account_category'), ''),
            nullif(btrim(to_jsonb(account)->>'kategori_akun'), ''),
            nullif(btrim(to_jsonb(account)->>'category'), '')
          ) as account_category,
          coalesce(
            nullif(btrim(to_jsonb(account)->>'normal_balance'), ''),
            nullif(btrim(to_jsonb(account)->>'saldo_normal'), '')
          ) as normal_balance
        from public.chart_of_accounts as account
        where coalesce(
                nullif(btrim(to_jsonb(account)->>'account_code'), ''),
                nullif(btrim(to_jsonb(account)->>'kode_akun'), ''),
                nullif(btrim(to_jsonb(account)->>'code'), ''),
                nullif(btrim(to_jsonb(account)->>'kode'), '')
              ) = $1
        limit 1
        """,
        code,
    )
    if account_row is None:
        raise HTTPException(404, f"Akun dengan kode {code} tidak ditemukan.")

    account = dict(account_row)
    rows = await db.pool.fetch(
                f"""
        select
          ledger.id,
          ledger.entry_id,
          ledger.transaction_date,
          ledger.entry_date,
          ledger.description,
                    ledger.reference_number,
          ledger.account_code,
          ledger.account_name,
          ledger.account_type,
                    {LEDGER_DEBIT_SQL} as debit,
                    {LEDGER_CREDIT_SQL} as credit,
          ledger.source_type,
          ledger.source_id
        from public.general_ledger as ledger
        where (
            ledger.account_code = $1
            or (ledger.account_code is null and ledger.account_name = $2)
          )
          and ($3::date is null or ledger.transaction_date >= $3)
          and ($4::date is null or ledger.transaction_date <= $4)
        order by ledger.transaction_date desc, ledger.id desc
        """,
        account["account_code"],
        account["account_name"],
        start_date,
        end_date,
    )

    side = normal_balance_side(account)
    transactions = []
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    running_balance = Decimal("0")
    ordered_rows = sorted(
        rows,
        key=lambda row: (
            (row["transaction_date"] or row["entry_date"]) or date.min,
            row["id"],
        ),
    )
    for row in ordered_rows:
        item = dict(row)
        debit = Decimal(str(item.get("debit") or 0))
        credit = Decimal(str(item.get("credit") or 0))
        total_debit += debit
        total_credit += credit
        running_balance += (debit - credit) if side == "debit" else (credit - debit)
        item["debit"] = debit
        item["credit"] = credit
        item["balance"] = running_balance
        item["transaction_date"] = item["transaction_date"] or item["entry_date"]
        transactions.append(item)
    transactions.reverse()

    try:
        closing_balance = (total_debit - total_credit) if side == "debit" else (total_credit - total_debit)
        if not closing_balance.is_finite():
            raise InvalidOperation
    except InvalidOperation as error:  # pragma: no cover - pengaman nilai non-numerik
        raise ValueError("Saldo akun tidak valid.") from error

    return {
        "account": {
            **account,
            "account_type": account_type_from_category(account["account_category"], account["account_code"]),
            "normal_balance_side": side,
        },
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_debit": total_debit,
            "total_credit": total_credit,
            "closing_balance": closing_balance,
            "transaction_count": len(transactions),
        },
        "transactions": transactions,
    }


@router.post("", status_code=201)
async def create_account(body: AccountIn, _: User = Depends(ADMIN)):
    await db.connect()
    resolved, _ = _account_schema()
    await ensure_unique_code(body.account_code, resolved=resolved, columns=db.columns["chart_of_accounts"])
    account_type = account_type_from_category(body.account_category, body.account_code)
    if account_type is None:
        raise HTTPException(422, "Jenis akun tidak didukung.")
    normal_balance = NORMAL_BALANCES[account_type]
    account_category = canonical_account_category(body.account_category, body.account_code)
    values = [
        (resolved["account_code"], body.account_code),
        (resolved["account_name"], body.account_name),
        (resolved["account_category"], account_category),
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
    account_type = account_type_from_category(body.account_category, body.account_code)
    if account_type is None:
        raise HTTPException(422, "Jenis akun tidak didukung.")
    normal_balance = NORMAL_BALANCES[account_type]
    account_category = canonical_account_category(body.account_category, body.account_code)
    values = [
        (resolved["account_code"], body.account_code),
        (resolved["account_name"], body.account_name),
        (resolved["account_category"], account_category),
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
