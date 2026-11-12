// =====================================================================
//  main.js
//  1. The setup screen (choose a fictitious or a historic race)
//  2. The main loop: runs the simulation and redraws the screen
// =====================================================================

let simSpeed = 1;
let paused = false;


// =====================================================================
//  1. SETUP SCREEN
// =====================================================================

// ----- fictitious race -----
function fillCircuitList() {
  const select = $("fCircuit");
  select.innerHTML = FICTIONAL_TRACKS.map((t, i) => `<option value="${i}">${t.name} (${t.country})</option>`).join("");
  const showInfo = () => {
    const t = FICTIONAL_TRACKS[select.value];
    $("fCircuitInfo").textContent = t.description;
    $("fLaps").value = t.laps;
  };
  select.addEventListener("change", showInfo);
  showInfo();
}

// show "laps" for a race, "session length" for qualifying
function updateFictionalSessionFields() {
  const quali = $("fSession").value !== "RACE";
  $("fLapsLabel").hidden = quali;
  $("fQualiLengthLabel").hidden = !quali;
  const sprint = $("fSession").value === "SPRINT_QUALI";
  $("fQualiLength").options[0].textContent = sprint ? "Full (12 / 10 / 8 min)" : "Full (18 / 15 / 12 min)";
}

function startFictionalRace() {
  const def = FICTIONAL_TRACKS[$("fCircuit").value];
  const seedText = $("fSeed").value.trim();
  const seed = seedText ? Number(seedText) : Math.floor(Math.random() * 1000000);
  setSeed(seed);

  const sessionChoice = $("fSession").value;
  const quali = sessionChoice !== "RACE";
  const sprint = sessionChoice === "SPRINT_QUALI";
  const track = buildFictionalTrack(def);
  applyTrackEdits(track, "fict:" + $("fCircuit").value); // zones of the track editor (track-editor.js)
  const durations = (sprint ? SPRINT_QUALI_DURATIONS : QUALI_DURATIONS).map(d => Math.round(d * Number($("fQualiLength").value)));

  // in qualifying the weather schedule is measured in "lap times" of session time
  const laps = quali ? Math.round(durations.reduce((a, b) => a + b, 0) / track.refLapTime)
                     : clamp(Number($("fLaps").value) || def.laps, 5, 80);
  const weather = makeFictionalWeather($("fWeather").value, laps);
  const entries = makeFictionalEntries(laps, weather);
  if (quali) entries.forEach(e => { e.startCompound = "SOFT"; e.plan = []; });

  createRace({
    mode: "fictional",
    regs: $("fRegs").value,
    session: quali ? "QUALI" : "RACE",
    sprint,
    qualiDurations: durations,
    title: def.name + (quali ? (sprint ? " Sprint Qualifying" : " Qualifying") : " Grand Prix"),
    track,
    totalLaps: quali ? 30 : laps,
    paceScale: 1,
    incidentLevel: Number($("fLevel").value),
    clockStart: quali ? 15 * 3600 : 14 * 3600 + 55 * 60,
    weather,
    entries,
    injections: [],
    real: null
  });
  $("raceSub").textContent = (quali ? "Fictitious qualifying" : "Fictitious race") + " · " + REGS_INFO[race.regs].short + " cars · " + track.name + " · " +
    (track.length / 1000).toFixed(3) + " km · seed " + seed;
  showControlRoom();
}

// ----- historic race -----
// OpenF1 has the real data (lap times, incidents, retirements) from 2023 on.
// Older seasons come from the data packs: then everything is simulated.
const OPENF1_FIRST_YEAR = 2023;

function isPackYear(year) {
  return Number(year) < OPENF1_FIRST_YEAR && SEASON_YEARS.includes(Number(year));
}

// The year list: the OpenF1 years and the seasons of the data packs (e.g. 2020)
function fillHistoricYears() {
  const select = $("hYear");
  const current = select.value || "2025";
  const openF1 = [];
  for (let y = OPENF1_FIRST_YEAR; y <= new Date().getFullYear(); y++) openF1.push(y);
  const packYears = SEASON_YEARS.filter(y => y < OPENF1_FIRST_YEAR).sort((a, b) => b - a);
  select.innerHTML =
    `<optgroup label="Real data (OpenF1)">${openF1.map(y => `<option value="${y}">${y}</option>`).join("")}</optgroup>` +
    (packYears.length ? `<optgroup label="Data packs – simulated">${packYears.map(y => `<option value="${y}">${y} · data pack</option>`).join("")}</optgroup>` : "");
  select.value = [...select.options].some(o => o.value === String(current)) ? current : "2025";
}

// The races of a data pack season that have a track shape
function packMeetings(year) {
  return realCalendar(year)
    .map((m, index) => Object.assign({ index }, m))
    .filter(m => hasBundledLayout(m.circuit) || (catalogueCircuit(m.circuit) || { meetings: [] }).meetings.some(x => x.race));
}

function updateHistoricRealOption(packYear) {
  const real = $("hReal");
  real.disabled = packYear;
  if (packYear) real.checked = false;
  real.closest("label").classList.toggle("muted", packYear);
  $("hStatus").textContent = packYear
    ? "Data pack season: there are no real lap times, incidents or retirements – the whole session is simulated (cars, drivers and circuit of " + $("hYear").value + ")."
    : "";
}

async function loadHistoricMeetings() {
  const meetingSelect = $("hMeeting");
  const year = Number($("hYear").value);
  if (isPackYear(year)) {
    const list = packMeetings(year);
    meetingSelect.innerHTML = list.map(m => `<option value="pack:${m.index}">${escapeHtml(m.gp || circuitInfo(m.circuit).gp)} (${escapeHtml(circuitInfo(m.circuit).name)})</option>`).join("") ||
      "<option value=''>No race with a track shape in the data pack</option>";
    updateHistoricRealOption(true);
    loadHistoricSessions();
    return;
  }
  updateHistoricRealOption(false);
  meetingSelect.innerHTML = "<option>Loading...</option>";
  let meetings;
  try {
    meetings = await getData("meetings", "year=" + $("hYear").value);
  } catch (error) {
    meetingSelect.innerHTML = "<option value=''>OpenF1 not reachable</option>";
    $("hSession").innerHTML = "";
    return;
  }
  const past = meetings.filter(m => Date.parse(m.date_start) < Date.now() && !/testing/i.test(m.meeting_name));
  meetingSelect.innerHTML = past.map(m => `<option value="${m.meeting_key}">${escapeHtml(m.meeting_name)}</option>`).join("") ||
    "<option value=''>No races found</option>";
  meetingSelect.selectedIndex = Math.max(0, past.length - 1);
  loadHistoricSessions();
}

async function loadHistoricSessions() {
  const sessionSelect = $("hSession");
  sessionSelect.innerHTML = "<option>Loading...</option>";
  if (!$("hMeeting").value) {
    sessionSelect.innerHTML = "";
    return;
  }
  if ($("hMeeting").value.startsWith("pack:")) {
    sessionSelect.innerHTML = `<option value="RACE">Race (simulated)</option><option value="Q">Qualifying (simulated)</option>`;
    return;
  }
  let sessions;
  try {
    sessions = await getData("sessions", "meeting_key=" + $("hMeeting").value);
  } catch (error) {
    sessionSelect.innerHTML = "<option value=''>OpenF1 not reachable</option>";
    return;
  }
  // races and qualifying sessions (historic practice sessions are not offered; practice exists in the championship)
  const usable = sessions.filter(s => (s.session_type === "Race" || s.session_type === "Qualifying") && Date.parse(s.date_start) < Date.now());
  sessionSelect.innerHTML = usable.map(s => `<option value="${s.session_key}">${escapeHtml(s.session_name)}</option>`).join("") ||
    "<option value=''>No race or qualifying session</option>";
  sessionSelect.selectedIndex = Math.max(0, usable.length - 1);
}

// A race of a data pack season: built like a championship session (car ratings from the
// real results of that year, driver ratings, circuit character and climate) – but not saved.
// The grid of a race is simulated from the pace of the cars and drivers.
async function startPackRace() {
  const year = Number($("hYear").value);
  const meeting = realCalendar(year)[Number($("hMeeting").value.slice(5))];
  const type = $("hSession").value;
  const status = text => { $("hStatus").textContent = text; };
  const draft = newSeasonDraft(year, "GE2023");
  draft.name = meeting.gp + " " + year;
  draft.year = year;
  draft.calendar = [{ circuit: meeting.circuit, sprint: false, gp: meeting.gp, date: meeting.date }];
  fillEmptySeats(draft, year); // every team two different drivers
  // the pit lane has 12 garages: the 12 strongest teams of the year
  draft.teams.sort((a, b) => ((teamInYear(a.id, year) || {}).avgFinish || 20) - ((teamInYear(b.id, year) || {}).avgFinish || 20));
  draft.teams = draft.teams.slice(0, MAX_TEAMS);
  const s = createSeason(draft, { transient: true });
  ensureRatings(s);
  const round = s.calendar[0];
  round.prepared = true; // a one-off race: no bans, upgrades, power unit penalties
  round.practice = false; // and no free practice

  const level = 0.4 + Number($("hLevel").value) * 0.6;
  const setup = await buildSeasonSetup(s, round, type, { distance: Number($("hDistance").value), level, offences: SEASON_OFFENCES }, status);
  setup.seasonContext = null; // not part of a championship
  setup.title = meeting.gp + " " + year + (type === "Q" ? " · Qualifying" : "");
  if (type !== "Q") {
    // simulated grid: the pace of car and driver, plus the form of the day
    const rnd = makeRandom(hashText(year + "/" + meeting.gp) % 1000000 + 5);
    const key = new Map(setup.entries.map(e => [e, e.pace * (1 + (rnd() - 0.5) * 0.008)]));
    setup.entries.sort((a, b) => key.get(b) - key.get(a));
    setup.entries.forEach((e, i) => { e.grid = i + 1; });
  }
  createRace(setup);
  const info = circuitInfo(meeting.circuit);
  $("raceSub").textContent = "Data pack " + year + " · simulated " + (type === "Q" ? "qualifying" : "race") + " · " + info.name + " · " +
    (setup.session === "QUALI" ? setup.qualiDurations.map(d => formatMinutes(d)).join(" / ") + " min" : setup.totalLaps + " laps") +
    " · " + (setup.track.length / 1000).toFixed(3) + " km";
  status("");
  showControlRoom();
}

async function startHistoricRace() {
  const key = $("hSession").value;
  if (!key) {
    $("hStatus").textContent = "Please choose a race session.";
    return;
  }
  if ($("hMeeting").value.startsWith("pack:")) {
    $("startHistoric").disabled = true;
    try {
      await startPackRace();
    } catch (error) {
      console.error(error);
      $("hStatus").textContent = "Could not start this race: " + error.message;
    }
    $("startHistoric").disabled = false;
    return;
  }
  const button = $("startHistoric");
  button.disabled = true;
  $("startFictional").disabled = true;
  setSeed(Number(key) * 31 + 7);

  try {
    const setup = await buildHistoricSetup(key, {
      distance: Number($("hDistance").value),
      incidentLevel: Number($("hLevel").value),
      realIncidents: $("hReal").checked
    }, text => { $("hStatus").textContent = text; });

    createRace(setup);
    const realCount = setup.injections.filter(i => i.kind === "INCIDENT").length;
    if (setup.session === "QUALI") {
      $("raceSub").textContent = "Historic qualifying · " + setup.qualiDurations.map(d => formatMinutes(d)).join(" / ") + " min · " +
        (setup.track.length / 1000).toFixed(3) + " km · " + realCount + " real incidents";
    } else {
      $("raceSub").textContent = "Historic race · " + setup.totalLaps + " of " + setup.real.realLaps + " laps · " +
        (setup.track.length / 1000).toFixed(3) + " km · " + realCount + " real incidents";
    }
    showControlRoom();
  } catch (error) {
    console.error(error);
    $("hStatus").textContent = "Could not load this race: " + error.message;
  }
  button.disabled = false;
  $("startFictional").disabled = false;
}

function showControlRoom() {
  $("setupScreen").hidden = true;
  $("app").hidden = false;
  $("raceTitle").textContent = race.title;
  mainView = null;
  setSelectedSectors([]);
  closeFlagPopup();
  selectedCar = null;
  // the options of the console show the state of this session
  $("autoYellow").checked = race.autoMarshalYellow;
  $("autoRain").checked = race.autoMarshalRain;
  $("autoRecovery").checked = !!race.autoRecovery;
  const quali = race.session === "QUALI";
  document.body.classList.toggle("quali-mode", quali);
  document.body.classList.toggle("gen-2026", race.regs === "GEN2026");
  $("aidLegend").innerHTML = race.regs === "GEN2026" ? '<i style="background:#4fd8ff"></i>Straight Mode zone' : '<i style="background:#2fd36b"></i>DRS zone';
  $("aidGroupTitle").textContent =race.regs === "GEN2026" ? "Pit lane, active aero & conditions" : "Pit lane, DRS & conditions";
  $("startGroupTitle").textContent = quali ? "Session" : "Start procedure";
  if (quali) {
    addAlert("info", "Welcome to Race Control. The cars are in their garages – start " + segName(1) + " (green light at the pit exit) when you are ready.");
  } else {
    addAlert("info", "Welcome to Race Control. The cars are on the grid – start the formation lap when you are ready. " +
      "The pit exit is closed for the start: open it once the field has passed after the start" +
      (race.cars.some(c => c.pitLaneStart) ? " – " + race.cars.filter(c => c.pitLaneStart).map(c => c.code).join(", ") +
        " start from the pit lane (they drive the formation lap and turn into the pit lane at its end)." : "."));
  }
  renderAll(true);
}


// =====================================================================
//  2. SIMULATION SPEED AND THE MAIN LOOP
// =====================================================================
function setSpeed(value) {
  simSpeed = value;
  document.querySelectorAll("#speedBtns button").forEach(b => b.classList.toggle("active", Number(b.dataset.speed) === value));
}

function setPaused(value) {
  paused = value;
  $("pauseBtn").textContent = paused ? "▶" : "❚❚";
}

let lastFrame = performance.now();
let simTimeToDo = 0;
let lastUiUpdate = 0;

// The simulation gets at most this much time per frame, so a slow device can't
// freeze the browser. Time that doesn't fit is caught up in the next frames
// (smooth movement); only more than MAX_BACKLOG seconds of race time are dropped.
// (SIM_BUDGET_MS and MAX_BACKLOG: settings/simulation.js)
// average cost of one simulation step on this device (ms). The number of steps
// per frame is planned from it, so every frame moves the cars about the same
// distance (an even picture) instead of stopping at a random point when time is up.
let stepCostMs = 0.05;
const speedMeter = { since: 0, simSeconds: 0, realSeconds: 0, actual: null };

// Redraw the map only when something changed (or the obstacle warning pulses)
let mapDirty = true;
let lastMapKey = "";
let lastMapDraw = 0;

// ?perf=1 shows how many milliseconds a frame needs (simulation, map, panels)
const perfStats = /[?&]perf=1/.test(location.search) ? { frames: 0, sim: 0, map: 0, ui: 0, steps: 0, worst: 0, since: 0 } : null;

function loop(now) {
  const passed = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  const t0 = performance.now();
  let steps = 0;

  if (race && !paused && !race.finished) {
    simTimeToDo += passed * simSpeed;
    const allowed = Math.max(1, Math.floor(SIM_BUDGET_MS / stepCostMs));
    while (simTimeToDo >= DT && steps < allowed) {
      simStep();
      simTimeToDo -= DT;
      steps++;
      // something dangerous happened: go back to normal speed so the user can react
      if (race.speedRequest) {
        if (race.autoSlow && simSpeed > 1) {
          setSpeed(1);
          simTimeToDo = 0;
        }
        race.speedRequest = null;
        if (simSpeed === 1) break;
      }
    }
    if (steps > 0) stepCostMs = stepCostMs * 0.9 + ((performance.now() - t0) / steps) * 0.1;
    // far behind (a very slow device or a hiccup): don't try to catch up all of it
    if (simTimeToDo > MAX_BACKLOG) simTimeToDo = MAX_BACKLOG;
    meterSpeed(now, steps * DT, passed);
  } else {
    speedMeter.actual = null;
  }
  const t1 = performance.now();

  let t2 = t1;
  if (race && !$("app").hidden) {
    const key = race.time + "|" + selectedCar + "|" + selectedSector + "|" + hoverSector + "|" + race.ver;
    // animated things on the map (warning rings, the rain signal): redrawn ~8× per second when paused
    const pulsing = (race.obstacles && race.obstacles.some(o => !o.cleared)) || (race.rainFlags && race.rainFlags.some(Boolean));
    const running = !paused && !race.finished;
    if (running || mapDirty || key !== lastMapKey || (pulsing && now - lastMapDraw > 120) || now - lastMapDraw > 500) {
      // while the race runs: every frame, with the cars where they are "now" (between two steps)
      drawMainMap($("map"), selectedCar, running ? Math.min(simTimeToDo, DT) : 0);
      lastMapKey = key;
      lastMapDraw = now;
      mapDirty = false;
    }
    t2 = performance.now();
    if (now - lastUiUpdate > 250) {
      lastUiUpdate = now;
      renderAll(false);
    }
  }
  if (perfStats) recordPerf(now, steps, t1 - t0, t2 - t1, performance.now() - t2);
  requestAnimationFrame(loop);
}

// Real simulation speed, measured over about one second (shown in the ?perf=1 overlay)
function meterSpeed(now, simSeconds, realSeconds) {
  const m = speedMeter;
  m.simSeconds += simSeconds;
  m.realSeconds += realSeconds;
  if (now - m.since < 1000) return;
  m.actual = m.realSeconds > 0 ? m.simSeconds / m.realSeconds : null;
  m.since = now;
  m.simSeconds = 0;
  m.realSeconds = 0;
}

function recordPerf(now, steps, simMs, mapMs, uiMs) {
  const p = perfStats;
  p.frames++;
  p.sim += simMs;
  p.map += mapMs;
  p.ui += uiMs;
  p.steps += steps;
  p.worst = Math.max(p.worst, simMs + mapMs + uiMs);
  if (now - p.since < 1000) return;
  let box = $("perfBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "perfBox";
    box.className = "perf-box";
    document.body.appendChild(box);
  }
  const f = Math.max(1, p.frames);
  box.textContent = p.frames + " fps · per frame: sim " + (p.sim / f).toFixed(1) + " ms (" + (p.steps / f).toFixed(1) + " steps) · map " +
    (p.map / f).toFixed(1) + " ms · panels " + (p.ui / f).toFixed(1) + " ms · worst " + p.worst.toFixed(0) + " ms" +
    (speedMeter.actual !== null ? " · speed " + speedMeter.actual.toFixed(1) + "×" : "");
  window.lastPerf = { fps: p.frames, sim: p.sim / f, map: p.map / f, ui: p.ui / f, steps: p.steps / f, worst: p.worst };
  Object.assign(p, { frames: 0, sim: 0, map: 0, ui: 0, steps: 0, worst: 0, since: now });
}


// =====================================================================
//  START
// =====================================================================
fillCircuitList();
$("fSession").addEventListener("change", updateFictionalSessionFields);
updateFictionalSessionFields();
$("startFictional").addEventListener("click", startFictionalRace);
$("startHistoric").addEventListener("click", startHistoricRace);
initTrackEditor(); // edit track (track-editor.js)
initBackup();      // your data & settings as a .zip (backup.js)

// version and changelog (settings/changelog.js)
$("appVersion").textContent = "v" + APP_VERSION;
$("changelogBtn").addEventListener("click", showChangelog);
function showChangelog() {
  const box = $("modalBox");
  box.className = "modal-box narrow changelog-box";
  box.innerHTML = `
    <div class="modal-head">
      <div><h2>Changelog</h2><p class="muted">Race Control · current version ${escapeHtml(APP_VERSION)}</p></div>
      <button class="close-btn" aria-label="Close" data-close="1">✕</button>
    </div>
    ${CHANGELOG.map(v => `
      <div class="changelog-entry">
        <div class="changelog-head"><b>v${escapeHtml(v.version)}</b><span class="muted small">${escapeHtml(v.date || "")}</span></div>
        <ul>${(v.changes || []).map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
      </div>`).join("")}`;
  showModal();
}
$("hYear").addEventListener("change", loadHistoricMeetings);
$("hMeeting").addEventListener("change", loadHistoricSessions);
fillHistoricYears();
loadHistoricMeetings();

$("speedBtns").addEventListener("click", event => {
  const b = event.target.closest("button");
  if (b) setSpeed(Number(b.dataset.speed));
});
$("pauseBtn").addEventListener("click", () => setPaused(!paused));
$("keysBtn").addEventListener("click", () => showShortcutHelp());

document.addEventListener("keydown", event => {
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  // Space pauses in the control room – also when a console button has the focus after a click
  // (it would press that button again: pit exit, DRS ... toggled back). Enter still presses buttons.
  // the Race Director's shortcuts (ui.js) – also when a console button has the focus
  if (handleShortcut(event)) {
    event.preventDefault();
    return;
  }
  // (pause / continue is a shortcut too – default Space, settings/controls.js)
  // Space never presses a focused button in the control room
  if (event.code === "Space" && race && !$("app").hidden && (tag !== "BUTTON" || event.target.closest("#app"))) {
    event.preventDefault();
    return;
  }
  if (tag === "BUTTON") return;
  if (event.code === "Escape") {
    closeFlagPopup();
    if (!$("modal").hidden) closeModal();
  }
});
// (a button is pressed by Space when the key goes up – not in the control room)
document.addEventListener("keyup", event => {
  if (event.code === "Space" && event.target.tagName === "BUTTON" && event.target.closest("#app")) event.preventDefault();
});

wireUi();
wireSeasonUi();
requestAnimationFrame(loop);
