-- 09 Emerald Lost Generation: Friend Portal database v5: admin role management
-- Admin can delete roles, assign roles to anyone, and create roles directly.

grant delete on public.roles to authenticated;   -- the "roles: admin writes" policy limits it to the admin

-- Delete a role and everything tied to it (claims, that role's teams); all or nothing
create function public.admin_delete_role(p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can delete roles';
  end if;
  delete from public.claims where role_id = p_role;   -- the trigger below also removes their teams for it
  delete from public.roles where id = p_role;
  if not found then
    raise exception 'Role not found';
  end if;
end $$;

-- Give a role to a friend, already approved (type required for Gym / Elite Four)
create function public.admin_assign_role(p_user uuid, p_role text, p_type text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can assign roles';
  end if;
  insert into public.claims (role_id, user_id, poke_type, status, reason)
  values (p_role, p_user, nullif(trim(coalesce(p_type, '')), ''), 'approved', 'Assigned by Abner');
end $$;

-- Create a role directly (no request needed)
create function public.admin_create_role(p_label text, p_category text, p_first_team_size int) returns text
language plpgsql security definer set search_path = public as $$
declare new_id text;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can create roles';
  end if;
  if char_length(trim(coalesce(p_label, ''))) not between 2 and 40 then
    raise exception 'Role name must be 2 to 40 characters';
  end if;
  new_id := p_category || '_' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS');
  insert into public.roles (id, category, label, needs_type, claimable, sort, first_team_size)
  values (new_id, p_category, trim(p_label), p_category in ('gym', 'elite4'), true,
          (select coalesce(max(sort), 0) + 1 from public.roles), coalesce(p_first_team_size, 4));
  return new_id;
end $$;

revoke all on function public.admin_delete_role(text) from public, anon;
revoke all on function public.admin_assign_role(uuid, text, text) from public, anon;
revoke all on function public.admin_create_role(text, text, int) from public, anon;
grant execute on function public.admin_delete_role(text) to authenticated;
grant execute on function public.admin_assign_role(uuid, text, text) to authenticated;
grant execute on function public.admin_create_role(text, text, int) to authenticated;

-- When a claim is removed or rejected, drop that role's teams from the person's character
-- (keeps data consistent so leftover teams never block a later save)
create function public.strip_role_from_character() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- separate branches on purpose: a DELETE row has no NEW record to read
  if tg_op = 'DELETE' then
    update public.characters set roles = roles - old.role_id
     where user_id = old.user_id and roles ? old.role_id;
  elsif new.status = 'rejected' then
    update public.characters set roles = roles - old.role_id
     where user_id = old.user_id and roles ? old.role_id;
  end if;
  return null;
end $$;
create trigger claims_strip_role after delete or update of status on public.claims
  for each row execute function public.strip_role_from_character();
