-- Tambah kolom kontak pada master supplier agar form "Supplier Baru"
-- pada Purchase Form dapat menyimpan data lengkap.
-- Idempotent: aman dijalankan berulang.

alter table public.master_suppliers
  add column if not exists kontak_person varchar,
  add column if not exists nomor_telp    varchar,
  add column if not exists alamat        text;

-- Cegah duplikasi nama supplier (case-insensitive, abaikan spasi tepi).
-- Dibuat kondisional agar migrasi tidak gagal bila data lama sudah duplikat.
do $migration$
begin
  if not exists (
    select 1
    from public.master_suppliers
    group by lower(btrim(nama_supplier))
    having count(*) > 1
  ) then
    create unique index if not exists master_suppliers_nama_supplier_key
      on public.master_suppliers (lower(btrim(nama_supplier)));
  else
    raise notice 'Index unik nama supplier dilewati: ditemukan nama duplikat.';
  end if;
end
$migration$;

alter table public.master_suppliers enable row level security;
