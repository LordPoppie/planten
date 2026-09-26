// Datalaag: Supabase als het geconfigureerd is, anders een demo in deze browser (localStorage).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const DEMO = !SUPABASE_URL || SUPABASE_URL.includes("<");
export const sb = DEMO ? null : createClient(SUPABASE_URL, SUPABASE_KEY);

// ───────────── Gedeelde regels ─────────────

/** Standaardplekken voor een nieuwe ruimte, op basis van ramen. */
export function defaultSpots(room) {
  const dir = room.windows?.[0] ?? null;
  const noWindowKinds = ["hal", "badkamer", "toilet", "opslag"];
  if (!room.windows?.length && noWindowKinds.includes(room.kind)) {
    return [{ name: "In de ruimte", light: "low", window_dir: null }];
  }
  const atWindow = !dir ? "bright_indirect" : dir === "Z" ? "direct" : ["N", "NO", "NW"].includes(dir) ? "medium" : "bright_indirect";
  const away = dir && ["N", "NO", "NW"].includes(dir) ? "low" : "medium";
  return [
    { name: "Bij het raam", light: atWindow, window_dir: dir },
    { name: "Verder van het raam", light: away, window_dir: dir },
  ];
}

/** Lichtwaarde voor "Bij het raam" als de raamrichting verandert. */
export function lightForWindow(dir) {
  return defaultSpots({ windows: dir ? [dir] : [] })[0].light;
}

// Spiegel van public.plant_interval() — alleen gebruikt in demo-modus.
function intervalJS(p, spot, at = new Date()) {
  const m = at.getMonth() + 1;
  let total = 1;
  const factors = [];
  const add = (label, f) => { total *= f; factors.push({ label, f }); };
  if (spot) {
    if (spot.light === "low") add("weinig licht", 1.3);
    if (spot.light === "bright_indirect") add("veel licht", 0.9);
    if (spot.light === "direct") add("direct zonlicht", 0.8);
    if (spot.near_heater && [10, 11, 12, 1, 2, 3, 4].includes(m)) add("bij verwarming (stookseizoen)", 0.75);
    if (spot.near_ac && [5, 6, 7, 8, 9].includes(m)) add("bij airco (droge lucht)", 0.85);
  }
  if ([11, 12, 1, 2].includes(m)) add("winterrust", 1.4);
  else if ([3, 10].includes(m)) add("winterrust", 1.15);
  else if ([5, 6, 7, 8].includes(m)) add("zomer: groeit hard", 0.85);
  if (p.pot_material === "terracotta") add("terracotta pot", 0.85);
  if (p.pot_material === "glazed") add("geglazuurde pot", 1.05);
  if (p.pot_material === "self_watering") add("zelfwaterende pot", 1.6);
  if (p.pot_size === "small") add("kleine pot", 0.85);
  if (p.pot_size === "large") add("grote pot", 1.15);
  if (p.learn_factor !== 1) add("geleerd van jouw feedback", Math.round(p.learn_factor * 100) / 100);
  return { base: p.base_interval_days, days: Math.max(1, Math.round(p.base_interval_days * total)), factors };
}

const uid = () => crypto.randomUUID();
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const days = (n) => new Date(Date.now() + n * 864e5).toISOString();

// ───────────── Supabase ─────────────

function must({ data, error }) {
  if (error) throw error;
  return data;
}

const remote = {
  async session() {
    return (await sb.auth.getSession()).data.session;
  },
  onAuth(cb) {
    sb.auth.onAuthStateChange((_e, s) => cb(s));
  },
  signIn(email) {
    return sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  },
  signOut() {
    return sb.auth.signOut();
  },

  async locations() {
    return must(await sb.from("locations").select("*").order("created_at"));
  },
  async createLocation(name, emoji) {
    return must(await sb.from("locations").insert({ name, emoji }).select().single());
  },
  async updateLocation(id, patch) {
    return must(await sb.from("locations").update(patch).eq("id", id).select().single());
  },

  async loadLocation(id) {
    const [rooms, spots, plants, floorplans] = await Promise.all([
      sb.from("rooms").select("*").eq("location_id", id).order("sort").order("created_at"),
      sb.from("spots").select("*").eq("location_id", id).order("created_at"),
      sb.from("plants").select("*").eq("location_id", id).eq("archived", false).order("next_water_at"),
      sb.from("floorplans").select("*").eq("location_id", id).order("sort"),
    ]);
    return { rooms: must(rooms), spots: must(spots), plants: must(plants), floorplans: must(floorplans) };
  },

  async createRooms(locationId, rooms) {
    const base = rooms.map((r, i) => ({
      location_id: locationId, name: r.name, kind: r.kind ?? null, polygon: r.polygon ?? null,
      windows: r.windows ?? [], floorplan_id: r.floorplan_id ?? null, sort: r.sort ?? i,
    }));
    const created = must(await sb.from("rooms").insert(base).select());
    const spots = created.flatMap((room) => defaultSpots(room).map((s) => ({ ...s, room_id: room.id, location_id: locationId })));
    if (spots.length) must(await sb.from("spots").insert(spots));
    return created;
  },
  async updateRoom(id, patch) {
    return must(await sb.from("rooms").update(patch).eq("id", id).select().single());
  },
  async deleteRoom(id) {
    must(await sb.from("rooms").delete().eq("id", id));
  },

  async createSpot(spot) {
    return must(await sb.from("spots").insert(spot).select().single());
  },
  async updateSpot(id, patch) {
    return must(await sb.from("spots").update(patch).eq("id", id).select().single());
  },
  async deleteSpot(id) {
    must(await sb.from("spots").delete().eq("id", id));
  },

  async createPlant(p) {
    return must(await sb.from("plants").insert(p).select().single());
  },
  async updatePlant(id, patch) {
    return must(await sb.from("plants").update(patch).eq("id", id).select().single());
  },
  async log(plantId, kind, byName) {
    must(await sb.from("care_events").insert({ plant_id: plantId, kind, by_name: byName || null, via: "app" }));
    return must(await sb.from("plants").select("*").eq("id", plantId).single());
  },
  async events(plantId) {
    return must(await sb.from("care_events").select("*").eq("plant_id", plantId).order("created_at", { ascending: false }).limit(20));
  },
  async explain(plant) {
    return must(await sb.rpc("plant_explain", { plant: plant.id }));
  },

  async uploadPhoto(locationId, blob) {
    const path = `${locationId}/${uid()}.jpg`;
    must(await sb.storage.from("plant-photos").upload(path, blob, { contentType: "image/jpeg" }));
    return path;
  },
  photoUrl(path) {
    return path ? sb.storage.from("plant-photos").getPublicUrl(path).data.publicUrl : null;
  },
  async createFloorplan(locationId, blob, aspect, name) {
    const path = `${locationId}/${uid()}.jpg`;
    must(await sb.storage.from("floorplans").upload(path, blob, { contentType: "image/jpeg" }));
    return must(await sb.from("floorplans").insert({ location_id: locationId, image_path: path, aspect, name }).select().single());
  },
  async floorplanUrl(fp) {
    return must(await sb.storage.from("floorplans").createSignedUrl(fp.image_path, 3600)).signedUrl;
  },

  async identify(base64) {
    return must(await sb.functions.invoke("identify-plant", { body: { image: base64, media_type: "image/jpeg" } }));
  },
  async parseFloorplan(base64) {
    return must(await sb.functions.invoke("parse-floorplan", { body: { image: base64, media_type: "image/jpeg" } }));
  },

  async kiosk(token) {
    return must(await sb.rpc("kiosk_today", { token }));
  },
  async qr(token) {
    return must(await sb.rpc("qr_plant", { token }));
  },
  async publicLog(token, plantId, kind, byName, via) {
    return must(await sb.rpc("public_log", { token, plant: plantId, kind, by_name: byName ?? "", via }));
  },

  async savePush(sub) {
    const j = sub.toJSON();
    must(await sb.from("push_subscriptions").upsert(
      { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: "endpoint" },
    ));
  },
  async deletePush(endpoint) {
    must(await sb.from("push_subscriptions").delete().eq("endpoint", endpoint));
  },

  subscribe(locationId, onChange) {
    const ch = sb.channel(`loc-${locationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "plants", filter: `location_id=eq.${locationId}` }, onChange)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "care_events", filter: `location_id=eq.${locationId}` }, onChange)
      .subscribe();
    return () => sb.removeChannel(ch);
  },
};

// ───────────── Demo (localStorage) ─────────────

const KEY = "planten_demo_v1";
function seed() {
  const home = { id: uid(), name: "Thuis", emoji: "🏠", kiosk_token: hex(12), created_at: days(0) };
  const office = { id: uid(), name: "Kantoor Figeeweg", emoji: "🏢", kiosk_token: hex(12), created_at: days(0) };
  const rooms = [];
  const spots = [];
  const mkRoom = (loc, name, kind, windows, sort) => {
    const r = { id: uid(), location_id: loc.id, name, kind, windows, polygon: null, floorplan_id: null, sort };
    rooms.push(r);
    for (const s of defaultSpots(r)) spots.push({ id: uid(), room_id: r.id, location_id: loc.id, near_heater: false, near_ac: false, ...s });
    return r;
  };
  const wk = mkRoom(home, "Woonkamer", "woonkamer", ["Z"], 0);
  const kk = mkRoom(home, "Keuken", "keuken", ["N"], 1);
  const sk = mkRoom(home, "Slaapkamer", "slaapkamer", ["O"], 2);
  const kt = mkRoom(office, "Kantoor", "kantoor", ["W"], 0);
  const vg = mkRoom(office, "Vergaderruimte", "vergaderruimte", ["Z"], 1);
  spots.find((s) => s.room_id === wk.id && s.name === "Verder van het raam").near_heater = true;
  spots.find((s) => s.room_id === kt.id && s.name === "Bij het raam").near_ac = true;
  const at = (room, name) => spots.find((s) => s.room_id === room.id && s.name === name).id;

  const mk = (loc, spot, name, species, common, emoji, base, ml, lastDaysAgo, extra = {}) => ({
    id: uid(), location_id: loc.id, spot_id: spot, name, species, common_name: common, photo_path: null, emoji,
    pot_material: "plastic", pot_size: "medium", base_interval_days: base, water_amount_ml: ml,
    water_how: "Giet tot het onderin uitloopt; schotel na 15 minuten legen.",
    care: { dry_check: "Voel met je vinger: bovenste 2–3 cm droog? Dan water.", tips: ["Draai de pot elke maand een kwartslag."], toxic_pets: true, fertilize_weeks: 4, light_need: "bright_indirect" },
    learn_factor: 1, last_watered_at: lastDaysAgo == null ? null : days(-lastDaysAgo), next_water_at: null,
    qr_token: hex(8), archived: false, created_at: days(-30), ...extra,
  });
  const plants = [
    mk(home, at(wk, "Bij het raam"), "Grote Monstera", "Monstera deliciosa", "Gatenplant", "🌿", 8, 400, 9),
    mk(home, at(wk, "Verder van het raam"), "Calathea", "Goeppertia orbifolia", "Calathea", "🍃", 5, 250, 4),
    mk(home, at(kk, "Bij het raam"), "Basilicum", "Ocimum basilicum", "Basilicum", "🌱", 3, 150, 1, { care: { tips: ["Knip boven een blad­paar, dan wordt hij voller."], toxic_pets: false, fertilize_weeks: 2 } }),
    mk(home, at(sk, "Verder van het raam"), "Sansevieria", "Dracaena trifasciata", "Vrouwentong", "🪴", 14, 200, 6, { pot_material: "terracotta" }),
    mk(office, at(kt, "Bij het raam"), "Ficus bij het raam", "Ficus lyrata", "Vioolbladplant", "🌳", 7, 500, 8, { pot_size: "large" }),
    mk(office, at(vg, "Verder van het raam"), "Pothos", "Epipremnum aureum", "Drakenklimop", "🌿", 7, 300, 2),
    mk(office, at(kt, "Verder van het raam"), "ZZ-plant", "Zamioculcas zamiifolia", "ZZ-plant", "🪴", 18, 300, null),
  ];
  const db = { locations: [home, office], rooms, spots, plants, floorplans: [], events: [], photos: {} };
  for (const p of db.plants) schedule(db, p);
  return db;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* leeg of geblokkeerd */ }
  const db = seed();
  save(db);
  return db;
}
function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* quota/blocked */ }
}
function schedule(db, p) {
  const spot = db.spots.find((s) => s.id === p.spot_id);
  if (p.last_watered_at) {
    p.next_water_at = new Date(new Date(p.last_watered_at).getTime() + intervalJS(p, spot).days * 864e5).toISOString();
  } else if (!p.next_water_at) {
    p.next_water_at = new Date().toISOString();
  }
}
function publicJSON(db, p) {
  const spot = db.spots.find((s) => s.id === p.spot_id);
  const room = spot && db.rooms.find((r) => r.id === spot.room_id);
  return {
    ...p, interval: intervalJS(p, spot), room: room?.name, room_id: room?.id, room_sort: room?.sort, spot: spot?.name,
    recent: db.events.filter((e) => e.plant_id === p.id).slice(0, 5),
  };
}
function applyEvent(db, p, kind) {
  const now = new Date().toISOString();
  if (kind === "water") p.last_watered_at = now;
  if (kind === "too_dry") { p.learn_factor = Math.max(0.5, p.learn_factor * 0.9); p.last_watered_at = now; }
  if (kind === "still_wet") { p.learn_factor = Math.min(2, p.learn_factor * 1.1); p.next_water_at = days(2); return; }
  schedule(db, p);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));

const demo = {
  async session() { return { user: { id: "demo", email: "demo@planten.local" } }; },
  onAuth() {},
  async signIn() { return {}; },
  async signOut() { localStorage.removeItem(KEY); },

  async locations() { return clone(load().locations); },
  async createLocation(name, emoji) {
    const db = load();
    const l = { id: uid(), name, emoji, kiosk_token: hex(12), created_at: new Date().toISOString() };
    db.locations.push(l); save(db); return l;
  },
  async updateLocation(id, patch) {
    const db = load(); const l = db.locations.find((x) => x.id === id); Object.assign(l, patch); save(db); return l;
  },
  async loadLocation(id) {
    const db = load();
    return clone({
      rooms: db.rooms.filter((r) => r.location_id === id).sort((a, b) => a.sort - b.sort),
      spots: db.spots.filter((s) => s.location_id === id),
      plants: db.plants.filter((p) => p.location_id === id && !p.archived).sort((a, b) => a.next_water_at.localeCompare(b.next_water_at)),
      floorplans: db.floorplans.filter((f) => f.location_id === id),
    });
  },
  async createRooms(locationId, rooms) {
    const db = load();
    const start = db.rooms.filter((r) => r.location_id === locationId).length;
    const created = rooms.map((r, i) => ({ id: uid(), location_id: locationId, name: r.name, kind: r.kind ?? null, polygon: r.polygon ?? null, windows: r.windows ?? [], floorplan_id: r.floorplan_id ?? null, sort: start + i }));
    db.rooms.push(...created);
    for (const room of created) for (const s of defaultSpots(room)) db.spots.push({ id: uid(), room_id: room.id, location_id: locationId, near_heater: false, near_ac: false, ...s });
    save(db); return created;
  },
  async updateRoom(id, patch) { const db = load(); const r = db.rooms.find((x) => x.id === id); Object.assign(r, patch); save(db); return r; },
  async deleteRoom(id) {
    const db = load(); const spotIds = db.spots.filter((s) => s.room_id === id).map((s) => s.id);
    db.rooms = db.rooms.filter((r) => r.id !== id); db.spots = db.spots.filter((s) => s.room_id !== id);
    for (const p of db.plants) if (spotIds.includes(p.spot_id)) p.spot_id = null;
    save(db);
  },
  async createSpot(spot) {
    const db = load(); const room = db.rooms.find((r) => r.id === spot.room_id);
    const s = { id: uid(), near_heater: false, near_ac: false, light: "medium", window_dir: null, ...spot, location_id: room.location_id };
    db.spots.push(s); save(db); return s;
  },
  async updateSpot(id, patch) {
    const db = load(); const s = db.spots.find((x) => x.id === id); Object.assign(s, patch);
    for (const p of db.plants) if (p.spot_id === id) schedule(db, p);
    save(db); return s;
  },
  async deleteSpot(id) {
    const db = load(); db.spots = db.spots.filter((s) => s.id !== id);
    for (const p of db.plants) if (p.spot_id === id) p.spot_id = null;
    save(db);
  },
  async createPlant(p) {
    const db = load();
    const plant = { id: uid(), learn_factor: 1, qr_token: hex(8), archived: false, care: {}, pot_material: "plastic", pot_size: "medium", base_interval_days: 7, created_at: new Date().toISOString(), next_water_at: null, ...p };
    schedule(db, plant); db.plants.push(plant); save(db); return plant;
  },
  async updatePlant(id, patch) {
    const db = load(); const p = db.plants.find((x) => x.id === id); Object.assign(p, patch); schedule(db, p); save(db); return clone(p);
  },
  async log(plantId, kind, byName) {
    const db = load(); const p = db.plants.find((x) => x.id === plantId);
    db.events.unshift({ id: uid(), plant_id: plantId, kind, by_name: byName || null, via: "app", created_at: new Date().toISOString() });
    applyEvent(db, p, kind); save(db); return clone(p);
  },
  async events(plantId) { return clone(load().events.filter((e) => e.plant_id === plantId).slice(0, 20)); },
  async explain(plant) { const db = load(); return intervalJS(plant, db.spots.find((s) => s.id === plant.spot_id)); },

  async uploadPhoto(_loc, blob) {
    const db = load(); const id = uid();
    db.photos[id] = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    save(db); return id;
  },
  photoUrl(path) { return path ? load().photos[path] ?? null : null; },
  async createFloorplan(locationId, blob, aspect, name) {
    const image_path = await demo.uploadPhoto(locationId, blob);
    const db = load(); const fp = { id: uid(), location_id: locationId, image_path, aspect, name, sort: db.floorplans.length };
    db.floorplans.push(fp); save(db); return fp;
  },
  async floorplanUrl(fp) { return demo.photoUrl(fp.image_path); },

  async identify() {
    await wait(1400);
    return {
      is_plant: true, species: "Monstera deliciosa", common_name: "Gatenplant", confidence: "hoog",
      alternatives: [{ species: "Thaumatophyllum bipinnatifidum", common_name: "Philodendron selloum" }],
      base_interval_days: 8, water_amount_ml: 350, water_how: "Giet tot het onderin uitloopt; schotel na 15 minuten legen.",
      dry_check: "Bovenste 3 cm droog? Dan water geven.", light_need: "bright_indirect", toxic_pets: true, fertilize_weeks: 4,
      tips: ["Stof de bladeren af met een vochtige doek.", "Luchtwortels mag je in de pot leiden."],
    };
  },
  async parseFloorplan() {
    await wait(2000);
    return {
      is_floorplan: true, north: "unknown",
      rooms: [
        { name: "Woonkamer", kind: "woonkamer", polygon: [{ x: .05, y: .05 }, { x: .6, y: .05 }, { x: .6, y: .55 }, { x: .05, y: .55 }], window_sides: ["top", "left"] },
        { name: "Keuken", kind: "keuken", polygon: [{ x: .6, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .4 }, { x: .6, y: .4 }], window_sides: ["top"] },
        { name: "Hal", kind: "hal", polygon: [{ x: .6, y: .4 }, { x: .95, y: .4 }, { x: .95, y: .55 }, { x: .6, y: .55 }], window_sides: [] },
        { name: "Slaapkamer", kind: "slaapkamer", polygon: [{ x: .05, y: .55 }, { x: .55, y: .55 }, { x: .55, y: .95 }, { x: .05, y: .95 }], window_sides: ["bottom"] },
        { name: "Badkamer", kind: "badkamer", polygon: [{ x: .55, y: .55 }, { x: .95, y: .55 }, { x: .95, y: .95 }, { x: .55, y: .95 }], window_sides: [] },
      ],
    };
  },

  async kiosk(token) {
    const db = load(); const l = db.locations.find((x) => x.kiosk_token === token);
    if (!l) return null;
    return clone({ location: l, plants: db.plants.filter((p) => p.location_id === l.id && !p.archived).map((p) => publicJSON(db, p)).sort((a, b) => a.next_water_at.localeCompare(b.next_water_at)) });
  },
  async qr(token) {
    const db = load(); const p = db.plants.find((x) => x.qr_token === token && !x.archived);
    if (!p) return null;
    const l = db.locations.find((x) => x.id === p.location_id);
    return clone({ ...publicJSON(db, p), location: l.name, location_emoji: l.emoji });
  },
  async publicLog(token, plantId, kind, byName, via) {
    const db = load();
    const p = via === "qr" ? db.plants.find((x) => x.qr_token === token)
      : db.plants.find((x) => x.id === plantId && db.locations.find((l) => l.kiosk_token === token)?.id === x.location_id);
    db.events.unshift({ id: uid(), plant_id: p.id, kind, by_name: byName || null, via, created_at: new Date().toISOString() });
    applyEvent(db, p, kind); save(db); return clone(publicJSON(db, p));
  },

  async savePush() {},
  async deletePush() {},
  subscribe() { return () => {}; },
};

export const api = DEMO ? demo : remote;
