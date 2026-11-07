import asyncio
from datetime import date
from decimal import Decimal

from finance import get_laporan_arus_kas


def test_cash_flow_report_includes_cash_in_from_cash_bank_ledger_accounts():
    start_date = date(2026, 11, 1)
    end_date = date(2026, 11, 30)

    class FakeConnection:
        async def fetch(self, query, *args):
            assert "view_laporan_arus_kas_final" in query
            assert args == (start_date, end_date)
            return []

        async def fetchrow(self, query, *args):
            assert "from public.general_ledger as ledger" in query
            assert "from public.chart_of_accounts as account" in query
            assert "ledger.account_code like '1-%'" in query
            assert args == (start_date, end_date)
            return {"total_kas_masuk": Decimal("5000.00")}

    report = asyncio.run(get_laporan_arus_kas(FakeConnection(), start_date, end_date))

    assert report["Total_Kas_Masuk"] == Decimal("5000.00")
    assert report["Total_Bersih"] == Decimal("0.00")


def test_cash_flow_report_classifies_equity_as_cff_and_asset_9_as_cfi():
    start_date = date(2026, 11, 1)
    end_date = date(2026, 11, 30)

    class FakeConnection:
        async def fetch(self, query, *args):
            assert "view_laporan_arus_kas_final" in query
            assert args == (start_date, end_date)
            return [
                {
                    "aktivitas_arus_kas": "3. Aktivitas Pendanaan (CFF)",
                    "nama_akun_lawan": "Modal Disetor / Modal Pemilik",
                    "total_nilai_neto": Decimal("1000000.00"),
                },
                {
                    "aktivitas_arus_kas": "3. Aktivitas Pendanaan (CFF)",
                    "nama_akun_lawan": "Prive Pemilik (Drawing)",
                    "total_nilai_neto": Decimal("-250000.00"),
                },
                {
                    "aktivitas_arus_kas": "2. Aktivitas Investasi (CFI)",
                    "nama_akun_lawan": "Aset Lainnya / Aset Penyesuaian",
                    "total_nilai_neto": Decimal("-500000.00"),
                },
                {
                    "aktivitas_arus_kas": "4. Belum Terklasifikasi",
                    "nama_akun_lawan": "Entri tak dikenal",
                    "total_nilai_neto": Decimal("999999.00"),
                },
            ]

        async def fetchrow(self, query, *args):
            assert args == (start_date, end_date)
            # Kas masuk dari transaksi modal/investasi tidak boleh dihitung ganda.
            assert "funding.account_code like '3-%'" in query
            assert "funding.account_code like '9-%'" in query
            assert "funding.entry_id is not distinct from ledger.entry_id" in query
            return {"total_kas_masuk": Decimal("7344000.00")}

    report = asyncio.run(get_laporan_arus_kas(FakeConnection(), start_date, end_date))

    assert report["3. Aktivitas Pendanaan (CFF)"]["Modal Disetor / Modal Pemilik"] == Decimal("1000000.00")
    assert report["3. Aktivitas Pendanaan (CFF)"]["Prive Pemilik (Drawing)"] == Decimal("-250000.00")
    assert report["2. Aktivitas Investasi (CFI)"]["Aset Lainnya / Aset Penyesuaian"] == Decimal("-500000.00")
    # Baris "4. Belum Terklasifikasi" tidak boleh masuk total.
    assert report["Total_Bersih"] == Decimal("250000.00")
    assert report["Total_Kas_Masuk"] == Decimal("7344000.00")
