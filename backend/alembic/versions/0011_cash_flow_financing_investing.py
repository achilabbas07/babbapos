"""Classify equity (3-) cash flows as CFF and investing (9-) as CFI.

Revision ID: 0011_cash_flow_financing_investing
Revises: 0010_waiter_shift_variant_ids
"""
from pathlib import Path

from alembic import op

revision = "0011_cash_flow_financing_investing"
down_revision = "0010_waiter_shift_variant_ids"
branch_labels = None
depends_on = None


def upgrade():
    sql_path = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrate_cash_flow_financing_investing.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError(
        "Downgrade dilakukan manual agar definisi view produksi tidak tertimpa"
    )
