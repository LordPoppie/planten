-- Planten: eigen plantenbeheer (Planta-vervanger)
-- Locatie → ruimtes → plekken → planten. Water-interval wordt berekend, nooit ingevoerd.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── Tabellen ─────────────────────────

create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  emoji        text not null default '🏠',
  kiosk_token  text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_by   uuid references auth.users on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.location_members (
  location_id  uuid not null references public.locations on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  display_name text,
  created_at   timestamptz not null default now(),
  primary key (location_id, user_id)
);

create table public.floorplans (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations on delete cascade,
  name         text not null default 'Begane grond',
  image_path   text,               -- storage: floorplans/<location_id>/<uuid>.jpg
  aspect       numeric,            -- breedte / hoogte, voor overlay
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations on delete cascade,
  floorplan_id uuid references public.floorplans on delete set null,
  name         text not null,
  kind         text,               -- woonkamer, keuken, kantoor, ...
  polygon      jsonb,              -- [[x,y],...] genormaliseerd 0..1 op de plattegrond
  windows      text[] not null default '{}',  -- kompasrichtingen van de ramen, bv. {Z,W}
  sort        int not null default 0,
  created_at   timestamptz not null default now()
);

create table public.spots (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms on delete cascade,
  location_id  uuid not null references public.locations on delete cascade,  -- afgeleid via trigger
  name         text not null,
  light        text not null default 'medium'
               check (light in ('low','medium','bright_indirect','direct')),
  window_dir   text check (window_dir in ('N','NO','O','ZO','Z','ZW','W','NW')),
  near_heater  boolean not null default false,
  near_ac      boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.plants (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations on delete cascade,
  spot_id            uuid references public.spots on delete set null,
  name               text not null,             -- roepnaam, bv. "Grote Monstera"
  species            text,                      -- Monstera deliciosa
  common_name        text,                      -- Gatenplant
  photo_path         text,                      -- storage: plant-photos/<location_id>/<uuid>.jpg
  pot_material       text not null default 'plastic'
                     check (pot_material in ('plastic','terracotta','glazed','self_watering')),
  pot_size           text not null default 'medium' check (pot_size in ('small','medium','large')),
  base_interval_days numeric not null default 7 check (base_interval_days between 1 and 90),
  water_amount_ml    int,
  water_how          text,                      -- "Scheutje tot het onderin uitloopt"
  care               jsonb not null default '{}'::jsonb,  -- light_need, tips, toxic_pets, fertilize_weeks, ...
  learn_factor       numeric not null default 1 check (learn_factor between 0.5 and 2),
  last_watered_at    timestamptz,
  next_water_at      timestamptz not null default now(),
  qr_token           text not null unique default encode(extensions.gen_random_bytes(8), 'hex'),
  archived           boolean not null default false,
  created_by         uuid references auth.users on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);

create table public.care_events (
  id           uuid primary key default gen_random_uuid(),
  plant_id     uuid not null references public.plants on delete cascade,
  location_id  uuid not null references public.locations on delete cascade,  -- afgeleid via trigger
  kind         text not null check (kind in ('water','still_wet','too_dry','fertilize','repot','note')),
  note         text,
  by_user      uuid references auth.users on delete set null default auth.uid(),
  by_name      text,
  via          text not null default 'app' check (via in ('app','kiosk','qr')),
  created_at   timestamptz not null default now()
);

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now()
);

create index on public.rooms (location_id);
create index on public.spots (room_id);
create index on public.plants (location_id) where not archived;
create index on public.plants (next_water_at) where not archived;
create index on public.care_events (plant_id, created_at desc);

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.is_member(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from location_members where location_id = loc and user_id = auth.uid());
$$;

-- Maker van een locatie wordt automatisch eigenaar.
create or replace function public.tg_location_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into location_members (location_id, user_id, role) values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger location_owner after insert on public.locations
  for each row execute function public.tg_location_owner();

create or replace function public.tg_spot_location()
returns trigger language plpgsql set search_path = public as $$
begin
  select location_id into new.location_id from rooms where id = new.room_id;
  return new;
end $$;
create trigger spot_location before insert or update of room_id on public.spots
  for each row execute function public.tg_spot_location();

create or replace function public.tg_event_location()
returns trigger language plpgsql set search_path = public as $$
begin
  select location_id into new.location_id from plants where id = new.plant_id;
  return new;
end $$;
create trigger event_location before insert on public.care_events
  for each row execute function public.tg_event_location();

-- ───────────────────────── Water-algoritme ─────────────────────────
-- interval = basis × licht × verwarming × airco × seizoen × pot × grootte × leerfactor
-- Geeft ook de uitleg terug, zodat de app kan tonen *waarom*.

create or replace function public.plant_interval(p public.plants, at timestamptz default now())
returns jsonb language plpgsql stable set search_path = public as $$
declare
  s        spots;
  m        int := extract(month from at at time zone 'Europe/Amsterdam');
  f        numeric;
  total    numeric := 1;
  factors  jsonb := '[]'::jsonb;
begin
  select * into s from spots where id = p.spot_id;
  if found then
    f := case s.light when 'low' then 1.3 when 'bright_indirect' then 0.9 when 'direct' then 0.8 else 1 end;
    if f <> 1 then total := total * f; factors := factors || jsonb_build_object('label',
      case s.light when 'low' then 'weinig licht' when 'bright_indirect' then 'veel licht' else 'direct zonlicht' end, 'f', f); end if;
    if s.near_heater and m in (10,11,12,1,2,3,4) then
      total := total * 0.75; factors := factors || jsonb_build_object('label','bij verwarming (stookseizoen)','f',0.75);
    end if;
    if s.near_ac and m in (5,6,7,8,9) then
      total := total * 0.85; factors := factors || jsonb_build_object('label','bij airco (droge lucht)','f',0.85);
    end if;
  end if;

  f := case when m in (11,12,1,2) then 1.4 when m in (3,10) then 1.15 when m in (5,6,7,8) then 0.85 else 1 end;
  if f <> 1 then total := total * f; factors := factors || jsonb_build_object('label',
    case when f > 1 then 'winterrust' else 'zomer: groeit hard' end, 'f', f); end if;

  f := case p.pot_material when 'terracotta' then 0.85 when 'glazed' then 1.05 when 'self_watering' then 1.6 else 1 end;
  if f <> 1 then total := total * f; factors := factors || jsonb_build_object('label',
    case p.pot_material when 'terracotta' then 'terracotta pot' when 'glazed' then 'geglazuurde pot' else 'zelfwaterende pot' end, 'f', f); end if;

  f := case p.pot_size when 'small' then 0.85 when 'large' then 1.15 else 1 end;
  if f <> 1 then total := total * f; factors := factors || jsonb_build_object('label',
    case p.pot_size when 'small' then 'kleine pot' else 'grote pot' end, 'f', f); end if;

  if p.learn_factor <> 1 then
    total := total * p.learn_factor;
    factors := factors || jsonb_build_object('label','geleerd van jouw feedback','f', round(p.learn_factor, 2));
  end if;

  return jsonb_build_object(
    'base', p.base_interval_days,
    'days', greatest(1, round(p.base_interval_days * total)),
    'factors', factors
  );
end $$;

create or replace function public.plant_interval_days(p public.plants)
returns int language sql stable set search_path = public as $$
  select (public.plant_interval(p) ->> 'days')::int;
$$;

-- Bij wijziging van plek/pot/basis: volgende beurt herberekenen.
create or replace function public.tg_plant_schedule()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.last_watered_at is not null and (
       tg_op = 'INSERT'
       or new.spot_id is distinct from old.spot_id
       or new.pot_material is distinct from old.pot_material
       or new.pot_size is distinct from old.pot_size
       or new.base_interval_days is distinct from old.base_interval_days
       or new.last_watered_at is distinct from old.last_watered_at) then
    new.next_water_at := new.last_watered_at + make_interval(days => public.plant_interval_days(new));
  end if;
  return new;
end $$;
create trigger plant_schedule before insert or update on public.plants
  for each row execute function public.tg_plant_schedule();

-- Feedback-lus: gedaan / nog vochtig / te droog.
create or replace function public.tg_care_event_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare p plants;
begin
  select * into p from plants where id = new.plant_id for update;
  if new.kind = 'water' then
    update plants set last_watered_at = new.created_at where id = p.id;
  elsif new.kind = 'too_dry' then
    -- was eerder droog dan gepland: interval korter, en nu water gegeven
    update plants set learn_factor = greatest(0.5, learn_factor * 0.9), last_watered_at = new.created_at where id = p.id;
  elsif new.kind = 'still_wet' then
    -- grond nog vochtig: over 2 dagen opnieuw, interval iets langer
    update plants set learn_factor = least(2, learn_factor * 1.1),
                      next_water_at = new.created_at + interval '2 days'
    where id = p.id;
  end if;
  return new;
end $$;
create trigger care_event_apply after insert on public.care_events
  for each row execute function public.tg_care_event_apply();

-- ───────────────────────── RLS ─────────────────────────

alter table public.locations          enable row level security;
alter table public.location_members   enable row level security;
alter table public.floorplans         enable row level security;
alter table public.rooms              enable row level security;
alter table public.spots              enable row level security;
alter table public.plants             enable row level security;
alter table public.care_events        enable row level security;
alter table public.push_subscriptions enable row level security;

create policy loc_select on public.locations for select to authenticated
  using (public.is_member(id) or created_by = auth.uid());
create policy loc_insert on public.locations for insert to authenticated
  with check (created_by = auth.uid());
create policy loc_update on public.locations for update to authenticated
  using (public.is_member(id));
create policy loc_delete on public.locations for delete to authenticated
  using (exists (select 1 from public.location_members m
                 where m.location_id = id and m.user_id = auth.uid() and m.role = 'owner'));

create policy mem_select on public.location_members for select to authenticated
  using (public.is_member(location_id));
create policy mem_update_self on public.location_members for update to authenticated
  using (user_id = auth.uid());

-- Alle leden mogen alles binnen hun locatie.
create policy fp_all on public.floorplans for all to authenticated
  using (public.is_member(location_id)) with check (public.is_member(location_id));
create policy room_all on public.rooms for all to authenticated
  using (public.is_member(location_id)) with check (public.is_member(location_id));
create policy spot_all on public.spots for all to authenticated
  using (public.is_member(location_id))
  with check (exists (select 1 from public.rooms r where r.id = room_id and public.is_member(r.location_id)));
create policy plant_all on public.plants for all to authenticated
  using (public.is_member(location_id)) with check (public.is_member(location_id));
create policy ev_select on public.care_events for select to authenticated
  using (public.is_member(location_id));
create policy ev_insert on public.care_events for insert to authenticated
  with check (exists (select 1 from public.plants p where p.id = plant_id and public.is_member(p.location_id)));

create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────── Publieke RPC's (QR + iPad-kiosk) ─────────────────────────
-- Geen login nodig; toegang via het geheime token in de QR-code / kiosk-link.

create or replace function public.plant_public_json(p public.plants)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'species', p.species, 'common_name', p.common_name,
    'photo_path', p.photo_path, 'water_amount_ml', p.water_amount_ml, 'water_how', p.water_how,
    'care', p.care, 'last_watered_at', p.last_watered_at, 'next_water_at', p.next_water_at,
    'interval', public.plant_interval(p), 'qr_token', p.qr_token,
    'room', r.name, 'room_id', r.id, 'room_sort', r.sort, 'spot', s.name,
    'recent', coalesce((select jsonb_agg(e order by e.created_at desc) from (
        select kind, by_name, via, created_at from care_events
        where plant_id = p.id order by created_at desc limit 5) e), '[]'::jsonb)
  )
  from (select 1) x
  left join spots s on s.id = p.spot_id
  left join rooms r on r.id = s.room_id;
$$;
revoke execute on function public.plant_public_json(public.plants) from public, anon;

create or replace function public.qr_plant(token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.plant_public_json(p) || jsonb_build_object('location', l.name, 'location_emoji', l.emoji)
  from plants p join locations l on l.id = p.location_id
  where p.qr_token = token and not p.archived;
$$;

create or replace function public.kiosk_today(token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'location', jsonb_build_object('id', l.id, 'name', l.name, 'emoji', l.emoji),
    'plants', coalesce((select jsonb_agg(public.plant_public_json(p) order by p.next_water_at)
                        from plants p where p.location_id = l.id and not p.archived), '[]'::jsonb)
  )
  from locations l where l.kiosk_token = token;
$$;

-- Loggen via QR of kiosk. Dubbele tik binnen 10 minuten wordt genegeerd.
create or replace function public.public_log(token text, plant uuid, kind text, by_name text, via text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p plants;
begin
  if kind not in ('water','still_wet','too_dry') or via not in ('qr','kiosk') then
    raise exception 'ongeldige actie';
  end if;
  if via = 'qr' then
    select * into p from plants where qr_token = token and not archived;
  else
    select pl.* into p from plants pl join locations l on l.id = pl.location_id
    where l.kiosk_token = token and pl.id = plant and not pl.archived;
  end if;
  if not found then raise exception 'plant niet gevonden'; end if;

  if not exists (select 1 from care_events e where e.plant_id = p.id and e.kind = public_log.kind
                 and e.created_at > now() - interval '10 minutes') then
    insert into care_events (plant_id, kind, by_name, via, by_user)
    values (p.id, public_log.kind, nullif(left(trim(by_name), 40), ''), public_log.via, null);
  end if;
  select * into p from plants where id = p.id;
  return public.plant_public_json(p);
end $$;

grant execute on function public.qr_plant(text), public.kiosk_today(text),
  public.public_log(text, uuid, text, text, text) to anon, authenticated;

-- Voor ingelogde app: plant + uitleg in één keer.
create or replace function public.plant_explain(plant uuid)
returns jsonb language sql stable set search_path = public as $$
  select public.plant_interval(p) from plants p where p.id = plant;
$$;

-- ───────────────────────── Storage ─────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plant-photos', 'plant-photos', true, 5242880, array['image/jpeg','image/png','image/webp']),
       ('floorplans',   'floorplans',   false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Pad begint met de location_id: <location_id>/<bestand>
create policy "plant photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'plant-photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "plant photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'plant-photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "floorplans rw" on storage.objects for all to authenticated
  using (bucket_id = 'floorplans' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'floorplans' and public.is_member(((storage.foldername(name))[1])::uuid));

-- ───────────────────────── Realtime ─────────────────────────
alter publication supabase_realtime add table public.plants, public.care_events;
