import logging
import math
import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional, Sequence
from uuid import uuid4

import asyncpg

# Struktur data untuk baris jurnal umum
JournalLine = tuple[str, str, Decimal, Decimal]
logger = logging.getLogger(__name__)

ACCOUNT_PERSEDIAAN_BAHAN_ID = "1-10003"
ACCOUNT_BEBAN_SELISIH_STOK_ID = "5-51099"
ACCOUNT_BEBAN_OPERASIONAL_ID = "6-60000"
ACCOUNT_HPP_ID = "5-50000"
ACCOUNT_KAS_TUNAI_ID = "1-10001"

# Akun biaya penunjang produksi (air galon, bumbu, es kristal, tissu, cup, dll.)
# dipindahkan dari seri 5- ke seri 8-. Semua kode berawalan "8-" adalah rincian
# Harga Pokok Penjualan (HPP) dan ditampilkan sebagai anak dari
# "Beban Pokok Pendapatan", bukan sebagai beban operasional.
ACCOUNT_HPP_DETAIL_PREFIX = "8-"
ACCOUNT_HPP_DETAIL_CATEGORY = "Bahan Penunjang"


def is_hpp_detail_account_code(account_code: Optional[str]) -> bool:
    """True bila kode akun termasuk kelompok biaya penunjang HPP (seri 8-)."""
    return str(account_code or "").strip().startswith(ACCOUNT_HPP_DETAIL_PREFIX)

KATEGORI_PENGELUARAN_FALLBACK = {
    "pembelian bahan baku": ACCOUNT_PERSEDIAAN_BAHAN_ID,
    "biaya operasional": ACCOUNT_BEBAN_OPERASIONAL_ID,
    "biaya angkut/pengiriman": ACCOUNT_HPP_ID,
    "uang makan": "6-60153",
    "belanja bahan baku": ACCOUNT_HPP_ID,
    "operasional harian": "6-60203",
    # Biaya penunjang produksi (HPP) — seri 8-
    "air galon": "8-51001",
    "creamer/fullcream": "8-51002",
    "es kristal": "8-51004",
    "bumbu/sayur": "8-51005",
    "tissu": "8-51006",
    "cup/sealer/pipet/tutup": "8-51007",
}


async def get_account_balances(pool: Any) -> list[dict[str, Any]]:
    raw_rows = None
    try:
        raw_rows = await pool.fetch(
            """
            select
              coalesce(
                nullif(btrim(to_jsonb(account)->>'kode_akun'), ''),
                nullif(btrim(to_jsonb(account)->>'account_code'), '')
              ) as kode_akun,
              coalesce(
                nullif(btrim(to_jsonb(account)->>'nama_akun'), ''),
                nullif(btrim(to_jsonb(account)->>'account_name'), '')
              ) as nama_akun,
              coalesce(
                nullif(btrim(to_jsonb(account)->>'kategori_akun'), ''),
                nullif(btrim(to_jsonb(account)->>'account_category'), '')
              ) as kategori_akun,
              to_jsonb(account)->>'current_balance' as current_balance
            from public.chart_of_accounts as account
            order by kode_akun
            """
        )
        logger.debug("Raw chart_of_accounts balance response: %r", [dict(row) for row in raw_rows])

        accounts = []
        seen_codes = set()
        for row in raw_rows:
            account = dict(row)
            code = str(account.get("kode_akun") or "").strip()
            name = str(account.get("nama_akun") or "").strip()
            category = str(account.get("kategori_akun") or "").strip()
            if not code or not name or not category:
                raise ValueError("Chart of Accounts berisi kode, nama, atau kategori akun kosong.")
            if code in seen_codes:
                raise ValueError(f"Chart of Accounts berisi kode akun duplikat: {code}.")
            seen_codes.add(code)

            try:
                balance = Decimal(str(account["current_balance"]))
            except (InvalidOperation, KeyError, TypeError, ValueError) as error:
                raise ValueError(f"Saldo current_balance akun {code} bukan nilai numerik yang valid.") from error
            if not balance.is_finite():
                raise ValueError(f"Saldo current_balance akun {code} bukan nilai numerik yang valid.")

            accounts.append({
                "kode_akun": code,
                "nama_akun": name,
                "kategori_akun": category,
                "current_balance": balance,
                "saldo_terupdate": balance,
            })
        return accounts
    except Exception:
        logger.exception(
            "Gagal mengambil atau mengonversi saldo chart_of_accounts; raw_response=%r",
            [dict(row) for row in raw_rows] if raw_rows is not None else None,
        )
        raise


def account_type_from_category(
    account_category: Optional[str],
    account_code: Optional[str] = None,
) -> Optional[str]:
    category = (account_category or "").strip().casefold()
    canonical_types = {
        "asset": "asset",
        "assets": "asset",
        "aset": "asset",
        "aktiva": "asset",
        "kas": "asset",
        "cash": "asset",
        "kas & bank": "asset",
        "kas dan bank": "asset",
        "cash & bank": "asset",
        "cash and bank": "asset",
        "liability": "liability",
        "liabilities": "liability",
        "liabilitas": "liability",
        "kewajiban": "liability",
        "utang": "liability",
        "hutang": "liability",
        "equity": "equity",
        "ekuitas": "equity",
        "modal": "equity",
        "revenue": "revenue",
        "pendapatan": "revenue",
        "income": "revenue",
        "cost_of_goods_sold": "expense",
        "operating_expense": "expense",
        "expense": "expense",
        "expenses": "expense",
        "beban": "expense",
        "biaya": "expense",
        "bahan penunjang": "expense",
    }
    if category in canonical_types:
        return canonical_types[category]
    if category == "balance_sheet":
        return {
            "1": "asset",
            "2": "liability",
            "3": "equity",
            "4": "revenue",
            "5": "expense",
            "6": "expense",
            "8": "expense",
        }.get((account_code or "").strip()[:1])

    category_prefixes = (
        (("kas", "cash", "bank"), "asset"),
        (("asset", "assets", "aset", "aktiva"), "asset"),
        (("liabilit", "kewajiban", "utang", "hutang"), "liability"),
        (("equity", "ekuitas", "modal"), "equity"),
        (("revenue", "pendapatan", "income"), "revenue"),
        (("expense", "beban", "biaya"), "expense"),
    )
    for prefixes, account_type in category_prefixes:
        if category.startswith(prefixes):
            return account_type
    return {
        "1": "asset",
        "2": "liability",
        "3": "equity",
        "4": "revenue",
        "5": "expense",
        "6": "expense",
        "8": "expense",
    }.get((account_code or "").strip()[:1])


def is_cash_bank_account(
    account_category: Optional[str],
    account_code: Optional[str],
    account_name: Optional[str],
) -> bool:
    category = (account_category or "").strip().casefold()
    if re.search(r"kas|cash|bank", category):
        return True
    return bool(
        (account_code or "").strip().startswith("1-")
        and re.search(r"kas|bank|cash|qris|rekening", account_name or "", re.IGNORECASE)
    )


async def get_cash_bank_accounts(connection: Any, account_code: Optional[str] = None) -> list[dict[str, Any]]:
    rows = await connection.fetch(
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
          ) as account_category
        from public.chart_of_accounts as account
        where ($1::text is null or coalesce(
          nullif(btrim(to_jsonb(account)->>'account_code'), ''),
          nullif(btrim(to_jsonb(account)->>'kode_akun'), ''),
          nullif(btrim(to_jsonb(account)->>'code'), ''),
          nullif(btrim(to_jsonb(account)->>'kode'), '')
        ) = $1)
        order by account_code
        """,
        account_code,
    )
    return [
        {
            "account_code": row["account_code"],
            "account_name": row["account_name"],
            "account_category": row["account_category"],
        }
        for row in rows
        if is_cash_bank_account(
            row["account_category"],
            row["account_code"],
            row["account_name"],
        )
    ]


async def get_cash_bank_balances(connection: Any) -> list[dict[str, Any]]:
    rows = await connection.fetch(
        """
        select
          coalesce(account.account_code, ledger.account_code) as account_code,
          ledger.account_name as sumber_dana,
                    sum(
                        coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0)
                        - coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0)
                    ) as saldo_berjalan
        from public.general_ledger as ledger
        left join lateral (
          select
            coalesce(
              nullif(btrim(to_jsonb(account_row)->>'account_code'), ''),
              nullif(btrim(to_jsonb(account_row)->>'kode_akun'), ''),
              nullif(btrim(to_jsonb(account_row)->>'code'), ''),
              nullif(btrim(to_jsonb(account_row)->>'kode'), '')
            ) as account_code,
            coalesce(
              nullif(btrim(to_jsonb(account_row)->>'account_category'), ''),
              nullif(btrim(to_jsonb(account_row)->>'kategori_akun'), ''),
              nullif(btrim(to_jsonb(account_row)->>'category'), '')
            ) as account_category
          from public.chart_of_accounts as account_row
          where coalesce(
                  nullif(btrim(to_jsonb(account_row)->>'account_code'), ''),
                  nullif(btrim(to_jsonb(account_row)->>'kode_akun'), ''),
                  nullif(btrim(to_jsonb(account_row)->>'code'), ''),
                  nullif(btrim(to_jsonb(account_row)->>'kode'), '')
                ) = ledger.account_code
             or coalesce(
                  nullif(btrim(to_jsonb(account_row)->>'account_name'), ''),
                  nullif(btrim(to_jsonb(account_row)->>'nama_akun'), ''),
                  nullif(btrim(to_jsonb(account_row)->>'name'), '')
                ) = ledger.account_name
          order by case
            when coalesce(
              nullif(btrim(to_jsonb(account_row)->>'account_code'), ''),
              nullif(btrim(to_jsonb(account_row)->>'kode_akun'), ''),
              nullif(btrim(to_jsonb(account_row)->>'code'), ''),
              nullif(btrim(to_jsonb(account_row)->>'kode'), '')
            ) = ledger.account_code then 0 else 1 end
          limit 1
        ) as account on true
        where nullif(btrim(ledger.account_name), '') is not null
          and (
            lower(coalesce(account.account_category, '')) like '%kas%'
            or lower(coalesce(account.account_category, '')) like '%cash%'
            or lower(coalesce(account.account_category, '')) like '%bank%'
            or (
                            (
                                coalesce(account.account_code, ledger.account_code) like '1-%'
                                or ledger.account_code is null
                            )
              and lower(ledger.account_name) ~ '(kas|bank|cash|qris|rekening)'
            )
          )
        group by coalesce(account.account_code, ledger.account_code), ledger.account_name
        order by coalesce(account.account_code, ledger.account_code), ledger.account_name
        """
    )
    return [dict(row) for row in rows]


def _normal_balance_side(account: dict, account_type: Optional[str]) -> str:
    normal_balance = str(account.get("normal_balance") or "").strip().lower()
    if normal_balance in {"debit", "debet", "dr"}:
        return "debit"
    if normal_balance in {"credit", "kredit", "cr"}:
        return "credit"
    return "debit" if account_type in {"asset", "expense"} else "credit"


async def get_chart_of_accounts(
    pool: Any,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> list[dict]:
    accounts = await pool.fetch(
        """
        select
          coalesce(
            nullif(to_jsonb(account)->>'account_code', ''),
            nullif(to_jsonb(account)->>'kode_akun', ''),
            nullif(to_jsonb(account)->>'code', ''),
            nullif(to_jsonb(account)->>'kode', ''),
            ''
          ) as account_code,
          coalesce(
            nullif(to_jsonb(account)->>'normal_balance', ''),
            nullif(to_jsonb(account)->>'normal_side', ''),
            nullif(to_jsonb(account)->>'saldo_normal', ''),
            ''
          ) as normal_balance,
          account_name,
          account_category
        from public.chart_of_accounts as account
        where nullif(btrim(account_name), '') is not null
        order by account_code, account_name, account_category
        """
    )
    ledger_rows = await pool.fetch(
        """
        select
          account_code,
          account_name,
          account_type,
                    sum(coalesce(nullif(debit_amount, 0), debit, 0)) as total_debit,
                    sum(coalesce(nullif(credit_amount, 0), credit, 0)) as total_credit,
          count(*) as mutation_count
        from public.general_ledger
        where ($1::date is null or transaction_date >= $1)
          and ($2::date is null or transaction_date <= $2)
        group by account_code, account_name, account_type
        """,
        start_date,
        end_date,
    )
    balances_by_code: dict[tuple[str, str], dict[str, Any]] = {}
    balances_by_name: dict[tuple[str, str], dict[str, Any]] = {}
    for row in ledger_rows:
        balances = balances_by_code if row["account_code"] else balances_by_name
        key = (
            (row["account_code"], row["account_type"])
            if row["account_code"]
            else (row["account_name"], row["account_type"])
        )
        if key not in balances:
            balances[key] = {
                "debit": row["total_debit"],
                "credit": row["total_credit"],
                "mutation_count": row["mutation_count"],
            }
        else:
            balances[key]["debit"] += row["total_debit"]
            balances[key]["credit"] += row["total_credit"]
            balances[key]["mutation_count"] += row["mutation_count"]

    result = []
    for account_row in accounts:
        account = dict(account_row)
        account_type = account_type_from_category(account["account_category"], account["account_code"])
        mutation = balances_by_code.get((account["account_code"], account_type))
        if mutation is None:
            mutation = balances_by_name.get((account["account_name"], account_type))
        normal_balance = _normal_balance_side(account, account_type)
        debit = mutation["debit"] if mutation else 0
        credit = mutation["credit"] if mutation else 0
        account.update({
            "account_type": account_type,
            "balance": debit - credit if normal_balance == "debit" else credit - debit,
            "has_mutations": bool(mutation and mutation["mutation_count"]),
        })
        result.append(account)
    return sorted(result, key=lambda account: (account["account_code"], account["account_name"]))


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def get_profit_and_loss_report(
    pool: Any,
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    rows = await pool.fetch(
        """
        with report_rows as (
          select account_code, account_name, account_category, account_type, balance
          from (
            select
              account_code,
              account_name,
              account_category,
              case
                when lower(account_category) = 'cost_of_goods_sold'
                  or lower(account_category) like 'beban pokok%'
                  then 'cost_of_goods_sold'
                when account_code = '5-51099'
                  or lower(account_category) = 'operating_expense'
                  or lower(account_category) like 'beban operasional%'
                  then 'operating_expense'
                                when coalesce(account_code, '') like '8-%'
                                    or lower(account_category) like 'bahan penunjang%'
                                    then 'cost_of_goods_sold'
                when lower(account_category) in ('revenue', 'income')
                  or lower(account_category) like 'pendapatan%'
                  then 'revenue'
                when coalesce(account_code, '') like '5-%'
                  then 'cost_of_goods_sold'
                when lower(account_name) like '%beban pokok%'
                  or lower(account_name) like '%hpp%'
                  or lower(account_name) like '%tissu%'
                  or lower(account_name) like '%bumbu%'
                  or lower(account_name) like '%persediaan bahan%'
                  or lower(account_name) like '%persediaan barang%'
                  then 'cost_of_goods_sold'
                when coalesce(account_code, '') like '4-%'
                  or lower(account_category) like 'revenue%'
                  or lower(account_category) like 'pendapatan%'
                  or lower(account_category) like 'income%'
                  then 'revenue'
                when coalesce(account_code, '') like '6-%'
                  or lower(account_category) in ('expense', 'expenses')
                  or lower(account_category) like 'biaya%'
                  or lower(account_category) like 'beban%'
                  then 'operating_expense'
                when lower(account_category) like 'expense%'
                  then 'operating_expense'
                when coalesce(account_code, '') like '1-%'
                  or coalesce(account_code, '') like '2-%'
                  or coalesce(account_code, '') like '3-%'
                  or lower(account_category) in ('asset', 'liability', 'equity', 'balance_sheet')
                  then 'balance_sheet'
                when lower(account_name) like '%pendapatan%'
                  or lower(account_name) like '%omset%'
                  then 'revenue'
                when lower(account_name) like '%kas%'
                  or lower(account_name) like '%bank%'
                  or lower(account_name) like '%qris%'
                  or lower(account_name) like '%utang%'
                  then 'balance_sheet'
                else 'balance_sheet'
              end as account_type,
              sum(balance) as balance
            from public.view_profit_and_loss
            where transaction_date >= $1::date
              and transaction_date < $2::date
            group by account_code, account_name, account_category
          ) as summary_rows
          where account_type not in ('operating_expense', 'balance_sheet')
                        and coalesce(account_code, '') not like '8-%'
                        and lower(coalesce(account_category, '')) not like 'bahan penunjang%'

          union all

                    select
                        ledger.account_code,
                        ledger.account_name,
                        coalesce(
                            nullif(btrim(account.account_category), ''),
                            'Bahan Penunjang'
                        ) as account_category,
                        'cost_of_goods_sold' as account_type,
                        sum(
                            coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0)
                            - coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0)
                        ) as balance
                    from public.general_ledger as ledger
                    left join lateral (
                        select coalesce(
                                         nullif(btrim(to_jsonb(account_row)->>'account_category'), ''),
                                         nullif(btrim(to_jsonb(account_row)->>'kategori_akun'), ''),
                                         nullif(btrim(to_jsonb(account_row)->>'category'), '')
                                     ) as account_category
                        from public.chart_of_accounts as account_row
                        where coalesce(
                                        nullif(to_jsonb(account_row)->>'account_code', ''),
                                        nullif(to_jsonb(account_row)->>'kode_akun', ''),
                                        nullif(to_jsonb(account_row)->>'code', ''),
                                        nullif(to_jsonb(account_row)->>'kode', '')
                                    ) = ledger.account_code
                        limit 1
                    ) as account on true
                    where ledger.entry_date >= $1::date
                        and ledger.entry_date < $2::date
                        and coalesce(ledger.account_code, '') like '8-%'
                        and ledger.source_type is distinct from 'expense'
                        and not exists (
                            select 1
                            from public.expenses as expense_mirror
                            where coalesce(ledger.reference_number, '') = 'EXP-' || left(expense_mirror.id::text, 8)
                        )
                    group by ledger.account_code, ledger.account_name, account.account_category

                    union all

          select
                                                coalesce(
                                                        nullif(btrim(ledger.account_code), ''),
                                                        account.account_code
                                                ) as account_code,
            ledger.account_name,
            coalesce(nullif(btrim(account.account_category), ''), 'Beban Operasional') as account_category,
            'operating_expense' as account_type,
                        sum(
                            coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0)
                            - coalesce(nullif(ledger.credit_amount, 0), ledger.credit, 0)
                        ) as balance
          from public.general_ledger as ledger
          left join lateral (
                        select coalesce(
                                         nullif(btrim(to_jsonb(account_row)->>'account_code'), ''),
                                         nullif(btrim(to_jsonb(account_row)->>'kode_akun'), ''),
                                         nullif(btrim(to_jsonb(account_row)->>'code'), ''),
                                         nullif(btrim(to_jsonb(account_row)->>'kode'), '')
                                     ) as account_code,
                                     coalesce(
                     nullif(btrim(to_jsonb(account_row)->>'account_category'), ''),
                     nullif(btrim(to_jsonb(account_row)->>'kategori_akun'), ''),
                     nullif(btrim(to_jsonb(account_row)->>'category'), '')
                   ) as account_category
            from public.chart_of_accounts as account_row
                        where coalesce(
                    nullif(to_jsonb(account_row)->>'account_code', ''),
                    nullif(to_jsonb(account_row)->>'kode_akun', ''),
                    nullif(to_jsonb(account_row)->>'code', ''),
                    nullif(to_jsonb(account_row)->>'kode', '')
                  ) = ledger.account_code
                             or (
                                 nullif(btrim(ledger.account_code), '') is null
                                 and lower(btrim(ledger.account_name)) = lower(btrim(coalesce(
                                     to_jsonb(account_row)->>'account_name',
                                     to_jsonb(account_row)->>'nama_akun',
                                     ''
                                 )))
                             )
                        order by (
                            coalesce(
                                nullif(to_jsonb(account_row)->>'account_code', ''),
                                nullif(to_jsonb(account_row)->>'kode_akun', ''),
                                nullif(to_jsonb(account_row)->>'code', ''),
                                nullif(to_jsonb(account_row)->>'kode', '')
                            ) = ledger.account_code
                        ) desc
            limit 1
          ) as account on true
          where ledger.entry_date >= $1::date
            and ledger.entry_date < $2::date
                        and (
                            coalesce(ledger.account_code, '') like '6-%'
                            or coalesce(ledger.account_code, '') = '5-51099'
                            or (
                                nullif(btrim(ledger.account_code), '') is null
                                and coalesce(account.account_code, '') like '6-%'
                            )
                        )
            and ledger.source_type is distinct from 'expense'
                        and not exists (
                            select 1
                            from public.expenses as expense_mirror
                            where coalesce(ledger.reference_number, '') = 'EXP-' || left(expense_mirror.id::text, 8)
                        )
            and lower(ledger.account_name) not like '%beban pokok%'
            and lower(ledger.account_name) not like '%hpp%'
            and lower(ledger.account_name) not like '%tissu%'
            and lower(ledger.account_name) not like '%bumbu%'
            and lower(ledger.account_name) not like '%persediaan bahan%'
            and lower(ledger.account_name) not like '%persediaan barang%'
                    group by ledger.account_code, ledger.account_name, account_category,
                                     account.account_code, account.account_category

          union all

          select
                        coalesce(
                            account.account_code,
                            category.account_code,
                            case
                                when coalesce(category.account_code, '') like '8-%' then category.account_code
                                when coalesce(category.account_code, '') like '5-%' then '5-51099'
                                else '6-9999'
                            end
                        ) as account_code,
            coalesce(
              nullif(btrim(account.account_name), ''),
              nullif(btrim(category.category_name), ''),
              nullif(btrim(expense.category), '')
            ) as account_name,
            coalesce(
              nullif(btrim(account.account_category), ''),
              case
                                when coalesce(account.account_code, category.account_code, '') like '8-%'
                                    then 'Bahan Penunjang'
                when coalesce(account.account_code, category.account_code, '') like '5-%'
                  then 'Beban Pokok Pendapatan'
                else 'Beban Operasional'
              end
            ) as account_category,
            case
                            when coalesce(category.account_code, '') like '8-%'
                                or coalesce(account.account_code, '') like '8-%'
                                then 'cost_of_goods_sold'
                            when coalesce(category.account_code, '') like '5-%'
                or lower(coalesce(account.account_name, category.category_name, expense.category, ''))
                   like '%beban pokok%'
                or lower(coalesce(account.account_name, category.category_name, expense.category, ''))
                   like '%hpp%'
                or lower(coalesce(account.account_name, category.category_name, expense.category, ''))
                   like '%tissu%'
                or lower(coalesce(account.account_name, category.category_name, expense.category, ''))
                   like '%bumbu%'
                or lower(coalesce(account.account_name, category.category_name, expense.category, ''))
                   like '%persediaan bahan%'
                or lower(coalesce(account.account_name, category.category_name, expense.category, ''))
                   like '%persediaan barang%'
                then 'cost_of_goods_sold'
              else 'operating_expense'
            end as account_type,
            sum(expense.amount)::numeric as balance
          from public.expenses as expense
          left join lateral (
            select
              nullif(btrim(expense_category.name), '') as category_name,
              nullif(btrim(expense_category.account_code), '') as account_code
            from public.expense_categories as expense_category
            where coalesce(
                    to_jsonb(expense_category)->>'id',
                    to_jsonb(expense_category)->>'_id'
                  ) = to_jsonb(expense)->>'category_id'
               or lower(btrim(expense_category.name)) = lower(btrim(expense.category))
            order by (
              coalesce(
                to_jsonb(expense_category)->>'id',
                to_jsonb(expense_category)->>'_id'
              ) = to_jsonb(expense)->>'category_id'
            ) desc
            limit 1
          ) as category on true
          left join lateral (
            select coalesce(
                     nullif(btrim(to_jsonb(chart_account)->>'account_name'), ''),
                     nullif(btrim(to_jsonb(chart_account)->>'nama_akun'), '')
                   ) as account_name,
                   coalesce(
                     nullif(btrim(to_jsonb(chart_account)->>'account_code'), ''),
                     nullif(btrim(to_jsonb(chart_account)->>'kode_akun'), ''),
                     nullif(btrim(to_jsonb(chart_account)->>'code'), ''),
                     nullif(btrim(to_jsonb(chart_account)->>'kode'), '')
                   ) as account_code,
                   coalesce(
                     nullif(btrim(to_jsonb(chart_account)->>'account_category'), ''),
                     nullif(btrim(to_jsonb(chart_account)->>'kategori_akun'), ''),
                     nullif(btrim(to_jsonb(chart_account)->>'category'), '')
                   ) as account_category
            from public.chart_of_accounts as chart_account
            where coalesce(
                    nullif(to_jsonb(chart_account)->>'account_code', ''),
                    nullif(to_jsonb(chart_account)->>'kode_akun', ''),
                    nullif(to_jsonb(chart_account)->>'code', ''),
                    nullif(to_jsonb(chart_account)->>'kode', '')
                  ) = category.account_code
            limit 1
          ) as account on true
                    where (expense.date at time zone 'Asia/Makassar')::date >= $1::date
                        and (expense.date at time zone 'Asia/Makassar')::date < $2::date
            and expense.amount > 0
          group by 1, 2, 3, 4
        )
        select
          account_code,
          account_name,
          account_category,
          max(account_type) as account_type,
          sum(balance) as balance
        from report_rows
        group by account_code, account_name, account_category
        order by account_type, account_code, account_name
        """,
        start_date,
        end_date,
    )
    discount_row = await pool.fetchrow(
        """
        select coalesce(
          sum(
            coalesce("promoDiscount", 0)::numeric
            + coalesce("pointsDiscount", 0)::numeric
          ),
          0
        ) as sales_discount
        from public.transactions
                where (date at time zone 'Asia/Makassar')::date >= $1::date
                    and (date at time zone 'Asia/Makassar')::date < $2::date
        """,
        start_date,
        end_date,
    )
    hpp_row = await pool.fetchrow(
        """
        with sold_items as (
          select
            nullif(item.value ->> 'productId', '') as product_id,
            nullif(item.value ->> 'variantId', '')::bigint as variant_id,
                        coalesce(nullif(item.value ->> 'qty', '')::numeric, 0) as qty,
                        coalesce(nullif(item.value ->> 'hpp', '')::numeric, 0) as snapshot_hpp
          from public.transactions as trx
          cross join lateral jsonb_array_elements(
            coalesce(trx.items_json, '[]'::jsonb)
          ) as item(value)
                    where (trx.date at time zone 'Asia/Makassar')::date >= $1::date
                        and (trx.date at time zone 'Asia/Makassar')::date < $2::date
        ),
        variant_costs as (
          select
            ingredient.variant_id,
            sum(ingredient.qty_needed * inventory.cost_per_unit) as variant_hpp
          from public.variant_ingredients as ingredient
          join public.inventory as inventory
            on inventory.id = ingredient.inventory_id
          group by ingredient.variant_id
        )
        select
          coalesce(
            sum(
                            -- HPP per baris penjualan diambil dari snapshot HPP yang sudah
                            -- dibekukan saat transaksi terjadi (items_json.hpp). Bila snapshot
                            -- belum ada, pakai HPP master: varian bila ada, jika tidak HPP
                            -- produk. Kedua sumber TIDAK dijumlahkan agar tidak dobel.
                            coalesce(
                                nullif(sold.snapshot_hpp, 0),
                                case
                                    when sold.variant_id is null then coalesce(product.hpp, 0)
                                    else coalesce(variant.variant_hpp, product.hpp, 0)
                                end
                            ) * sold.qty
            ),
            0
          ) as hpp,
          count(*) filter (where product.id is null) as missing_products
        from sold_items as sold
        left join public.products as product
          on product.id = sold.product_id
        left join variant_costs as variant
          on variant.variant_id = sold.variant_id
        """,
        start_date,
        end_date,
    )
    account_type_aliases = {
        "revenue": "revenue",
        "cost_of_goods_sold": "cogs",
        "cogs": "cogs",
        "operating_expense": "expense",
        "expense": "expense",
    }
    report_rows = []
    hpp_detail_index: dict[Any, int] = {}
    hpp_detail_rows: list[dict[str, Any]] = []
    totals = {"revenue": Decimal("0"), "cogs": Decimal("0"), "expense": Decimal("0")}
    for row in rows:
        report_row = dict(row)
        account_type = account_type_aliases.get(str(report_row.get("account_type") or "").strip().lower())
        if account_type is None:
            raise ValueError(f"Tipe akun laporan laba-rugi tidak didukung: {report_row.get('account_type')!r}.")
        try:
            balance = Decimal(str(report_row["balance"]))
        except (KeyError, TypeError, ValueError, InvalidOperation) as error:
            raise ValueError("Saldo akun laporan laba-rugi tidak valid.") from error
        if not balance.is_finite() or not isinstance(report_row.get("account_name"), str):
            raise ValueError("Akun atau saldo laporan laba-rugi tidak valid.")
        if account_type == "cogs":
            # HPP dihitung ulang dari transaksi penjualan untuk akun induk
            # 5-50000. Baris jurnal 5-50000 dari buku besar dilewati karena
            # sebagian transaksi tercatat ganda (nama akun "Beban HPP" dan
            # "Beban Pokok Pendapatan" untuk transaksi yang sama).
            is_hpp_detail = (
                is_hpp_detail_account_code(report_row.get("account_code"))
                or str(report_row.get("account_category") or "").strip().casefold()
                == ACCOUNT_HPP_DETAIL_CATEGORY.casefold()
            )
            if not is_hpp_detail:
                continue
            report_row["account_type"] = "cogs"
            report_row["balance"] = balance
            report_row["is_hpp_detail"] = True
            report_row["parent_account_code"] = ACCOUNT_HPP_ID
            # Satu baris per kode akun. Penggabungan HANYA dilakukan untuk kode
            # akun yang sama (mis. "Air Galon" dan "Beban HPP - Air Galon"),
            # tidak pernah antar akun berbeda.
            detail_key = str(report_row.get("account_code") or "").strip() or report_row.get("account_name")
            if detail_key in hpp_detail_index:
                existing = hpp_detail_rows[hpp_detail_index[detail_key]]
                existing["balance"] += balance
                candidate_name = str(report_row.get("account_name") or "").strip()
                current_name = str(existing.get("account_name") or "").strip()
                if candidate_name and len(candidate_name) < len(current_name):
                    existing["account_name"] = candidate_name
                continue
            hpp_detail_index[detail_key] = len(hpp_detail_rows)
            hpp_detail_rows.append(report_row)
            continue
        report_row["account_type"] = account_type
        report_row["balance"] = balance
        report_rows.append(report_row)
        totals[account_type] += balance

    try:
        missing_products = int(hpp_row["missing_products"] if hpp_row else 0)
        calculated_hpp = Decimal(str(hpp_row["hpp"] if hpp_row else 0))
    except (KeyError, TypeError, ValueError, InvalidOperation) as error:
        raise ValueError("Nilai HPP berdasarkan transaksi tidak valid.") from error
    if missing_products:
        raise ValueError(
            f"HPP tidak dapat dihitung karena {missing_products} baris penjualan merujuk ke produk yang tidak ditemukan."
        )
    if not calculated_hpp.is_finite() or calculated_hpp < 0:
        raise ValueError("Nilai HPP berdasarkan transaksi tidak valid.")
    # Setiap akun HPP tampil sebagai baris independen: satu baris untuk akun
    # induk 5-50000 (nilai HPP hasil perhitungan transaksi) dan satu baris untuk
    # setiap akun biaya penunjang seri 8-. Tidak ada akumulasi antar akun di
    # dalam baris; total HPP murni penjumlahan seluruh baris tersebut.
    hpp_rows = [
        {
            "account_name": "Beban Pokok Pendapatan",
            "account_code": ACCOUNT_HPP_ID,
            "account_category": "Beban Pokok Pendapatan",
            "account_type": "cogs",
            "balance": calculated_hpp,
            # Penanda urutan tampil (pos induk selalu di atas rincian).
            "is_hpp_parent": True,
        }
    ]
    hpp_rows.extend(
        sorted(hpp_detail_rows, key=lambda detail: str(detail.get("account_code") or "")),
    )
    totals["cogs"] = sum((row["balance"] for row in hpp_rows), Decimal("0"))
    report_rows.extend(hpp_rows)

    try:
        sales_discount = Decimal(str(discount_row["sales_discount"] if discount_row else 0))
    except (KeyError, TypeError, ValueError, InvalidOperation) as error:
        raise ValueError("Nilai potongan penjualan tidak valid.") from error
    if not sales_discount.is_finite() or sales_discount < 0:
        raise ValueError("Nilai potongan penjualan tidak valid.")

    if sales_discount:
        totals["revenue"] += sales_discount
        revenue_end = next(
            (index for index, row in enumerate(report_rows) if row["account_type"] != "revenue"),
            len(report_rows),
        )
        report_rows.insert(revenue_end, {
            "account_name": "Potongan Penjualan",
            "account_code": None,
            "account_category": "Pendapatan",
            "account_type": "revenue",
            "balance": -sales_discount,
        })

    return {
        "rows": report_rows,
        "summary": {
            "revenue": totals["revenue"],
            "sales_discount": sales_discount,
            "hpp": totals["cogs"],
            "expenses": totals["expense"],
            "net_profit": totals["revenue"] - sales_discount - totals["cogs"] - totals["expense"],
        },
    }


def normalize_payment_method(payment_method: str) -> str:
    if not isinstance(payment_method, str):
        raise ValueError("Metode pembayaran tidak valid.")

    methods = {
        "cash": "Cash",
        "tunai": "Cash",
        "qris": "QRIS",
        "debit": "Debit",
        "card": "Card",
        "credit": "Card",
        "credit card": "Card",
    }
    method = methods.get(payment_method.strip().casefold())
    if method is None:
        raise ValueError(f"Metode pembayaran tidak didukung: {payment_method!r}.")
    return method


def get_account_by_payment_method(payment_method: str) -> str:
    method = normalize_payment_method(payment_method)
    return "1-10001" if method == "Cash" else "1-10002"


def _required_journal_id(payload: Any, *keys: str, label: str) -> str:
    if not isinstance(payload, dict):
        raise ValueError(f"Data {label} tidak valid.")
    value = next((payload.get(key) for key in keys if payload.get(key) is not None), None)
    if value is None or not str(value).strip():
        raise ValueError(f"ID {label} wajib diisi.")
    return str(value)


def _positive_journal_amount(value: Any, label: str) -> Decimal:
    if value is None or isinstance(value, bool):
        raise ValueError(f"Nominal {label} harus lebih besar dari 0.")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError(f"Nominal {label} harus berupa angka yang valid.") from error
    if not math.isfinite(amount) or amount <= 0:
        raise ValueError(f"Nominal {label} harus lebih besar dari 0.")
    return amount


async def post_stok_pembelian(connection: Any, purchase_data: Any) -> None:
    if not isinstance(purchase_data, dict):
        raise ValueError("Data pembelian tidak valid.")
    purchase_id = _required_journal_id(
        purchase_data,
        "purchase_id",
        "id",
        label="pembelian",
    )
    amount = _positive_journal_amount(
        purchase_data.get("total_harga"),
        "pembelian",
    )
    supplier_id = purchase_data.get("supplier_id")
    description = f"Pembelian Stok Kredit | Purchase: {purchase_id}"
    if supplier_id is not None:
        description += f" | Supplier: {str(supplier_id)}"
    group_id = str(uuid4())
    description += f" | Group_ID: {group_id}"
    await connection.executemany(
        """
        insert into public.jurnal_transaksi
          (kode_akun, debit, kredit, keterangan)
        values ($1, $2, $3, $4)
        """,
        [
            ("1-10003", amount, Decimal("0"), description),
            ("2-20001", Decimal("0"), amount, description),
        ],
    )


async def post_hpp_checkout(connection: Any, checkout_data: Any) -> None:
    if not isinstance(checkout_data, dict):
        raise ValueError("Data transaksi tidak valid.")
    transaction_id = _required_journal_id(
        checkout_data,
        "transaction_id",
        "id",
        label="transaksi",
    )
    amount = _positive_journal_amount(
        checkout_data.get("total_hpp"),
        "HPP",
    )
    group_id = str(uuid4())
    description = f"HPP Checkout | Transaction: {transaction_id} | Group: {group_id}"
    await connection.executemany(
        """
        insert into public.jurnal_transaksi
          (kode_akun, debit, kredit, keterangan)
        values ($1, $2, $3, $4)
        """,
        [
            ("5-50000", amount, Decimal("0"), description),
            ("1-10003", Decimal("0"), amount, description),
        ],
    )


async def post_checkout_journal_entries(
    connection: Any,
    payload: Any,
) -> None:
    if not isinstance(payload, dict):
        raise ValueError("Payload jurnal checkout tidak valid.")

    transaction_id = (
        payload.get("transaction_id")
        or payload.get("id")
        or payload.get("no_invoice")
    )
    if transaction_id is None or not str(transaction_id).strip():
        raise ValueError("ID transaksi wajib diisi untuk membuat jurnal checkout.")

    provided_entries = payload.get("journal_entries")
    if provided_entries is not None:
        try:
            journal_entries = [
                (str(transaction_id), str(code), str(position).upper(), float(amount))
                for code, position, amount in provided_entries
            ]
        except (TypeError, ValueError) as error:
            raise ValueError("Baris jurnal checkout tidak valid.") from error
        if not journal_entries:
            raise ValueError("Baris jurnal checkout tidak boleh kosong.")
        await connection.executemany(
            """
            insert into public.jurnal_entries
              (transaction_id, account_code, position, amount)
            values ($1, $2, $3, $4)
            """,
            journal_entries,
        )
        return

    payment_method = (
        payload.get("payment_method")
        or payload.get("method")
        or payload.get("metode_pembayaran")
        or ""
    )
    payment_method = str(payment_method).strip().lower()
    cash_account_code = "1-10001" if payment_method in {"tunai", "cash"} else "1-10002"

    total = payload.get("total")
    if total is None:
        total = payload.get("amount", payload.get("nominal"))
    if total is None:
        raise ValueError("Total transaksi wajib diisi untuk membuat jurnal checkout.")

    try:
        if isinstance(total, str):
            if total.strip().startswith("-"):
                raise ValueError("Nominal negatif tidak valid.")
            cleaned_total = re.sub(r"[^\d.]", "", total)
            if not cleaned_total:
                raise ValueError("Nominal kosong setelah sanitasi.")

            if "," in total:
                integer_part, decimal_part = total.rsplit(",", 1)
                decimal_digits = re.sub(r"\D", "", decimal_part)
                integer_digits = re.sub(r"\D", "", integer_part)
                if len(decimal_digits) in (1, 2):
                    cleaned_total = f"{integer_digits}.{decimal_digits}"
                else:
                    cleaned_total = re.sub(r"\.", "", cleaned_total)
            elif cleaned_total.count(".") > 1:
                cleaned_total = cleaned_total.replace(".", "")
            elif "." in cleaned_total:
                integer_part, decimal_part = cleaned_total.rsplit(".", 1)
                if len(decimal_part) == 3 and integer_part:
                    cleaned_total = cleaned_total.replace(".", "")

            amount = float(cleaned_total)
        else:
            amount = float(total)
    except (InvalidOperation, TypeError, ValueError, OverflowError) as error:
        raise ValueError("Total transaksi bukan nilai nominal yang valid.") from error

    if not amount > 0 or amount == float("inf"):
        raise ValueError("Total transaksi harus berupa nilai positif yang valid.")

    journal_entries = [
        (str(transaction_id), cash_account_code, str("DEBIT"), amount),
        (str(transaction_id), "4-40000", str("KREDIT"), amount),
    ]
    await connection.executemany(
        """
        insert into public.jurnal_entries
          (transaction_id, account_code, position, amount)
        values ($1, $2, $3, $4)
        """,
        journal_entries,
    )


def _transaction_amounts(total: Any, admin_fee: Any) -> tuple[Decimal, Decimal]:
    try:
        amount = _money(total)
        fee = _money(admin_fee)
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError("Total transaksi atau biaya admin/MDR tidak valid.") from error
    if not amount.is_finite() or amount < 0:
        raise ValueError("Total transaksi harus berupa nilai positif yang valid.")
    if not fee.is_finite() or fee < 0 or fee > amount:
        raise ValueError("Biaya admin/MDR harus bernilai antara nol dan total transaksi.")
    return amount, fee


def transaction_lines(
    total: float,
    method: str,
    items: list[dict],
    admin_fee: Any = 0,
) -> list[JournalLine]:
    amount, fee = _transaction_amounts(total, admin_fee)
    payment_account_code = get_account_by_payment_method(method)
    lines: list[JournalLine] = []
    if amount > 0:
        settlement_amount = amount - fee
        if settlement_amount > 0:
            payment_account_name = "Kas Tunai" if payment_account_code == "1-10001" else "Bank"
            lines.append((payment_account_name, "asset", settlement_amount, Decimal("0")))
        if fee > 0:
            lines.append(("Beban MDR", "expense", fee, Decimal("0")))
        lines.append(("Pendapatan", "revenue", Decimal("0"), amount))

    cost_of_goods = _money(sum(
        Decimal(str(item.get("hpp", 0) or 0)) * Decimal(str(item.get("qty", 0) or 0))
        for item in items
    ))
    if cost_of_goods > 0:
        lines.extend([
            ("Beban HPP", "expense", cost_of_goods, Decimal("0")),
            ("Persediaan bahan baku", "asset", Decimal("0"), cost_of_goods),
        ])
    return lines


def transaction_account_codes(
    total: float,
    method: str,
    items: list[dict],
    admin_fee: Any = 0,
) -> list[Optional[str]]:
    amount, fee = _transaction_amounts(total, admin_fee)
    payment_account_code = get_account_by_payment_method(method)
    account_codes: list[Optional[str]] = []
    if amount > 0:
        if amount - fee > 0:
            account_codes.append(payment_account_code)
        if fee > 0:
            account_codes.append("6-60203")
        account_codes.append("4-40000")
    if _money(sum(
        Decimal(str(item.get("hpp", 0) or 0)) * Decimal(str(item.get("qty", 0) or 0))
        for item in items
    )) > 0:
        account_codes.extend(["5-50000", "1-10003"])
    return account_codes


def normalize_checkout_payments(
    total: Any,
    payments: Any,
    method: str,
) -> list[dict]:
    """Normalisasi pembayaran kasir menjadi daftar kaki pembayaran yang valid.

    Mendukung pembayaran tunggal (kompatibilitas mundur: hanya ``method``) maupun
    pembayaran terbagi (``payments`` = daftar metode + nominal). Semua kaki
    pembayaran wajib berjumlah ``total`` agar jurnal tidak selisih.
    """
    try:
        total_amount = _money(total)
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError("Total transaksi tidak valid.") from error
    if not total_amount.is_finite() or total_amount < 0:
        raise ValueError("Total transaksi tidak valid.")
    total_integer = int(total_amount.to_integral_value(rounding=ROUND_HALF_UP))

    legs: list[dict] = []
    if payments:
        if not isinstance(payments, (list, tuple)):
            raise ValueError("Data pembayaran tidak valid.")
        for payment in payments:
            if not isinstance(payment, dict):
                raise ValueError("Data pembayaran tidak valid.")
            raw_method = payment.get("method") or payment.get("payment_method") or payment.get("metode")
            try:
                payment_method = normalize_payment_method(raw_method or "")
            except ValueError as error:
                raise ValueError(str(error)) from error
            try:
                amount = _money(payment.get("amount", payment.get("nominal")))
            except (InvalidOperation, TypeError, ValueError) as error:
                raise ValueError("Nominal pembayaran tidak valid.") from error
            if not amount.is_finite() or amount <= 0:
                raise ValueError("Nominal tiap metode pembayaran harus lebih besar dari 0.")
            legs.append({
                "method": payment_method,
                "amount": int(amount.to_integral_value(rounding=ROUND_HALF_UP)),
            })
    elif total_amount > 0:
        try:
            legs.append({
                "method": normalize_payment_method(method),
                "amount": total_integer,
            })
        except ValueError as error:
            raise ValueError(str(error)) from error

    leg_total = sum(leg["amount"] for leg in legs)
    if total_amount > 0 and leg_total != total_integer:
        raise ValueError("Total pembayaran harus pas dengan total tagihan.")

    legs.sort(key=lambda leg: (leg["method"] != "Cash", -leg["amount"]))
    return legs


def checkout_cash_amounts(
    payments: Sequence[dict],
    total: Any,
    cash_given: Any = None,
) -> tuple[int, int]:
    """Hitung ``cashGiven`` (uang diserahkan) dan ``change`` (kembalian).

    Menjaga kompatibilitas mundur: pembayaran non-tunai tunggal menyimpan
    ``cashGiven = total`` dan ``change = 0`` seperti perilaku lama.
    """
    try:
        total_integer = int(_money(total).to_integral_value(rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValueError("Total transaksi tidak valid.") from error
    try:
        requested = int(_money(cash_given)) if cash_given not in (None, "") else 0
    except (InvalidOperation, TypeError, ValueError):
        requested = 0
    cash_portion = sum(leg.get("amount", 0) for leg in payments if leg.get("method") == "Cash")
    if cash_portion <= 0:
        return total_integer, 0
    tendered = max(requested, cash_portion)
    return tendered, tendered - cash_portion


def _payment_leg_lines(payments: Sequence[dict]) -> list[tuple[str, Decimal]]:
    aggregated: dict[str, Decimal] = {}
    for leg in payments:
        amount = _money(leg.get("amount", 0))
        if amount <= 0:
            continue
        account_code = get_account_by_payment_method(leg.get("method", ""))
        aggregated[account_code] = aggregated.get(account_code, Decimal("0")) + amount
    return [
        (account_code, amount)
        for account_code, amount in aggregated.items()
        if amount > 0
    ]


def payment_journal_lines(payments: Sequence[dict]) -> list[JournalLine]:
    """Baris jurnal pendapatan dari multi-pembayaran (satu debit per akun kas/bank)."""
    lines: list[JournalLine] = []
    for account_code, amount in _payment_leg_lines(payments):
        account_name = "Kas Tunai" if account_code == "1-10001" else "Bank"
        lines.append((account_name, "asset", amount, Decimal("0")))
    return lines


def payment_account_codes(payments: Sequence[dict]) -> list[Optional[str]]:
    return [account_code for account_code, _amount in _payment_leg_lines(payments)]


def checkout_journal_lines(
    total: float,
    method: str,
    items: list[dict],
    payments: Optional[Sequence[dict]] = None,
) -> list[JournalLine]:
    """Baris jurnal checkout lengkap (pendapatan multi-metode + HPP).

    Dipakai oleh ``general_ledger`` (via ``post_finance_source``) sekaligus
    ``jurnal_entries`` agar kedua catatan selalu identik.
    """
    payment_lines = payment_journal_lines(payments or [])
    if not payment_lines:
        payment_lines = [
            line
            for line in transaction_lines(total, method, [])
            if line[1] == "asset" and line[2] > 0 and line[3] == 0
        ]
    amount, _fee = _transaction_amounts(total, 0)
    lines: list[JournalLine] = []
    if amount > 0:
        lines.extend(payment_lines)
        lines.append(("Pendapatan", "revenue", Decimal("0"), amount))
    cost_of_goods = _money(sum(
        Decimal(str(item.get("hpp", 0) or 0)) * Decimal(str(item.get("qty", 0) or 0))
        for item in items
    ))
    if cost_of_goods > 0:
        lines.append(("Beban HPP", "expense", cost_of_goods, Decimal("0")))
        lines.append(("Persediaan bahan baku", "asset", Decimal("0"), cost_of_goods))
    return lines


def checkout_journal_account_codes(
    total: float,
    method: str,
    items: list[dict],
    payments: Optional[Sequence[dict]] = None,
) -> list[Optional[str]]:
    payment_codes = payment_account_codes(payments or [])
    if not payment_codes:
        fallback_codes = transaction_account_codes(total, method, [])
        payment_codes = [fallback_codes[0]] if fallback_codes[:1] in (["1-10001"], ["1-10002"]) else []
    amount, _fee = _transaction_amounts(total, 0)
    codes: list[Optional[str]] = []
    if amount > 0:
        codes.extend(payment_codes)
        codes.append("4-40000")
    if _money(sum(
        Decimal(str(item.get("hpp", 0) or 0)) * Decimal(str(item.get("qty", 0) or 0))
        for item in items
    )) > 0:
        codes.extend(["5-50000", "1-10003"])
    return codes


def primary_checkout_method(payments: Sequence[dict], fallback: str) -> str:
    """Metode dominan untuk kolom ``transactions.method`` (legacy/laporan)."""
    if not payments:
        return fallback
    cash_only = all(leg.get("method") == "Cash" for leg in payments)
    if cash_only:
        return "Cash"
    non_cash = [leg for leg in payments if leg.get("method") != "Cash"]
    dominant = max(non_cash or payments, key=lambda leg: leg.get("amount", 0))
    return dominant.get("method") or fallback


_CHECKOUT_FALLBACK_CODES = {
    "Kas Tunai": "1-10001",
    "Bank": "1-10002",
    "Pendapatan": "4-40000",
    "Beban HPP": "5-50000",
    "Persediaan bahan baku": "1-10003",
}


def legacy_checkout_journal_entries(
    lines: Sequence[JournalLine],
    account_codes: Optional[Sequence[Optional[str]]] = None,
) -> list[tuple[str, str, float]]:
    """Konversi baris jurnal checkout menjadi pasangan debit/kredit ``jurnal_entries``."""
    entries: list[tuple[str, str, float]] = []
    for index, (account_name, _account_type, debit, credit) in enumerate(lines):
        code = None
        if account_codes is not None and index < len(account_codes):
            code = account_codes[index]
        code = code or _CHECKOUT_FALLBACK_CODES.get(account_name)
        if not code or debit == credit:
            continue
        entries.append((
            code,
            "DEBIT" if debit > credit else "KREDIT",
            float(debit if debit > credit else credit),
        ))
    return entries


def purchase_lines(total_cost: float) -> list[JournalLine]:
    amount = Decimal(int(round(total_cost)))
    if amount <= 0:
        return []
    return [
        ("Persediaan bahan baku", "asset", amount, Decimal("0")),
        ("Kas", "asset", Decimal("0"), amount),
    ]


def purchase_journal_lines(
    total_cost: Any,
    payment_method: str,
    funding_account_code: Optional[str] = None,
) -> list[JournalLine]:
    amount = _money(total_cost)
    if amount <= 0:
        return []
    if payment_method == "credit":
        credit_account, credit_type = "Utang Usaha", "liability"
    else:
        credit_account = {
            "1-10001": "Kas",
            "1-10002": "Bank",
        }.get(funding_account_code or "", funding_account_code)
        if not isinstance(credit_account, str) or not credit_account.strip():
            raise ValueError("Sumber dana pembelian tunai tidak valid.")
        credit_type = "asset"
    return [
        ("Persediaan Barang", "asset", amount, Decimal("0")),
        (credit_account, credit_type, Decimal("0"), amount),
    ]


def debt_payment_lines(amount: Any, funding_account_code: str) -> list[JournalLine]:
    value = _money(amount)
    funding_account = {
        "1-10001": "Kas",
        "1-10002": "Bank",
    }.get(funding_account_code, funding_account_code)
    if value <= 0:
        return []
    if not isinstance(funding_account, str) or not funding_account.strip():
        raise ValueError("Sumber dana pelunasan tidak valid.")
    return [
        ("Utang Usaha", "liability", value, Decimal("0")),
        (funding_account, "asset", Decimal("0"), value),
    ]


async def post_purchase_journal(
    connection: Any,
    amount: Any,
    payment_method: str,
    funding_account_code: Optional[str],
    description: str,
) -> None:
    if payment_method == "credit":
        credit_code = "2-20001"
    else:
        if not isinstance(funding_account_code, str) or not funding_account_code.strip():
            raise ValueError("Sumber dana pembelian tunai tidak valid.")
        credit_code = funding_account_code
    value = _positive_journal_amount(amount, "pembelian").quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    if value <= 0:
        return
    group_id = str(uuid4())
    description = f"{description.strip()} | Group_ID: {group_id}"
    await connection.executemany(
        """
        insert into public.jurnal_transaksi
          (kode_akun, debit, kredit, keterangan)
        values ($1, $2, $3, $4)
        """,
        [
            ("1-10003", value, Decimal("0"), description),
            (credit_code, Decimal("0"), value, description),
        ],
    )


async def post_debt_payment_journal(
    connection: Any,
    amount: Any,
    funding_account_code: str,
    description: str,
) -> None:
    if not isinstance(funding_account_code, str) or not funding_account_code.strip():
        raise ValueError("Sumber dana pelunasan tidak valid.")
    value = _money(amount)
    if value <= 0:
        return
    await connection.executemany(
        """
        insert into public.jurnal_transaksi
          (kode_akun, debit, kredit, keterangan)
        values ($1, $2, $3, $4)
        """,
        [
            ("2-20001", value, Decimal("0"), description),
            (funding_account_code, Decimal("0"), value, description),
        ],
    )


def expense_lines(category: str, amount: float) -> list[JournalLine]:
    value = Decimal(int(round(amount)))
    if value <= 0:
        return []
    return [
        (category.strip(), "expense", value, Decimal("0")),
        ("Kas", "asset", Decimal("0"), value),
    ]


ACCOUNT_BEBAN_OPERASIONAL_LAINNYA_ID = "6-9999"


async def resolve_expense_account_code(
    connection: Any,
    category: str,
    category_id: Any = None,
) -> str:
    """
    Menentukan kode akun beban untuk sebuah pengeluaran.

    Urutan pencarian: kategori berdasarkan id, kategori berdasarkan nama pada
    public.expense_categories, lalu peta fallback lokal. Bila semuanya gagal,
    pengeluaran dibukukan ke akun penampung 6-9999 agar laporan laba rugi tetap
    memuat bebannya dan kode akun tidak pernah NULL.
    """
    if category_id is not None:
        try:
            row = await connection.fetchrow(
                """
                select nullif(btrim(account_code), '') as account_code
                from public.expense_categories
                where id = $1
                """,
                category_id,
            )
        except (
            asyncpg.PostgresConnectionError,
            asyncpg.InterfaceError,
            ConnectionError,
            OSError,
            TimeoutError,
        ):
            row = None
        if row is not None:
            resolved = str(row["account_code"] or "").strip()
            if resolved:
                return resolved

    if isinstance(category, str) and category.strip():
        try:
            return await _cash_movement_account_code(connection, category)
        except ValueError:
            pass

    return ACCOUNT_BEBAN_OPERASIONAL_LAINNYA_ID


def expense_account_codes(
    amount: float,
    account_code: Optional[str] = None,
) -> list[Optional[str]]:
    """Kode akun pendamping expense_lines() agar baris ledger tidak berkode NULL."""
    if Decimal(int(round(amount))) <= 0:
        return []
    return [
        account_code or ACCOUNT_BEBAN_OPERASIONAL_LAINNYA_ID,
        ACCOUNT_KAS_TUNAI_ID,
    ]


async def post_cash_expense_journal(
    connection: Any,
    amount: Any,
    description: str,
    account_code: Optional[str] = None,
) -> None:
    """
    Mencatat pengeluaran tunai pada jurnal kasir (public.jurnal_transaksi).

    Jurnal ditulis BERPASANGAN: debit akun beban + kredit kas. Sebelumnya hanya
    sisi kredit kas yang ditulis sehingga jurnal tidak seimbang; selisih itulah
    yang dahulu "ditambal" trigger ke akun penampung 41999.
    """
    value = _money(amount)
    if value <= 0:
        return
    expense_code = account_code or ACCOUNT_BEBAN_OPERASIONAL_LAINNYA_ID
    keterangan = f"Pembayaran Tunai Kasir: {description}"
    await connection.executemany(
        """
        insert into public.jurnal_transaksi
          (kode_akun, debit, kredit, keterangan)
        values ($1, $2, $3, $4)
        """,
        [
            (expense_code, value, Decimal("0"), keterangan),
            (ACCOUNT_KAS_TUNAI_ID, Decimal("0"), value, keterangan),
        ],
    )


async def _cash_movement_account_code(connection: Any, category: str) -> str:
    normalized_category = " ".join(category.strip().casefold().split())
    escaped_category = (
        category.strip()
        .replace("!", "!!")
        .replace("%", "!%")
        .replace("_", "!_")
    )

    try:
        rows = await connection.fetch(
            """
            select nullif(btrim(account_code), '') as account_code
            from public.expense_categories
            where trim(name) ilike trim($1) escape '!'
            limit 2
            """,
            escaped_category,
        )
    except (
        asyncpg.PostgresConnectionError,
        asyncpg.InterfaceError,
        ConnectionError,
        OSError,
        TimeoutError,
    ):
        logger.exception(
            "Gagal membaca public.expense_categories untuk kategori kas keluar %r; "
            "mencoba pemetaan lokal.",
            normalized_category,
        )
    else:
        if len(rows) > 1:
            raise ValueError(
                f"Kategori kas keluar {category.strip()!r} memiliki lebih dari satu "
                "pemetaan di public.expense_categories."
            )
        if rows:
            account_code = rows[0]["account_code"]
            if not account_code:
                raise ValueError(
                    f"Kode akun kategori kas keluar {category.strip()!r} kosong."
                )
            return str(account_code).strip()

    account_code = KATEGORI_PENGELUARAN_FALLBACK.get(normalized_category)
    if account_code is None:
        raise ValueError(
            f"Kategori kas keluar belum dipetakan ke akun jurnal: {category!r}."
        )
    return account_code


async def post_cash_movement_journal(
    connection: Any,
    amount: Any,
    category: str,
    note: str,
) -> str:
    if not isinstance(category, str) or not category.strip():
        raise ValueError("Kategori kas keluar wajib diisi.")
    category = category.strip()
    debit_account_code = await _cash_movement_account_code(connection, category)

    value = _positive_journal_amount(amount, "kas keluar").quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    if value <= 0:
        raise ValueError("Nominal kas keluar harus lebih besar dari 0.01.")

    group_id = str(uuid4())
    description = " - ".join(part.strip() for part in (category, note) if part.strip())
    description = f"{description} | Group_ID: {group_id}"
    await connection.executemany(
        """
        insert into public.jurnal_transaksi
          (kode_akun, debit, kredit, keterangan)
        values ($1, $2, $3, $4)
        """,
        [
            (debit_account_code, value, Decimal("0.00"), description),
            (ACCOUNT_KAS_TUNAI_ID, Decimal("0.00"), value, description),
        ],
    )
    return group_id


async def post_purchase_payment_journal(
    connection: Any,
    amount: Any,
    account_code: str,
    description: str,
) -> None:
    await connection.execute(
        """
        insert into public.jurnal_transaksi
          (kode_akun, debit, kredit, keterangan)
        values ($1, 0, $2, $3)
        """,
        account_code,
        _money(amount),
        description,
    )


async def post_finance_source(
    connection: Any,
    source_type: str,
    source_id: str,
    entry_date: date,
    description: Optional[str],
    created_by: Optional[str],
    lines: Sequence[JournalLine],
    account_codes: Optional[Sequence[Optional[str]]] = None,
    reference_number: Optional[str] = None,
) -> None:
    if not lines:
        return
    description = description.strip() if isinstance(description, str) else ""
    if not description:
        description_label = "Transaksi Kasir POS" if source_type == "transaction" else source_type.replace("_", " ").capitalize()
        description = f"{description_label} - {source_id}"
    if account_codes is not None and len(account_codes) != len(lines):
        raise ValueError("Kode akun harus sesuai dengan jumlah baris jurnal.")
    reference_number = (
        reference_number.strip()
        if isinstance(reference_number, str) and reference_number.strip()
        else source_id
    )

    def _effective_account_code(
        index: int,
        account_name: Optional[str],
        account_type: str,
        debit: Any,
        credit: Any,
    ) -> Optional[str]:
        code = account_codes[index] if account_codes is not None else None
        if not code and source_type == "transaction":
            # Penjualan POS tidak boleh jatuh ke akun penampung 41999.
            if account_type == "revenue" and credit > 0 and debit == 0:
                return "4-40000"
            if (
                account_type == "expense"
                and debit > 0
                and credit == 0
                and account_name == "Beban HPP"
            ):
                return "5-50000"
        return code

    effective_codes = [
        _effective_account_code(index, account_name, account_type, debit, credit)
        for index, (account_name, account_type, debit, credit) in enumerate(lines)
    ]

    account_ids: dict[str, Any] = {}
    master_account_names: dict[str, str] = {}
    required_codes = sorted({code for code in effective_codes if code})
    if required_codes:
        accounts = await connection.fetch(
            """
            select
              coalesce(
                nullif(to_jsonb(account)->>'account_code', ''),
                nullif(to_jsonb(account)->>'kode_akun', ''),
                nullif(to_jsonb(account)->>'code', ''),
                nullif(to_jsonb(account)->>'kode', '')
              ) as account_code,
              coalesce(
                nullif(btrim(to_jsonb(account)->>'nama_akun'), ''),
                nullif(btrim(to_jsonb(account)->>'account_name'), '')
              ) as account_name,
              nullif(to_jsonb(account)->>'id', '')::uuid as account_id
            from public.chart_of_accounts as account
            where coalesce(
              nullif(to_jsonb(account)->>'account_code', ''),
              nullif(to_jsonb(account)->>'kode_akun', ''),
              nullif(to_jsonb(account)->>'code', ''),
              nullif(to_jsonb(account)->>'kode', '')
            ) = any($1::text[])
            """,
            required_codes,
        )
        for account in accounts:
            code = account["account_code"]
            account_id = account["account_id"]
            if code in account_ids and account_ids[code] != account_id:
                raise RuntimeError(f"Kode akun {code} memiliki lebih dari satu akun master.")
            account_ids[code] = account_id
            account_name = account.get("account_name")
            if isinstance(account_name, str) and account_name.strip():
                master_account_names[code] = account_name.strip()

    entry_id = uuid4()
    account_names_by_code = {
        "1-10001": "Kas Tunai",
        "4-40000": "Pendapatan",
    }
    rows = []
    for index, (account_name, account_type, debit, credit) in enumerate(lines):
        account_code = effective_codes[index]
        account_name = (
            account_names_by_code.get(account_code)
            or master_account_names.get(account_code)
            or account_name
        )
        if not isinstance(account_name, str) or not account_name.strip():
            if source_type == "transaction" and account_type == "asset" and debit > 0 and credit == 0:
                account_name = "Kas Tunai"
            elif source_type == "transaction" and account_type == "revenue" and credit > 0 and debit == 0:
                account_name = "Pendapatan"
        if not isinstance(account_name, str) or not account_name.strip():
            raise ValueError("Nama akun general ledger wajib diisi.")
        rows.append((
            entry_id,
            entry_date,
            entry_date,
            description,
            account_name,
            account_type,
            account_code,
            account_ids.get(account_code),
            debit,
            credit,
            created_by,
            source_type,
            source_id,
            reference_number,
        ))

    await connection.executemany(
        """
        insert into public.general_ledger
          (entry_id, transaction_date, entry_date, description, account_name, account_type, account_code, account_id,
           debit, credit, debit_amount, credit_amount, created_by, source_type, source_id, reference_number)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $10, $11, $12, $13, $14)
        """,
        rows,
    )


async def get_laporan_arus_kas(
    connection: Any,
    start_date: date,
    end_date: date
) -> dict[str, Any]:
    """
    Menarik ringkasan Laporan Arus Kas langsung dari Supabase View
    berdasarkan rentang tanggal yang ditentukan untuk konsumsi UI.
    """
    rows = await connection.fetch(
        """
        SELECT 
            aktivitas_arus_kas,
            nama_akun_lawan,
            SUM(nilai_neto) AS total_nilai_neto
        FROM public.view_laporan_arus_kas_final
        WHERE tanggal_transaksi BETWEEN $1 AND $2
        GROUP BY aktivitas_arus_kas, nama_akun_lawan
        ORDER BY aktivitas_arus_kas ASC;
        """,
        start_date,
        end_date
    )
    cash_totals = await connection.fetchrow(
        """
        select coalesce(sum(coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0)), 0) as total_kas_masuk
        from public.general_ledger as ledger
        left join lateral (
          select coalesce(
                   nullif(btrim(to_jsonb(account)->>'account_category'), ''),
                   nullif(btrim(to_jsonb(account)->>'kategori_akun'), ''),
                   nullif(btrim(to_jsonb(account)->>'category'), '')
                 ) as account_category
          from public.chart_of_accounts as account
          where coalesce(
                  nullif(btrim(to_jsonb(account)->>'account_code'), ''),
                  nullif(btrim(to_jsonb(account)->>'kode_akun'), ''),
                  nullif(btrim(to_jsonb(account)->>'code'), ''),
                  nullif(btrim(to_jsonb(account)->>'kode'), '')
                ) = ledger.account_code
          limit 1
        ) as account on true
        where ledger.transaction_date >= $1::date
          and ledger.transaction_date < ($2::date + interval '1 day')
          and coalesce(nullif(ledger.debit_amount, 0), ledger.debit, 0) > 0
          and (
            lower(coalesce(account.account_category, '')) like '%kas%'
            or lower(coalesce(account.account_category, '')) like '%bank%'
            or lower(coalesce(account.account_category, '')) like '%cash%'
            or (
                            (ledger.account_code like '1-%' or ledger.account_code is null)
              and lower(ledger.account_name) ~ '(kas|bank|cash|qris|rekening)'
            )
          )
                    -- Jangan hitung dua kali: kas masuk yang berasal dari transaksi
                    -- modal/ekuitas ('3-') atau aset investasi ('9-') sudah disajikan
                    -- pada Aktivitas Pendanaan (CFF) / Aktivitas Investasi (CFI).
                    and not exists (
                        select 1
                        from public.general_ledger as funding
                        where funding.entry_id is not distinct from ledger.entry_id
                            and (
                                funding.account_code like '3-%'
                                or funding.account_code like '9-%'
                            )
                    )
        """,
        start_date,
        end_date,
    )

    report = {
        "1. Aktivitas Operasional (CFO)": {},
        "2. Aktivitas Investasi (CFI)": {},
        "3. Aktivitas Pendanaan (CFF)": {},
        "Total_Kas_Masuk": _money(cash_totals["total_kas_masuk"]),
        "Total_Bersih": Decimal("0.00")
    }

    for row in rows:
        kategori = row['aktivitas_arus_kas']
        akun = row['nama_akun_lawan']
        nilai = _money(row['total_nilai_neto'])

        if kategori in report:
            report[kategori][akun] = nilai
            report["Total_Bersih"] += nilai

    return report


async def get_dashboard_neraca_kas(connection: Any) -> dict[str, Any]:
    row = await connection.fetchrow(
        """
        select
          kas_bank_akhir,
          persediaan_bahan_baku,
          total_aset,
          total_liabilitas_ekuitas
        from public.view_dashboard_neraca_kas
        """
    )
    if row is None:
        raise RuntimeError("View view_dashboard_neraca_kas tidak mengembalikan data.")
    return dict(row)


async def get_recent_finance_transactions(
    connection: Any,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> list[dict[str, Any]]:
    rows = await connection.fetch(
        """
        select tanggal, keterangan, kode_akun, debit, kredit
        from public.jurnal_transaksi
                where ($1::date is null
                             or (tanggal::timestamptz at time zone 'Asia/Makassar')::date >= $1::date)
                    and ($2::date is null
                             or (tanggal::timestamptz at time zone 'Asia/Makassar')::date <= $2::date)
        order by tanggal desc, id desc
        limit 5
        """,
        start_date,
        end_date,
    )
    return [dict(row) for row in rows]
