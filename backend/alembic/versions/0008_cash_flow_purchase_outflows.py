"""Include cash inventory purchases in the cash flow statement.

Revision ID: 0008_cash_flow_purchase_outflows
Revises: 0007_purchase_account_payable
"""
from pathlib import Path

from alembic import op

revision = "0008_cash_flow_purchase_outflows"
down_revision = "0007_purchase_account_payable"
branch_labels = None
depends_on = None


def upgrade():
    sql_path = Path(__file__).resolve().parents[2] / "supabase" / "migrate_cash_flow_purchase_outflows.sql"
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("Downgrade dilakukan manual agar definisi view produksi tidak tertimpa")
