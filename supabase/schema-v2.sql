-- Emerald Lost Generation: Friend Portal database v2 (run once, after v1)
-- Adds: character title, dated submission history, admin approval, public profile fields, avatars.

------------------------------------------------------------
-- 1. Character title
------------------------------------------------------------
alter table public.characters add column title text not null default '';

------------------------------------------------------------
-- 2. Submission history: every save of a character is kept, with its date
------------------------------------------------------------
create table public.character_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  snapshot jsonb not null,               -- the whole character as it was saved
  created_at timestamptz not null default now()
);
alter table public.character_history enable row level security;
create index character_history_user on public.character_history (user_id, created_at desc);

-- Owner and admin can read; nobody writes directly (only the trigger below)
create policy "history: own or admin read" on public.character_history for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select on public.character_history to authenticated;

create function public.log_character_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.character_history (user_id, snapshot)
  values (new.user_id, to_jsonb(new) - 'user_id');
  return new;
end $$;
create trigger characters_history after insert or update on public.characters
  for each row execute function public.log_character_version();

-- Backfill: current characters become their first version
insert into public.character_history (user_id, snapshot, created_at)
select user_id, to_jsonb(c) - 'user_id', updated_at from public.characters c;

------------------------------------------------------------
-- 3. Public profile fields + admin approval
------------------------------------------------------------
alter table public.profiles
  add column avatar_path text,
  add column approved_character_name text,
  add column approved_title text,
  add column approved_at timestamptz,
  add column approved_history_id bigint references public.character_history(id) on delete set null;

-- Friends may set their own avatar; approved_* stay locked (only the function below writes them)
grant update (avatar_path) on public.profiles to authenticated;

create function public.approve_character(p_history_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare h public.character_history;
begin
  if not public.is_admin() then raise exception 'Only the admin can approve'; end if;
  select * into h from public.character_history where id = p_history_id;
  if not found then raise exception 'Version not found'; end if;
  update public.profiles
     set approved_character_name = h.snapshot->>'character_name',
         approved_title = h.snapshot->>'title',
         approved_at = now(),
         approved_history_id = h.id
   where id = h.user_id;
end $$;
revoke all on function public.approve_character(bigint) from public, anon;
grant execute on function public.approve_character(bigint) to authenticated;

------------------------------------------------------------
-- 4. Avatars: private bucket, every member can view, each edits only their own folder
------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/png','image/jpeg','image/webp']);

create policy "avatars: members view" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
