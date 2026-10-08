create table if not exists public.guest_masters (
  id text primary key,
  name text not null,
  default_rate_percent numeric(5,2) not null default 50,
  is_active boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint guest_masters_name_not_blank check (btrim(name) <> ''),
  constraint guest_masters_rate_range check (default_rate_percent >= 0 and default_rate_percent <= 100)
);

alter table public.appointments
  add column if not exists guest_master_id text,
  add column if not exists guest_master_name text,
  add column if not exists guest_master_rate_percent numeric(5,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_guest_master_rate_range'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_guest_master_rate_range
      check (guest_master_rate_percent is null or (guest_master_rate_percent >= 0 and guest_master_rate_percent <= 100));
  end if;
end
$$;

create index if not exists guest_masters_active_name_idx
  on public.guest_masters (is_active, lower(name))
  where deleted_at is null;

create index if not exists appointments_guest_master_id_idx
  on public.appointments (guest_master_id)
  where guest_master_id is not null and deleted_at is null;

alter table public.guest_masters enable row level security;

drop policy if exists "Staff read guest_masters" on public.guest_masters;
create policy "Staff read guest_masters"
  on public.guest_masters
  for select
  to authenticated
  using (public.is_allowed_staff());

drop policy if exists "Staff insert guest_masters" on public.guest_masters;
create policy "Staff insert guest_masters"
  on public.guest_masters
  for insert
  to authenticated
  with check (public.is_allowed_staff());

drop policy if exists "Staff update guest_masters" on public.guest_masters;
create policy "Staff update guest_masters"
  on public.guest_masters
  for update
  to authenticated
  using (public.is_allowed_staff())
  with check (public.is_allowed_staff());

drop policy if exists "Staff delete guest_masters" on public.guest_masters;
create policy "Staff delete guest_masters"
  on public.guest_masters
  for delete
  to authenticated
  using (public.is_allowed_staff());

grant select, insert, update, delete on public.guest_masters to authenticated;
revoke all on public.guest_masters from anon;

drop trigger if exists touch_version_guest_masters on public.guest_masters;
create trigger touch_version_guest_masters
  before update on public.guest_masters
  for each row execute function public.touch_version();

drop trigger if exists audit_guest_masters on public.guest_masters;
create trigger audit_guest_masters
  after insert or update or delete on public.guest_masters
  for each row execute function public.capture_entity_audit();
