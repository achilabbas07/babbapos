-- Real-time jumlah Open Bill (Warkop Babba).
-- Mengaktifkan Supabase Realtime (postgres_changes) untuk tabel `public.open_bills`
-- agar badge jumlah open bill di sidebar langsung tersinkron ke seluruh perangkat
-- (bill baru, digabung, di-void, atau dibayar) tanpa refresh manual.
--
-- Aman dijalankan berulang kali (idempoten).
--
-- KONTEKS KEAMANAN:
--   `open_bills` mengaktifkan RLS TANPA policy (lihat schema.sql bagian 7),
--   sehingga anon key tidak bisa membaca baris -> event realtime TIDAK terkirim.
--   Migration ini menambahkan SATU policy SELECT read-only khusus `open_bills`
--   agar event realtime sampai ke klien. TIDAK ada policy tulis -> anon tetap
--   tidak bisa mengubah data open bill.
--
--   CATATAN PRIVASI: `open_bills` memuat items_json (rincian pesanan). Bila Anda
--   tidak ingin membuka rincian pesanan ke anon key, LEWATI bagian POLICY di
--   bawah dan andalkan polling berkala (30 detik) sebagai satu-satunya sumber
--   pembaruan badge — fitur badge tetap berfungsi, hanya tidak seketika.

-- 1) Publikasikan tabel ke Realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'open_bills'
     ) then
    execute 'alter publication supabase_realtime add table public.open_bills';
    raise notice 'public.open_bills ditambahkan ke publication supabase_realtime';
  else
    raise notice 'public.open_bills sudah ada (atau publication supabase_realtime tidak ditemukan)';
  end if;
end $$;

-- 2) REPLICA IDENTITY FULL agar payload UPDATE/DELETE membawa seluruh kolom.
alter table public.open_bills replica identity full;

-- 3) Pastikan role realtime (anon/authenticated) hanya boleh MEMBACA tabel.
grant select on table public.open_bills to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.open_bills from anon, authenticated;

-- 4) Policy SELECT read-only (idempoten). Tanpa ini, RLS menolak baris dan
--    event realtime tidak akan pernah sampai ke klien.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'open_bills'
      and policyname = 'open_bills_readonly_realtime'
  ) then
    execute $p$
      create policy "open_bills_readonly_realtime"
        on public.open_bills
        for select
        to anon, authenticated
        using (true)
    $p$;
    raise notice 'policy open_bills_readonly_realtime dibuat';
  else
    raise notice 'policy open_bills_readonly_realtime sudah ada';
  end if;
end $$;

-- VERIFIKASI (jalankan manual setelah migration):
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'open_bills';
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename = 'open_bills';
--   select relreplident from pg_class where oid = 'public.open_bills'::regclass; -- 'f'
