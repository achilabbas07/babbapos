-- =====================================================================
-- Kedai POS (F&B) — Skema PostgreSQL untuk Supabase
-- Jalankan di Supabase Dashboard -> SQL Editor (atau via Transaction Pooler)
-- Harga/uang dalam Rupiah: INTEGER/BIGINT. Qty bahan: NUMERIC (gram, ml, pcs).
-- =====================================================================

-- ---------- 1. Master ----------
create table if not exists users (
  id          text primary key,
  name        text not null,
  pin         text not null,                       -- bcrypt hash, bukan PIN mentah
  role        text not null check (role in ('admin','kasir','waiter')),
  created_at  timestamptz not null default now()
);

create table if not exists inventory (
  id             text primary key,
  name           text not null,
  type           text not null default 'Bahan Baku', -- Bahan Baku | Kemasan | Barang Jadi | Consumable
  stock          numeric(14,3) not null default 0,  -- boleh minus (penjualan tetap jalan saat stok habis)
  unit           text not null,                      -- gram | ml | pcs | kg
  cost_per_unit  numeric(14,2) not null default 0 check (cost_per_unit >= 0),
  min_stock      numeric(14,3) not null default 0
);

create table if not exists products (
  id            text primary key,
  name          text not null,
  category      text not null,
  price         integer not null check (price >= 0),
  price_ojol    integer not null default 0 check (price_ojol >= 0),  -- 0 = pakai harga normal
  type          text not null default 'both' check (type in ('dine_in','takeaway','both')),
  image         text not null default '',
  "inventoryId" text references inventory(id) on update cascade on delete restrict, -- barang jadi tanpa resep
  hpp           numeric(14,2) not null default 0
);
create index if not exists products_inventory_idx on products("inventoryId");

create table if not exists recipes (
  "productId"   text not null references products(id)  on update cascade on delete cascade,
  "inventoryId" text not null references inventory(id) on update cascade on delete restrict,
  qty_needed    numeric(14,3) not null check (qty_needed > 0),  -- per 1 porsi
  primary key ("productId", "inventoryId")
);
create index if not exists recipes_inventory_idx on recipes("inventoryId");

create table if not exists customers (
  id           text primary key,
  name         text not null,
  wa           text not null default '',
  email        text not null default '',
  points       integer not null default 0,
  visits       integer not null default 0,
  total_spent  bigint  not null default 0
);

create table if not exists tables (
  id           text primary key,
  name         text not null,
  area         text not null,
  status       text not null default 'available' check (status in ('available','occupied','paid','reserved')),
  "orderData"  jsonb,                                -- {openBillId, customerName, waiterName, total, itemCount, startTime}
  "open_bill_id" text,
  kind         text not null default 'table' check (kind in ('table','fixture')),
  x            integer,
  y            integer
);
create index if not exists tables_open_bill_idx on tables("open_bill_id");

-- ---------- 2. Operasional ----------
create table if not exists open_bills (
  id              text primary key,
  "timestamp"     timestamptz not null default now(),
  type            text not null check (type in ('Dine In','Takeaway')),
  "customerName"  text not null default '',
  total           integer not null default 0,
  items_json      jsonb not null default '[]'::jsonb,   -- [{productId, productName, qty, price, hpp, notes, subtotal}]
  "userId"        text references users(id) on delete set null,
  "userName"      text not null default '',
  "waiterName"    text not null default '',
  "waiterId"      text references users(id) on delete set null,
  "tableId"       text references tables(id) on delete set null,
  "customerId"    text references customers(id) on delete set null,
  "queueNumber"   text
);
create index if not exists open_bills_table_idx on open_bills("tableId");
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tables'::regclass
      and conname = 'tables_open_bill_id_fkey'
  ) then
    alter table public.tables
      add constraint tables_open_bill_id_fkey
      foreign key ("open_bill_id") references public.open_bills(id) on delete set null
      deferrable initially deferred;
  end if;
end;
$$;

create table if not exists transactions (
  id            text primary key,
  date          timestamptz not null default now(),
  "orderTime"   timestamptz,
  type          text not null check (type in ('Dine In','Takeaway','Walk In','Ojek Online')),
  method        text not null check (method in ('Cash','QRIS','Card','Debit')),
  "tableId"     text references tables(id) on delete set null,
  "customerId"  text references customers(id) on delete set null,
  total         integer not null check (total >= 0),
  items_json    jsonb not null,                       -- snapshot harga & hpp saat jual
  "userId"      text references users(id) on delete set null,
  "userName"    text not null default '',
  "tableName"   text not null default '',
  "customerName" text not null default '',
  "cashGiven"   integer not null default 0,
  change        integer not null default 0,
  "waiterName"  text not null default '',
  "waiterId"    text references users(id) on delete set null,
  "shiftId"     text,
  "queueNumber" text,
  payments      jsonb not null default '[]'::jsonb  -- rincian multi-pembayaran (split payment)
);
create index if not exists transactions_date_idx on transactions(date);
create index if not exists transactions_customer_idx on transactions("customerId");

create table if not exists master_suppliers (
  id            bigserial primary key,
  nama_supplier  varchar not null,
  kontak_person  varchar,
  nomor_telp     varchar,
  alamat         text
);
do $migration$
begin
  if not exists (
    select 1
    from master_suppliers
    group by lower(btrim(nama_supplier))
    having count(*) > 1
  ) then
    create unique index if not exists master_suppliers_nama_supplier_key
      on master_suppliers (lower(btrim(nama_supplier)));
  end if;
end
$migration$;

create table if not exists purchases (
  id                  text primary key,
  date                timestamptz not null default now(),
  supplier            text not null,
  supplier_id         bigint references master_suppliers(id),
  items_json          jsonb not null,                         -- [{inventoryId, name, unit, qty, cost_per_unit, subtotal}]
  total_cost          bigint not null default 0,
  metode_pembayaran   text not null default 'cash' check (metode_pembayaran in ('cash', 'credit')),
  status_pembayaran   text not null default 'lunas' check (status_pembayaran in ('belum_lunas', 'lunas')),
  sisa_utang          bigint not null default 0 check (sisa_utang >= 0),
  "userId"            text references users(id) on delete set null,
  "userName"          text not null default ''
);
create index if not exists purchases_date_idx on purchases(date);
create index if not exists purchases_supplier_id_idx on purchases(supplier_id);
create index if not exists purchases_unpaid_idx on purchases(date desc) where status_pembayaran = 'belum_lunas';

create table if not exists supplier_payments (
  id                  uuid primary key default gen_random_uuid(),
  purchase_id         text not null references purchases(id) on delete restrict,
  sumber_dana_akun    varchar not null check (sumber_dana_akun in ('1-10001', '1-10002')),
  jumlah_bayar        numeric(16, 2) not null check (jumlah_bayar > 0),
  created_at          timestamptz not null default now()
);
create index if not exists supplier_payments_purchase_idx
  on supplier_payments (purchase_id, created_at desc);
alter table supplier_payments enable row level security;
revoke all on table supplier_payments from public, anon, authenticated;

create table if not exists expenses (
  id           text primary key,
  date         timestamptz not null default now(),
  category     text not null,
  description  text not null default '',
  amount       integer not null check (amount > 0),
  "userId"     text references users(id) on delete set null,
  "userName"   text not null default ''
);
create index if not exists expenses_date_idx on expenses(date);

-- ---------- 3. HPP otomatis dari resep ----------
create or replace function recalc_hpp(p_product text) returns void language plpgsql as $$
declare v_hpp numeric; v_inv text;
begin
  select coalesce(sum(r.qty_needed * i.cost_per_unit), 0) into v_hpp
    from recipes r join inventory i on i.id = r."inventoryId" where r."productId" = p_product;
  if exists (select 1 from recipes where "productId" = p_product) then
    update products set hpp = round(v_hpp, 2) where id = p_product;
  else
    select "inventoryId" into v_inv from products where id = p_product;
    if v_inv is not null then
      update products set hpp = (select cost_per_unit from inventory where id = v_inv) where id = p_product;
    end if;
  end if;
end $$;

create or replace function trg_recipes_hpp() returns trigger language plpgsql as $$
begin
  perform recalc_hpp(coalesce(new."productId", old."productId"));
  return null;
end $$;
drop trigger if exists recipes_hpp on recipes;
create trigger recipes_hpp after insert or update or delete on recipes for each row execute function trg_recipes_hpp();

create or replace function trg_inventory_cost_hpp() returns trigger language plpgsql as $$
declare p text;
begin
  for p in select "productId" from recipes where "inventoryId" = new.id
           union select id from products where "inventoryId" = new.id loop
    perform recalc_hpp(p);
  end loop;
  return null;
end $$;
drop trigger if exists inventory_cost_hpp on inventory;
create trigger inventory_cost_hpp after update of cost_per_unit on inventory for each row execute function trg_inventory_cost_hpp();

-- Checkout and stock reduction are handled atomically by proses_checkout_dan_stok_fleksibel.
drop trigger if exists transactions_consume_stock on transactions;
drop function if exists trg_transactions_consume_stock();

-- ---------- 5. Stok bertambah & biaya diperbarui saat pembelian ----------
create or replace function trg_purchases_add_stock() returns trigger language plpgsql as $$
declare it jsonb;
begin
  for it in select * from jsonb_array_elements(new.items_json) loop
    update inventory set stock = stock + (it->>'qty')::numeric,
                         cost_per_unit = coalesce((it->>'cost_per_unit')::numeric, cost_per_unit)
      where id = it->>'inventoryId';
  end loop;
  return new;
end $$;
drop trigger if exists purchases_add_stock on purchases;
create trigger purchases_add_stock after insert on purchases for each row execute function trg_purchases_add_stock();

-- ---------- 6. Loyalitas pelanggan ----------
create or replace function trg_transactions_loyalty() returns trigger language plpgsql as $$
begin
  if new."customerId" is not null then
    update customers set visits = visits + 1, total_spent = total_spent + new.total,
                         points = points + (new.total / 10000)
      where id = new."customerId";
  end if;
  return new;
end $$;
drop trigger if exists transactions_loyalty on transactions;
create trigger transactions_loyalty after insert on transactions for each row execute function trg_transactions_loyalty();

-- ---------- 7. Keamanan: anon key TIDAK boleh baca/tulis langsung ----------
-- RLS aktif tanpa policy = akses lewat anon key ditolak. Backend memakai koneksi database (role postgres) yang melewati RLS.
alter table users        enable row level security;
alter table inventory    enable row level security;
alter table products     enable row level security;
alter table recipes      enable row level security;
alter table customers    enable row level security;
alter table tables       enable row level security;
alter table open_bills   enable row level security;
alter table transactions enable row level security;
alter table purchases    enable row level security;
alter table master_suppliers enable row level security;
alter table expenses     enable row level security;

-- ---------- 8. Tabel tambahan aplikasi (shift, kas, void, target, sistem) ----------
create table if not exists shifts (
  id              text primary key,
  "userId"        text references users(id) on delete set null,
  "userName"      text not null default '',
  "openedAt"      timestamptz not null default now(),
  "openingCash"   bigint not null default 0,
  status          text not null default 'open' check (status in ('open','closed')),
  "closedAt"      timestamptz,
  "countedCash"   bigint,
  "expectedCash"  bigint,
  difference      bigint,
  "cashSales"     bigint not null default 0,
  "nonCashSales"  bigint not null default 0,
  "cashIn"        bigint not null default 0,
  "cashOut"       bigint not null default 0,
  "trxCount"      integer not null default 0,
  note            text not null default ''
);
alter table transactions add constraint transactions_shift_fk foreign key ("shiftId") references shifts(id) on delete set null;

create table if not exists cash_movements (
  id          text primary key,
  "shiftId"   text not null references shifts(id) on delete cascade,
  "userId"    text references users(id) on delete set null,
  "userName"  text not null default '',
  type        text not null check (type in ('in','out')),
  amount      bigint not null check (amount > 0),
  note        text not null default '',
  "timestamp" timestamptz not null default now()
);

create table if not exists void_logs (
  id              text primary key,
  "billId"        text not null,
  "timestamp"     timestamptz not null default now(),
  "tableId"       text references tables(id) on delete set null,
  total           integer not null default 0,
  items_json      jsonb not null default '[]'::jsonb,
  reason          text not null default '',
  "requestedBy"   text not null default '',
  "authorizedBy"  text not null default ''
);

create table if not exists sales_targets (
  id              text primary key,
  name            text not null,
  "productIds"    jsonb not null default '[]'::jsonb,
  "productNames"  jsonb not null default '[]'::jsonb,
  "targetQty"     integer not null check ("targetQty" > 0),
  "waiterId"      text references users(id) on delete cascade,
  "waiterName"    text not null default ''
);

create table if not exists waiter_shifts (
  id          text primary key,
  "userId"    text references users(id) on delete set null,
  "userName"  text not null default '',
  "openedAt"  timestamptz not null default now(),
  status      text not null default 'open' check (status in ('open','closed')),
  "closedAt"  timestamptz,
  results     jsonb not null default '[]'::jsonb,
  report      jsonb
);
create table if not exists order_logs (
  id             text primary key,
  "timestamp"    timestamptz not null default now(),
  "waiterId"     text,
  "waiterName"   text not null default '',
  "productId"    text,
  "productName"  text not null default '',
  "variantId"    bigint,
  "variantName"  text not null default '',
  qty            integer not null,
  source         text not null default '',
  "refId"        text,
  "shiftId"      text references waiter_shifts(id) on delete set null
);
create index if not exists order_logs_shift_idx on order_logs("shiftId");

create table if not exists counters (id text primary key, seq bigint not null default 0);
create table if not exists meta (id text primary key);
create table if not exists app_profile (
  id              integer primary key check (id = 1),
  app_name        text not null default '',
  logo_url        text not null default '',
  address         text not null default '',
  phone           text not null default '',
  additional_info text not null default '',
  "printerDapur"  text not null default '',
  "printerKasir"  text not null default '',
  "cetakOtomatis" boolean not null default false
);

alter table shifts         enable row level security;
alter table cash_movements enable row level security;
alter table void_logs      enable row level security;
alter table sales_targets  enable row level security;
alter table waiter_shifts  enable row level security;
alter table order_logs     enable row level security;
alter table counters       enable row level security;
alter table meta           enable row level security;
alter table app_profile    enable row level security;
