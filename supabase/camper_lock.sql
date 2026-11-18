-- Camper lock: run ONCE in Supabase > SQL Editor, after schema.sql. Safe to re-run.
--
-- SCOPE: this file only ADDS new objects, all named camper_*:
--   tables    camper_private, camper_guard
--   functions camper_details, camper_staff_get, camper_staff_save, camper_staff_delete, camper_staff_set_code
-- It does NOT alter, replace or drop anything that already exists (no other tables, functions, policies,
-- extensions or settings). It only READS the app's own helper public._pin_ok() from schema.sql.
-- If any of these names already exists and was not created by this script, it stops with an error
-- BEFORE changing anything, so another site in the same Supabase project can never be overwritten.
--
-- What it does for the app: coaches still see a camper's name, coach group and package. Everything else
-- about a camper moves into camper_private, which the public key cannot read. A coach unlocks it with a
-- 4-digit code and the database checks the code. The code is NOT in this file: set it yourself (see bottom).

-- ---------------------------------------------------------------- 1. safety check (runs first, changes nothing)
do $$
declare
  marker constant text := 'imggolf camper lock';
  t text; f text;
begin
  foreach t in array array['camper_private', 'camper_guard'] loop
    if to_regclass('public.' || t) is not null
       and coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> marker then
      raise exception 'public.% already exists and was not created by this script. Stopping so nothing is overwritten.', t;
    end if;
  end loop;
  foreach f in array array['camper_details', 'camper_staff_get', 'camper_staff_save', 'camper_staff_delete', 'camper_staff_set_code'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = f
                 and coalesce(obj_description(p.oid, 'pg_proc'), '') <> marker) then
      raise exception 'function public.% already exists and was not created by this script. Stopping so nothing is overwritten.', f;
    end if;
  end loop;
  if to_regprocedure('public._pin_ok(text)') is null then
    raise exception 'Run schema.sql first (public._pin_ok is missing).';
  end if;
end $$;

-- ---------------------------------------------------------------- 2. new tables
create table if not exists public.camper_private (
  week_key   text primary key,
  data       jsonb not null default '{}',     -- { "<camper id>": { opp, mf, age, email, ... } }
  updated_at timestamptz not null default now()
);
alter table public.camper_private enable row level security;
revoke all on public.camper_private from anon, authenticated;   -- no policies: the public key cannot read or write it
comment on table public.camper_private is 'imggolf camper lock';

create table if not exists public.camper_guard (
  id           integer primary key default 1 check (id = 1),
  code_hash    text,                          -- null until you set a code
  fails        integer not null default 0,
  window_start timestamptz,
  locked_until timestamptz
);
insert into public.camper_guard (id) values (1) on conflict do nothing;
alter table public.camper_guard enable row level security;
revoke all on public.camper_guard from anon, authenticated;
comment on table public.camper_guard is 'imggolf camper lock';

-- ---------------------------------------------------------------- 3. new functions
-- staff: set or change the 4-digit camper code
create or replace function public.camper_staff_set_code(p_pin text, p_code text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  if p_code is null or p_code !~ '^[0-9]{4}$' then raise exception 'the camper code must be exactly 4 digits'; end if;
  update camper_guard set code_hash = crypt(p_code, gen_salt('bf')), fails = 0, window_start = null, locked_until = null where id = 1;
end $$;

-- staff: read every week's camper details
create or replace function public.camper_staff_get(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  return coalesce((select jsonb_object_agg(week_key, data) from camper_private), '{}');
end $$;

-- staff: save one week's camper details
create or replace function public.camper_staff_save(p_pin text, p_week_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  insert into camper_private (week_key, data) values (p_week_key, coalesce(p_data, '{}'))
  on conflict (week_key) do update set data = excluded.data, updated_at = now();
end $$;

-- staff: remove one week's camper details (the app calls this when a week is deleted)
create or replace function public.camper_staff_delete(p_pin text, p_week_key text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._pin_ok(p_pin) then raise exception 'bad pin' using errcode = '28000'; end if;
  delete from camper_private where week_key = p_week_key;
end $$;

-- coaches: unlock with the 4-digit code. After 5 wrong tries in 15 minutes it refuses everyone for 15 minutes
-- (a 4-digit code is easy to guess otherwise). Returns { ok, locked, unset, data }. Only published weeks are returned.
create or replace function public.camper_details(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare g camper_guard%rowtype;
begin
  select * into g from camper_guard where id = 1 for update;
  if g.code_hash is null then return jsonb_build_object('ok', false, 'locked', false, 'unset', true); end if;
  if g.locked_until is not null and g.locked_until > now() then return jsonb_build_object('ok', false, 'locked', true); end if;
  if crypt(coalesce(p_code, ''), g.code_hash) <> g.code_hash then
    if g.window_start is null or g.window_start < now() - interval '15 minutes' then g.fails := 0; g.window_start := now(); end if;
    g.fails := g.fails + 1;
    update camper_guard set fails = g.fails, window_start = g.window_start,
           locked_until = case when g.fails >= 5 then now() + interval '15 minutes' else null end where id = 1;
    return jsonb_build_object('ok', false, 'locked', g.fails >= 5);
  end if;
  update camper_guard set fails = 0, window_start = null, locked_until = null where id = 1;
  return jsonb_build_object('ok', true, 'data', coalesce(
    (select jsonb_object_agg(c.week_key, c.data) from camper_private c join weeks w on w.week_key = c.week_key where w.published or w.published_range), '{}'));
end $$;

comment on function public.camper_staff_set_code(text, text) is 'imggolf camper lock';
comment on function public.camper_staff_get(text)            is 'imggolf camper lock';
comment on function public.camper_staff_save(text, text, jsonb) is 'imggolf camper lock';
comment on function public.camper_staff_delete(text, text)   is 'imggolf camper lock';
comment on function public.camper_details(text)              is 'imggolf camper lock';

-- only these five new functions are made callable
revoke all on function public.camper_staff_set_code(text, text), public.camper_staff_get(text),
  public.camper_staff_save(text, text, jsonb), public.camper_staff_delete(text, text), public.camper_details(text) from public;
grant execute on function public.camper_staff_set_code(text, text), public.camper_staff_get(text),
  public.camper_staff_save(text, text, jsonb), public.camper_staff_delete(text, text), public.camper_details(text)
to anon, authenticated;

-- ---------------------------------------------------------------- AFTER running this file, set the code yourself:
--   select public.camper_staff_set_code('<your staff PIN>', '<4 digits>');
-- Do not save the PIN or the code in this file.
