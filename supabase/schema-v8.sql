-- Emerald Lost Generation portal: schema v8 (2026-10-29)
-- Tabs + trainer card + private ideas.
--  1. Characters: backstory, personality, longer look description, per-role custom story.
--  2. Crew can read a character WITHOUT its teams (teams stay owner + admin only),
--     once Abner has approved that character at least once.
--  3. Crew can see the current look image of approved characters.
--  4. Ideas: category + status, private to the author and Abner. Comments are closed.

------------------------------------------------------------
-- 1. New character fields
------------------------------------------------------------
alter table public.characters
  add column if not exists backstory text not null default '',
  add column if not exists personality text not null default '';
alter table public.characters drop constraint if exists backstory_len, drop constraint if exists personality_len;
alter table public.characters
  add constraint backstory_len check (char_length(backstory) <= 3000),
  add constraint personality_len check (char_length(personality) <= 1500);
alter table public.characters drop constraint if exists look_note_len;
alter table public.characters add constraint look_note_len check (char_length(look_note) <= 2000);

-- Per-role custom story lives in roles.<role>.story; add its length check to the roles trigger.
create or replace function public.check_character_roles() returns trigger
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
    if char_length(coalesce(r.value->>'story', '')) > 3000 then
      raise exception 'Role story is too long (max 3000)';
    end if;
    if char_length(coalesce(r.value #>> '{dialogue,intro}', '')) > 300
       or char_length(coalesce(r.value #>> '{dialogue,defeat}', '')) > 300
       or char_length(coalesce(r.value #> '{dialogue,extra}', '[]'::jsonb)::text) > 1200 then
      raise exception 'Dialogue is too long';
    end if;
  end loop;
  return new;
end $$;

-- Role descriptions ("About this role"). Custom roles start with the idea from their request.
alter table public.roles add column if not exists description text not null default ''
  check (char_length(description) <= 1000);
update public.roles r set description = rq.reason
  from public.role_requests rq
 where rq.role_id = r.id and rq.status = 'approved' and r.description = '';

create or replace function public.approve_role_request(p_id bigint, p_label text, p_first_team_size int)
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
  insert into public.roles (id, category, label, needs_type, claimable, sort, first_team_size, description)
  values (new_role, 'custom', coalesce(nullif(trim(p_label), ''), trim(rq.role_name)),
          false, false, 100 + rq.id::int, coalesce(p_first_team_size, 4), left(trim(rq.reason), 1000));
  insert into public.claims (role_id, user_id, poke_type, status, reason)
  values (new_role, rq.user_id, null, 'approved', rq.reason);
  update public.role_requests set status = 'approved', role_id = new_role, decided_at = now()
   where id = rq.id;
  return new_role;
end $$;

------------------------------------------------------------
-- 2. Crew view of a character, without teams
------------------------------------------------------------
create or replace function public.crew_character(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.characters;
  ok boolean;
begin
  if auth.uid() is null then
    return null;
  end if;
  select (p_user = auth.uid() or public.is_admin()
          or exists (select 1 from public.profiles where id = p_user and approved_at is not null))
    into ok;
  if not ok then
    return null;
  end if;
  select * into c from public.characters where user_id = p_user;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'character_name', c.character_name,
    'backstory', c.backstory,
    'personality', c.personality,
    'look_note', c.look_note,
    'look_image', c.look_image,
    'roles', coalesce((select jsonb_object_agg(key, value - 'first_team' - 'rematch_team')
                         from jsonb_each(c.roles)), '{}'::jsonb),
    'updated_at', c.updated_at);
end $$;
revoke all on function public.crew_character(uuid) from public, anon;
grant execute on function public.crew_character(uuid) to authenticated;

------------------------------------------------------------
-- 3. Crew can see the CURRENT look image of an approved character
--    (older images from the version history stay owner + admin only)
------------------------------------------------------------
create or replace function public.is_public_look(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.characters c
                   join public.profiles p on p.id = c.user_id
                  where c.look_image = p_path and p.approved_at is not null)
$$;
revoke all on function public.is_public_look(text) from public, anon;
grant execute on function public.is_public_look(text) to authenticated;

drop policy if exists "looks: read own or admin" on storage.objects;
drop policy if exists "looks: read own, admin, or current approved look" on storage.objects;
create policy "looks: read own, admin, or current approved look" on storage.objects for select to authenticated
  using (bucket_id = 'looks' and ((storage.foldername(name))[1] = auth.uid()::text
                                  or public.is_admin()
                                  or public.is_public_look(name)));

------------------------------------------------------------
-- 4. Ideas: private, with category and status. Comments closed.
------------------------------------------------------------
alter table public.posts
  add column if not exists category text not null default 'other'
    check (category in ('character','story','design','other')),
  add column if not exists status text not null default 'new'
    check (status in ('new','considering','used','not_now'));

drop policy if exists "posts: members read" on public.posts;
drop policy if exists "posts: own or admin read" on public.posts;
create policy "posts: own or admin read" on public.posts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "posts: write as yourself" on public.posts;
drop policy if exists "posts: submit ideas as yourself" on public.posts;
create policy "posts: submit ideas as yourself" on public.posts for insert to authenticated
  with check (user_id = auth.uid() and kind = 'idea' and status = 'new');

drop policy if exists "posts: admin sets status" on public.posts;
create policy "posts: admin sets status" on public.posts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke insert on public.posts from authenticated;
grant insert (kind, body, category) on public.posts to authenticated;
grant update (status) on public.posts to authenticated;
