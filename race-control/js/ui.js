// =====================================================================
//  ui.js
//  All panels of the control room: top bar, timing list, selected car,
//  console buttons, incidents, track limits, penalties, alerts,
//  messages, the incident review and the race report.
// =====================================================================

let selectedCar = null;      // id of the selected car
let gapMode = "leader";
let shownVersion = -1;       // we rebuild the lists only when something changed
let shownCarPanel = null;
let reviewState = null;      // the open incident review (or null)
let reportShown = false;

const $ = id => document.getElementById(id);

// ---------- small helpers ----------

function tyreBadge(compound, age) {
  const t = TYRES[compound];
  if (!t) return "–";
  return `<span class="tyre" style="border-color:${t.colour};color:${t.colour}">${t.letter}</span>` +
         (age != null ? `<span class="muted">${age}</span>` : "");
}

function statBox(label, value) {
  return `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
}

function formatGapValue(value) {
  if (value == null) return "–";
  if (typeof value === "number") return "+" + value.toFixed(3);
  return value;
}

function dayTime(t) {
  return formatDayTime(race.clockStart + t);
}

function showToast(text) {
  if (!text) return;
  const toast = $("toast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}

// The confirmation popup of the site (instead of the browser's confirm()).
// Resolves true (OK) or false (cancel, Esc, click outside).
// options: { title, ok, cancel, danger }
let confirmOpen = null; // done() of the popup that is open
function askConfirm(message, options) {
  options = options || {};
  // a popup that is still open is answered with "cancel" first (its listener is removed too)
  if (confirmOpen) confirmOpen(false);
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal confirm-overlay";
    overlay.innerHTML = `
      <div class="modal-box confirm-box" role="alertdialog" aria-modal="true">
        <h2></h2>
        <p class="confirm-text"></p>
        <div class="btn-row confirm-buttons">
          <button data-answer="0"></button>
          <button data-answer="1" class="${options.danger ? "red" : "button-primary"}"></button>
        </div>
      </div>`;
    overlay.querySelector("h2").textContent = options.title || "Please confirm";
    overlay.querySelector(".confirm-text").textContent = message;
    overlay.querySelector('[data-answer="0"]').textContent = options.cancel || "Cancel";
    overlay.querySelector('[data-answer="1"]').textContent = options.ok || "OK";
    const done = answer => {
      if (confirmOpen !== done) return; // answered already
      confirmOpen = null;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(answer);
    };
    confirmOpen = done;
    const onKey = event => {
      // Esc = cancel. Enter and Space press the button that has the focus (OK at the start,
      // Cancel after Tab) – never anything else, and the race behind is not paused.
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        done(false);
      } else if (event.key === "Enter" || event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        const focused = overlay.contains(document.activeElement) && document.activeElement.closest("[data-answer]");
        if (focused) done(focused.dataset.answer === "1");
      } else if (event.key === "Tab") {
        // keep the focus inside the popup
        const buttons = overlay.querySelectorAll("[data-answer]");
        if (!overlay.contains(document.activeElement)) {
          event.preventDefault();
          buttons[1].focus();
        }
      } else {
        event.stopPropagation(); // no shortcuts of the page behind the popup
      }
    };
    overlay.addEventListener("click", event => {
      if (event.target === overlay) return done(false);
      const b = event.target.closest("[data-answer]");
      if (b) done(b.dataset.answer === "1");
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-answer="1"]').focus();
  });
}

// Run a Race Director command and show its error (if any)
function act(fn) {
  const error = fn();
  if (error) showToast(error);
  renderAll(true);
}

// A Race Director command that needs a confirmation first (the race runs on meanwhile)
function confirmedAction(message, options, fn) {
  return () => {
    askConfirm(typeof message === "function" ? message() : message, options).then(ok => { if (ok && race) act(fn); });
    return null;
  };
}


// =====================================================================
//  WRITING TO THE PAGE ONLY WHEN SOMETHING CHANGED
//  Every write (even the same text again) makes the browser recalculate
//  styles and layout – on a phone that is the most expensive part of
//  the control room. So the panels compare before they write.
// =====================================================================
function setText(el, text) {
  text = String(text);
  if (el && el.textContent !== text) el.textContent = text;
}

// only for elements whose content is written by setHtml alone
function setHtml(el, html) {
  if (el && el._html !== html) {
    el._html = html;
    el.innerHTML = html;
  }
}

function setClass(el, css) {
  if (el && el.className !== css) el.className = css;
}

// A table body that keeps its rows and only changes the cells that changed.
// rows: [{ id, css, cells: [html, ...] }]
function patchRows(tbody, rows) {
  const width = rows.length ? rows[0].cells.length : 0;
  while (tbody.rows.length > rows.length) tbody.deleteRow(-1);
  while (tbody.rows.length < rows.length) {
    const tr = tbody.insertRow();
    for (let k = 0; k < width; k++) tr.insertCell();
    tr.cells[0].className = "pos";
  }
  for (let i = 0; i < rows.length; i++) {
    const tr = tbody.rows[i];
    const row = rows[i];
    if (tr.dataset.id !== String(row.id)) tr.dataset.id = row.id;
    setClass(tr, row.css);
    for (let k = 0; k < width; k++) {
      const td = tr.cells[k];
      if (td._html !== row.cells[k]) {
        td._html = row.cells[k];
        td.innerHTML = row.cells[k];
      }
    }
  }
}

let towerBody = null;
function towerTbody() {
  if (!towerBody || !towerBody.isConnected) towerBody = $("tower").querySelector("tbody");
  return towerBody;
}


// =====================================================================
//  RENDER EVERYTHING (called 4 times per second)
// =====================================================================
function renderAll(force) {
  const r = race;
  if (!r) return;
  renderTop();
  renderTower();
  renderCarPanel(force);
  renderConsole();
  renderLights();
  renderTrackJobs();
  if (force || r.ver !== shownVersion) {
    shownVersion = r.ver;
    renderIncidents();
    renderTrackLimits();
    renderPenalties();
    renderRadio();
    renderAlerts();
    renderMessages();
  }
  if (reviewState) updateReviewLive();
  if (r.finished && !reportShown) {
    reportShown = true;
    setTimeout(openReport, 1500);
  }
}


// ---------- Top bar ----------
function trackStatusText() {
  const r = race;
  if (r.session === "QUALI") {
    const q = r.q;
    if (r.finished) return ["SESSION FINISHED", "status-white"];
    if (r.status === "RED") return ["RED FLAG – CLOCK STOPPED", "status-red"];
    if (q.state === "WAITING") return [segName(1) + " NOT STARTED", "status-grey"];
    if (q.state === "BREAK") return [segName() + " FINISHED", "status-grey"];
    if (q.state === "CHEQUERED") return ["CHEQUERED FLAG", "status-white"];
  }
  if (r.finished) return ["SESSION FINISHED", "status-white"];
  if (r.chequered) return ["CHEQUERED FLAG", "status-white"];
  if (r.phase === "PRE") return [r.lights.state === "ABORT" ? "START ABORTED" : "ON THE GRID", "status-grey"];
  if (r.phase === "FORMATION") return [r.status === "GREEN" && r.raceStart !== null ? "RESTART – FORMATION LAP" : "FORMATION LAP", "status-grey"];
  if (r.phase === "GRID_READY") return ["GRID READY", "status-grey"];
  if (r.phase === "START_SEQ") return ["START SEQUENCE", "status-red"];
  const map = {
    VSC: ["VIRTUAL SAFETY CAR", "status-yellow"],
    VSC_ENDING: ["VSC ENDING", "status-yellow"],
    SC: ["SAFETY CAR", "status-orange"],
    SC_ENDING: ["SAFETY CAR IN THIS LAP", "status-orange"],
    RED: ["RED FLAG", "status-red"]
  };
  if (map[r.status]) return map[r.status];
  const yellows = r.sectorFlags.filter(f => f !== "GREEN").length;
  if (yellows > 0) return ["YELLOW · " + yellows + " SECTOR" + (yellows > 1 ? "S" : ""), "status-yellow"];
  return ["TRACK CLEAR", "status-green"];
}

// 754 -> "12:34"
function formatMinutes(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// Championship weather: local rain, wind, lightning
function cellWeatherHtml(r) {
  const w = r.weather;
  let html = w.rainMax > 0.05
    ? `<span>🌧 <b>Rain ${Math.round(w.rainMax * 100)}%</b>${w.rain < w.rainMax * 0.6 ? " <small>(local)</small>" : ""}</span>`
    : `<span>${w.trackTemp > 30 && w.air > 22 ? "☀" : "⛅"} <b>Dry</b></span>`;
  const wetText = w.wetMax < 0.05 ? "dry" : Math.round(Math.min(...w.wetS) * 100) === Math.round(w.wetMax * 100)
    ? Math.round(w.wet * 100) + "% wet" : Math.round(Math.min(...w.wetS) * 100) + "–" + Math.round(w.wetMax * 100) + "% wet";
  html += `<span>Track <b>${wetText}</b></span>`;
  html += `<span title="Rubber on the track: ${Math.round(r.rubber * 100)} % (grows with every lap of the weekend, rain washes it away)">Air <b>${w.air}°</b> Track <b>${w.trackTemp}°</b> · grip <b>${r.rubber < 0.25 ? "green" : r.rubber < 0.6 ? "medium" : "high"}</b></span>`;
  html += `<span>Wind <b>${Math.round(w.wind * 3.6)}</b>${w.gust > w.wind * 1.3 ? "–" + Math.round(w.gust * 3.6) : ""} km/h</span>`;
  if (w.lightningKm < 25) html += `<span class="${w.lightningKm < LIGHTNING_KM ? "mark-bad" : ""}">⚡ <b>${w.lightningKm.toFixed(0)} km</b></span>`;
  // (no forecast text here: the top bar must fit in one row – the radar on the map shows what is coming)
  return html;
}

function renderTop() {
  const r = race;
  if (r.session === "QUALI") {
    const q = r.q;
    setText($("lapCounter"), q.segment === 0 ? segName(1) : segName());
    setText($("raceClock"), q.state === "WAITING" ? formatMinutes(q.durations[0]) :
      q.state === "BREAK" ? formatMinutes(q.durations[q.segment]) : formatMinutes(q.remaining));
  } else {
    setText($("lapCounter"), r.raceStart === null ? "LAP 0 / " + r.totalLaps : "LAP " + r.leaderLap + " / " + r.totalLaps);
    setText($("raceClock"), r.raceStart === null ? "PRE-RACE" : formatClock(r.time - r.raceStart));
  }
  setText($("dayClock"), dayTime(r.time));

  const [text, css] = trackStatusText();
  const pill = $("statusPill");
  setText(pill, text);
  setClass(pill, "pill " + css);

  const w = r.weather;
  if (isCellWeather(r)) {
    setHtml($("weatherBox"), cellWeatherHtml(r));
    return;
  }
  let html = w.rain > 0.05
    ? `<span>🌧 <b>Rain ${Math.round(w.rain * 100)}%</b></span>`
    : `<span>☀ <b>Dry</b></span>`;
  html += `<span>Track <b>${w.wet < 0.05 ? "dry" : Math.round(w.wet * 100) + "% wet"}</b></span>`;
  html += `<span>Air <b>${w.air}°</b> Track <b>${Math.round(w.trackTemp - w.wet * 10)}°</b></span>`;
  setHtml($("weatherBox"), html);
}


// ---------- Timing tower ----------
function carTags(car) {
  let tags = "";
  if (car.dsq) return `<span class="tag black">DSQ</span>`;
  if (car.status === "RETIRED") return `<span class="tag out">OUT</span>`;
  if (car.finished) tags += `<span class="tag fin">FIN</span>`;
  if (car.mode === "STOPPED" || car.stalled) tags += `<span class="tag stop">STOP</span>`;
  else if (car.pit.state) tags += `<span class="tag pit">PIT</span>`;
  if (car.spin > 0) tags += `<span class="tag stop">SPIN</span>`;
  if (car.blue.active) tags += `<span class="tag blue">B</span>`;
  if (car.drsOpen) tags += `<span class="tag drs">DRS</span>`;
  if (car.ers && car.ers.boostLeft > 0) tags += `<span class="tag ovt" title="Overtake Mode">OVT</span>`;
  if (car.ers && car.ers.clipping) tags += `<span class="tag clip" title="Battery empty – clipping on the straight">CLIP</span>`;
  if (car.damage.wing || car.damage.puncture || (car.failure && car.failure.slow)) tags += `<span class="tag dmg">!</span>`;
  if (car.flag === "BW") tags += `<span class="tag bw">.</span>`;
  if (car.flag === "BO") tags += `<span class="tag bo">.</span>`;
  if (car.pen.time > 0) tags += `<span class="tag pen">+${car.pen.time}s</span>`;
  if (car.pen.dt) tags += `<span class="tag pen">DT</span>`;
  if (car.pen.sg) tags += `<span class="tag pen">SG</span>`;
  return tags;
}

// Like the real timing screens:
// black "!" on neon green = under investigation, black "!" on red = penalised
const SHOWN_PENALTIES = ["5S", "10S", "DT", "SG10", "DSQ", "DELETE_LAP", "GRID3", "GRID5", "GRID10", "BACK"];

// car id -> offences under investigation (built once per tower update, not once per car)
function investigatedOffences() {
  const map = new Map();
  for (const i of race.incidents) {
    if (i.status !== "INVESTIGATING" && i.status !== "AFTER_RACE") continue;
    for (const id of i.cars) {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(i.offence);
    }
  }
  return map;
}

function stewardMarks(car, investigatedMap) {
  let html = "";
  const investigated = (investigatedMap || investigatedOffences()).get(car.id);
  if (investigated && investigated.length > 0) {
    const what = investigated.join(" / ");
    html += `<span class="steward-mark investigation" title="Under investigation: ${escapeHtml(what)}">!</span>`;
  }
  const penalties = car.pen.list.filter(p => SHOWN_PENALTIES.includes(p.code));
  if (penalties.length > 0) {
    const what = penalties.map(p => PENALTIES[p.code].label + " – " + p.reason).join(" / ");
    html += `<span class="steward-mark penalty" title="Penalised: ${escapeHtml(what)}">!</span>`;
  }
  return html;
}

let towerHeadFor = null;

function setTowerHead() {
  const quali = race.session === "QUALI";
  if (towerHeadFor === quali) return;
  towerHeadFor = quali;
  $("tower").querySelector("thead").innerHTML = quali
    ? "<tr><th>P</th><th>Driver</th><th>Best</th><th>Gap</th><th>Last lap</th><th>Tyre</th><th></th></tr>"
    : "<tr><th>P</th><th>Driver</th><th>Gap</th><th>Last lap</th><th>Tyre</th><th>Pit</th><th></th></tr>";
}

// Qualifying: what is the car doing right now?
function qualiTags(car) {
  if (car.dsq) return `<span class="tag black">DSQ</span>`;
  if (car.q.eliminated) return `<span class="tag out" title="Knocked out">${segName(car.q.eliminated)}</span>`;
  if (car.status === "RETIRED") return `<span class="tag stop">STOP</span>`;
  let tags = "";
  const p = car.q.phase;
  if (car.mode === "GARAGE") tags += `<span class="tag out" title="In the garage">BOX</span>`;
  else if (car.pit.state) tags += `<span class="tag pit">PIT</span>`;
  else if (p === "OUT") tags += `<span class="tag pit" title="Out lap">OUT</span>`;
  else if (p === "PUSH" && car.q.aborted) tags += `<span class="tag stop" title="Push lap aborted">ABORT</span>`;
  else if (p === "PUSH") tags += `<span class="tag push">PUSH</span>`;
  else if (p === "COOL") tags += `<span class="tag out" title="In lap / cool-down lap">IN</span>`;
  if (car.spin > 0) tags += `<span class="tag stop">SPIN</span>`;
  if (car.damage.wing || car.damage.puncture) tags += `<span class="tag dmg">!</span>`;
  if (car.pen.grid) tags += `<span class="tag pen">-${car.pen.grid}</span>`;
  return tags;
}

function renderTowerQuali() {
  const r = race;
  const q = r.q;
  const seg = Math.max(1, q.segment);
  const order = r.order;
  const poleLap = order[0] ? bestLapInSegment(order[0], seg) : null;
  const cut = q.segment >= 1 && q.segment < 3 && q.state !== "BREAK" ? q.keep[seg - 1] : null;
  const investigated = investigatedOffences();

  const rows = [];
  order.forEach((car, i) => {
    const ownSeg = car.q.eliminated || seg;
    const best = bestLapInSegment(car, ownSeg);
    let gap = "";
    if (best && !car.q.eliminated && poleLap && car !== order[0]) gap = "+" + (best.time - poleLap.time).toFixed(3);
    const last = car.lastLap;
    let lastText = "–";
    if (last) {
      const css = !last.valid ? "deleted" : last.type !== "PUSH" || last.aborted ? "muted" : "";
      lastText = `<span class="${css}">${formatLapTime(last.time)}</span>`;
    }
    const classes = [];
    if (car.id === selectedCar) classes.push("selected");
    if (car.q.eliminated || car.dsq) classes.push("out");
    if (cut !== null && !car.q.eliminated && i >= cut) classes.push("danger");
    if (cut !== null && i === cut) classes.push("cutline");
    rows.push({ id: car.id, css: classes.join(" "), cells: [
      car.dsq ? "–" : String(i + 1),
      `<span class="team-bar" style="background:${car.colour}"></span><span class="num">${car.number}</span><b>${car.code}</b>${stewardMarks(car, investigated)}`,
      best ? formatLapTime(best.time) : "–",
      gap,
      lastText,
      tyreBadge(car.tyre.compound, car.tyre.age),
      qualiTags(car)
    ] });
  });
  patchRows(towerTbody(), rows);
}

function renderTower() {
  renderTowerRows();
  fitTower();
}

// Many cars (more than ~22): the rows get more compact so the whole field fits without
// a scroll bar. Measured only when the number of rows or the height of the panel changes.
const TOWER_SIZES = ["", "compact", "compact-2"];
let towerFitKey = "";
function fitTower() {
  const table = $("tower");
  const wrap = table && table.parentElement;
  if (!wrap || !race) return;
  const key = race.cars.length + "/" + wrap.clientHeight + "/" + wrap.clientWidth;
  if (key === towerFitKey) return;
  towerFitKey = key;
  for (const size of TOWER_SIZES) {
    table.classList.remove("compact", "compact-2");
    if (size) table.classList.add(size);
    if (wrap.scrollHeight <= wrap.clientHeight + 1) return;
  }
}

function renderTowerRows() {
  const r = race;
  setTowerHead();
  if (r.session === "QUALI") {
    renderTowerQuali();
    return;
  }
  const order = r.order;
  const leader = order[0];
  let fastest = null;
  for (const c of r.cars) if (c.bestLap && (!fastest || c.bestLap.time < fastest.time)) fastest = c.bestLap;
  const investigated = investigatedOffences();

  const rows = [];
  order.forEach((car, i) => {
    let gap = "";
    if (r.raceStart === null) gap = "Grid " + (car.slot + 1);
    else if (car.dsq) gap = "DSQ";
    else if (car.status === "RETIRED") gap = "DNF L" + car.laps;
    else if (i === 0) gap = car.finished ? "Winner" : "Leader";
    else if (car.finished && leader.finished && car.laps === leader.laps) {
      gap = "+" + (gapMode === "leader" ? car.finishTime - leader.finishTime : car.finishTime - order[i - 1].finishTime).toFixed(3);
    } else {
      gap = formatGapValue(gapMode === "leader" ? displayGap(car, leader, "leader") : displayGap(car, order[i - 1], "interval"));
    }

    const last = car.lastLap;
    let lastText = "–";
    if (last) {
      const css = !last.valid ? "deleted" : fastest && last === fastest ? "purple" : "";
      lastText = `<span class="${css}">${formatLapTime(last.time)}</span>`;
    }

    const out = car.status === "RETIRED" || car.dsq;
    rows.push({ id: car.id, css: (car.id === selectedCar ? "selected" : "") + (out ? " out" : ""), cells: [
      out ? "–" : String(i + 1),
      `<span class="team-bar" style="background:${car.colour}"></span><span class="num">${car.number}</span><b>${car.code}</b>${stewardMarks(car, investigated)}`,
      gap,
      lastText,
      tyreBadge(car.tyre.compound, car.tyre.age),
      String(car.pit.stops),
      carTags(car)
    ] });
  });
  patchRows(towerTbody(), rows);
}


// ---------- Selected car ----------
// 2026 cars: state of charge of the battery and what the driver does with it
function batteryText(car) {
  const e = car.ers;
  const pct = Math.round(e.soc * 100);
  const colour = e.soc <= 0.03 ? "#ff6b61" : e.soc < 0.25 ? "#ffb020" : "#2fd36b";
  let note = "";
  if (e.clipping) note = "clipping";
  else if (e.boostLeft > 0) note = "Overtake Mode";
  else if (e.recharge) note = "recharging";
  return `<span style="color:${colour}">${pct}%</span>` + (note ? ` <small class="muted">${note}</small>` : "");
}

// The last lap as if the car had no fuel on board (the car gets lighter every lap):
// shows the real pace of car and tyres. Green-flag laps only.
function fuelCorrectedText(car) {
  const lap = car.lastLap;
  if (!lap || lap.pitLane || lap.neutral || lap.fuel === undefined) return "–";
  return `<span title="Last lap ${formatLapTime(lap.time)} with ${Math.round(lap.fuel)} kg of fuel">${formatLapTime(lap.time * (1 - lap.fuel * FUEL_EFFECT))}</span>`;
}

// The SC / VSC delta of a car: + = slower than the minimum time (ok), − = too fast
function deltaText(car) {
  if (race.time < car.deltaFrom) return "<span class='muted'>starting…</span>";
  if (car.deltaKey[0] === "S" && car.gapAheadM < 120 && !car.catchingUp && !car.unlapping) return "<span class='muted'>in the queue</span>";
  const d = car.delta;
  return `<span class="${d < -0.1 ? "deleted" : ""}">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)} s</span>`;
}

function renderCarPanel(force) {
  const r = race;
  const panel = $("carPanel");
  const car = selectedCar !== null ? carById(selectedCar) : null;
  if (!car) {
    if (shownCarPanel !== null || force) {
      panel.innerHTML = `<p class="muted small">Click a driver in the timing list or a car on the map.</p>`;
      shownCarPanel = null;
    }
    return;
  }

  // the header and the buttons are built once per car (so clicks are not lost)
  if (shownCarPanel !== car.id || force) {
    shownCarPanel = car.id;
    panel.innerHTML = `
      <div class="car-head" style="--team:${car.colour}">
        ${car.headshot ? `<img src="${car.headshot}" alt="">` : ""}
        <span class="big-num">${car.number}</span>
        <div><b>${escapeHtml(car.name)}</b><span class="muted small">${escapeHtml(car.team)}</span></div>
        <button class="close-btn car-close" data-close-car="1" title="Close the driver information">✕</button>
      </div>
      <div id="carStats" class="stats"></div>
      <div class="btn-row car-actions">
        <button data-flag="BW" title="Black &amp; white flag: warning for track limits or unsportsmanlike behaviour">B/W flag</button>
        <button data-flag="BO" title="Black &amp; orange flag: the car has damage and must pit for repairs">B/O flag</button>
        <button data-flag="BLACK" class="danger-btn" title="Black flag: disqualification">Black flag</button>
        <button data-investigate="1" title="Open an investigation about this car">Investigate…</button>
      </div>`;
  }

  const pos = r.order.indexOf(car) + 1;
  const leader = r.order[0];
  let state = "Racing";
  if (car.dsq) state = "Disqualified";
  else if (car.status === "RETIRED") state = "Retired – " + car.retireReason;
  else if (car.finished) state = "Finished";
  else if (car.mode === "FORMATION") state = "Formation lap";
  else if (car.mode === "GRID") state = car.stalled ? "STALLED on the grid" : "On the grid";
  else if (car.pit.state === "STOP") state = "Pit stop " + Math.max(0, car.pit.stopLeft).toFixed(1) + " s";
  else if (car.pit.state === "RELEASE") state = "In the box – waiting for a gap in the pit lane";
  else if (car.pit.state === "IN" && car.pit.queued) state = "Double stack – waiting behind the team-mate";
  else if (car.pit.state) state = "In the pit lane";
  else if (car.spin > 0) state = "Spun";
  else if (car.failure && car.failure.slow) state = "Slow – " + car.failure.type;

  const damage = [];
  if (car.damage.wing) damage.push("front wing");
  if (car.damage.puncture) damage.push("puncture");
  if (car.damage.floor > 0) damage.push("floor " + Math.round(car.damage.floor * 100) + "%");

  const penalties = [];
  if (car.pen.time > 0) penalties.push("+" + car.pen.time + " s to serve");
  if (car.pen.dt) penalties.push("drive-through");
  if (car.pen.sg) penalties.push("stop/go");
  if (car.pen.post > 0) penalties.push("+" + car.pen.post + " s after race");

  const stats = $("carStats");
  if (stats && r.session === "QUALI") {
    const phaseText = { GARAGE: "In the garage", OUT: "Out lap", PUSH: car.q.aborted ? "Push lap aborted" : r.q.practice ? (car.q.runLong ? "Long run (high fuel)" : "Timed lap") : "Push lap", COOL: "In lap" };
    const segBest = seg => {
      const lap = bestLapInSegment(car, seg);
      return lap ? formatLapTime(lap.time) : "–";
    };
    let qualiState = car.dsq ? "Disqualified" : car.q.eliminated ? "Knocked out in " + segName(car.q.eliminated)
      : car.status === "RETIRED" ? "Stopped – " + car.retireReason : (phaseText[car.q.phase] || state);
    if (car.pit.state && car.mode !== "GARAGE") qualiState = "In the pit lane";
    setHtml(stats,
      statBox("Position", "P" + pos) +
      statBox("Speed", Math.round(car.speed * 3.6) + " km/h") +
      statBox("Laps", car.laps) +
      (r.q.practice ? statBox("Best lap", segBest(1)) + statBox("Run", car.q.runNo || 0) + statBox("Laps this run", car.q.phase === "PUSH" ? car.q.pushesLeft + " to go" : "–")
        : statBox(segName(1) + " best", segBest(1)) + statBox(segName(2) + " best", segBest(2)) + statBox(segName(3) + " best", segBest(3))) +
      statBox("Last lap", car.lastLap ? `<span class="${car.lastLap.valid ? "" : "deleted"}">${formatLapTime(car.lastLap.time)}</span>` : "–") +
      statBox("Tyre", tyreBadge(car.tyre.compound) + " " + car.tyre.age + (car.tyre.age === 1 ? " lap" : " laps")) +
      statBox("Runs left", car.q.runs ? car.q.runs.length : 0) +
      statBox("Damage", damage.length ? damage.join(", ") : "none") +
      statBox("Laps deleted", car.tlStrikes) +
      statBox("Grid penalty", car.pen.grid ? car.pen.grid + " places" : car.pen.back ? "back of grid" : "none") +
      statBox("Pen. points", car.pen.points + " <small class='muted'>W" + car.pen.warnings + " R" + car.pen.reprimands + "</small>") +
      statBox("Status", qualiState));
  } else if (stats) {
    setHtml(stats,
      statBox("Position", r.raceStart === null ? "Grid " + (car.slot + 1) : (car.status === "RETIRED" ? "–" : "P" + pos) + " <small class='muted'>grid " + car.grid + "</small>") +
      statBox("Gap leader", car === leader ? "–" : formatGapValue(displayGap(car, leader, "leader"))) +
      statBox("Speed", Math.round(car.speed * 3.6) + " km/h") +
      statBox("Laps", car.laps) +
      statBox("Last lap", car.lastLap ? `<span class="${car.lastLap.valid ? "" : "deleted"}">${formatLapTime(car.lastLap.time)}</span>` : "–") +
      statBox("Best lap", car.bestLap ? formatLapTime(car.bestLap.time) : "–") +
      statBox("Tyre", tyreBadge(car.tyre.compound) + " " + car.tyre.age + (car.tyre.age === 1 ? " lap" : " laps")) +
      statBox("Tyre wear", Math.round(car.tyre.wear * 100) + "%" + (car.tyre.graining ? " <small class='deleted'>graining</small>" : car.coldTyres > 0 ? " <small class='muted'>cold</small>" : "")) +
      statBox("Fuel", Math.round(car.fuel) + " kg") +
      statBox("Fuel-corrected", fuelCorrectedText(car)) +
      (car.ers ? statBox("Battery", batteryText(car)) : "") +
      (car.deltaKey && car.delta !== null ? statBox(car.deltaKey[0] === "V" ? "VSC delta" : "SC delta", deltaText(car)) : "") +
      statBox("Damage", damage.length ? damage.join(", ") : "none") +
      statBox("Pit stops", car.pit.stops) +
      statBox("Track limits", car.tlStrikes + " deleted") +
      statBox("Penalties", penalties.length ? penalties.join(", ") : "none") +
      statBox("Pen. points", car.pen.points + " <small class='muted'>W" + car.pen.warnings + " R" + car.pen.reprimands + "</small>") +
      statBox("Status", state));
  }
}


// ---------- Console buttons ----------
function renderConsole() {
  const r = race;
  if (r.session === "QUALI") {
    renderQualiConsole();
    return;
  }
  const racing = r.phase === "RACE" && !r.chequered && !r.finished;
  const st = r.status;
  const can = {
    formation: r.phase === "PRE",
    sequence: r.phase === "GRID_READY",
    abort: r.phase === "GRID_READY" || r.phase === "START_SEQ",
    startSC: r.phase === "GRID_READY" && r.starts === 0,
    delayStart: r.phase === "PRE" && !r.startDelayed,
    eventNotes: r.setup.seasonContext ? !!r.eventNotes : r.phase === "PRE", // championship: the weekend notes (read-only)
    skip: canSkipTime(),
    abandon: !r.finished && (r.phase !== "RACE" || r.status === "RED" || r.status === "SC" || r.status === "VSC"),
    vsc: racing && (st === "GREEN"),
    endVsc: st === "VSC",
    sc: racing && (st === "GREEN" || st === "VSC" || st === "VSC_ENDING"),
    lapped: st === "SC" && !!r.sc && !r.lappedMayOvertake && !(r.eventNotes && r.eventNotes.lappedAllowed === false),
    scIn: st === "SC" && !!r.sc,
    scStanding: st === "SC" && !!r.sc && racing,
    red: racing && st !== "RED",
    resumeStanding: st === "RED",
    resumeRolling: st === "RED",
    shorten: racing,
    yellow: selectedSector >= 0,
    double: selectedSector >= 0,
    slippery: selectedSector >= 0,
    rain: true, // without a selected sector: the whole track
    clear: selectedSector >= 0,
    clearAll: r.sectorFlags.some(f => f !== "GREEN"),
    pitEntry: true,
    pitExit: true,
    drs: r.drsEnabled || (racing && st === "GREEN"),
    straight: is2026(),
    straightZone: straightZoneInSector(selectedSector) >= 0,
    wet: !r.wetDeclared
  };
  const active = {
    vsc: st === "VSC" || st === "VSC_ENDING",
    sc: st === "SC" || st === "SC_ENDING",
    red: st === "RED",
    yellow: selectedSector >= 0 && r.sectorFlags[selectedSector] === "YELLOW",
    double: selectedSector >= 0 && r.sectorFlags[selectedSector] === "DOUBLE",
    slippery: selectedSector >= 0 && r.slippery[selectedSector],
    rain: selectedSector >= 0 ? rainShown(selectedSector) : anyRainShown()
  };
  applyConsoleState(can, active);
}

function renderQualiConsole() {
  const r = race;
  const q = r.q;
  const st = r.status;
  const running = q.state === "RUNNING";
  const can = {
    segment: (q.state === "WAITING" || q.state === "BREAK") && st !== "RED",
    red: running && st !== "RED",
    resumeStanding: st === "RED",
    skip: canSkipTime(),
    abandon: !r.finished && q.state !== "DONE",
    yellow: selectedSector >= 0,
    double: selectedSector >= 0,
    slippery: selectedSector >= 0,
    rain: true, // without a selected sector: the whole track
    clear: selectedSector >= 0,
    clearAll: r.sectorFlags.some(f => f !== "GREEN"),
    pitEntry: true,
    pitExit: st !== "RED",
    drs: !is2026(),
    straight: is2026(),
    straightZone: straightZoneInSector(selectedSector) >= 0,
    wet: !r.wetDeclared,
    maxDelta: q.state !== "DONE",
    eventNotes: r.setup.seasonContext ? !!r.eventNotes : q.state === "WAITING"
  };
  const active = {
    red: st === "RED",
    yellow: selectedSector >= 0 && r.sectorFlags[selectedSector] === "YELLOW",
    double: selectedSector >= 0 && r.sectorFlags[selectedSector] === "DOUBLE",
    slippery: selectedSector >= 0 && r.slippery[selectedSector],
    rain: selectedSector >= 0 ? rainShown(selectedSector) : anyRainShown()
  };
  const next = q.state === "BREAK" ? q.segment + 1 : Math.max(1, q.segment);
  setText($("segmentBtn"), q.state === "DONE" ? "Session finished" :
    can.segment ? "Start " + segName(next) + " (green light)" : segName() + " running");
  setText($("resumeBtn"), "Resume session");
  const delta = $("maxDeltaBtn");
  setText(delta, "Max delta time: " + (q.maxDelta ? "in force" : "OFF"));
  const on = q.maxDelta ? "1" : "0";
  if (delta.dataset.on !== on) delta.dataset.on = on;
  applyConsoleState(can, active);
}

let consoleButtons = null;
function applyConsoleState(can, active) {
  const r = race;
  if (!consoleButtons || !consoleButtons.length || !consoleButtons[0].isConnected) {
    consoleButtons = Array.from(document.querySelectorAll(".console button[data-action]"));
  }
  for (const button of consoleButtons) {
    const a = button.dataset.action;
    const disabled = !can[a];
    if (button.disabled !== disabled) button.disabled = disabled;
    const isActive = !!active[a];
    if (button.classList.contains("active-state") !== isActive) button.classList.toggle("active-state", isActive);
  }

  const entry = $("pitEntryBtn");
  setText(entry, "Pit entry: " + (r.pitEntryOpen ? "open" : "CLOSED"));
  setClass(entry, r.pitEntryOpen ? "on" : "off");
  const exit = $("pitExitBtn");
  setText(exit, "Pit exit: " + (r.pitExitOpen ? "green light" : "RED LIGHT"));
  setClass(exit, r.pitExitOpen ? "on" : "off");
  const drs = $("drsBtn");
  setText(drs, aidName() + ": " + (is2026() && r.session === "QUALI" ? "race only" : r.drsEnabled ? "ENABLED" : "disabled"));
  setClass(drs, r.drsEnabled ? "on" : "");
  if (is2026()) {
    const straight = $("straightBtn");
    setText(straight, "Straight Mode: " + (r.straightEnabled ? "active" : "DISABLED"));
    setClass(straight, "gen2026-only " + (r.straightEnabled ? "on" : "off"));
    const zi = straightZoneInSector(selectedSector);
    const zoneBtn = $("straightZoneBtn");
    setText(zoneBtn, zi >= 0 ? "Straight zone " + (zi + 1) + ": " + (r.straightOff[zi] ? "OFF" : "on") : "Straight zone: select a sector");
    setClass(zoneBtn, "gen2026-only " + (zi >= 0 && r.straightOff[zi] ? "off" : ""));
  }

  setText($("selSectorLabel"), selectedSectors.length > 1
    ? "– " + sectorsText(selectedSectors).replace("Sectors ", "")
    : selectedSector >= 0
      ? (selectedSector + 1) + " · " + locationName(r.track, (selectedSector + 0.5) * r.track.msLen) + " · " +
        ({ GREEN: "green", YELLOW: "yellow", DOUBLE: "double yellow" })[r.sectorFlags[selectedSector]]
      : "– click or drag on the map");
}

function renderLights() {
  const r = race;
  const box = $("lights");
  const st = r.lights.state;
  const hidden = !(r.phase === "START_SEQ" || r.phase === "GRID_READY" || r.phase === "FORMATION" || st === "ABORT" ||
                 (st === "OUT" && r.time - r.lastStart < 3));
  if (box.hidden !== hidden) box.hidden = hidden;
  if (hidden) return;
  // a place on the map without track under it (map.js), the same for the whole session
  if (mainView) {
    const spot = lightsSpot(mainView, box.offsetWidth, box.offsetHeight);
    const left = Math.round(spot.x) + "px";
    const top = Math.round(spot.y) + "px";
    if (box.style.left !== left) box.style.left = left;
    if (box.style.top !== top) box.style.top = top;
  }
  box.querySelectorAll("span").forEach((lamp, i) => {
    let css = "";
    if (r.phase === "START_SEQ" && i < r.lights.count) css = "on-red";
    if (r.phase === "FORMATION") css = "on-green";
    if (st === "ABORT" && r.phase === "PRE") css = "on-orange";
    setClass(lamp, css);
  });
}


// ---------- Incidents list ----------
const STATUS_TEXT = {
  NEW: "NEW", NOTED: "NOTED", INVESTIGATING: "UNDER INVESTIGATION",
  AFTER_RACE: "AFTER THE RACE", NFI: "NO INVESTIGATION", DECIDED: "DECIDED"
};

function statusText(st) {
  if (st === "AFTER_RACE" && race.session === "QUALI") return "AFTER THE SESSION";
  return STATUS_TEXT[st];
}

function renderIncidents() {
  const r = race;
  const open = r.incidents.filter(i => i.status !== "DECIDED" && i.status !== "NFI").length;
  setText($("cntInc"), open || "");

  let html = "";
  for (const inc of r.incidents.slice().reverse()) {
    let decision = "";
    if (inc.status === "DECIDED") {
      const parts = [];
      for (const id in inc.decision.perCar) {
        const d = inc.decision.perCar[id];
        if (d.code !== "NFA") parts.push(carById(Number(id)).code + " " + PENALTIES[d.code].short);
      }
      const ev = inc.evaluation;
      const mark = ev ? (ev.score >= 10 ? "<span class='mark-good'>✔</span>" : ev.score >= 6 ? "<span class='mark-ok'>≈</span>" : "<span class='mark-bad'>✘</span>") : "";
      decision = `<div class="meta">${mark} ${parts.length ? parts.join(", ") : "No further action"}</div>`;
    }
    html += `
      <div class="inc-card st-${inc.status}" data-inc="${inc.id}">
        <div class="top">
          <b>${escapeHtml(inc.offence)}</b>
          <span><span class="chip ${inc.status}">${statusText(inc.status)}</span>${inc.historic ? ' <span class="chip hist">REAL</span>' : ""}</span>
        </div>
        <div class="meta">${incidentCars(inc)} · ${escapeHtml(inc.location)} · ${lapLabel(inc.lap)} · ${dayTime(inc.t)}</div>
        ${decision}
      </div>`;
  }
  setHtml($("tabIncidents"), html || "<p class='muted small'>No incidents yet. They appear here when the marshals or the timing system report something.</p>");
}

function renderTrackLimits() {
  const r = race;
  const open = r.trackLimits.filter(t => t.status === "NEW").length;
  setText($("cntTl"), open || "");

  const items = r.trackLimits.slice().reverse().sort((a, b) => (a.status === "NEW" ? 0 : 1) - (b.status === "NEW" ? 0 : 1));
  let html = "";
  for (const tl of items.slice(0, 80)) {
    const car = carById(tl.carId);
    const done = tl.status !== "NEW";
    html += `
      <div class="tl-item ${done ? "done" : ""}">
        <b>${car.number} ${car.code}</b> · ${tl.corner} · Lap ${tl.lap} ${tl.real ? '<span class="chip hist">REAL</span>' : ""}
        <div class="meta">${dayTime(tl.t)} · ${escapeHtml(tl.evidence)} · strikes: ${car.tlStrikes}</div>
        ${done
          ? `<span class="small">${tl.status === "DELETED" ? "Lap time deleted" : "No action"}</span> <button class="small-btn" data-tl-review="${tl.id}">Review</button>`
          : `<div class="btn-row"><button data-tl-review="${tl.id}">Review…</button><button data-tl-delete="${tl.id}">Delete lap time</button><button data-tl-dismiss="${tl.id}">No action</button></div>`}
      </div>`;
  }
  setHtml($("tabLimits"), html || "<p class='muted small'>No track limits reports yet.</p>");
}

function renderPenalties() {
  const r = race;
  let html = "";
  for (const p of r.penaltyLog.slice().reverse()) {
    const car = carById(p.carId);
    html += `
      <div class="tl-item">
        <b>${car.number} ${car.code}</b> · ${PENALTIES[p.code].label}${p.points ? " · " + p.points + " pts" : ""}
        <div class="meta">${escapeHtml(p.reason)} · ${lapLabel(p.lap)}</div>
        <span class="small ${p.served ? "mark-good" : "mark-ok"}">${p.served ? "✔ " : "⏳ "}${escapeHtml(p.note || (p.served ? "applied" : "pending"))}</span>
      </div>`;
  }
  setHtml($("tabPenalties"), html || "<p class='muted small'>No penalties given yet.</p>");
}

// ---------- Team radio: complaints and requests of the teams ----------
const RADIO_STATUS = { INFO: "TEAM ORDER", NEW: "NEW", NOTED: "NOTED", INVESTIGATING: "INVESTIGATING", REJECTED: "REJECTED", RESOLVED: "DONE" };
function renderRadio() {
  const r = race;
  const list = (r.radio || []).slice().reverse();
  const fresh = list.filter(m => m.status === "NEW").length;
  setText($("cntRadio"), fresh ? String(fresh) : "");
  const html = list.map(m => {
    const car = carById(m.carId);
    const open = m.status === "NEW" || m.status === "NOTED";
    const buttons = !open ? "" : m.kind === "COMPLAINT"
      ? `<button data-radio="${m.id}:INVESTIGATE">Investigate</button>${m.status === "NEW" ? `<button data-radio="${m.id}:NOTE">Note</button>` : ""}<button data-radio="${m.id}:REJECT">Reject</button>`
      : `${m.status === "NEW" ? `<button data-radio="${m.id}:NOTE">Acknowledge</button>` : ""}<button data-radio="${m.id}:REJECT">Decline</button>`;
    return `<div class="radio-msg ${m.status.toLowerCase()}" style="--team:${car ? car.colour : "#5f6880"}">
      <div class="top"><span class="radio-kind">${m.kind === "COMPLAINT" ? "Complaint" : m.kind === "TEAM" ? "Team radio (heard)" : "Request"} · ${escapeHtml(m.team)}</span>
        <span class="chip ${m.status === "RESOLVED" ? "DECIDED" : m.status === "REJECTED" ? "NFI" : m.status}">${RADIO_STATUS[m.status] || m.status}</span></div>
      <div class="small">${escapeHtml(m.text)}</div>
      <div class="muted small">${dayTime(m.t)} · ${race.session === "QUALI" ? lapLabel(m.lap) : "lap " + m.lap}</div>
      ${buttons ? `<div class="btn-row">${buttons}</div>` : ""}
    </div>`;
  }).join("");
  setHtml($("tabRadio"), html || "<p class='muted small'>No radio messages yet. Teams complain about other cars or ask you to act (wet race, debris, pit exit).</p>");
}

// ---------- On track: obstacles and their recovery crews ----------
const JOB_ICONS = { CAR: "🚗", DEBRIS: "⚠", OIL: "🛢", BARRIER: "🚧", MEDICAL: "🚑" };
function renderTrackJobs() {
  const r = race;
  const open = r.obstacles.filter(o => !o.cleared);
  const html = open.map(ob => {
    const st = recoveryState(ob);
    const crew = crewFor(ob);
    return `<li class="job ${st.key.toLowerCase()}" data-job-sector="${ob.sector}">
      <span class="job-icon">${JOB_ICONS[ob.type] || "⚠"}</span>
      <span class="job-text"><b>${escapeHtml(ob.label)}</b> <span class="muted">· post ${ob.sector}${ob.onTrack ? " · on the racing line" : ""}</span><br>
        <span class="job-state">${escapeHtml(st.text)}</span></span>
      ${ob.crew ? "" : `<button data-send-recovery="${ob.id}" title="Send the ${escapeHtml(crew.name)} to marshal post ${ob.sector}">Send ${escapeHtml(crew.name)}</button>`}
    </li>`;
  }).join("");
  setHtml($("trackJobs"), html || "<li class='muted small'>Track clear.</li>");
}

function renderAlerts() {
  const r = race;
  let html = "";
  for (const a of r.alerts.slice(-80).reverse()) {
    const clickable = a.carId != null || a.sector != null || a.s != null;
    html += `<li class="${a.level} ${clickable ? "clickable" : ""}" data-alert="${a.id}">
               <span class="time">${dayTime(a.t)}</span><span>${escapeHtml(a.text)}</span></li>`;
  }
  setHtml($("alerts"), html || "<li class='muted'>All quiet.</li>");
}

function renderMessages() {
  const r = race;
  const showBlue = $("showBlue").checked;
  let html = "";
  const list = r.messages.filter(m => showBlue || m.category !== "Blue").slice(-150).reverse();
  for (const m of list) {
    html += `<li><span class="time">${dayTime(m.t)}<br>${race.session === "QUALI" ? lapLabel(m.lap) : "L" + m.lap}</span><span class="cat ${m.category}"></span><span>${escapeHtml(m.text)}</span></li>`;
  }
  setHtml($("messages"), html || "<li class='muted'>No messages yet.</li>");
}


// =====================================================================
//  INCIDENT REVIEW
// =====================================================================
function openReview(id) {
  const inc = race.incidents.find(i => i.id === id);
  if (!inc) return;
  tlReview = null;
  const state = { inc, t: inc.t - 8, playing: true, rate: 0.5, lastFrame: performance.now(), built: "" };
  reviewState = state;
  buildReview();
  showModal();
  requestAnimationFrame(now => animateClip(now, state));
}

// The big pop-up (reports, investigations): the keyboard focus goes into it and back afterwards
let modalReturnFocus = null;
function showModal() {
  const modal = $("modal");
  if (modal.hidden) modalReturnFocus = document.activeElement;
  modal.hidden = false;
  const first = modal.querySelector(".close-btn, button");
  if (first) first.focus({ preventScroll: true });
}

function closeModal() {
  $("modal").hidden = true;
  if (modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus({ preventScroll: true });
  modalReturnFocus = null;
  $("modalBox").className = "modal-box";
  reviewState = null;
  tlReview = null;
}

function buildReview() {
  const inc = reviewState.inc;
  const r = race;
  const box = $("modalBox");
  box.className = "modal-box review-box";
  reviewState.built = inc.status + "|" + !!inc.clip;
  inc.view = null; // the canvas is new, so the replay view must be rebuilt

  const cars = inc.cars.map(carById).filter(Boolean);
  const evidence = inc.evidence.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("");
  const statements = inc.statements.map(([who, text]) => `<p class="statement"><b>${who}:</b> “${escapeHtml(text)}”</p>`).join("");

  // which cars of the incident can be seen in the footage?
  let footageNote = "";
  if (inc.clip) {
    const seen = new Set();
    for (const f of inc.clip) for (const c of f.cars) seen.add(c[0]);
    const missing = cars.filter(c => !seen.has(c.id));
    clipRegion(r.track, inc); // tells us if the cars were far apart
    if (missing.length) footageNote += `<p class="muted small">Not in the footage: ${missing.map(c => c.code).join(", ")} – the car was already in the garage or recovered.</p>`;
    if (inc.wideView) footageNote += `<p class="muted small">The cars were far apart at that moment, so the whole circuit is shown.</p>`;
  }

  const st = inc.status;
  const procedure = `
    <div class="btn-row">
      <button data-proc="note" ${st === "NEW" ? "" : "disabled"}>Note</button>
      <button data-proc="investigate" ${st === "NEW" || st === "NOTED" ? "" : "disabled"}>Investigate</button>
      <button data-proc="after" ${["NEW", "NOTED", "INVESTIGATING"].includes(st) ? "" : "disabled"}>Investigate after the ${race.session === "QUALI" ? "session" : "race"}</button>
      <button data-proc="nfi" ${st === "NEW" || st === "NOTED" ? "" : "disabled"}>No investigation necessary</button>
    </div>`;

  let decision = "";
  if (st === "DECIDED") {
    const parts = cars.map(c => {
      const d = inc.decision.perCar[c.id];
      return `<b>${c.code}</b>: ${PENALTIES[d.code].label}${d.points ? " + " + d.points + " penalty points" : ""}`;
    }).join("<br>");
    const ev = inc.evaluation;
    decision = `<div class="result-box">${parts}</div>`;
    if (ev) {
      decision += `<div class="result-box ${ev.score >= 10 ? "good" : ev.score >= 6 ? "ok" : "bad"}"><b>${escapeHtml(ev.text)}</b><br>${escapeHtml(inc.truth.reason)}</div>`;
    } else if (!inc.truth) {
      decision += `<div class="result-box">There is no reference decision for this incident.</div>`;
    }
    if (inc.historic) decision += `<div class="result-box hist"><b>Real race control:</b> ${escapeHtml(inc.historic.text)}<br><b>Real decision:</b> ${escapeHtml(inc.historic.decision)}</div>`;
    decision += `<div class="btn-row"><button data-doc="show">📄 Decision document</button></div>`;
  } else if (st === "NFI") {
    decision = `<div class="result-box">Not investigated.</div>`;
    if (inc.truth) decision += `<div class="result-box ${inc.truth.penalty === "NFA" ? "good" : "bad"}">${escapeHtml(inc.truth.reason)}</div>`;
  } else {
    const options = penaltyCodes().map(c => `<option value="${c}">${PENALTIES[c].label}</option>`).join("");
    const prec = precedentPenalty(inc);
    const rows = cars.map(c => `
      <div class="decision-row">
        <b><span class="team-bar" style="background:${c.colour}"></span>${c.number} ${c.code}</b>
        <select data-pen="${c.id}">${options}</select>
        <select data-pts="${c.id}">
          <option value="0">0 points</option><option value="1">1 point</option>
          <option value="2">2 points</option><option value="3">3 points</option>
        </select>
        ${prec ? `<button class="small-btn" data-prec="${c.id}" title="Use the latest precedent (${escapeHtml(prec.where)}): ${escapeHtml(PENALTIES[prec.code].label)}${prec.points ? " + " + prec.points + " pt" : ""}">Apply precedent</button>` : ""}
      </div>`).join("");
    const locked = st === "AFTER_RACE" && !r.finished;
    decision = rows + `<button id="decideBtn" class="button-primary" ${locked ? "disabled" : ""}>Publish decision</button>` +
      (locked ? `<p class="muted small">You chose to investigate this after the race.</p>` : "");
  }

  // the decision document instead of the review (printable)
  if (reviewState.showDoc && st === "DECIDED") {
    box.className = "modal-box narrow doc-box";
    box.innerHTML = `
      <div class="modal-head">
        <div><h2>Decision document</h2><p class="muted">${escapeHtml(inc.location)} – ${escapeHtml(inc.offence)}</p></div>
        <button class="close-btn" aria-label="Close" data-close="1">✕</button>
      </div>
      ${decisionDocumentHtml(inc)}
      <div class="btn-row"><button class="button-primary" data-doc="print">Print</button><button data-doc="back">← Back to the incident</button></div>`;
    return;
  }

  // investigated after the session: the drivers are summoned to the stewards' room
  const hearing = st === "AFTER_RACE" && r.finished
    ? `<div class="result-box">⚖ <b>Hearing</b> – ${cars.map(c => escapeHtml(c.name) + " (" + escapeHtml(c.team) + ")").join(" and ")} and the team representatives were summoned to the stewards' room. Their statements are below.</div>`
    : "";

  box.innerHTML = `
    <div class="modal-head">
      <div>
        <span class="chip ${st}">${statusText(st)}</span> ${inc.historic ? '<span class="chip hist">REAL INCIDENT</span>' : ""}
        <h2>${escapeHtml(inc.location)} – ${escapeHtml(inc.offence)}</h2>
        <p class="muted">${lapLabel(inc.lap)} · ${dayTime(inc.t)} · ${cars.map(c => carLabel(c)).join(", ")}</p>
      </div>
      <button class="close-btn" aria-label="Close" data-close="1">✕</button>
    </div>
    <div class="review-body">
      <div>
        ${inc.clip
          ? `<canvas id="clipCanvas"></canvas>
             <div class="clip-controls">
               <button id="clipPlay" class="icon-btn">❚❚</button>
               <input id="clipSlider" type="range" min="0" max="1000" value="0">
               <select id="clipRate"><option value="0.25">0.25×</option><option value="0.5" selected>0.5×</option><option value="1">1×</option></select>
             </div>
             <p class="muted small">8 s before to 5 s after the incident · numbers = km/h.</p>
             ${footageNote}
             <h3>Telemetry – speed</h3>
             <canvas id="traceCanvas" class="trace-canvas"></canvas>
             <p class="muted small">Thick = braking · dashed = the incident · white = replay position.</p>`
          : `<div class="clip-wait">Footage is being prepared…<br>(available 5 s of race time after the incident – un-pause the race)</div>`}
      </div>
      <div class="review-right">
        ${hearing}
        <h3>Report</h3>
        <p>${escapeHtml(inc.summary)}</p>
        <h3>Evidence</h3>
        <table class="evidence">${evidence || "<tr><td>–</td><td>No data</td></tr>"}</table>
        ${statements ? "<h3>Driver statements</h3>" + statements : ""}
        <h3>Driver history</h3>
        ${driverHistoryHtml(inc)}
      </div>
      <div class="review-right">
        <h3>Precedents</h3>
        ${precedentsHtml(inc)}
        ${st === "DECIDED" || st === "NFI" ? "" : "<h3>Co-stewards</h3>" + coStewardsHtml(inc)}
        <h3>Procedure</h3>
        ${procedure}
        <h3>Decision</h3>
        ${decision}
      </div>
    </div>`;
}

// things that may change while the review is open
function updateReviewLive() {
  const inc = reviewState.inc;
  const key = inc.status + "|" + !!inc.clip;
  if (key !== reviewState.built) {
    const keepT = reviewState.t;
    buildReview();
    reviewState.t = keepT;
  }
}

function animateClip(now, s) {
  if (reviewState !== s) return; // this review was closed
  const inc = s.inc;
  const dt = (now - s.lastFrame) / 1000;
  s.lastFrame = now;
  const canvas = $("clipCanvas");
  if (canvas && inc.clip && inc.clip.length > 1) {
    const start = inc.clip[0].t;
    const end = inc.clip[inc.clip.length - 1].t;
    if (s.t < start || s.t > end) s.t = start;
    if (s.playing) {
      s.t += dt * s.rate;
      if (s.t > end) s.t = start; // loop
    }
    drawClip(canvas, inc, s.t);
    const trace = $("traceCanvas");
    if (trace) drawSpeedTrace(trace, inc, s.t, start, end);
    const slider = $("clipSlider");
    if (slider && document.activeElement !== slider) slider.value = Math.round((s.t - start) / (end - start) * 1000);
  }
  requestAnimationFrame(next => animateClip(next, s));
}


// The speed of the involved cars over the footage (from the replay frames), with braking
// (falling speed) drawn thicker. The series are made once per clip.
// trace = { incT, start, end, max, series: [{ code, colour, pts: [[t, km/h] …] }] } – plain data,
// so it can be stored with a hearing of the championship (FIA desk) and drawn there too
function speedTraceSeries(inc) {
  if (inc.trace && inc.trace.n === inc.clip.length) return inc.trace;
  const series = inc.cars.map(id => ({ id, car: carById(id), pts: [] }));
  for (const f of inc.clip) {
    for (const sr of series) {
      const c = f.cars.find(x => x[0] === sr.id);
      if (c) sr.pts.push([Math.round(f.t * 10) / 10, Math.round((c[5] || 0) * 3.6)]);
    }
  }
  let max = 100;
  for (const sr of series) for (const p of sr.pts) if (p[1] > max) max = p[1];
  inc.trace = { n: inc.clip.length, incT: inc.t, start: inc.clip[0].t, end: inc.clip[inc.clip.length - 1].t, max: Math.ceil(max / 50) * 50,
    series: series.filter(sr => sr.car && sr.pts.length > 1).map(sr => ({ code: sr.car.code, colour: sr.car.colour, pts: sr.pts })) };
  return inc.trace;
}

function drawSpeedTrace(canvas, inc, t, start, end) {
  drawTraceData(canvas, speedTraceSeries(inc), t, start, end);
}

// t = the replay position (null = no marker)
function drawTraceData(canvas, tr, t, start, end) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const incT = tr.incT;
  const left = 34, right = 6, top = 6, bottom = 16;
  const x = tt => left + (tt - start) / Math.max(0.1, end - start) * (w - left - right);
  const y = v => top + (1 - v / tr.max) * (h - top - bottom);
  // grid and scale
  ctx.font = "500 9px Inter, Arial, sans-serif";
  ctx.fillStyle = "#7d869c";
  ctx.strokeStyle = "rgba(125,134,156,0.2)";
  ctx.lineWidth = 1;
  for (let v = 0; v <= tr.max; v += tr.max > 200 ? 100 : 50) {
    ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(w - right, y(v)); ctx.stroke();
    ctx.fillText(String(v), 4, y(v) + 3);
  }
  for (let s = Math.ceil(start - incT); s <= end - incT; s += 2) ctx.fillText((s > 0 ? "+" : "") + s + " s", x(incT + s) - 8, h - 4);
  // the moment of the incident
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = COLOURS.yellow;
  ctx.beginPath(); ctx.moveTo(x(incT), top); ctx.lineTo(x(incT), h - bottom); ctx.stroke();
  ctx.restore();
  // the cars
  tr.series.forEach((sr, k) => {
    // legend (top right): one code per car
    ctx.fillStyle = sr.colour;
    ctx.font = "700 10px Inter, Arial, sans-serif";
    ctx.fillText(sr.code, w - right - 32 * (tr.series.length - k), top + 9);
    ctx.strokeStyle = sr.colour;
    for (let i = 1; i < sr.pts.length; i++) {
      const a = sr.pts[i - 1], b = sr.pts[i];
      const braking = (a[1] - b[1]) / Math.max(0.05, b[0] - a[0]) > 25; // km/h per second
      ctx.lineWidth = braking ? 3.5 : 1.5;
      ctx.beginPath(); ctx.moveTo(x(a[0]), y(a[1])); ctx.lineTo(x(b[0]), y(b[1])); ctx.stroke();
    }
  });
  // the replay position
  if (t === null || t === undefined) return;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x(t), top); ctx.lineTo(x(t), h - bottom); ctx.stroke();
}


// =====================================================================
//  TRACK LIMITS REVIEW
//  The replay of the corner exit, the driver's strikes, what the lap was worth and
//  all reports of this corner – then: delete the lap time or no action.
// =====================================================================
let tlReview = null;

function openTrackLimitsReview(id) {
  const tl = race.trackLimits.find(x => x.id === id);
  if (!tl) return;
  reviewState = null;
  tlReview = { tl, t: tl.t - 5, playing: true, lastFrame: performance.now(), built: "", replay: { cars: [tl.carId], s: tl.s, t: tl.t, clip: null, view: null } };
  buildTrackLimitsReview();
  showModal();
  requestAnimationFrame(now => animateTlClip(now, tlReview));
}

// the lap and the timing sector of the corner, compared with the driver's other laps
function tlLapImpact(tl, car) {
  const r = race;
  const lap = car.lapTimes.find(l => l.lap === tl.lap);
  if (!lap) return { text: "The lap is still running – the lap time comes when the car crosses the line." };
  const others = car.lapTimes.filter(l => l !== lap && !l.pitLane && !l.neutral && l.lap > 1 && (l.valid || l.lap !== tl.lap)).slice(-6);
  const b = r.track.sectorBounds;
  const s = mod(tl.s, r.track.length);
  const k = s < b[0] ? 0 : s < b[1] ? 1 : 2;
  const key = ["s1", "s2", "s3"][k];
  const median = list => { const v = list.slice().sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const lapRef = median(others.map(l => l.time));
  const secRef = median(others.map(l => l[key]).filter(x => x > 0));
  return {
    lap: lap.time, lapRef, sector: k + 1, sec: lap[key], secRef,
    gained: secRef && lap[key] ? secRef - lap[key] : null
  };
}

function buildTrackLimitsReview() {
  const st = tlReview;
  const tl = st.tl;
  const r = race;
  const car = carById(tl.carId);
  const box = $("modalBox");
  box.className = "modal-box review-box tl-review";
  st.built = tl.status + "|" + !!tl.clip;
  st.replay.clip = tl.clip;
  st.replay.view = null;

  const bwAt = r.tlBwAt || 3;
  const penAt = r.tlPenaltyAt || 4;
  const strikes = car.tlStrikes;
  const next = strikes + 1;
  const nextText = r.session === "QUALI" ? "In qualifying the deleted lap is the penalty."
    : next === bwAt ? "Deleting this lap = strike " + next + ": the BLACK AND WHITE flag must be shown."
    : next === penAt || next === 2 * penAt ? "Deleting this lap = strike " + next + ": a time penalty (investigation) follows."
    : next < bwAt ? "Black & white flag after " + bwAt + " strikes, a penalty after " + penAt + "."
    : "Penalty after " + penAt + " (and " + 2 * penAt + ") strikes.";

  const imp = tlLapImpact(tl, car);
  const fmt = v => (v ? formatLapTime(v) : "–");
  const diff = (a, b) => (a && b ? (a - b >= 0 ? "+" : "−") + Math.abs(a - b).toFixed(3) + " s" : "");
  const impact = imp.text ? `<p class="muted small">${escapeHtml(imp.text)}</p>` : `
    <table class="evidence">
      <tr><td>Lap ${tl.lap}</td><td><b>${fmt(imp.lap)}</b> <span class="muted">${diff(imp.lap, imp.lapRef)} to the driver's usual lap</span></td></tr>
      <tr><td>Sector ${imp.sector} (this corner)</td><td><b>${imp.sec ? imp.sec.toFixed(3) + " s" : "–"}</b> <span class="muted">${diff(imp.sec, imp.secRef)} to the usual sector time</span></td></tr>
      <tr><td>Time gained</td><td>${imp.gained === null ? "–" : imp.gained > 0.05 ? `<b class="mark-bad">${imp.gained.toFixed(3)} s faster</b> than usual in this sector` : "no time gained in this sector"}</td></tr>
    </table>`;

  const atCorner = r.trackLimits.filter(x => x.corner === tl.corner);
  const deleted = atCorner.filter(x => x.status === "DELETED").length;
  const dismissed = atCorner.filter(x => x.status === "DISMISSED").length;
  const byCar = {};
  for (const x of atCorner) { const c = carById(x.carId); if (c) byCar[c.code] = (byCar[c.code] || 0) + 1; }
  const carsText = Object.keys(byCar).sort((a, b) => byCar[b] - byCar[a]).map(c => c + (byCar[c] > 1 ? " ×" + byCar[c] : "")).join(", ");
  const myLaps = r.trackLimits.filter(x => x.carId === car.id && x !== tl);

  const done = tl.status !== "NEW";
  box.innerHTML = `
    <div class="modal-head">
      <div>
        <span class="chip ${done ? "DECIDED" : "NEW"}">${done ? (tl.status === "DELETED" ? "LAP DELETED" : "NO ACTION") : "TRACK LIMITS"}</span>
        <h2>${escapeHtml(tl.corner)} – ${car.number} ${escapeHtml(car.code)}, lap ${tl.lap}</h2>
        <p class="muted">${dayTime(tl.t)} · ${escapeHtml(car.name)} (${escapeHtml(car.team)})</p>
      </div>
      <button class="close-btn" aria-label="Close" data-close="1">✕</button>
    </div>
    <div class="review-body">
      <div>
        ${tl.clip && tl.clip.length > 1
          ? `<canvas id="clipCanvas"></canvas>
             <div class="clip-controls"><button id="tlPlay" class="icon-btn">❚❚</button><input id="tlSlider" type="range" min="0" max="1000" value="0"></div>
             <p class="muted small">5 s before to 3 s after the corner exit · numbers = km/h.</p>`
          : `<div class="clip-wait">Footage is being prepared…<br>(available 3 s of race time after the report – un-pause the session)</div>`}
        <div class="result-box ${tl.violation ? "bad" : "good"}"><b>Distance beyond the white line:</b>
          ${tl.beyond !== undefined ? (tl.beyond > 0 ? tl.beyond.toFixed(1) + " m – all four wheels off the track" : "on the line (" + Math.abs(tl.beyond).toFixed(2) + " m of the tyre still on it)") : escapeHtml(tl.evidence)}</div>
      </div>
      <div class="review-right">
        <h3>Report</h3>
        <p>${escapeHtml(tl.evidence)}</p>
        <h3>Lap time</h3>
        ${impact}
        <h3>Driver's strikes</h3>
        <table class="evidence">
          <tr><td>Laps deleted</td><td><b>${strikes}</b>${myLaps.length ? ` <span class="muted">(${myLaps.slice(-4).map(x => x.corner + " L" + x.lap).join(", ")})</span>` : ""}</td></tr>
          <tr><td>Black &amp; white flag</td><td>${car.flag === "BW" || strikes >= bwAt ? "shown / due" : "not yet"}</td></tr>
          <tr><td>Next</td><td>${escapeHtml(nextText)}</td></tr>
        </table>
      </div>
      <div class="review-right">
        <h3>All reports at ${escapeHtml(tl.corner)}</h3>
        <table class="evidence">
          <tr><td>Reports</td><td><b>${atCorner.length}</b> · ${deleted} deleted · ${dismissed} no action · ${atCorner.length - deleted - dismissed} open</td></tr>
          <tr><td>Cars</td><td>${escapeHtml(carsText)}</td></tr>
        </table>
        <p class="muted small">Many reports at one corner: check the kerbs, or leave the corner out in the event notes next time.</p>
        <h3>Decision</h3>
        ${done ? `<div class="result-box">${tl.status === "DELETED" ? "Lap time deleted." : "No action."}</div>`
          : `<div class="btn-row"><button class="button-primary" data-tlr="delete">Delete lap time</button><button data-tlr="dismiss">No action</button></div>`}
      </div>
    </div>`;
}

function animateTlClip(now, st) {
  if (tlReview !== st) return; // closed
  const tl = st.tl;
  if (st.built !== tl.status + "|" + !!tl.clip) buildTrackLimitsReview();
  const dt = (now - st.lastFrame) / 1000;
  st.lastFrame = now;
  const canvas = $("clipCanvas");
  if (canvas && tl.clip && tl.clip.length > 1) {
    const start = tl.clip[0].t;
    const end = tl.clip[tl.clip.length - 1].t;
    if (st.t < start || st.t > end) st.t = start;
    if (st.playing) {
      st.t += dt * 0.5;
      if (st.t > end) st.t = start;
    }
    drawClip(canvas, st.replay, st.t);
    const slider = $("tlSlider");
    if (slider && document.activeElement !== slider) slider.value = Math.round((st.t - start) / (end - start) * 1000);
  }
  requestAnimationFrame(next => animateTlClip(next, st));
}


// =====================================================================
//  EVENT NOTES (before the session)
// =====================================================================
function openEventNotesDialog() {
  const r = race;
  // championship: the notes of the weekend were published before FP1 – shown read-only
  if (r.setup.seasonContext) {
    openNotesDialog({ track: r.track, gen2026: is2026(), race: true, quali: true, what: "weekend", readOnly: true,
      notes: Object.assign(defaultNotesFor(r.track, is2026()), r.eventNotes || {}) });
    return;
  }
  openNotesDialog({ track: r.track, gen2026: is2026(), race: r.session !== "QUALI", quali: r.session === "QUALI", what: r.session === "QUALI" ? "session" : "race",
    notes: Object.assign(defaultEventNotes(), r.eventNotes || {}), onPublish: n => publishEventNotes(n) });
}

// o = { track, gen2026, race, quali (which options), what ("race" | "session" | "weekend"),
//       notes, readOnly, onPublish(notes) -> error text or nothing }
function openNotesDialog(o) {
  const box = $("modalBox");
  const notes = o.notes;
  const dis = o.readOnly ? "disabled" : "";
  const corners = o.track.corners.map(c => `
    <label class="check corner-check"><input type="checkbox" data-corner="${c.number}" ${notes.corners.includes(c.number) ? "checked" : ""} ${dis}>
      ${c.trackLimits ? "<b>T" + c.number + " ★</b>" : "T" + c.number}</label>`).join("");
  const opts = (list, cur) => list.map(([v, t]) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${t}</option>`).join("");
  const zones = o.gen2026 ? o.track.straightZones || [] : o.track.drsZones;
  const zoneName = o.gen2026 ? "Straight Mode zone" : "DRS zone";
  const zoneChecks = zones.length ? zones.map((z, i) => `<label class="check"><input type="checkbox" data-zone="${i}" ${notes.zonesOff && notes.zonesOff[i] ? "" : "checked"} ${dis}> ${zoneName} ${i + 1} <span class="muted small">(${escapeHtml(locationName(o.track, z.start))})</span></label>`).join("")
    : `<p class="muted small">This circuit has no ${zoneName}s.</p>`;
  const intro = o.what === "weekend"
    ? (o.revise ? "Revised event notes: published as a new document, they apply from the next session on (the sessions already run keep their rules)."
      : o.readOnly ? "The rules of the whole weekend. Revise them on the FIA desk between the sessions."
      : "The Race Director's notes for the teams – published before FP1, they are the rules of the whole weekend (practice, qualifying, sprint and race).")
    : "The Race Director's notes for the teams – the rules of this " + o.what + ". Published before the start.";
  box.className = "modal-box notes-box";
  box.innerHTML = `
    <div class="modal-head">
      <div><h2>Event notes</h2><p class="muted">${intro}</p></div>
      <button class="close-btn" aria-label="Close" data-close="1">✕</button>
    </div>
    <div class="notes-grid">
      <section>
        <h3>Track limits monitored at</h3>
        <div class="corner-grid">${corners}</div>
        <p class="muted small">Only these corners give track limits reports. ★ = suggested: corners where cars often run wide.</p>
        ${o.race ? `<div class="notes-row">
          <label>Black &amp; white flag after<select id="notesBw" ${dis}>${opts([2, 3, 4, 5].map(v => [v, v + " deleted laps"]), notes.tlBwAt)}</select></label>
          <label>Penalty after<select id="notesPen" ${dis}>${opts([3, 4, 5, 6].map(v => [v, v + " deleted laps"]), notes.tlPenaltyAt)}</select></label>
        </div>` : ""}
        <h3>Pit lane</h3>
        <label>Speed limit<select id="notesPitLimit" ${dis}>${opts([[60, "60 km/h"], [80, "80 km/h"]], notes.pitKmh)}</select></label>
        <label class="check"><input type="checkbox" id="notesExitLine" ${notes.pitExitLine ? "checked" : ""} ${dis}> Crossing the pit exit line is investigated</label>
        ${o.race ? `<label class="check"><input type="checkbox" id="notesScPit" ${notes.scPitClosed ? "checked" : ""} ${dis}> Safety Car: pit entry closed until the field is behind the Safety Car</label>` : ""}
      </section>
      <section>
        <h3>${o.gen2026 ? "Straight Mode" : "DRS"} zones in use</h3>
        ${zoneChecks}
        ${o.race ? `<h3>Safety Car &amp; blue flags</h3>
          <label class="check"><input type="checkbox" id="notesLapped" ${notes.lappedAllowed ? "checked" : ""} ${dis}> Lapped cars may overtake under the SC (when you allow it)</label>
          <label>Blue flag when a faster car is within<select id="notesBlue" ${dis}>${opts([[1, "1.0 s"], [1.2, "1.2 s"], [1.5, "1.5 s"], [2, "2.0 s"]], notes.blueGap)}</select></label>` : ""}
        ${o.quali ? `<h3>${o.what === "weekend" ? "Practice &amp; qualifying" : "Out laps &amp; practice starts"}</h3>
          <label class="check"><input type="checkbox" id="notesMaxDelta" ${notes.maxDelta ? "checked" : ""} ${dis}> Maximum delta time on out laps and in laps</label>
          <label>Practice starts<select id="notesPractice" ${dis}>${opts([["PIT_EXIT", "only at the end of the pit exit"], ["AFTER_LIGHT", "after the pit exit light, right side"], ["NONE", "not allowed"]], notes.practiceStarts)}</select></label>` : ""}
        <h3>Technical delegate</h3>
        <label class="check"><input type="checkbox" id="notesTyres" ${notes.tyreChecks ? "checked" : ""} ${dis}> Minimum tyre pressures are checked</label>
        <label>Further notes (optional)
          <textarea id="notesText" rows="2" maxlength="400" placeholder="e.g. the exit kerb at T4 has been raised" ${dis}>${escapeHtml(notes.text || "")}</textarea>
        </label>
      </section>
    </div>
    <div class="btn-row notes-foot">${o.readOnly ? `<button class="button-primary" data-close="1">Close</button>` : `<button data-close="1">Cancel</button><button class="button-primary" id="notesPublish">${o.revise ? "Publish revised notes" : "Publish to all teams"}</button>`}</div>`;
  showModal();
  if (o.readOnly) return;
  const val = id => ($(id) ? $(id).value : undefined);
  const on = (id, fallback) => ($(id) ? $(id).checked : fallback);
  $("notesPublish").addEventListener("click", () => {
    const corners = Array.from(box.querySelectorAll("[data-corner]")).filter(x => x.checked).map(x => Number(x.dataset.corner));
    const zonesOff = zones.map((z, i) => { const c = box.querySelector(`[data-zone="${i}"]`); return c ? !c.checked : false; });
    const error = o.onPublish({
      corners, pitKmh: Number(val("notesPitLimit")), text: $("notesText").value.trim(),
      tlBwAt: val("notesBw") ? Number(val("notesBw")) : notes.tlBwAt, tlPenaltyAt: val("notesPen") ? Number(val("notesPen")) : notes.tlPenaltyAt,
      pitExitLine: on("notesExitLine", true), scPitClosed: on("notesScPit", notes.scPitClosed), zonesOff,
      lappedAllowed: on("notesLapped", notes.lappedAllowed), blueGap: val("notesBlue") ? Number(val("notesBlue")) : notes.blueGap,
      maxDelta: on("notesMaxDelta", notes.maxDelta), practiceStarts: val("notesPractice") || notes.practiceStarts, tyreChecks: on("notesTyres", false)
    });
    if (error) { showToast(error); return; }
    closeModal();
    if (race && !$("app").hidden) renderAll(true);
  });
}

// =====================================================================
//  OPEN AN INVESTIGATION YOURSELF
// =====================================================================
function openManualInvestigationDialog(carId) {
  const r = race;
  const box = $("modalBox");
  box.className = "modal-box narrow";
  const cars = r.order.filter(c => isRunning(c) || c.status === "RETIRED");
  const offences = ["Causing a collision", "Forcing another driver off the track", "Leaving the track and gaining an advantage",
    "Unsafe rejoin", "Erratic driving", "Impeding another driver", "Ignoring blue flags", "Overtaking under yellow flags",
    "Speeding in the pit lane", "Unsafe release", "Unsportsmanlike behaviour",
    "Failing to follow the Race Director's instructions", "Failing to follow the Race Director's instructions – maximum delta time"];
  box.innerHTML = `
    <div class="modal-head">
      <div><h2>Open an investigation</h2><p class="muted">For something you saw yourself on the map or in the timing.</p></div>
      <button class="close-btn" aria-label="Close" data-close="1">✕</button>
    </div>
    <label>Offence
      <select id="manualOffence">${offences.map(o => `<option>${o}</option>`).join("")}</select>
    </label>
    <p class="muted small">Cars involved:</p>
    <div class="check-list">
      ${cars.map(c => `<label><input type="checkbox" value="${c.id}" ${c.id === carId ? "checked" : ""}> ${c.number} ${c.code} – ${escapeHtml(c.name)}</label>`).join("")}
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button id="manualOpen" class="button-primary">Open investigation</button>
    </div>`;
  showModal();
  reviewState = null;

  $("manualOpen").addEventListener("click", () => {
    const ids = Array.from(box.querySelectorAll(".check-list input:checked")).map(i => Number(i.value));
    const error = openManualInvestigation(ids, $("manualOffence").value);
    if (error) {
      showToast(error);
      return;
    }
    closeModal();
    renderAll(true);
  });
}


// =====================================================================
//  RACE REPORT
// =====================================================================
// Buttons at the end of a report: a championship session is saved into the season
function reportButtons(label) {
  if (race.setup.seasonContext) {
    return `<div class="btn-row"><button class="button-primary" onclick="finishSeasonSession()">Save result &amp; back to the championship</button></div>`;
  }
  return `<div class="btn-row"><button onclick="location.reload()">${label}</button></div>`;
}

function openQualiReport() {
  const r = race;
  const box = $("modalBox");
  box.className = "modal-box";
  const rows = qualiResults();
  const evaluation = computeEvaluation();
  const pending = r.incidents.filter(i => !["DECIDED", "NFI"].includes(i.status));
  const hasReal = rows.some(row => row.realPos);

  let table = "";
  for (const row of rows) {
    const c = row.car;
    table += `<tr>
      <td class="pos">${row.position}</td>
      <td><span class="team-bar" style="background:${c.colour}"></span><span class="num">${c.number}</span><b>${c.code}</b></td>
      ${row.times.slice(0, qualiSegments()).map(t => `<td>${t ? formatLapTime(t) : "–"}</td>`).join("")}
      <td><b>${r.q.practice ? row.position : row.grid}</b>${row.penaltyText ? ` <span class="small mark-bad">${escapeHtml(row.penaltyText)}</span>` : ""}</td>
      ${hasReal ? `<td class="muted">${row.realPos ? "P" + row.realPos : "–"}</td>` : ""}
    </tr>`;
  }

  const items = evaluation.items.map(it => `
    <div class="eval-item">
      <div class="top"><span>${it.title}</span><span>${clamp(it.score, 0, 100)} / 100</span></div>
      <div class="bar"><div style="width:${clamp(it.score, 0, 100)}%;background:${it.score >= 75 ? "#2fd36b" : it.score >= 50 ? "#ffd60a" : "#ff3b30"}"></div></div>
      <ul>${it.notes.map(([kind, text]) => `<li class="${kind}">${escapeHtml(text)}</li>`).join("")}</ul>
    </div>`).join("");

  let realHtml = "";
  if (r.real && r.real.quali) {
    const reds = r.real.redFlags.map(f => segName(f.segment) + " at " + formatMinutes(f.at)).join(", ") || "none";
    realHtml = `<div class="eval-item"><div class="top"><span>Compared with the real session</span></div>
      <ul><li>Your red flags: ${r.evalData.redCount}</li><li>Real red flags: ${reds}</li>
      <li>${r.real.incidents.length} real incidents were injected into your session.</li></ul></div>`;
  }

  box.innerHTML = `
    <div class="modal-head">
      <div><h2>${r.q.practice ? "Practice" : "Qualifying"} report – ${escapeHtml(r.title)}</h2>
      <p class="muted">${r.finished ? "Final classification" : "Provisional classification (the session is still running)"}${r.q.practice ? " · best laps of the session" : " · starting grid including grid penalties"}</p></div>
      <button class="close-btn" aria-label="Close" data-close="1">✕</button>
    </div>
    ${pending.length ? `<div class="result-box bad" style="margin-bottom:12px">${pending.length} incident(s) still need a decision – grid penalties may still change.</div>` : ""}
    <div class="report-grid">
      <div>
        <table>
          <thead><tr><th>Pos</th><th>Driver</th>${r.q.practice ? "<th>Best</th>" : `<th>${segName(1)}</th><th>${segName(2)}</th><th>${segName(3)}</th>`}<th>${r.q.practice ? "Pos" : "Grid"}</th>${hasReal ? "<th>Real</th>" : ""}</tr></thead>
          <tbody>${table}</tbody>
        </table>
      </div>
      <div>
        <div class="eval-item"><div class="top"><span>Your rating as Race Director</span></div>
          <div class="score-big">${evaluation.overall}<span class="muted" style="font-size:18px"> / 100</span></div></div>
        ${items}
        ${realHtml}
        ${reportButtons("New session")}
      </div>
    </div>`;
  showModal();
}

function openReport() {
  const r = race;
  if (!r) return; // the control room was left before the report opened
  reviewState = null;
  if (r.session === "QUALI") {
    openQualiReport();
    return;
  }
  const box = $("modalBox");
  box.className = "modal-box";
  const results = computeResults();
  const evaluation = computeEvaluation();
  const pending = r.incidents.filter(i => !["DECIDED", "NFI"].includes(i.status));

  let table = "";
  for (const row of results) {
    const c = row.car;
    table += `<tr>
      <td class="pos">${row.position}</td>
      <td><span class="team-bar" style="background:${c.colour}"></span><span class="num">${c.number}</span><b>${c.code}</b> <span class="muted small">${escapeHtml(c.team)}</span></td>
      <td>${row.laps}</td>
      <td>${row.gapText}</td>
      <td>${row.penalty ? "+" + row.penalty + " s" : ""}</td>
      <td>${c.bestLap ? formatLapTime(c.bestLap.time) : "–"}</td>
    </tr>`;
  }

  const items = evaluation.items.map(it => `
    <div class="eval-item">
      <div class="top"><span>${it.title}</span><span>${clamp(it.score, 0, 100)} / 100</span></div>
      <div class="bar"><div style="width:${clamp(it.score, 0, 100)}%;background:${it.score >= 75 ? "#2fd36b" : it.score >= 50 ? "#ffd60a" : "#ff3b30"}"></div></div>
      <ul>${it.notes.map(([kind, text]) => `<li class="${kind}">${escapeHtml(text)}</li>`).join("")}</ul>
    </div>`).join("");

  let realHtml = "";
  if (r.real) {
    const yours = `SC ${r.evalData.scCount} · VSC ${r.evalData.vscCount} · Red ${r.evalData.redCount}`;
    const real = `SC ${r.real.scLaps.length}${r.real.scLaps.length ? " (lap " + r.real.scLaps.join(", ") + ")" : ""} · VSC ${r.real.vscLaps.length}${r.real.vscLaps.length ? " (lap " + r.real.vscLaps.join(", ") + ")" : ""} · Red ${r.real.redLaps.length}`;
    realHtml = `<div class="eval-item"><div class="top"><span>Compared with the real race</span></div>
      <ul><li>Your neutralisations: ${yours}</li><li>Real race (${r.real.realLaps} laps): ${real}</li>
      <li>${r.real.incidents.length} real incidents were injected into your race.</li></ul></div>`;
  }

  box.innerHTML = `
    <div class="modal-head">
      <div><h2>Race report – ${escapeHtml(r.title)}</h2>
      <p class="muted">${r.finished ? "Final classification" : "Provisional classification (the race is still running)"} · ${r.overtakes} overtakes · ${r.pitStops} pit stops</p></div>
      <button class="close-btn" aria-label="Close" data-close="1">✕</button>
    </div>
    ${pending.length ? `<div class="result-box bad" style="margin-bottom:12px">${pending.length} incident(s) still need a decision – the classification is provisional. Open them in the Incidents list.</div>` : ""}
    <div class="report-grid">
      <div>
        <table>
          <thead><tr><th>Pos</th><th>Driver</th><th>Laps</th><th>Time / gap</th><th>Pen.</th><th>Best</th></tr></thead>
          <tbody>${table}</tbody>
        </table>
        <p class="muted small">* = classified, completed 90% of the race distance. Time penalties are included.</p>
      </div>
      <div>
        <div class="eval-item"><div class="top"><span>Your rating as Race Director</span></div>
          <div class="score-big">${evaluation.overall}<span class="muted" style="font-size:18px"> / 100</span></div></div>
        ${items}
        ${realHtml}
        ${reportButtons("New race")}
      </div>
    </div>`;
  showModal();
}


// =====================================================================
//  MARSHAL SECTOR FLAGS: selection, pop-up on the map
// =====================================================================
function setSelectedSectors(list) {
  selectedSectors = list.slice();
  selectedSector = list.length ? list[0] : -1;
}

// the sectors from a to b along the lap (the shorter way round)
function sectorRange(a, b, M) {
  const forward = mod(b - a, M);
  const backward = mod(a - b, M);
  const out = [];
  if (forward <= backward) for (let k = 0; k <= forward; k++) out.push((a + k) % M);
  else for (let k = 0; k <= backward; k++) out.push((b + k) % M);
  return out;
}

function sectorsText(list) {
  if (!list.length) return "";
  if (list.length === 1) return "Sector " + (list[0] + 1);
  return "Sectors " + (list[0] + 1) + "–" + (list[list.length - 1] + 1);
}

// a flag for every selected sector ("YELLOW", "DOUBLE", "GREEN" or "SLIPPERY" = toggle)
function flagSelectedSectors(flag) {
  const list = selectedSectors.length ? selectedSectors : (selectedSector >= 0 ? [selectedSector] : []);
  // Rain without a selected sector: the whole track (off everywhere if it is shown somewhere)
  if (flag === "RAIN" && !list.length) {
    setRainAll(!anyRainShown());
    return null;
  }
  if (!list.length) return "Choose a sector on the map first (click or drag along the track).";
  if (flag === "SLIPPERY") {
    const on = !list.every(i => race.slippery[i]);
    for (const i of list) setSlippery(i, on);
    return null;
  }
  if (flag === "RAIN") {
    const on = !list.every(i => race.rainFlags && race.rainFlags[i]);
    publishRainSectors(list.filter(i => setRainFlag(i, on, "RC", true)), on); // one message for a dragged range
    return null;
  }
  let error = null;
  for (const i of list) error = setSectorFlag(i, flag) || error;
  return error;
}

// (the flag pop-up on the map was removed: a click / drag selects, the console sets the flag)
function closeFlagPopup() {
  const pop = document.getElementById("flagPop");
  if (pop) pop.remove();
}

// =====================================================================
//  KEYBOARD SHORTCUTS of the Race Director
//  A key presses the console button – the same rules (a disabled button can't be
//  used, the red flag asks first). Flags: the sector under the mouse, else the selection.
// =====================================================================
// The actions and their default keys: settings/controls.js (SHORTCUT_ACTIONS).
// Each user can change a key, remove it or give more actions a key (⌨ button) – stored in
// this browser ("rc.shortcuts": { actionId: key }). Esc always closes a pop-up.
const SHORTCUT_STORE = "rc.shortcuts";
let shortcutMap = null; // actionId -> key

function defaultShortcuts() {
  const map = {};
  for (const a of SHORTCUT_ACTIONS) if (a.key) map[a.id] = a.key;
  return map;
}

function shortcuts() {
  if (shortcutMap) return shortcutMap;
  shortcutMap = defaultShortcuts();
  try {
    const saved = JSON.parse(localStorage.getItem(SHORTCUT_STORE) || "null");
    if (saved && typeof saved === "object") {
      shortcutMap = {};
      for (const a of SHORTCUT_ACTIONS) if (saved[a.id]) shortcutMap[a.id] = saved[a.id];
    }
  } catch (e) { /* no storage: the defaults */ }
  return shortcutMap;
}

function saveShortcuts() {
  try { localStorage.setItem(SHORTCUT_STORE, JSON.stringify(shortcutMap)); } catch (e) { /* not stored – still works this session */ }
}

// the name of a pressed key, as used in the settings ("S", "1", "Space", "F2" …)
function keyName(event) {
  if (event.key === " ") return "Space";
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

function shortcutLabel(id) {
  const a = SHORTCUT_ACTIONS.find(x => x.id === id);
  return a ? a.label : id;
}

function pressConsoleButton(action, label) {
  const b = document.querySelector(`.console button[data-action="${action}"]`);
  if (!b || b.offsetParent === null) {
    showToast(label + ": not available in this session.");
    return;
  }
  if (b.disabled) {
    showToast(label + ": not possible right now.");
    return;
  }
  b.click();
}

// returns true when the key was a shortcut
function handleShortcut(event) {
  if (!race || $("app").hidden || confirmOpen || !$("modal").hidden || document.querySelector(".keys-overlay")) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const key = keyName(event);
  const map = shortcuts();
  const id = Object.keys(map).find(x => map[x] === key);
  if (!id) return false;
  runShortcut(id);
  return true;
}

function runShortcut(id) {
  const label = shortcutLabel(id);
  if (["YELLOW", "DOUBLE", "SLIPPERY", "GREEN", "RAIN"].includes(id)) {
    if (hoverSector >= 0) setSelectedSectors([hoverSector]);
    act(() => flagSelectedSectors(id));
  } else if (id === "end") {
    pressConsoleButton(race.status === "VSC" ? "endVsc" : "scIn", race.status === "VSC" ? "VSC ending" : "Safety Car in this lap");
  } else if (id === "pause") {
    setPaused(!paused);
  } else if (id.startsWith("speed")) {
    const b = document.querySelector(`[data-speed="${id.slice(5)}"]`);
    if (b) b.click();
  } else if (id === "faster" || id === "slower") {
    const list = Array.from(document.querySelectorAll("[data-speed]"));
    const i = list.findIndex(b => b.classList.contains("active"));
    const next = list[clamp(i + (id === "faster" ? 1 : -1), 0, list.length - 1)];
    if (next) next.click();
  } else if (id.startsWith("tab")) {
    const b = document.querySelector(`#sideTabs [data-tab="${id.slice(3).toLowerCase()}"]`);
    if (b) b.click();
  } else if (id === "report") {
    $("reportBtn").click();
  } else if (id === "help") {
    showShortcutHelp();
  } else {
    pressConsoleButton(id, label);
  }
}

// The list of shortcuts: change a key, remove it, give another action a key
function showShortcutHelp() {
  const old = document.querySelector(".keys-overlay");
  if (old) {
    old.remove();
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal confirm-overlay keys-overlay";
  let waitingFor = null; // action id that waits for its new key
  const render = () => {
    const map = shortcuts();
    const used = SHORTCUT_ACTIONS.filter(a => map[a.id]);
    const free = SHORTCUT_ACTIONS.filter(a => !map[a.id]);
    overlay.innerHTML = `
      <div class="modal-box confirm-box keys-box" role="dialog" aria-modal="true">
        <h2>Keyboard shortcuts</h2>
        <div class="keys-scroll"><table class="keys-table">${used.map(a => `
          <tr><td><kbd>${waitingFor === a.id ? "press a key…" : escapeHtml(map[a.id])}</kbd></td><td>${escapeHtml(a.label)}</td>
            <td class="row-actions"><button class="small-btn" data-key-change="${a.id}">Change</button><button class="small-btn" data-key-remove="${a.id}" title="Remove this shortcut">✕</button></td></tr>`).join("")}
          ${waitingFor && !map[waitingFor] ? `<tr><td><kbd>press a key…</kbd></td><td>${escapeHtml(shortcutLabel(waitingFor))}</td><td></td></tr>` : ""}
        </table></div>
        ${free.length ? `<div class="keys-add"><select id="keyAddAction">${free.map(a => `<option value="${a.id}">${escapeHtml(a.label)}</option>`).join("")}</select>
          <button data-key-add="1">Add shortcut</button></div>` : ""}
        <p class="muted small">Esc always closes a pop-up. Shortcuts do nothing while you type a message, and a button that is greyed out in the console can't be used by its key either. The keys are stored in this browser.</p>
        <div class="btn-row confirm-buttons"><button data-key-reset="1">Reset to defaults</button><button class="button-primary" data-keys-close="1">Close</button></div>
      </div>`;
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = e => {
    if (waitingFor) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        waitingFor = null;
        render();
        return;
      }
      if (["Shift", "Control", "Alt", "Meta", "Tab", "Enter"].includes(e.key)) return;
      const key = keyName(e);
      const map = shortcuts();
      const other = Object.keys(map).find(x => map[x] === key && x !== waitingFor);
      if (other) {
        delete map[other]; // one key, one action: the old action loses it
        showToast("“" + key + "” was used for “" + shortcutLabel(other) + "” – that shortcut was removed.");
      }
      map[waitingFor] = key;
      waitingFor = null;
      saveShortcuts();
      render();
      return;
    }
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  overlay.addEventListener("click", e => {
    const t = e.target;
    if (t === overlay || t.closest("[data-keys-close]")) { close(); return; }
    const b = t.closest("button");
    if (!b) return;
    if (b.dataset.keyChange) waitingFor = b.dataset.keyChange;
    else if (b.dataset.keyRemove) { delete shortcuts()[b.dataset.keyRemove]; saveShortcuts(); }
    else if (b.dataset.keyAdd) waitingFor = $("keyAddAction").value;
    else if (b.dataset.keyReset) { shortcutMap = defaultShortcuts(); saveShortcuts(); waitingFor = null; }
    render();
  });
  document.addEventListener("keydown", onKey, true);
  render();
  document.body.appendChild(overlay);
  const closeBtn = overlay.querySelector("[data-keys-close]");
  if (closeBtn) closeBtn.focus();
}

// =====================================================================
//  WIRING: all clicks of the control room
// =====================================================================
function wireUi() {
  const canvas = $("map");

  // ----- the map: click a car = select it; click a sector = flag pop-up;
  //       drag along the track = several sectors at once (pointer events: mouse and touch) -----
  let press = null; // { x, y, sector, car, dragging }
  const at = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  canvas.addEventListener("pointerdown", event => {
    if (!race) return;
    const p = at(event);
    press = { x: p.x, y: p.y, sector: sectorAtPixel(p.x, p.y), car: carAtPixel(p.x, p.y), dragging: false };
    if (press.sector >= 0 && press.car === null) canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!race) return;
    const p = at(event);
    if (press && press.sector >= 0 && press.car === null) {
      if (!press.dragging && Math.hypot(p.x - press.x, p.y - press.y) > 8) {
        press.dragging = true;
        closeFlagPopup();
      }
      if (press.dragging) {
        const sector = sectorAtPixel(p.x, p.y);
        if (sector >= 0) setSelectedSectors(sectorRange(press.sector, sector, race.track.marshalSectors));
      }
      return;
    }
    const car = carAtPixel(p.x, p.y);
    hoverSector = car === null ? sectorAtPixel(p.x, p.y) : -1;
    canvas.style.cursor = car !== null || hoverSector >= 0 ? "pointer" : "default";
  });
  canvas.addEventListener("pointerup", () => {
    if (!race || !press) return;
    const pressed = press;
    press = null;
    // a click selects a sector, a drag a range of sectors – the flags are set with the
    // buttons of the MARSHAL SECTOR box in the console (or the keys 1–4)
    if (pressed.dragging) {
      // the range is selected already
    } else if (pressed.car !== null) {
      selectedCar = pressed.car;
    } else if (pressed.sector >= 0) {
      const same = selectedSectors.length === 1 && selectedSectors[0] === pressed.sector;
      setSelectedSectors(same ? [] : [pressed.sector]); // a second click on the same sector unselects it
    } else {
      setSelectedSectors([]);
    }
    renderAll(true);
  });
  canvas.addEventListener("pointercancel", () => { press = null; });
  canvas.addEventListener("pointerleave", () => { if (!press) hoverSector = -1; });

  // ----- timing list (mousedown, because the list is rebuilt often) -----
  $("tower").addEventListener("mousedown", event => {
    const row = event.target.closest("tr[data-id]");
    if (row) {
      selectedCar = Number(row.dataset.id);
      renderAll(true);
    }
  });

  $("gapMode").addEventListener("click", event => {
    const b = event.target.closest("button");
    if (!b) return;
    gapMode = b.dataset.mode;
    $("gapMode").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
  });

  // ----- selected car: flags and investigation -----
  $("carPanel").addEventListener("click", event => {
    const car = carById(selectedCar);
    if (!car) return;
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.closeCar) {
      selectedCar = null;
      renderAll(true);
      return;
    }
    if (b.dataset.flag) {
      const flag = b.dataset.flag;
      if (flag === "BLACK") {
        confirmedAction("Disqualify " + car.name + " with the black flag?", { title: "Black flag", ok: "Disqualify", danger: true }, () => showCarFlag(car, flag))();
        return;
      }
      act(() => showCarFlag(car, flag));
    }
    if (b.dataset.investigate) openManualInvestigationDialog(car.id);
  });

  // ----- console -----
  const actions = {
    segment: startQualifyingSegment,
    maxDelta: () => setMaxDelta(!race.q.maxDelta),
    formation: startFormationLap,
    sequence: startSequence,
    abort: abortStart,
    startSC: startBehindSafetyCar,
    vsc: deployVSC,
    endVsc: endVSC,
    sc: deploySafetyCar,
    lapped: lappedCarsMayOvertake,
    scIn: safetyCarInThisLap,
    scStanding: confirmedAction("The Safety Car comes in at the end of this lap. The cars line up on the grid in race order (lapped cars at the back) and the race restarts with the start lights.",
      { title: "Standing start after the Safety Car", ok: "SC in – standing start" }, safetyCarInStandingStart),
    red: confirmedAction(() => "Show the red flag and suspend the " + (race.session === "QUALI" ? "session" : "race") + "? All cars return slowly to the pit lane.",
      { title: "Red flag", ok: "Red flag", danger: true }, redFlag),
    resumeStanding: () => resumeRace("STANDING"),
    resumeRolling: () => resumeRace("ROLLING"),
    delayStart: delayStart,
    eventNotes: openEventNotesDialog,
    skip: () => skipTime(5),
    abandon: confirmedAction(() => race.setup.practice ? "The session ends now – the times set so far stand."
      : "The " + (race.session === "QUALI" ? "session" : "race") + " will not be resumed – the classification is taken by count-back and fewer (or no) points are awarded.",
      { title: "Abandon session", ok: "Abandon", danger: true }, () => abandonSession("Race Director")),
    shorten: confirmedAction("Show the chequered flag at the end of this lap?", { title: "Chequered flag", ok: "Chequered flag" }, shortenRace),
    // the marshal buttons work on every selected sector (click or drag on the map)
    yellow: () => flagSelectedSectors("YELLOW"),
    double: () => flagSelectedSectors("DOUBLE"),
    slippery: () => flagSelectedSectors("SLIPPERY"),
    rain: () => flagSelectedSectors("RAIN"),
    clear: () => flagSelectedSectors("GREEN"),
    clearAll: clearAllSectors,
    pitEntry: () => setPitEntry(!race.pitEntryOpen),
    pitExit: () => setPitExit(!race.pitExitOpen),
    drs: () => setDRS(!race.drsEnabled),
    straight: () => setStraightMode(!race.straightEnabled),
    straightZone: () => {
      const zi = straightZoneInSector(selectedSector);
      return setStraightZone(zi, zi >= 0 && race.straightOff[zi]);
    },
    wet: declareWetRace
  };
  document.querySelector(".console").addEventListener("click", event => {
    const b = event.target.closest("button[data-action]");
    if (b && actions[b.dataset.action]) act(actions[b.dataset.action]);
  });
  $("autoYellow").addEventListener("change", e => { race.autoMarshalYellow = e.target.checked; });
  $("autoRain").addEventListener("change", e => { race.autoMarshalRain = e.target.checked; });
  $("autoSlow").addEventListener("change", e => { race.autoSlow = e.target.checked; });
  $("showBlue").addEventListener("change", () => renderMessages());
  $("messageForm").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("messageInput");
    act(() => sendCustomMessage(input.value));
    input.value = "";
  });

  // ----- side tabs -----
  $("sideTabs").addEventListener("click", event => {
    const b = event.target.closest("button");
    if (!b) return;
    $("sideTabs").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
    $("tabIncidents").hidden = b.dataset.tab !== "incidents";
    $("tabLimits").hidden = b.dataset.tab !== "limits";
    $("tabPenalties").hidden = b.dataset.tab !== "penalties";
    $("tabRadio").hidden = b.dataset.tab !== "radio";
  });

  $("tabRadio").addEventListener("click", event => {
    const b = event.target.closest("[data-radio]");
    if (!b) return;
    const [id, answer] = b.dataset.radio.split(":");
    const res = answerRadio(Number(id), answer);
    if (typeof res === "string") showToast(res);
    else if (res && res.openIncident) openReview(res.openIncident); // the stewards look at it now
    renderAll(true);
  });

  $("tabIncidents").addEventListener("click", event => {
    const card = event.target.closest("[data-inc]");
    if (card) openReview(Number(card.dataset.inc));
  });

  $("tabLimits").addEventListener("click", event => {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.tlReview) {
      openTrackLimitsReview(Number(b.dataset.tlReview));
      return;
    }
    const id = Number(b.dataset.tlDelete || b.dataset.tlDismiss);
    const item = race.trackLimits.find(t => t.id === id);
    if (!item) return;
    if (b.dataset.tlDelete) act(() => deleteLapTime(item));
    else act(() => dismissTrackLimits(item));
  });

  $("trackJobs").addEventListener("click", event => {
    const b = event.target.closest("[data-send-recovery]");
    if (b) {
      act(() => sendRecovery(Number(b.dataset.sendRecovery)));
      return;
    }
    const li = event.target.closest("[data-job-sector]");
    if (li) {
      setSelectedSectors([Number(li.dataset.jobSector) - 1]); // select the sector on the map (for the flags)
      renderAll(true);
    }
  });
  $("autoRecovery").addEventListener("change", e => { race.autoRecovery = e.target.checked; });
  $("alerts").addEventListener("click", event => {
    const li = event.target.closest("[data-alert]");
    if (!li) return;
    const alert = race.alerts.find(a => a.id === Number(li.dataset.alert));
    if (!alert) return;
    if (alert.carId != null) selectedCar = alert.carId;
    if (alert.sector != null) setSelectedSectors([alert.sector - 1]);
    else if (alert.s != null) setSelectedSectors([marshalSectorAt(race.track, alert.s) - 1]);
    renderAll(true);
  });

  // ----- pop-up window -----
  $("modal").addEventListener("click", event => {
    if (event.target === $("modal") || event.target.closest("[data-close]")) {
      closeModal();
      return;
    }
    if (tlReview) {
      const tb = event.target.closest("button");
      if (!tb) return;
      if (tb.id === "tlPlay") {
        tlReview.playing = !tlReview.playing;
        tb.textContent = tlReview.playing ? "❚❚" : "▶";
      } else if (tb.dataset.tlr) {
        const item = tlReview.tl;
        act(() => (tb.dataset.tlr === "delete" ? deleteLapTime(item) : dismissTrackLimits(item)));
        buildTrackLimitsReview();
      }
      return;
    }
    if (!reviewState) return;
    const inc = reviewState.inc;
    const b = event.target.closest("button");
    if (b && b.dataset.doc) {
      if (b.dataset.doc === "print") printDecision(inc);
      else {
        reviewState.showDoc = b.dataset.doc === "show";
        buildReview(); // (the replay loop keeps running and draws again as soon as the canvas is back)
      }
      return;
    }
    if (b && b.dataset.proc) {
      const fn = { note: noteIncident, investigate: investigateIncident, after: investigateAfterRace, nfi: noInvestigation }[b.dataset.proc];
      const error = fn(inc);
      if (error) showToast(error);
      buildReview();
      renderAll(true);
    }
    if (b && b.dataset.prec) {
      const p = precedentPenalty(inc);
      const box = $("modalBox");
      if (p) {
        box.querySelector(`[data-pen="${b.dataset.prec}"]`).value = p.code;
        box.querySelector(`[data-pts="${b.dataset.prec}"]`).value = String(p.points);
        showToast("Precedent applied: " + PENALTIES[p.code].label + (p.points ? " + " + p.points + " pt" : "") + " (" + p.where + ").");
      }
      return;
    }
    if (b && b.id === "decideBtn") {
      const perCar = {};
      for (const id of inc.cars) {
        perCar[id] = {
          code: $("modalBox").querySelector(`[data-pen="${id}"]`).value,
          points: Number($("modalBox").querySelector(`[data-pts="${id}"]`).value)
        };
      }
      const error = decideIncident(inc, perCar);
      if (error) showToast(error);
      buildReview();
      renderAll(true);
    }
    if (b && b.id === "clipPlay") {
      reviewState.playing = !reviewState.playing;
      b.textContent = reviewState.playing ? "❚❚" : "▶";
    }
  });
  $("modal").addEventListener("input", event => {
    if (tlReview && event.target.id === "tlSlider" && tlReview.tl.clip) {
      const c = tlReview.tl.clip;
      tlReview.t = c[0].t + (c[c.length - 1].t - c[0].t) * event.target.value / 1000;
      return;
    }
    if (!reviewState) return;
    const inc = reviewState.inc;
    if (event.target.id === "clipSlider" && inc.clip) {
      const start = inc.clip[0].t;
      const end = inc.clip[inc.clip.length - 1].t;
      reviewState.t = start + (end - start) * event.target.value / 1000;
    }
    if (event.target.id === "clipRate") reviewState.rate = Number(event.target.value);
  });

  $("reportBtn").addEventListener("click", openReport);
  window.addEventListener("resize", () => { mainView = null; });
}
