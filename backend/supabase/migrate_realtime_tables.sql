-- Real-time denah meja (Warkop Babba).
-- Mengaktifkan Supabase Realtime (postgres_changes) untuk tabel `public.tables`
-- agar perubahan status meja (occupied/available/paid/reserved) langsung
-- tersinkron ke seluruh perangkat tanpa refresh manual.
--
-- Aman dijalankan berulang kali (idempoten).
--
-- KONTEKS KEAMANAN:
--   `tables` mengaktifkan RLS TANPA policy (lihat schema.sql bagian 7), sehingga
--   anon key tidak bisa membaca baris -> event realtime TIDAK terkirim.
--   Migration ini menambahkan SATU policy SELECT read-only khusus `tables`
--   (data operasional: nama meja, area, status, ringkasan order). TIDAK ada
--   policy tulis -> anon tetap tidak bisa mengubah data meja.
--   Bila Anda lebih memilih realtime tanpa membuka akses baca anon sama sekali,
--   lewati bagian POLICY di bawah dan gunakan endpoint server ber-token.

-- 1) Publikasikan tabel ke Realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'tables'
     ) then
    execute 'alter publication supabase_realtime add table public.tables';
    raise notice 'public.tables ditambahkan ke publication supabase_realtime';
  else
    raise notice 'public.tables sudah ada (atau publication supabase_realtime tidak ditemukan)';
  end if;
end $$;

-- 2) REPLICA IDENTITY FULL agar payload UPDATE/DELETE membawa seluruh kolom
--    (termasuk `status` dan `orderData`) sehingga state frontend bisa diperbarui
--    dengan tepat tanpa harus menunggu pemuatan ulang.
alter table public.tables replica identity full;

-- 3) Pastikan role realtime (anon/authenticated) hanya boleh MEMBACA tabel.
grant select on table public.tables to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.tables from anon, authenticated;

-- 4) Policy SELECT read-only (idempoten). Tanpa ini, RLS menolak baris dan
--    event realtime tidak akan pernah sampai ke klien.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tables'
      and policyname = 'tables_readonly_realtime'
  ) then
    execute $p$
      create policy "tables_readonly_realtime"
        on public.tables
        for select
        to anon, authenticated
        using (true)
    $p$;
    raise notice 'policy tables_readonly_realtime dibuat';
  else
    raise notice 'policy tables_readonly_realtime sudah ada';
  end if;
end $$;

-- VERIFIKASI (jalankan manual setelah migration):
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'tables';
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename = 'tables';
--   select relreplident from pg_class where oid = 'public.tables'::regclass; -- 'f'
