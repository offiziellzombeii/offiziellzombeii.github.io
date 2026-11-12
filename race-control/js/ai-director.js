// =====================================================================
//  ai-director.js
//  An automatic Race Director and automatic Stewards.
//  Used when a championship session is auto-simulated: the session runs
//  at full speed without drawing, and these functions take the
//  decisions the player would take in the control room.
//
//  Race Director:
//   - start procedure (formation lap, lights, abort if a car stalls,
//     start behind the Safety Car in heavy rain)
//   - local yellow / double yellow flags, clearing the sectors again
//   - VSC, Safety Car, red flag and the restart
//   - DRS / Overtake Mode / Straight Mode, wet race declaration
//   - black-and-white flag after repeated track limits
//  Stewards:
//   - every incident is decided by the guideline (inc.truth)
//   - track limits: lap time deleted when it really was a violation
//   Reaction times are a few seconds, like a real Race Control.
// =====================================================================

function makeAiDirector() {
  return {
    seen: {},          // obstacle / incident / track limits id -> first time seen
    flagSince: {},     // sector -> time since when there is nothing left in it
    scClearSince: null,
    lappedCalledAt: null,
    nextBreakStart: null,
    bwShown: {},
    lastLightning: -9999,
    lastTick: -1
  };
}

// Called every simulation step; works twice per simulated second
function aiTick(ai) {
  const r = race;
  if (r.time - ai.lastTick < 0.5) return;
  ai.lastTick = r.time;
  r.autoRecovery = true; // the AI Race Director sends the recovery crews at once
  aiStewards(ai);
  if (r.session === "QUALI") aiQualifying(ai);
  else aiRace(ai);
}

// Lightning closer than the safety distance? (remembers when it was last seen)
function aiLightning(ai) {
  const km = race.weather.lightningKm;
  if (km !== undefined && km < LIGHTNING_KM) {
    ai.lastLightning = race.time;
    return true;
  }
  return false;
}

function aiSeen(ai, key) {
  if (ai.seen[key] === undefined) ai.seen[key] = race.time;
  return race.time - ai.seen[key];
}


// ---------- Stewards ----------
function aiStewards(ai) {
  const r = race;
  for (const inc of r.incidents) {
    if (inc.status === "DECIDED" || inc.status === "NFI") continue;
    const age = aiSeen(ai, "inc" + inc.id);
    const truth = inc.truth;
    if (!truth || !truth.culprit || truth.penalty === "NFA") {
      if (age > 8 && (inc.status === "NEW" || inc.status === "NOTED")) noInvestigation(inc);
      else if (age > 8 && inc.status !== "NFI") decideIncident(inc, {});
      continue;
    }
    if (inc.status === "NEW" && age > 6) investigateIncident(inc);
    // the decision takes the stewards one to two minutes
    if (inc.status === "INVESTIGATING" && age > 60 + (inc.id % 7) * 10) {
      decideIncident(inc, { [truth.culprit]: { code: truth.penalty, points: truth.points || 0 } });
    }
    if (inc.status === "AFTER_RACE" && r.finished) {
      decideIncident(inc, { [truth.culprit]: { code: truth.penalty, points: truth.points || 0 } });
    }
  }
  for (const item of r.trackLimits) {
    if (item.status !== "NEW" || aiSeen(ai, "tl" + item.id) < 5) continue;
    if (item.violation) deleteLapTime(item);
    else dismissTrackLimits(item);
  }
}

// Before the report: whatever is still open is decided now
function aiCloseAllIncidents(ai) {
  const r = race;
  for (const inc of r.incidents) {
    if (inc.status === "DECIDED" || inc.status === "NFI") continue;
    const truth = inc.truth;
    if (inc.status === "AFTER_RACE" && !r.finished) inc.status = "INVESTIGATING";
    if (!truth || !truth.culprit || truth.penalty === "NFA") decideIncident(inc, {});
    else decideIncident(inc, { [truth.culprit]: { code: truth.penalty, points: truth.points || 0 } });
  }
  for (const item of r.trackLimits) {
    if (item.status !== "NEW") continue;
    if (item.violation) deleteLapTime(item);
    else dismissTrackLimits(item);
  }
}


// ---------- Flags in the marshal sectors ----------
function aiSectorFlags(ai) {
  const r = race;
  const open = r.obstacles.filter(o => !o.cleared);
  const busy = new Set();
  for (const ob of open) {
    if (aiSeen(ai, "ob" + ob.id) < 2) continue; // the marshal post reports first
    const i = ob.sector - 1;
    busy.add(i);
    if (r.status === "RED") continue;
    if (ob.onTrack || ob.type === "BARRIER" || ob.type === "MEDICAL") {
      if (r.sectorFlags[i] !== "DOUBLE") setSectorFlag(i, "DOUBLE");
    } else if (r.sectorFlags[i] === "GREEN") {
      setSectorFlag(i, "YELLOW");
    }
  }
  // cars that just spun or stopped also keep the sector yellow
  for (const car of r.cars) {
    if (car.spin > 0 || (car.mode === "STOPPED" && !car.hidden)) busy.add(marshalSectorAt(r.track, car.s) - 1);
  }
  for (let i = 0; i < r.sectorFlags.length; i++) {
    if (r.sectorFlags[i] === "GREEN" || busy.has(i)) {
      delete ai.flagSince[i];
      continue;
    }
    if (ai.flagSince[i] === undefined) ai.flagSince[i] = r.time;
    if (r.time - ai.flagSince[i] > 6) {
      setSectorFlag(i, "GREEN");
      delete ai.flagSince[i];
    }
  }
  if (r.slippery.some(Boolean) && !r.obstacles.some(o => !o.cleared && o.type === "OIL")) {
    r.slippery.forEach((on, i) => { if (on) setSlippery(i, false); });
  }
  // the rain signal where it rains (the whole track when it rains nearly everywhere)
  const w = r.weather;
  const rainIn = i => (w.rainS ? w.rainS[i] : w.rain);
  // (with the option "marshals show the rain signal" the marshal posts do it themselves)
  if (!r.autoMarshalRain) {
    let wetSectors = 0;
    for (let i = 0; i < r.sectorFlags.length; i++) if (rainIn(i) > 0.12) wetSectors++;
    if (wetSectors >= r.sectorFlags.length * 0.8 && !(r.rainFlags && r.rainFlags.every(Boolean))) setRainAll(true); // one message for the whole track
    for (let i = 0; i < r.sectorFlags.length; i++) {
      const rain = rainIn(i);
      if (rain > 0.12 && !rainShown(i)) setRainFlag(i, true);
      else if (rain < 0.03 && rainShown(i)) setRainFlag(i, false);
    }
  }
}


// ---------- The race ----------
function aiRace(ai) {
  const r = race;
  // the wettest part of the track counts (local showers), lightning stops everything
  const wet = r.weather.wetMax !== undefined ? r.weather.wetMax : r.weather.wet;
  const lightning = aiLightning(ai);

  // ----- start procedure -----
  if (r.phase === "PRE") {
    if (lightning || wet > 0.95) {
      if (!r.startDelayed) delayStart(); // wait for better conditions
      return;
    }
    if (r.starts === 0 && wet > 0.85) startBehindSafetyCar();
    else startFormationLap();
    return;
  }
  if (r.phase === "GRID_READY" || r.phase === "START_SEQ") {
    if (r.cars.some(c => c.stalled && c.mode === "GRID")) abortStart();
    else if (r.phase === "GRID_READY") startSequence();
    return;
  }
  if (r.phase !== "RACE" || r.chequered) return;

  // the pit exit is closed for the start: open it once the field has passed
  if (!r.pitExitOpen && r.status !== "RED" && ai.exitOpenedFor !== r.lastStart && r.time - r.lastStart > 12 && !carApproachingPitExit()) {
    ai.exitOpenedFor = r.lastStart;
    setPitExit(true);
  }

  aiSectorFlags(ai);

  // ----- conditions and overtaking aids -----
  if (r.weather.rain > 0.1 && !r.wetDeclared) declareWetRace();
  if (r.status === "GREEN") {
    if (!r.drsEnabled && r.drsAdvised && wet < 0.3) setDRS(true);
    if (r.drsEnabled && wet > 0.35) setDRS(false);
  }
  if (is2026()) {
    if (r.straightEnabled && wet > 0.3) setStraightMode(false);
    if (!r.straightEnabled && wet < 0.15) setStraightMode(true);
  }
  for (const car of r.cars) {
    if (car.tlStrikes >= (r.tlBwAt || 3) && !ai.bwShown[car.id] && isRunning(car)) {
      ai.bwShown[car.id] = true;
      showCarFlag(car, "BW");
    }
  }

  // ----- what does the track need? -----
  const open = r.obstacles.filter(o => !o.cleared && aiSeen(ai, "ob" + o.id) > 3); // a few seconds to see what happened
  const onTrack = open.filter(o => o.onTrack);
  const barrier = open.filter(o => o.type === "BARRIER");
  const medical = open.filter(o => o.type === "MEDICAL"); // the medical car goes out under the Safety Car
  const needRed = barrier.some(o => o.required > 330) || wet > 0.97 || lightning;
  // a crashed car on the track needs the recovery vehicle: Safety Car
  const needSC = barrier.length > 0 || medical.length > 0 || onTrack.length >= 2 || onTrack.some(o => o.type === "OIL" || (o.type === "CAR" && o.crash)) || wet > 0.9;
  // a stopped car on the track needs a VSC; debris is first cleared under double
  // yellow flags – a VSC only for big debris or when it takes too long
  const needVSC = onTrack.some(o => o.type === "CAR" || o.type === "OIL" || o.required > 75 || aiSeen(ai, "ob" + o.id) > 90) ||
    open.some(o => o.type === "CAR" && o.crash); // a crashed car in the run-off: VSC while the crane recovers it

  const st = r.status;
  if (st === "GREEN" || st === "VSC_ENDING") {
    if (needRed) redFlag();
    else if (needSC) deploySafetyCar();
    else if (needVSC) deployVSC();
    return;
  }
  if (st === "VSC") {
    if (needRed) redFlag();
    else if (needSC) deploySafetyCar();
    else if (!needVSC) endVSC();
    return;
  }
  if (st === "SC") {
    if (needRed) {
      redFlag();
      return;
    }
    const clear = onTrack.length === 0 && barrier.length === 0 && medical.length === 0 && !open.some(o => o.type === "CAR" && o.crash) && wet < 0.85;
    if (!clear) {
      ai.scClearSince = null;
      ai.lappedCalledAt = null;
      return;
    }
    if (ai.scClearSince === null) ai.scClearSince = r.time;
    if (!r.lappedMayOvertake && r.sc && r.time - ai.scClearSince > 10) {
      lappedCarsMayOvertake();
      ai.lappedCalledAt = r.time;
    }
    if (r.sc && r.time - ai.scClearSince > 50 && (ai.lappedCalledAt === null || r.time - ai.lappedCalledAt > 35)) {
      // after a start behind the Safety Car the race gets its standing start
      if (r.startedBehindSc && !r.standingStartDone) safetyCarInStandingStart();
      else safetyCarInThisLap();
    }
    return;
  }
  if (st === "RED") {
    if (wet > 0.9 || lightning || r.time - ai.lastLightning < 300) return; // wait for the rain / the storm to pass
    if (aiSeen(ai, "red" + r.evalData.redCount) < 30) return;
    resumeRace(wet > 0.7 ? "ROLLING" : "STANDING"); // returns a text while the cars are not in the pit lane yet
  }
}


// ---------- Qualifying ----------
function aiQualifying(ai) {
  const r = race;
  const q = r.q;
  if ((q.state === "WAITING" || q.state === "BREAK") && r.status !== "RED") {
    // no segment starts in a thunderstorm or with standing water
    const w = r.weather.wetMax !== undefined ? r.weather.wetMax : r.weather.wet;
    if (aiLightning(ai) || w > 0.95 || r.time - ai.lastLightning < 300) return;
    // the break between the segments
    if (ai.nextBreakStart === null) ai.nextBreakStart = r.time + (q.state === "WAITING" ? 2 : 60);
    if (r.time >= ai.nextBreakStart) {
      ai.nextBreakStart = null;
      startQualifyingSegment();
    }
    return;
  }
  if (q.state !== "RUNNING" && r.status !== "RED") return;
  aiSectorFlags(ai);
  const wet = r.weather.wetMax !== undefined ? r.weather.wetMax : r.weather.wet;
  const lightning = aiLightning(ai);
  // a session that cannot be resumed within an hour is abandoned
  if (r.status === "RED" && aiSeen(ai, "qred" + r.evalData.redCount) > 3600) {
    abandonSession("weather");
    return;
  }
  if (r.weather.rain > 0.1 && !r.wetDeclared) declareWetRace();

  const open = r.obstacles.filter(o => !o.cleared && aiSeen(ai, "ob" + o.id) > 3);
  // a crashed car (also in the run-off: the crane must work there) stops the session
  const blocking = open.filter(o => o.onTrack || o.type === "BARRIER" || o.type === "MEDICAL" || (o.type === "CAR" && o.crash));
  // a stopped car on the track or a damaged barrier = red flag in qualifying
  if (r.status !== "RED" && (blocking.some(o => o.type === "CAR" || o.type === "BARRIER" || o.type === "OIL" || o.type === "MEDICAL") || wet > 0.95 || lightning)) {
    redFlag();
    return;
  }
  if (r.status === "RED" && blocking.length === 0 && wet < 0.9 && !lightning && r.time - ai.lastLightning > 300 && aiSeen(ai, "qred" + r.evalData.redCount) > 30) {
    resumeRace("STANDING");
  }
}
