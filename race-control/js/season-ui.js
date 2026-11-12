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


// The data packs (data-registry.js): built in and imported
function renderPackList() {
  const el = $("packList");
  if (!el) return;
  $("packCount").textContent = "· " + DATA_PACKS.length + " pack" + (DATA_PACKS.length === 1 ? "" : "s");
  // the seasons that can be raced: 2020, 2023–2026 ...
  const ranges = [];
  for (const y of SEASON_YEARS) {
    const last = ranges[ranges.length - 1];
    if (last && y === last[1] + 1) last[1] = y;
    else ranges.push([y, y]);
  }
  if ($("packYears")) $("packYears").textContent = ranges.map(r => (r[0] === r[1] ? r[0] : r[0] + "–" + r[1])).join(", ");
  el.innerHTML = DATA_PACKS.map(({ pack, builtIn }) => {
    const years = new Set();
    for (const c of pack.circuits || []) for (const m of c.meetings || []) years.add(m.year);
    const ys = [...years].sort();
    const span = ys.length ? (ys.length > 1 ? ys[0] + "–" + ys[ys.length - 1] : ys[0]) + " · " : "";
    return `
      <div class="season-row">
        <div><b>${escapeHtml(pack.name || pack.id)}</b>
          <span class="muted small">${span}${(pack.circuits || []).length} circuits · ${(pack.teams || []).length} teams · ${(pack.drivers || []).length} drivers · ${builtIn ? "built in" : "imported"}</span></div>
        <div class="btn-row">${builtIn ? "" : `<button data-pack-remove="${escapeHtml(pack.id)}" class="danger-btn" title="Remove this pack from the browser">✕</button>`}</div>
      </div>`;
  }).join("");
}

// Seasons that use a pack (they can't be opened without it)
function seasonsUsingPack(id) {
  return listSeasons().filter(x => {
    const s = storageGet(SEASON_KEY_PREFIX + x.id);
    return s && (s.packs || []).includes(id);
  });
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
  // what stops the championship from being created: on every step, at the top, with a link to the step
  if (problems.length) {
    const stepOf = p => /team|driver|drives for/i.test(p) ? 2 : /calendar|rounds/i.test(p) ? 1 : null;
    body.insertAdjacentHTML("afterbegin", `
      <div class="wizard-problems">
        <b>⚠ The championship can't be created yet</b>
        <ul>${problems.map(p => {
          const step = stepOf(p);
          return `<li>${escapeHtml(p)}${step !== null && step !== seasonStep ? ` <button data-step="${step}">Go to ${WIZARD_STEPS[step]}</button>` : ""}</li>`;
        }).join("")}</ul>
      </div>`);
  }
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
          <label>Season year<input id="wYear" type="number" min="1950" max="2100" value="${d.year}"></label>
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
    const c = roundInfo(r);
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
        <div class="card-head"><h2>Circuits</h2><span class="muted">from the loaded data packs</span></div>
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
      <div class="card-head"><h2>Entry list</h2><span class="${d.teams.length > MAX_TEAMS ? "team-count-bad" : "muted"}">${d.teams.length} / ${MAX_TEAMS} teams${d.teams.length > MAX_TEAMS ? " – remove " + (d.teams.length - MAX_TEAMS) : ""}</span></div>
      <p class="muted small">Every constructor of the loaded data packs can enter, with any driver. Names and colours can be changed (e.g. "Sauber" instead of "Audi").</p>
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
    const c = roundInfo(r);
    const own = d.zones[r.circuit];
    const builtIn = hasBundledLayout(r.circuit);
    const loaded = builtIn || cachedTracks.has(r.circuit);
    return `
      <tr class="${zoneEditor && zoneEditor.circuit === r.circuit ? "selected" : ""}">
        <td class="pos">${i + 1}</td>
        <td><b>${escapeHtml(c.name)}</b></td>
        <td><span class="state ${loaded ? "ok" : ""}" title="${builtIn ? "The track shape comes with the data pack – no download needed" : ""}">${builtIn ? "built in" : loaded ? "stored" : "not loaded"}</span></td>
        <td>${own ? `<span class="state edit">own zones</span>` : `<span class="muted small">automatic</span>`}</td>
        <td class="row-actions"><button data-zone-open="${r.circuit}">Edit zones</button>
          <button data-track-retry="${r.circuit}" title="Throw away the stored track shape and load it again from OpenF1">Reload</button></td>
      </tr>`;
  }).join("");
  return `
    <div class="season-grid wide-right">
      <div class="setup-card">
        <div class="card-head"><h2>Circuits</h2></div>
        <p class="muted small">The track shapes of the data packs are built in ("built in"). Other circuits are built from the OpenF1 data of their latest race (track shape and speed profile): loaded once (a few seconds – the API allows about 30 requests per minute), then stored in this browser. "Reload" loads a shape again from OpenF1 and uses it instead.</p>
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
  const keys = circuitKeys.filter(k => !cachedTracks.has(k) && !hasBundledLayout(k));
  let done = 0;
  const failed = [];
  for (const key of keys) {
    const status = text => { const el = $("trackStatus"); if (el) el.textContent = "(" + (done + 1) + " / " + keys.length + ") " + text; };
    try {
      await loadSeasonTrackData(key, status);
      cachedTracks.add(key);
    } catch (error) {
      console.error(error);
      failed.push(circuitInfo(key).name + " (" + error.message + ")");
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
// The imported data packs are registered at the start (async): wait for them before a season opens
let packsReady = Promise.resolve();

function openSeason(id) {
  packsReady.then(() => openSeasonNow(id));
}

function openSeasonNow(id) {
  if (!loadSeason(id)) {
    showToast("This season could not be loaded.");
    return;
  }
  const missing = missingPacks(season);
  if (missing.length) {
    showToast("This season needs the data pack(s) " + missing.map(x => "\"" + x + "\"").join(", ") + " – import them first (Data packs).");
    season = null;
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
  // the standings are needed by many cards: computed once per drawing
  standingsMemoOn = true;
  standingsMemo = null;
  try {
    renderHubNow();
  } finally {
    standingsMemoOn = false;
    standingsMemo = null;
  }
}

function renderHubNow() {
  const s = season;
  ensureRatings(s);
  $("seasonTitle").textContent = s.name;
  $("seasonSub").textContent = s.year + " · " + REGS_INFO[s.generation].name + " · " + s.calendar.length + " rounds · " +
    s.teams.length + " teams · run by the FIA (you)";
  $("seasonSteps").hidden = false;
  const pending = pendingDeskItems(s).length;
  const tabs = { calendar: "Calendar", standings: "Standings", desk: "FIA desk" + (pending ? " (" + pending + ")" : ""), review: "Season review", cars: "Teams & cars", entry: "Entry list", rules: "Rulebook", zones: "Circuits & zones" };
  // Drawing the hub never changes the season. The teams arrive (new parts, power units,
  // stand-ins, nominations without an FIA objection are approved) when the first
  // session of the weekend starts: prepareWeekend() in buildSeasonSetup().
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
  if (seasonSaveFailed) {
    body.insertAdjacentHTML("afterbegin", `<div class="save-warning"><span>⚠ The last change could not be saved – the browser storage is full or blocked. Export the season file so nothing is lost.</span><button data-hub="export">Export season file</button></div>`);
  }
  $("seasonFoot").innerHTML = `
    <button data-hub="export">Export season file</button>
    <span class="small ${seasonSaveFailed ? "mark-bad" : "muted"}">${seasonSaveFailed ? "⚠ Not saved – the browser storage is full or blocked" : "✓ Saved in this browser · " + new Date(s.updated).toLocaleString()}</span>
    <span class="btn-row"><button data-hub="save">Save</button><button data-hub="close">Save &amp; close</button></span>`;
  if (hubTab === "zones" && zoneEditor) drawZoneEditor();
  if (hubTab === "desk") drawHearingTraces();
}

function shortDate(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

// ---------- Team badges and driver pictures (colour in the hub) ----------
const TEAM_SHORT = { redbull: "RBR", ferrari: "FER", mercedes: "MER", mclaren: "MCL", astonmartin: "AMR", alpine: "ALP",
  williams: "WIL", haas: "HAA", sauber: "SAU", alfaromeo: "ALF", alphatauri: "AT", racingbulls: "RB", racingpoint: "RP", renault: "REN", tororosso: "STR" };

function teamShort(t) {
  if (!t) return "–";
  if (TEAM_SHORT[t.id]) return TEAM_SHORT[t.id];
  const words = String(t.name).replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(w => w.length > 1 && !/^(F1|Team|Racing|Scuderia|BWT|Formula)$/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0] + (words[2] ? words[2][0] : words[1][1] || "")).toUpperCase();
  return (words[0] || t.name).slice(0, 3).toUpperCase();
}

// dark text on light team colours (e.g. Haas white, McLaren papaya)
function badgeTextColour(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0b0d12" : "#ffffff";
}

function teamBadge(t) {
  if (!t) return "";
  return `<span class="team-badge" style="--team:${t.colour};color:${badgeTextColour(t.colour)}" title="${escapeHtml(t.name)}">${escapeHtml(teamShort(t))}</span>`;
}

// the driver's photo (2023+ data) or the initials in a circle in team colour
function driverAvatar(d, t) {
  const colour = t ? t.colour : "#5f6880";
  const initials = d ? (String(d.first || "")[0] || "") + (String(d.last || "")[0] || "") : "?";
  return `<span class="avatar" style="--team:${colour};color:${badgeTextColour(colour)}"><span>${escapeHtml(initials.toUpperCase())}</span>` +
    (d && d.headshot ? `<img src="${escapeHtml(d.headshot)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "") + `</span>`;
}

function driverCell(id, withTeam) {
  const d = season.drivers[id];
  const t = seasonTeam(d ? d.team : teamOfDriver(season, id));
  return driverAvatar(d, t) + `<span class="num">${d ? d.number : ""}</span><b>${escapeHtml(d ? d.first + " " + d.last : id)}</b>` +
    (withTeam && t ? " " + teamBadge(t) : "");
}

// a thin bar under the points: share of the leader, in team colour
function pointsBar(points, best, colour) {
  const share = best > 0 ? clamp(points / best, 0, 1) : 0;
  return `<span class="pts-bar" style="width:${Math.round(share * 100)}%;background:${colour}"></span>`;
}

function hubCalendar() {
  const s = season;
  const next = nextSession(s);
  const rows = s.calendar.map(r => {
    const c = roundInfo(r);
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
        <td class="small">${winner ? driverAvatar(s.drivers[winner.id], seasonTeam(winner.team)) + escapeHtml(seasonDriverName(winner.id)) : ""}</td>
        <td>${state}</td>
      </tr>`;
  }).join("");
  const shown = hubRound !== null ? s.calendar.find(r => r.round === hubRound) : null;
  // the running / next weekend keeps its card; another weekend shows its results or its information
  const side = !shown || (next && next.round === shown) ? nextSessionCard(next)
    : Object.keys(shown.sessions).length ? hubRoundResults(shown) : roundInfoCard(shown);
  return `
    <div class="season-grid wide-right">
      <div class="setup-card">
        <div class="card-head"><h2>Calendar</h2><span class="muted">${s.calendar.filter(r => r.status === "DONE").length} / ${s.calendar.length} rounds</span></div>
        <table class="season-table"><tbody>${rows}</tbody></table>
      </div>
      ${side}
    </div>`;
}

// A weekend that has not started yet (clicked in the calendar): circuit, schedule, character
function roundInfoCard(round) {
  const s = season;
  const c = roundInfo(round);
  const ch = c.character || {};
  const schedule = roundSchedule(s, round);
  const sessions = weekendSessions(round).map(type =>
    `<tr><td><b>${SESSION_NAMES[type]}</b></td><td class="small mono">${schedule[type] !== undefined ? (["Fri", "Sat", "Sun"][Math.floor(schedule[type] / 86400)] || "") + " " + formatDayTime(schedule[type]).slice(0, 5) : "–"}</td></tr>`).join("");
  const level = v => v === undefined ? "–" : v < 0.34 ? "low" : v < 0.67 ? "medium" : "high";
  const status = round.status === "CANCELLED" ? `<p class="mark-bad">This event was cancelled.</p>` : "";
  return `
    <div class="setup-card">
      <div class="card-head"><h2>Round ${round.round} · ${escapeHtml(c.gp)}</h2><span class="muted">${shortDate(round.date)}</span></div>
      <p class="muted small">${escapeHtml(c.name)} · ${c.laps} laps · ${round.sprint ? "sprint weekend" : "normal weekend"}</p>
      ${status}
      <h3>Schedule</h3>
      <table class="season-table"><tbody>${sessions}</tbody></table>
      <h3>Circuit</h3>
      <table class="season-table"><tbody>
        <tr><td>Overtaking</td><td>${level(ch.overtaking)}</td></tr>
        <tr><td>Tyre stress</td><td>${level(ch.tyres)}</td></tr>
        <tr><td>Street circuit</td><td>${ch.street ? "yes" : "no"}</td></tr>
      </tbody></table>
      <div class="btn-row"><button data-hub-round="">← Back to the current weekend</button></div>
    </div>`;
}

// The event notes of a weekend: published before FP1 (season-weekend.js publishWeekendNotes)
function weekendNotesStrip(round) {
  const started = Object.keys(round.sessions).length > 0;
  const n = round.eventNotes;
  const state = n ? (n.auto ? "standard notes (published automatically)" : "published") : started ? "–" : "not published yet";
  return `<div class="notes-strip ${!n && !started ? "todo" : ""}">
    <span>Event notes: <b>${state}</b>${!n && !started ? `<span class="muted small"> – publish them before ${SESSION_NAMES[weekendSessions(round)[0]]}, else the standard notes apply</span>` : ""}</span>
    <button class="notes-btn" data-weekend-notes="${round.round}">${started ? "📋 View event notes" : n ? "📋 Edit event notes" : "📋 Write event notes…"}</button>
  </div>`;
}

// The card of the next session: direct it live or auto-simulate it
function nextSessionCard(next) {
  const s = season;
  if (!next) {
    const st = computeStandings(s);
    const champ = st.drivers.find(d => !d.excluded);
    const team = st.teams.find(t => !t.excluded);
    return `
      <div class="setup-card">
        <h2>Season finished</h2>
        <p>World Champion: <b>${champ ? escapeHtml(seasonDriverName(champ.id)) : "–"}</b> (${champ ? champ.points : 0} points)</p>
        <p>Constructors' Champion: <b>${team ? escapeHtml(seasonTeam(team.id).name) : "–"}</b> (${team ? team.points : 0} points)</p>
        <div class="btn-row"><button data-hub-tab="review" class="button-primary">Season review</button><button data-hub-tab="desk">FIA desk${pendingDeskItems(s).length ? " (" + pendingDeskItems(s).length + " open)" : ""}</button></div>
      </div>`;
  }
  const round = next.round;
  const c = roundInfo(round);
  const sessions = weekendSessions(round).map(type => {
    const res = round.sessions[type];
    let text = `<span class="muted">to come</span>`;
    if (res && isPractice(type)) {
      const top = (res.rows || []).find(x => x.best);
      text = res.status !== "DONE" ? `<span class="muted">${res.skipped ? "skipped" : "cancelled by the FIA"}</span>`
        : top ? "Fastest: " + escapeHtml(top.name || seasonDriverName(top.id)) + ` <span class="mono">${formatLapTime(top.best)}</span>` : `<span class="muted">no time set</span>`;
    } else if (res && res.status === "DONE") {
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
  const practice = isPractice(next.type);
  const timed = quali || practice;
  const hearingsBlocked = pendingHearings(s).length; // hearings must be decided before the next session
  const off = hearingsBlocked ? "disabled" : "";
  // 25 % only exists for races: a timed session shows (and runs) the short version
  if (timed && opt.distance < 0.5) opt.distance = 0.5;
  const weatherPanel = weekendWeatherPanel(round);
  return `
    <div class="setup-card">
      <div class="card-head"><h2>Round ${round.round} · ${escapeHtml(c.gp)}</h2><span class="muted">${shortDate(round.date)}</span></div>
      <p class="muted small">${escapeHtml(c.name)} · ${c.laps} laps · ${round.sprint ? "sprint weekend" : "normal weekend"}</p>
      ${weekendNotesStrip(round)}
      <table class="season-table"><tbody>${sessions}</tbody></table>
      ${resultsPicker(round, hubResult && hubResult.round === round.round ? hubResult.type : "")}
      ${hubResult && hubResult.round === round.round && hubResult.type ? `<div class="res-block">${sessionResultsBlock(round, hubResult.type)}</div>` : ""}
      ${hearingsBlocked ? `<div class="track-problem"><b>⚖ ${hearingsBlocked} hearing(s) waiting on the FIA desk</b>
        <p class="small">The decisions of the Stewards must be published before the next session can start.</p>
        <div class="btn-row"><button class="button-primary" data-hub-tab="desk">Open the FIA desk</button></div></div>` : ""}
      ${round.prepared ? `<p class="muted small">📦 New parts, power units and pit lane starts of this weekend: report of the Technical Delegate on the <button class="link-btn" data-hub-tab="desk">FIA desk</button>.</p>` : arrivalNote(s)}
      ${weatherPanel}
      ${trackProblemCard(round)}
      ${practice ? practiceInfo(next.type, s) : ""}
      <div class="form-row">
        <label>${timed ? "Session length" : "Race distance"}
          <select id="sDistance">
            <option value="1" ${opt.distance === 1 ? "selected" : ""}>${practice ? "Full (60 min)" : quali ? "Full" : "Full distance"}</option>
            <option value="0.5" ${opt.distance === 0.5 ? "selected" : ""}>${practice ? "Short (30 min)" : quali ? "Short (half the time)" : "50 %"}</option>
            ${timed ? "" : `<option value="0.25" ${opt.distance === 0.25 ? "selected" : ""}>25 %</option>`}
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
        <button class="button-primary" data-session-live="${round.round}:${next.type}" ${off}>Direct ${practice ? "" : "the "}${SESSION_NAMES[next.type]} live</button>
        ${practice ? `<button data-practice-skip="${round.round}:${next.type}" title="The session is cancelled – no setup work for the teams">Skip ${SESSION_NAMES[next.type]}</button>` : ""}
      </div>
      <div class="btn-row">
        <span class="muted small">Auto-simulate (AI Race Director &amp; Stewards):</span>
        <button data-auto="SESSION" ${off} title="${practice ? "Free practice is simulated in an instant (the options above only apply when you direct it live)" : "Run this session at full speed"}">${SESSION_NAMES[next.type]}</button>
        <button data-auto="WEEKEND" ${off} title="Run the remaining sessions of this weekend">Rest of the weekend</button>
        <button data-auto="SEASON" ${off} title="Run every remaining session of the season">Rest of the season</button>
      </div>
      <div class="progress" id="autoProgress" hidden><div></div></div>
      <div class="btn-row"><button id="autoStop" data-auto-stop="1" hidden>Stop after this session</button></div>
      <p id="sessionStatus" class="muted small">${quali || practice ? "" : "Full points are awarded even with a shorter race distance – it only sets how long you direct the race."}</p>
    </div>`;
}

// ---------- Weekend arrivals: new parts, power units, pit lane starts ----------
const AREA_SHORT = { aero: "Aero", power: "Power unit", chassis: "Chassis", tyres: "Tyre wear", reliability: "Reliability" };
const UPGRADE_EFFECT = {
  WORKS: ["works", "The car is faster in this area."],
  NOGAIN: ["no gain", "The parts do not work as expected – no improvement."],
  OFF: ["taken off again", "The parts made the car worse – the team went back to the old ones."]
};

function weekendArrivalsCard(round) {
  // older saves: only the text lines
  if (!round.arrivals) {
    return round.notes && round.notes.length ? `<h3>News from the paddock</h3><ul class="season-log">${round.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : "";
  }
  const s = season;
  const byTeam = new Map();
  const other = [];
  for (const a of round.arrivals) {
    if (a.kind === "NOTE" || !a.team) other.push(a);
    else {
      if (!byTeam.has(a.team)) byTeam.set(a.team, []);
      byTeam.get(a.team).push(a);
    }
  }
  const blocks = s.teams.filter(t => byTeam.has(t.id)).map(t => {
    const rows = byTeam.get(t.id).map(a => {
      if (a.kind === "UPGRADE") {
        const [word, tip] = UPGRADE_EFFECT[a.effect] || ["", ""];
        return `<div class="arrival-row"><span class="chip">${escapeHtml(AREA_SHORT[a.area] || a.area)}</span><b>${escapeHtml(a.name)}</b><span class="effect ${a.effect.toLowerCase()}" title="${escapeHtml(tip)}">${word}</span></div>`;
      }
      if (a.kind === "PU") {
        const parts = a.parts.map(p => `<span class="pu-part ${p.count > p.allowed ? "over" : ""}" title="${escapeHtml(PU_ELEMENT_NAMES[p.k] || p.k)}: element ${p.count} of ${p.allowed} allowed this season">${escapeHtml(PU_SHORT_NAMES[p.k] || p.k)} ${p.count} of ${p.allowed}</span>`).join("");
        const penalty = a.back ? `<span class="penalty-badge">back of the grid</span>` : a.places ? `<span class="penalty-badge">${a.places}-place grid penalty</span>` : `<span class="effect works">no penalty</span>`;
        return `<div class="arrival-row">${driverAvatar(s.drivers[a.driver], t)}<b>${escapeHtml(seasonDriverName(a.driver))}</b><span class="muted">new</span>${parts}${penalty}</div>`;
      }
      if (a.kind === "PARC") {
        return `<div class="arrival-row">${driverAvatar(s.drivers[a.driver], t)}<b>${escapeHtml(seasonDriverName(a.driver))}</b><span class="muted">${escapeHtml(a.text)}</span><span class="penalty-badge">${escapeHtml(SESSION_NAMES[a.session] || "Race")}: pit lane start</span></div>`;
      }
      return "";
    }).join("");
    return `<div class="arrival-team" style="--team:${t.colour}"><div class="arrival-head">${teamBadge(t)}<b>${escapeHtml(t.name)}</b></div>${rows}</div>`;
  }).join("");
  if (!blocks && !other.length) return `<p class="muted small">No new parts or power units this weekend.</p>`;
  return `
      <h3>Weekend arrivals</h3>
      <p class="muted small">What the teams brought to this weekend: new parts (and whether they work), power unit elements used (with grid penalties above the allowance), pit lane starts.</p>
      <div class="arrivals">${blocks}</div>
      ${other.length ? `<ul class="season-log">${other.map(a => `<li>${escapeHtml(a.text)}</li>`).join("")}</ul>` : ""}`;
}

// Free practice: what it is good for (directed live, auto-simulated in an instant, or skipped)
function practiceInfo(type, s) {
  const rookieTeams = type === "FP1" ? s.teams.filter(t => rookieCount(s, t.id) < ROOKIE_FP1_PER_SEASON).length : 0;
  return `
      <p class="muted small">The teams do short runs and long runs on high fuel. The laps a driver runs give setup confidence for qualifying and the race (up to ±0.3 % pace) – skipping the session costs the teams that work.${type === "FP1" && rookieTeams ? ` ${rookieTeams} team(s) still have to run a rookie in FP1 this season.` : ""}</p>`;
}

// Before the weekend: the teams are not at the circuit yet
function arrivalNote(s) {
  const nominations = pendingDeskItems(s).filter(x => x.type === "NOMINATION").length;
  return `<p class="muted small">The teams arrive when the first session starts: new parts, power units and stand-ins are announced then.` +
    (nominations ? ` <b class="mark-warn">${nominations} driver nomination(s) on the FIA desk</b> – without an objection they are approved when the weekend starts. <button data-hub-tab="desk">Open the FIA desk</button>` : "") + `</p>`;
}

// Auto-simulate one session, the rest of the weekend or the rest of the season
let autoRunning = false;
let liveStarting = false;  // a live session is being prepared (track loading)
function hubBusy() {
  return autoRunning || liveStarting;
}
async function runAutoSimulation(scope) {
  if (autoRunning) return;
  if (scope === "SEASON") {
    const left = season.calendar.filter(r => r.status !== "DONE" && r.status !== "CANCELLED").length;
    if (!await askConfirm("All remaining sessions of " + left + " round(s) are simulated. You will not direct any of them.", { title: "Auto-simulate the rest of the season?", ok: "Simulate" })) return;
  }
  autoRunning = true;
  document.querySelectorAll("#seasonScreen button").forEach(b => { b.disabled = true; });
  const bar = $("autoProgress");
  if (bar) bar.hidden = false;
  const stop = $("autoStop");
  if (stop && scope !== "SESSION") {
    stop.hidden = false;
    stop.disabled = false;
  }
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
    if (error.trackProblem !== undefined) trackProblem = { circuit: error.trackProblem, message: error.message };
    showToast("Auto-simulation stopped: " + error.message);
  }
  autoRunning = false;
  // the header button is not part of the hub that is drawn again
  document.querySelectorAll("#seasonScreen .season-head button").forEach(b => { b.disabled = false; });
  hubRound = null;
  renderHub();
}

// Back to the Race Control home page: save first. Only when saving fails
// (storage full or blocked) the user is reminded to export the season file.
async function leaveSeasonHub() {
  if (autoRunning) {
    showToast("The auto-simulation is still running – wait for it or press \"Stop after this session\".");
    return;
  }
  if (!season) return;
  if (!saveSeason(season)) {
    const exportFirst = await askConfirm("The season could not be saved – the browser storage is full or blocked. Progress since the last save is lost when you leave. Export the season file first?",
      { title: "Season not saved", ok: "Export and leave", cancel: "Stay" });
    if (!exportFirst) return;
    exportSeason(season);
  }
  season = null;
  hubRound = null;
  showSeasonScreen(false);
  renderSeasonList();
}

// A circuit that could not be loaded: the season must not get stuck.
// The FIA can try again, postpone or cancel the event.
let trackProblem = null; // { circuit, message }

function trackProblemCard(round) {
  if (!trackProblem || String(trackProblem.circuit) !== String(round.circuit)) return "";
  const later = freeWeekends(season, round)[0];
  return `
    <div class="track-problem">
      <b>The circuit could not be loaded.</b>
      <p class="small">${escapeHtml(trackProblem.message)}</p>
      <div class="btn-row">
        <button class="button-primary" data-track-retry="${escapeHtml(String(round.circuit))}">Try again (reload from OpenF1)</button>
        ${later ? `<button data-fia="postpone:${later}">Postpone to ${shortDate(later)}</button>` : ""}
        <button class="danger-btn" data-fia="cancelEvent">Cancel the event</button>
      </div>
    </div>`;
}

async function retryTrack(circuitKey, button) {
  const status = text => { const el = $("sessionStatus") || $("trackStatus"); if (el) el.textContent = text; };
  if (button) button.disabled = true;
  if (zoneEditor && zoneEditor.circuit === circuitKey) zoneEditor = null; // its track is rebuilt
  try {
    await loadSeasonTrack(circuitKey, null, status, true);
    trackProblem = null;
    cachedTracks.add(circuitKey);
    showToast(circuitInfo(circuitKey).name + " loaded.");
  } catch (error) {
    console.error(error);
    trackProblem = { circuit: circuitKey, message: error.message };
    cachedTracks.delete(circuitKey);
    showToast(circuitInfo(circuitKey).name + ": " + error.message);
  }
  renderWizardKeepScroll();
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
const DESK_ICONS = { ARRIVALS: "📦", PROTEST: "⚖", TECHNICAL: "🔧", NOMINATION: "🪪", AUDIT: "💰", AUDIT_OK: "💰", BAN: "⛔", EXCLUSION: "🚫", ROOKIE: "🧑‍🎓", REVIEW: "📹", HEARING: "⚖" };

// the penalty choice for one driver (hearings, amended decisions)
function penaltySelectHtml(key, session, current) {
  // + the bans that only the FIA desk can give (qualifying ban, race ban 1–3 Grands Prix)
  const codes = (session === "RACE" || session === "SPRINT" ? PENALTY_CODES : QUALI_PENALTY_CODES).concat(DESK_PENALTY_CODES);
  const cur = current || { code: "NFA", points: 0 };
  return `<select data-pen-for="${key}">${codes.map(c => `<option value="${c}" ${c === cur.code ? "selected" : ""}>${PENALTIES[c].label}</option>`).join("")}</select>
    <select data-pts-for="${key}">${[0, 1, 2, 3].map(p => `<option value="${p}" ${p === (cur.points || 0) ? "selected" : ""}>${p} point${p === 1 ? "" : "s"}</option>`).join("")}</select>`;
}

// read the penalty choices of a form: { driverId: { code, points } }
function readPenaltyForm(container, prefix, cars) {
  const per = {};
  for (const c of cars) {
    const pen = container.querySelector(`[data-pen-for="${prefix}:${c.id}"]`);
    const pts = container.querySelector(`[data-pts-for="${prefix}:${c.id}"]`);
    per[c.id] = { code: pen ? pen.value : "NFA", points: pts ? Number(pts.value) : 0 };
  }
  return per;
}

// A hearing: the evidence of the incident and the decision form (FIA desk)
function hearingHtml(item) {
  const rec = item.data.record;
  if (item.status !== "PENDING") {
    return `
    <div class="desk-item done">
      <div class="card-head"><b>⚖ ${escapeHtml(item.title)}</b><span class="muted small">Round ${item.round}</span></div>
      <p class="small">Decision: <b>${escapeHtml(item.decision || "")}</b>${item.docId && docById(season, item.docId) ? ` · <button class="small-btn" data-doc-view="${item.docId}">Document ${docById(season, item.docId).no}</button>` : ""}</p>
    </div>`;
  }
  const evidence = (rec.evidence || []).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("");
  const statements = (rec.statements || []).map(([who, text]) => `<p class="statement"><b>${escapeHtml(who)}:</b> “${escapeHtml(text)}”</p>`).join("");
  const s = season;
  const prec = seasonPrecedentPenalty(s, rec.offence, item.data.session);
  const form = rec.cars.map(c => `<div class="decision-row"><b>${c.number} ${escapeHtml(c.code)}</b> <span class="muted small">${escapeHtml(c.team)}</span>${penaltySelectHtml("h" + item.id + ":" + c.id, item.data.session)}
    ${prec ? `<button class="small-btn" data-hearing-prec="${item.id}:${c.id}" title="Use the latest precedent (${escapeHtml(prec.where)}): ${escapeHtml(PENALTIES[prec.code].label)}${prec.points ? " + " + prec.points + " pt" : ""}">Apply precedent</button>` : ""}</div>`).join("");
  const precedents = seasonPrecedents(s, rec.offence);
  const precHtml = precedents.length
    ? `<table class="evidence precedents">${precedents.map(p => `<tr><td>Round ${p.round} · ${escapeHtml(SESSION_NAMES[p.session] || p.session)}</td><td><b>${escapeHtml(PENALTIES[p.code] ? PENALTIES[p.code].label : p.code)}</b>${p.points ? " + " + p.points + " pt" : ""} · ${escapeHtml(p.cars)}</td></tr>`).join("")}</table>`
    : `<p class="muted small">No earlier decision about this offence in this championship.</p>`;
  const co = (rec.coStewards || []).map(o => `<p class="statement"><b>${escapeHtml(o.role)}:</b> “${escapeHtml(o.text)}”</p>`).join("");
  return `
    <div class="desk-item pending hearing" data-hearing-box="${item.id}">
      <div class="card-head"><b>⚖ ${escapeHtml(item.title)}</b><span class="muted small">Round ${item.round} · ${escapeHtml(SESSION_NAMES[item.data.session] || item.data.session)}</span></div>
      <div class="hearing-body">
        <div>
          <h4>Report</h4>
          <p class="small">${escapeHtml(rec.summary)} <span class="muted">(${[rec.lapText, rec.time, rec.location].filter(Boolean).map(escapeHtml).join(" · ")})</span></p>
          <p class="small"><b>Hearing:</b> ${rec.cars.map(c => escapeHtml(c.name) + " (" + escapeHtml(c.team) + ")").join(" and ")} and the team representatives were summoned to the stewards' room.</p>
          ${rec.trace ? `<h4>Telemetry – speed</h4><canvas class="trace-canvas" data-trace-item="${item.id}"></canvas>
            <p class="muted small">Thick = braking · dashed = the moment of the incident.</p>` : ""}
          ${evidence ? `<h4>Evidence</h4><table class="evidence">${evidence}</table>` : ""}
        </div>
        <div>
          ${statements ? "<h4>Driver statements</h4>" + statements : ""}
          <h4>Driver history</h4>
          ${seasonDriverHistoryHtml(s, rec.cars)}
        </div>
        <div>
          <h4>Precedents</h4>
          ${precHtml}
          ${co ? "<h4>Co-stewards</h4>" + co + `<p class="muted small">Advice only – the decision is yours.</p>` : ""}
          <h4>Decision</h4>
          ${form}
          <div class="btn-row"><button class="button-primary" data-hearing="${item.id}">Publish the decision</button></div>
          <p class="muted small">The decision must be published before the next session starts.</p>
        </div>
      </div>
    </div>`;
}

// the speed traces of the hearings (canvas, after the hub is drawn)
function drawHearingTraces() {
  for (const canvas of document.querySelectorAll("canvas[data-trace-item]")) {
    const item = season.inbox.find(x => x.id === Number(canvas.dataset.traceItem));
    const tr = item && item.data.record.trace;
    if (tr) drawTraceData(canvas, tr, null, tr.start, tr.end);
  }
}

// The Technical Delegate's information about a weekend: the full arrivals view (open for the
// running weekend, folded for older ones)
function arrivalsDeskHtml(item) {
  const round = season.calendar.find(r => r.round === item.data.roundNumber);
  if (!round) return "";
  const next = nextSession(season);
  const current = next && next.round === round;
  return `
    <details class="desk-item info arrivals-item" ${current ? "open" : ""}>
      <summary class="card-head"><b>${DESK_ICONS.ARRIVALS} ${escapeHtml(item.title)}</b><span class="muted small">Round ${item.round} · information</span></summary>
      ${weekendArrivalsCard(round)}
    </details>`;
}

function deskItemHtml(item) {
  if (item.type === "HEARING") return hearingHtml(item);
  if (item.type === "ARRIVALS") return arrivalsDeskHtml(item);
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

// The FIA desk has two tabs: the desk (decisions) and the published documents
let deskTab = "desk";
let docOpen = null;   // number of the document shown
let docEdit = null;   // number of the document being changed

function hubDesk() {
  const s = season;
  const docs = (s.documents || []).length;
  const tabs = `<div class="desk-tabs seg"><button data-desk-tab="desk" class="${deskTab === "desk" ? "active" : ""}">Desk</button><button data-desk-tab="documents" class="${deskTab === "documents" ? "active" : ""}">Documents${docs ? " (" + docs + ")" : ""}</button></div>`;
  return tabs + (deskTab === "documents" ? hubDocuments() : hubDeskItems());
}

// The form "Open an investigation" (after a session): session, drivers, offence
let invSessionKey = null;
function investigationForm(s) {
  const sessions = investigableSessions(s);
  if (!sessions.length) return `<p class="muted small">No session that can still be investigated (the running weekend and the last finished one).</p>`;
  const chosen = sessions.find(x => x.key === invSessionKey) || sessions[0];
  invSessionKey = chosen.key;
  const drivers = sessionDrivers(s, chosen.round, chosen.type);
  const driverOptions = drivers.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(seasonDriverName(id))}</option>`).join("");
  return `
    <div class="inv-form">
      <label>Session
        <select id="invSession">${sessions.map(x => `<option value="${x.key}" ${x === chosen ? "selected" : ""}>Round ${x.round.round} · ${escapeHtml(roundInfo(x.round).gp)} · ${escapeHtml(SESSION_NAMES[x.type])}</option>`).join("")}</select>
      </label>
      <label>Driver<select id="invDriver1">${driverOptions}</select></label>
      <label>Second driver (optional)<select id="invDriver2"><option value="">– none –</option>${driverOptions}</select></label>
      <label>Offence<select id="invOffence">${AFTER_SESSION_OFFENCES.map(o => `<option>${escapeHtml(o)}</option>`).join("")}</select></label>
      <label id="invTechBox" hidden>Kind of infringement<select id="invTechKind">${TECHNICAL_KINDS.map(k => `<option>${escapeHtml(k)}</option>`).join("")}</select></label>
      <div class="btn-row"><button data-inv-open="1">Open the investigation</button></div>
      <p class="muted small">It becomes a hearing below: you decide the penalty – up to a disqualification, a qualifying ban or a race ban of 1–3 Grands Prix. The decision is published as a document.</p>
    </div>`;
}

function hubDeskItems() {
  const s = season;
  const items = (s.inbox || []).filter(x => x.title); // old saves: plain notes without a title are shown in the log
  // hearings get the full width: the review has three columns (facts | history | decision)
  const hearings = items.filter(x => x.status === "PENDING" && x.type === "HEARING");
  const pending = items.filter(x => x.status === "PENDING" && x.type !== "HEARING");
  const rest = items.filter(x => x.status !== "PENDING").reverse();
  return weekendNotesDeskCard(s) + (hearings.length ? `
    <div class="setup-card hearings-card">
      <div class="card-head"><h2>Hearings – decide before the next session</h2><span class="muted">${hearings.length}</span></div>
      ${hearings.map(deskItemHtml).join("")}
    </div>` : "") + `
    <div class="season-grid two">
      <div class="setup-card">
        <div class="card-head"><h2>Waiting for a decision</h2><span class="muted">${pending.length}</span></div>
        <p class="muted small">Protests, reports of the technical delegate, driver changes and the cost cap audit. A driver change that is not decided before the next weekend is approved automatically.</p>
        ${pending.map(deskItemHtml).join("") || `<p class="muted">Nothing to decide at the moment.</p>`}
        <h3>Open an investigation</h3>
        ${investigationForm(s)}
        <h3>Exclusion from the championship</h3>
        <p class="muted small">The FIA can exclude a driver or a team from the championship (the race results stand) and ban them from the remaining events.</p>
        <div class="btn-row"><button data-hub-tab="standings">Exclude a driver or team… (Standings)</button><button data-hub-tab="entry">… or from the entry list</button></div>
      </div>
      <div class="setup-card">
        <div class="card-head"><h2>Decided &amp; information</h2></div>
        ${rest.slice(0, 30).map(deskItemHtml).join("") || `<p class="muted">Nothing yet.</p>`}
      </div>
    </div>`;
}

// ---------- FIA desk: the published documents ----------
const DOC_KIND = { DECISION: "Decision", HEARING: "Decision after the hearing", AMENDED: "Amended decision", REVIEW: "Right of review" };

// The documents of one weekend (dropdown) – like the official document list of an event
let docRound = null;  // round key ("3" or "S") shown in the Documents tab

function hubDocuments() {
  const s = season;
  const all = s.documents || [];
  // the weekends with documents (calendar order) + "Season"
  const keys = s.calendar.filter(r => all.some(d => docRoundKey(d.round) === String(r.round))).map(r => String(r.round));
  if (all.some(d => docRoundKey(d.round) === "S")) keys.push("S");
  const open = docOpen !== null ? docById(s, docOpen) : null;
  if (open) docRound = docRoundKey(open.round);
  if (!keys.includes(docRound)) {
    // the running or the last weekend with documents
    const next = nextSession(s);
    const current = next && keys.includes(String(next.round.round)) ? String(next.round.round) : null;
    docRound = current || keys.filter(k => k !== "S").slice(-1)[0] || keys[0] || null;
  }
  const label = key => {
    const n = all.filter(d => docRoundKey(d.round) === key).length;
    if (key === "S") return "Season – " + n + " document" + (n === 1 ? "" : "s");
    const r = s.calendar.find(x => String(x.round) === key);
    return "Round " + key + " · " + (r ? roundInfo(r).gp : "") + " – " + n + " document" + (n === 1 ? "" : "s");
  };
  const docs = all.filter(d => docRoundKey(d.round) === docRound).sort((a, b) => b.no - a.no);
  const list = docs.map(d => {
    const replacement = d.amendedBy ? docById(s, d.amendedBy) : null;
    const per = d.kind === "NOTICE" ? escapeHtml(d.from || "The FIA")
      : escapeHtml(d.record.cars.map(c => c.code + (d.per[c.id] && d.per[c.id].code !== "NFA" ? " " + PENALTIES[d.per[c.id].code].short : "")).join(", "));
    return `<tr class="clickable ${open === d ? "chosen" : ""} ${d.amendedBy ? "replaced" : ""}" data-doc-view="${d.id}">
      <td class="pos">${d.no}</td>
      <td><b>${escapeHtml(docTitle(d))}</b><br><span class="muted small">${d.session ? escapeHtml(SESSION_NAMES[d.session] || d.session) + " · " : ""}${per}${replacement ? ` · replaced by Doc ${replacement.no}` : ""}</span></td>
    </tr>`;
  }).join("");
  let viewer = `<p class="muted">Choose a document on the left.</p>`;
  if (open) {
    const editing = docEdit === open.id && !open.amendedBy;
    const changeable = !open.amendedBy && open.kind !== "REVIEW" && open.kind !== "NOTICE";
    const replacement = open.amendedBy ? docById(s, open.amendedBy) : null;
    const replaced = open.amends ? docById(s, open.amends) : null;
    const form = editing ? `
      <div class="setup-card amend-form" data-amend-box="${open.id}">
        <h3>Change the decision</h3>
        <p class="muted small">After a complaint of a team or your own new look at the incident: the results are corrected and an amended decision replaces Document ${open.no}.</p>
        ${open.record.cars.map(c => `<div class="decision-row"><b>${c.number} ${escapeHtml(c.code)}</b> <span class="muted small">${escapeHtml(c.team)}</span>${penaltySelectHtml("a" + open.id + ":" + c.id, open.session, open.per[c.id])}</div>`).join("")}
        <div class="btn-row"><button class="button-primary" data-doc-amend="${open.id}">Publish the amended decision</button><button data-doc-edit="">Cancel</button></div>
      </div>` : "";
    viewer = `
      ${seasonDocumentHtml(s, open)}
      <div class="btn-row">
        <button data-doc-print="${open.id}">Print</button>
        ${changeable && !editing ? `<button data-doc-edit="${open.id}">Change the decision…</button>` : ""}
        ${replacement ? `<button data-doc-view="${replacement.id}">Show Document ${replacement.no} (replaces it)</button>` : ""}
        ${replaced ? `<button data-doc-view="${replaced.id}">Show Document ${replaced.no} (replaced)</button>` : ""}
      </div>
      ${form}`;
  }
  return `
    <div class="season-grid wide-right">
      <div class="setup-card">
        <div class="card-head"><h2>Documents</h2><span class="muted">${all.length} in the season</span></div>
        ${keys.length ? `<label class="doc-round">Weekend
          <select data-doc-round="1">${keys.map(k => `<option value="${k}" ${k === docRound ? "selected" : ""}>${escapeHtml(label(k))}</option>`).join("")}</select></label>` : ""}
        <p class="muted small">Every decision and notice of the FIA, the Stewards and the Technical Delegate – numbered per weekend.</p>
        ${docs.length ? `<table class="season-table docs-table"><tbody>${list}</tbody></table>` : `<p class="muted">No document yet.</p>`}
      </div>
      <div class="setup-card">${viewer}</div>
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
          ${stat("Exclusions from the championship", v.exclusions)}
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

// The junior driver of a team (FP1 rookie runs) – the name can be changed
function juniorLine(s, t) {
  const j = seasonJunior(s, t);
  const runs = rookieCount(s, t.id);
  return `
        <div class="junior-line small">
          <span class="muted">Junior driver</span>
          <input type="text" data-junior-first="${t.id}" value="${escapeHtml(j.first)}" aria-label="First name of the junior driver of ${escapeHtml(t.name)}" maxlength="20">
          <input type="text" data-junior-last="${t.id}" value="${escapeHtml(j.last)}" aria-label="Last name of the junior driver of ${escapeHtml(t.name)}" maxlength="24">
          <span class="mono">${escapeHtml(j.code)}</span>
          <span class="${runs >= ROOKIE_FP1_PER_SEASON ? "mark-good" : "muted"}" title="FP1 sessions with a rookie this season">${runs}/${ROOKIE_FP1_PER_SEASON} FP1</span>
        </div>`;
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
        return `<span class="${over ? "mark-bad" : el.count === s.rules.pu[k] ? "mark-warn" : ""}" title="${PU_ELEMENT_NAMES[k]}: element ${el.count} of ${s.rules.pu[k]} allowed, ${el.age} / ${el.life} weekends">${PU_SHORT_NAMES[k] || k} ${el.count} of ${s.rules.pu[k]}</span>`;
      }).join(" ");
      return `<div class="small"><b>${escapeHtml(d.last)}</b> ${parts}</div>`;
    }).join("");
    return `
      <div class="team-card" style="--team:${t.colour}">
        <div class="team-card-head">${teamBadge(t)}<b>${escapeHtml(t.name)}</b><span class="muted small">${escapeHtml(car.supplier)}</span></div>
        <table class="rating-table">
          ${Object.keys(CAR_AREAS).map(k => `<tr><td class="muted small">${CAR_AREAS[k]}</td><td>${ratingBar(car[k])}</td></tr>`).join("")}
        </table>
        <div class="small">Spent <b>${f.spent.toFixed(1)}</b> of ${cap.toFixed(1)} M USD cap
          <span class="rating"><span style="width:${clamp(spentShare * 100, 0, 100)}%;background:${spentShare > 1 ? "#ff3b30" : "#4fd8ff"}"></span></span></div>
        <div class="muted small">Budget ${f.budget.toFixed(0)} M · development ${f.development.toFixed(1)} M · crash damage ${f.crashes.toFixed(1)} M · wind tunnel ${Math.round(atrFactor(s, t.id) * 100)} %</div>
        <div class="arrival-list small">
          <div><span class="muted">Upgrades this season:</span> <b>${fitted.length}</b>${fitted.length ? ` <span class="muted">(${fitted.filter(p => p.gain > 0.05).length} worked)</span>` : ""}</div>
          ${coming.filter(p => s.calendar.some(x => x.round === p.arrives && x.status !== "DONE")).map(p => {
            const r = s.calendar.find(x => x.round === p.arrives);
            return `<div class="arrival-row"><span class="chip">${escapeHtml(AREA_SHORT[p.area] || p.area)}</span><b>${escapeHtml(p.name)}</b><span class="muted">in production – arrives at round ${r.round} · ${escapeHtml(roundInfo(r).gp)}</span></div>`;
          }).join("")}
          ${(() => {
            const late = coming.filter(p => !s.calendar.some(x => x.round === p.arrives && x.status !== "DONE")).length;
            return late ? `<div class="muted">${late} part(s) in production would only arrive after the last round</div>` : "";
          })()}
        </div>
        ${pu}
        ${juniorLine(s, t)}
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
function practiceResultsBlock(type, res) {
  if (res.status !== "DONE") return `<h3>${SESSION_NAMES[type]}</h3><p class="muted small">${res.skipped ? "Skipped – no setup work for the teams." : "Cancelled by the FIA."}</p>`;
  const name = row => row.name ? escapeHtml(row.name) + ` <span class="muted small">rookie</span>` : driverCell(row.id);
  const top = res.rows.find(x => x.best);
  let pos = 0;
  const rows = res.rows.filter(row => !row.satOut).map(row => {
    const gap = row.best && top && row !== top ? "+" + (row.best - top.best).toFixed(3) : "";
    return `<tr><td class="pos">${row.best ? ++pos : "–"}</td><td>${name(row)}</td><td class="mono">${row.best ? formatLapTime(row.best) : "no time"}</td><td class="small muted">${gap}</td><td class="small">${row.laps}${row.problem ? ` <span class="mark-bad">${escapeHtml(row.problem)}</span>` : ""}</td></tr>`;
  }).join("");
  const satOut = res.rows.filter(row => row.satOut).map(row => escapeHtml(seasonDriverName(row.id)));
  const longRuns = (res.longRuns || []).slice(0, 5).map((l, i) =>
    `<tr><td class="pos">${i + 1}</td><td>${l.name ? escapeHtml(l.name) : driverCell(l.id)}</td><td class="mono">${formatLapTime(l.time)}</td></tr>`).join("");
  const t = res.tyreData;
  return `<h3>${SESSION_NAMES[type]}</h3>
    <p class="muted small">${res.weather}${res.redFlags ? " · " + res.redFlags + " red flag" + (res.redFlags > 1 ? "s" : "") : ""} · ${res.minutes} of ${res.planned || PRACTICE_MINUTES} minutes running · ${res.live ? "your Race Director rating " + res.rdScore + " / 100" : "simulated"}</p>
    <table class="season-table"><thead><tr><th>Pos</th><th>Driver</th><th>Best</th><th>Gap</th><th>Laps</th></tr></thead><tbody>${rows}</tbody></table>
    ${satOut.length ? `<p class="muted small">Sat out for a rookie: ${satOut.join(", ")}</p>` : ""}
    ${longRuns ? `<p class="small"><b>Long runs</b> (race pace on high fuel)</p><table class="season-table"><tbody>${longRuns}</tbody></table>` : ""}
    ${t ? `<p class="small"><b>Tyre wear estimate</b> (${t.laps} long-run laps): soft ${(t.SOFT).toFixed(3)} s/lap · medium ${(t.MEDIUM).toFixed(3)} s/lap · hard ${(t.HARD).toFixed(3)} s/lap</p>` : ""}
    ${res.notes.length ? `<ul class="season-log">${res.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : ""}`;
}

// The results of a weekend: one session at a time, chosen in the dropdown
let hubResult = null; // { round, type } – the session chosen in the results dropdown

function sessionsWithResults(round) {
  return weekendSessions(round).filter(t => round.sessions[t]);
}

function resultsPicker(round, selected) {
  const done = sessionsWithResults(round);
  if (!done.length) return "";
  return `
      <label class="results-picker">Results
        <select data-results-select="${round.round}">
          ${selected ? "" : `<option value="">– choose a session –</option>`}
          ${done.map(t => `<option value="${t}" ${t === selected ? "selected" : ""}>${SESSION_NAMES[t]}</option>`).join("")}
        </select>
      </label>`;
}

function hubRoundResults(round) {
  const c = roundInfo(round);
  const done = sessionsWithResults(round);
  // the chosen session, else the Grand Prix, else the last session of the weekend
  let type = hubResult && hubResult.round === round.round && done.includes(hubResult.type) ? hubResult.type : null;
  if (!type) type = done.includes("RACE") ? "RACE" : done[done.length - 1];
  return `
    <div class="setup-card">
      <div class="card-head"><h2>Round ${round.round} · ${escapeHtml(c.gp)}</h2><button data-hub-round="">Next session →</button></div>
      <p class="muted small">${escapeHtml(c.name)} · ${shortDate(round.date)}${round.status === "CANCELLED" ? " · cancelled" : ""}</p>
      ${resultsPicker(round, type)}
      <div class="res-block">${type ? sessionResultsBlock(round, type) : ""}</div>
    </div>`;
}

function sessionResultsBlock(round, type) {
  const res = round.sessions[type];
  if (res && isPractice(type)) return practiceResultsBlock(type, res);
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
  const pitLane = new Set(((round.parcFerme || {})[type] || []).map(d => d.id));
  const rows = res.rows.map(row => `
    <tr><td class="pos">${row.pos || row.status}</td><td>${driverCell(row.id)}</td><td class="small">${escapeHtml(row.pos ? row.gap : row.reason || row.status)}</td>
    <td class="small muted">${pitLane.has(row.id) ? `<span title="Pit lane start – parc fermé broken">PL</span>` : row.grid}</td><td><b>${row.points || ""}</b>${res.fastestLap && res.fastestLap.id === row.id ? ` <span class="purple small" title="Fastest lap ${formatLapTime(res.fastestLap.time)}">FL</span>` : ""}</td></tr>`).join("");
  return `<h3>${SESSION_NAMES[type]}${res.shortened ? ` <span class="muted small">(${res.shortened} % distance – ${SHORTENED_RULES[season.rules.shortened].name})</span>` : ""}</h3>
    <p class="muted small">${res.weather} · ${res.safetyCars} SC · ${res.vsc} VSC · ${res.redFlags} red flags · ${res.overtakes} overtakes · ${res.auto ? "AI Race Director" : "your Race Director rating " + res.rdScore + " / 100"}</p>
    <table class="season-table"><thead><tr><th>Pos</th><th>Driver</th><th>Gap</th><th>Grid</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// The FIA is preparing an exclusion: { kind: "DRIVER" | "TEAM", target }
let exclusionDraft = null;

function exclusionForm() {
  const s = season;
  const x = exclusionDraft;
  if (!x) return "";
  const driver = x.kind === "DRIVER";
  const name = driver ? seasonDriverName(x.target) : seasonTeam(x.target).name;
  const from = nextAffectedRound(s);
  return `
    <div class="setup-card exclusion-form">
      <div class="card-head"><h2>🚫 Exclude ${escapeHtml(name)} from the championship</h2></div>
      <p class="small">${driver
        ? "The driver is no longer classified in the drivers' championship. His race results stand – nobody moves up in a race (like Michael Schumacher in 1997)."
        : "The team is no longer classified in the constructors' championship. Its race results stand (like McLaren in 2007, whose drivers kept their points)."}</p>
      <label>Reason (published by the FIA)
        <input type="text" id="exReason" maxlength="200" placeholder="${driver ? "e.g. deliberately causing a collision to decide the title" : "e.g. use of confidential technical information of another team"}">
      </label>
      <label class="check small"><input type="checkbox" id="exOther"> ${driver ? "His points don't count for his team in the constructors' championship either" : "Its drivers are excluded from the drivers' championship too"}</label>
      <label class="check small"><input type="checkbox" id="exBanned"> Also banned from all remaining events${from <= s.calendar.length ? " (from round " + from + ")" : ""} – ${driver ? "the team nominates a stand-in" : "the team does not start any more"}</label>
      <div class="btn-row">
        <button class="danger-btn" data-exclude-confirm="1">Exclude</button>
        <button data-exclude-cancel="1">Cancel</button>
      </div>
      <p class="muted small">Can be lifted later (appeal upheld).</p>
    </div>`;
}

function exclusionList() {
  const s = season;
  const list = (s.exclusions || []).slice().reverse();
  if (!list.length) return "";
  return `
    <h3>Exclusions</h3>
    ${list.map(x => `
      <div class="desk-item ${x.revoked ? "done" : "pending"}">
        <div class="card-head"><b>${x.kind === "DRIVER" ? "Driver" : "Team"}: ${escapeHtml(exclusionName(s, x))}</b>
          ${x.revoked ? `<span class="muted small">lifted</span>` : `<button data-revoke="${x.id}" title="The exclusion is lifted, the points count again">Lift (appeal)</button>`}</div>
        <p class="small">${x.banned ? "Excluded and banned from the remaining events" : "Excluded from the championship – results stand"}${x.alsoOther ? (x.kind === "DRIVER" ? " · points also removed from the team" : " · drivers excluded too") : ""}</p>
        <p class="small muted">Reason: ${escapeHtml(x.reason)}</p>
      </div>`).join("")}`;
}

function hubStandings() {
  const s = season;
  const st = computeStandings(s);
  const excludedBadge = `<span class="excluded-badge" title="Excluded from the championship by the FIA">EXCLUDED</span>`;
  let pos = 0;
  const bestDriver = Math.max(0, ...st.drivers.filter(d => !d.excluded).map(d => d.points));
  const bestTeam = Math.max(0, ...st.teams.filter(t => !t.excluded).map(t => t.points));
  const drivers = st.drivers.map(d => {
    const sd = s.drivers[d.id];
    const team = seasonTeam(sd ? sd.team : teamOfDriver(s, d.id));
    return `<tr class="${d.excluded ? "excluded-row" : ""}"><td class="pos">${d.excluded ? "–" : ++pos}</td><td>${driverCell(d.id, true)}${d.excluded ? " " + excludedBadge : ""}</td><td class="pts"><b>${d.points}</b>${pointsBar(d.points, bestDriver, team ? team.colour : "#5f6880")}</td><td>${d.wins}</td><td>${d.podiums}</td><td>${d.poles}</td><td>${d.fastest}</td><td>${d.dnf}</td>
      <td class="small ${sd && sd.penaltyPoints >= s.rules.penaltyPointsBan - 2 ? "mark-bad" : "muted"}">${sd ? sd.penaltyPoints + " / R" + sd.reprimands : ""}</td>
      <td class="row-actions">${d.excluded ? "" : `<button data-exclude="DRIVER:${escapeHtml(d.id)}" title="Exclude from the championship">Exclude…</button>`}</td></tr>`;
  }).join("");
  pos = 0;
  const teams = st.teams.map(t => {
    const team = seasonTeam(t.id);
    return `<tr class="${t.excluded ? "excluded-row" : ""}"><td class="pos">${t.excluded ? "–" : ++pos}</td><td>${teamBadge(team)} <b>${escapeHtml(team.name)}</b>${t.excluded ? " " + excludedBadge : ""}</td><td class="pts"><b>${t.points}</b>${pointsBar(t.points, bestTeam, team.colour)}</td><td>${t.wins}</td><td>${t.podiums}</td>
      <td class="row-actions">${t.excluded ? "" : `<button data-exclude="TEAM:${escapeHtml(t.id)}" title="Exclude from the championship">Exclude…</button>`}</td></tr>`;
  }).join("");
  const done = s.calendar.filter(r => r.status === "DONE").length;
  return `
    ${exclusionForm()}
    <div class="season-grid wide-left">
      <div class="setup-card">
        <div class="card-head"><h2>Drivers' Championship</h2><span class="muted">after ${done} of ${s.calendar.length} rounds</span></div>
        <table class="season-table"><thead><tr><th>Pos</th><th>Driver</th><th>Pts</th><th>Wins</th><th>Podiums</th><th>Poles</th><th>FL</th><th>DNF</th><th title="Penalty points on the superlicence / reprimands">Pen. pts</th><th></th></tr></thead>
        <tbody>${drivers || `<tr><td colspan="10" class="muted">No race run yet.</td></tr>`}</tbody></table>
      </div>
      <div class="setup-card">
        <div class="card-head"><h2>Constructors' Championship</h2></div>
        <table class="season-table"><thead><tr><th>Pos</th><th>Team</th><th>Pts</th><th>Wins</th><th>Podiums</th><th></th></tr></thead>
        <tbody>${teams || `<tr><td colspan="6" class="muted">No race run yet.</td></tr>`}</tbody></table>
        ${exclusionList()}
        <h3>Season log</h3>
        <ul class="season-log">${s.log.slice().reverse().slice(0, 15).map(l => `<li><span class="muted small">${l.round ? "R" + l.round : ""}</span> ${escapeHtml(l.text)}</li>`).join("")}</ul>
      </div>
    </div>`;
}

function hubEntry() {
  const s = season;
  const ex = exclusionSets(s);
  // the tyre sets of the running weekend (once the teams are at the circuit)
  const next = nextSession(s);
  const tyreRound = next && next.round.tyres ? next.round : null;
  const tyres = id => {
    if (!tyreRound) return "";
    const t = driverTyres(s, tyreRound, id);
    return `<span class="tyre-sets" title="New dry tyre sets left this weekend">${["SOFT", "MEDIUM", "HARD"].map(c => `${tyreBadge(c)}<b>${t[c]}</b>`).join("")}</span>`;
  };
  const cards = s.teams.map(t => `
    <div class="team-card" style="--team:${t.colour}">
      <div class="team-card-head">${teamBadge(t)}<b>${escapeHtml(t.name)}</b>
        ${ex.teams.has(t.id) ? `<span class="excluded-badge">EXCLUDED</span>` : `<button class="small-btn" data-exclude="TEAM:${escapeHtml(t.id)}" title="Exclude from the championship">Exclude…</button>`}</div>
      ${t.drivers.map(id => {
        const d = s.drivers[id];
        return `<div class="driver-line">${driverAvatar(d, t)}<span class="num">${d.number}</span>
          <span class="driver-info"><b>${escapeHtml(d.first + " " + d.last)}</b><span class="driver-sub">${flagSpan(d.country)}${tyres(id)}</span></span>
          ${ex.drivers.has(id) ? `<span class="excluded-badge">EXCLUDED</span>` : `<button class="small-btn" data-exclude="DRIVER:${escapeHtml(id)}" title="Exclude from the championship">Exclude…</button>`}</div>`;
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
        ${row("Free practice", "FP1–FP3 · sprint weekend: FP1 only · a rookie in FP1 " + ROOKIE_FP1_PER_SEASON + "× per team and season")}
        ${row("Tyre sets", "13 dry sets per weekend (8 soft · 3 medium · 2 hard), sprint weekend 12 (6 · 4 · 2) – a qualifying run on a used soft set is slower")}
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
  renderPackList();
  // imported data packs are in the browser storage: register them, then show them
  packsReady = loadImportedPacks().then(count => {
    if (count) {
      renderPackList();
      fillHistoricYears(); // the historic race card offers the seasons of imported packs too
    }
  });
  $("importPack").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const result = await importDataPack(await file.text());
    event.target.value = "";
    if (result.problems) {
      showToast("Pack not imported: " + result.problems.join(" "));
      return;
    }
    showToast("Data pack \"" + (result.pack.name || result.pack.id) + "\" imported.");
    renderPackList();
    fillHistoricYears();
  });
  $("packList").addEventListener("click", async event => {
    const b = event.target.closest("button[data-pack-remove]");
    if (!b) return;
    const id = b.dataset.packRemove;
    const using = seasonsUsingPack(id);
    const warn = using.length ? "\n\nThese seasons use it and can't be opened without it: " + using.map(x => x.name).join(", ") : "";
    if (!await askConfirm("Remove the data pack \"" + id + "\" from this browser?" + warn, { title: "Remove data pack", ok: "Remove", danger: true })) return;
    await removeDataPack(id);
    renderPackList();
    fillHistoricYears();
    showToast("Data pack removed.");
  });
  $("newSeason").addEventListener("click", openWizard);
  $("importSeason").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const error = importSeason(await file.text());
    event.target.value = "";
    showToast(error || "Season imported.");
    renderSeasonList();
  });
  $("seasonList").addEventListener("click", async event => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.seasonOpen) openSeason(b.dataset.seasonOpen);
    if (b.dataset.seasonExport) {
      const s = storageGet(SEASON_KEY_PREFIX + b.dataset.seasonExport);
      if (s) exportSeason(s);
    }
    if (b.dataset.seasonDelete) {
      const s = listSeasons().find(x => x.id === b.dataset.seasonDelete);
      if (s && await askConfirm("Delete the season \"" + s.name + "\"? This cannot be undone (export it first to keep a copy).", { title: "Delete season", ok: "Delete", danger: true })) {
        deleteSeason(s.id);
        renderSeasonList();
      }
    }
  });

  const screen = $("seasonScreen");
  screen.addEventListener("click", async event => {
    // zone editor (wizard step 5 or hub tab)
    if (zoneEditor && (seasonDraft ? seasonStep === 4 : hubTab === "zones") && zoneEditorClick(event)) return;
    const b = event.target.closest("button, tr[data-hub-round], tr[data-doc-view]"); // calendar and document rows can be clicked too
    if (!b) return;
    const d = seasonDraft;
    const ds = b.dataset;
    // an auto-simulation runs or a live session is loading: only "Stop" works
    // (anything else would draw the hub again or start a second session)
    if (hubBusy() && !ds.autoStop) return;

    if (ds.seasonBack) {
      if (!d && season) return leaveSeasonHub();
      if (d && !await askConfirm("The new championship is not saved yet.", { title: "Leave the setup?", ok: "Leave", danger: true })) return;
      seasonDraft = null;
      season = null;
      showSeasonScreen(false);
      renderSeasonList();
      return;
    }

    // reload a circuit (hub and wizard)
    if (ds.trackRetry !== undefined) {
      const key = circuitKeyOf(ds.trackRetry);
      retryTrack(key, b);
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
        if (!item || !option || (option.danger && !await askConfirm(item.title, { title: option.label + "?", ok: option.label, danger: true }))) return;
        decideDeskItem(season, item, key);
        renderHub();
      } else if (ds.nextSeason) {
        if (!await askConfirm("Start the next season with the same teams, drivers, cars and rulebook?", { title: "Next season", ok: "Start next season" })) return;
        const bans = activeExclusions(season).filter(x => x.banned);
        const keepBans = bans.length > 0 && await askConfirm(bans.map(x => "• " + exclusionName(season, x)).join("\n"),
          { title: "Do these bans continue in the next season?", ok: "Bans continue", cancel: "Fresh start for everyone" });
        let next;
        try {
          next = createNextSeason(season, { keepBans });
        } catch (error) {
          console.error(error);
          showToast("The next season could not be created: " + error.message);
          return;
        }
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
        const sure = action === "cancelEvent" ? await askConfirm("No points are awarded for it.", { title: "Cancel the " + roundInfo(next.round).gp + "?", ok: "Cancel the event", cancel: "Keep it", danger: true })
          : action === "cancelSession" ? await askConfirm("The " + SESSION_NAMES[value] + " will not take place.", { title: "Cancel the " + SESSION_NAMES[value] + "?", ok: "Cancel the session", cancel: "Keep it", danger: true }) : true;
        if (!sure) return;
        fiaWeekendAction(season, next.round, action, value);
        renderHub();
      } else if (ds.exclude) {
        const i = ds.exclude.indexOf(":");
        exclusionDraft = { kind: ds.exclude.slice(0, i), target: ds.exclude.slice(i + 1) };
        hubTab = "standings";
        renderHub();
        window.scrollTo(0, 0);
      } else if (ds.excludeCancel) {
        exclusionDraft = null;
        renderHub();
      } else if (ds.excludeConfirm) {
        const reason = ($("exReason") || {}).value || "";
        if (!reason.trim()) {
          showToast("Please give a reason – the FIA publishes its decision.");
          return;
        }
        const x = exclusionDraft;
        const name = x.kind === "DRIVER" ? seasonDriverName(x.target) : seasonTeam(x.target).name;
        if (!await askConfirm("Reason: " + reason.trim(), { title: "Exclude " + name + " from the championship?", ok: "Exclude", danger: true })) return;
        excludeFromChampionship(season, x.kind, x.target, { reason, alsoOther: $("exOther").checked, banned: $("exBanned").checked });
        exclusionDraft = null;
        renderHub();
        showToast(name + " has been excluded from the championship.");
      } else if (ds.revoke) {
        const x = (season.exclusions || []).find(e => e.id === Number(ds.revoke));
        if (!x || !await askConfirm("The points count again.", { title: "Lift the exclusion of " + exclusionName(season, x) + "?", ok: "Lift the exclusion" })) return;
        revokeExclusion(season, x.id);
        renderHub();
      } else if (ds.autoStop) {
        autoSimStop = true;
        b.disabled = true;
        b.textContent = "Stopping after this session…";
      } else if (ds.auto) {
        runAutoSimulation(ds.auto);
      } else if (ds.deskTab) {
        deskTab = ds.deskTab;
        renderHub();
      } else if (ds.docView !== undefined) {
        deskTab = "documents";
        hubTab = "desk";
        docOpen = Number(ds.docView);
        docEdit = null;
        renderWizardKeepScroll();
      } else if (ds.docEdit !== undefined) {
        docEdit = ds.docEdit === "" ? null : Number(ds.docEdit);
        renderWizardKeepScroll();
      } else if (ds.docPrint) {
        const doc = docById(season, Number(ds.docPrint));
        if (doc) printDocumentHtml(seasonDocumentHtml(season, doc));
      } else if (ds.docAmend) {
        const doc = docById(season, Number(ds.docAmend));
        const box = b.closest("[data-amend-box]");
        if (!doc || !box) return;
        const per = readPenaltyForm(box, "a" + doc.id, doc.record.cars);
        if (!await askConfirm("The results are corrected and the amended decision replaces Document " + doc.no + ".", { title: "Change the decision?", ok: "Publish" })) return;
        const res = amendDecision(season, doc, per);
        if (res.error) { showToast(res.error); return; }
        docEdit = null;
        docOpen = res.doc.id;
        renderHub();
        showToast("Document " + res.doc.no + " published" + (res.notes.length ? " – " + res.notes.join(" ") : "."));
      } else if (ds.invOpen) {
        const [roundNumber, type] = ($("invSession").value || "").split(":");
        const ids = [$("invDriver1").value, $("invDriver2").value].filter((x, i, a) => x && a.indexOf(x) === i);
        if (!ids.length) return;
        openAfterSessionInvestigation(season, Number(roundNumber), type, ids, $("invOffence").value, $("invTechKind").value);
        saveSeason(season);
        renderHub();
        showToast("Investigation opened – decide the hearing on the FIA desk before the next session.");
      } else if (ds.weekendNotes) {
        openWeekendNotes(Number(ds.weekendNotes));
      } else if (ds.notesRevise) {
        reviseWeekendNotes(Number(ds.notesRevise));
      } else if (ds.hearingPrec) {
        // "Apply precedent": only fills the selects – the decision is still published with the button
        const [itemId, driverId] = ds.hearingPrec.split(":");
        const item = season.inbox.find(x => x.id === Number(itemId));
        const box = b.closest("[data-hearing-box]");
        const p = item && seasonPrecedentPenalty(season, item.data.record.offence, item.data.session);
        if (!p || !box) return;
        const key = "h" + item.id + ":" + driverId;
        const pen = box.querySelector(`[data-pen-for="${key}"]`);
        const pts = box.querySelector(`[data-pts-for="${key}"]`);
        if (pen) pen.value = p.code;
        if (pts) pts.value = String(p.points);
        showToast("Precedent applied: " + PENALTIES[p.code].label + (p.points ? " + " + p.points + " pt" : "") + " (" + p.where + ").");
      } else if (ds.hearing) {
        const item = season.inbox.find(x => x.id === Number(ds.hearing));
        const box = b.closest("[data-hearing-box]");
        if (!item || !box) return;
        const per = readPenaltyForm(box, "h" + item.id, item.data.record.cars);
        const doc = decideHearing(season, item, per);
        renderHub();
        if (doc) showToast("Decision published (Document " + doc.no + ").");
      } else if (ds.hub === "save") {
        const ok = saveSeason(season);
        renderHub();
        showToast(ok ? "Season saved." : "The season could not be saved – export the season file.");
      } else if (ds.practiceSkip) {
        const [roundNumber, type] = ds.practiceSkip.split(":");
        const round = season.calendar.find(r => r.round === Number(roundNumber));
        if (!round) return;
        round.sessions[type] = { status: "CANCELLED", practice: true, skipped: true, rows: [] };
        season.log.push({ date: new Date().toISOString(), round: round.round, text: SESSION_NAMES[type] + " · " + roundInfo(round).gp + ": skipped" });
        if (season.phase === "PRESEASON") season.phase = "SEASON";
        saveSeason(season);
        renderHub();
      } else if (ds.sessionLive) {
        const [roundNumber, type] = ds.sessionLive.split(":");
        b.disabled = true;
        const status = text => { const el = $("sessionStatus"); if (el) el.textContent = text; };
        liveStarting = true;
        startSeasonSession(Number(roundNumber), type, Object.assign({}, hubOptions), status).then(() => {
          liveStarting = false;
        }).catch(error => {
          liveStarting = false;
          console.error(error);
          if (error.trackProblem !== undefined) {
            trackProblem = { circuit: error.trackProblem, message: error.message };
            renderHub();
            return;
          }
          status("Could not start the session: " + error.message);
          b.disabled = false;
        });
      } else if (ds.hub === "export") exportSeason(season);
      else if (ds.hub === "close") leaveSeasonHub();
      else if (ds.zoneOpen) openZoneEditor(circuitKeyOf(ds.zoneOpen), season.zones);
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
      if (d.calendar.length < MAX_ROUNDS) d.calendar.push({ circuit: circuitKeyOf(ds.calAdd), sprint: false });
    } else if (ds.calSort) d.calendar.sort((a, b) => roundInfo(a).date.localeCompare(roundInfo(b).date));
    else if (ds.calClear) d.calendar = [];
    else if (ds.teamRemove) d.teams.splice(Number(ds.teamRemove), 1);
    else if (ds.teamAdd) {
      const info = teamInYear(ds.teamAdd, d.baseYear);
      const used = new Set(d.teams.flatMap(t => t.drivers));
      d.teams.push({ id: info.id, name: info.name, colour: info.colour, drivers: info.drivers.map(x => used.has(x) ? "" : x) });
    } else if (ds.zoneOpen) {
      openZoneEditor(circuitKeyOf(ds.zoneOpen), d.zones);
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
    if (t.id === "invOffence") {
      $("invTechBox").hidden = t.value !== "Technical infringement"; // the kind of a technical infringement
      return;
    }
    if (ds.docRound && season && !seasonDraft) {
      docRound = t.value; // the documents of that weekend
      docOpen = null;
      docEdit = null;
      renderWizardKeepScroll();
      return;
    }
    if (t.id === "invSession" && season && !seasonDraft) {
      invSessionKey = t.value; // the drivers of that session
      renderWizardKeepScroll();
      return;
    }
    if (ds.resultsSelect && season && !seasonDraft) {
      if (hubBusy()) return;
      hubResult = t.value ? { round: Number(ds.resultsSelect), type: t.value } : null;
      renderWizardKeepScroll();
      return;
    }
    if ((ds.juniorFirst || ds.juniorLast) && season && !seasonDraft) {
      const team = seasonTeam(ds.juniorFirst || ds.juniorLast);
      const j = team && seasonJunior(season, team);
      const value = t.value.trim();
      if (!j || !value) {
        renderWizardKeepScroll(); // empty name: show the old one again
        return;
      }
      if (ds.juniorFirst) j.first = value;
      else {
        j.last = value;
        j.code = juniorCode(season, value, j);
      }
      saveSeason(season);
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
