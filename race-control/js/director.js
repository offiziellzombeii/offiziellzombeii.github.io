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
  if (race.session === "QUALI") return "Not available in qualifying.";
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
  if (race.session === "QUALI") return "Not available in qualifying.";
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
  if (race.session === "QUALI") return "Not available in qualifying.";
  const r = race;
  if (r.phase !== "GRID_READY" && r.phase !== "START_SEQ") return "There is no start to abort.";
  const L = r.track.length;
  r.phase = "PRE";
  r.lights.state = "ABORT";
  r.lights.aborted = true;
  r.lights.count = 0;
  r.totalLaps -= 1;
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
      car.s = mod(r.track.pit.exit - 15, L);
      car.lateral = 0;
      publish(carLabel(car) + " WILL START FROM THE PIT LANE", "Info");
    }
  }
}

// Start behind the Safety Car (e.g. heavy rain): no standing start
function startBehindSafetyCar() {
  if (race.session === "QUALI") return "Not available in qualifying.";
  const r = race;
  if (r.phase !== "GRID_READY" && r.phase !== "PRE") return "Only possible before the start.";
  const L = r.track.length;
  publish("RACE WILL START BEHIND THE SAFETY CAR", "SafetyCar");
  r.phase = "RACE";
  if (r.raceStart === null) r.raceStart = r.time;
  r.lastStart = r.time;
  r.starts++;
  r.status = "SC";
  r.lights.state = "OFF";
  const pole = r.cars.find(c => c.slot === 0) || r.cars[0];
  r.sc = { s: mod(pole.s + 80, L), speed: 0 };
  for (const car of r.cars) {
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
  if (r.session === "QUALI") return "There is no VSC in qualifying – use yellow flags or the red flag.";
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
  if (race.session === "QUALI") return "Not available in qualifying.";
  const r = race;
  if (r.status !== "VSC") return "The VSC is not deployed.";
  r.status = "VSC_ENDING";
  r.vscEndAt = r.time + rand(10, 15);
  publish("VIRTUAL SAFETY CAR ENDING", "SafetyCar");
}

function deploySafetyCar() {
  const r = race;
  if (r.session === "QUALI") return "There is no Safety Car in qualifying – use the red flag.";
  if (r.phase !== "RACE" || r.chequered) return "Only possible during the race.";
  if (r.status === "SC" || r.status === "SC_ENDING") return "The Safety Car is already out.";
  if (r.status === "RED") return "Not possible during a red flag.";
  const L = r.track.length;
  const leader = r.order.find(c => c.mode === "RACE" && isRunning(c) && !c.finished) || r.order[0];
  r.status = "SC";
  r.neutralSince = r.time;
  r.sc = { s: mod(leader.s + 300, L), speed: Math.max(30, leader.speed * 0.6) };
  r.scInPit = false;
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
  if (race.session === "QUALI") return "Not available in qualifying.";
  const r = race;
  if (r.status !== "SC" || !r.sc) return "Only possible while the Safety Car is on track.";
  if (r.lappedMayOvertake) return "Already allowed.";
  const L = r.track.length;
  const leader = r.order[0];
  r.lappedMayOvertake = true;
  let count = 0;
  for (const car of r.cars) {
    if (car.mode !== "RACE" || car.pit.state || !isRunning(car) || car === leader) continue;
    if (progressOf(leader) - progressOf(car) > L * 0.5) {
      car.unlapping = true;
      car.unlapLeft = mod(r.sc.s - car.s, L);
      count++;
    }
  }
  publish("LAPPED CARS MAY OVERTAKE", "SafetyCar");
  if (count === 0) addAlert("info", "There are no lapped cars at the moment.");
}

function safetyCarInThisLap() {
  if (race.session === "QUALI") return "Not available in qualifying.";
  const r = race;
  if (r.status !== "SC" || !r.sc) return "The Safety Car is not on track.";
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
  r.redQueueCount = 0;
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
    }
  });

  r.releaseQueue = order.slice();
  r.nextRelease = r.time + 3;
  r.pitExitOpen = true;
  r.resumeType = type;
  r.sectorFlags.fill("GREEN");
  r.slippery.fill(false);

  if (type === "STANDING") {
    r.status = "GREEN";
    r.phase = "FORMATION";
    r.lights.state = "FORMATION";
    publish("RACE WILL RESUME WITH A STANDING START", "Info");
  } else {
    r.status = "SC";
    r.sc = { s: mod(tr.pit.exit + 120, L), speed: 0 };
    r.scInPit = false;
    publish("RACE WILL RESUME BEHIND THE SAFETY CAR", "SafetyCar");
  }
  publish("GREEN LIGHT - PIT EXIT OPEN", "Info");
}

function shortenRace() {
  if (race.session === "QUALI") return "Not available in qualifying.";
  const r = race;
  if (r.phase !== "RACE" || r.chequered) return "Only possible during the race.";
  const leader = r.order[0];
  r.totalLaps = leader.laps + 1;
  publish("CHEQUERED FLAG WILL BE SHOWN AT THE END OF LAP " + r.totalLaps, "Flag");
}


// ---------- Sector flags ----------

// index = 0-based marshal sector, flag = GREEN, YELLOW, DOUBLE
function setSectorFlag(index, flag, source) {
  const r = race;
  if (r.sectorFlags[index] === flag) return;
  r.sectorFlags[index] = flag;
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

function clearAllSectors() {
  const r = race;
  let changed = false;
  for (let i = 0; i < r.sectorFlags.length; i++) {
    if (r.sectorFlags[i] !== "GREEN") {
      r.sectorFlags[i] = "GREEN";
      r.flagSource[i] = "RC";
      changed = true;
    }
  }
  if (changed) publish("ALL TRACK SECTORS CLEAR", "Flag");
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
  inc.decision = { perCar, t: r.time, lap: r.leaderLap };
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
  if (car.tlStrikes === 3) {
    r.evalData.bwNeeded++;
    addAlert("warn", carLabel(car) + " has now exceeded the track limits 3 times – show the BLACK AND WHITE flag.", { carId: car.id });
  }
  if (car.tlStrikes === 4 || car.tlStrikes === 8) trackLimitsRepeatIncident(car);
  r.ver++;
}

function dismissTrackLimits(item) {
  if (item.status !== "NEW") return "Already handled.";
  item.status = "DISMISSED";
  race.ver++;
}
