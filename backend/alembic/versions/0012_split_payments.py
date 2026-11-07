"""Split payment: payments jsonb column on transactions

Revision ID: 0012_split_payments
Revises: 0011_cash_flow_financing_investing
Create Date: 2026-11-08
"""
from pathlib import Path

from alembic import op

revision = "0012_split_payments"
down_revision = "0011_cash_flow_financing_investing"
branch_labels = None
depends_on = None


def upgrade():
    sql_path = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrate_split_payments.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError(
        "Downgrade dilakukan manual agar rincian pembayaran produksi tidak terhapus"
    )
