import asyncio
from datetime import date
from decimal import Decimal

from finance import get_laporan_arus_kas


def test_cash_flow_report_includes_cash_in_from_monthly_cash_view():
    start_date = date(2026, 11, 1)
    end_date = date(2026, 11, 30)

    class FakeConnection:
        async def fetch(self, query, *args):
            assert "view_laporan_arus_kas_final" in query
            assert args == (start_date, end_date)
            return []

        async def fetchrow(self, query, *args):
            assert "view_arus_kas_bulanan" in query
            assert "sum(money_in)" in query.lower()
            assert args == (start_date, end_date)
            return {"total_kas_masuk": Decimal("5000.00")}

    report = asyncio.run(get_laporan_arus_kas(FakeConnection(), start_date, end_date))

    assert report["Total_Kas_Masuk"] == Decimal("5000.00")
    assert report["Total_Bersih"] == Decimal("0.00")
