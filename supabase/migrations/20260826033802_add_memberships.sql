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
