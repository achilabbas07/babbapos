"""Idempotency: client_request_id column on transactions

Revision ID: 0014_client_request_id
Revises: 0013_supplier_contacts
Create Date: 2026-11-22
"""
from pathlib import Path

from alembic import op

revision = "0014_client_request_id"
down_revision = "0013_supplier_contacts"
branch_labels = None
depends_on = None


def upgrade():
    sql_path = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrate_client_request_id.sql"
    )
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError(
        "Downgrade dilakukan manual agar kunci idempotensi transaksi produksi "
        "tidak terhapus"
    )
