-- IMG Golf Week Planner: Supabase schema
-- Run in Supabase > SQL Editor. Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
--
-- Model: the app today keeps ONE big JSON object in each browser's localStorage.
-- This splits it along the lines the app already uses:
--   weeks             one row per "Week of" (sessions, news/PTO, coverage, weekend notes, range hours, publish flags)
--   planner_settings  one row of shared settings every coach needs (categories, tags, zones, templates, courses, drivers...)
--   staff_private     one row only staff can touch (Analytics PIN hash, tee-time requests)
--   staff_secrets     the staff edit PIN, stored as a bcrypt hash
-- Coaches READ with the public (anon) key. Staff WRITE through PIN-checked functions. Nobody writes tables directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.weeks (
  week_key        text primary key,                  -- '9/21/26' (from "Week of ..." in the title) or 'No week label'
  week_start      date,                              -- parsed from week_key, for sorting / archive logic
  sessions        jsonb not null default '[]',       -- AM / PM / Camp tabs: pods, cells, cards, trips, bt, campers
  news            jsonb not null default '[]',       -- News & PTO items for this week
  coverage        jsonb not null default '[]',       -- state.coverage items for this week
  trav            jsonb not null default '[]',       -- weekend travel notes (state.trav)
  range_hours     jsonb,                             -- range staff hourly grid (state.rangeHours[week])
  published       boolean not null default false,    -- visible to all coaches
  published_range boolean not null default false,    -- visible to range staff only
  version         integer not null default 1,        -- bumps on every save (conflict check)
  updated_at      timestamptz not null default now()
);

create table if not exists public.planner_settings (
  id        integer primary key default 1 check (id = 1),   -- single row
  data      jsonb not null default '{}',
  version   integer not null default 1,
  updated_at timestamptz not null default now()
);
-- data holds: categories, tags, zones, zoneCfg, templates, courses9, courses18, programs, programColors,
--             homeNames, coachList, coachGender, coachLocked, driveMin, drivers, btCoaches, crossZones, seedRecNut
insert into public.planner_settings (id) values (1) on conflict do nothing;

create table if not exists public.staff_private (
  id        integer primary key default 1 check (id = 1),
  data      jsonb not null default '{}',     -- analyticsPin (hash), tee (tee-time requests)
  version   integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.staff_private (id) values (1) on conflict do nothing;

create table if not exists public.staff_secrets (
  id       integer primary key default 1 check (id = 1),
  pin_hash text not null
);
-- Placeholder PIN. CHANGE IT right after running this:  select public.staff_set_pin('<old>', '<new>');
insert into public.staff_secrets (id, pin_hash) values (1, crypt('CHANGE-ME-NOW', gen_salt('bf'))) on conflict do nothing;

-- ---------------------------------------------------------------- row level security
alter table public.weeks            enable row level security;
alter table public.planner_settings enable row level security;
alter table public.staff_private    enable row level security;
alter table public.staff_secrets    enable row level security;

-- coaches (anon key) may read published weeks and the shared settings. No write policies exist, so writes are denied.
drop policy if exists weeks_read on public.weeks;
create policy weeks_read on public.weeks for select to anon, authenticated
  using (published or published_range);

drop policy if exists settings_read on public.planner_settings;
create policy settings_read on public.planner_settings for select to anon, authenticated using (true);

-- staff_private and staff_secrets: no policies at all = no direct access for anon.
revoke all on public.staff_private, public.staff_secrets from anon, authenticated;
revoke insert, update, delete on public.weeks, public.planner_settings from anon, authenticated;

-- ---------------------------------------------------------------- PIN-checked functions (staff only)
create or replace function public._pin_ok(p_pin text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from staff_secrets where id = 1 and pin_hash = crypt(coalesce(p_pin, ''), pin_hash));
$$;
revoke all on function public._pin_ok(text) from public, anon, authenticated;

create or replace function public.staff_verify(p_pin text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select public._pin_ok(p_pin);
$$;

-- everything, including unpublished weeks and private data (what Edit mode loads)
create or replace function public.staff_get_all(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  return jsonb_build_object(
    'weeks',    coalesce((select jsonb_agg(to_jsonb(w) order by w.week_start desc nulls last) from weeks w), '[]'),
    'settings', (select to_jsonb(s) from planner_settings s where id = 1),
    'private',  (select to_jsonb(p) from staff_private p where id = 1)
  );
end $$;

-- save one week. p_expected_version = the version you loaded; a mismatch means someone else saved first.
create or replace function public.staff_save_week(
  p_pin text, p_week_key text, p_week_start date,
  p_sessions jsonb, p_news jsonb, p_coverage jsonb, p_trav jsonb, p_range_hours jsonb,
  p_published boolean, p_published_range boolean, p_expected_version integer
) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare v integer;
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  select version into v from weeks where week_key = p_week_key for update;
  if not found then
    insert into weeks (week_key, week_start, sessions, news, coverage, trav, range_hours, published, published_range)
    values (p_week_key, p_week_start, p_sessions, p_news, p_coverage, p_trav, p_range_hours, p_published, p_published_range);
    return 1;
  end if;
  if p_expected_version is not null and p_expected_version <> v then
    raise exception 'conflict: week changed since you loaded it' using errcode = '40001';
  end if;
  update weeks set week_start = p_week_start, sessions = p_sessions, news = p_news, coverage = p_coverage,
         trav = p_trav, range_hours = p_range_hours, published = p_published, published_range = p_published_range,
         version = v + 1, updated_at = now()
   where week_key = p_week_key;
  return v + 1;
end $$;

create or replace function public.staff_delete_week(p_pin text, p_week_key text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  delete from weeks where week_key = p_week_key;
end $$;

create or replace function public.staff_save_settings(p_pin text, p_data jsonb) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare v integer;
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  update planner_settings set data = p_data, version = version + 1, updated_at = now() where id = 1 returning version into v;
  return v;
end $$;

create or replace function public.staff_save_private(p_pin text, p_data jsonb) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare v integer;
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  update staff_private set data = p_data, version = version + 1, updated_at = now() where id = 1 returning version into v;
  return v;
end $$;

create or replace function public.staff_set_pin(p_old text, p_new text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._pin_ok(p_old) then raise exception 'bad pin' using errcode = '28000'; end if;
  if length(coalesce(p_new, '')) < 6 then raise exception 'new pin must be at least 6 characters'; end if;
  update staff_secrets set pin_hash = crypt(p_new, gen_salt('bf')) where id = 1;
end $$;

grant execute on function
  public.staff_verify(text), public.staff_get_all(text),
  public.staff_save_week(text,text,date,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,boolean,integer),
  public.staff_delete_week(text,text), public.staff_save_settings(text,jsonb),
  public.staff_save_private(text,jsonb), public.staff_set_pin(text,text)
to anon, authenticated;

-- ---------------------------------------------------------------- realtime (coaches see changes without refreshing)
do $$ begin
  alter publication supabase_realtime add table public.weeks;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.planner_settings;
exception when duplicate_object then null; end $$;
