create table if not exists public.stock_adjustments (
  id            bigserial primary key,
  session_id    uuid not null,
  item_id       text not null references public.inventory(id) on update cascade on delete restrict,
  item_name     text not null,
  item_unit     text not null,
  system_qty    numeric(14, 3) not null,
  physical_qty  numeric(14, 3) not null check (physical_qty >= 0),
  difference    numeric(14, 3) not null,
  cost_per_unit numeric(14, 2) not null check (cost_per_unit >= 0),
  loss_value    numeric(16, 2) not null default 0 check (loss_value >= 0),
  notes         text not null default '',
  created_by    text references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.stock_adjustments
  add column if not exists session_id uuid,
  add column if not exists item_id text,
  add column if not exists item_name text,
  add column if not exists item_unit text,
  add column if not exists system_qty numeric(14, 3),
  add column if not exists physical_qty numeric(14, 3),
  add column if not exists difference numeric(14, 3),
  add column if not exists cost_per_unit numeric(14, 2),
  add column if not exists loss_value numeric(16, 2) not null default 0,
  add column if not exists notes text not null default '',
  add column if not exists created_by text,
  add column if not exists created_at timestamptz not null default now();

update public.stock_adjustments
set session_id = gen_random_uuid()
where session_id is null;

create unique index if not exists stock_adjustments_session_item_uidx
  on public.stock_adjustments (session_id, item_id);
create index if not exists stock_adjustments_created_at_idx
  on public.stock_adjustments (created_at desc);

alter table public.stock_adjustments enable row level security;
revoke all on table public.stock_adjustments from public, anon, authenticated;
