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

// Run a Race Director command and show its error (if any)
function act(fn) {
  const error = fn();
  if (error) showToast(error);
  renderAll(true);
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
  if (force || r.ver !== shownVersion) {
    shownVersion = r.ver;
    renderIncidents();
    renderTrackLimits();
    renderPenalties();
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

// Championship weather: local rain, wind, lightning and the forecast for the next hour
let forecastCache = { at: -999, text: "" };
function cellWeatherHtml(r) {
  const w = r.weather;
  let html = w.rainMax > 0.05
    ? `<span>🌧 <b>Rain ${Math.round(w.rainMax * 100)}%</b>${w.rain < w.rainMax * 0.6 ? " <small>(local)</small>" : ""}</span>`
    : `<span>${w.trackTemp > 30 && w.air > 22 ? "☀" : "⛅"} <b>Dry</b></span>`;
  const wetText = w.wetMax < 0.05 ? "dry" : Math.round(Math.min(...w.wetS) * 100) === Math.round(w.wetMax * 100)
    ? Math.round(w.wet * 100) + "% wet" : Math.round(Math.min(...w.wetS) * 100) + "–" + Math.round(w.wetMax * 100) + "% wet";
  html += `<span>Track <b>${wetText}</b></span>`;
  html += `<span>Air <b>${w.air}°</b> Track <b>${w.trackTemp}°</b></span>`;
  html += `<span>Wind <b>${Math.round(w.wind * 3.6)}</b>${w.gust > w.wind * 1.3 ? "–" + Math.round(w.gust * 3.6) : ""} km/h</span>`;
  if (w.lightningKm < 25) html += `<span class="${w.lightningKm < LIGHTNING_KM ? "mark-bad" : ""}">⚡ <b>${w.lightningKm.toFixed(0)} km</b></span>`;
  if (r.time - forecastCache.at > 10 || forecastCache.race !== r) {
    const W = r.setup.weather.weekend;
    const now = r.setup.weather.offset + r.time;
    let text = "";
    for (let m = 10; m <= 60; m += 10) {
      const f = weatherForecast(W, now, now + m * 60);
      if (w.rainMax < 0.05 && f.rain >= 40) {
        text = `${f.intensity || "light"} rain in ~${m} min (${f.rain}%)`;
        break;
      }
      if (w.rainMax >= 0.05 && f.rain <= 20) {
        text = `dry again in ~${m} min`;
        break;
      }
    }
    forecastCache = { at: r.time, race: r, text: text || (w.rainMax < 0.05 ? "no rain in the next hour" : "rain for the next hour") };
  }
  html += `<span class="muted" title="Forecast of the weather service">↗ ${forecastCache.text}</span>`;
  return html;
}

function renderTop() {
  const r = race;
  if (r.session === "QUALI") {
    const q = r.q;
    $("lapCounter").textContent = q.segment === 0 ? segName(1) : segName();
    $("raceClock").textContent = q.state === "WAITING" ? formatMinutes(q.durations[0]) :
      q.state === "BREAK" ? formatMinutes(q.durations[q.segment]) : formatMinutes(q.remaining);
  } else {
    $("lapCounter").textContent = r.raceStart === null ? "LAP 0 / " + r.totalLaps : "LAP " + r.leaderLap + " / " + r.totalLaps;
    $("raceClock").textContent = r.raceStart === null ? "PRE-RACE" : formatClock(r.time - r.raceStart);
  }
  $("dayClock").textContent = dayTime(r.time);

  const [text, css] = trackStatusText();
  const pill = $("statusPill");
  pill.textContent = text;
  pill.className = "pill " + css;

  const w = r.weather;
  if (isCellWeather(r)) {
    $("weatherBox").innerHTML = cellWeatherHtml(r);
    return;
  }
  let html = w.rain > 0.05
    ? `<span>🌧 <b>Rain ${Math.round(w.rain * 100)}%</b></span>`
    : `<span>☀ <b>Dry</b></span>`;
  html += `<span>Track <b>${w.wet < 0.05 ? "dry" : Math.round(w.wet * 100) + "% wet"}</b></span>`;
  html += `<span>Air <b>${w.air}°</b> Track <b>${Math.round(w.trackTemp - w.wet * 10)}°</b></span>`;
  $("weatherBox").innerHTML = html;
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

function stewardMarks(car) {
  const r = race;
  let html = "";
  const investigated = r.incidents.filter(i => (i.status === "INVESTIGATING" || i.status === "AFTER_RACE") && i.cars.includes(car.id));
  if (investigated.length > 0) {
    const what = investigated.map(i => i.offence).join(" / ");
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

  let html = "";
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
    html += `
      <tr data-id="${car.id}" class="${classes.join(" ")}">
        <td class="pos">${car.dsq ? "–" : i + 1}</td>
        <td><span class="team-bar" style="background:${car.colour}"></span><span class="num">${car.number}</span><b>${car.code}</b>${stewardMarks(car)}</td>
        <td>${best ? formatLapTime(best.time) : "–"}</td>
        <td>${gap}</td>
        <td>${lastText}</td>
        <td>${tyreBadge(car.tyre.compound, car.tyre.age)}</td>
        <td>${qualiTags(car)}</td>
      </tr>`;
  });
  $("tower").querySelector("tbody").innerHTML = html;
}

function renderTower() {
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

  let html = "";
  order.forEach((car, i) => {
    let gap = "";
    if (r.raceStart === null) gap = "Grid " + (car.slot + 1);
    else if (car.dsq) gap = "DSQ";
    else if (car.status === "RETIRED") gap = "DNF L" + car.laps;
    else if (i === 0) gap = car.finished ? "Winner" : "Leader";
    else if (car.finished && leader.finished && car.laps === leader.laps) {
      gap = "+" + (gapMode === "leader" ? car.finishTime - leader.finishTime : car.finishTime - order[i - 1].finishTime).toFixed(3);
    } else {
      gap = formatGapValue(gapBetween(car, gapMode === "leader" ? leader : order[i - 1]));
    }

    const last = car.lastLap;
    let lastText = "–";
    if (last) {
      const css = !last.valid ? "deleted" : fastest && last === fastest ? "purple" : "";
      lastText = `<span class="${css}">${formatLapTime(last.time)}</span>`;
    }

    const out = car.status === "RETIRED" || car.dsq;
    html += `
      <tr data-id="${car.id}" class="${car.id === selectedCar ? "selected" : ""} ${out ? "out" : ""}">
        <td class="pos">${out ? "–" : i + 1}</td>
        <td><span class="team-bar" style="background:${car.colour}"></span><span class="num">${car.number}</span><b>${car.code}</b>${stewardMarks(car)}</td>
        <td>${gap}</td>
        <td>${lastText}</td>
        <td>${tyreBadge(car.tyre.compound, car.tyre.age)}</td>
        <td>${car.pit.stops}</td>
        <td>${carTags(car)}</td>
      </tr>`;
  });
  $("tower").querySelector("tbody").innerHTML = html;
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
        <button data-flag="BW" title="Warning for track limits or unsportsmanlike behaviour">Black &amp; white flag</button>
        <button data-flag="BO" title="Car has damage and must pit for repairs">Black &amp; orange flag</button>
        <button data-flag="BLACK" class="danger-btn" title="Disqualification">Black flag</button>
        <button data-investigate="1">Open investigation…</button>
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
    const phaseText = { GARAGE: "In the garage", OUT: "Out lap", PUSH: car.q.aborted ? "Push lap aborted" : "Push lap", COOL: "In lap" };
    const segBest = seg => {
      const lap = bestLapInSegment(car, seg);
      return lap ? formatLapTime(lap.time) : "–";
    };
    let qualiState = car.dsq ? "Disqualified" : car.q.eliminated ? "Knocked out in " + segName(car.q.eliminated)
      : car.status === "RETIRED" ? "Stopped – " + car.retireReason : (phaseText[car.q.phase] || state);
    if (car.pit.state && car.mode !== "GARAGE") qualiState = "In the pit lane";
    stats.innerHTML =
      statBox("Position", "P" + pos) +
      statBox("Speed", Math.round(car.speed * 3.6) + " km/h") +
      statBox("Laps", car.laps) +
      statBox(segName(1) + " best", segBest(1)) +
      statBox(segName(2) + " best", segBest(2)) +
      statBox(segName(3) + " best", segBest(3)) +
      statBox("Last lap", car.lastLap ? `<span class="${car.lastLap.valid ? "" : "deleted"}">${formatLapTime(car.lastLap.time)}</span>` : "–") +
      statBox("Tyre", tyreBadge(car.tyre.compound) + " " + car.tyre.age + " laps") +
      statBox("Runs left", car.q.runs ? car.q.runs.length : 0) +
      statBox("Damage", damage.length ? damage.join(", ") : "none") +
      statBox("Laps deleted", car.tlStrikes) +
      statBox("Grid penalty", car.pen.grid ? car.pen.grid + " places" : car.pen.back ? "back of grid" : "none") +
      statBox("Pen. points", car.pen.points + " <small class='muted'>W" + car.pen.warnings + " R" + car.pen.reprimands + "</small>") +
      statBox("Status", qualiState);
  } else if (stats) {
    stats.innerHTML =
      statBox("Position", r.raceStart === null ? "Grid " + (car.slot + 1) : (car.status === "RETIRED" ? "–" : "P" + pos) + " <small class='muted'>grid " + car.grid + "</small>") +
      statBox("Gap leader", car === leader ? "–" : formatGapValue(gapBetween(car, leader))) +
      statBox("Speed", Math.round(car.speed * 3.6) + " km/h") +
      statBox("Laps", car.laps) +
      statBox("Last lap", car.lastLap ? `<span class="${car.lastLap.valid ? "" : "deleted"}">${formatLapTime(car.lastLap.time)}</span>` : "–") +
      statBox("Best lap", car.bestLap ? formatLapTime(car.bestLap.time) : "–") +
      statBox("Tyre", tyreBadge(car.tyre.compound) + " " + car.tyre.age + " laps") +
      statBox("Tyre wear", Math.round(car.tyre.wear * 100) + "%") +
      statBox("Fuel", Math.round(car.fuel) + " kg") +
      (car.ers ? statBox("Battery", batteryText(car)) : "") +
      statBox("Damage", damage.length ? damage.join(", ") : "none") +
      statBox("Pit stops", car.pit.stops) +
      statBox("Track limits", car.tlStrikes + " deleted") +
      statBox("Penalties", penalties.length ? penalties.join(", ") : "none") +
      statBox("Pen. points", car.pen.points + " <small class='muted'>W" + car.pen.warnings + " R" + car.pen.reprimands + "</small>") +
      statBox("Status", state);
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
    skip: canSkipTime(),
    abandon: !r.finished && (r.phase !== "RACE" || r.status === "RED" || r.status === "SC" || r.status === "VSC"),
    vsc: racing && (st === "GREEN"),
    endVsc: st === "VSC",
    sc: racing && (st === "GREEN" || st === "VSC" || st === "VSC_ENDING"),
    lapped: st === "SC" && !!r.sc && !r.lappedMayOvertake,
    scIn: st === "SC" && !!r.sc,
    red: racing && st !== "RED",
    resumeStanding: st === "RED",
    resumeRolling: st === "RED",
    shorten: racing,
    yellow: selectedSector >= 0,
    double: selectedSector >= 0,
    slippery: selectedSector >= 0,
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
    slippery: selectedSector >= 0 && r.slippery[selectedSector]
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
    clear: selectedSector >= 0,
    clearAll: r.sectorFlags.some(f => f !== "GREEN"),
    pitEntry: true,
    pitExit: st !== "RED",
    drs: !is2026(),
    straight: is2026(),
    straightZone: straightZoneInSector(selectedSector) >= 0,
    wet: !r.wetDeclared,
    maxDelta: q.state !== "DONE"
  };
  const active = {
    red: st === "RED",
    yellow: selectedSector >= 0 && r.sectorFlags[selectedSector] === "YELLOW",
    double: selectedSector >= 0 && r.sectorFlags[selectedSector] === "DOUBLE",
    slippery: selectedSector >= 0 && r.slippery[selectedSector]
  };
  const next = q.state === "BREAK" ? q.segment + 1 : Math.max(1, q.segment);
  $("segmentBtn").textContent = q.state === "DONE" ? "Session finished" :
    can.segment ? "Start " + segName(next) + " (green light)" : segName() + " running";
  $("resumeBtn").textContent = "Resume session";
  const delta = $("maxDeltaBtn");
  delta.textContent = "Max delta time: " + (q.maxDelta ? "in force" : "OFF");
  delta.dataset.on = q.maxDelta ? "1" : "0";
  applyConsoleState(can, active);
}

function applyConsoleState(can, active) {
  const r = race;
  document.querySelectorAll(".console button[data-action]").forEach(button => {
    const a = button.dataset.action;
    button.disabled = !can[a];
    button.classList.toggle("active-state", !!active[a]);
  });

  const entry = $("pitEntryBtn");
  entry.textContent = "Pit entry: " + (r.pitEntryOpen ? "open" : "CLOSED");
  entry.className = r.pitEntryOpen ? "on" : "off";
  const exit = $("pitExitBtn");
  exit.textContent = "Pit exit: " + (r.pitExitOpen ? "green light" : "RED LIGHT");
  exit.className = r.pitExitOpen ? "on" : "off";
  const drs = $("drsBtn");
  drs.textContent = aidName() + ": " + (is2026() && r.session === "QUALI" ? "race only" : r.drsEnabled ? "ENABLED" : "disabled");
  drs.className = r.drsEnabled ? "on" : "";
  if (is2026()) {
    const straight = $("straightBtn");
    straight.textContent = "Straight Mode: " + (r.straightEnabled ? "active" : "DISABLED");
    straight.className = "gen2026-only " + (r.straightEnabled ? "on" : "off");
    const zi = straightZoneInSector(selectedSector);
    const zoneBtn = $("straightZoneBtn");
    zoneBtn.textContent = zi >= 0 ? "Straight zone " + (zi + 1) + ": " + (r.straightOff[zi] ? "OFF" : "on") : "Straight zone: select a sector";
    zoneBtn.className = "gen2026-only " + (zi >= 0 && r.straightOff[zi] ? "off" : "");
  }

  $("selSectorLabel").textContent = selectedSector >= 0
    ? (selectedSector + 1) + " · " + locationName(r.track, (selectedSector + 0.5) * r.track.msLen) + " · " +
      ({ GREEN: "green", YELLOW: "yellow", DOUBLE: "double yellow" })[r.sectorFlags[selectedSector]]
    : "– click the map";
}

function renderLights() {
  const r = race;
  const box = $("lights");
  const lamps = box.querySelectorAll("span");
  const st = r.lights.state;
  box.hidden = !(r.phase === "START_SEQ" || r.phase === "GRID_READY" || r.phase === "FORMATION" || st === "ABORT" ||
                 (st === "OUT" && r.time - r.lastStart < 3));
  lamps.forEach((lamp, i) => {
    lamp.className = "";
    if (r.phase === "START_SEQ" && i < r.lights.count) lamp.className = "on-red";
    if (r.phase === "FORMATION") lamp.className = "on-green";
    if (st === "ABORT" && r.phase === "PRE") lamp.className = "on-orange";
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
  $("cntInc").textContent = open || "";

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
  $("tabIncidents").innerHTML = html || "<p class='muted small'>No incidents yet. They appear here when the marshals or the timing system report something.</p>";
}

function renderTrackLimits() {
  const r = race;
  const open = r.trackLimits.filter(t => t.status === "NEW").length;
  $("cntTl").textContent = open || "";

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
          ? `<span class="small">${tl.status === "DELETED" ? "Lap time deleted" : "No action"}</span>`
          : `<div class="btn-row"><button data-tl-delete="${tl.id}">Delete lap time</button><button data-tl-dismiss="${tl.id}">No action</button></div>`}
      </div>`;
  }
  $("tabLimits").innerHTML = html || "<p class='muted small'>No track limits reports yet.</p>";
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
  $("tabPenalties").innerHTML = html || "<p class='muted small'>No penalties given yet.</p>";
}

function renderAlerts() {
  const r = race;
  let html = "";
  for (const a of r.alerts.slice(-80).reverse()) {
    const clickable = a.carId != null || a.sector != null || a.s != null;
    html += `<li class="${a.level} ${clickable ? "clickable" : ""}" data-alert="${a.id}">
               <span class="time">${dayTime(a.t)}</span><span>${escapeHtml(a.text)}</span></li>`;
  }
  $("alerts").innerHTML = html || "<li class='muted'>All quiet.</li>";
}

function renderMessages() {
  const r = race;
  const showBlue = $("showBlue").checked;
  let html = "";
  const list = r.messages.filter(m => showBlue || m.category !== "Blue").slice(-150).reverse();
  for (const m of list) {
    html += `<li><span class="time">${dayTime(m.t)}<br>${race.session === "QUALI" ? lapLabel(m.lap) : "L" + m.lap}</span><span class="cat ${m.category}"></span><span>${escapeHtml(m.text)}</span></li>`;
  }
  $("messages").innerHTML = html || "<li class='muted'>No messages yet.</li>";
}


// =====================================================================
//  INCIDENT REVIEW
// =====================================================================
function openReview(id) {
  const inc = race.incidents.find(i => i.id === id);
  if (!inc) return;
  const state = { inc, t: inc.t - 8, playing: true, rate: 0.5, lastFrame: performance.now(), built: "" };
  reviewState = state;
  buildReview();
  $("modal").hidden = false;
  requestAnimationFrame(now => animateClip(now, state));
}

function closeModal() {
  $("modal").hidden = true;
  $("modalBox").className = "modal-box";
  reviewState = null;
}

function buildReview() {
  const inc = reviewState.inc;
  const r = race;
  const box = $("modalBox");
  box.className = "modal-box";
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
  } else if (st === "NFI") {
    decision = `<div class="result-box">Not investigated.</div>`;
    if (inc.truth) decision += `<div class="result-box ${inc.truth.penalty === "NFA" ? "good" : "bad"}">${escapeHtml(inc.truth.reason)}</div>`;
  } else {
    const options = penaltyCodes().map(c => `<option value="${c}">${PENALTIES[c].label}</option>`).join("");
    const rows = cars.map(c => `
      <div class="decision-row">
        <b><span class="team-bar" style="background:${c.colour}"></span>${c.number} ${c.code}</b>
        <select data-pen="${c.id}">${options}</select>
        <select data-pts="${c.id}">
          <option value="0">0 points</option><option value="1">1 point</option>
          <option value="2">2 points</option><option value="3">3 points</option>
        </select>
      </div>`).join("");
    const locked = st === "AFTER_RACE" && !r.finished;
    decision = rows + `<button id="decideBtn" class="button-primary" ${locked ? "disabled" : ""}>Publish decision</button>` +
      (locked ? `<p class="muted small">You chose to investigate this after the race.</p>` : "");
  }

  box.innerHTML = `
    <div class="modal-head">
      <div>
        <span class="chip ${st}">${statusText(st)}</span> ${inc.historic ? '<span class="chip hist">REAL INCIDENT</span>' : ""}
        <h2>${escapeHtml(inc.location)} – ${escapeHtml(inc.offence)}</h2>
        <p class="muted">${lapLabel(inc.lap)} · ${dayTime(inc.t)} · ${cars.map(c => carLabel(c)).join(", ")}</p>
      </div>
      <button class="close-btn" data-close="1">✕</button>
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
             <p class="muted small">Footage from 8 s before to 5 s after the incident. Numbers next to the cars = speed in km/h.</p>
             ${footageNote}`
          : `<div class="clip-wait">Footage is being prepared…<br>(available 5 s of race time after the incident – un-pause the race)</div>`}
      </div>
      <div class="review-right">
        <h3>Report</h3>
        <p>${escapeHtml(inc.summary)}</p>
        <h3>Evidence</h3>
        <table class="evidence">${evidence || "<tr><td>–</td><td>No data</td></tr>"}</table>
        ${statements ? "<h3>Driver statements</h3>" + statements : ""}
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
    const slider = $("clipSlider");
    if (slider && document.activeElement !== slider) slider.value = Math.round((s.t - start) / (end - start) * 1000);
  }
  requestAnimationFrame(next => animateClip(next, s));
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
      <button class="close-btn" data-close="1">✕</button>
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
  $("modal").hidden = false;
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
      ${row.times.map(t => `<td>${t ? formatLapTime(t) : "–"}</td>`).join("")}
      <td><b>${row.grid}</b>${row.penaltyText ? ` <span class="small mark-bad">${escapeHtml(row.penaltyText)}</span>` : ""}</td>
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
      <div><h2>Qualifying report – ${escapeHtml(r.title)}</h2>
      <p class="muted">${r.finished ? "Final classification" : "Provisional classification (the session is still running)"} · starting grid including grid penalties</p></div>
      <button class="close-btn" data-close="1">✕</button>
    </div>
    ${pending.length ? `<div class="result-box bad" style="margin-bottom:12px">${pending.length} incident(s) still need a decision – grid penalties may still change.</div>` : ""}
    <div class="report-grid">
      <div>
        <table>
          <thead><tr><th>Pos</th><th>Driver</th><th>${segName(1)}</th><th>${segName(2)}</th><th>${segName(3)}</th><th>Grid</th>${hasReal ? "<th>Real</th>" : ""}</tr></thead>
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
  $("modal").hidden = false;
}

function openReport() {
  const r = race;
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
      <button class="close-btn" data-close="1">✕</button>
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
  $("modal").hidden = false;
}


// =====================================================================
//  WIRING: all clicks of the control room
// =====================================================================
function wireUi() {
  const canvas = $("map");

  // ----- the map: click = select a car or a marshal sector -----
  canvas.addEventListener("click", event => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const car = carAtPixel(x, y);
    if (car !== null) {
      selectedCar = car;
    } else {
      const sector = sectorAtPixel(x, y);
      selectedSector = sector === selectedSector ? -1 : sector;
    }
    renderAll(true);
  });
  canvas.addEventListener("mousemove", event => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const car = carAtPixel(x, y);
    hoverSector = car === null ? sectorAtPixel(x, y) : -1;
    canvas.style.cursor = car !== null || hoverSector >= 0 ? "pointer" : "default";
  });
  canvas.addEventListener("mouseleave", () => { hoverSector = -1; });

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
      if (b.dataset.flag === "BLACK" && !confirm("Disqualify " + car.name + " (black flag)?")) return;
      act(() => showCarFlag(car, b.dataset.flag));
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
    red: () => (confirm("Show the RED FLAG and suspend the " + (race.session === "QUALI" ? "session" : "race") + "?") ? redFlag() : null),
    resumeStanding: () => resumeRace("STANDING"),
    resumeRolling: () => resumeRace("ROLLING"),
    delayStart: delayStart,
    skip: () => skipTime(5),
    abandon: () => (confirm("ABANDON the " + (race.session === "QUALI" ? "session" : "race") + "? It will not be resumed – the classification is taken by count-back and fewer (or no) points are awarded.") ? abandonSession("Race Director") : null),
    shorten: () => (confirm("Show the chequered flag at the end of this lap?") ? shortenRace() : null),
    yellow: () => setSectorFlag(selectedSector, "YELLOW"),
    double: () => setSectorFlag(selectedSector, "DOUBLE"),
    slippery: () => setSlippery(selectedSector, !race.slippery[selectedSector]),
    clear: () => setSectorFlag(selectedSector, "GREEN"),
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
  });

  $("tabIncidents").addEventListener("click", event => {
    const card = event.target.closest("[data-inc]");
    if (card) openReview(Number(card.dataset.inc));
  });

  $("tabLimits").addEventListener("click", event => {
    const b = event.target.closest("button");
    if (!b) return;
    const id = Number(b.dataset.tlDelete || b.dataset.tlDismiss);
    const item = race.trackLimits.find(t => t.id === id);
    if (!item) return;
    if (b.dataset.tlDelete) act(() => deleteLapTime(item));
    else act(() => dismissTrackLimits(item));
  });

  $("alerts").addEventListener("click", event => {
    const li = event.target.closest("[data-alert]");
    if (!li) return;
    const alert = race.alerts.find(a => a.id === Number(li.dataset.alert));
    if (!alert) return;
    if (alert.carId != null) selectedCar = alert.carId;
    if (alert.sector != null) selectedSector = alert.sector - 1;
    else if (alert.s != null) selectedSector = marshalSectorAt(race.track, alert.s) - 1;
    renderAll(true);
  });

  // ----- pop-up window -----
  $("modal").addEventListener("click", event => {
    if (event.target === $("modal") || event.target.closest("[data-close]")) {
      closeModal();
      return;
    }
    if (!reviewState) return;
    const inc = reviewState.inc;
    const b = event.target.closest("button");
    if (b && b.dataset.proc) {
      const fn = { note: noteIncident, investigate: investigateIncident, after: investigateAfterRace, nfi: noInvestigation }[b.dataset.proc];
      const error = fn(inc);
      if (error) showToast(error);
      buildReview();
      renderAll(true);
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
