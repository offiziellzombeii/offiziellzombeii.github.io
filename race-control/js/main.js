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
async function loadHistoricMeetings() {
  const meetingSelect = $("hMeeting");
  meetingSelect.innerHTML = "<option>Loading...</option>";
  const meetings = await getData("meetings", "year=" + $("hYear").value);
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
  const sessions = await getData("sessions", "meeting_key=" + $("hMeeting").value);
  // races and qualifying sessions (practice sessions can't be run by Race Control)
  const usable = sessions.filter(s => (s.session_type === "Race" || s.session_type === "Qualifying") && Date.parse(s.date_start) < Date.now());
  sessionSelect.innerHTML = usable.map(s => `<option value="${s.session_key}">${escapeHtml(s.session_name)}</option>`).join("") ||
    "<option value=''>No race or qualifying session</option>";
  sessionSelect.selectedIndex = Math.max(0, usable.length - 1);
}

async function startHistoricRace() {
  const key = $("hSession").value;
  if (!key) {
    $("hStatus").textContent = "Please choose a race session.";
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
  selectedSector = -1;
  selectedCar = null;
  const quali = race.session === "QUALI";
  document.body.classList.toggle("quali-mode", quali);
  document.body.classList.toggle("gen-2026", race.regs === "GEN2026");
  $("aidLegend").innerHTML = race.regs === "GEN2026" ? '<i style="background:#4fd8ff"></i>Straight Mode zone' : '<i style="background:#2fd36b"></i>DRS zone';
  $("aidGroupTitle").textContent =race.regs === "GEN2026" ? "Pit lane, active aero & conditions" : "Pit lane, DRS & conditions";
  $("startGroupTitle").textContent = quali ? "Session" : "Start procedure";
  if (quali) {
    addAlert("info", "Welcome to Race Control. The cars are in their garages – start " + segName(1) + " (green light at the pit exit) when you are ready.");
  } else {
    addAlert("info", "Welcome to Race Control. The cars are on the grid – start the formation lap when you are ready.");
    publish("PIT EXIT OPEN", "Info");
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

function loop(now) {
  const passed = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;

  if (race && !paused && !race.finished) {
    simTimeToDo += passed * simSpeed;
    let steps = 0;
    while (simTimeToDo >= DT && steps < 800) {
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
  }

  if (race && !$("app").hidden) {
    drawMainMap($("map"), selectedCar);
    if (now - lastUiUpdate > 250) {
      lastUiUpdate = now;
      renderAll(false);
    }
  }
  requestAnimationFrame(loop);
}


// =====================================================================
//  START
// =====================================================================
fillCircuitList();
$("fSession").addEventListener("change", updateFictionalSessionFields);
updateFictionalSessionFields();
$("startFictional").addEventListener("click", startFictionalRace);
$("startHistoric").addEventListener("click", startHistoricRace);
$("hYear").addEventListener("change", loadHistoricMeetings);
$("hMeeting").addEventListener("change", loadHistoricSessions);
loadHistoricMeetings();

$("speedBtns").addEventListener("click", event => {
  const b = event.target.closest("button");
  if (b) setSpeed(Number(b.dataset.speed));
});
$("pauseBtn").addEventListener("click", () => setPaused(!paused));

document.addEventListener("keydown", event => {
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
  if (event.code === "Space" && race && !$("app").hidden) {
    event.preventDefault();
    setPaused(!paused);
  }
  if (event.code === "Escape" && !$("modal").hidden) closeModal();
});

wireUi();
wireSeasonUi();
requestAnimationFrame(loop);
