-- Emerald Lost Generation: Friend Portal database (v1)
-- Paste into Supabase > SQL Editor > New query, then Run. Safe to read top to bottom.
-- Principle: deny by default. Every table has RLS on, and only signed-in users
-- (role "authenticated") get exactly the privileges listed here.

------------------------------------------------------------
-- 1. Profiles: one row per account, created automatically
------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  is_admin boolean not null default false,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Is the current user an admin? (security definer = runs with owner rights,
-- so policies can call it without recursion)
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- New account -> new profile row
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "profiles: members read all" on public.profiles
  for select to authenticated using (true);
create policy "profiles: edit own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select on public.profiles to authenticated;
-- Column-level grant: users can never flip is_admin themselves
grant update (display_name, must_change_password) on public.profiles to authenticated;

------------------------------------------------------------
-- 2. Role slots (Gym Leaders, Elite Four, bosses, Professor, Champion)
------------------------------------------------------------
create table public.roles (
  id text primary key,
  category text not null check (category in ('gym','elite4','aqua','magma','professor','champion')),
  label text not null,
  needs_type boolean not null default false,
  claimable boolean not null default true,
  sort int not null
);
alter table public.roles enable row level security;
create policy "roles: members read" on public.roles for select to authenticated using (true);
grant select on public.roles to authenticated;

insert into public.roles (id, category, label, needs_type, claimable, sort) values
  ('gym1','gym','Gym Leader 1',true,true,1), ('gym2','gym','Gym Leader 2',true,true,2),
  ('gym3','gym','Gym Leader 3',true,true,3), ('gym4','gym','Gym Leader 4',true,true,4),
  ('gym5','gym','Gym Leader 5',true,true,5), ('gym6','gym','Gym Leader 6',true,true,6),
  ('gym7','gym','Gym Leader 7',true,true,7), ('gym8','gym','Gym Leader 8',true,true,8),
  ('e4_1','elite4','Elite Four 1',true,true,9), ('e4_2','elite4','Elite Four 2',true,true,10),
  ('e4_3','elite4','Elite Four 3',true,true,11), ('e4_4','elite4','Elite Four 4',true,true,12),
  ('aqua','aqua','Team Aqua Boss',false,true,13), ('magma','magma','Team Magma Boss',false,true,14),
  ('professor','professor','Professor',false,true,15),
  ('champion','champion','Champion',false,false,16);  -- Abner decides the Champion

------------------------------------------------------------
-- 3. Claims: a friend claims a slot (+ a type for Gym/Elite Four)
------------------------------------------------------------
create table public.claims (
  id bigint generated always as identity primary key,
  role_id text not null references public.roles(id),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  poke_type text check (poke_type in ('Normal','Fire','Water','Grass','Electric','Ice','Fighting',
    'Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
alter table public.claims enable row level security;

-- One live claim per slot, one live claim per person, one type specialist per type
create unique index claims_one_per_slot on public.claims (role_id) where status <> 'rejected';
create unique index claims_one_per_user on public.claims (user_id) where status <> 'rejected';
create unique index claims_one_per_type on public.claims (poke_type)
  where poke_type is not null and status <> 'rejected';

-- Type required for Gym/Elite Four, forbidden elsewhere; slot must be claimable
create function public.check_claim() returns trigger
language plpgsql set search_path = public as $$
declare r public.roles;
begin
  select * into r from public.roles where id = new.role_id;
  if not r.claimable and not public.is_admin() then
    raise exception 'This slot is reserved';
  end if;
  if r.needs_type and new.poke_type is null then
    raise exception 'Pick a type for this role';
  end if;
  if not r.needs_type then new.poke_type := null; end if;
  return new;
end $$;
create trigger claims_check before insert or update on public.claims
  for each row execute function public.check_claim();

create policy "claims: members read" on public.claims for select to authenticated using (true);
create policy "claims: claim for yourself" on public.claims for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "claims: drop own pending, admin any" on public.claims for delete to authenticated
  using ((user_id = auth.uid() and status = 'pending') or public.is_admin());
create policy "claims: admin approves" on public.claims for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, delete on public.claims to authenticated;
grant insert (role_id, poke_type) on public.claims to authenticated;
grant update (status) on public.claims to authenticated;

------------------------------------------------------------
-- 4. Characters: team, look, dialogue (each friend edits only their own)
------------------------------------------------------------
create table public.characters (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  character_name text not null default '',
  team jsonb not null default '[]',        -- [{species, nickname, note}] up to 6
  look_note text not null default '',
  look_image text,                          -- storage path in bucket "looks"
  dialogue jsonb not null default '{}',     -- {intro, defeat, extra:[...]}
  notes text not null default '',
  updated_at timestamptz not null default now(),
  constraint team_max_6 check (jsonb_typeof(team) = 'array' and jsonb_array_length(team) <= 6)
);
alter table public.characters enable row level security;
create policy "characters: own or admin read" on public.characters for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "characters: create own" on public.characters for insert to authenticated
  with check (user_id = auth.uid());
create policy "characters: edit own" on public.characters for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.characters to authenticated;

------------------------------------------------------------
-- 5. Posts: comments and the idea box
------------------------------------------------------------
create table public.posts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('comment','idea')),
  body text not null check (char_length(body) between 1 and 2000),
  parent_id bigint references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.posts enable row level security;
create policy "posts: members read" on public.posts for select to authenticated using (true);
create policy "posts: write as yourself" on public.posts for insert to authenticated
  with check (user_id = auth.uid());
create policy "posts: delete own, admin any" on public.posts for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select, delete on public.posts to authenticated;
grant insert (kind, body, parent_id) on public.posts to authenticated;

------------------------------------------------------------
-- 6. Updates: game progress and announcements (admin writes)
------------------------------------------------------------
create table public.updates (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null default '',
  milestone text,                       -- e.g. 'Gym 1 done'
  created_at timestamptz not null default now()
);
alter table public.updates enable row level security;
create policy "updates: members read" on public.updates for select to authenticated using (true);
create policy "updates: admin writes" on public.updates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.updates to authenticated;
grant usage on sequence public.updates_id_seq to authenticated;

------------------------------------------------------------
-- 7. Storage: private bucket for look references
--    Path rule: looks/<user id>/<file>. Friends see only their own; admin sees all.
------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('looks', 'looks', false, 5242880, array['image/png','image/jpeg','image/webp']);

create policy "looks: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'looks' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "looks: read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'looks' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "looks: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'looks' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "looks: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'looks' and (storage.foldername(name))[1] = auth.uid()::text);
