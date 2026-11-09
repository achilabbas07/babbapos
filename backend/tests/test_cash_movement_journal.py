"""
Regresi kas keluar (POST /api/shifts/cash-movements, type=out).

Bug yang dijaga di sini: trigger public.copy_cash_to_expense_table() menulis
dua kaki jurnal (debit beban + kredit kas) ke general_ledger TANPA entry_id,
sehingga masing-masing baris mendapat gen_random_uuid() sendiri. Constraint
trigger deferred general_ledger_balance_guard memeriksa keseimbangan per
entry_id saat COMMIT dan menolak dua jurnal satu-sisi itu
(CheckViolationError -> HTTP 500).
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from shifts import MovementIn

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "supabase"
    / "migrate_cash_movement_journal_entry_id.sql"
)


def _function_body() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_trigger_writes_one_shared_entry_id_for_both_journal_legs():
    body = _function_body()
    assert "v_entry_id     uuid := gen_random_uuid()" in body
    # Kedua baris insert wajib memakai v_entry_id yang sama, bukan DEFAULT.
    insert_values = body.split("values", 1)[1]
    assert insert_values.count("v_entry_id") == 2


def test_movement_payload_accepts_active_shift_id_and_rejects_non_positive_amount():
    movement = MovementIn(type="out", amount=5000, note="beli es batu", expense_category_id=16, shift_id="SHIFT-1")
    assert movement.shift_id == "SHIFT-1"
    assert movement.expense_category_id == 16

    with pytest.raises(ValidationError):
        MovementIn(type="out", amount=0, note="nol", expense_category_id=16)

    with pytest.raises(ValidationError):
        MovementIn(type="in", amount=1000, note="")
