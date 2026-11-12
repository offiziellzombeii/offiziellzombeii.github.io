// =====================================================================
//  director.js
//  Everything the Race Director (you!) can do.
//  Every function returns an error text when the action is not
//  possible right now, or nothing when it worked.
// =====================================================================

// Send an official message (it appears in the message list, like the FIA messages)
function publish(text, category) {
  const r = race;
  r.messages.push({ id: r.nextId++, t: r.time, lap: r.leaderLap, text, category: category || "Info" });
  r.ver++;
}


// ---------- Start procedure ----------

function startFormationLap() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.phase !== "PRE") return "The formation lap can only start from the grid.";
  r.phase = "FORMATION";
  r.lights.state = "FORMATION";
  for (const car of r.cars) {
    car.jump = 0;
    if (car.mode === "GRID" && !car.pitStart) {
      car.mode = "FORMATION";
      car.formDist = 0;
    }
  }
  publish(r.starts === 0 && !r.lights.aborted ? "FORMATION LAP" : "EXTRA FORMATION LAP", "Info");
}

function startSequence() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.phase !== "GRID_READY") return "All cars must be in their grid positions first.";
  r.phase = "START_SEQ";
  r.lights.state = "RED";
  r.lights.t0 = r.time;
  r.lights.outAt = r.time + 5 + rand(0.2, 3.0);
  r.lights.count = 0;
  r.lights.jumpRolled = false;
}

function abortStart() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.phase !== "GRID_READY" && r.phase !== "START_SEQ") return "There is no start to abort.";
  const L = r.track.length;
  r.phase = "PRE";
  r.lights.state = "ABORT";
  r.lights.aborted = true;
  r.lights.count = 0;
  r.totalLaps -= 1;
  // the new distance is the full race distance: full points (not a "shortened race")
  r.plannedLaps = r.totalLaps;
  if (r.evalData.stallAtStart && r.cars.some(c => c.stalled)) r.evalData.startAborted = true;
  else r.evalData.abortsWithoutReason++;

  publish("START ABORTED", "Info");
  publish("RACE DISTANCE REDUCED TO " + r.totalLaps + " LAPS", "Info");

  for (const car of r.cars) {
    car.jump = 0;
    if (car.mode === "GRID") car.s = car.slotS;
    if (car.stalled) {
      // the stalled car is pushed into the pit lane and starts from there
      car.stalled = false;
      car.pitStart = true;
      car.skipLine = false;
      car.mode = "RACE";
      car.pit.state = "HOLD";
      // behind the cars already waiting in the pit lane (pit lane starters)
      car.s = mod(r.track.pit.exit - 15 - 11 * r.cars.filter(c => c !== car && c.pitStart && c.pit.state === "HOLD").length, L);
      car.lateral = 0;
      publish(carLabel(car) + " WILL START FROM THE PIT LANE", "Info");
    }
  }
}

// Start behind the Safety Car (e.g. heavy rain): no standing start
function startBehindSafetyCar() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.phase !== "GRID_READY" && r.phase !== "PRE") return "Only possible before the start.";
  const L = r.track.length;
  publish("RACE WILL START BEHIND THE SAFETY CAR", "SafetyCar");
  r.startedBehindSc = true; // the rules: a standing start follows once conditions allow
  r.phase = "RACE";
  if (r.raceStart === null) r.raceStart = r.time;
  r.lastStart = r.time;
  r.starts++;
  r.status = "SC";
  r.lights.state = "OFF";
  const pole = r.cars.find(c => c.slot === 0) || r.cars[0];
  r.sc = { s: mod(pole.s + 80, L), speed: 0 };
  // no formation lap: the pit lane starters go straight into the pit lane
  placeInPitLane(r.cars.filter(c => c.pitLaneStart && !c.pitStart && (c.mode === "GRID" || c.mode === "FORMATION")));
  for (const car of r.cars) {
    if (car.pitStart) car.restartOk = false; // pit lane starters follow the SC rules too
    if (car.mode !== "GRID" && car.mode !== "FORMATION") continue;
    if (car.mode === "FORMATION") car.s = car.slotS;
    car.mode = "RACE";
    car.restartOk = false;
    car.stalled = false;
    car.lapStart = r.time;
    car.sectorStart = r.time;
    car.launchTime = r.time;
    car.launchDelay = 0.3 + car.slot * 0.25;
  }
  r.evalData.scCount++;
}


// ---------- Track status ----------

function deployVSC() {
  const r = race;
  if (r.session === "QUALI") return "There is no VSC in " + sessionKind() + " – use yellow flags or the red flag.";
  if (r.phase !== "RACE" || r.chequered) return "Only possible during the race.";
  if (r.status === "SC" || r.status === "RED") return "Not possible while the " + (r.status === "SC" ? "Safety Car" : "red flag") + " is out.";
  r.status = "VSC";
  r.neutralSince = r.time;
  r.evalData.vscCount++;
  disableDrsQuietly();
  for (const car of r.cars) car.passing = null;
  publish("VIRTUAL SAFETY CAR DEPLOYED", "SafetyCar");
}

function endVSC() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.status !== "VSC") return "The VSC is not deployed.";
  r.status = "VSC_ENDING";
  r.vscEndAt = r.time + rand(10, 15);
  publish("VIRTUAL SAFETY CAR ENDING", "SafetyCar");
}

function deploySafetyCar() {
  const r = race;
  if (r.session === "QUALI") return "There is no Safety Car in " + sessionKind() + " – use the red flag.";
  if (r.phase !== "RACE" || r.chequered) return "Only possible during the race.";
  if (r.status === "SC" || r.status === "SC_ENDING") return "The Safety Car is already out.";
  if (r.status === "RED") return "Not possible during a red flag.";
  const L = r.track.length;
  const leader = r.order.find(c => c.mode === "RACE" && isRunning(c) && !c.finished) || r.order[0];
  r.status = "SC";
  r.neutralSince = r.time;
  // the Safety Car comes out of the pit lane (engine.js moveSafetyCar): it waits at the
  // pit exit for a gap, then waits on track until the leader is behind it
  r.sc = { s: r.track.pit.exit, speed: 0, inPit: true, pickedUp: false, since: r.time };
  r.lappedMayOvertake = false;
  r.evalData.scCount++;
  disableDrsQuietly();
  for (const car of r.cars) {
    car.restartOk = false;
    car.passing = null;
  }
  publish("SAFETY CAR DEPLOYED", "SafetyCar");
}

function lappedCarsMayOvertake() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.status !== "SC" || !r.sc) return "Only possible while the Safety Car is on track.";
  if (r.lappedMayOvertake) return "Already allowed.";
  if (r.sc.pickedUp === false) return "Wait until the Safety Car has picked up the leader.";
  if (r.eventNotes && r.eventNotes.lappedAllowed === false) return "Not in this race – the event notes say lapped cars may not overtake under the Safety Car.";
  const L = r.track.length;
  const leader = r.order[0];
  r.lappedMayOvertake = true;
  let count = 0;
  for (const car of r.cars) {
    if (car.mode !== "RACE" || car.pit.state || !isRunning(car) || car === leader) continue;
    // lapped = at least one full lap behind the leader. (A car half a lap behind is on the
    // lead lap: it must not overtake the field – it would gain a lap it never lost.)
    // A car about to be lapped that is between the leader and the Safety Car is waved
    // past as well, so it goes round to the back of the queue.
    const behind = progressOf(leader) - progressOf(car);
    const betweenLeaderAndSc = mod(car.s - leader.s, L) < mod(r.sc.s - leader.s, L);
    if (behind >= L || (behind > L * 0.5 && betweenLeaderAndSc)) {
      car.unlapping = true;
      car.unlapLeft = mod(r.sc.s - car.s, L);
      count++;
    }
  }
  publish("LAPPED CARS MAY OVERTAKE", "SafetyCar");
  if (count === 0) addAlert("info", "There are no lapped cars at the moment.");
}

// The Safety Car comes in at the end of this lap and the race restarts with a STANDING start
// (the rule after a start behind the Safety Car in the rain): the cars line up on the grid in
// race order – lapped cars therefore at the back – and the start lights follow.
function safetyCarInStandingStart() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.status !== "SC" || !r.sc) return "The Safety Car is not on track.";
  if (r.sc.pickedUp === false) return "Wait until the Safety Car has picked up the leader.";
  r.status = "SC_ENDING";
  r.sc.inLap = true;
  r.scStandingStart = true;
  publish("SAFETY CAR IN THIS LAP - THE RACE WILL RESUME WITH A STANDING START", "SafetyCar");
}

// Called when the Safety Car enters the pit lane with a standing start planned
function standingStartAfterSc() {
  const r = race;
  const L = r.track.length;
  r.scStandingStart = false;
  const running = r.order.filter(c => isRunning(c) && !c.finished && c.mode === "RACE");
  const onTrack = running.filter(c => !c.pit.state);
  const inPit = running.filter(c => c.pit.state);
  onTrack.forEach((car, k) => {
    car.slot = k;
    car.slotS = mod(-12 - 8 * k, L);
    car.mode = "FORMATION";
    car.formDist = 1000;       // already on the way to the grid: stop at the grid box
    car.formDelay = 0;
    car.lapOnGrid = true;      // the start completes the lap driven behind the Safety Car
    car.restartOk = true;
    car.passing = null;
    car.unlapping = false;
    car.catchingUp = false;
    car.rejoinUntil = 0;
  });
  // cars in the pit lane start from the pit lane (they wait at the closed pit exit)
  inPit.forEach((car, i) => { car.slot = onTrack.length + i; });
  r.phase = "FORMATION";
  r.lights.state = "FORMATION";
  r.status = "GREEN";
  r.lappedMayOvertake = false;
  r.pitExitOpen = false;
  publish("PIT EXIT CLOSED", "Info");
  addAlert("info", "The cars go to their grid boxes in race order (lapped cars at the back). Start the lights when all are in place" +
    (inPit.length ? " – " + inPit.map(c => c.code).join(", ") + " will start from the pit lane." : "."));
  updateOrder();
}

function safetyCarInThisLap() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.status !== "SC" || !r.sc) return "The Safety Car is not on track.";
  if (r.sc.pickedUp === false) return "Wait until the Safety Car has picked up the leader.";
  r.status = "SC_ENDING";
  r.sc.inLap = true;
  publish("SAFETY CAR IN THIS LAP", "SafetyCar");
}

function redFlag() {
  const r = race;
  if (r.session === "QUALI") return qualiRedFlag();
  if (r.phase !== "RACE" || r.chequered) return "Only possible during the race.";
  if (r.status === "RED") return "The red flag is already out.";
  r.status = "RED";
  r.redAtLaps = r.order[0] ? r.order[0].laps : 0; // for the count-back if the race is abandoned
  r.redOrder = r.order.filter(c => isRunning(c));
  freezeGaps(); // the timing screen keeps the gaps of the moment of the red flag
  r.redQueueCount = 0;
  r.releaseQueue = []; // cars of an earlier suspension still waiting: they queue again
  r.sc = null;
  r.pitExitOpen = false;
  r.evalData.redCount++;
  disableDrsQuietly();
  for (const car of r.cars) {
    car.restartOk = false;
    car.passing = null;
    car.unlapping = false;
  }
  publish("RED FLAG", "Flag");
  publish("PIT EXIT CLOSED", "Info");
}

// type: "STANDING" or "ROLLING"
function resumeRace(type) {
  const r = race;
  if (r.session === "QUALI") return resumeQualifying();
  if (r.status !== "RED") return "The race is not suspended.";
  const L = r.track.length;
  const tr = r.track;

  const stillOnTrack = r.cars.filter(c => isRunning(c) && c.mode === "RACE" && c.pit.state !== "REDSTOP" && c.pit.state !== "HOLD");
  if (stillOnTrack.length > 0) return "Not all cars are in the pit lane yet (" + stillOnTrack.map(c => c.code).join(", ") + ").";
  const open = r.obstacles.filter(o => !o.cleared && (o.onTrack || o.type === "BARRIER"));
  if (open.length > 0) return "The track is not clear yet: " + open.map(o => o.label).join(", ") + ".";

  // new order = classification when the red flag came out
  const order = (r.redOrder || r.order).filter(c => isRunning(c) && !c.finished);
  order.forEach((car, k) => {
    car.pit.state = "HOLD";
    car.pit.reason = null;
    car.pitStart = false; // a pit lane starter that had not left yet now waits in the queue like everyone
    car.s = mod(tr.pit.exit - 15 - 11 * k, L);
    car.speed = 0;
    car.passing = null;
    car.spin = 0;
    // tyres may be changed for free during a red flag
    const compound = chooseCompound(car);
    car.tyre = { compound, age: 0, wear: 0 };
    if (!car.tyresUsed.includes(compound)) car.tyresUsed.push(compound);
    car.damage.wing = false;
    car.damage.puncture = false;
    car.slot = k;
    car.slotS = mod(-12 - 8 * k, L);
    if (type === "STANDING") {
      car.mode = "FORMATION";
      car.formDist = 0;
      car.restartOk = true;
    } else {
      car.restartOk = false;
      // A long queue reaches back behind the finish line (in the pit lane). Those cars
      // cross the line when they leave – that is not a new lap (else the last car of the
      // queue would suddenly be a lap ahead and lead the race).
      car.skipLine = car.s > tr.pit.exit && car.laps >= r.redAtLaps;
    }
  });

  r.releaseQueue = order.slice();
  r.nextRelease = r.time + 3;
  r.redEndAt = r.time;
  r.pitExitOpen = true;
  r.resumeType = type;
  r.sectorFlags.fill("GREEN");
  r.flagPanels = [];
  r.slippery.fill(false);

  if (type === "STANDING") {
    r.status = "GREEN";
    r.phase = "FORMATION";
    r.lights.state = "FORMATION";
    publish("RACE WILL RESUME WITH A STANDING START", "Info");
  } else {
    r.status = "SC";
    r.sc = { s: mod(tr.pit.exit + 120, L), speed: 0 };
    publish("RACE WILL RESUME BEHIND THE SAFETY CAR", "SafetyCar");
  }
  publish("GREEN LIGHT - PIT EXIT OPEN", "Info");
}

function shortenRace() {
  if (race.session === "QUALI") return "Not available in " + sessionKind() + ".";
  const r = race;
  if (r.phase !== "RACE" || r.chequered) return "Only possible during the race.";
  const leader = r.order[0];
  r.totalLaps = leader.laps + 1;
  publish("CHEQUERED FLAG WILL BE SHOWN AT THE END OF LAP " + r.totalLaps, "Flag");
}


// ---------- Sector flags ----------

// Digital flag panels: a flag that was set needs 1–2 s until the light panels of the marshal
// sector show it. r.sectorFlags = what Race Control ordered; shownFlag() = what the drivers see.
function shownFlag(index) {
  const r = race;
  const p = r.flagPanels && r.flagPanels[index];
  return p && r.time < p.at ? p.prev : r.sectorFlags[index];
}

function flagPanelPending(index) {
  const r = race;
  const p = r.flagPanels && r.flagPanels[index];
  return !!(p && r.time < p.at);
}

function switchFlagPanel(index, flag) {
  const r = race;
  r.flagPanels = r.flagPanels || [];
  r.flagPanels[index] = { prev: shownFlag(index), at: r.time + rand(1, 2) };
  r.sectorFlags[index] = flag;
}

// index = 0-based marshal sector, flag = GREEN, YELLOW, DOUBLE
function setSectorFlag(index, flag, source) {
  const r = race;
  if (r.sectorFlags[index] === flag) return;
  switchFlagPanel(index, flag);
  r.flagSource[index] = source || "RC";
  const n = index + 1;
  if (flag === "YELLOW") publish("YELLOW IN TRACK SECTOR " + n, "Flag");
  else if (flag === "DOUBLE") publish("DOUBLE YELLOW IN TRACK SECTOR " + n, "Flag");
  else publish("CLEAR IN TRACK SECTOR " + n, "Flag");
  r.ver++;
}

function setSlippery(index, on) {
  const r = race;
  if (r.slippery[index] === on) return;
  r.slippery[index] = on;
  publish((on ? "SLIPPERY SURFACE" : "TRACK SURFACE CLEAR") + " IN TRACK SECTOR " + (index + 1), "Flag");
}

// ---------- Rain signal (the rain symbol of the LED flag panels: a cloud with falling rain) ----------
// Per marshal sector, or for the whole track. The drivers are warned: they take more care there.
function rainShown(index) {
  const r = race;
  return !!(r.rainFlags && r.rainFlags[index]);
}

function anyRainShown() {
  const r = race;
  return !!(r.rainFlags && r.rainFlags.some(Boolean));
}

// source: "RC" (Race Control) or "MARSHAL" (the marshal post on its own – it also takes it back)
function setRainFlag(index, on, source, quiet) {
  const r = race;
  r.rainFlags = r.rainFlags || new Array(r.sectorFlags.length).fill(false);
  r.rainSource = r.rainSource || new Array(r.sectorFlags.length).fill("RC");
  if (!!r.rainFlags[index] === on) return false;
  r.rainFlags[index] = on;
  r.rainSource[index] = source || "RC";
  if (!quiet) publish((on ? "RAIN" : "RAIN SIGNAL WITHDRAWN") + " IN TRACK SECTOR " + (index + 1), "Flag");
  r.ver++;
  return true;
}

// one message for several sectors: "RAIN IN TRACK SECTORS 3, 4, 5" (all of them: "RAIN ON TRACK")
function publishRainSectors(list, on) {
  if (!list.length) return;
  const all = list.length === race.sectorFlags.length;
  publish(on ? (all ? "RAIN ON TRACK - RAIN SIGNAL SHOWN IN ALL TRACK SECTORS" : "RAIN IN TRACK SECTOR" + (list.length > 1 ? "S " : " ") + list.map(i => i + 1).join(", "))
    : (all ? "RAIN SIGNAL WITHDRAWN IN ALL TRACK SECTORS" : "RAIN SIGNAL WITHDRAWN IN TRACK SECTOR" + (list.length > 1 ? "S " : " ") + list.map(i => i + 1).join(", ")), "Flag");
}

// the whole track at once (one message): "Rain" without a selected sector
function setRainAll(on) {
  const r = race;
  r.rainFlags = r.rainFlags || new Array(r.sectorFlags.length).fill(false);
  r.rainSource = r.rainSource || new Array(r.sectorFlags.length).fill("RC");
  if (r.rainFlags.every(x => !!x === on)) return;
  r.rainFlags.fill(on);
  r.rainSource.fill("RC");
  publish(on ? "RAIN ON TRACK - RAIN SIGNAL SHOWN IN ALL TRACK SECTORS" : "RAIN SIGNAL WITHDRAWN IN ALL TRACK SECTORS", "Flag");
  r.ver++;
}

// Marshals show the rain signal on their own (option, like the local yellows): on when it
// rains in their sector, off again after a minute without rain (only the ones they set)
function marshalRainTick() {
  const r = race;
  if (!r.autoMarshalRain || r.status === "RED") return;
  const w = r.weather;
  r.rainDrySince = r.rainDrySince || [];
  const on = [];
  const off = [];
  for (let i = 0; i < r.sectorFlags.length; i++) {
    const rain = w.rainS ? w.rainS[i] : w.rain;
    if (rain > 0.12) {
      r.rainDrySince[i] = null;
      if (!rainShown(i) && setRainFlag(i, true, "MARSHAL", true)) on.push(i);
    } else if (rainShown(i) && r.rainSource && r.rainSource[i] === "MARSHAL" && rain < 0.03) {
      if (r.rainDrySince[i] == null) r.rainDrySince[i] = r.time;
      else if (r.time - r.rainDrySince[i] > 60 && setRainFlag(i, false, "MARSHAL", true)) off.push(i);
    }
  }
  // the posts that changed in the same second: one message
  publishRainSectors(on, true);
  publishRainSectors(off, false);
}

function clearAllSectors() {
  const r = race;
  let changed = false;
  for (let i = 0; i < r.sectorFlags.length; i++) {
    if (r.sectorFlags[i] !== "GREEN") {
      switchFlagPanel(i, "GREEN");
      r.flagSource[i] = "RC";
      changed = true;
    }
  }
  if (changed) publish("ALL TRACK SECTORS CLEAR", "Flag");
}


// ---------- Event notes (before the session) ----------
// The corners where track limits are monitored, the pit lane speed limit and free notes.
// Without notes the suggested corners (corner.trackLimits) and 80 km/h apply.
// The standard notes of a track (gen2026: Straight Mode zones instead of DRS zones)
function defaultNotesFor(track, gen2026, maxDelta) {
  const zones = gen2026 ? track.straightZones || [] : track.drsZones;
  return {
    corners: track.corners.filter(c => c.trackLimits).map(c => c.number), pitKmh: 80, text: "", published: false,
    tlBwAt: 3, tlPenaltyAt: 4,                     // track limits tolerance
    pitExitLine: true, scPitClosed: false,         // pit lane rules
    zonesOff: zones.map(() => false),              // DRS / Straight Mode zones switched off
    maxDelta: maxDelta !== undefined ? maxDelta : true, lappedAllowed: true, // max delta & SC rules
    practiceStarts: "PIT_EXIT", tyreChecks: false, blueGap: 1.2
  };
}

function defaultEventNotes() {
  const r = race;
  return defaultNotesFor(r.track, is2026(), r.session === "QUALI" ? r.q.maxDelta : true);
}

// checked values on top of the standard notes
function normaliseNotes(notes, defaults) {
  const n = Object.assign(defaults, notes);
  n.corners = n.corners.slice().sort((a, b) => a - b);
  n.pitKmh = n.pitKmh === 60 ? 60 : 80;
  n.tlBwAt = clamp(Math.round(n.tlBwAt), 1, 9);
  n.tlPenaltyAt = clamp(Math.round(n.tlPenaltyAt), n.tlBwAt + 1, 12);
  n.published = true;
  return n;
}

const PRACTICE_START_TEXT = { PIT_EXIT: "only at the end of the pit exit", AFTER_LIGHT: "on the right side of the track after the pit exit light", NONE: "not allowed" };

// The rules of the notes for the running session. A championship weekend applies the notes
// that were published before FP1 at the start of every session (createRace, quietly).
function applyEventNotes(n) {
  const r = race;
  r.eventNotes = n;
  r.pitLimitKmh = n.pitKmh;
  r.tlBwAt = n.tlBwAt;
  r.tlPenaltyAt = n.tlPenaltyAt;
  r.blueGap = n.blueGap;
  if (is2026()) r.straightOff = (n.zonesOff || []).slice();
  else r.drsOff = (n.zonesOff || []).slice();
  if (r.session === "QUALI" && r.q.maxDelta !== !!n.maxDelta) r.q.maxDelta = !!n.maxDelta;
}

// A single session (fictitious / historic): the Race Director publishes the notes before the start
function publishEventNotes(notes) {
  const r = race;
  if (r.setup.seasonContext) return "In a championship the event notes are published before FP1 for the whole weekend (championship overview).";
  const before = r.session === "QUALI" ? r.q.state === "WAITING" : r.phase === "PRE";
  if (!before) return "Event notes can only be published before the session starts.";
  const n = normaliseNotes(notes, defaultEventNotes());
  n.t = r.time;
  applyEventNotes(n);

  publish("EVENT NOTES: PIT LANE SPEED LIMIT " + r.pitLimitKmh + " KM/H", "Info");
  publish("TRACK LIMITS MONITORED AT " + (n.corners.length ? n.corners.map(x => "T" + x).join(", ") : "NO CORNER") +
    (r.session === "QUALI" ? "" : " - BLACK AND WHITE FLAG AFTER " + n.tlBwAt + ", PENALTY AFTER " + n.tlPenaltyAt + " LAP TIMES DELETED"), "Info");
  const off = n.zonesOff.map((x, i) => (x ? i + 1 : 0)).filter(Boolean);
  if (off.length) publish((is2026() ? "STRAIGHT MODE ZONE" : "DRS ZONE") + (off.length > 1 ? "S " : " ") + off.join(", ") + " DISABLED FOR THIS SESSION", "Info");
  if (!n.pitExitLine) publish("CROSSING THE PIT EXIT LINE WILL NOT BE INVESTIGATED", "Info");
  if (n.scPitClosed && r.session !== "QUALI") publish("UNDER THE SAFETY CAR THE PIT ENTRY IS CLOSED UNTIL THE FIELD IS BEHIND THE SAFETY CAR", "Info");
  if (r.session !== "QUALI" && !n.lappedAllowed) publish("LAPPED CARS WILL NOT BE ALLOWED TO OVERTAKE UNDER THE SAFETY CAR", "Info");
  if (r.session !== "QUALI") publish("BLUE FLAGS: A FASTER CAR WITHIN " + n.blueGap.toFixed(1) + " SECONDS", "Info");
  if (r.session === "QUALI") publish("PRACTICE STARTS: " + PRACTICE_START_TEXT[n.practiceStarts].toUpperCase(), "Info");
  if (n.tyreChecks) publish("THE TECHNICAL DELEGATE WILL CHECK THE MINIMUM TYRE PRESSURES IN THIS SESSION", "Info");
  if (n.text) publish("RACE DIRECTOR'S NOTE: " + n.text.toUpperCase(), "Info");
  r.ver++;
}

// Rules of the event notes that act during the session (once per second, engine.js)
function eventRulesTick() {
  const r = race;
  const n = r.eventNotes;
  if (!n || !n.scPitClosed || r.session === "QUALI") return;
  // pit entry closed under the Safety Car until the leader is behind it
  if (r.status === "SC" && r.sc && !r.scPitHeld && r.scPitHeldFor !== r.evalData.scCount) {
    r.scPitHeld = true;
    r.scPitHeldFor = r.evalData.scCount;
    if (r.pitEntryOpen) setPitEntry(false);
  }
  if (r.scPitHeld) {
    const leader = r.order.find(c => c.mode === "RACE" && isRunning(c));
    const caught = r.sc && leader && mod(r.sc.s - leader.s, r.track.length) < 150;
    if (caught || r.status !== "SC") {
      r.scPitHeld = false;
      if (!r.pitEntryOpen) setPitEntry(true);
    }
  }
}

// Are track limits monitored at this corner?
function cornerMonitored(corner) {
  const notes = race.eventNotes;
  return notes ? notes.corners.includes(corner.number) : !!corner.trackLimits;
}

// The pit lane speed limit in m/s (event notes, default 80 km/h)
function pitLimitMs() {
  return ((race && race.pitLimitKmh) || 80) / 3.6;
}


// ---------- Pit lane, DRS, weather ----------

function setPitEntry(open) {
  const r = race;
  if (r.pitEntryOpen === open) return;
  r.pitEntryOpen = open;
  publish(open ? "PIT ENTRY OPEN" : "PIT ENTRY CLOSED", "Info");
}

function setPitExit(open) {
  const r = race;
  if (r.pitExitOpen === open) return;
  if (open && r.status === "RED" && r.releaseQueue.length === 0) return "Use 'Resume race' to end the red flag.";
  r.pitExitOpen = open;
  publish(open ? "GREEN LIGHT - PIT EXIT OPEN" : "PIT EXIT CLOSED", "Info");
}

// DRS (2023–2025) or Overtake Mode (2026) – see regs.js
function setDRS(on) {
  return setOvertakeAid(on);
}

function disableDrsQuietly() {
  disableOvertakeAidQuietly();
}

function declareWetRace() {
  const r = race;
  if (r.wetDeclared) return "The race is already declared wet.";
  r.wetDeclared = true;
  publish("RACE DECLARED WET", "Info");
}

function sendCustomMessage(text) {
  if (!text.trim()) return "Please type a message.";
  publish(text.trim().toUpperCase(), "Info");
}


// ---------- Flags for one car ----------

function showCarFlag(car, flag) {
  const r = race;
  if (!isRunning(car) || car.finished) return "This car is not running.";
  if (flag === "BW") {
    car.flag = "BW";
    car.bwShown = true;
    r.evalData.bwShown++;
    publish("BLACK AND WHITE FLAG FOR " + carLabel(car) + " - " + (car.tlStrikes >= 3 ? "TRACK LIMITS" : "UNSPORTSMANLIKE BEHAVIOUR"), "Flag");
  } else if (flag === "BO") {
    car.flag = "BO";
    publish("BLACK AND ORANGE FLAG FOR " + carLabel(car) + " - DAMAGE", "Flag");
    if (!car.damage.wing && !car.damage.puncture) addAlert("info", carLabel(car) + " has no visible damage – the team is confused.", { carId: car.id });
  } else if (flag === "BLACK") {
    disqualify(car);
  }
}


// ---------- Incidents ----------

function incidentMessage(inc, ending) {
  const reason = inc.offence.toUpperCase();
  return incidentHeadline(inc) + " " + ending + (reason ? " - " + reason : "");
}

function noteIncident(inc) {
  if (inc.status !== "NEW") return "Already handled.";
  inc.status = "NOTED";
  publish(incidentMessage(inc, "NOTED"), "Stewards");
}

function investigateIncident(inc) {
  if (inc.status !== "NEW" && inc.status !== "NOTED") return "Already handled.";
  inc.status = "INVESTIGATING";
  publish("FIA STEWARDS: " + incidentMessage(inc, "UNDER INVESTIGATION"), "Stewards");
}

function investigateAfterRace(inc) {
  if (inc.status !== "NEW" && inc.status !== "NOTED" && inc.status !== "INVESTIGATING") return "Already handled.";
  inc.status = "AFTER_RACE";
  publish("FIA STEWARDS: " + incidentMessage(inc, "WILL BE INVESTIGATED AFTER THE " + (race.session === "QUALI" ? "SESSION" : "RACE")), "Stewards");
}

function noInvestigation(inc) {
  if (inc.status !== "NEW" && inc.status !== "NOTED") return "Already handled.";
  inc.status = "NFI";
  publish("FIA STEWARDS: " + incidentHeadline(inc) + " REVIEWED NO FURTHER INVESTIGATION", "Stewards");
}

// perCar = { carId: { code: "5S", points: 2 } }
function decideIncident(inc, perCar) {
  const r = race;
  if (inc.status === "DECIDED") return "Already decided.";
  if (inc.status === "AFTER_RACE" && !r.finished) return "You decided to investigate this after the session. Wait until it is over.";
  inc.decision = { perCar, t: r.time, lap: r.leaderLap, seq: r.nextId++ }; // seq: order of the decisions (precedents)
  inc.docNo = (r.docCount = (r.docCount || 0) + 1); // the number of its decision document (per weekend in the championship)
  inc.status = "DECIDED";

  let anyPenalty = false;
  for (const id in perCar) {
    const car = carById(Number(id));
    const d = perCar[id];
    if (!car || d.code === "NFA") continue;
    anyPenalty = true;
    applyPenalty(car, d.code, d.points, inc.offence, inc);
    let text = "FIA STEWARDS: " + penaltyText(d.code) + " FOR " + carLabel(car) + " - " + inc.offence.toUpperCase();
    if (d.points > 0) text += " (" + d.points + " PENALTY POINT" + (d.points > 1 ? "S" : "") + ")";
    publish(text, "Stewards");
  }
  if (!anyPenalty) publish("FIA STEWARDS: " + incidentHeadline(inc) + " REVIEWED - NO FURTHER ACTION", "Stewards");
  inc.evaluation = evaluateDecision(inc);
  r.ver++;
}

// Open an investigation yourself (something you saw on the map)
function openManualInvestigation(carIds, offence) {
  const cars = carIds.map(carById).filter(Boolean);
  if (cars.length === 0) return "Choose at least one car.";
  const inc = makeIncident("MANUAL", cars, {
    offence,
    summary: "Opened by Race Control.",
    evidence: [["Source", "Race Control observation"], ["Note", "No automatic evidence – judge from the replay and the timing."]]
  });
  inc.status = "INVESTIGATING";
  publish("FIA STEWARDS: " + incidentMessage(inc, "UNDER INVESTIGATION"), "Stewards");
}


// ---------- Track limits ----------

function deleteLapTime(item) {
  const r = race;
  if (item.status !== "NEW") return "Already handled.";
  const car = carById(item.carId);
  item.status = "DELETED";
  car.invalidLaps[item.lap] = true;

  const lap = car.lapTimes.find(l => l.lap === item.lap);
  const clock = formatDayTime(r.clockStart + item.t);
  if (lap) {
    lap.valid = false;
    car.bestLap = null;
    for (const l of car.lapTimes) {
      if (l.valid && !l.pitLane && (!car.bestLap || l.time < car.bestLap.time)) car.bestLap = l;
    }
    publish(carLabel(car) + " TIME " + formatLapTime(lap.time) + " DELETED - TRACK LIMITS AT " +
      item.corner.toUpperCase() + " LAP " + item.lap + " " + clock, "TrackLimits");
  } else {
    publish(carLabel(car) + " LAP " + item.lap + " TIME DELETED - TRACK LIMITS AT " + item.corner.toUpperCase() + " " + clock, "TrackLimits");
  }

  car.tlStrikes++;
  if (r.session === "QUALI") {
    r.ver++;
    return; // in qualifying the deleted lap is the penalty
  }
  // the limits of the event notes (default: black & white flag after 3, a penalty after 4 and 8)
  const bwAt = r.tlBwAt || 3;
  const penAt = r.tlPenaltyAt || 4;
  if (car.tlStrikes === bwAt) {
    r.evalData.bwNeeded++;
    addAlert("warn", carLabel(car) + " has now exceeded the track limits " + bwAt + " times – show the BLACK AND WHITE flag.", { carId: car.id });
  }
  if (car.tlStrikes === penAt || car.tlStrikes === 2 * penAt) trackLimitsRepeatIncident(car);
  r.ver++;
}

function dismissTrackLimits(item) {
  if (item.status !== "NEW") return "Already handled.";
  item.status = "DISMISSED";
  race.ver++;
}
