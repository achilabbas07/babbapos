-- Menambahkan kolom nilai surplus stok opname.
--
-- Sebelumnya hanya selisih negatif (kerugian) yang dihitung dan dijurnal.
-- Selisih positif (surplus) diabaikan sehingga persediaan bertambah secara
-- fisik tetapi tidak pernah tercatat di general_ledger, dan beban selisih
-- stok tidak pernah berkurang.
--
-- Kolom gain_value menyimpan nilai rupiah surplus per baris opname, sejajar
-- dengan loss_value untuk kerugian.

alter table public.stock_adjustments
  add column if not exists gain_value numeric(16, 2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_adjustments_gain_value_check'
      and conrelid = 'public.stock_adjustments'::regclass
  ) then
    alter table public.stock_adjustments
      add constraint stock_adjustments_gain_value_check check (gain_value >= 0);
  end if;
end
$$;

comment on column public.stock_adjustments.gain_value is
  'Nilai rupiah surplus stok opname (selisih positif x biaya per satuan).';
