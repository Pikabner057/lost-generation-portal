-- 06 Emerald Lost Generation: Friend Portal database v3: invite allowlist + self sign-up
-- Friends create their own account from the portal, but ONLY if Abner put their email on the list.

------------------------------------------------------------
-- 1. The allowlist (admin only)
------------------------------------------------------------
create table public.invites (
  email text primary key check (email = lower(trim(email)) and email like '%_@_%'),
  note text not null default '',            -- e.g. "Carlos"
  added_at timestamptz not null default now(),
  used_at timestamptz                       -- set when the account is created
);
alter table public.invites enable row level security;
create policy "invites: admin only" on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.invites to authenticated;

-- Abner is already in; keep the list complete
insert into public.invites (email, note, used_at)
select lower(email), 'Abner (admin)', now() from auth.users
where id in (select id from public.profiles where is_admin);

------------------------------------------------------------
-- 2. Gatekeeper: refuse any new account whose email isn't invited
--    (applies to the portal's sign-up AND to "Add user" in the dashboard)
------------------------------------------------------------
create function public.require_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.invites where email = lower(trim(new.email))) then
    raise exception 'not_invited: % is not on the invite list', new.email;
  end if;
  return new;
end $$;
create trigger before_auth_user_created before insert on auth.users
  for each row execute function public.require_invite();

------------------------------------------------------------
-- 3. New profile: use the chosen display name; self sign-ups picked their own
--    password, so they skip the forced change. Mark the invite as used.
------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare self_signup boolean := coalesce((new.raw_user_meta_data->>'self_signup')::boolean, false);
begin
  insert into public.profiles (id, display_name, must_change_password)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)), 24),
    not self_signup
  );
  update public.invites set used_at = now() where email = lower(trim(new.email));
  return new;
end $$;
