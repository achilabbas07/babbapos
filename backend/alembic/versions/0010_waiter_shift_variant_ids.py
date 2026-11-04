"""Persist variant IDs in waiter shift item logs.

Revision ID: 0010_waiter_shift_variant_ids
Revises: 0009_cash_flow_purchase_labels
"""
from pathlib import Path

from alembic import op

revision = "0010_waiter_shift_variant_ids"
down_revision = "0009_cash_flow_purchase_labels"
branch_labels = None
depends_on = None


def upgrade():
    sql_path = Path(__file__).resolve().parents[2] / "supabase" / "migrate_waiter_shift_variant_ids.sql"
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("Downgrade dilakukan manual agar data varian pada log shift tidak hilang")
