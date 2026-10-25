-- 08 Emerald Lost Generation: Friend Portal database v4: dual roles, custom role requests, team sizes, per-role teams
-- Run once in Supabase > SQL Editor (after v3).

------------------------------------------------------------
-- 1. Team size for the first battle, per slot (admin can change it later on the Admin page)
------------------------------------------------------------
alter table public.roles add column first_team_size int not null default 3
  check (first_team_size between 1 and 6);
update public.roles set first_team_size = case id
  when 'gym1' then 2 when 'gym2' then 3 when 'gym3' then 3 when 'gym4' then 4
  when 'gym5' then 4 when 'gym6' then 5 when 'gym7' then 5 when 'gym8' then 6
  when 'e4_1' then 5 when 'e4_2' then 5 when 'e4_3' then 5 when 'e4_4' then 6
  when 'champion' then 6 when 'aqua' then 4 when 'magma' then 4 when 'professor' then 3
  else first_team_size end;

-- Custom roles are a new category
alter table public.roles drop constraint roles_category_check;
alter table public.roles add constraint roles_category_check
  check (category in ('gym','elite4','aqua','magma','professor','champion','custom'));

-- The admin can add roles and edit sizes
create policy "roles: admin writes" on public.roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant insert, update on public.roles to authenticated;

------------------------------------------------------------
-- 2. Dual roles: up to 2 live claims per person; the 2nd needs a reason
------------------------------------------------------------
alter table public.claims add column reason text not null default ''
  check (char_length(reason) <= 1000);
drop index public.claims_one_per_user;
grant insert (role_id, poke_type, reason) on public.claims to authenticated;

create or replace function public.check_claim() returns trigger
language plpgsql set search_path = public as $$
declare
  r public.roles;
  n int;
begin
  select * into r from public.roles where id = new.role_id;
  if not r.claimable and not public.is_admin() then
    raise exception 'This slot is reserved';
  end if;
  if r.needs_type and new.poke_type is null then
    raise exception 'Pick a type for this role';
  end if;
  if not r.needs_type then
    new.poke_type := null;
  end if;
  if new.status <> 'rejected' then
    select count(*) into n from public.claims
     where user_id = new.user_id and status <> 'rejected' and id <> new.id;
    if n >= 2 then
      raise exception 'You can hold at most 2 roles';
    end if;
    if n = 1 and trim(new.reason) = '' then
      raise exception 'Tell Abner why you want a second role';
    end if;
  end if;
  return new;
end $$;

------------------------------------------------------------
-- 3. Custom role requests (e.g. "Team Magma Spy"): friend asks, Abner approves
------------------------------------------------------------
create table public.role_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  role_name text not null check (char_length(trim(role_name)) between 2 and 40),
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  role_id text references public.roles(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.role_requests enable row level security;
create policy "requests: own or admin read" on public.role_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "requests: ask for yourself" on public.role_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "requests: drop own pending" on public.role_requests for delete to authenticated
  using ((user_id = auth.uid() and status = 'pending') or public.is_admin());
create policy "requests: admin decides" on public.role_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, delete on public.role_requests to authenticated;
grant insert (role_name, reason) on public.role_requests to authenticated;
grant update (status, decided_at) on public.role_requests to authenticated;

-- Approving creates the role and gives it to the friend (all or nothing)
create function public.approve_role_request(p_id bigint, p_label text, p_first_team_size int)
returns text
language plpgsql security definer set search_path = public as $$
declare
  rq public.role_requests;
  new_role text;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can approve';
  end if;
  select * into rq from public.role_requests where id = p_id and status = 'pending';
  if not found then
    raise exception 'Request not found or already decided';
  end if;
  new_role := 'custom_' || rq.id;
  insert into public.roles (id, category, label, needs_type, claimable, sort, first_team_size)
  values (new_role, 'custom', coalesce(nullif(trim(p_label), ''), trim(rq.role_name)),
          false, false, 100 + rq.id::int, coalesce(p_first_team_size, 4));
  insert into public.claims (role_id, user_id, poke_type, status, reason)
  values (new_role, rq.user_id, null, 'approved', rq.reason);
  update public.role_requests set status = 'approved', role_id = new_role, decided_at = now()
   where id = rq.id;
  return new_role;
end $$;
revoke all on function public.approve_role_request(bigint, text, int) from public, anon;
grant execute on function public.approve_role_request(bigint, text, int) to authenticated;

------------------------------------------------------------
-- 4. Per-role data inside the character:
--    roles = { "<role id>": { title, first_team:[...], rematch_team:[...], dialogue:{intro,defeat,extra} } }
--    Shared: character_name, look, notes. Pokémon: {species, nickname, item, gimmick, tera, note}
------------------------------------------------------------
alter table public.characters add column roles jsonb not null default '{}'
  check (jsonb_typeof(roles) = 'object');

-- Move existing single-role data under the person's first claim (becomes their rematch team)
update public.characters c
   set roles = jsonb_build_object(cl.role_id, jsonb_build_object(
         'title', c.title, 'first_team', '[]'::jsonb, 'rematch_team', c.team, 'dialogue', c.dialogue))
  from (select distinct on (user_id) user_id, role_id from public.claims
         where status <> 'rejected' order by user_id, created_at) cl
 where cl.user_id = c.user_id and c.roles = '{}'::jsonb;

create function public.check_character_roles() returns trigger
language plpgsql set search_path = public as $$
declare
  r record;
  sz int;
  first_team jsonb;
  rematch jsonb;
begin
  for r in select key, value from jsonb_each(new.roles) loop
    if not exists (select 1 from public.claims
                    where user_id = new.user_id and role_id = r.key and status <> 'rejected') then
      raise exception 'You don''t hold the role %', r.key;
    end if;
    select first_team_size into sz from public.roles where id = r.key;
    first_team := coalesce(r.value->'first_team', '[]'::jsonb);
    rematch := coalesce(r.value->'rematch_team', '[]'::jsonb);
    if jsonb_typeof(first_team) <> 'array' then
      raise exception 'first_team must be a list';
    end if;
    if jsonb_typeof(rematch) <> 'array' then
      raise exception 'rematch_team must be a list';
    end if;
    if jsonb_array_length(first_team) > sz then
      raise exception 'First-battle team can have at most % Pokémon for this role', sz;
    end if;
    if jsonb_array_length(rematch) > 6 then
      raise exception 'Rematch team can have at most 6 Pokémon';
    end if;
    if char_length(coalesce(r.value->>'title', '')) > 24 then
      raise exception 'Title is too long (max 24)';
    end if;
    if char_length(coalesce(r.value #>> '{dialogue,intro}', '')) > 300
       or char_length(coalesce(r.value #>> '{dialogue,defeat}', '')) > 300
       or char_length(coalesce(r.value #> '{dialogue,extra}', '[]'::jsonb)::text) > 1200 then
      raise exception 'Dialogue is too long';
    end if;
  end loop;
  return new;
end $$;
create trigger characters_roles_check before insert or update on public.characters
  for each row execute function public.check_character_roles();

------------------------------------------------------------
-- 5. Approval now covers one title per role
------------------------------------------------------------
alter table public.profiles add column approved_titles jsonb not null default '{}';

create or replace function public.approve_character(p_history_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  h public.character_history;
  titles jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can approve';
  end if;
  select * into h from public.character_history where id = p_history_id;
  if not found then
    raise exception 'Version not found';
  end if;
  select coalesce(jsonb_object_agg(key, value->>'title'), '{}'::jsonb) into titles
    from jsonb_each(coalesce(h.snapshot->'roles', '{}'::jsonb))
   where coalesce(value->>'title', '') <> '';
  update public.profiles
     set approved_character_name = h.snapshot->>'character_name',
         approved_titles = titles,
         approved_title = coalesce((select value #>> '{}' from jsonb_each(titles) limit 1), h.snapshot->>'title'),
         approved_at = now(),
         approved_history_id = h.id
   where id = h.user_id;
end $$;
