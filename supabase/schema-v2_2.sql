-- Emerald Lost Generation: Friend Portal database v2.2 (HOTFIX for v2.1)
-- Bug: v2.1's shared check_own_paths() read new.avatar_path on characters rows too,
-- and PL/pgSQL fails on a missing field even inside an AND. Result: every character save failed.
-- Fix: one small function per table.

drop trigger if exists characters_own_paths on public.characters;
drop trigger if exists profiles_own_paths on public.profiles;
drop function if exists public.check_own_paths();

create function public.check_avatar_path() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.avatar_path is not null and split_part(new.avatar_path, '/', 1) <> new.id::text then
    raise exception 'Avatar must be in your own folder';
  end if;
  return new;
end $$;
create trigger profiles_own_paths before insert or update on public.profiles
  for each row execute function public.check_avatar_path();

create function public.check_look_path() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.look_image is not null and split_part(new.look_image, '/', 1) <> new.user_id::text then
    raise exception 'Look image must be in your own folder';
  end if;
  return new;
end $$;
create trigger characters_own_paths before insert or update on public.characters
  for each row execute function public.check_look_path();
