// =====================================================================
//  track-editor.js
//  "Edit track" on the start page: for every circuit (real ones of the data packs and the
//  fictitious ones) the user can set
//   - the DRS zones and their detection points (2011–2025 cars),
//   - the Straight Mode zones and the Overtake Mode detection point (2026 cars),
//   - the corners where track limits are usually monitored (the ★ in the event notes).
//  Stored in this browser ("rc.trackEdits"), used by every mode: fictitious and historic
//  races, data pack races and the championship (own zones of a season come first).
//  Positions are stored in metres together with the lap length, and scaled to the track
//  they are used on (a historic race builds its track from its own lap data).
// =====================================================================

const TRACK_EDIT_STORE = "rc.trackEdits";

function trackEdits() {
  try {
    return JSON.parse(localStorage.getItem(TRACK_EDIT_STORE) || "{}") || {};
  } catch (e) {
    return {};
  }
}

function saveTrackEdits(all) {
  try {
    localStorage.setItem(TRACK_EDIT_STORE, JSON.stringify(all));
    return true;
  } catch (e) {
    return false;
  }
}

function trackEditFor(key) {
  if (key === undefined || key === null) return null;
  return trackEdits()[String(key)] || null;
}

// Put the edits of a circuit on a track (scaled to its length). Returns true when there were edits.
function applyTrackEdits(track, key) {
  const e = trackEditFor(key);
  if (!e) return false;
  const L = track.length;
  const f = L / (e.length || L);
  const at = v => mod(v * f, L);
  if (e.drs) track.drsZones = e.drs.map(z => ({ detect: at(z.detect), start: at(z.start), end: at(z.end) }));
  if (e.straight) track.straightZones = e.straight.map(z => ({ start: at(z.start), end: at(z.end) }));
  if (e.overtakeDetect !== undefined && e.overtakeDetect !== null) track.overtakeDetect = at(e.overtakeDetect);
  if (e.tlCorners) for (const c of track.corners) c.trackLimits = e.tlCorners.includes(c.number);
  return true;
}


// ---------- The editor ----------
let trackEditor = null; // { key, name, track, auto, zones: { drs, straight, overtakeDetect, tlCorners }, tab, pick, view }

function trackEditorCircuitOptions() {
  const real = (SEASON_CATALOGUE.circuits || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return `<optgroup label="Real circuits (data packs)">${real.map(c => `<option value="${escapeHtml(String(c.key))}">${escapeHtml(c.name)}</option>`).join("")}</optgroup>
    <optgroup label="Fictitious circuits">${FICTIONAL_TRACKS.map((t, i) => `<option value="fict:${i}">${escapeHtml(t.name)}</option>`).join("")}</optgroup>`;
}

function initTrackEditor() {
  const box = $("trackEditorBox");
  if (!box) return;
  const fill = () => { $("teCircuit").innerHTML = trackEditorCircuitOptions(); };
  fill();
  packsReady.then(fill); // imported packs bring more circuits
  $("teOpen").addEventListener("click", () => openTrackEditor($("teCircuit").value));
  box.addEventListener("click", trackEditorClick);
  box.addEventListener("change", event => {
    const t = event.target;
    if (t.dataset.teSet) {
      const [list, i, name] = t.dataset.teSet.split(":");
      setTrackEditValue(list, Number(i), name, t.value);
      renderTrackEditor();
    }
  });
  window.addEventListener("resize", () => { if (trackEditor) drawTrackEditor(); });
}

async function openTrackEditor(value) {
  const status = $("teStatus");
  status.textContent = "Loading the circuit…";
  let track;
  let name;
  let key = value;
  try {
    if (value.startsWith("fict:")) {
      const def = FICTIONAL_TRACKS[Number(value.slice(5))];
      track = buildFictionalTrack(def);
      name = def.name;
    } else {
      key = circuitKeyOf(value);
      const full = await loadSeasonTrack(key, null, text => { status.textContent = text; });
      track = full;
      name = circuitInfo(key).name;
    }
  } catch (error) {
    status.textContent = "Could not load the circuit: " + error.message;
    return;
  }
  // the automatic zones of the circuit (what is used without edits)
  const auto = track.autoZones ? JSON.parse(JSON.stringify(track.autoZones)) : {
    drs: track.drsZones.map(z => Object.assign({}, z)),
    straight: makeStraightZones(track).map(z => Object.assign({}, z)),
    overtakeDetect: overtakeDetectPoint(track)
  };
  auto.tlCorners = track.autoTl || track.corners.filter(c => c.trackLimits).map(c => c.number);
  const edit = trackEditFor(key);
  const f = edit && edit.length ? track.length / edit.length : 1;
  const at = v => Math.round(mod(v * f, track.length));
  const zones = edit ? {
    drs: (edit.drs || auto.drs).map(z => ({ detect: at(z.detect), start: at(z.start), end: at(z.end) })),
    straight: (edit.straight || auto.straight).map(z => ({ start: at(z.start), end: at(z.end) })),
    overtakeDetect: at(edit.overtakeDetect !== undefined && edit.overtakeDetect !== null ? edit.overtakeDetect : auto.overtakeDetect),
    tlCorners: (edit.tlCorners || auto.tlCorners).slice()
  } : JSON.parse(JSON.stringify(auto));
  trackEditor = { key: String(key), name, track, auto, zones, tab: trackEditor ? trackEditor.tab : "drs", pick: null, edited: !!edit };
  status.textContent = "";
  renderTrackEditor();
}

function setTrackEditValue(list, i, name, value) {
  const z = trackEditor.zones;
  const L = trackEditor.track.length;
  const v = mod(Math.round(Number(value) || 0), L);
  if (list === "ot") z.overtakeDetect = v;
  else z[list][i][name] = v;
}

function renderTrackEditor() {
  const area = $("teArea");
  const te = trackEditor;
  if (!te) {
    area.innerHTML = "";
    return;
  }
  const z = te.zones;
  const L = Math.round(te.track.length);
  const field = (list, i, name, value) => `
    <span class="zone-field">
      <input type="number" min="0" max="${L}" step="10" data-te-set="${list}:${i}:${name}" value="${Math.round(value)}">
      <button data-te-pick="${list}:${i}:${name}" class="${te.pick && te.pick.list === list && te.pick.i === i && te.pick.name === name ? "on" : ""}" title="Click on the map to place it">⌖</button>
    </span>`;
  const zoneRows = (list, withDetect) => z[list].map((zone, i) => {
    const len = Math.round(mod(zone.end - zone.start, te.track.length));
    return `<tr><td class="pos">${i + 1}</td>${withDetect ? `<td>${field(list, i, "detect", zone.detect)}</td>` : ""}
      <td>${field(list, i, "start", zone.start)}</td><td>${field(list, i, "end", zone.end)}</td>
      <td class="${len < 150 || len > 2200 ? "deleted" : "muted"}">${len} m</td>
      <td class="row-actions"><button data-te-remove="${list}:${i}" title="Remove the zone">✕</button></td></tr>`;
  }).join("");
  let body = "";
  if (te.tab === "drs") {
    body = `<p class="muted small">2011–2025 cars: a car within 1 s of the car ahead at the <b>detection point</b> may open DRS in the zone.</p>
      <table class="season-table zone-table"><thead><tr><th>#</th><th>Detection</th><th>Zone start</th><th>Zone end</th><th>Length</th><th></th></tr></thead>
      <tbody>${zoneRows("drs", true)}</tbody></table>
      <div class="btn-row"><button data-te-add="drs" ${z.drs.length >= 6 ? "disabled" : ""}>+ Add DRS zone</button></div>`;
  } else if (te.tab === "straight") {
    body = `<p class="muted small">2026 cars: in a <b>Straight Mode zone</b> all cars use the low-drag wings. At the <b>Overtake Mode detection point</b> a car within 1 s of the car ahead gets extra electric power for the next lap.</p>
      <table class="season-table zone-table"><thead><tr><th>#</th><th>Zone start</th><th>Zone end</th><th>Length</th><th></th></tr></thead>
      <tbody>${zoneRows("straight", false)}</tbody></table>
      <div class="btn-row"><button data-te-add="straight" ${z.straight.length >= 6 ? "disabled" : ""}>+ Add Straight Mode zone</button></div>
      <p><b class="small">Overtake Mode detection point</b> ${field("ot", -1, "detect", z.overtakeDetect)}</p>`;
  } else {
    body = `<p class="muted small">The corners where track limits are usually monitored (★ in the event notes – the Race Director can still change them for a session).</p>
      <div class="corner-grid">${te.track.corners.map(c => `<label class="check corner-check"><input type="checkbox" data-te-corner="${c.number}" ${z.tlCorners.includes(c.number) ? "checked" : ""}> T${c.number}</label>`).join("")}</div>`;
  }
  area.innerHTML = `
    <div class="te-grid">
      <div>
        <canvas id="teCanvas" class="zone-canvas"></canvas>
        <p class="muted small">${te.pick ? "Click on the map to set " + (te.pick.list === "ot" ? "the Overtake Mode detection point" : "the " + te.pick.name + " of zone " + (te.pick.i + 1)) + "." :
          "Distances in metres after the start/finish line (lap: " + L + " m). Use ⌖ to place a point on the map."}</p>
      </div>
      <div>
        <div class="card-head"><h3>${escapeHtml(te.name)}</h3><span class="muted small">${te.edited ? "edited" : "automatic"}</span></div>
        <div class="seg te-tabs">
          <button data-te-tab="drs" class="${te.tab === "drs" ? "active" : ""}">DRS (2011–25)</button>
          <button data-te-tab="straight" class="${te.tab === "straight" ? "active" : ""}">Straight &amp; Overtake (2026)</button>
          <button data-te-tab="tl" class="${te.tab === "tl" ? "active" : ""}">Track limits</button>
        </div>
        ${body}
        <div class="btn-row te-foot">
          <button data-te-reset="1">Back to automatic</button>
          <button data-te-save="1" class="button-primary">Save track</button>
        </div>
      </div>
    </div>`;
  drawTrackEditor();
}

function drawTrackEditor() {
  const canvas = $("teCanvas");
  const te = trackEditor;
  if (!canvas || !te) return;
  const tr = te.track;
  const w = canvas.clientWidth || 500;
  const h = Math.round(w * 0.72);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const view = makeView(tr, ctx, w, h, tr.bounds, 28);
  te.view = view;
  strokeSegment(view, 0, tr.length, COLOURS.border, 13);
  strokeSegment(view, 0, tr.length, COLOURS.tarmac, 8);
  const z = te.zones;
  if (te.tab === "drs" || te.tab === "tl") {
    z.drs.forEach((zone, i) => {
      strokeSegment(view, zone.start, zone.end, COLOURS.drs, 6, null, te.tab === "drs");
      const mid = screenAt(view, zone.start + mod(zone.end - zone.start, tr.length) / 2, -20);
      label(ctx, String(i + 1), mid.x - 3, mid.y + 4, COLOURS.drs, 12, true);
      if (te.tab === "drs") marker(view, zone.detect, COLOURS.drs, "D" + (i + 1));
    });
  }
  if (te.tab === "straight") {
    z.straight.forEach((zone, i) => {
      strokeSegment(view, zone.start, zone.end, "#4fd8ff", 6, null, true);
      const mid = screenAt(view, zone.start + mod(zone.end - zone.start, tr.length) / 2, -20);
      label(ctx, String(i + 1), mid.x - 3, mid.y + 4, "#4fd8ff", 12, true);
    });
    marker(view, z.overtakeDetect, "#ffffff", "OT");
  }
  // start / finish line and the corners (track limits corners in yellow)
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
    const tl = z.tlCorners.includes(c.number);
    label(ctx, "T" + c.number + (tl && te.tab === "tl" ? " ★" : ""), p.x - 6, p.y + 4, tl && te.tab === "tl" ? COLOURS.yellow : COLOURS.muted, 10, tl && te.tab === "tl");
  }
}

function trackEditorClick(event) {
  const te = trackEditor;
  const t = event.target;
  if (!te) return;
  if (t.id === "teCanvas" && te.pick) {
    const rect = t.getBoundingClientRect();
    const s = trackMetreAt(te.view, event.clientX - rect.left, event.clientY - rect.top);
    setTrackEditValue(te.pick.list, te.pick.i, te.pick.name, s);
    te.pick = null;
    renderTrackEditor();
    return;
  }
  if (t.dataset && t.dataset.teCorner) {
    const n = Number(t.dataset.teCorner);
    te.zones.tlCorners = t.checked ? te.zones.tlCorners.concat(n) : te.zones.tlCorners.filter(x => x !== n);
    drawTrackEditor();
    return;
  }
  const b = t.closest("button");
  if (!b) return;
  const z = te.zones;
  const L = te.track.length;
  if (b.dataset.teTab) {
    te.tab = b.dataset.teTab;
    te.pick = null;
  } else if (b.dataset.tePick) {
    const [list, i, name] = b.dataset.tePick.split(":");
    const same = te.pick && te.pick.list === list && te.pick.i === Number(i) && te.pick.name === name;
    te.pick = same ? null : { list, i: Number(i), name };
  } else if (b.dataset.teRemove) {
    const [list, i] = b.dataset.teRemove.split(":");
    z[list].splice(Number(i), 1);
  } else if (b.dataset.teAdd) {
    const start = Math.round(L * 0.5);
    z[b.dataset.teAdd].push(b.dataset.teAdd === "drs" ? { detect: mod(start - 150, L), start, end: mod(start + 400, L) } : { start, end: mod(start + 400, L) });
  } else if (b.dataset.teReset) {
    const all = trackEdits();
    delete all[te.key];
    saveTrackEdits(all);
    te.zones = JSON.parse(JSON.stringify(te.auto));
    te.edited = false;
    if (te.track.autoZones) applyZones(te.track, null, te.key); // the stored track in memory: automatic again
    showToast("Automatic zones of " + te.name + " restored.");
  } else if (b.dataset.teSave) {
    z.drs.sort((x, y) => x.start - y.start);
    z.straight.sort((x, y) => x.start - y.start);
    const all = trackEdits();
    all[te.key] = { length: Math.round(L), drs: z.drs, straight: z.straight, overtakeDetect: z.overtakeDetect, tlCorners: z.tlCorners.slice().sort((x, y) => x - y), saved: new Date().toISOString() };
    const ok = saveTrackEdits(all);
    te.edited = ok;
    if (te.track.autoZones) applyZones(te.track, null, te.key);
    showToast(ok ? "Track " + te.name + " saved – used in every mode (a championship with its own zones keeps them)." : "Could not save – the browser storage is blocked.");
  } else {
    return;
  }
  renderTrackEditor();
}
