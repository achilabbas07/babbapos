"""Supplier contact fields for the purchase form.

Revision ID: 0013_supplier_contacts
Revises: 0012_split_payments
Create Date: 2026-11-09
"""
from pathlib import Path

from alembic import op

revision = "0013_supplier_contacts"
down_revision = "0012_split_payments"
branch_labels = None
depends_on = None


def upgrade():
    sql_path = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrate_supplier_contacts.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError(
        "Downgrade dilakukan manual agar data kontak supplier tidak hilang"
    )
