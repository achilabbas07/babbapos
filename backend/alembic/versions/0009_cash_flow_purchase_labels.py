"""Use a descriptive label for cash purchase outflows.

Revision ID: 0009_cash_flow_purchase_labels
Revises: 0008_cash_flow_purchase_outflows
"""
from pathlib import Path

from alembic import op

revision = "0009_cash_flow_purchase_labels"
down_revision = "0008_cash_flow_purchase_outflows"
branch_labels = None
depends_on = None


def upgrade():
    sql_path = Path(__file__).resolve().parents[2] / "supabase" / "migrate_cash_flow_purchase_labels.sql"
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("Downgrade dilakukan manual agar definisi view produksi tidak tertimpa")
