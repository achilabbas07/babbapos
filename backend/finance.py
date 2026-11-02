import math
import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional, Sequence
from uuid import uuid4

# Struktur data untuk baris jurnal umum
JournalLine = tuple[str, str, Decimal, Decimal]

ACCOUNT_PERSEDIAAN_BAHAN_ID = "1-10003"
ACCOUNT_BEBAN_OPERASIONAL_ID = "6-60000"
ACCOUNT_HPP_ID = "5-50000"
ACCOUNT_KAS_TUNAI_ID = "1-10001"

KATEGORI_PENGELUARAN_MAP = {
    "pembelian bahan baku": {
        "debit": ACCOUNT_PERSEDIAAN_BAHAN_ID,
        "kredit": ACCOUNT_KAS_TUNAI_ID,
    },
    "biaya operasional": {
        "debit": ACCOUNT_BEBAN_OPERASIONAL_ID,
        "kredit": ACCOUNT_KAS_TUNAI_ID,
    },
    "biaya angkut/pengiriman": {
        "debit": ACCOUNT_HPP_ID,
        "kredit": ACCOUNT_KAS_TUNAI_ID,
    },
}


async def get_account_balances(pool: Any) -> list[dict[str, Any]]:
    rows = await pool.fetch(
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
          to_jsonb(account)->>'saldo_terupdate' as saldo_terupdate
        from public.chart_of_accounts as account
        order by kode_akun
        """
    )

    accounts = []
    seen_codes = set()
    for row in rows:
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
            balance = Decimal(str(account["saldo_terupdate"]))
        except (InvalidOperation, KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Saldo akun {code} bukan nilai numerik yang valid.") from error
        if not balance.is_finite():
            raise ValueError(f"Saldo akun {code} bukan nilai numerik yang valid.")

        accounts.append({
            "kode_akun": code,
            "nama_akun": name,
            "kategori_akun": category,
            "saldo_terupdate": balance,
        })
    return accounts


def account_type_from_category(account_category: Optional[str]) -> Optional[str]:
    if not account_category:
        return None

    category = account_category.strip().lower()
    category_prefixes = (
        (("asset", "assets", "aset", "aktiva"), "asset"),
        (("liabilit", "kewajiban", "utang", "hutang"), "liability"),
        (("equity", "ekuitas", "modal"), "equity"),
        (("revenue", "pendapatan", "income"), "revenue"),
        (("expense", "beban", "biaya"), "expense"),
    )
    for prefixes, account_type in category_prefixes:
        if category.startswith(prefixes):
            return account_type
    return None


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
          sum(debit) as total_debit,
          sum(credit) as total_credit,
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
        account_type = account_type_from_category(account["account_category"])
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
    description += f" | Group: {group_id}"
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
        account_codes.extend([None, None])
    return account_codes


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
        }.get(funding_account_code or "")
        if credit_account is None:
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
    }.get(funding_account_code)
    if value <= 0:
        return []
    if funding_account is None:
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
        if funding_account_code not in {"1-10001", "1-10002"}:
            raise ValueError("Sumber dana pembelian tunai tidak valid.")
        credit_code = funding_account_code
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
    if funding_account_code not in {"1-10001", "1-10002"}:
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


async def post_cash_expense_journal(
    connection: Any,
    amount: Any,
    description: str,
) -> None:
    await connection.execute(
        """
        insert into public.jurnal_transaksi
          (kode_akun, debit, kredit, keterangan)
        values ($1, 0, $2, $3)
        """,
        "1-10001",
        _money(amount),
        f"Pembayaran Tunai Kasir: {description}",
    )


async def post_cash_movement_journal(
    connection: Any,
    amount: Any,
    category: str,
    note: str,
) -> str:
    normalized_category = " ".join(category.casefold().split()) if isinstance(category, str) else ""
    accounts = KATEGORI_PENGELUARAN_MAP.get(normalized_category)
    if accounts is None:
        raise ValueError(f"Kategori kas keluar belum dipetakan ke akun jurnal: {category!r}.")

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
            (accounts["debit"], value, Decimal("0.00"), description),
            (accounts["kredit"], Decimal("0.00"), value, description),
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
) -> None:
    if not lines:
        return
    description = description.strip() if isinstance(description, str) else ""
    if not description:
        description_label = "Transaksi Kasir POS" if source_type == "transaction" else source_type.replace("_", " ").capitalize()
        description = f"{description_label} - {source_id}"
    if account_codes is not None and len(account_codes) != len(lines):
        raise ValueError("Kode akun harus sesuai dengan jumlah baris jurnal.")

    account_ids: dict[str, Any] = {}
    master_account_names: dict[str, str] = {}
    required_codes = sorted({code for code in account_codes or [] if code})
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
        account_code = account_codes[index] if account_codes is not None else None
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
        ))

    await connection.executemany(
        """
        insert into public.general_ledger
          (entry_id, transaction_date, entry_date, description, account_name, account_type, account_code, account_id,
           debit, credit, created_by, source_type, source_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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

    report = {
        "1. Aktivitas Operasional (CFO)": {},
        "2. Aktivitas Investasi (CFI)": {},
        "3. Aktivitas Pendanaan (CFF)": {},
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
        where ($1::date is null or tanggal >= $1::date)
          and ($2::date is null or tanggal < ($2::date + interval '1 day'))
        order by tanggal desc, id desc
        limit 5
        """,
        start_date,
        end_date,
    )
    return [dict(row) for row in rows]
