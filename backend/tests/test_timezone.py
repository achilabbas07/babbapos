"""Uji konsistensi zona waktu Asia/Makassar (WITA, UTC+8) pada backend.

Server Render/Vercel berjalan pada UTC. Tanpa konversi eksplisit, transaksi
dini hari (mis. 00:34 WITA) akan tercatat pada tanggal kalender hari
sebelumnya. Modul ini mengunci perilaku helper di ``core`` dan memastikan
penomoran nota memakai tanggal lokal.
"""

import asyncio
from datetime import date, datetime, timedelta, timezone

import core
from core import WITA, local_date_str, now_local, to_local_date, today_local


def test_wita_is_fixed_utc_plus_eight():
    assert WITA.utcoffset(None) == timedelta(hours=8)


def test_now_local_matches_wita_offset():
    local = now_local()
    assert local.tzinfo is not None
    assert local.utcoffset() == timedelta(hours=8)
    # now_local() adalah instant yang sama dengan UTC, hanya offset-nya beda.
    assert abs(local - datetime.now(timezone.utc)) < timedelta(seconds=5)
    # Jam dinding lokal harus 8 jam lebih maju daripada jam dinding UTC.
    assert local.hour == (datetime.now(timezone.utc).hour + 8) % 24


def test_today_local_uses_wita_calendar_date():
    assert today_local() == datetime.now(WITA).date()


def test_local_date_str_is_yyyymmdd_of_wita_today():
    assert local_date_str() == datetime.now(WITA).strftime("%Y%m%d")
    assert len(local_date_str()) == 8


def test_to_local_date_maps_early_morning_wita_to_local_calendar_day():
    # 2026-03-01T00:34 WITA == 2026-02-28T16:34 UTC.
    assert to_local_date("2026-02-28T16:34:00+00:00") == date(2026, 3, 1)
    # Naive timestamp dianggap UTC (konsisten dengan to_utc_iso).
    assert to_local_date("2026-02-28T16:34:00") == date(2026, 3, 1)
    # Timestamp yang sudah UTC+8 tidak digeser lagi.
    assert to_local_date("2026-03-01T00:34:00+08:00") == date(2026, 3, 1)


def test_to_local_date_accepts_datetime_and_date():
    assert to_local_date(datetime(2026, 2, 28, 16, 34, tzinfo=timezone.utc)) == date(2026, 3, 1)
    assert to_local_date(date(2026, 3, 1)) == date(2026, 3, 1)


def test_document_ids_use_local_date_not_utc():
    """Nota TRX/PO/SHIFT harus memakai tanggal WITA, bukan tanggal UTC."""
    import inspect

    import server
    import shifts

    checkout_source = inspect.getsource(server.create_transaction)
    assert 'f"TRX-{local_date_str()}"' in checkout_source
    assert "datetime.now(timezone.utc):%Y%m%d" not in checkout_source

    purchase_source = inspect.getsource(server.create_purchase)
    assert 'f"PO-{local_date_str()}"' in purchase_source
    assert "datetime.now(timezone.utc):%Y%m%d" not in purchase_source

    shift_source = inspect.getsource(shifts.open_shift)
    assert 'f"SHIFT-{local_date_str()}"' in shift_source


def test_report_summary_default_offset_is_wita():
    """Default tz_offset harus -480 menit (WITA) agar bucket harian benar."""
    import inspect

    import server

    signature = inspect.signature(server.report_summary)
    assert signature.parameters["tz_offset"].default == -480


def test_balance_sheet_filter_uses_local_calendar_dates():
    """Filter neraca memakai transaction_date (kolom date) tanpa konversi ganda."""
    import inspect

    import server

    source = inspect.getsource(server.finance_balance_sheet)
    assert "ledger.transaction_date >= $1" in source
    assert "ledger.transaction_date < $2" in source
    assert "at time zone" not in source


def test_finance_sql_converts_timestamptz_columns_to_wita():
    """Kolom timestamptz harus dikonversi ke Asia/Makassar sebelum difilter."""
    import inspect

    import finance

    source = inspect.getsource(finance.get_profit_and_loss_report)
    assert "(expense.date at time zone 'Asia/Makassar')::date >= $1::date" in source
    assert "(trx.date at time zone 'Asia/Makassar')::date >= $1::date" in source
    assert "(date at time zone 'Asia/Makassar')::date >= $1::date" in source

    recent = inspect.getsource(finance.get_recent_finance_transactions)
    assert "(tanggal::timestamptz at time zone 'Asia/Makassar')::date >= $1::date" in recent


def test_shift_id_uses_local_date(monkeypatch):
    import shifts

    assert shifts.local_date_str is core.local_date_str
