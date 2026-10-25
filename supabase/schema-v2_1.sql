-- Emerald Lost Generation: Friend Portal database v2.1 (hardening from the v2 havoc test)
-- Run once in Supabase > SQL Editor, after v2.

------------------------------------------------------------
-- 1. Length limits in the database (the site's limits could be bypassed through the API)
------------------------------------------------------------
alter table public.characters
  add constraint character_name_len check (char_length(character_name) <= 12),
  add constraint title_len check (char_length(title) <= 24),
  add constraint look_note_len check (char_length(look_note) <= 600),
  add constraint notes_len check (char_length(notes) <= 1000),
  add constraint dialogue_len check (
    char_length(coalesce(dialogue->>'intro', '')) <= 300 and
    char_length(coalesce(dialogue->>'defeat', '')) <= 300 and
    char_length(coalesce(dialogue->>'extra', '')) <= 1200);
alter table public.profiles
  add constraint display_name_len check (char_length(display_name) between 1 and 24);

------------------------------------------------------------
-- 2. Image paths must point into the owner's own folder
--    (stops "use someone else's picture as my avatar / look")
------------------------------------------------------------
create function public.check_own_paths() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'profiles' and new.avatar_path is not null
     and split_part(new.avatar_path, '/', 1) <> new.id::text then
    raise exception 'Avatar must be in your own folder';
  end if;
  if tg_table_name = 'characters' and new.look_image is not null
     and split_part(new.look_image, '/', 1) <> new.user_id::text then
    raise exception 'Look image must be in your own folder';
  end if;
  return new;
end $$;
create trigger profiles_own_paths before insert or update on public.profiles
  for each row execute function public.check_own_paths();
create trigger characters_own_paths before insert or update on public.characters
  for each row execute function public.check_own_paths();

------------------------------------------------------------
-- 3. characters.updated_at is always set by the database (history dates stay honest)
------------------------------------------------------------
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger characters_touch before insert or update on public.characters
  for each row execute function public.touch_updated_at();
