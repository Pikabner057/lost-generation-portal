-- 10 Emerald Lost Generation: Friend Portal database v6: signature moves (Gym only) + max 4 moves per Pokémon
-- Replaces the character check function; nothing else changes. Existing data stays as it is.

create or replace function public.check_character_roles() returns trigger
language plpgsql set search_path = public as $$
declare
  r record;
  mon record;
  sz int;
  cat text;
  first_team jsonb;
  rematch jsonb;
  mv jsonb;
begin
  for r in select key, value from jsonb_each(new.roles) loop
    if not exists (select 1 from public.claims
                    where user_id = new.user_id and role_id = r.key and status <> 'rejected') then
      raise exception 'You don''t hold the role %', r.key;
    end if;
    select first_team_size, category into sz, cat from public.roles where id = r.key;
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
    -- Signature move: Gym Leaders only
    if r.value ? 'signature_move' then
      if cat <> 'gym' then
        raise exception 'Only Gym Leaders have a signature move';
      end if;
      if char_length(coalesce(r.value #>> '{signature_move,name}', '')) > 40
         or char_length(coalesce(r.value #>> '{signature_move,description}', '')) > 300 then
        raise exception 'Signature move is too long';
      end if;
    end if;
    -- Each Pokémon knows at most 4 moves (checked in separate steps: never measure a non-list)
    for mon in select value from jsonb_array_elements(first_team)
               union all select value from jsonb_array_elements(rematch) loop
      mv := coalesce(mon.value->'moves', '[]'::jsonb);
      if jsonb_typeof(mv) <> 'array' then
        raise exception 'moves must be a list';
      end if;
      if jsonb_array_length(mv) > 4 then
        raise exception 'A Pokémon can know at most 4 moves';
      end if;
    end loop;
  end loop;
  return new;
end $$;
