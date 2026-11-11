// =====================================================================
//  season-ui.js
//  The screens of the championship mode:
//  1. The "Championship" card on the setup screen (saved seasons)
//  2. The setup wizard: basics, calendar, teams & drivers, rulebook,
//     circuits & zones
//  3. The season overview (hub)
//  4. The zone editor (DRS zones, or Straight Mode zones and the
//     Overtake Mode detection point of the 2026 cars)
// =====================================================================

let seasonDraft = null;      // the season being set up in the wizard
let seasonStep = 0;          // wizard step
let zoneEditor = null;       // { circuit, track, zones, pick, target }
let cachedTracks = new Set();

const WIZARD_STEPS = ["Basics", "Calendar", "Teams & drivers", "Rulebook", "Circuits & zones"];

function showSeasonScreen(show) {
  $("setupScreen").hidden = show;
  $("seasonScreen").hidden = !show;
  window.scrollTo(0, 0);
}

function flagSpan(country) {
  return country ? `<span class="muted small">${escapeHtml(country)}</span>` : "";
}


// =====================================================================
//  1. SAVED SEASONS (setup screen card)
// =====================================================================
function renderSeasonList() {
  const list = listSeasons();
  $("seasonList").innerHTML = list.length
    ? list.map(s => `
      <div class="season-row">
        <div><b>${escapeHtml(s.name)}</b><span class="muted small">${REGS_INFO[s.generation].short} cars · ${s.done} / ${s.rounds} rounds · ${s.phase === "PRESEASON" ? "pre-season" : s.phase === "FINISHED" ? "finished" : "in progress"}</span></div>
        <div class="btn-row">
          <button data-season-open="${s.id}">Open</button>
          <button data-season-export="${s.id}" title="Save the season as a file">Export</button>
          <button data-season-delete="${s.id}" class="danger-btn" title="Delete this season">✕</button>
        </div>
      </div>`).join("")
    : `<p class="muted small">No saved season yet.</p>`;
}


// =====================================================================
//  2. THE SETUP WIZARD
// =====================================================================
function openWizard() {
  season = null;
  seasonDraft = newSeasonDraft(2025);
  seasonStep = 0;
  zoneEditor = null;
  $("seasonTitle").textContent = "New championship";
  $("seasonSub").textContent = "Set up the season as the FIA: calendar, entry list and the rulebook.";
  showSeasonScreen(true);
  renderWizard();
}

function renderWizard() {
  $("seasonSteps").hidden = false;
  $("seasonSteps").innerHTML = WIZARD_STEPS.map((s, i) =>
    `<button data-step="${i}" class="${i === seasonStep ? "active" : ""}"><span>${i + 1}</span>${s}</button>`).join("");
  const body = $("seasonBody");
  if (seasonStep === 0) body.innerHTML = wizardBasics();
  if (seasonStep === 1) body.innerHTML = wizardCalendar();
  if (seasonStep === 2) body.innerHTML = wizardTeams();
  if (seasonStep === 3) body.innerHTML = wizardRules();
  if (seasonStep === 4) {
    body.innerHTML = wizardZones();
    refreshCacheState();
  }
  const last = seasonStep === WIZARD_STEPS.length - 1;
  const problems = checkDraft(seasonDraft);
  $("seasonFoot").innerHTML = `
    <button data-wizard="back" ${seasonStep === 0 ? "disabled" : ""}>← Back</button>
    <span class="muted small">${problems.length ? "⚠ " + escapeHtml(problems[0]) + (problems.length > 1 ? " (+" + (problems.length - 1) + " more)" : "") : seasonDraft.calendar.length + " rounds · " + seasonDraft.teams.length + " teams · " + seasonDraft.teams.length * 2 + " drivers"}</span>
    ${last ? `<button data-wizard="create" class="button-primary" ${problems.length ? "disabled" : ""}>Create the championship</button>`
           : `<button data-wizard="next" class="button-primary">Next →</button>`}`;
  if (seasonStep === 4 && zoneEditor) drawZoneEditor();
}

// ---------- Step 1: basics ----------
function wizardBasics() {
  const d = seasonDraft;
  return `
    <div class="season-grid two">
      <div class="setup-card">
        <h2>The championship</h2>
        <label>Name<input id="wName" type="text" maxlength="60" value="${escapeHtml(d.name)}"></label>
        <div class="form-row">
          <label>Season year<input id="wYear" type="number" min="2023" max="2100" value="${d.year}"></label>
          <label>Car generation
            <select id="wGen">
              ${Object.keys(REGS_INFO).map(g => `<option value="${g}" ${g === d.generation ? "selected" : ""}>${REGS_INFO[g].name}</option>`).join("")}
            </select>
          </label>
        </div>
        <p class="muted small">${d.generation === "GEN2026"
          ? "2026 cars: Straight Mode (low-drag wings on the straights for every car), Overtake Mode (extra electrical energy within 1 s of the car ahead) and battery management. Teams and drivers of any year can race with these cars."
          : "2023–2025 cars: ground-effect aerodynamics with DRS (open in the DRS zones within 1 s of the car ahead). Teams and drivers of any year can race with these cars."}</p>
      </div>
      <div class="setup-card">
        <h2>Start from a real season</h2>
        <p class="muted">Fills the calendar (with the sprint weekends) and the entry list with a real season. You can change everything in the next steps.</p>
        <div class="btn-row">
          ${SEASON_YEARS.map(y => `<button data-base-year="${y}" class="${d.baseYear === y ? "on" : ""}">${y}</button>`).join("")}
        </div>
        <p class="muted small">Current base: ${d.baseYear} · ${realCalendar(d.baseYear).length} races, ${SEASON_CATALOGUE.teams.filter(t => t.years[d.baseYear]).length} teams. Only races that really took place are in the data (cancelled events are missing).</p>
      </div>
    </div>`;
}

// ---------- Step 2: calendar ----------
function wizardCalendar() {
  const d = seasonDraft;
  const inCalendar = new Set(d.calendar.map(r => r.circuit));
  const rows = d.calendar.map((r, i) => {
    const c = circuitInfo(r.circuit);
    return `
      <tr>
        <td class="pos">${i + 1}</td>
        <td><b>${escapeHtml(c.name)}</b> ${flagSpan(c.country)}<br><span class="muted small">${escapeHtml(c.gp)} · ${c.laps} laps · usually ${c.date.slice(3)}.${c.date.slice(0, 2)}.</span></td>
        <td><label class="check small"><input type="checkbox" data-cal-sprint="${i}" ${r.sprint ? "checked" : ""}> Sprint</label></td>
        <td class="row-actions">
          <button data-cal-up="${i}" ${i === 0 ? "disabled" : ""} title="Earlier">▲</button>
          <button data-cal-down="${i}" ${i === d.calendar.length - 1 ? "disabled" : ""} title="Later">▼</button>
          <button data-cal-remove="${i}" title="Remove from the calendar">✕</button>
        </td>
      </tr>`;
  }).join("");
  const available = SEASON_CATALOGUE.circuits
    .filter(c => !inCalendar.has(c.key))
    .map(c => circuitInfo(c.key))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(c => `
      <tr>
        <td><b>${escapeHtml(c.name)}</b> ${flagSpan(c.country)}<br><span class="muted small">${escapeHtml(c.gp)} · raced ${c.years.join(", ")}</span></td>
        <td class="row-actions"><button data-cal-add="${c.key}" ${d.calendar.length >= MAX_ROUNDS ? "disabled" : ""}>Add</button></td>
      </tr>`).join("");
  return `
    <div class="season-grid wide-left">
      <div class="setup-card">
        <div class="card-head"><h2>Calendar</h2><span class="muted">${d.calendar.length} / ${MAX_ROUNDS} rounds · ${d.calendar.filter(r => r.sprint).length} sprints</span></div>
        <div class="btn-row">
          <button data-cal-sort="1">Sort by the usual dates</button>
          <button data-cal-clear="1">Remove all</button>
        </div>
        <table class="season-table"><tbody>${rows || `<tr><td class="muted">Add circuits from the list on the right.</td></tr>`}</tbody></table>
      </div>
      <div class="setup-card">
        <div class="card-head"><h2>Circuits</h2><span class="muted">raced since 2023</span></div>
        <table class="season-table"><tbody>${available || `<tr><td class="muted">All circuits are in the calendar.</td></tr>`}</tbody></table>
      </div>
    </div>`;
}

// ---------- Step 3: teams & drivers ----------
function driverOptions(selected) {
  const sorted = SEASON_CATALOGUE.drivers.slice().sort((a, b) => a.last.localeCompare(b.last));
  return `<option value="">– choose –</option>` + sorted.map(dr => {
    const years = Object.keys(dr.seasons).map(Number).sort();
    const last = dr.seasons[years[years.length - 1]];
    const team = teamInYear(last.team, years[years.length - 1]);
    return `<option value="${dr.id}" ${dr.id === selected ? "selected" : ""}>${escapeHtml(dr.first + " " + dr.last)} (${dr.id}) – ${years[years.length - 1]} ${escapeHtml(team ? team.name : "")}</option>`;
  }).join("");
}

function wizardTeams() {
  const d = seasonDraft;
  const used = {};
  d.teams.forEach(t => t.drivers.forEach(id => { if (id) used[id] = (used[id] || 0) + 1; }));
  const cards = d.teams.map((t, i) => `
    <div class="team-card" style="--team:${t.colour}">
      <div class="team-card-head">
        <input type="color" data-team-colour="${i}" value="${t.colour}" title="Team colour">
        <input type="text" data-team-name="${i}" value="${escapeHtml(t.name)}" maxlength="40">
        <button data-team-remove="${i}" title="Remove the team">✕</button>
      </div>
      ${[0, 1].map(k => `
        <label>Driver ${k + 1}
          <select data-team-driver="${i}:${k}" class="${t.drivers[k] && used[t.drivers[k]] > 1 ? "invalid" : ""}">${driverOptions(t.drivers[k])}</select>
        </label>`).join("")}
      <span class="muted small">Based on ${escapeHtml(teamInYear(t.id, d.baseYear).name)} (${catalogueTeam(t.id).years[d.baseYear] ? d.baseYear : "nearest season"})</span>
    </div>`).join("");
  const inGrid = new Set(d.teams.map(t => t.id));
  const missing = SEASON_CATALOGUE.teams.filter(t => !inGrid.has(t.id));
  const free = SEASON_CATALOGUE.drivers.filter(dr => !used[dr.id]).sort((a, b) => a.last.localeCompare(b.last));
  return `
    <div class="setup-card">
      <div class="card-head"><h2>Entry list</h2><span class="muted">${d.teams.length} / ${MAX_TEAMS} teams</span></div>
      <p class="muted small">Every constructor that raced since 2023 can enter, with any driver. Names and colours can be changed (e.g. "Sauber" instead of "Audi").</p>
      <div class="team-grid">${cards}</div>
      ${missing.length && d.teams.length < MAX_TEAMS ? `<div class="btn-row">${missing.map(t => `<button data-team-add="${t.id}">+ ${escapeHtml(teamInYear(t.id, d.baseYear).name)}</button>`).join("")}</div>` : ""}
    </div>
    <div class="setup-card">
      <div class="card-head"><h2>Free agents</h2><span class="muted">${free.length} drivers without a seat – they can be signed during the season</span></div>
      <p class="small">${free.map(dr => escapeHtml(dr.first + " " + dr.last)).join(" · ") || "–"}</p>
    </div>`;
}

// ---------- Step 4: rulebook ----------
function wizardRules() {
  const r = seasonDraft.rules;
  const gen2026 = seasonDraft.generation === "GEN2026";
  const pu = Object.keys(r.pu).map(k => `<label>${k}<input type="number" min="1" max="10" data-rule-pu="${k}" value="${r.pu[k]}"></label>`).join("");
  return `
    <div class="season-grid two">
      <div class="setup-card">
        <h2>Sporting regulations</h2>
        <label>Points system
          <select data-rule="points">${Object.keys(POINTS_SYSTEMS).map(k => `<option value="${k}" ${r.points === k ? "selected" : ""}>${POINTS_SYSTEMS[k].name}</option>`).join("")}</select>
        </label>
        <label class="check"><input type="checkbox" data-rule="sprintPoints" ${r.sprintPoints ? "checked" : ""}> Sprint points (8-7-6-5-4-3-2-1)</label>
        <label class="check"><input type="checkbox" data-rule="fastestLapPoint" ${r.fastestLapPoint ? "checked" : ""}> 1 point for the fastest lap (top 10 only, as 2019–2024)</label>
        <label>Points when a race is abandoned
          <select data-rule="shortened">${Object.keys(SHORTENED_RULES).map(k => `<option value="${k}" ${r.shortened === k ? "selected" : ""}>${SHORTENED_RULES[k].name}</option>`).join("")}</select>
        </label>
        <p class="muted small">FIA scale since 2022: no points with fewer than 2 green-flag laps · below 25%: 6-4-3-2-1 · 25–50%: 13-10-8-6-5-4-3-2-1 · 50–75%: 19-14-12-9-8-6-5-3-2-1 · from 75%: full points.</p>
        <div class="form-row">
          <label>Penalty points for a race ban<input type="number" min="3" max="30" data-rule="penaltyPointsBan" value="${r.penaltyPointsBan}"></label>
          <label>Reprimands for a 10-place grid drop<input type="number" min="2" max="10" data-rule="reprimandsGridDrop" value="${r.reprimandsGridDrop}"></label>
        </div>
        <div class="form-row">
          <label>Heat hazard from (°C forecast)<input type="number" min="25" max="40" data-rule="heatHazard" value="${r.heatHazard}"></label>
          <label>Max. race time / window (h)
            <span class="pair"><input type="number" min="1" max="4" step="0.5" data-rule="maxRaceHours" value="${r.maxRaceHours}"><input type="number" min="2" max="6" step="0.5" data-rule="maxWindowHours" value="${r.maxWindowHours}"></span>
          </label>
        </div>
      </div>
      <div class="setup-card">
        <h2>Technical &amp; financial regulations</h2>
        <div class="form-row">
          <label>Cost cap (million USD)<input type="number" min="50" max="500" step="5" data-rule="costCap" value="${r.costCap}"></label>
          <label>+ per race above 21 (million USD)<input type="number" min="0" max="10" step="0.1" data-rule="costCapPerExtraRace" value="${r.costCapPerExtraRace}"></label>
        </div>
        <label class="check"><input type="checkbox" data-rule="atr" ${r.atr ? "checked" : ""}> Aerodynamic testing restrictions (wind tunnel / CFD time by championship position: 70% for P1 … 115% for P10)</label>
        <h3 class="small">Power unit elements per driver and season${gen2026 ? " (2026: no MGU-H)" : ""}</h3>
        <div class="pu-grid">${pu}</div>
        <p class="muted small">Using more elements than allowed costs grid places (10 for the first extra element, 5 for every further one) – the stewards apply them automatically.</p>
      </div>
    </div>`;
}

// ---------- Step 5: circuits & zones ----------
function wizardZones() {
  const d = seasonDraft;
  const gen2026 = d.generation === "GEN2026";
  const rows = d.calendar.map((r, i) => {
    const c = circuitInfo(r.circuit);
    const own = d.zones[r.circuit];
    const loaded = cachedTracks.has(r.circuit);
    return `
      <tr class="${zoneEditor && zoneEditor.circuit === r.circuit ? "selected" : ""}">
        <td class="pos">${i + 1}</td>
        <td><b>${escapeHtml(c.name)}</b></td>
        <td><span class="state ${loaded ? "ok" : ""}">${loaded ? "stored" : "not loaded"}</span></td>
        <td>${own ? `<span class="state edit">own zones</span>` : `<span class="muted small">automatic</span>`}</td>
        <td class="row-actions"><button data-zone-open="${r.circuit}">Edit zones</button></td>
      </tr>`;
  }).join("");
  return `
    <div class="season-grid wide-right">
      <div class="setup-card">
        <div class="card-head"><h2>Circuits</h2></div>
        <p class="muted small">The real circuits are built from OpenF1 data of their latest race (track shape and speed profile). Each circuit is loaded once (a few seconds – the API allows about 30 requests per minute) and then stored in this browser.</p>
        <div class="btn-row"><button id="loadAllTracks" data-load-all="1">Load all circuits</button></div>
        <p id="trackStatus" class="muted small"></p>
        <table class="season-table"><tbody>${rows}</tbody></table>
      </div>
      <div class="setup-card">
        <div class="card-head"><h2>${gen2026 ? "Straight Mode zones &amp; Overtake Mode" : "DRS zones"}</h2><span class="muted" id="zoneCircuitName">${zoneEditor ? escapeHtml(zoneEditor.track.name) : ""}</span></div>
        ${zoneEditor ? zoneEditorHtml() : `<p class="muted">Choose "Edit zones" for a circuit. Without changes, the zones are placed automatically on the longest straights.</p>`}
      </div>
    </div>`;
}

// When a circuit was loaded we know it is in the browser
async function refreshCacheState() {
  const keys = await cachedTrackKeys();
  const before = cachedTracks.size;
  cachedTracks = new Set(keys);
  if (cachedTracks.size !== before && seasonStep === 4 && !$("seasonScreen").hidden && !trackLoading) renderWizardKeepScroll();
}

function renderWizardKeepScroll() {
  const y = window.scrollY;
  if (season && !seasonDraft) renderHub();
  else renderWizard();
  window.scrollTo(0, y);
}

let trackLoading = false;
async function loadAllTracks(circuitKeys) {
  if (trackLoading) return;
  trackLoading = true;
  const keys = circuitKeys.filter(k => !cachedTracks.has(k));
  let done = 0;
  const failed = [];
  for (const key of keys) {
    const status = text => { const el = $("trackStatus"); if (el) el.textContent = "(" + (done + 1) + " / " + keys.length + ") " + text; };
    try {
      await loadSeasonTrackData(key, status);
      cachedTracks.add(key);
    } catch (error) {
      failed.push(circuitInfo(key).name);
    }
    done++;
    trackLoading = false;
    renderWizardKeepScroll();
    trackLoading = true;
  }
  trackLoading = false;
  const el = $("trackStatus");
  if (el) el.textContent = keys.length === 0 ? "All circuits are already stored." :
    failed.length ? "Could not load: " + failed.join(", ") + ". Try again later." : "All circuits are stored.";
}


// =====================================================================
//  4. ZONE EDITOR
// =====================================================================
// zones are stored per circuit: { drs: [{start, end, detect}], straight: [{start, end}], overtakeDetect }
async function openZoneEditor(circuitKey, zonesStore) {
  const el = $("trackStatus");
  try {
    const track = await loadSeasonTrack(circuitKey, null, text => { if (el) el.textContent = text; });
    cachedTracks.add(circuitKey);
    const own = zonesStore[circuitKey];
    const base = own || track.autoZones;
    zoneEditor = {
      circuit: circuitKey,
      track,
      store: zonesStore,
      zones: JSON.parse(JSON.stringify({ drs: base.drs || track.autoZones.drs, straight: base.straight || track.autoZones.straight,
        overtakeDetect: base.overtakeDetect !== undefined ? base.overtakeDetect : track.autoZones.overtakeDetect })),
      pick: null
    };
    if (el) el.textContent = "";
  } catch (error) {
    if (el) el.textContent = error.message;
    return;
  }
  renderWizardKeepScroll();
}

function zoneGeneration() {
  return (seasonDraft || season).generation;
}

function zoneEditorHtml() {
  const z = zoneEditor.zones;
  const L = Math.round(zoneEditor.track.length);
  const gen2026 = zoneGeneration() === "GEN2026";
  const list = gen2026 ? z.straight : z.drs;
  const pick = zoneEditor.pick;
  const field = (i, name) => `
    <span class="zone-field">
      <input type="number" min="0" max="${L}" step="10" data-zone-set="${i}:${name}" value="${Math.round(i < 0 ? z.overtakeDetect : list[i][name])}">
      <button data-zone-pick="${i}:${name}" class="${pick && pick.i === i && pick.name === name ? "on" : ""}" title="Click on the map to place it">⌖</button>
    </span>`;
  const rows = list.map((zone, i) => {
    const len = Math.round(mod(zone.end - zone.start, zoneEditor.track.length));
    return `
      <tr>
        <td class="pos">${i + 1}</td>
        ${gen2026 ? "" : `<td>${field(i, "detect")}</td>`}
        <td>${field(i, "start")}</td>
        <td>${field(i, "end")}</td>
        <td class="${len < 150 || len > 2200 ? "deleted" : "muted"}">${len} m</td>
        <td class="row-actions"><button data-zone-remove="${i}" title="Remove the zone">✕</button></td>
      </tr>`;
  }).join("");
  return `
    <canvas id="zoneCanvas" class="zone-canvas"></canvas>
    <p class="muted small">${pick ? "Click on the map to set the " + (pick.i < 0 ? "Overtake Mode detection point" : pick.name + " of zone " + (pick.i + 1)) + "." :
      "Distances in metres after the start/finish line (lap: " + L + " m). Use ⌖ to place a point on the map."}</p>
    <table class="season-table zone-table">
      <thead><tr><th>#</th>${gen2026 ? "" : "<th>Detection</th>"}<th>Zone start</th><th>Zone end</th><th>Length</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${gen2026 ? `<p><b class="small">Overtake Mode detection point</b> ${field(-1, "detect")}</p>` : ""}
    <div class="btn-row">
      <button data-zone-add="1" ${list.length >= 6 ? "disabled" : ""}>+ Add zone</button>
      <button data-zone-reset="1">Back to automatic zones</button>
      <button data-zone-save="1" class="button-primary">Save zones</button>
    </div>`;
}

function drawZoneEditor() {
  const canvas = $("zoneCanvas");
  if (!canvas || !zoneEditor) return;
  const tr = zoneEditor.track;
  const w = canvas.clientWidth || 500;
  const h = Math.round(w * 0.72);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const view = makeView(tr, ctx, w, h, tr.bounds, 28);
  zoneEditor.view = view;
  strokeSegment(view, 0, tr.length, COLOURS.border, 13);
  strokeSegment(view, 0, tr.length, COLOURS.tarmac, 8);

  const gen2026 = zoneGeneration() === "GEN2026";
  const z = zoneEditor.zones;
  const colour = gen2026 ? "#4fd8ff" : COLOURS.drs;
  const list = gen2026 ? z.straight : z.drs;
  list.forEach((zone, i) => {
    strokeSegment(view, zone.start, zone.end, colour, 6, null, true);
    const mid = screenAt(view, zone.start + mod(zone.end - zone.start, tr.length) / 2, -20);
    label(ctx, String(i + 1), mid.x - 3, mid.y + 4, colour, 12, true);
    if (!gen2026) marker(view, zone.detect, colour, "D" + (i + 1));
  });
  if (gen2026) marker(view, z.overtakeDetect, "#ffffff", "OT");

  // start / finish line and the corners
  const a = screenAt(view, 0, -12);
  const b = screenAt(view, 0, 12);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  for (const c of tr.corners || []) {
    const p = screenAt(view, c.apex, 16);
    label(ctx, c.name.replace("Turn ", "T"), p.x - 6, p.y + 4, COLOURS.muted, 10);
  }
}

// a small cross-line with a label at metre s
function marker(view, s, colour, text) {
  const ctx = view.ctx;
  const p1 = screenAt(view, s, -10);
  const p2 = screenAt(view, s, 10);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  const p = screenAt(view, s, 24);
  label(ctx, text, p.x - 8, p.y + 4, colour, 10, true);
}

// metre of the track nearest to a click
function trackMetreAt(view, x, y) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < view.track.n; i++) {
    const d = (view.px[i] - x) ** 2 + (view.py[i] - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return Math.round(best * view.track.ds);
}

function setZoneValue(i, name, value) {
  const z = zoneEditor.zones;
  const L = zoneEditor.track.length;
  value = mod(Math.round(Number(value) || 0), L);
  if (i < 0) z.overtakeDetect = value;
  else (zoneGeneration() === "GEN2026" ? z.straight : z.drs)[i][name] = value;
}

function zoneEditorClick(event) {
  const t = event.target;
  const z = zoneEditor && zoneEditor.zones;
  const list = z && (zoneGeneration() === "GEN2026" ? z.straight : z.drs);
  if (t.id === "zoneCanvas" && zoneEditor.pick) {
    const rect = t.getBoundingClientRect();
    const s = trackMetreAt(zoneEditor.view, event.clientX - rect.left, event.clientY - rect.top);
    setZoneValue(zoneEditor.pick.i, zoneEditor.pick.name, s);
    zoneEditor.pick = null;
    renderWizardKeepScroll();
    return true;
  }
  const b = t.closest("button");
  if (!b) return false;
  if (b.dataset.zonePick) {
    const [i, name] = b.dataset.zonePick.split(":");
    const same = zoneEditor.pick && zoneEditor.pick.i === Number(i) && zoneEditor.pick.name === name;
    zoneEditor.pick = same ? null : { i: Number(i), name };
  } else if (b.dataset.zoneRemove) {
    list.splice(Number(b.dataset.zoneRemove), 1);
  } else if (b.dataset.zoneAdd) {
    const L = zoneEditor.track.length;
    const start = mod(L * 0.5, L);
    list.push(zoneGeneration() === "GEN2026" ? { start, end: mod(start + 400, L) } : { detect: mod(start - 150, L), start, end: mod(start + 400, L) });
  } else if (b.dataset.zoneReset) {
    delete zoneEditor.store[zoneEditor.circuit];
    const a = zoneEditor.track.autoZones;
    zoneEditor.zones = JSON.parse(JSON.stringify({ drs: a.drs, straight: a.straight, overtakeDetect: a.overtakeDetect }));
    if (season && !seasonDraft) saveSeason();
    showToast("Automatic zones restored.");
  } else if (b.dataset.zoneSave) {
    list.sort((a, b2) => a.start - b2.start);
    zoneEditor.store[zoneEditor.circuit] = JSON.parse(JSON.stringify(zoneEditor.zones));
    if (season && !seasonDraft) saveSeason();
    showToast("Zones of " + zoneEditor.track.name + " saved.");
  } else {
    return false;
  }
  renderWizardKeepScroll();
  return true;
}


// =====================================================================
//  3. THE SEASON OVERVIEW (hub)
// =====================================================================
function openSeason(id) {
  if (!loadSeason(id)) {
    showToast("This season could not be loaded.");
    return;
  }
  seasonDraft = null;
  zoneEditor = null;
  showSeasonScreen(true);
  renderHub();
  cachedTrackKeys().then(keys => { cachedTracks = new Set(keys); });
}

let hubTab = "calendar";
let hubRound = null;                         // round whose results are shown
let hubOptions = { distance: 1, level: 1, offences: 0.2 }; // options for the next session

function renderHub() {
  const s = season;
  ensureRatings(s);
  $("seasonTitle").textContent = s.name;
  $("seasonSub").textContent = s.year + " · " + REGS_INFO[s.generation].name + " · " + s.calendar.length + " rounds · " +
    s.teams.length + " teams · run by the FIA (you)";
  $("seasonSteps").hidden = false;
  const pending = pendingDeskItems(s).length;
  const tabs = { calendar: "Calendar", standings: "Standings", desk: "FIA desk" + (pending ? " (" + pending + ")" : ""), review: "Season review", cars: "Teams & cars", entry: "Entry list", rules: "Rulebook", zones: "Circuits & zones" };
  const upcoming = nextSession(s);
  if (upcoming) prepareWeekend(s, upcoming.round); // the teams arrive: new parts, power units, stand-ins
  $("seasonSteps").innerHTML = Object.keys(tabs).map(k =>
    `<button data-hub-tab="${k}" class="${hubTab === k ? "active" : ""}">${tabs[k]}</button>`).join("");

  const body = $("seasonBody");
  if (hubTab === "calendar") body.innerHTML = hubCalendar();
  if (hubTab === "standings") body.innerHTML = hubStandings();
  if (hubTab === "cars") body.innerHTML = hubCars();
  if (hubTab === "desk") body.innerHTML = hubDesk();
  if (hubTab === "review") body.innerHTML = hubReview();
  if (hubTab === "entry") body.innerHTML = hubEntry();
  if (hubTab === "rules") body.innerHTML = hubRules();
  if (hubTab === "zones") {
    // the zone editor of the wizard works on the season zones
    body.innerHTML = wizardZonesForSeason();
  }
  $("seasonFoot").innerHTML = `
    <button data-hub="export">Export season file</button>
    <span class="muted small">Saved automatically in this browser · last change ${new Date(s.updated).toLocaleString()}</span>
    <button data-hub="close">Close</button>`;
  if (hubTab === "zones" && zoneEditor) drawZoneEditor();
}

function shortDate(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function driverCell(id, withTeam) {
  const d = season.drivers[id];
  const t = seasonTeam(d ? d.team : teamOfDriver(season, id));
  return `<span class="team-bar" style="background:${t ? t.colour : "#888"}"></span><span class="num">${d ? d.number : ""}</span><b>${escapeHtml(d ? d.first + " " + d.last : id)}</b>` +
    (withTeam && t ? ` <span class="muted small">${escapeHtml(t.name)}</span>` : "");
}

function hubCalendar() {
  const s = season;
  const next = nextSession(s);
  const rows = s.calendar.map(r => {
    const c = circuitInfo(r.circuit);
    const race = r.sessions.RACE;
    const winner = race && race.status === "DONE" ? race.rows.find(x => x.pos === 1) : null;
    const isNext = next && next.round === r;
    let state = `<span class="state">planned</span>`;
    if (r.status === "DONE") state = `<span class="state ok">finished</span>`;
    else if (r.status === "CANCELLED") state = `<span class="state off">cancelled</span>`;
    else if (isNext) state = `<span class="state edit">${Object.keys(r.sessions).length ? "running" : "next"}</span>`;
    return `
      <tr class="clickable ${isNext ? "selected" : ""} ${hubRound === r.round ? "chosen" : ""}" data-hub-round="${r.round}">
        <td class="pos">${r.round}</td>
        <td class="mono">${shortDate(r.date)}</td>
        <td><b>${escapeHtml(c.gp)}</b><br><span class="muted small">${escapeHtml(c.name)} · ${c.laps} laps${r.sprint ? " · sprint weekend" : ""}</span></td>
        <td class="small">${winner ? "🏆 " + escapeHtml(seasonDriverName(winner.id)) : ""}</td>
        <td>${state}</td>
      </tr>`;
  }).join("");
  const shown = hubRound !== null ? s.calendar.find(r => r.round === hubRound) : null;
  const side = shown && Object.keys(shown.sessions).length ? hubRoundResults(shown) : nextSessionCard(next);
  return `
    <div class="season-grid wide-right">
      <div class="setup-card">
        <div class="card-head"><h2>Calendar</h2><span class="muted">${s.calendar.filter(r => r.status === "DONE").length} / ${s.calendar.length} rounds</span></div>
        <table class="season-table"><tbody>${rows}</tbody></table>
      </div>
      ${side}
    </div>`;
}

// The card of the next session: run it live (auto-simulation follows later)
function nextSessionCard(next) {
  const s = season;
  if (!next) {
    const st = computeStandings(s);
    const champ = st.drivers[0];
    const team = st.teams[0];
    return `
      <div class="setup-card">
        <h2>Season finished</h2>
        <p>World Champion: <b>${champ ? escapeHtml(seasonDriverName(champ.id)) : "–"}</b> (${champ ? champ.points : 0} points)</p>
        <p>Constructors' Champion: <b>${team ? escapeHtml(seasonTeam(team.id).name) : "–"}</b> (${team ? team.points : 0} points)</p>
        <div class="btn-row"><button data-hub-tab="review" class="button-primary">Season review</button><button data-hub-tab="desk">FIA desk${pendingDeskItems(s).length ? " (" + pendingDeskItems(s).length + " open)" : ""}</button></div>
      </div>`;
  }
  const round = next.round;
  const c = circuitInfo(round.circuit);
  const sessions = weekendSessions(round).map(type => {
    const res = round.sessions[type];
    let text = `<span class="muted">to come</span>`;
    if (res && res.status === "DONE") {
      if (type === "SQ" || type === "Q") text = "Pole: " + escapeHtml(seasonDriverName(res.pole));
      else {
        const w = res.rows.find(x => x.pos === 1);
        text = "Winner: " + escapeHtml(w ? seasonDriverName(w.id) : "–");
      }
    } else if (type === next.type) text = `<b>next</b>`;
    return `<tr class="${type === next.type ? "selected" : ""}"><td><b>${SESSION_NAMES[type]}</b></td><td class="small">${text}</td></tr>`;
  }).join("");
  const opt = hubOptions;
  const quali = next.type === "Q" || next.type === "SQ";
  const weatherPanel = weekendWeatherPanel(round);
  return `
    <div class="setup-card">
      <div class="card-head"><h2>Round ${round.round} · ${escapeHtml(c.gp)}</h2><span class="muted">${shortDate(round.date)}</span></div>
      <p class="muted small">${escapeHtml(c.name)} · ${c.laps} laps · ${round.sprint ? "sprint weekend" : "normal weekend"}</p>
      <table class="season-table"><tbody>${sessions}</tbody></table>
      ${round.notes && round.notes.length ? `<h3>News from the paddock</h3><ul class="season-log">${round.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : ""}
      ${weatherPanel}
      <div class="form-row">
        <label>${quali ? "Session length" : "Race distance"}
          <select id="sDistance">
            <option value="1" ${opt.distance === 1 ? "selected" : ""}>${quali ? "Full" : "Full distance"}</option>
            <option value="0.5" ${opt.distance === 0.5 ? "selected" : ""}>${quali ? "Short (half the time)" : "50 %"}</option>
            ${quali ? "" : `<option value="0.25" ${opt.distance === 0.25 ? "selected" : ""}>25 %</option>`}
          </select>
        </label>
        <label title="Crashes, spins, failures, debris">Incidents
          <select id="sLevel">
            <option value="0.5" ${opt.level === 0.5 ? "selected" : ""}>Few</option>
            <option value="1" ${opt.level === 1 ? "selected" : ""}>Normal</option>
            <option value="1.6" ${opt.level === 1.6 ? "selected" : ""}>Many</option>
          </select>
        </label>
        <label title="Speeding, impeding, blue flags, forcing off, delta times ... – how much work the stewards get">Offences
          <select id="sOffences">
            <option value="0.2" ${opt.offences === 0.2 ? "selected" : ""}>Realistic</option>
            <option value="0.5" ${opt.offences === 0.5 ? "selected" : ""}>Busy stewards</option>
            <option value="1" ${opt.offences === 1 ? "selected" : ""}>Every offence</option>
          </select>
        </label>
      </div>
      <div class="btn-row">
        <button class="button-primary" data-session-live="${round.round}:${next.type}">Direct the ${SESSION_NAMES[next.type]} live</button>
      </div>
      <div class="btn-row">
        <span class="muted small">Auto-simulate (AI Race Director &amp; Stewards):</span>
        <button data-auto="SESSION" title="Run this session at full speed">${SESSION_NAMES[next.type]}</button>
        <button data-auto="WEEKEND" title="Run the remaining sessions of this weekend">Rest of the weekend</button>
        <button data-auto="SEASON" title="Run every remaining session of the season">Rest of the season</button>
      </div>
      <div class="progress" id="autoProgress" hidden><div></div></div>
      <p id="sessionStatus" class="muted small">${quali ? "" : "Full points are awarded even with a shorter race distance – it only sets how long you direct the race."}</p>
    </div>`;
}

// Auto-simulate one session, the rest of the weekend or the rest of the season
let autoRunning = false;
async function runAutoSimulation(scope) {
  if (autoRunning) return;
  if (scope === "SEASON") {
    const left = season.calendar.filter(r => r.status !== "DONE" && r.status !== "CANCELLED").length;
    if (!confirm("Auto-simulate all remaining sessions of " + left + " round(s)? You will not direct any of them.")) return;
  }
  autoRunning = true;
  document.querySelectorAll("#seasonScreen button").forEach(b => { b.disabled = true; });
  const bar = $("autoProgress");
  if (bar) bar.hidden = false;
  const started = Date.now();
  try {
    const count = await autoSimulate(scope, Object.assign({}, hubOptions), (share, text) => {
      const el = $("sessionStatus");
      if (el) el.textContent = text;
      if (bar) bar.firstElementChild.style.width = Math.round(share * 100) + "%";
    });
    showToast(count + " session(s) simulated in " + Math.round((Date.now() - started) / 1000) + " s.");
  } catch (error) {
    console.error(error);
    showToast("Auto-simulation stopped: " + error.message);
  }
  autoRunning = false;
  hubRound = null;
  renderHub();
}

// The weather service's forecast for the weekend, warnings and the FIA's options
function weekendWeatherPanel(round) {
  const s = season;
  const list = weekendForecast(s, round);
  if (!list.length) return "";
  const rows = list.map(x => {
    const f = x.forecast;
    const sky = f.thunder >= 40 ? "⛈" : f.rain >= 60 ? "🌧" : f.rain >= 30 ? "🌦" : "☀";
    return `<tr class="${x.severe ? "warn-row" : ""}"><td><b>${SESSION_NAMES[x.type]}</b><br><span class="muted small">${formatWeekendTime(x.at)}</span></td>
      <td>${sky} ${f.rain}%${f.intensity ? " " + f.intensity : ""}${f.thunder ? ` <span class="small">⚡ ${f.thunder}%</span>` : ""}</td>
      <td class="small">${f.air}° · wind ${f.wind}${f.gust > f.wind + 10 ? "–" + f.gust : ""} km/h</td></tr>`;
  }).join("");
  const severe = list.filter(x => x.severe);
  const heat = heatForecast(s, round);
  const actions = [];
  const notRun = t => !round.sessions[t];
  if (round.sessions && !Object.keys(round.sessions).length) {
    for (const date of freeWeekends(s, round).slice(0, 3)) actions.push(`<button data-fia="postpone:${date}">Postpone to ${shortDate(date)}</button>`);
    actions.push(`<button data-fia="cancelEvent:" class="danger-btn">Cancel the event</button>`);
  }
  if (notRun("Q") && !(round.schedule && round.schedule.Q)) actions.unshift(`<button data-fia="moveQ:">Move Qualifying to Sunday morning</button>`);
  if (round.sprint && notRun("SQ") && !(round.schedule && round.schedule.SQ)) actions.unshift(`<button data-fia="moveSQ:">Move Sprint Qualifying to Saturday morning</button>`);
  for (const x of severe) actions.push(`<button data-fia="cancelSession:${x.type}" class="danger-btn">Cancel ${SESSION_NAMES[x.type]}</button>`);
  return `
    <h3>Weather forecast <span class="muted small">(weather service, ${forecastNow(s, round) < 0 ? "issued on Thursday" : "updated after the last session"})</span></h3>
    <table class="season-table"><tbody>${rows}</tbody></table>
    ${severe.length ? `<div class="result-box bad">⚠ Severe weather warning for ${severe.map(x => SESSION_NAMES[x.type]).join(", ")}: ${severe.some(x => x.forecast.thunder >= 40) ? "thunderstorms with lightning" : "heavy rain"} expected. The FIA can move or cancel sessions, postpone or cancel the event – or run it and decide on the day.</div>` : ""}
    ${heat >= s.rules.heatHazard ? `<label class="check small"><input type="checkbox" data-fia-heat="1" ${round.heatDeclared ? "checked" : ""}> Declare a heat hazard (forecast ${Math.round(heat)} °C – cooling kits for the drivers)</label>` : ""}
    <details class="fia-actions"><summary>FIA decisions about this event</summary><div class="btn-row">${actions.join("")}</div></details>`;
}

// ---------- FIA desk: decisions and information ----------
const DESK_ICONS = { PROTEST: "⚖", TECHNICAL: "🔧", NOMINATION: "🪪", AUDIT: "💰", AUDIT_OK: "💰", BAN: "⛔" };

function deskItemHtml(item) {
  const round = item.round ? `<span class="muted small">Round ${item.round}</span>` : `<span class="muted small">after the season</span>`;
  let footer = "";
  if (item.status === "PENDING") {
    footer = `<div class="btn-row">${item.options.map(o => `<button data-desk="${item.id}:${o.key}" class="${o.danger ? "danger-btn" : ""}">${escapeHtml(o.label)}</button>`).join("")}</div>`;
  } else if (item.status === "DONE") {
    const chosen = item.options.find(o => o.key === item.decision);
    footer = `<p class="small">Decision: <b>${escapeHtml(chosen ? chosen.label : item.decision)}</b>${item.automatic ? " <span class=\"muted\">(automatic)</span>" : ""}</p>`;
  }
  return `
    <div class="desk-item ${item.status.toLowerCase()}">
      <div class="card-head"><b>${DESK_ICONS[item.type] || "•"} ${escapeHtml(item.title)}</b>${round}</div>
      <p class="small">${escapeHtml(item.text)}</p>
      ${footer}
    </div>`;
}

function hubDesk() {
  const s = season;
  const items = (s.inbox || []).filter(x => x.title); // old saves: plain notes without a title are shown in the log
  const pending = items.filter(x => x.status === "PENDING");
  const rest = items.filter(x => x.status !== "PENDING").reverse();
  return `
    <div class="season-grid two">
      <div class="setup-card">
        <div class="card-head"><h2>Waiting for a decision</h2><span class="muted">${pending.length}</span></div>
        <p class="muted small">Protests, reports of the technical delegate, driver changes and the cost cap audit. A driver change that is not decided before the next weekend is approved automatically.</p>
        ${pending.map(deskItemHtml).join("") || `<p class="muted">Nothing to decide at the moment.</p>`}
      </div>
      <div class="setup-card">
        <div class="card-head"><h2>Decided &amp; information</h2></div>
        ${rest.slice(0, 30).map(deskItemHtml).join("") || `<p class="muted">Nothing yet.</p>`}
      </div>
    </div>`;
}

// ---------- Season review ----------
function hubReview() {
  const s = season;
  const v = seasonReviewData(s);
  const finished = s.phase === "FINISHED";
  const stat = (label, value) => `<div class="stat"><span class="muted small">${label}</span><b>${value}</b></div>`;
  const champ = v.champion ? seasonDriverName(v.champion.id) : "–";
  const team = v.constructor ? seasonTeam(v.constructor.id).name : "–";
  const deducted = v.standings.teams.filter(t => t.deducted);
  return `
    <div class="season-grid wide-left">
      <div class="setup-card">
        <div class="card-head"><h2>${finished ? "Season review " + s.year : "The season so far"}</h2><span class="muted">${v.races} of ${s.calendar.length} Grands Prix${v.cancelled ? " · " + v.cancelled + " cancelled" : ""}</span></div>
        <div class="review-champs">
          <div><span class="muted small">${finished ? "World Champion" : "Leader"}</span><b>${escapeHtml(champ)}</b><span class="small">${v.champion ? v.champion.points + " points · " + v.champion.wins + " wins" : ""}</span></div>
          <div><span class="muted small">${finished ? "Constructors' Champion" : "Leading team"}</span><b>${escapeHtml(team)}</b><span class="small">${v.constructor ? v.constructor.points + " points" : ""}</span></div>
        </div>
        <div class="stats">
          ${stat("Different winners", v.winners)}
          ${stat("Overtakes", v.overtakes)}
          ${stat("Safety Cars / VSC", v.safetyCars + " / " + v.vsc)}
          ${stat("Red flags", v.redFlags)}
          ${stat("Wet sessions", v.wet)}
          ${stat("Abandoned sessions", v.abandoned)}
          ${stat("Upgrades", v.upgrades)}
          ${stat("Power unit grid penalties", v.puPenalties)}
          ${stat("Race bans", v.bans)}
        </div>
        ${deducted.length ? `<p class="small mark-bad">Points deducted: ${deducted.map(t => escapeHtml(seasonTeam(t.id).name) + " −" + t.deducted).join(", ")}</p>` : ""}
        ${finished ? `<div class="btn-row"><button data-next-season="1" class="button-primary" ${s.nextSeason ? "disabled" : ""}>${s.nextSeason ? "Next season already created" : "Start the next season →"}</button></div>
          <p class="muted small">Same teams, drivers and rulebook. The cars carry over and develop over the winter with the wind tunnel time of the final standings (minus any cost cap penalty).</p>` : ""}
      </div>
      <div class="setup-card">
        <h2>Your record as the FIA</h2>
        <div class="stats">
          ${stat("Sessions directed live", v.liveSessions)}
          ${stat("Average Race Director rating", v.rdAverage === null ? "–" : v.rdAverage + " / 100")}
          ${stat("FIA desk decisions", v.deskDecisions)}
          ${stat("Decisions that stood up", v.deskDecisions ? Math.round(v.deskCorrect / v.deskDecisions * 100) + " %" : "–")}
        </div>
        <p class="muted small">"Stood up": protests and technical reports decided in line with the evidence (what the FIA International Court of Appeal would confirm), cost cap breaches sanctioned as the regulations foresee.</p>
        ${v.pending ? `<div class="result-box bad">${v.pending} decision(s) still open on the FIA desk.</div>` : ""}
      </div>
    </div>`;
}

// ---------- Teams & cars: ratings, money, upgrades, power units ----------
function ratingBar(value) {
  const colour = value >= 92 ? "#2fd36b" : value >= 82 ? "#ffd60a" : value >= 70 ? "#ff9f40" : "#ff6b61";
  return `<span class="rating"><span style="width:${clamp(value, 0, 100)}%;background:${colour}"></span></span><span class="small mono">${value.toFixed(1)}</span>`;
}

function hubCars() {
  const s = season;
  ensureRatings(s);
  const next = nextSession(s);
  const circuit = next ? next.round.circuit : s.calendar[s.calendar.length - 1].circuit;
  const cap = seasonCostCap(s);
  const order = s.teams.map(t => ({ t, score: carScore(s, t.id, circuit) })).sort((a, b) => b.score - a.score);
  const best = order[0].score;
  const pecking = order.map((x, i) => `<tr><td class="pos">${i + 1}</td><td><span class="team-bar" style="background:${x.t.colour}"></span><b>${escapeHtml(x.t.name)}</b></td>
    <td class="mono small">${i === 0 ? "–" : "+" + ((best - x.score) * 0.00042 * 90).toFixed(3) + " s"}</td></tr>`).join("");

  const cards = s.teams.map(t => {
    const car = s.cars[t.id];
    const f = s.finance[t.id];
    const coming = f.packages.filter(p => !p.fitted);
    const fitted = f.packages.filter(p => p.fitted);
    const spentShare = f.spent / cap;
    const pu = t.drivers.map(id => {
      const d = s.drivers[id];
      const parts = Object.keys(d.pu || {}).filter(k => ["ICE", "TC", "MGU-K", "ES"].includes(k)).map(k => {
        const el = d.pu[k];
        const over = el.count > s.rules.pu[k];
        return `<span class="${over ? "mark-bad" : el.count === s.rules.pu[k] ? "mark-warn" : ""}" title="${PU_ELEMENT_NAMES[k]}: element ${el.count} of ${s.rules.pu[k]} allowed, ${el.age} / ${el.life} weekends">${k} ${el.count}/${s.rules.pu[k]}</span>`;
      }).join(" ");
      return `<div class="small"><b>${escapeHtml(d.last)}</b> ${parts}</div>`;
    }).join("");
    return `
      <div class="team-card" style="--team:${t.colour}">
        <div class="team-card-head"><span class="team-swatch"></span><b>${escapeHtml(t.name)}</b><span class="muted small">${escapeHtml(car.supplier)}</span></div>
        <table class="rating-table">
          ${Object.keys(CAR_AREAS).map(k => `<tr><td class="muted small">${CAR_AREAS[k]}</td><td>${ratingBar(car[k])}</td></tr>`).join("")}
        </table>
        <div class="small">Spent <b>${f.spent.toFixed(1)}</b> of ${cap.toFixed(1)} M USD cap
          <span class="rating"><span style="width:${clamp(spentShare * 100, 0, 100)}%;background:${spentShare > 1 ? "#ff3b30" : "#4fd8ff"}"></span></span></div>
        <div class="muted small">Budget ${f.budget.toFixed(0)} M · development ${f.development.toFixed(1)} M · crash damage ${f.crashes.toFixed(1)} M · wind tunnel ${Math.round(atrFactor(s, t.id) * 100)} %</div>
        <div class="small">${fitted.length} upgrade(s) fitted${coming.length ? " · " + coming.length + " in production (next: " + coming[0].name + ", round " + coming[0].arrives + ")" : ""}</div>
        ${pu}
      </div>`;
  }).join("");

  const testing = s.testing ? `
      <table class="season-table"><tbody>${s.testing.rows.map((x, i) => {
        const t = seasonTeam(x.team);
        return `<tr><td class="pos">${i + 1}</td><td><span class="team-bar" style="background:${t ? t.colour : "#888"}"></span>${escapeHtml(t ? t.name : x.team)}</td><td class="mono">${formatLapTime(x.time)}</td><td class="muted small">${x.laps} laps</td></tr>`;
      }).join("")}</tbody></table>
      <p class="muted small">Testing times hide a lot: fuel loads and engine modes are secret.</p>`
    : `<p class="muted small">Three days in Bahrain before the season. The times are only a rough hint – nobody shows everything.</p>
       <button data-testing="1" ${s.calendar.some(r => r.status === "DONE") ? "disabled" : ""}>Run pre-season testing</button>`;

  return `
    <div class="season-grid wide-right">
      <div class="setup-card">
        <div class="card-head"><h2>Pecking order</h2><span class="muted small">${next ? escapeHtml(circuitInfo(circuit).name) : ""}</span></div>
        <p class="muted small">Car only (no drivers), at the next circuit – what the FIA's data shows.</p>
        <table class="season-table"><tbody>${pecking}</tbody></table>
        <h3>Pre-season testing</h3>
        ${testing}
      </div>
      <div class="setup-card">
        <div class="card-head"><h2>Teams &amp; cars</h2><span class="muted small">cost cap ${cap.toFixed(1)} M USD · ${REGS_INFO[s.generation].short} cars</span></div>
        <div class="team-grid">${cards}</div>
      </div>
    </div>`;
}

// All results of one weekend
function hubRoundResults(round) {
  const c = circuitInfo(round.circuit);
  const blocks = weekendSessions(round).map(type => {
    const res = round.sessions[type];
    if (res && res.status === "CANCELLED") {
      return `<h3>${SESSION_NAMES[type]}</h3><p class="muted small">${res.abandoned ? "Abandoned before a result was possible" : "Cancelled by the FIA"}${type === "Q" || type === "SQ" ? " – the grid follows the championship order." : " – no points."}</p>`;
    }
    if (!res || res.status !== "DONE") return "";
    if (type === "SQ" || type === "Q") {
      const rows = res.rows.slice().sort((a, b) => (a.pos || 99) - (b.pos || 99)).map(row => {
        const best = row.times.filter(Boolean);
        return `<tr><td class="pos">${row.pos || "DSQ"}</td><td>${driverCell(row.id)}</td><td class="mono">${best.length ? formatLapTime(best[best.length - 1]) : "–"}</td><td>${row.grid}${row.note ? ` <span class="small mark-bad">${escapeHtml(row.note)}</span>` : ""}</td></tr>`;
      }).join("");
      return `<h3>${SESSION_NAMES[type]}</h3><table class="season-table"><thead><tr><th>Pos</th><th>Driver</th><th>Time</th><th>Grid</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    const rows = res.rows.map(row => `
      <tr><td class="pos">${row.pos || row.status}</td><td>${driverCell(row.id)}</td><td class="small">${escapeHtml(row.pos ? row.gap : row.reason || row.status)}</td>
      <td class="small muted">${row.grid}</td><td><b>${row.points || ""}</b>${res.fastestLap && res.fastestLap.id === row.id ? ` <span class="purple small" title="Fastest lap ${formatLapTime(res.fastestLap.time)}">FL</span>` : ""}</td></tr>`).join("");
    return `<h3>${SESSION_NAMES[type]}${res.shortened ? ` <span class="muted small">(${res.shortened} % distance – ${SHORTENED_RULES[season.rules.shortened].name})</span>` : ""}</h3>
      <p class="muted small">${res.weather} · ${res.safetyCars} SC · ${res.vsc} VSC · ${res.redFlags} red flags · ${res.overtakes} overtakes · ${res.auto ? "AI Race Director" : "your Race Director rating " + res.rdScore + " / 100"}</p>
      <table class="season-table"><thead><tr><th>Pos</th><th>Driver</th><th>Gap</th><th>Grid</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join("");
  return `
    <div class="setup-card">
      <div class="card-head"><h2>Round ${round.round} · ${escapeHtml(c.gp)}</h2><button data-hub-round="">Next session →</button></div>
      ${blocks}
    </div>`;
}

function hubStandings() {
  const s = season;
  const st = computeStandings(s);
  const drivers = st.drivers.map((d, i) => {
    const sd = s.drivers[d.id];
    return `<tr><td class="pos">${i + 1}</td><td>${driverCell(d.id, true)}</td><td><b>${d.points}</b></td><td>${d.wins}</td><td>${d.podiums}</td><td>${d.poles}</td><td>${d.fastest}</td><td>${d.dnf}</td>
      <td class="small ${sd && sd.penaltyPoints >= s.rules.penaltyPointsBan - 2 ? "mark-bad" : "muted"}">${sd ? sd.penaltyPoints + " / R" + sd.reprimands : ""}</td></tr>`;
  }).join("");
  const teams = st.teams.map((t, i) => {
    const team = seasonTeam(t.id);
    return `<tr><td class="pos">${i + 1}</td><td><span class="team-bar" style="background:${team.colour}"></span><b>${escapeHtml(team.name)}</b></td><td><b>${t.points}</b></td><td>${t.wins}</td><td>${t.podiums}</td></tr>`;
  }).join("");
  const done = s.calendar.filter(r => r.status === "DONE").length;
  return `
    <div class="season-grid wide-left">
      <div class="setup-card">
        <div class="card-head"><h2>Drivers' Championship</h2><span class="muted">after ${done} of ${s.calendar.length} rounds</span></div>
        <table class="season-table"><thead><tr><th>Pos</th><th>Driver</th><th>Pts</th><th>Wins</th><th>Podiums</th><th>Poles</th><th>FL</th><th>DNF</th><th title="Penalty points on the superlicence / reprimands">Pen. pts</th></tr></thead>
        <tbody>${drivers || `<tr><td colspan="9" class="muted">No race run yet.</td></tr>`}</tbody></table>
      </div>
      <div class="setup-card">
        <div class="card-head"><h2>Constructors' Championship</h2></div>
        <table class="season-table"><thead><tr><th>Pos</th><th>Team</th><th>Pts</th><th>Wins</th><th>Podiums</th></tr></thead>
        <tbody>${teams || `<tr><td colspan="5" class="muted">No race run yet.</td></tr>`}</tbody></table>
        <h3>Season log</h3>
        <ul class="season-log">${s.log.slice().reverse().slice(0, 15).map(l => `<li><span class="muted small">${l.round ? "R" + l.round : ""}</span> ${escapeHtml(l.text)}</li>`).join("")}</ul>
      </div>
    </div>`;
}

function hubEntry() {
  const s = season;
  const cards = s.teams.map(t => `
    <div class="team-card" style="--team:${t.colour}">
      <div class="team-card-head"><span class="team-swatch"></span><b>${escapeHtml(t.name)}</b></div>
      ${t.drivers.map(id => {
        const d = s.drivers[id];
        return `<div class="driver-line">${d.headshot ? `<img src="${d.headshot}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : ""}<span class="num">${d.number}</span><b>${escapeHtml(d.first + " " + d.last)}</b> ${flagSpan(d.country)}</div>`;
      }).join("")}
    </div>`).join("");
  return `<div class="setup-card"><div class="card-head"><h2>Entry list</h2><span class="muted">${s.teams.length} teams · ${s.teams.length * 2} drivers</span></div><div class="team-grid">${cards}</div></div>`;
}

function hubRules() {
  const r = season.rules;
  const row = (k, v) => `<tr><td class="muted">${k}</td><td><b>${v}</b></td></tr>`;
  return `
    <div class="setup-card">
      <h2>Rulebook ${season.year}</h2>
      <table class="season-table">
        ${row("Car generation", REGS_INFO[season.generation].name)}
        ${row("Points", POINTS_SYSTEMS[r.points].name + (r.sprintPoints ? " · sprint 8–1" : "") + (r.fastestLapPoint ? " · fastest lap point" : ""))}
        ${row("Abandoned races", SHORTENED_RULES[r.shortened].name)}
        ${row("Cost cap", r.costCap + " M USD + " + r.costCapPerExtraRace + " M per race above 21")}
        ${row("Wind tunnel / CFD", r.atr ? "sliding scale by championship position" : "the same for every team")}
        ${row("Power unit elements", Object.keys(r.pu).map(k => k + " " + r.pu[k]).join(" · "))}
        ${row("Superlicence", r.penaltyPointsBan + " penalty points = race ban · " + r.reprimandsGridDrop + " reprimands = 10-place grid drop")}
        ${row("Heat hazard", "from " + r.heatHazard + " °C forecast")}
        ${row("Time limits", r.maxRaceHours + " h racing · " + r.maxWindowHours + " h including suspensions")}
      </table>
      <p class="muted small">The rulebook was fixed before the season. Changes during the season come later via the FIA desk.</p>
    </div>`;
}

function wizardZonesForSeason() {
  // reuse the wizard step with the season as data source
  const saved = seasonDraft;
  seasonDraft = { calendar: season.calendar, zones: season.zones, generation: season.generation };
  const html = wizardZones();
  seasonDraft = saved;
  return html;
}


// =====================================================================
//  EVENTS
// =====================================================================
function draftChanged() {
  const y = window.scrollY;
  renderWizard();
  window.scrollTo(0, y);
}

function wireSeasonUi() {
  renderSeasonList();
  $("newSeason").addEventListener("click", openWizard);
  $("importSeason").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const error = importSeason(await file.text());
    event.target.value = "";
    showToast(error || "Season imported.");
    renderSeasonList();
  });
  $("seasonList").addEventListener("click", event => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.seasonOpen) openSeason(b.dataset.seasonOpen);
    if (b.dataset.seasonExport) {
      const s = storageGet(SEASON_KEY_PREFIX + b.dataset.seasonExport);
      if (s) exportSeason(s);
    }
    if (b.dataset.seasonDelete) {
      const s = listSeasons().find(x => x.id === b.dataset.seasonDelete);
      if (s && confirm("Delete the season \"" + s.name + "\"? This cannot be undone (export it first to keep a copy).")) {
        deleteSeason(s.id);
        renderSeasonList();
      }
    }
  });

  const screen = $("seasonScreen");
  screen.addEventListener("click", event => {
    // zone editor (wizard step 5 or hub tab)
    if (zoneEditor && (seasonDraft ? seasonStep === 4 : hubTab === "zones") && zoneEditorClick(event)) return;
    const b = event.target.closest("button, tr[data-hub-round]"); // calendar rows can be clicked too
    if (!b) return;
    const d = seasonDraft;
    const ds = b.dataset;

    if (ds.seasonBack) {
      if (d && !confirm("Leave the setup? The new championship is not saved yet.")) return;
      seasonDraft = null;
      season = null;
      showSeasonScreen(false);
      renderSeasonList();
      return;
    }

    // ----- hub -----
    if (!d) {
      if (ds.hubTab) {
        hubTab = ds.hubTab;
        zoneEditor = null;
        renderHub();
      } else if (ds.hubRound !== undefined) {
        hubRound = ds.hubRound === "" || Number(ds.hubRound) === hubRound ? null : Number(ds.hubRound);
        renderWizardKeepScroll();
      } else if (ds.desk) {
        const [id, key] = ds.desk.split(":");
        const item = season.inbox.find(x => x.id === Number(id));
        const option = item && item.options.find(o => o.key === key);
        if (!item || !option || (option.danger && !confirm(option.label + "?"))) return;
        decideDeskItem(season, item, key);
        renderHub();
      } else if (ds.nextSeason) {
        if (!confirm("Start the next season with the same teams, drivers, cars and rulebook?")) return;
        const next = createNextSeason(season);
        hubTab = "calendar";
        openSeason(next.id);
        showToast("" + next.name + " created.");
      } else if (ds.testing) {
        preSeasonTesting(season);
        saveSeason(season);
        renderHub();
      } else if (ds.fia) {
        const [action, value] = ds.fia.split(":");
        const next = nextSession(season);
        if (!next) return;
        const sure = action === "cancelEvent" ? confirm("Cancel the " + circuitInfo(next.round.circuit).gp + "? No points are awarded for it.")
          : action === "cancelSession" ? confirm("Cancel the " + SESSION_NAMES[value] + "?") : true;
        if (!sure) return;
        fiaWeekendAction(season, next.round, action, value);
        renderHub();
      } else if (ds.auto) {
        runAutoSimulation(ds.auto);
      } else if (ds.sessionLive) {
        const [roundNumber, type] = ds.sessionLive.split(":");
        b.disabled = true;
        const status = text => { const el = $("sessionStatus"); if (el) el.textContent = text; };
        startSeasonSession(Number(roundNumber), type, Object.assign({}, hubOptions), status).catch(error => {
          console.error(error);
          status("Could not start the session: " + error.message);
          b.disabled = false;
        });
      } else if (ds.hub === "export") exportSeason(season);
      else if (ds.hub === "close") {
        season = null;
        showSeasonScreen(false);
        renderSeasonList();
      } else if (ds.zoneOpen) openZoneEditor(Number(ds.zoneOpen), season.zones);
      else if (ds.loadAll) loadAllTracks(season.calendar.map(r => r.circuit));
      return;
    }

    // ----- wizard -----
    if (ds.step !== undefined) seasonStep = Number(ds.step);
    else if (ds.wizard === "back") seasonStep = Math.max(0, seasonStep - 1);
    else if (ds.wizard === "next") seasonStep = Math.min(WIZARD_STEPS.length - 1, seasonStep + 1);
    else if (ds.wizard === "create") {
      const problems = checkDraft(d);
      if (problems.length) {
        showToast(problems[0]);
        return;
      }
      const s = createSeason(d);
      seasonDraft = null;
      zoneEditor = null;
      hubTab = "calendar";
      openSeason(s.id);
      showToast("Championship created and saved.");
      return;
    } else if (ds.baseYear) {
      const keep = { name: d.name, year: d.year, generation: d.generation };
      seasonDraft = Object.assign(newSeasonDraft(Number(ds.baseYear), keep.generation), { name: keep.name, year: keep.year });
    } else if (ds.calUp) {
      const i = Number(ds.calUp);
      [d.calendar[i - 1], d.calendar[i]] = [d.calendar[i], d.calendar[i - 1]];
    } else if (ds.calDown) {
      const i = Number(ds.calDown);
      [d.calendar[i + 1], d.calendar[i]] = [d.calendar[i], d.calendar[i + 1]];
    } else if (ds.calRemove) d.calendar.splice(Number(ds.calRemove), 1);
    else if (ds.calAdd) {
      if (d.calendar.length < MAX_ROUNDS) d.calendar.push({ circuit: Number(ds.calAdd), sprint: false });
    } else if (ds.calSort) d.calendar.sort((a, b) => circuitInfo(a.circuit).date.localeCompare(circuitInfo(b.circuit).date));
    else if (ds.calClear) d.calendar = [];
    else if (ds.teamRemove) d.teams.splice(Number(ds.teamRemove), 1);
    else if (ds.teamAdd) {
      const info = teamInYear(ds.teamAdd, d.baseYear);
      const used = new Set(d.teams.flatMap(t => t.drivers));
      d.teams.push({ id: info.id, name: info.name, colour: info.colour, drivers: info.drivers.map(x => used.has(x) ? "" : x) });
    } else if (ds.zoneOpen) {
      openZoneEditor(Number(ds.zoneOpen), d.zones);
      return;
    } else if (ds.loadAll) {
      loadAllTracks(d.calendar.map(r => r.circuit));
      return;
    } else return;
    if (ds.step !== undefined || ds.wizard) zoneEditor = null;
    if (ds.step !== undefined || ds.wizard) {
      renderWizard();
      window.scrollTo(0, 0);
    } else draftChanged();
  });

  screen.addEventListener("change", event => {
    const t = event.target;
    const ds = t.dataset;
    if (zoneEditor && ds.zoneSet) {
      const [i, name] = ds.zoneSet.split(":");
      setZoneValue(Number(i), name, t.value);
      renderWizardKeepScroll();
      return;
    }
    if (t.id === "sDistance") hubOptions.distance = Number(t.value);
    if (t.id === "sLevel") hubOptions.level = Number(t.value);
    if (t.id === "sOffences") hubOptions.offences = Number(t.value);
    if (ds.fiaHeat && season && !seasonDraft) {
      const next = nextSession(season);
      if (next) fiaWeekendAction(season, next.round, "heat");
      renderHub();
      return;
    }
    const d = seasonDraft;
    if (!d) return;
    if (t.id === "wName") d.name = t.value;
    else if (t.id === "wYear") d.year = clamp(Math.round(Number(t.value) || d.year), 2023, 2100);
    else if (t.id === "wGen") {
      d.generation = t.value;
      const fresh = defaultRules(d.generation);
      d.rules.costCap = fresh.costCap; // the generation decides the default cost cap and the power unit elements
      d.rules.pu = fresh.pu;
    } else if (ds.calSprint) d.calendar[Number(ds.calSprint)].sprint = t.checked;
    else if (ds.teamName) d.teams[Number(ds.teamName)].name = t.value;
    else if (ds.teamColour) d.teams[Number(ds.teamColour)].colour = t.value;
    else if (ds.teamDriver) {
      const [i, k] = ds.teamDriver.split(":").map(Number);
      d.teams[i].drivers[k] = t.value;
    } else if (ds.rule) {
      const r = d.rules;
      if (t.type === "checkbox") r[ds.rule] = t.checked;
      else if (t.type === "number") r[ds.rule] = Number(t.value);
      else r[ds.rule] = t.value;
    } else if (ds.rulePu) d.rules.pu[ds.rulePu] = clamp(Math.round(Number(t.value) || 1), 1, 10);
    else return;
    draftChanged();
  });

  $("seasonRcBtn").addEventListener("click", abandonSeasonSession);

  window.addEventListener("resize", () => {
    if (zoneEditor && !$("seasonScreen").hidden) drawZoneEditor();
  });
}
