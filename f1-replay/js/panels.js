// =====================================================================
//  panels.js
//  Fills the cards on the page: leaderboard, driver, race information,
//  tyre strategy and events.
// =====================================================================

let standings = [];       // the current order of the drivers (see getStandings in race.js)
let currentBattles = [];  // cars that are less than 1 second apart
let selectedDriver = null;
let shownRadioKey = "";   // helps us to only rebuild the radio list when something changed

const TYRE_COLOURS = {
  SOFT: "#ff3333",
  MEDIUM: "#ffd60a",
  HARD: "#ffffff",
  INTERMEDIATE: "#39b54a",
  WET: "#0090ff"
};

// Text and colour of the track status label
const STATUS_LABELS = {
  GREEN:      { text: "Track clear",            css: "status-green" },
  YELLOW:     { text: "Yellow flag",            css: "status-yellow" },
  SC:         { text: "Safety car",             css: "status-orange" },
  SC_ENDING:  { text: "Safety car in this lap", css: "status-orange" },
  VSC:        { text: "Virtual safety car",     css: "status-yellow" },
  VSC_ENDING: { text: "VSC ending",             css: "status-yellow" },
  RED:        { text: "Red flag",               css: "status-red" },
  CHEQUERED:  { text: "Chequered flag",         css: "status-white" },
  FINISHED:   { text: "Session finished",       css: "status-white" }
};

// Update all cards (called 2 times per second)
function updatePanels() {
  if (!session) return;

  const status = getTrackStatus();
  standings = getStandings();
  // Under a safety car all cars are close together, that is not a real battle
  currentBattles = isNeutralised(status) ? [] : getBattles(standings);

  updateTopInfo(status);
  updateLeaderboard();
  updateDriverPanel();
  updateRaceInfo();
  updateStrategy();
  updateEvents();
}

function selectDriver(number) {
  selectedDriver = number;
  shownRadioKey = "";
  updatePanels();
}


// ---------- Small HTML builders ----------

function tyreBadge(compound) {
  if (!compound) return "–";
  const colour = TYRE_COLOURS[compound] || "#888888";
  return `<span class="tyre" style="border-color:${colour}; color:${colour}">${compound[0]}</span>`;
}

function formatGap(value) {
  if (value == null) return "–";
  if (typeof value === "number") return "+" + value.toFixed(3);
  return value; // e.g. "+1 LAP"
}

// "▲2" when the driver gained 2 places since the start
function positionChange(row) {
  if (row.retired || row.startPosition === null) return "";
  const change = row.startPosition - row.position;
  if (change > 0) return `<span class="up">▲${change}</span>`;
  if (change < 0) return `<span class="down">▼${-change}</span>`;
  return `<span class="same">–</span>`;
}

// A small box with a label and a value
function statBox(label, value) {
  return `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
}

// Fastest lap of all drivers so far: { number, lap }
function getFastestLap() {
  let fastest = null;
  for (const number in drivers) {
    for (const lap of finishedLaps(number)) {
      if (!fastest || lap.lap_duration < fastest.lap.lap_duration) {
        fastest = { number: Number(number), lap: lap };
      }
    }
  }
  return fastest;
}


// ---------- Top info: clock, lap and track status ----------
function updateTopInfo(status) {
  document.getElementById("clock").textContent = formatClock(currentTime - startTime);

  const leaderLap = standings.length > 0 ? standings[0].lap : 0;
  document.getElementById("lapLabel").textContent = "Lap " + Math.min(leaderLap, totalLaps) + " / " + totalLaps;

  const label = STATUS_LABELS[status.main];
  let text = label.text;
  let css = label.css;

  // Green track, but some sectors have yellow flags
  const sectors = Object.keys(status.yellowSectors);
  if (status.main === "GREEN" && sectors.length > 0) {
    text = "Yellow flag · Sector " + sectors.join(", ");
    css = "status-yellow";
  }

  const pill = document.getElementById("trackStatus");
  pill.textContent = text;
  pill.className = "pill " + css;
}


// ---------- Leaderboard ----------
function updateLeaderboard() {
  const fastest = getFastestLap();

  const battleCars = {};
  for (const b of currentBattles) {
    battleCars[b.ahead] = true;
    battleCars[b.behind] = true;
  }

  let html = "";
  standings.forEach((row, index) => {
    const laps = finishedLaps(row.number);
    const lastLap = laps.length > 0 ? laps[laps.length - 1].lap_duration : null;
    const bestLap = bestLapTime(laps);
    const stint = currentStint(row.number, row.lap);
    const tyreAge = stint ? stint.tyre_age_at_start + (row.lap - stint.lap_start) : "";
    const isLeader = index === 0;

    // Small label behind the name
    let tag = "";
    if (row.retired) tag = `<span class="tag out">OUT</span>`;
    else if (row.inPit) tag = `<span class="tag pit">PIT</span>`;
    else if (battleCars[row.number]) tag = `<span class="tag battle">BATTLE</span>`;

    // CSS classes of the row
    let rowClass = "";
    if (row.number === selectedDriver) rowClass += " selected";
    if (row.retired) rowClass += " retired";

    html += `
      <tr class="${rowClass}" onclick="selectDriver(${row.number})">
        <td class="pos">${row.retired ? "–" : row.position}</td>
        <td>${positionChange(row)}</td>
        <td><span class="team-bar" style="background:${teamColour(row.number)}"></span><b>${driverName(row.number)}</b>${tag}</td>
        <td>${isLeader ? "Leader" : formatGap(row.interval && row.interval.gap_to_leader)}</td>
        <td>${isLeader ? "" : formatGap(row.interval && row.interval.interval)}</td>
        <td>${formatLapTime(lastLap)}</td>
        <td class="${fastest && bestLap === fastest.lap.lap_duration ? "purple" : ""}">${formatLapTime(bestLap)}</td>
        <td>${tyreBadge(stint && stint.compound)}<span class="muted">${tyreAge}</span></td>
        <td>${countPits(row.number)}</td>
      </tr>`;
  });
  document.querySelector("#leaderboard tbody").innerHTML = html;
}


// ---------- Selected driver ----------
function updateDriverPanel() {
  const empty = document.getElementById("driverEmpty");
  const content = document.getElementById("driverContent");

  if (!selectedDriver || !drivers[selectedDriver]) {
    empty.hidden = false;
    content.hidden = true;
    return;
  }
  empty.hidden = true;
  content.hidden = false;

  const d = drivers[selectedDriver];
  const row = standings.find(r => r.number === selectedDriver);

  // Header with photo, number, name and team
  document.getElementById("driverCard").style.setProperty("--team", teamColour(selectedDriver));
  const photo = document.getElementById("driverPhoto");
  if (d.headshot_url && photo.src !== d.headshot_url) photo.src = d.headshot_url;
  photo.hidden = !d.headshot_url;
  document.getElementById("driverNumber").textContent = d.driver_number;
  document.getElementById("driverName").textContent = d.full_name;
  document.getElementById("driverTeam").textContent = d.team_name + (d.country_code ? " · " + d.country_code : "");

  // Statistic boxes
  const laps = finishedLaps(selectedDriver);
  const stint = currentStint(selectedDriver, row.lap);
  const tyreAge = stint ? stint.tyre_age_at_start + (row.lap - stint.lap_start) : 0;

  let state = "Racing";
  if (row.retired) state = "Retired";
  else if (row.inPit) state = "In the pit lane";

  let positionText = "P" + row.position;
  if (row.startPosition) positionText += ` <small>started P${row.startPosition}</small>`;

  document.getElementById("driverStats").innerHTML =
    statBox("Position", positionText) +
    statBox("Gap to leader", formatGap(row.interval && row.interval.gap_to_leader)) +
    statBox("Gap ahead", formatGap(row.interval && row.interval.interval)) +
    statBox("Lap", row.lap + " / " + totalLaps) +
    statBox("Last lap", formatLapTime(laps.length > 0 ? laps[laps.length - 1].lap_duration : null)) +
    statBox("Best lap", formatLapTime(bestLapTime(laps))) +
    statBox("Tyre", stint ? tyreBadge(stint.compound) + ` <small>${tyreAge} laps old</small>` : "–") +
    statBox("Stint / pit stops", (stint ? stint.stint_number : "–") + " / " + countPits(selectedDriver)) +
    statBox("Status", state);

  updateLapTable(laps);
  updateRadioList();
}

// Lap table: purple = fastest of everyone, green = personal best
function updateLapTable(laps) {
  // Best sector times of ALL drivers so far
  const overallBest = { s1: Infinity, s2: Infinity, s3: Infinity, lap: Infinity };
  for (const number in drivers) {
    for (const lap of finishedLaps(number)) {
      overallBest.s1 = Math.min(overallBest.s1, lap.duration_sector_1 || Infinity);
      overallBest.s2 = Math.min(overallBest.s2, lap.duration_sector_2 || Infinity);
      overallBest.s3 = Math.min(overallBest.s3, lap.duration_sector_3 || Infinity);
      overallBest.lap = Math.min(overallBest.lap, lap.lap_duration);
    }
  }

  // Best sector times of the selected driver
  const personalBest = { s1: Infinity, s2: Infinity, s3: Infinity, lap: Infinity };
  for (const lap of laps) {
    personalBest.s1 = Math.min(personalBest.s1, lap.duration_sector_1 || Infinity);
    personalBest.s2 = Math.min(personalBest.s2, lap.duration_sector_2 || Infinity);
    personalBest.s3 = Math.min(personalBest.s3, lap.duration_sector_3 || Infinity);
    personalBest.lap = Math.min(personalBest.lap, lap.lap_duration);
  }

  // One table cell, coloured purple or green
  function timeCell(value, key, text) {
    if (value == null) return "<td>–</td>";
    let css = "";
    if (value === overallBest[key]) css = "purple";
    else if (value === personalBest[key]) css = "green";
    return `<td class="${css}">${text}</td>`;
  }

  let html = "";
  for (const lap of laps.slice().reverse()) { // newest lap on top
    const stint = currentStint(selectedDriver, lap.lap_number);
    const pitTag = lap.is_pit_out_lap ? `<span class="tag pit">OUT LAP</span>` : "";
    html += `
      <tr>
        <td>${lap.lap_number}${pitTag}</td>
        <td>${tyreBadge(stint && stint.compound)}</td>
        ${timeCell(lap.duration_sector_1, "s1", lap.duration_sector_1)}
        ${timeCell(lap.duration_sector_2, "s2", lap.duration_sector_2)}
        ${timeCell(lap.duration_sector_3, "s3", lap.duration_sector_3)}
        ${timeCell(lap.lap_duration, "lap", formatLapTime(lap.lap_duration))}
      </tr>`;
  }
  document.querySelector("#lapTable tbody").innerHTML =
    html || "<tr><td colspan='6' class='muted'>No finished laps yet.</td></tr>";
}

// Team radio messages of the selected driver.
// We only rebuild the list when a new message arrives,
// otherwise an audio that is playing would stop.
function updateRadioList() {
  const radios = teamRadio.filter(r => r.driver_number === selectedDriver && r.t <= currentTime);
  const key = selectedDriver + "_" + radios.length;
  if (key === shownRadioKey) return;
  shownRadioKey = key;

  let html = "";
  for (const r of radios.slice().reverse()) {
    html += `
      <li>
        <span class="time">${formatClock(r.t - startTime)}</span>
        <audio controls preload="none" src="${r.recording_url}"></audio>
      </li>`;
  }
  document.getElementById("radioList").innerHTML = html || "<li class='muted'>No team radio yet.</li>";
}

// Live telemetry. This is called very often (every frame), so we keep it small.
function updateTelemetry() {
  if (!selectedDriver) return;
  const data = getCarData(selectedDriver, currentTime);

  const speed = document.getElementById("telSpeed");
  const gear = document.getElementById("telGear");
  const rpm = document.getElementById("telRpm");
  const drs = document.getElementById("telDrs");
  const throttle = document.getElementById("telThrottle");
  const brake = document.getElementById("telBrake");

  if (!data) {
    speed.textContent = "–";
    gear.textContent = "–";
    rpm.textContent = "–";
    drs.textContent = "–";
    throttle.style.width = "0%";
    brake.style.width = "0%";
    return;
  }

  speed.innerHTML = data.speed + " <small>km/h</small>";
  gear.textContent = data.n_gear === 0 ? "N" : data.n_gear;
  rpm.textContent = data.rpm;
  throttle.style.width = Math.min(100, data.throttle) + "%";
  brake.style.width = Math.min(100, data.brake) + "%";

  // DRS values: 10, 12, 14 = open, 8 = allowed but not open yet, other = off
  if (data.drs >= 10) {
    drs.textContent = "OPEN";
    drs.className = "drs-open";
  } else if (data.drs === 8) {
    drs.textContent = "READY";
    drs.className = "drs-available";
  } else {
    drs.textContent = "OFF";
    drs.className = "";
  }
}


// ---------- Race information ----------
function updateRaceInfo() {
  const leader = standings[0];
  const fastest = getFastestLap();
  const w = latestBefore(weather, currentTime) || weather[0];

  // Count things that happened so far
  const overtakeCount = overtakes.filter(o => o.t <= currentTime).length;
  const pitCount = pits.filter(p => p.t <= currentTime).length;
  const retiredCount = standings.filter(r => r.retired).length;
  let safetyCars = 0;
  let virtualSafetyCars = 0;
  let redFlags = 0;
  for (const r of raceControl) {
    if (r.t > currentTime) break;
    const message = r.message || "";
    if (message.includes("VIRTUAL SAFETY CAR DEPLOYED")) virtualSafetyCars++;
    else if (message.includes("SAFETY CAR DEPLOYED")) safetyCars++;
    if (r.flag === "RED") redFlags++;
  }

  let html =
    statBox("Circuit", session.circuit_short_name || session.location) +
    statBox("Leader", leader ? driverName(leader.number) : "–") +
    statBox("Fastest lap", fastest
      ? driverName(fastest.number) + " " + formatLapTime(fastest.lap.lap_duration) + ` <small>lap ${fastest.lap.lap_number}</small>`
      : "–") +
    statBox("Overtakes", overtakeCount) +
    statBox("Pit stops", pitCount) +
    statBox("Retirements", retiredCount) +
    statBox("SC / VSC / Red", safetyCars + " / " + virtualSafetyCars + " / " + redFlags);

  if (w) {
    html +=
      statBox("Air / Track", w.air_temperature + "° / " + w.track_temperature + "°") +
      statBox("Humidity", w.humidity + "%") +
      statBox("Wind", w.wind_speed + " m/s") +
      statBox("Rain", w.rainfall ? "Yes" : "No");
  }
  document.getElementById("raceStats").innerHTML = html;

  // List of battles
  let battleHtml = "";
  for (const b of currentBattles) {
    battleHtml += `
      <li>
        <span><b>P${b.position}</b> ${driverName(b.ahead)} vs ${driverName(b.behind)}</span>
        <span class="time">${b.gap.toFixed(3)} s</span>
      </li>`;
  }
  document.getElementById("battleList").innerHTML = battleHtml || "<li class='muted'>No close battles right now.</li>";
}


// ---------- Tyre strategy ----------
// One bar per driver, one coloured block per tyre stint.
// We only show laps that already happened, so the replay doesn't spoil the future.
function updateStrategy() {
  if (totalLaps === 0) {
    document.getElementById("strategy").innerHTML = "<p class='muted'>No lap data.</p>";
    return;
  }

  let html = "";
  for (const row of standings) {
    const selected = row.number === selectedDriver ? "selected" : "";
    html += `<div class="strat-row ${selected}" onclick="selectDriver(${row.number})">
               <div class="strat-name">${driverName(row.number)}</div>
               <div class="strat-bar">`;

    for (const s of stintsByDriver[row.number] || []) {
      if (s.lap_start > row.lap) continue; // this stint has not started yet
      const end = Math.min(s.lap_end || row.lap, row.lap);
      const left = (s.lap_start - 1) / totalLaps * 100;
      const width = (end - s.lap_start + 1) / totalLaps * 100;
      const colour = TYRE_COLOURS[s.compound] || "#888888";
      html += `<div class="stint" style="left:${left}%; width:${width}%; background:${colour}"
                    title="${s.compound} · laps ${s.lap_start}–${end}">${s.compound ? s.compound[0] : ""}</div>`;
    }

    html += `<div class="lap-marker" style="left:${row.lap / totalLaps * 100}%"></div>`;
    html += `</div></div>`;
  }
  html += `<div class="strat-axis"><span>Lap 1</span><span>Lap ${totalLaps}</span></div>`;
  document.getElementById("strategy").innerHTML = html;
}


// ---------- Events ----------
// Shows the last 60 events that already happened (newest on top)
function updateEvents() {
  const filter = document.getElementById("eventFilter").value;

  const past = events.filter(e => e.t <= currentTime && (filter === "all" || e.type === filter));
  const newest = past.slice(-60).reverse();

  let html = "";
  for (const e of newest) {
    html += `
      <li>
        <span class="dot ${e.type}"></span>
        <span class="time">${formatClock(e.t - startTime)}</span>
        <span>${e.text}</span>
      </li>`;
  }
  document.getElementById("events").innerHTML = html || "<li class='muted'>No events yet.</li>";
}
