create table if not exists public.app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create extension if not exists pgcrypto with schema extensions;

alter table public.app_state enable row level security;

drop policy if exists "Public read app state" on public.app_state;
create policy "Public read app state"
  on public.app_state
  for select
  using (true);

drop policy if exists "Public insert app state" on public.app_state;
create policy "Public insert app state"
  on public.app_state
  for insert
  with check (true);

drop policy if exists "Public update app state" on public.app_state;
create policy "Public update app state"
  on public.app_state
  for update
  using (true)
  with check (true);

create table if not exists public.app_state_history (
  history_id bigint generated always as identity primary key,
  app_state_id text not null,
  data jsonb not null,
  previous_updated_at timestamptz,
  saved_at timestamptz not null default now()
);

create index if not exists app_state_history_app_state_id_saved_at_idx
  on public.app_state_history (app_state_id, saved_at desc);

alter table public.app_state_history enable row level security;

drop policy if exists "Public read app state history" on public.app_state_history;
create policy "Public read app state history"
  on public.app_state_history
  for select
  using (true);

create or replace function public.capture_app_state_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.data is distinct from new.data then
    insert into public.app_state_history (app_state_id, data, previous_updated_at)
    values (old.id, old.data, old.updated_at);
  end if;

  return new;
end;
$$;

drop trigger if exists capture_app_state_history_before_update on public.app_state;
create trigger capture_app_state_history_before_update
  before update on public.app_state
  for each row
  execute function public.capture_app_state_history();

create table if not exists public.staff_profiles (
  id text primary key default extensions.gen_random_uuid()::text,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  display_name text not null,
  teacher text not null default 'Другое',
  role text not null default 'teacher',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_profiles_teacher_check check (teacher in ('Алина', 'Настя', 'Другое')),
  constraint staff_profiles_role_check check (role in ('admin', 'teacher'))
);

create unique index if not exists staff_profiles_email_normalized_key
  on public.staff_profiles (email_normalized);

-- Assign staff explicitly on a new project; no personal accounts are seeded here.

alter table public.staff_profiles enable row level security;

drop policy if exists "Authenticated read staff profiles" on public.staff_profiles;
create policy "Authenticated read staff profiles"
  on public.staff_profiles
  for select
  to authenticated
  using (true);

grant select on public.staff_profiles to authenticated;

create or replace function public.current_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function public.is_allowed_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles
    where email_normalized = public.current_auth_email()
      and is_active = true
  )
$$;

create or replace function public.is_staff_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles
    where email_normalized = public.current_auth_email()
      and role = 'admin'
      and is_active = true
  )
$$;

drop policy if exists "Public insert app state" on public.app_state;
drop policy if exists "Staff insert app state" on public.app_state;
create policy "Staff insert app state"
  on public.app_state
  for insert
  to authenticated
  with check (public.is_allowed_staff());

drop policy if exists "Public update app state" on public.app_state;
drop policy if exists "Staff update app state" on public.app_state;
create policy "Staff update app state"
  on public.app_state
  for update
  to authenticated
  using (public.is_allowed_staff())
  with check (public.is_allowed_staff());

grant select on public.app_state to anon, authenticated;
grant insert, update on public.app_state to authenticated;
revoke insert, update on public.app_state from anon;

drop policy if exists "Public read app state history" on public.app_state_history;
drop policy if exists "Admin read app state history" on public.app_state_history;
create policy "Admin read app state history"
  on public.app_state_history
  for select
  to authenticated
  using (public.is_staff_admin());

grant select on public.app_state_history to authenticated;
revoke select on public.app_state_history from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-photos',
  'deal-photos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read deal photos" on storage.objects;
create policy "Public read deal photos"
  on storage.objects
  for select
  using (bucket_id = 'deal-photos');

drop policy if exists "Public insert deal photos" on storage.objects;
drop policy if exists "Staff insert deal photos" on storage.objects;
create policy "Staff insert deal photos"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'deal-photos' and public.is_allowed_staff());

drop policy if exists "Public update deal photos" on storage.objects;
drop policy if exists "Staff update deal photos" on storage.objects;
create policy "Staff update deal photos"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'deal-photos' and public.is_allowed_staff())
  with check (bucket_id = 'deal-photos' and public.is_allowed_staff());

drop policy if exists "Public delete deal photos" on storage.objects;
drop policy if exists "Staff delete deal photos" on storage.objects;
create policy "Staff delete deal photos"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'deal-photos' and public.is_allowed_staff());

create or replace function public.touch_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.version = coalesce(old.version, 0) + 1;
  return new;
end;
$$;

create table if not exists public.clients (
  id text primary key,
  name text not null,
  phone text,
  whatsapp text,
  telegram text,
  instagram text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

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

create table if not exists public.appointments (
  id text primary key,
  client_id text not null,
  client_name text not null,
  phone text,
  whatsapp text,
  telegram text,
  instagram text,
  appointment_date date,
  appointment_time text not null,
  duration_minutes integer not null default 150,
  people_count integer,
  service_type text not null,
  item text not null,
  amount numeric not null default 0,
  paid boolean not null default false,
  cash boolean not null default true,
  teacher text not null default 'Другое',
  source_teacher text,
  guest_master_id text,
  guest_master_name text,
  guest_master_rate_percent numeric(5,2),
  status text not null default 'Бронь',
  comment text,
  deal_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create table if not exists public.deals (
  id text primary key,
  appointment_id text not null,
  client_id text not null,
  client_name text not null,
  visit_date date,
  teacher text not null default 'Другое',
  status text not null default 'Бронь',
  expected_ready_date date,
  next_step text not null default '',
  amount numeric not null default 0,
  item text not null,
  comment text,
  history jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create table if not exists public.payments (
  id text primary key,
  appointment_id text,
  payment_date date,
  month text not null,
  type text not null,
  client_name text not null,
  status text not null,
  amount numeric not null default 0,
  teacher text not null default 'Другое',
  source_teacher text,
  service text not null,
  cash boolean not null default true,
  source text not null default '',
  comment text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create table if not exists public.expenses (
  id text primary key,
  expense_date date,
  month text not null,
  paid_by text not null default '',
  category text not null,
  subcategory text not null default '',
  description text not null default '',
  amount numeric not null default 0,
  type text not null default 'Факт',
  source text not null default '',
  comment text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create table if not exists public.fixed_expenses (
  id text primary key,
  category text not null,
  description text not null default '',
  monthly_amount numeric not null default 0,
  comment text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create table if not exists public.certificates (
  id text primary key,
  number text not null,
  purchase_payment_id text,
  client_name text not null,
  purchase_date date,
  expires_at date,
  amount numeric not null default 0,
  teacher text,
  used_at date,
  comment text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create table if not exists public.appointment_photos (
  id text primary key,
  appointment_id text not null,
  path text not null,
  url text not null,
  uploaded_at timestamptz not null,
  width integer not null default 0,
  height integer not null default 0,
  size integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

alter table public.appointments alter column appointment_date drop not null;
alter table public.deals alter column visit_date drop not null;
alter table public.payments alter column payment_date drop not null;
alter table public.expenses alter column expense_date drop not null;
alter table public.certificates alter column purchase_date drop not null;
alter table public.certificates alter column expires_at drop not null;

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

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_snapshots (
  id bigint generated always as identity primary key,
  snapshot_date date not null,
  source text not null default 'manual',
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (snapshot_date, source)
);

create or replace function public.capture_entity_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  entity_id text;
begin
  entity_id = coalesce(new.id, old.id);

  if tg_op = 'INSERT' then
    insert into public.audit_log (entity_type, entity_id, action, new_data)
    values (tg_table_name, entity_id, 'insert', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (entity_type, entity_id, action, old_data, new_data)
    values (tg_table_name, entity_id, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (entity_type, entity_id, action, old_data)
    values (tg_table_name, entity_id, 'delete', to_jsonb(old));
    return old;
  end if;

  return null;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients',
    'appointments',
    'deals',
    'payments',
    'expenses',
    'fixed_expenses',
    'certificates',
    'appointment_photos'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists "Public read %1$s" on public.%1$I', table_name);
    execute format('create policy "Public read %1$s" on public.%1$I for select using (true)', table_name);

    execute format('drop policy if exists "Public insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "Staff insert %1$s" on public.%1$I', table_name);
    execute format('create policy "Staff insert %1$s" on public.%1$I for insert to authenticated with check (public.is_allowed_staff())', table_name);

    execute format('drop policy if exists "Public update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "Staff update %1$s" on public.%1$I', table_name);
    execute format('create policy "Staff update %1$s" on public.%1$I for update to authenticated using (public.is_allowed_staff()) with check (public.is_allowed_staff())', table_name);

    execute format('drop policy if exists "Staff delete %1$s" on public.%1$I', table_name);
    execute format('create policy "Staff delete %1$s" on public.%1$I for delete to authenticated using (public.is_allowed_staff())', table_name);

    execute format('grant select on public.%1$I to anon, authenticated', table_name);
    execute format('grant insert, update, delete on public.%1$I to authenticated', table_name);
    execute format('revoke insert, update, delete on public.%1$I from anon', table_name);

    execute format('drop trigger if exists touch_version_%1$s on public.%1$I', table_name);
    execute format('create trigger touch_version_%1$s before update on public.%1$I for each row execute function public.touch_version()', table_name);

    execute format('drop trigger if exists audit_%1$s on public.%1$I', table_name);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.capture_entity_audit()', table_name);
  end loop;
end;
$$;

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

alter table public.audit_log enable row level security;
drop policy if exists "Public read audit log" on public.audit_log;
drop policy if exists "Admin read audit log" on public.audit_log;
create policy "Admin read audit log"
  on public.audit_log
  for select
  to authenticated
  using (public.is_staff_admin());

grant select on public.audit_log to authenticated;
revoke select on public.audit_log from anon;

alter table public.daily_snapshots enable row level security;
drop policy if exists "Public read daily snapshots" on public.daily_snapshots;
drop policy if exists "Admin read daily snapshots" on public.daily_snapshots;
create policy "Admin read daily snapshots"
  on public.daily_snapshots
  for select
  to authenticated
  using (public.is_staff_admin());

drop policy if exists "Public insert daily snapshots" on public.daily_snapshots;
drop policy if exists "Admin insert daily snapshots" on public.daily_snapshots;
create policy "Admin insert daily snapshots"
  on public.daily_snapshots
  for insert
  to authenticated
  with check (public.is_staff_admin());

drop policy if exists "Public update daily snapshots" on public.daily_snapshots;
drop policy if exists "Admin update daily snapshots" on public.daily_snapshots;
create policy "Admin update daily snapshots"
  on public.daily_snapshots
  for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

grant select, insert, update on public.daily_snapshots to authenticated;
revoke select, insert, update on public.daily_snapshots from anon;

-- Memberships and atomic redemptions
create table if not exists public.memberships (
  id text primary key,
  client_id text not null references public.clients(id),
  client_name text not null,
  phone text,
  whatsapp text,
  telegram text,
  instagram text,
  name text not null,
  kind text not null,
  purchase_payment_id text references public.payments(id),
  purchase_date date not null,
  expires_at date not null,
  purchase_amount numeric(12,2) not null default 0,
  initial_sessions integer,
  initial_balance numeric(12,2),
  allowed_service_types text[] not null default '{}'::text[],
  comment text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint memberships_name_not_blank check (btrim(name) <> ''),
  constraint memberships_kind_check check (kind in ('sessions', 'balance', 'unlimited')),
  constraint memberships_purchase_amount_check check (purchase_amount >= 0),
  constraint memberships_date_order_check check (expires_at >= purchase_date),
  constraint memberships_kind_value_check check (
    (kind = 'sessions' and initial_sessions is not null and initial_sessions > 0 and initial_balance is null)
    or (kind = 'balance' and initial_balance is not null and initial_balance > 0 and initial_sessions is null)
    or (kind = 'unlimited' and initial_sessions is null and initial_balance is null)
  )
);

create table if not exists public.membership_redemptions (
  id text primary key,
  membership_id text not null references public.memberships(id),
  appointment_id text not null references public.appointments(id),
  visit_date date not null,
  redeemed_at timestamptz not null default now(),
  reversed_at timestamptz,
  sessions_used integer not null default 0,
  balance_used numeric(12,2) not null default 0,
  allocated_value numeric(12,2) not null default 0,
  teacher text not null default 'Другое',
  guest_master_id text,
  guest_master_name text,
  guest_master_rate_percent numeric(5,2),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint membership_redemptions_appointment_key unique (appointment_id),
  constraint membership_redemptions_nonnegative_check check (
    sessions_used >= 0 and balance_used >= 0 and allocated_value >= 0
  ),
  constraint membership_redemptions_teacher_check check (teacher in ('Алина', 'Настя', 'Другое')),
  constraint membership_redemptions_rate_check check (
    guest_master_rate_percent is null
    or (guest_master_rate_percent >= 0 and guest_master_rate_percent <= 100)
  )
);

alter table public.appointments
  add column if not exists payment_method text not null default 'cash',
  add column if not exists membership_id text references public.memberships(id),
  add column if not exists membership_name text,
  add column if not exists membership_charge_amount numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_payment_method_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_payment_method_check
      check (payment_method in ('cash', 'membership'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_membership_charge_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_membership_charge_check
      check (membership_charge_amount is null or membership_charge_amount >= 0);
  end if;
end
$$;

create index if not exists memberships_client_active_idx
  on public.memberships (client_id, expires_at desc)
  where deleted_at is null;

create index if not exists memberships_status_dates_idx
  on public.memberships (expires_at, kind)
  where deleted_at is null;

create index if not exists membership_redemptions_membership_active_idx
  on public.membership_redemptions (membership_id, visit_date desc)
  where deleted_at is null and reversed_at is null;

create index if not exists appointments_membership_id_idx
  on public.appointments (membership_id)
  where membership_id is not null and deleted_at is null;

alter table public.memberships enable row level security;
alter table public.membership_redemptions enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['memberships', 'membership_redemptions']
  loop
    execute format('drop policy if exists "Public read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "Staff read %1$s" on public.%1$I', table_name);
    execute format('create policy "Staff read %1$s" on public.%1$I for select to authenticated using (public.is_allowed_staff())', table_name);

    execute format('drop policy if exists "Staff insert %1$s" on public.%1$I', table_name);
    execute format('create policy "Staff insert %1$s" on public.%1$I for insert to authenticated with check (public.is_allowed_staff())', table_name);

    execute format('drop policy if exists "Staff update %1$s" on public.%1$I', table_name);
    execute format('create policy "Staff update %1$s" on public.%1$I for update to authenticated using (public.is_allowed_staff()) with check (public.is_allowed_staff())', table_name);

    execute format('drop policy if exists "Staff delete %1$s" on public.%1$I', table_name);
    execute format('create policy "Staff delete %1$s" on public.%1$I for delete to authenticated using (public.is_allowed_staff())', table_name);

    execute format('grant select, insert, update, delete on public.%1$I to authenticated', table_name);
    execute format('revoke all on public.%1$I from anon', table_name);

    execute format('drop trigger if exists touch_version_%1$s on public.%1$I', table_name);
    execute format('create trigger touch_version_%1$s before update on public.%1$I for each row execute function public.touch_version()', table_name);

    execute format('drop trigger if exists audit_%1$s on public.%1$I', table_name);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.capture_entity_audit()', table_name);
  end loop;
end
$$;

create or replace function public.set_membership_appointment_status(
  p_appointment_id text,
  p_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_appointment public.appointments%rowtype;
  v_membership public.memberships%rowtype;
  v_redemption public.membership_redemptions%rowtype;
  v_sessions_used integer := 0;
  v_balance_used numeric(12,2) := 0;
  v_allocated_used numeric(12,2) := 0;
  v_charge numeric(12,2) := 0;
  v_allocated numeric(12,2) := 0;
begin
  if not public.is_allowed_staff() then
    raise exception 'Недостаточно прав для изменения абонемента';
  end if;

  select * into v_appointment
  from public.appointments
  where id = p_appointment_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Запись не найдена';
  end if;

  if v_appointment.payment_method <> 'membership' or v_appointment.membership_id is null then
    raise exception 'К записи не привязан абонемент';
  end if;

  if p_status = 'Бронь' then
    update public.membership_redemptions
    set reversed_at = now(), deleted_at = null
    where appointment_id = p_appointment_id
      and reversed_at is null;

    update public.appointments
    set status = p_status, paid = false, cash = false
    where id = p_appointment_id;

    return jsonb_build_object('redemption', null, 'status', p_status);
  end if;

  select * into v_redemption
  from public.membership_redemptions
  where appointment_id = p_appointment_id
  for update;

  if found and v_redemption.reversed_at is null and v_redemption.deleted_at is null then
    update public.appointments
    set status = p_status, paid = true, cash = false
    where id = p_appointment_id;
    return jsonb_build_object('redemption', to_jsonb(v_redemption), 'status', p_status);
  end if;

  select * into v_membership
  from public.memberships
  where id = v_appointment.membership_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Абонемент не найден';
  end if;

  if v_appointment.appointment_date is null then
    raise exception 'У записи не указана дата';
  end if;

  if v_appointment.appointment_date < v_membership.purchase_date then
    raise exception 'Дата занятия раньше даты продажи абонемента';
  end if;

  if v_appointment.appointment_date > v_membership.expires_at then
    raise exception 'Срок действия абонемента истек';
  end if;

  select
    coalesce(sum(sessions_used), 0),
    coalesce(sum(balance_used), 0),
    coalesce(sum(allocated_value), 0)
  into v_sessions_used, v_balance_used, v_allocated_used
  from public.membership_redemptions
  where membership_id = v_membership.id
    and reversed_at is null
    and deleted_at is null
    and appointment_id <> p_appointment_id;

  if v_membership.kind = 'sessions' then
    if v_sessions_used >= v_membership.initial_sessions then
      raise exception 'В абонементе не осталось занятий';
    end if;
    v_sessions_used := 1;
    v_balance_used := 0;
    if v_membership.initial_sessions - (
      select coalesce(sum(sessions_used), 0)
      from public.membership_redemptions
      where membership_id = v_membership.id and reversed_at is null and deleted_at is null
        and appointment_id <> p_appointment_id
    ) = 1 then
      v_allocated := greatest(0, v_membership.purchase_amount - v_allocated_used);
    else
      v_allocated := round(v_membership.purchase_amount / v_membership.initial_sessions, 2);
    end if;
  elsif v_membership.kind = 'balance' then
    v_charge := coalesce(v_appointment.membership_charge_amount, v_appointment.amount, 0);
    if v_charge <= 0 then
      raise exception 'Укажите сумму списания';
    end if;
    if v_balance_used + v_charge > v_membership.initial_balance then
      raise exception 'Недостаточно средств: доступно % THB', round(v_membership.initial_balance - v_balance_used, 2);
    end if;
    v_sessions_used := 0;
    v_balance_used := v_charge;
    if v_membership.initial_balance - (
      select coalesce(sum(balance_used), 0)
      from public.membership_redemptions
      where membership_id = v_membership.id and reversed_at is null and deleted_at is null
        and appointment_id <> p_appointment_id
    ) = v_charge then
      v_allocated := greatest(0, v_membership.purchase_amount - v_allocated_used);
    else
      v_allocated := round(v_membership.purchase_amount * v_charge / v_membership.initial_balance, 2);
    end if;
  else
    v_sessions_used := 0;
    v_balance_used := 0;
    v_allocated := coalesce(v_appointment.membership_charge_amount, v_appointment.amount, 0);
  end if;

  insert into public.membership_redemptions (
    id, membership_id, appointment_id, visit_date, redeemed_at, reversed_at,
    sessions_used, balance_used, allocated_value, teacher,
    guest_master_id, guest_master_name, guest_master_rate_percent, deleted_at
  ) values (
    'membership-redemption-' || extensions.gen_random_uuid()::text,
    v_membership.id,
    v_appointment.id,
    v_appointment.appointment_date,
    now(),
    null,
    v_sessions_used,
    v_balance_used,
    v_allocated,
    v_appointment.teacher,
    v_appointment.guest_master_id,
    v_appointment.guest_master_name,
    v_appointment.guest_master_rate_percent,
    null
  )
  on conflict (appointment_id) do update set
    membership_id = excluded.membership_id,
    visit_date = excluded.visit_date,
    redeemed_at = excluded.redeemed_at,
    reversed_at = null,
    sessions_used = excluded.sessions_used,
    balance_used = excluded.balance_used,
    allocated_value = excluded.allocated_value,
    teacher = excluded.teacher,
    guest_master_id = excluded.guest_master_id,
    guest_master_name = excluded.guest_master_name,
    guest_master_rate_percent = excluded.guest_master_rate_percent,
    deleted_at = null
  returning * into v_redemption;

  update public.appointments
  set status = p_status, paid = true, cash = false
  where id = p_appointment_id;

  return jsonb_build_object('redemption', to_jsonb(v_redemption), 'status', p_status);
end;
$$;

revoke all on function public.set_membership_appointment_status(text, text) from public, anon;
grant execute on function public.set_membership_appointment_status(text, text) to authenticated;
create index if not exists memberships_purchase_payment_id_idx
  on public.memberships (purchase_payment_id)
  where purchase_payment_id is not null;

revoke execute on function public.capture_app_state_history() from public, anon, authenticated;
revoke execute on function public.capture_entity_audit() from public, anon, authenticated;
