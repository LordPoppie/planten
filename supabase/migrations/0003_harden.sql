-- Beveiliging: alleen de bewust publieke RPC's (qr_plant, kiosk_today, public_log) blijven voor anon.
revoke execute on function public.tg_location_owner()   from public, anon, authenticated;
revoke execute on function public.tg_care_event_apply() from public, anon, authenticated;
revoke execute on function public.tg_spot_location()    from public, anon, authenticated;
revoke execute on function public.tg_event_location()   from public, anon, authenticated;
revoke execute on function public.tg_plant_schedule()   from public, anon, authenticated;
revoke execute on function public.plant_public_json(public.plants) from public, anon, authenticated;
revoke execute on function public.is_member(uuid) from public, anon;
grant  execute on function public.is_member(uuid) to authenticated;
