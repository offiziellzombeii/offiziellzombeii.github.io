// =====================================================================
//  fia-tools.js
//  Tools of the FIA for weather and long suspensions:
//  1. Lap snapshots and green-flag laps (for the count-back rule)
//  2. Delay the start, skip waiting time
//  3. Abandon a session: classification by count-back
//     (FIA Sporting Regulations: the order at the end of the penultimate
//     lap before the lap during which the race was suspended)
//  4. Time limits: 2 h of racing, 3 h including suspensions
//  5. Heat hazard and the evaluation of the weather decisions
// =====================================================================

// ---------- 1. Snapshots (called by crossLine) ----------
function recordLapSnapshot(car) {
  const r = race;
  if (r.session !== "RACE" || r.order[0] !== car) return;
  r.snapshots = r.snapshots || {};
  r.snapshots[car.laps] = r.order.map(c => ({ id: c.id, laps: c.laps, running: isRunning(c) && !c.dsq, finished: c.finished }));
  if (r.status === "GREEN") r.greenLaps = (r.greenLaps || 0) + 1;
}


// ---------- 2. Delay the start, skip waiting time ----------
function delayStart() {
  const r = race;
  if (r.session === "QUALI") return "Use the red flag or simply wait before starting the next segment.";
  if (r.phase !== "PRE") return "The start can only be delayed before the formation lap.";
  if (r.startDelayed) return "The start is already delayed.";
  r.startDelayed = true;
  publish("START DELAYED", "Info");
  addAlert("info", "Start delayed. Start the formation lap when the conditions allow it – use \"Wait 5 min\" to let time pass.");
}

// Can the FIA let time pass quickly? (nothing is racing)
function canSkipTime() {
  const r = race;
  if (!r || r.finished) return false;
  if (r.session === "QUALI") return r.status === "RED" || r.q.state === "WAITING" || r.q.state === "BREAK";
  return r.phase === "PRE" || r.status === "RED";
}

function skipTime(minutes) {
  if (!canSkipTime()) return "Time can only be skipped before the start or while the session is suspended.";
  const steps = Math.round(minutes * 60 / DT);
  for (let k = 0; k < steps && canSkipTime(); k++) simStep();
  addAlert("info", minutes + " minutes passed.");
}


// ---------- 3. Abandon a session ----------
function abandonSession(reason) {
  const r = race;
  if (r.finished) return "The session is already over.";
  if (r.session === "QUALI") {
    const q = r.q;
    const completed = q.state === "BREAK" || q.state === "CHEQUERED" ? q.segment : Math.max(0, q.segment - 1);
    r.abandoned = { quali: true, completed, reason: reason || "conditions" };
    q.state = "DONE";
    r.status = r.status === "RED" ? "RED" : r.status;
    r.finished = true;
    publish("SESSION WILL NOT BE RESUMED", "Info");
    if (q.practice) addAlert("info", q.practice + " ended early – the times set so far stand.");
    else addAlert("info", completed === 0
      ? "Qualifying abandoned before " + segName(1) + " was completed – the grid will be decided by the stewards (championship order)."
      : "Qualifying abandoned – the grid is taken from the last completed segment (" + segName(completed) + ").");
    r.ver++;
    return;
  }
  if (r.raceStart === null) {
    r.abandoned = { lap: 0, reason: reason || "conditions" };
  } else {
    const lapsAtSuspension = r.redAtLaps !== undefined && r.status === "RED" ? r.redAtLaps : (r.order[0] ? r.order[0].laps : 0);
    r.abandoned = { lap: Math.max(0, lapsAtSuspension - 1), reason: reason || "conditions" };
  }
  r.finished = true;
  r.phase = "FINISHED";
  publish("RACE WILL NOT BE RESUMED", "Info");
  const k = r.abandoned.lap;
  addAlert("info", k > 0 && r.snapshots && r.snapshots[k]
    ? "Race abandoned. Classification: order at the end of lap " + k + " (count-back). " + (r.greenLaps || 0) + " laps were completed under green flag."
    : "Race abandoned without a valid classification – no points are awarded.");
  r.ver++;
}

// The classification of an abandoned race (same shape as computeResults)
function countbackResults() {
  const r = race;
  const k = r.abandoned.lap;
  const snap = k > 0 && r.snapshots ? r.snapshots[k] : null;
  if (!snap) {
    return r.order.map(car => ({ car, laps: 0, raceTime: null, total: null, penalty: 0, status: "DNF", position: "DNF", gapText: "Not classified (race abandoned)" }));
  }
  const rows = snap.map(s => {
    const car = carById(s.id);
    const down = Math.max(0, k - 1 - s.laps);     // cars on the lead lap have not crossed the line yet
    const status = car.dsq ? "DSQ" : s.running || s.finished ? "Finished" : "DNF";
    return { car, laps: k - down, down, raceTime: null, total: null, penalty: car.pen.time + car.pen.post, status };
  });
  const rank = row => (row.status === "DSQ" ? 2 : row.status === "DNF" ? 1 : 0);
  rows.sort((a, b) => rank(a) - rank(b));
  let pos = 0;
  rows.forEach(row => {
    if (row.status === "DSQ") row.position = "DSQ";
    else if (row.status === "DNF") row.position = "DNF";
    else row.position = String(++pos);
    row.gapText = row.status === "DSQ" ? "Disqualified" : row.status === "DNF" ? (row.car.retireReason || "Retired") :
      pos === 1 ? "Leader after lap " + k : row.down > 0 ? "+" + row.down + (row.down === 1 ? " lap" : " laps") : "count-back lap " + k;
  });
  return rows;
}

// Abandoned qualifying: cars still in the session are ordered by the last completed segment
function abandonedQualiOrder() {
  const r = race;
  const done = r.abandoned.completed;
  const order = qualiOrder();
  if (done === 0) return order;
  const time = car => {
    const lap = bestLapInSegment(car, done);
    return lap ? lap.time : 9999;
  };
  const still = order.filter(c => !c.q.eliminated && !c.dsq).sort((a, b) => time(a) - time(b));
  const out = order.filter(c => c.q.eliminated || c.dsq);
  return still.concat(out);
}


// ---------- 4. Time limits and weather checks (every second) ----------
function fiaTick() {
  const r = race;
  if (r.status === "RED") r.redTime = (r.redTime || 0) + 1;
  const lim = r.setup.limits;
  // the race never started within the time window (e.g. a storm that does not pass)
  if (lim && r.session === "RACE" && r.raceStart === null && r.phase === "PRE" && r.time > lim.window) {
    addAlert("warn", "The " + (lim.window / 3600) + "-hour window has passed without a start.");
    abandonSession("time limit");
    return;
  }
  if (lim && r.session === "RACE" && r.raceStart !== null && !r.finished) {
    const window = r.time - r.raceStart;
    const running = window - (r.redTime || 0);
    if (window > lim.window && !r.chequered) {
      addAlert("warn", "The maximum time of " + (lim.window / 3600) + " hours including suspensions has been reached.");
      if (r.status === "RED") abandonSession("time limit");
      else if (r.phase === "RACE") shortenRace();
    } else if (running > lim.race && !r.chequered && r.phase === "RACE" && r.status !== "RED" && !r.raceTimeWarned) {
      r.raceTimeWarned = true;
      addAlert("warn", "Maximum race time of " + (lim.race / 3600) + " hours reached – the chequered flag is shown at the end of this lap.");
      shortenRace();
    }
  }
  if (!isCellWeather(r)) return;

  // heat hazard: tired drivers when it was not declared (no cooling kits)
  const heat = r.setup.heat;
  if (heat) r.heatStress = !heat.declared && r.weather.air >= heat.threshold;

  // evaluation of the weather decisions
  const e = r.evalData;
  const w = r.weather;
  const running = r.session === "QUALI" ? r.q.state === "RUNNING" && r.status !== "RED"
                                        : r.phase === "RACE" && !r.finished && r.status !== "RED";
  if (running && w.lightningKm < LIGHTNING_KM) e.lightningRunning = (e.lightningRunning || 0) + 1;
  if (running && r.status === "GREEN" && w.wetMax > 0.9) e.aquaGreen = (e.aquaGreen || 0) + 1;
  const blocking = r.obstacles.some(o => !o.cleared && (o.onTrack || o.type === "BARRIER"));
  if (r.status === "RED" && !blocking && w.wetMax < 0.6 && w.lightningKm >= LIGHTNING_KM) e.redNoReason = (e.redNoReason || 0) + 1;
  if (r.heatStress) e.heatUndeclared = (e.heatUndeclared || 0) + 1;
  w.maxSeen = Math.max(w.maxSeen || 0, w.wetMax);
}

function weatherEvaluation() {
  const e = race.evalData;
  let score = 100;
  const notes = [];
  if (e.lightningRunning) {
    score -= Math.min(60, 20 + Math.round(e.lightningRunning / 10));
    notes.push(["bad", "Cars were running for " + e.lightningRunning + " s with lightning closer than " + LIGHTNING_KM + " km – the marshals had to take cover."]);
  }
  if (e.aquaGreen) {
    score -= Math.min(40, 10 + Math.round(e.aquaGreen / 10));
    notes.push(["bad", "Green-flag running for " + e.aquaGreen + " s with standing water on the track."]);
  }
  if ((e.redNoReason || 0) > 600) {
    score -= Math.min(30, Math.round(e.redNoReason / 60));
    notes.push(["ok", "The session stayed suspended for " + Math.round(e.redNoReason / 60) + " min after the conditions had improved."]);
  }
  if (e.heatUndeclared) {
    score -= 15;
    notes.push(["bad", "Heat hazard conditions without a declared heat hazard (no cooling kits) for " + Math.round(e.heatUndeclared / 60) + " min."]);
  }
  if (notes.length === 0) notes.push(["good", "The weather was handled safely."]);
  return { title: "Weather decisions", score: clamp(score, 0, 100), notes };
}
