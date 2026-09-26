# Planten 🪴

Eigen plantenbeheer (vervanger van Planta) voor thuis en kantoor.
Locatie → ruimtes → plekken → planten. Je voert nooit een schema in: het water-interval wordt berekend uit soort × licht × verwarming/airco × seizoen × pot, en leert van de knoppen "Nog vochtig" / "Was al droog".

- **App (PWA):** `web/` — statisch, geen build-stap. Zonder ingevulde `config.js` draait hij in demo-modus (localStorage).
- **iPad-scherm:** `#/kiosk/<kiosk_token>` — publiek, toont wat vandaag water moet.
- **QR per pot:** `#/p/<qr_token>` — publiek: wanneer, hoeveel, hoe + aftikken.
- **Backend:** Supabase-project "It's Growing" — `supabase/migrations`, edge functions `identify-plant`, `parse-floorplan` (Claude vision), `send-reminders` (web push, 08:00).

## Lokaal draaien
    python3 -m http.server 5178 --directory web

## Secrets (edge functions)
`ANTHROPIC_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.
