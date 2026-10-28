-- schema v7: the admin (Abner) can hold any number of roles; everyone else keeps the 2-role limit.
-- Run once in the Supabase SQL Editor (name the snippet "07 ✅ admin role limit").

create or replace function public.check_claim() returns trigger
language plpgsql set search_path = public as $$
declare
  r public.roles;
  n int;
  owner_is_admin boolean;
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
  select coalesce(is_admin, false) into owner_is_admin from public.profiles where id = new.user_id;
  if new.status <> 'rejected' and not coalesce(owner_is_admin, false) then
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
