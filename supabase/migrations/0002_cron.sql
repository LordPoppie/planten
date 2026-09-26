-- Elk uur de reminder-functie aanroepen; de functie verstuurt alleen om 08:00 NL-tijd.
-- Vooraf: in Vault een secret 'cron_secret' zetten (zelfde waarde als function secret CRON_SECRET)
--   select vault.create_secret('<waarde>', 'cron_secret');
-- en xmlneqznprlgdcbjbmxb hieronder vervangen.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'planten-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://xmlneqznprlgdcbjbmxb.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
