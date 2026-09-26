import qrcode from "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm";
import { api, DEMO, lightForWindow } from "./data.js";
import { VAPID_PUBLIC_KEY } from "./config.js";

// ───────────── Hulpfuncties ─────────────

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const app = $("#app");

const LIGHT = {
  low: { label: "Weinig licht", icon: "🌥️" },
  medium: { label: "Middel", icon: "⛅" },
  bright_indirect: { label: "Veel licht", icon: "🌤️" },
  direct: { label: "Direct zon", icon: "☀️" },
};
const DIRS = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
const DIR_LABEL = { N: "noord", NO: "noordoost", O: "oost", ZO: "zuidoost", Z: "zuid", ZW: "zuidwest", W: "west", NW: "noordwest" };
const POT = { plastic: "Plastic", terracotta: "Terracotta", glazed: "Geglazuurd", self_watering: "Zelfwaterend" };
const SIZE = { small: "Klein (<12 cm)", medium: "Middel", large: "Groot (>25 cm)" };
const ROOM_PRESETS = {
  thuis: ["Woonkamer", "Keuken", "Slaapkamer", "Badkamer", "Werkkamer", "Hal", "Balkon"],
  kantoor: ["Kantoor", "Vergaderruimte", "Kantine", "Receptie", "Werkplaats", "Hal"],
};
const KIND_OF = (name) => {
  const n = name.toLowerCase();
  const kinds = ["woonkamer", "keuken", "slaapkamer", "badkamer", "toilet", "hal", "werkkamer", "kantoor", "vergaderruimte", "kantine", "receptie", "opslag"];
  return kinds.find((k) => n.includes(k)) ?? "overig";
};
const EVENT_LABEL = { water: "💧 Water gegeven", still_wet: "🤚 Grond nog vochtig", too_dry: "🏜️ Was al droog", fertilize: "🧪 Gevoed", repot: "🪴 Verpot", note: "📝 Notitie" };

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dayDiff(iso) { return Math.round((startOfDay(iso) - startOfDay(new Date())) / 864e5); }
function isDue(p) { return dayDiff(p.next_water_at) <= 0; }
function dueText(iso) {
  const d = dayDiff(iso);
  if (d < -1) return `${-d} dagen te laat`;
  if (d === -1) return "sinds gisteren";
  if (d === 0) return "vandaag";
  if (d === 1) return "morgen";
  if (d < 7) return new Date(iso).toLocaleDateString("nl-NL", { weekday: "long" });
  return `over ${d} dagen`;
}
function duePill(iso) {
  const d = dayDiff(iso);
  const cls = d < 0 ? "late" : d === 0 ? "water" : "ok";
  return `<span class="pill ${cls}">💧 ${esc(dueText(iso))}</span>`;
}
function ago(iso) {
  const d = -dayDiff(iso);
  if (d <= 0) return "vandaag";
  if (d === 1) return "gisteren";
  return `${d} dagen geleden`;
}
function today() { return new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }); }
function plantEmoji(p) { return p.emoji ?? "🪴"; }
function img(p, cls = "") {
  const url = api.photoUrl(p.photo_path);
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">` : plantEmoji(p);
}
function pct(f) { const v = Math.round((f - 1) * 100); return v > 0 ? `+${v}%` : `${v}%`; }
function whyChips(interval) {
  if (!interval?.factors?.length) return "";
  return `<div class="why">${interval.factors.map((f) => `<span>${esc(f.label)} ${pct(f.f)}</span>`).join("")}</div>`;
}
function amountText(p) { return p.water_amount_ml ? `${p.water_amount_ml} ml` : "Scheut water"; }

function toast(msg) {
  $(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}
function sheet(html, onMount) {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const close = () => scrim.remove();
  scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.closest("[data-close]")) close(); });
  document.body.append(scrim);
  onMount?.($(".sheet", scrim), close);
  return close;
}
function qrSvg(text, cell = 4) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}
function baseUrl() { return location.origin + location.pathname; }
function qrUrl(p) { return `${baseUrl()}#/p/${p.qr_token}`; }
function kioskUrl(l) { return `${baseUrl()}#/kiosk/${l.kiosk_token}`; }

/** Verkleint een foto naar max `max` px JPEG. */
async function downscale(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { blob, dataUrl, base64: dataUrl.split(",")[1], aspect: w / h };
}

function myName() { try { return localStorage.getItem("planten_name") || ""; } catch { return ""; } }
function setMyName(n) { try { localStorage.setItem("planten_name", n); } catch { /* */ } }
function lastLoc() { try { return localStorage.getItem("planten_loc"); } catch { return null; } }
function setLastLoc(id) { try { localStorage.setItem("planten_loc", id); } catch { /* */ } }

// ───────────── State ─────────────

const state = { session: null, locations: [], loc: null, data: null, unsub: null };

async function ensureLocation(id) {
  if (!state.locations.length) state.locations = await api.locations();
  const loc = state.locations.find((l) => l.id === id);
  if (!loc) return false;
  if (state.loc?.id !== id || !state.data) {
    state.loc = loc;
    setLastLoc(id);
    state.data = await api.loadLocation(id);
    state.unsub?.();
    let t;
    state.unsub = api.subscribe(id, () => {
      clearTimeout(t);
      t = setTimeout(async () => { state.data = await api.loadLocation(id); route(); }, 400);
    });
  }
  return true;
}
async function refresh() { state.data = await api.loadLocation(state.loc.id); }
const spotOf = (p) => state.data.spots.find((s) => s.id === p.spot_id);
const roomOf = (spot) => spot && state.data.rooms.find((r) => r.id === spot.room_id);
const whereText = (p) => { const s = spotOf(p); const r = roomOf(s); return r ? `${r.name} · ${s.name}` : "Nog geen plek"; };

// ───────────── Layout ─────────────

function shell(tab, content) {
  const l = state.loc;
  const t = (id, icon, label, href) => `<a class="tab ${tab === id ? "on" : ""}" href="${href}"><span class="ic">${icon}</span>${label}</a>`;
  app.innerHTML = `
    <div class="topbar"><div class="inner">
      <button class="loc-switch" id="locSwitch"><span>${esc(l.emoji)}</span>${esc(l.name)}<span class="caret">▾</span></button>
      <span class="grow"></span>
      ${DEMO ? `<span class="pill water">Demo</span>` : ""}
    </div></div>
    <main class="wrap">${content}</main>
    <nav class="tabbar"><div class="inner">
      ${t("today", "💧", "Vandaag", `#/loc/${l.id}`)}
      ${t("rooms", "🏡", "Ruimtes", `#/loc/${l.id}/rooms`)}
      <a class="tab add" href="#/loc/${l.id}/add"><span class="ic">＋</span>Plant</a>
      ${t("plants", "🪴", "Planten", `#/loc/${l.id}/plants`)}
      ${t("more", "⋯", "Meer", `#/loc/${l.id}/more`)}
    </div></nav>`;
  $("#locSwitch").onclick = locationPicker;
}

function locationPicker() {
  sheet(`
    <h2>Locatie</h2>
    <div class="list">
      ${state.locations.map((l) => `
        <a class="card pad row" href="#/loc/${l.id}" data-close style="text-decoration:none;color:inherit">
          <span style="font-size:24px">${esc(l.emoji)}</span><strong class="grow">${esc(l.name)}</strong>
          ${l.id === state.loc?.id ? `<span class="pill ok">actief</span>` : ""}
        </a>`).join("")}
    </div>
    <p><a class="btn block" href="#/new-location" data-close>＋ Nieuwe locatie</a></p>`);
}

// ───────────── Vandaag ─────────────

function plantCard(p) {
  return `
    <div class="card plant-card" data-id="${p.id}">
      <a href="#/loc/${state.loc.id}/plant/${p.id}" class="thumb">${img(p)}</a>
      <div>
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${esc(whereText(p))}</div>
        <div class="row" style="margin-top:4px">${duePill(p.next_water_at)}<span class="small muted">${esc(amountText(p))}</span></div>
      </div>
      <div class="actions">
        <button class="btn water" data-log="water">💧 Gedaan</button>
        <button class="btn" data-log="still_wet">Nog vochtig</button>
      </div>
    </div>`;
}

function viewToday() {
  const plants = state.data.plants;
  const due = plants.filter(isDue);
  const soon = plants.filter((p) => !isDue(p) && dayDiff(p.next_water_at) <= 3);
  const byRoom = new Map();
  for (const p of due) {
    const r = roomOf(spotOf(p));
    const key = r?.name ?? "Zonder plek";
    byRoom.set(key, [...(byRoom.get(key) ?? []), p]);
  }
  const next = plants.find((p) => !isDue(p));

  let body = `<h1>Vandaag</h1><p class="sub">${esc(today())}${due.length ? ` · ${due.length} ${due.length === 1 ? "plant heeft" : "planten hebben"} dorst` : ""}</p>`;
  if (!plants.length) {
    body += `<div class="empty"><div class="big">🌱</div><p>Nog geen planten op deze locatie.</p>
      <p><a class="btn primary" href="#/loc/${state.loc.id}/add">＋ Eerste plant toevoegen</a></p>
      ${state.data.rooms.length ? "" : `<p class="small">Tip: maak eerst je <a href="#/loc/${state.loc.id}/rooms">ruimtes</a> aan.</p>`}</div>`;
  } else if (!due.length) {
    body += `<div class="empty"><div class="big">🌿</div><p><strong>Niemand heeft dorst.</strong></p>
      ${next ? `<p class="small">Volgende: ${esc(next.name)}, ${esc(dueText(next.next_water_at))}.</p>` : ""}</div>`;
  } else {
    for (const [room, list] of byRoom) body += `<h3>${esc(room)}</h3><div class="list">${list.map(plantCard).join("")}</div>`;
  }
  if (soon.length) {
    body += `<h3>Binnenkort</h3><div class="list">${soon.map((p) => `
      <a class="card row" style="padding:10px;text-decoration:none;color:inherit" href="#/loc/${state.loc.id}/plant/${p.id}">
        <span class="thumb" style="width:44px;height:44px;font-size:22px">${img(p)}</span>
        <span class="grow"><strong>${esc(p.name)}</strong><br><span class="small muted">${esc(whereText(p))}</span></span>
        ${duePill(p.next_water_at)}
      </a>`).join("")}</div>`;
  }
  shell("today", body);
  bindLogButtons(app);
}

function bindLogButtons(root) {
  $$("[data-log]", root).forEach((b) => b.addEventListener("click", async () => {
    const card = b.closest("[data-id]");
    const id = card.dataset.id;
    const kind = b.dataset.log;
    $$("button", card).forEach((x) => (x.disabled = true));
    try {
      const p = await api.log(id, kind, myName());
      card.classList.add("leaving");
      toast(kind === "still_wet" ? `Oké, ${p.name} over 2 dagen weer` : `${p.name}: volgende keer ${dueText(p.next_water_at)}`);
      await refresh();
      setTimeout(route, 350);
    } catch (e) {
      $$("button", card).forEach((x) => (x.disabled = false));
      toast(`Mislukt: ${e.message}`);
    }
  }));
}

// ───────────── Planten ─────────────

function viewPlants(q = "") {
  const { plants, rooms } = state.data;
  const filter = q;
  const list = plants.filter((p) => !filter || roomOf(spotOf(p))?.id === filter);
  shell("plants", `
    <h1>Planten</h1><p class="sub">${plants.length} op ${esc(state.loc.name)}</p>
    ${rooms.length > 1 ? `<div class="chips" style="margin-bottom:14px">
      <a class="chip ${!filter ? "on" : ""}" href="#/loc/${state.loc.id}/plants">Alles</a>
      ${rooms.map((r) => `<a class="chip ${filter === r.id ? "on" : ""}" href="#/loc/${state.loc.id}/plants?room=${r.id}">${esc(r.name)}</a>`).join("")}
    </div>` : ""}
    ${list.length ? `<div class="grid-plants">${list.map((p) => `
      <a class="card tile" href="#/loc/${state.loc.id}/plant/${p.id}">
        <div class="img">${img(p)}</div>
        <div class="body"><div class="name">${esc(p.name)}</div>${duePill(p.next_water_at)}</div>
      </a>`).join("")}</div>`
      : `<div class="empty"><div class="big">🪴</div><p>Hier staan nog geen planten.</p></div>`}`);
}

// ───────────── Plant detail ─────────────

async function viewPlant(id) {
  const p = state.data.plants.find((x) => x.id === id);
  if (!p) return (location.hash = `#/loc/${state.loc.id}/plants`);
  const [interval, events] = await Promise.all([api.explain(p), api.events(p.id)]);
  const care = p.care ?? {};
  shell("plants", `
    <div class="hero">${img(p)}</div>
    <h1 style="margin-top:16px">${esc(p.name)}</h1>
    <p class="sub">${p.common_name ? esc(p.common_name) : ""}${p.species ? ` · <em>${esc(p.species)}</em>` : ""}<br>${esc(whereText(p))}</p>

    <div class="status">
      <div class="card"><div class="k">Volgende keer water</div><div class="v">${esc(dueText(p.next_water_at))}</div>
        <div class="small muted">${new Date(p.next_water_at).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}</div></div>
      <div class="card"><div class="k">Hoeveel</div><div class="v">${esc(amountText(p))}</div>
        <div class="small muted">${p.last_watered_at ? `laatst ${esc(ago(p.last_watered_at))}` : "nog niet gelogd"}</div></div>
    </div>

    <div class="card pad" data-id="${p.id}">
      <strong>Om de ${interval.days} dagen</strong> <span class="muted small">(basis ${interval.base})</span>
      ${whyChips(interval)}
      ${p.water_how ? `<p class="small" style="margin:12px 0 0">${esc(p.water_how)}</p>` : ""}
      ${care.dry_check ? `<p class="small muted" style="margin:6px 0 0">${esc(care.dry_check)}</p>` : ""}
      <div class="row" style="margin-top:14px">
        <button class="btn water grow" data-log="water">💧 Water gegeven</button>
        <button class="btn" data-log="still_wet">Nog vochtig</button>
        <button class="btn" data-log="too_dry">Was al droog</button>
      </div>
    </div>

    ${care.tips?.length || care.toxic_pets ? `<h2>Tips</h2><div class="card pad small">
      ${care.toxic_pets ? `<p style="margin-top:0">⚠️ Giftig voor huisdieren.</p>` : ""}
      ${(care.tips ?? []).map((t) => `<p style="margin:6px 0">• ${esc(t)}</p>`).join("")}
      ${care.fertilize_weeks ? `<p class="muted" style="margin-bottom:0">Voeden: om de ${care.fertilize_weeks} weken in het groeiseizoen.</p>` : ""}
    </div>` : ""}

    <h2>Geschiedenis</h2>
    ${events.length ? `<ul class="history">${events.map((e) => `<li><span class="grow">${EVENT_LABEL[e.kind]}${e.by_name ? ` <span class="muted">· ${esc(e.by_name)}</span>` : ""}${e.via !== "app" ? ` <span class="muted">· via ${e.via === "qr" ? "QR" : "iPad"}</span>` : ""}</span><span class="muted small">${esc(ago(e.created_at))}</span></li>`).join("")}</ul>`
      : `<p class="muted small">Nog niets gelogd.</p>`}

    <div class="row" style="margin-top:24px">
      <button class="btn grow" id="edit">✏️ Bewerken / verplaatsen</button>
      <button class="btn grow" id="qr">▦ QR-code</button>
    </div>`);

  bindLogButtons(app);
  $("#edit").onclick = () => editPlant(p);
  $("#qr").onclick = () => sheet(`
    <h2>${esc(p.name)}</h2>
    <p class="sub">Plak deze code op de pot. Iedereen die scant ziet wanneer, hoeveel en hoe, zonder account.</p>
    <div class="qr-box qr">${qrSvg(qrUrl(p))}</div>
    <p class="row" style="justify-content:center;margin-top:16px">
      <a class="btn" href="${esc(qrUrl(p))}" target="_blank">Open pagina</a>
      <a class="btn primary" href="#/loc/${state.loc.id}/stickers?plant=${p.id}" data-close>🖨️ Printen</a>
    </p>`);
}

function spotPicker(selected, onPick) {
  const { rooms, spots } = state.data;
  if (!rooms.length) return `<p class="muted small">Nog geen ruimtes. <a href="#/loc/${state.loc.id}/rooms">Maak eerst ruimtes aan</a>.</p>`;
  const selSpot = spots.find((s) => s.id === selected);
  const selRoom = selSpot?.room_id ?? rooms[0].id;
  return `
    <div class="chips" id="roomChips">${rooms.map((r) => `<button type="button" class="chip ${r.id === selRoom ? "on" : ""}" data-room="${r.id}">${esc(r.name)}</button>`).join("")}</div>
    <div class="chips" id="spotChips" style="margin-top:10px"></div>`;
}
function bindSpotPicker(root, selected, onPick) {
  const { rooms, spots } = state.data;
  if (!rooms.length) return;
  let room = spots.find((s) => s.id === selected)?.room_id ?? rooms[0].id;
  let spot = selected;
  const renderSpots = () => {
    const list = spots.filter((s) => s.room_id === room);
    $("#spotChips", root).innerHTML = list.map((s) => `
      <button type="button" class="chip ${s.id === spot ? "on" : ""}" data-spot="${s.id}">${LIGHT[s.light].icon} ${esc(s.name)}${s.near_heater ? " 🔥" : ""}${s.near_ac ? " ❄️" : ""}</button>`).join("")
      + `<button type="button" class="chip dashed" data-newspot>＋ Andere plek</button>`;
    $$("[data-spot]", root).forEach((b) => (b.onclick = () => { spot = b.dataset.spot; onPick(spot); renderSpots(); }));
    $("[data-newspot]", root).onclick = () => editSpot({ room_id: room }, async (s) => { spots.push(s); spot = s.id; onPick(spot); renderSpots(); });
  };
  $$("[data-room]", root).forEach((b) => (b.onclick = () => {
    room = b.dataset.room;
    $$("[data-room]", root).forEach((x) => x.classList.toggle("on", x === b));
    const first = spots.find((s) => s.room_id === room);
    spot = first?.id ?? null; onPick(spot); renderSpots();
  }));
  if (!spot) { spot = spots.find((s) => s.room_id === room)?.id ?? null; onPick(spot); }
  renderSpots();
}

function editPlant(p) {
  let spotId = p.spot_id;
  sheet(`
    <h2>Bewerken</h2>
    <label class="field"><span>Naam</span><input type="text" id="n" value="${esc(p.name)}"></label>
    <div class="field"><span class="muted small" style="font-weight:600">Waar staat hij?</span>${spotPicker(p.spot_id)}</div>
    <label class="field"><span>Pot</span><select id="pm">${Object.entries(POT).map(([k, v]) => `<option value="${k}" ${p.pot_material === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="field"><span>Potmaat</span><select id="ps">${Object.entries(SIZE).map(([k, v]) => `<option value="${k}" ${p.pot_size === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="field"><span>Basis-interval (dagen, vóór correcties)</span><input type="number" id="bi" min="1" max="90" value="${p.base_interval_days}"></label>
    <label class="field"><span>Hoeveelheid water (ml)</span><input type="number" id="ml" min="0" step="50" value="${p.water_amount_ml ?? ""}"></label>
    <div class="row" style="margin-top:18px">
      <button class="btn ghost" id="arch">Archiveren</button><span class="grow"></span>
      <button class="btn" data-close>Annuleren</button><button class="btn primary" id="save">Opslaan</button>
    </div>`, (root, close) => {
    bindSpotPicker(root, p.spot_id, (s) => (spotId = s));
    $("#save", root).onclick = async () => {
      await api.updatePlant(p.id, {
        name: $("#n", root).value.trim() || p.name, spot_id: spotId, pot_material: $("#pm", root).value,
        pot_size: $("#ps", root).value, base_interval_days: Number($("#bi", root).value) || p.base_interval_days,
        water_amount_ml: Number($("#ml", root).value) || null,
      });
      await refresh(); close(); route(); toast("Opgeslagen");
    };
    $("#arch", root).onclick = async () => {
      if (!confirm(`${p.name} archiveren? Hij verdwijnt uit de lijsten.`)) return;
      await api.updatePlant(p.id, { archived: true });
      await refresh(); close(); location.hash = `#/loc/${state.loc.id}/plants`;
    };
  });
}

// ───────────── Plant toevoegen ─────────────

function viewAdd() {
  const f = { photo: null, id: null, spot: null, last: "today" };
  shell("add", `
    <h1>Plant toevoegen</h1><p class="sub">Maak een foto, dan zoeken we uit wat het is en hoe je hem verzorgt.</p>
    <label class="photo-drop" id="drop">
      <input type="file" accept="image/*" capture="environment" id="file" hidden>
      <div class="big">📷</div><strong>Foto maken of kiezen</strong><div class="small muted">Hele plant in beeld, bij daglicht</div>
    </label>
    <img class="photo-preview hidden" id="preview" alt="">
    <div id="idBox"></div>
    <div id="form" class="hidden">
      <label class="field"><span>Naam</span><input type="text" id="name" placeholder="bv. Grote Monstera"></label>
      <label class="field"><span>Soort</span><input type="text" id="species" placeholder="bv. Monstera deliciosa"></label>
      <div class="field"><span class="muted small" style="font-weight:600;display:block;margin-bottom:6px">Waar staat hij?</span>${spotPicker(null)}</div>
      <div class="field"><span class="muted small" style="font-weight:600;display:block;margin-bottom:6px">Wanneer voor het laatst water?</span>
        <div class="seg" id="last"><button type="button" data-v="today" class="on">Vandaag</button><button type="button" data-v="few">Paar dagen terug</button><button type="button" data-v="unknown">Weet ik niet</button></div></div>
      <details style="margin:12px 0"><summary class="muted">Pot (optioneel)</summary>
        <label class="field"><span>Materiaal</span><select id="pm">${Object.entries(POT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label class="field"><span>Maat</span><select id="ps">${Object.entries(SIZE).map(([k, v]) => `<option value="${k}" ${k === "medium" ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      </details>
      <button class="btn primary block lg" id="save">Opslaan</button>
    </div>
    <p style="text-align:center"><button class="btn ghost" id="manual">Zonder foto verder</button></p>`);

  const showForm = () => {
    $("#form").classList.remove("hidden");
    $("#manual").classList.add("hidden");
  };
  bindSpotPicker(app, null, (s) => (f.spot = s));
  $$("#last button").forEach((b) => (b.onclick = () => { f.last = b.dataset.v; $$("#last button").forEach((x) => x.classList.toggle("on", x === b)); }));
  $("#manual").onclick = showForm;

  $("#file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    f.photo = await downscale(file);
    $("#preview").src = f.photo.dataUrl;
    $("#preview").classList.remove("hidden");
    $("#drop").classList.add("hidden");
    $("#idBox").innerHTML = `<div class="card pad row" style="margin-top:12px"><div class="spinner"></div><span>Plant herkennen…</span></div>`;
    showForm();
    try {
      f.id = await api.identify(f.photo.base64);
      renderId();
    } catch (err) {
      $("#idBox").innerHTML = `<div class="banner">Herkennen lukte niet (${esc(err.message)}). Vul de soort zelf in.</div>`;
    }
  };

  function renderId() {
    const r = f.id;
    if (!r.is_plant) {
      $("#idBox").innerHTML = `<div class="banner">Ik zie geen plant op deze foto. Probeer een andere, of vul zelf in.</div>`;
      return;
    }
    $("#idBox").innerHTML = `
      <div class="card pad" style="margin-top:12px">
        <div class="small muted">Dit is waarschijnlijk <span class="pill ${r.confidence === "hoog" ? "ok" : r.confidence === "middel" ? "water" : "late"}">${r.confidence === "hoog" ? "vrij zeker" : r.confidence === "middel" ? "redelijk zeker" : "twijfel"}</span></div>
        <div style="font:600 22px var(--serif);margin-top:4px">${esc(r.common_name)}</div>
        <div class="muted"><em>${esc(r.species)}</em></div>
        <p class="small" style="margin:10px 0 0">💧 ~${r.water_amount_ml} ml, basis om de ${r.base_interval_days} dagen · ${LIGHT[r.light_need].icon} ${LIGHT[r.light_need].label}${r.toxic_pets ? " · ⚠️ giftig voor huisdieren" : ""}</p>
        ${r.alternatives?.length ? `<div class="small muted" style="margin-top:10px">Of toch:</div><div class="chips" style="margin-top:6px">${r.alternatives.map((a, i) => `<button type="button" class="chip" data-alt="${i}">${esc(a.common_name)}</button>`).join("")}</div>` : ""}
      </div>`;
    $("#name").value ||= r.common_name;
    $("#species").value = r.species;
    $$("[data-alt]").forEach((b) => (b.onclick = () => {
      const a = r.alternatives[Number(b.dataset.alt)];
      r.alternatives[Number(b.dataset.alt)] = { species: r.species, common_name: r.common_name };
      Object.assign(r, a);
      $("#name").value = a.common_name;
      renderId();
    }));
    // waarschuw als de gekozen plek niet bij de lichtbehoefte past
  }

  $("#save").onclick = async () => {
    const btn = $("#save");
    const name = $("#name").value.trim() || $("#species").value.trim();
    if (!name) return toast("Geef de plant een naam");
    btn.disabled = true; btn.textContent = "Opslaan…";
    try {
      const r = f.id?.is_plant ? f.id : null;
      const photo_path = f.photo ? await api.uploadPhoto(state.loc.id, f.photo.blob) : null;
      const last = f.last === "today" ? new Date().toISOString() : f.last === "few" ? new Date(Date.now() - 3 * 864e5).toISOString() : null;
      const plant = await api.createPlant({
        location_id: state.loc.id, spot_id: f.spot, name, species: $("#species").value.trim() || null,
        common_name: r?.common_name ?? null, photo_path, pot_material: $("#pm").value, pot_size: $("#ps").value,
        base_interval_days: r?.base_interval_days ?? 7, water_amount_ml: r?.water_amount_ml ?? null, water_how: r?.water_how ?? null,
        care: r ? { dry_check: r.dry_check, light_need: r.light_need, toxic_pets: r.toxic_pets, fertilize_weeks: r.fertilize_weeks, tips: r.tips } : {},
        last_watered_at: last,
      });
      await refresh();
      toast(`${plant.name} toegevoegd 🌱`);
      location.hash = `#/loc/${state.loc.id}/plant/${plant.id}`;
    } catch (e) {
      btn.disabled = false; btn.textContent = "Opslaan";
      toast(`Mislukt: ${e.message}`);
    }
  };
}

// ───────────── Ruimtes ─────────────

function spotFlags(s) {
  return [LIGHT[s.light].icon + " " + LIGHT[s.light].label, s.window_dir && `raam ${DIR_LABEL[s.window_dir]}`, s.near_heater && "🔥 verwarming", s.near_ac && "❄️ airco"].filter(Boolean).join(" · ");
}

async function viewRooms() {
  const { rooms, spots, plants, floorplans } = state.data;
  const plansHtml = await Promise.all(floorplans.map(async (fp) => {
    const url = await api.floorplanUrl(fp);
    const rs = rooms.filter((r) => r.floorplan_id === fp.id && r.polygon);
    return `<h3>${esc(fp.name)}</h3><div class="plan card">${url ? `<img src="${esc(url)}" alt="">` : ""}${planSvg(rs, fp.aspect)}</div>`;
  }));
  shell("rooms", `
    <h1>Ruimtes</h1><p class="sub">Per plek leg je één keer vast hoeveel licht er is. Planten erven dat automatisch.</p>
    <div class="row"><button class="btn primary grow" id="addRooms">＋ Ruimtes toevoegen</button><a class="btn grow" href="#/loc/${state.loc.id}/floorplan">📐 Plattegrond uploaden</a></div>
    ${plansHtml.join("")}
    ${rooms.length ? `<h3>Alle ruimtes</h3>` : `<div class="empty"><div class="big">🏡</div><p>Nog geen ruimtes. Tik een paar namen aan of upload een plattegrond, dan worden ze automatisch gemaakt.</p></div>`}
    <div class="list">${rooms.map((r) => {
      const rs = spots.filter((s) => s.room_id === r.id);
      const count = plants.filter((p) => rs.some((s) => s.id === p.spot_id)).length;
      return `<div class="card room" id="room-${r.id}">
        <div class="room-head"><span class="name grow">${esc(r.name)}</span>
          <span class="small muted">${count} ${count === 1 ? "plant" : "planten"}${r.windows?.length ? ` · raam ${r.windows.map((d) => DIR_LABEL[d]).join(", ")}` : ""}</span>
          <button class="btn ghost" data-room="${r.id}" aria-label="Ruimte bewerken">✏️</button></div>
        ${rs.map((s) => `<div class="spot-row"><span class="grow"><strong>${esc(s.name)}</strong><br><span class="flags">${esc(spotFlags(s))}</span></span><button class="btn ghost" data-spot="${s.id}">Wijzig</button></div>`).join("")}
        <button class="chip dashed" data-newspot="${r.id}" style="margin-top:8px">＋ Plek</button>
      </div>`;
    }).join("")}</div>`);

  $("#addRooms").onclick = addRoomsSheet;
  $$("[data-room]").forEach((b) => (b.onclick = () => editRoom(rooms.find((r) => r.id === b.dataset.room))));
  $$("[data-spot]").forEach((b) => (b.onclick = () => editSpot(spots.find((s) => s.id === b.dataset.spot), async () => { await refresh(); route(); })));
  $$("[data-newspot]").forEach((b) => (b.onclick = () => editSpot({ room_id: b.dataset.newspot }, async () => { await refresh(); route(); })));
  $$(".plan polygon").forEach((pg) => (pg.onclick = () => $(`#room-${pg.dataset.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })));
}

function planSvg(rooms, aspect = 1, offIds = new Set()) {
  const h = 1 / (aspect || 1);
  return `<svg viewBox="0 0 1 ${h}" preserveAspectRatio="none">${rooms.map((r, i) => {
    const pts = r.polygon.map((p) => `${p.x ?? p[0]},${(p.y ?? p[1]) * h}`).join(" ");
    const cx = r.polygon.reduce((a, p) => a + (p.x ?? p[0]), 0) / r.polygon.length;
    const cy = r.polygon.reduce((a, p) => a + (p.y ?? p[1]), 0) / r.polygon.length * h;
    return `<polygon points="${pts}" data-id="${r.id ?? i}" class="${offIds.has(r.id ?? i) ? "off" : ""}"/><text x="${cx}" y="${cy}">${esc(r.name)}</text>`;
  }).join("")}</svg>`;
}

function addRoomsSheet() {
  const existing = new Set(state.data.rooms.map((r) => r.name.toLowerCase()));
  const isOffice = /kantoor|office|werk/i.test(state.loc.name);
  const presets = [...(isOffice ? ROOM_PRESETS.kantoor : ROOM_PRESETS.thuis), ...(isOffice ? ROOM_PRESETS.thuis : ROOM_PRESETS.kantoor)]
    .filter((n, i, a) => a.indexOf(n) === i && !existing.has(n.toLowerCase()));
  const picked = [];
  sheet(`
    <h2>Ruimtes toevoegen</h2>
    <p class="sub">Tik aan wat je hebt. Elke ruimte krijgt meteen de plekken “Bij het raam” en “Verder van het raam”.</p>
    <div class="chips" id="pre">${presets.map((n) => `<button type="button" class="chip" data-n="${esc(n)}">${esc(n)}</button>`).join("")}</div>
    <div class="row" style="margin-top:14px"><input type="text" id="own" placeholder="Eigen naam, bv. Zolder" class="grow" style="flex:1"><button class="btn" id="ownAdd">＋</button></div>
    <div class="chips" id="picked" style="margin-top:10px"></div>
    <button class="btn primary block lg" id="go" disabled style="margin-top:18px">Toevoegen</button>
    <p style="text-align:center"><a href="#/loc/${state.loc.id}/floorplan" data-close>📐 Of upload een plattegrond</a></p>`, (root, close) => {
    const sync = () => {
      $("#picked", root).innerHTML = picked.filter((n) => !presets.includes(n)).map((n) => `<span class="chip on">${esc(n)}</span>`).join("");
      $("#go", root).disabled = !picked.length;
      $("#go", root).textContent = picked.length ? `${picked.length} ${picked.length === 1 ? "ruimte" : "ruimtes"} toevoegen` : "Toevoegen";
    };
    $$("[data-n]", root).forEach((b) => (b.onclick = () => {
      const n = b.dataset.n; const i = picked.indexOf(n);
      i >= 0 ? picked.splice(i, 1) : picked.push(n);
      b.classList.toggle("on", i < 0); sync();
    }));
    const addOwn = () => { const v = $("#own", root).value.trim(); if (v && !picked.includes(v)) picked.push(v); $("#own", root).value = ""; sync(); };
    $("#ownAdd", root).onclick = addOwn;
    $("#own", root).onkeydown = (e) => { if (e.key === "Enter") addOwn(); };
    $("#go", root).onclick = async () => {
      $("#go", root).disabled = true;
      await api.createRooms(state.loc.id, picked.map((name) => ({ name, kind: KIND_OF(name) })));
      await refresh(); close(); route(); toast(`${picked.length} ${picked.length === 1 ? "ruimte" : "ruimtes"} toegevoegd`);
    };
  });
}

function dirChips(selected, multi = true) {
  return `<div class="chips">${DIRS.map((d) => `<button type="button" class="chip ${selected.includes(d) ? "on" : ""}" data-dir="${d}">${d}</button>`).join("")}</div>`;
}
function bindDirChips(root, selected, multi = true) {
  $$("[data-dir]", root).forEach((b) => (b.onclick = () => {
    const d = b.dataset.dir; const i = selected.indexOf(d);
    if (!multi) { selected.length = 0; if (i < 0) selected.push(d); }
    else if (i >= 0) selected.splice(i, 1); else selected.push(d);
    $$("[data-dir]", root).forEach((x) => x.classList.toggle("on", selected.includes(x.dataset.dir)));
  }));
}

function editRoom(r) {
  const windows = [...(r.windows ?? [])];
  sheet(`
    <h2>${esc(r.name)}</h2>
    <label class="field"><span>Naam</span><input type="text" id="n" value="${esc(r.name)}"></label>
    <div class="field"><span class="muted small" style="font-weight:600;display:block;margin-bottom:6px">Ramen op het…</span>${dirChips(windows)}
      <p class="small muted">Weet je het niet? Kijk waar de zon ’s middags binnenkomt: dat is zuid.</p></div>
    <div class="row" style="margin-top:18px"><button class="btn ghost" id="del">Verwijderen</button><span class="grow"></span>
      <button class="btn" data-close>Annuleren</button><button class="btn primary" id="save">Opslaan</button></div>`, (root, close) => {
    bindDirChips(root, windows);
    $("#save", root).onclick = async () => {
      await api.updateRoom(r.id, { name: $("#n", root).value.trim() || r.name, windows });
      // "Bij het raam"-plekken volgen de raamrichting
      const dir = windows[0] ?? null;
      for (const s of state.data.spots.filter((s) => s.room_id === r.id && s.name === "Bij het raam")) {
        await api.updateSpot(s.id, { window_dir: dir, light: lightForWindow(dir) });
      }
      await refresh(); close(); route();
    };
    $("#del", root).onclick = async () => {
      if (!confirm(`${r.name} verwijderen? Planten hier krijgen “geen plek”.`)) return;
      await api.deleteRoom(r.id); await refresh(); close(); route();
    };
  });
}

function editSpot(s, onSaved) {
  const isNew = !s.id;
  const v = { light: s.light ?? "medium", near_heater: !!s.near_heater, near_ac: !!s.near_ac, window: s.window_dir ? [s.window_dir] : [] };
  sheet(`
    <h2>${isNew ? "Nieuwe plek" : esc(s.name)}</h2>
    <label class="field"><span>Naam</span><input type="text" id="n" value="${esc(s.name ?? "")}" placeholder="bv. Vensterbank, Op de kast"></label>
    <div class="field"><span class="muted small" style="font-weight:600;display:block;margin-bottom:6px">Hoeveel licht?</span>
      <div class="chips" id="light">${Object.entries(LIGHT).map(([k, l]) => `<button type="button" class="chip ${v.light === k ? "on" : ""}" data-l="${k}">${l.icon} ${l.label}</button>`).join("")}</div>
      <p class="small muted">Weinig: je kunt er net lezen · Middel: licht maar geen zon · Veel: vlak bij een raam · Direct: zon schijnt erop.</p></div>
    <div class="field"><span class="muted small" style="font-weight:600;display:block;margin-bottom:6px">Omgeving</span>
      <div class="chips"><button type="button" class="chip ${v.near_heater ? "on" : ""}" id="heat">🔥 Bij verwarming</button>
      <button type="button" class="chip ${v.near_ac ? "on" : ""}" id="ac">❄️ Bij airco</button></div></div>
    <div class="field"><span class="muted small" style="font-weight:600;display:block;margin-bottom:6px">Raam (optioneel)</span>${dirChips(v.window)}</div>
    <div class="row" style="margin-top:18px">${isNew ? "" : `<button class="btn ghost" id="del">Verwijderen</button>`}<span class="grow"></span>
      <button class="btn" data-close>Annuleren</button><button class="btn primary" id="save">Opslaan</button></div>`, (root, close) => {
    bindDirChips(root, v.window, false);
    $$("[data-l]", root).forEach((b) => (b.onclick = () => { v.light = b.dataset.l; $$("[data-l]", root).forEach((x) => x.classList.toggle("on", x === b)); }));
    $("#heat", root).onclick = (e) => { v.near_heater = !v.near_heater; e.currentTarget.classList.toggle("on", v.near_heater); };
    $("#ac", root).onclick = (e) => { v.near_ac = !v.near_ac; e.currentTarget.classList.toggle("on", v.near_ac); };
    $("#save", root).onclick = async () => {
      const patch = { name: $("#n", root).value.trim() || "Plek", light: v.light, near_heater: v.near_heater, near_ac: v.near_ac, window_dir: v.window[0] ?? null };
      const saved = isNew ? await api.createSpot({ ...patch, room_id: s.room_id, location_id: state.loc.id }) : await api.updateSpot(s.id, patch);
      close(); await onSaved?.(saved);
    };
    $("#del", root)?.addEventListener("click", async () => {
      if (!confirm(`Plek “${s.name}” verwijderen?`)) return;
      await api.deleteSpot(s.id); close(); await onSaved?.();
    });
  });
}

// ───────────── Plattegrond → ruimtes ─────────────

function viewFloorplan() {
  const st = { img: null, result: null, north: "unknown", include: new Set(), names: [] };
  shell("rooms", `
    <h1>Plattegrond</h1><p class="sub">Upload een foto, scan of Funda-plattegrond. De ruimtes worden automatisch herkend; jij controleert.</p>
    <label class="field"><span>Verdieping</span><input type="text" id="fname" value="Begane grond"></label>
    <label class="photo-drop" id="drop"><input type="file" accept="image/*" id="file" hidden>
      <div class="big">📐</div><strong>Plattegrond kiezen</strong><div class="small muted">Foto, screenshot of scan</div></label>
    <div id="out"></div>`);

  $("#file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    st.img = await downscale(file, 1600);
    $("#drop").classList.add("hidden");
    $("#out").innerHTML = `<div class="plan card" style="margin-top:12px"><img src="${st.img.dataUrl}" alt=""></div>
      <div class="card pad row" style="margin-top:12px"><div class="spinner"></div><span>Ruimtes herkennen… (±20 sec)</span></div>`;
    try {
      st.result = await api.parseFloorplan(st.img.base64);
      if (!st.result.is_floorplan || !st.result.rooms.length) throw new Error("geen ruimtes gevonden");
      st.north = st.result.north;
      st.result.rooms.forEach((_, i) => st.include.add(i));
      st.names = st.result.rooms.map((r) => r.name);
      review();
    } catch (err) {
      $("#out").innerHTML = `<div class="banner">Dat lukte niet (${esc(err.message)}). Probeer een scherpere afbeelding, of <a href="#/loc/${state.loc.id}/rooms">voeg ruimtes met de hand toe</a>.</div>`;
    }
  };

  const SIDES = ["top", "right", "bottom", "left"];
  const toCompass = (side) => {
    if (st.north === "unknown") return null;
    const rot = SIDES.indexOf(st.north); // aantal kwartslagen
    return ["N", "O", "Z", "W"][(SIDES.indexOf(side) - rot + 4) % 4];
  };

  function review() {
    const rooms = st.result.rooms;
    const off = new Set(rooms.map((_, i) => i).filter((i) => !st.include.has(i)));
    $("#out").innerHTML = `
      <div class="plan card" style="margin-top:12px"><img src="${st.img.dataUrl}" alt="">${planSvg(rooms.map((r, i) => ({ ...r, name: st.names[i] })), st.img.aspect, off)}</div>
      <h3>Waar is het noorden op de tekening?</h3>
      <div class="seg" id="north">${[["top", "↑ Boven"], ["right", "→ Rechts"], ["bottom", "↓ Onder"], ["left", "← Links"], ["unknown", "Weet ik niet"]]
        .map(([k, l]) => `<button type="button" data-n="${k}" class="${st.north === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <p class="small muted">Hiermee weten we welke ramen op het zuiden liggen (meer licht = vaker water).</p>
      <h3>${rooms.length} ruimtes gevonden</h3>
      <div class="list">${rooms.map((r, i) => {
        const dirs = r.window_sides.map(toCompass).filter(Boolean);
        return `<div class="card row" style="padding:10px 12px">
          <input type="checkbox" data-inc="${i}" ${st.include.has(i) ? "checked" : ""} style="width:22px;height:22px">
          <input type="text" data-name="${i}" value="${esc(st.names[i])}" style="flex:1;min-width:0">
          <span class="small muted" style="min-width:70px;text-align:right">${r.window_sides.length ? (dirs.length ? "raam " + dirs.join(", ") : "🪟 " + r.window_sides.length) : "geen raam"}</span>
        </div>`;
      }).join("")}</div>
      <button class="btn primary block lg" id="create" style="margin-top:18px">${st.include.size} ruimtes aanmaken</button>`;

    $$("#north button").forEach((b) => (b.onclick = () => { st.north = b.dataset.n; review(); }));
    $$("[data-inc]").forEach((c) => (c.onchange = () => { const i = Number(c.dataset.inc); c.checked ? st.include.add(i) : st.include.delete(i); review(); }));
    $$("[data-name]").forEach((inp) => (inp.oninput = () => { st.names[Number(inp.dataset.name)] = inp.value; }));
    $("#create").onclick = async () => {
      const btn = $("#create");
      btn.disabled = true; btn.textContent = "Aanmaken…";
      try {
        const fp = await api.createFloorplan(state.loc.id, st.img.blob, st.img.aspect, $("#fname").value.trim() || "Begane grond");
        const chosen = rooms.map((r, i) => ({ r, i })).filter(({ i }) => st.include.has(i));
        await api.createRooms(state.loc.id, chosen.map(({ r, i }, n) => ({
          name: st.names[i].trim() || r.name, kind: r.kind, polygon: r.polygon, floorplan_id: fp.id,
          windows: [...new Set(r.window_sides.map(toCompass).filter(Boolean))], sort: state.data.rooms.length + n,
        })));
        await refresh();
        toast(`${chosen.length} ruimtes aangemaakt`);
        location.hash = `#/loc/${state.loc.id}/rooms`;
      } catch (e) {
        btn.disabled = false; btn.textContent = "Opnieuw proberen";
        toast(`Mislukt: ${e.message}`);
      }
    };
  }
}

// ───────────── Meer / instellingen ─────────────

function isStandalone() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }

async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return isIOS() && !isStandalone() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}
function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function togglePush(on) {
  const reg = await navigator.serviceWorker.ready;
  if (on) {
    if ((await Notification.requestPermission()) !== "granted") return toast("Meldingen niet toegestaan");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    await api.savePush(sub);
    toast("Meldingen aan: elke ochtend om 8:00");
  } else {
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api.deletePush(sub.endpoint); await sub.unsubscribe(); }
    toast("Meldingen uit");
  }
}

async function viewMore() {
  const l = state.loc;
  const ps = await pushState();
  const pushHtml = {
    install: `<p class="small">Op iPhone/iPad werken meldingen pas als de app op je beginscherm staat: tik op <strong>Deel ⎋</strong> → <strong>Zet op beginscherm</strong>, en open hem vandaar.</p>`,
    unsupported: `<p class="small muted">Deze browser ondersteunt geen pushmeldingen.</p>`,
    denied: `<p class="small">Meldingen zijn geblokkeerd. Zet ze aan in de instellingen van je telefoon (Meldingen → Planten).</p>`,
    on: `<div class="row"><span class="grow">🔔 Aan: elke ochtend om 8:00 als er planten dorst hebben.</span><button class="btn" id="push" data-on="0">Uitzetten</button></div>`,
    off: `<div class="row"><span class="grow">Eén melding per ochtend per locatie, alleen als er iets te doen is.</span><button class="btn primary" id="push" data-on="1">Aanzetten</button></div>`,
  }[ps];
  shell("more", `
    <h1>Meer</h1>

    <h2>Meldingen</h2><div class="card pad">${DEMO ? `<p class="small muted">Niet beschikbaar in demo-modus.</p>` : pushHtml}</div>

    <h2>iPad-scherm</h2>
    <div class="card pad">
      <p style="margin-top:0">Zet een iPad neer op <strong>${esc(l.name)}</strong>: die toont de hele dag welke planten water moeten. Iedereen kan aftikken, zonder account.</p>
      <div class="qr-box qr">${qrSvg(kioskUrl(l))}</div>
      <p class="small muted" style="text-align:center">Scan met de iPad, of open de link.</p>
      <div class="row"><a class="btn grow" href="${esc(kioskUrl(l))}" target="_blank">Open iPad-scherm</a><button class="btn grow" id="copyKiosk">Link kopiëren</button></div>
      <details style="margin-top:12px"><summary class="small">Zo zet je de iPad vast op dit scherm</summary>
        <ol class="small"><li>Open de link in Safari → Deel → <em>Zet op beginscherm</em>.</li>
        <li>Instellingen → Beeldscherm → Automatisch vergrendelen: <em>Nooit</em> (en iPad aan de lader).</li>
        <li>Instellingen → Toegankelijkheid → <em>Begeleide toegang</em> aan. Open de app, druk 3× op de knop: nu kan niemand eruit.</li></ol></details>
    </div>

    <h2>QR-stickers</h2>
    <div class="card pad row"><span class="grow">Print voor elke plant een sticker met QR-code.</span><a class="btn" href="#/loc/${l.id}/stickers">🖨️ Stickervel</a></div>

    <h2>Locatie</h2>
    <div class="card pad">
      <div class="row"><input type="text" id="emoji" value="${esc(l.emoji)}" style="width:64px;text-align:center"><input type="text" id="lname" value="${esc(l.name)}" style="flex:1"><button class="btn" id="saveLoc">Opslaan</button></div>
      <label class="field"><span>Jouw naam (zichtbaar bij “water gegeven door”)</span><input type="text" id="me" value="${esc(myName())}" placeholder="bv. Killian"></label>
    </div>

    <h2>Samen beheren</h2>
    <div class="card pad"><p class="small muted" style="margin:0">Binnenkort: huisgenoten en collega’s uitnodigen. Tot die tijd kan iedereen via de QR-codes en het iPad-scherm aftikken.</p></div>

    <div class="row" style="margin-top:28px">
      <a class="btn grow" href="#/new-location">＋ Nieuwe locatie</a>
      <button class="btn ghost grow" id="logout">${DEMO ? "Demo resetten" : "Uitloggen"}</button>
    </div>`);

  $("#push")?.addEventListener("click", async (e) => { await togglePush(e.currentTarget.dataset.on === "1"); route(); });
  $("#copyKiosk").onclick = async () => { await navigator.clipboard.writeText(kioskUrl(l)); toast("Link gekopieerd"); };
  $("#saveLoc").onclick = async () => {
    const upd = await api.updateLocation(l.id, { name: $("#lname").value.trim() || l.name, emoji: $("#emoji").value.trim() || l.emoji });
    Object.assign(l, upd); toast("Opgeslagen"); route();
  };
  $("#me").onchange = (e) => { setMyName(e.target.value.trim()); toast("Naam opgeslagen"); };
  $("#logout").onclick = async () => { await api.signOut(); state.locations = []; state.loc = null; state.data = null; location.hash = "#/"; route(); };
}

function viewStickers(onlyPlant) {
  const plants = state.data.plants.filter((p) => !onlyPlant || p.id === onlyPlant);
  shell("more", `
    <div class="no-print"><h1>QR-stickers</h1><p class="sub">Print op A4 (of stickervel), knip uit en plak op de pot.</p>
      <button class="btn primary" onclick="print()">🖨️ Printen</button></div>
    <div class="stickers" style="margin-top:16px">${plants.map((p) => `
      <div class="sticker"><div class="qr">${qrSvg(qrUrl(p), 3)}</div><div class="n">${esc(p.name)}</div><div class="r">${esc(whereText(p))} · scan voor water</div></div>`).join("")}</div>`);
}

// ───────────── Locatie aanmaken ─────────────

function viewNewLocation() {
  const first = !state.locations.length;
  app.innerHTML = `<main class="wrap" style="padding-top:calc(env(safe-area-inset-top) + 32px)">
    <h1>${first ? "Welkom 🌿" : "Nieuwe locatie"}</h1>
    <p class="sub">${first ? "Begin met een locatie. Daarna maak je de ruimtes en zet je je planten erin." : "Bijvoorbeeld thuis, kantoor of een vakantiehuis."}</p>
    <div class="chips" style="margin-bottom:12px">
      <button class="chip" data-s="🏠|Thuis">🏠 Thuis</button><button class="chip" data-s="🏢|Kantoor Figeeweg">🏢 Kantoor Figeeweg</button>
    </div>
    <div class="row"><input type="text" id="emoji" value="🏠" style="width:64px;text-align:center"><input type="text" id="name" placeholder="Naam van de locatie" style="flex:1"></div>
    <button class="btn primary block lg" id="go" style="margin-top:16px">Aanmaken</button>
    ${first ? "" : `<p style="text-align:center"><a href="javascript:history.back()">Annuleren</a></p>`}
  </main>`;
  $$("[data-s]").forEach((b) => (b.onclick = () => { const [e, n] = b.dataset.s.split("|"); $("#emoji").value = e; $("#name").value = n; }));
  $("#go").onclick = async () => {
    const name = $("#name").value.trim();
    if (!name) return toast("Geef de locatie een naam");
    const l = await api.createLocation(name, $("#emoji").value.trim() || "🏠");
    state.locations = await api.locations();
    location.hash = `#/loc/${l.id}/rooms`;
  };
}

// ───────────── Login ─────────────

function viewLogin() {
  app.innerHTML = `<div class="login"><div class="card">
    <div class="logo">🪴</div><h1>Planten</h1>
    <p class="sub">Log in met je e-mail. Je krijgt een link, geen wachtwoord nodig.</p>
    <form id="f"><input type="email" id="email" required placeholder="jij@voorbeeld.nl" autocomplete="email">
    <button class="btn primary block" style="margin-top:12px">Stuur inloglink</button></form>
    <p id="msg" class="small muted"></p></div></div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await api.signIn($("#email").value.trim());
    $("#msg").textContent = error ? `Mislukt: ${error.message}` : "Check je mail en tik op de link. Op iPhone: open de link in de app als die op je beginscherm staat.";
  };
}

// ───────────── iPad-kiosk (publiek) ─────────────

let kioskTimer = null, kioskWake = null;
async function viewKiosk(token) {
  document.documentElement.dataset.theme = "light";
  const data = await api.kiosk(token);
  if (!data) { app.innerHTML = `<div class="empty"><div class="big">🔒</div><p>Deze iPad-link werkt niet (meer).</p></div>`; return; }
  const plants = data.plants;
  const due = plants.filter(isDue).sort((a, b) => (a.room_sort ?? 0) - (b.room_sort ?? 0));
  const soon = plants.filter((p) => !isDue(p)).slice(0, 8);
  const clock = () => new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  app.innerHTML = `<div class="kiosk">
    <header><div><h1>${esc(data.location.emoji)} ${esc(data.location.name)}</h1><div class="date">${esc(today())}</div></div><div class="clock" id="clock">${clock()}</div></header>
    ${due.length ? `<h3>Vandaag water · ${due.length}</h3><div class="k-grid">${due.map((p) => `
      <div class="card k-card" data-id="${p.id}">
        <div class="img">${img(p)}</div>
        <div class="body">
          <div class="name">${esc(p.name)}</div>
          <div class="muted">${esc(p.room ?? "")}${p.spot ? ` · ${esc(p.spot)}` : ""} ${dayDiff(p.next_water_at) < 0 ? `<span class="pill late">${esc(dueText(p.next_water_at))}</span>` : ""}</div>
          <div class="amount">💧 ${esc(amountText(p))}</div>
          ${p.water_how ? `<div class="how">${esc(p.water_how)}</div>` : ""}
          <div class="actions"><button class="btn water" data-k="water">💧 Gedaan</button><button class="btn" data-k="still_wet">Nog vochtig</button></div>
        </div>
      </div>`).join("")}</div>`
    : `<div class="k-done"><div class="big">🌿</div><p>Alle planten hebben water.</p>${soon[0] ? `<div class="muted" style="font-size:20px;margin-top:8px">Volgende: ${esc(soon[0].name)}, ${esc(dueText(soon[0].next_water_at))}</div>` : ""}</div>`}
    ${soon.length ? `<h3>Binnenkort</h3><div class="k-soon">${soon.map((p) => `
      <div class="card"><span class="thumb">${img(p)}</span><span class="grow"><strong>${esc(p.name)}</strong><br><span class="small muted">${esc(p.room ?? "")}</span></span>${duePill(p.next_water_at)}</div>`).join("")}</div>` : ""}
  </div>`;

  $$("[data-k]").forEach((b) => (b.onclick = async () => {
    const card = b.closest("[data-id]");
    $$("button", card).forEach((x) => (x.disabled = true));
    try {
      await api.publicLog(token, card.dataset.id, b.dataset.k, "", "kiosk");
      card.classList.add("leaving");
      toast(b.dataset.k === "water" ? "Top, genoteerd 💧" : "Oké, over 2 dagen weer");
      setTimeout(() => viewKiosk(token), 500);
    } catch (e) { toast(`Mislukt: ${e.message}`); $$("button", card).forEach((x) => (x.disabled = false)); }
  }));

  clearInterval(kioskTimer);
  let ticks = 0;
  kioskTimer = setInterval(() => {
    if (!location.hash.startsWith("#/kiosk/")) return clearInterval(kioskTimer);
    $("#clock") && ($("#clock").textContent = clock());
    if (++ticks % 4 === 0) viewKiosk(token); // elke minuut verversen
    if (new Date().getHours() === 4 && new Date().getMinutes() === 0) location.reload(); // nachtelijke update
  }, 15000);
  try { kioskWake ??= await navigator.wakeLock?.request("screen"); kioskWake?.addEventListener("release", () => (kioskWake = null)); } catch { /* niet ondersteund */ }
}

// ───────────── QR-pagina (publiek) ─────────────

async function viewQr(token) {
  const p = await api.qr(token);
  if (!p) { app.innerHTML = `<div class="empty"><div class="big">🔍</div><p>Deze plant is niet (meer) gevonden.</p></div>`; return; }
  const care = p.care ?? {};
  const late = dayDiff(p.next_water_at);
  const headline = late < 0 ? "Ja, water graag!" : late === 0 ? "Vandaag water" : `Nog niet: ${dueText(p.next_water_at)}`;
  app.innerHTML = `<main class="wrap qr-page" style="padding-bottom:40px">
    <div class="hero">${img(p)}</div>
    <p class="small muted" style="margin:14px 0 0">${esc(p.location_emoji)} ${esc(p.location)}${p.room ? ` · ${esc(p.room)}` : ""}</p>
    <h1>${esc(p.name)}</h1>
    <p class="sub">${esc(p.common_name ?? "")}${p.species ? ` · <em>${esc(p.species)}</em>` : ""}</p>

    <div class="card pad" style="border-color:${late <= 0 ? "var(--water)" : "var(--line)"}">
      <div class="k small muted" style="font-weight:600">Water nodig?</div>
      <div style="font:600 26px var(--serif);margin:2px 0 6px">${esc(headline)}</div>
      <div><strong>💧 ${esc(amountText(p))}</strong> · om de ${p.interval?.days ?? "?"} dagen</div>
      ${p.water_how ? `<p class="small" style="margin:8px 0 0">${esc(p.water_how)}</p>` : ""}
      ${care.dry_check ? `<p class="small muted" style="margin:6px 0 0">${esc(care.dry_check)}</p>` : ""}
      <label class="field"><span>Jouw naam (optioneel)</span><input type="text" id="who" value="${esc(myName())}" placeholder="zodat anderen zien wie het deed"></label>
      <div class="row">
        <button class="btn water grow lg" data-k="water">💧 Water gegeven</button>
        ${late <= 0 ? `<button class="btn lg" data-k="still_wet">Nog vochtig</button>` : ""}
      </div>
    </div>

    ${care.tips?.length || care.toxic_pets ? `<h2>Goed om te weten</h2><div class="card pad small">
      ${care.toxic_pets ? `<p style="margin-top:0">⚠️ Giftig voor huisdieren.</p>` : ""}
      ${(care.tips ?? []).map((t) => `<p style="margin:6px 0">• ${esc(t)}</p>`).join("")}</div>` : ""}

    ${p.recent?.length ? `<h2>Laatst</h2><ul class="history">${p.recent.map((e) => `<li><span class="grow">${EVENT_LABEL[e.kind]}${e.by_name ? ` · ${esc(e.by_name)}` : ""}</span><span class="muted small">${esc(ago(e.created_at))}</span></li>`).join("")}</ul>` : ""}
  </main>`;
  $$("[data-k]").forEach((b) => (b.onclick = async () => {
    const who = $("#who").value.trim();
    if (who) setMyName(who);
    $$("[data-k]").forEach((x) => (x.disabled = true));
    try {
      const upd = await api.publicLog(token, null, b.dataset.k, who, "qr");
      toast(b.dataset.k === "water" ? `Dank je! Volgende keer: ${dueText(upd.next_water_at)}` : "Oké, over 2 dagen weer");
      setTimeout(() => viewQr(token), 700);
    } catch (e) { toast(`Mislukt: ${e.message}`); $$("[data-k]").forEach((x) => (x.disabled = false)); }
  }));
}

// ───────────── Router ─────────────

async function route() {
  const hash = location.hash.slice(1) || "/";
  const [path, query] = hash.split("?");
  const qs = new URLSearchParams(query ?? "");
  const parts = path.split("/").filter(Boolean);

  try {
    // Publieke schermen: geen login nodig
    if (parts[0] === "kiosk") return await viewKiosk(parts[1]);
    if (parts[0] === "p") return await viewQr(parts[1]);

    state.session ??= await api.session();
    if (!state.session) return viewLogin();
    if (!state.locations.length) state.locations = await api.locations();

    if (parts[0] === "new-location" || !state.locations.length) return viewNewLocation();
    if (parts[0] !== "loc") {
      const id = state.locations.some((l) => l.id === lastLoc()) ? lastLoc() : state.locations[0].id;
      location.replace(`#/loc/${id}`);
      return;
    }
    if (!(await ensureLocation(parts[1]))) { location.replace("#/"); return; }

    window.scrollTo(0, 0);
    switch (parts[2]) {
      case undefined: return viewToday();
      case "plants": return viewPlants(qs.get("room") ?? "");
      case "plant": return await viewPlant(parts[3]);
      case "add": return viewAdd();
      case "rooms": return await viewRooms();
      case "floorplan": return viewFloorplan();
      case "more": return await viewMore();
      case "stickers": return viewStickers(qs.get("plant"));
      default: return viewToday();
    }
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="empty"><div class="big">🥀</div><p>Er ging iets mis: ${esc(e.message)}</p><p><a class="btn" href="#/">Opnieuw</a></p></div>`;
  }
}

api.onAuth((s) => { if (s && !state.session) { state.session = s; route(); } });
addEventListener("hashchange", route);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
route();
