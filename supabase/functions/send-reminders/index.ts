// Dagelijkse push: per gebruiker per locatie één melding met de planten die vandaag water moeten.
// Wordt elk uur door pg_cron aangeroepen; verstuurt alleen om 08:00 Nederlandse tijd (of met ?force=1).
import webpush from "npm:web-push@3";
import { adminClient, cors, json } from "../_shared/common.ts";

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:planten@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const SEND_HOUR = 8;

function amsterdam(d = new Date()) {
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam", hour: "numeric", hour12: false,
  }).formatToParts(d);
  return Number(parts.find((p) => p.type === "hour")!.value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  if (!force && amsterdam() !== SEND_HOUR) return json({ skipped: true });

  const db = adminClient();
  // Alles wat vóór morgen 00:00 aan de beurt is (ruim genomen: +16 uur vanaf 08:00).
  const until = new Date(Date.now() + 16 * 3600_000).toISOString();

  const [{ data: subs }, { data: members }, { data: due }] = await Promise.all([
    db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth"),
    db.from("location_members").select("location_id,user_id,locations(name,emoji)"),
    db.from("plants").select("id,name,location_id").eq("archived", false).lte("next_water_at", until),
  ]);

  const dueByLoc = new Map<string, string[]>();
  for (const p of due ?? []) {
    dueByLoc.set(p.location_id, [...(dueByLoc.get(p.location_id) ?? []), p.name]);
  }

  let sent = 0;
  const dead: string[] = [];
  for (const sub of subs ?? []) {
    for (const m of (members ?? []).filter((m) => m.user_id === sub.user_id)) {
      const names = dueByLoc.get(m.location_id);
      if (!names?.length) continue;
      // deno-lint-ignore no-explicit-any
      const loc = m.locations as any;
      const payload = JSON.stringify({
        title: `${loc.emoji} ${loc.name}: ${names.length} ${names.length === 1 ? "plant" : "planten"} water`,
        body: names.slice(0, 4).join(", ") + (names.length > 4 ? ` en nog ${names.length - 4}` : ""),
        url: `#/loc/${m.location_id}`,
        tag: `water-${m.location_id}`,
      });
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(sub.id);
      }
    }
  }
  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);

  // Later: Slack-webhook per locatie kan hier naast de push.
  return json({ sent, removed: dead.length });
});
