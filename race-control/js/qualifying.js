// =====================================================================
//  qualifying.js
//  The QUALIFYING session: Q1, Q2 and Q3 (or SQ1-SQ3 for a sprint).
//
//  - The cars wait in their garages. Every team plans its "runs":
//    out lap -> one or two push laps -> cool-down lap -> back to the garage.
//  - The session clock runs down. At 0:00 the chequered flag comes out,
//    cars that already started a push lap may finish it.
//  - The slowest cars are knocked out after Q1 and Q2.
//  - Typical qualifying problems: slow cars impeding a car on a push lap,
//    yellow flags (drivers must abort or at least slow down),
//    track limits (the lap time is deleted) and red flags (the clock stops).
//  The driving itself is done by the normal engine (engine.js).
// =====================================================================

const QUALI_DURATIONS = [18 * 60, 15 * 60, 12 * 60];
const SPRINT_QUALI_DURATIONS = [12 * 60, 10 * 60, 8 * 60];

// Called by createRace() when the session is a qualifying
function setupQualifying(r) {
  const n = r.cars.length;
  r.q = {
    segment: 0,          // 1 = Q1, 2 = Q2, 3 = Q3
    state: "WAITING",    // WAITING, RUNNING, CHEQUERED, BREAK, DONE
    remaining: 0,        // seconds left on the session clock
    durations: r.setup.qualiDurations || QUALI_DURATIONS,
    elapsed: 0,          // seconds of green running in the whole session
    segElapsed: 0,       // seconds of green running in this segment
    chequerTime: 0,
    evolution: 0,        // the track gets faster with more rubber on it
    keep: [Math.round(n * 0.75), Math.round(n * 0.5)], // cars that go through to Q2 and Q3
    lapSeconds: r.track.refLapTime / r.paceScale,
    results: {},
    maxDelta: true       // the Race Director's maximum delta time for out laps and in laps
  };
  r.drsEnabled = true; // in qualifying DRS may be used in the zones without the 1-second rule
  r.cars.forEach((car, i) => {
    car.skipLine = false;
    car.fuel = 8;
    car.q.prevPos = i;
    parkInGarage(car);
  });
}

function segName(n) {
  return (race.setup.sprint ? "SQ" : "Q") + (n || race.q.segment);
}

// cars that may still drive in this segment
function activeQualiCars() {
  return race.cars.filter(c => !c.q.eliminated && !c.dsq && c.status === "RUNNING");
}

function parkInGarage(car) {
  car.mode = "GARAGE";
  car.pit.state = "GARAGE";
  car.pit.reason = null;
  car.speed = 0;
  car.s = car.pit.boxS;
  car.lateral = 0;
  car.q.phase = "GARAGE";
  car.passing = null;
  closeAero(car);
  car.boxThisLap = null;
}


// ---------- The Race Director starts a segment ----------
function startQualifyingSegment() {
  const r = race;
  const q = r.q;
  if (r.session !== "QUALI") return "This is not a qualifying session.";
  if (q.state !== "WAITING" && q.state !== "BREAK") return segName() + " is still running.";
  if (r.status === "RED") return "End the red flag first.";

  q.segment++;
  q.state = "RUNNING";
  q.remaining = q.durations[q.segment - 1];
  q.segElapsed = 0;
  r.phase = "SESSION";
  r.status = "GREEN";
  r.pitExitOpen = true;
  r.leaderLap = q.segment;
  for (const car of activeQualiCars()) car.q.runs = planRuns(car);
  publish(segName() + " STARTED", "Info");
  if (q.segment === 1 && q.maxDelta) publish("MAXIMUM DELTA TIME IN FORCE FOR ALL CARS ON OUT AND IN LAPS", "Info");
  publish("GREEN LIGHT - PIT EXIT OPEN", "Info");
}

// The Race Director switches the maximum delta time on or off
function setMaxDelta(on) {
  const r = race;
  if (r.session !== "QUALI") return "The maximum delta time is used in qualifying.";
  if (r.q.maxDelta === on) return;
  r.q.maxDelta = on;
  publish(on ? "MAXIMUM DELTA TIME IN FORCE FOR ALL CARS ON OUT AND IN LAPS" : "MAXIMUM DELTA TIME NO LONGER IN FORCE", "Info");
}

// Every team plans when its car leaves the garage.
// "at" = session clock (seconds remaining) when the car goes out.
function planRuns(car) {
  const q = race.q;
  const R = q.remaining;
  const outLap = q.lapSeconds * 1.25 + 25;          // pit lane + out lap
  const lastRun = outLap + rand(15, 75);            // the big rush at the end
  const runs = [];
  if (R - lastRun > 470) {
    runs.push({ at: R - rand(15, Math.min(260, R - lastRun - 450)), pushes: chance(0.3) ? 2 : 1 });
  }
  if (R > lastRun) runs.push({ at: lastRun, pushes: 1, last: true });
  else if (R > outLap + 5) runs.push({ at: R - 2, pushes: 1, last: true });
  return runs;
}

function launchRun(car, run) {
  const r = race;
  const L = r.track.length;
  const w = teamWetView();
  const compound = w > 0.78 ? "WET" : w > 0.22 ? "INTERMEDIATE" : "SOFT";

  car.mode = "RACE";
  car.pit.state = "OUT";
  car.pit.reason = null;
  car.pit.excess = chance(0.012 * r.level) ? rand(0.005, 0.05) : 0;
  car.pit.maxSpeed = 0;
  car.pit.speedChecked = false;
  car.q.phase = "OUT";
  car.q.pushesLeft = run.pushes;
  car.q.aborted = false;
  car.q.compromised = false;
  car.tyre = { compound, age: 0, wear: 0 };
  if (!car.tyresUsed.includes(compound)) car.tyresUsed.push(compound);
  car.fuel = 8;
  car.damage.wing = false;
  car.damage.puncture = false;
  if (car.flag === "BO") car.flag = null;
  car.lapStart = r.time;
  car.sectorStart = r.time;

  // released into the path of another car in the pit lane?
  const other = r.cars.find(o => o !== car && o.pit.state === "OUT" && mod(car.s - o.s, L) > 0 && mod(car.s - o.s, L) < 25);
  if (other && chance(0.15 * r.level)) unsafeReleaseIncident(car, other, chance(0.2));
}


// ---------- Every simulation step ----------
function updateQualifying() {
  const r = race;
  const q = r.q;

  if (q.state === "RUNNING" && r.status !== "RED") {
    q.remaining -= DT;
    q.segElapsed += DT;
    q.elapsed += DT;
    q.evolution = Math.min(0.008, q.elapsed * 0.000003);

    // cars leave the garage
    if (r.pitExitOpen && r.status === "GREEN") {
      const order = r.order;
      for (const car of activeQualiCars()) {
        if (car.mode !== "GARAGE" || !car.q.runs || car.q.runs.length === 0) continue;
        if (q.remaining > car.q.runs[0].at) continue;
        const run = car.q.runs.shift();
        if (q.remaining < q.lapSeconds * 1.25 + 20) continue; // too late to start a push lap
        // a car that is already safely through may save its tyres
        const pos = order.indexOf(car) + 1;
        if (run.last && q.segment < 3 && bestLapInSegment(car, q.segment) && pos <= q.keep[q.segment - 1] - 6 && chance(0.6)) continue;
        launchRun(car, run);
      }
    }

    if (q.remaining <= 0) {
      q.remaining = 0;
      showQualiChequer();
    }
  }

  if (q.state === "CHEQUERED") {
    const stillOut = activeQualiCars().filter(c => c.mode === "RACE");
    if (stillOut.length === 0 || r.time - q.chequerTime > 240) endQualiSegment();
  }
}

function showQualiChequer() {
  const r = race;
  const q = r.q;
  q.state = "CHEQUERED";
  q.chequerTime = r.time;
  publish("CHEQUERED FLAG", "Flag");
  for (const car of activeQualiCars()) {
    car.q.runs = [];
    if (car.mode !== "RACE") continue;
    if (car.pit.state) parkInGarage(car);                 // still in the pit lane: too late
    else if (car.q.phase === "OUT") car.q.phase = "COOL"; // can't start a push lap any more
  }
}

function endQualiSegment() {
  const r = race;
  const q = r.q;
  for (const car of r.cars) if (car.mode === "RACE" && !car.q.eliminated) parkInGarage(car);

  const order = segmentOrder(q.segment);
  order.forEach((car, i) => { car.q.prevPos = i; });
  q.results[q.segment] = order.map(car => car.id);

  if (q.segment < 3) {
    const keep = q.keep[q.segment - 1];
    const out = order.slice(keep);
    for (const car of out) car.q.eliminated = q.segment;
    q.state = "BREAK";
    r.phase = "BREAK";
    publish(segName() + " FINISHED", "Info");
    addAlert("info", segName() + " is over. Knocked out: " + out.map(c => c.code).join(", ") +
      ". Start " + segName(q.segment + 1) + " when you are ready.");
  } else {
    q.state = "DONE";
    r.phase = "FINISHED";
    r.finished = true;
    publish("SESSION FINISHED", "Info");
    addAlert("info", "Qualifying is over. Decide any open investigations, then open the session report.");
  }
  r.ver++;
}


// ---------- Lap times ----------

// The best valid push lap of a car in one segment (or null)
function bestLapInSegment(car, segment) {
  let best = null;
  for (const lap of car.lapTimes) {
    if (lap.type !== "PUSH" || lap.segment !== segment || !lap.valid || lap.aborted) continue;
    if (!best || lap.time < best.time) best = lap;
  }
  return best;
}

// The cars of one segment, fastest first
function segmentOrder(segment) {
  const cars = race.cars.filter(c => !c.dsq && (!c.q.eliminated || c.q.eliminated >= segment));
  return cars.sort((a, b) => {
    const la = bestLapInSegment(a, segment);
    const lb = bestLapInSegment(b, segment);
    if (la && lb) return (la.time - lb.time) || (la.t - lb.t); // same time: who set it first
    if (la) return -1;
    if (lb) return 1;
    return a.q.prevPos - b.q.prevPos;
  });
}

// The order shown on the timing screen
function qualiOrder() {
  const r = race;
  const seg = Math.max(1, r.q.segment);
  const still = segmentOrder(seg).filter(c => !c.q.eliminated);
  const outQ2 = segmentOrder(2).filter(c => c.q.eliminated === 2);
  const outQ1 = segmentOrder(1).filter(c => c.q.eliminated === 1);
  const dsq = r.cars.filter(c => c.dsq);
  return still.concat(outQ2, outQ1, dsq);
}

// The car crosses the line during qualifying
function qualiCrossLine(car) {
  const r = race;
  const q = r.q;
  const phase = car.q.phase;
  // leaving the garage: some garages are before the line, so the car crosses it in the pit lane.
  // That is not the end of the out lap.
  if (phase === "OUT" && car.pit.state) return;
  const now = timingNow(); // exact moment the car crossed the line (to the thousandth)
  car.laps++;
  const record = {
    lap: car.laps,
    time: now - car.lapStart,
    s1: car.sectorTimes[0],
    s2: car.sectorTimes[1],
    s3: now - car.sectorStart,
    compound: car.tyre.compound,
    valid: !car.invalidLaps[car.laps],
    pitLane: phase !== "PUSH",
    type: phase,
    segment: q.segment,
    aborted: car.q.aborted || phase !== "PUSH",
    t: now
  };
  car.lapTimes.push(record);
  car.lastLap = record;
  if (phase === "PUSH" && record.valid && !record.aborted && (!car.bestLap || record.time < car.bestLap.time)) car.bestLap = record;

  car.lapStart = now;
  car.sectorStart = now;
  car.sectorTimes = [null, null, null];
  car.tyre.age++;
  car.lapNoise = 1 + (random() * 2 - 1) * 0.003 * (1.3 - car.consistency);
  car.q.compromised = false;
  car.q.yieldTo = null;

  const sessionOpen = q.state === "RUNNING" && r.status === "GREEN";
  if (phase === "OUT") {
    car.q.phase = sessionOpen ? "PUSH" : "COOL";
    car.q.aborted = false;
  } else if (phase === "PUSH") {
    car.q.pushesLeft--;
    const anotherLap = sessionOpen && car.q.pushesLeft > 0 && !car.q.aborted && car.tyre.wear < 0.25;
    car.q.phase = anotherLap ? "PUSH" : "COOL";
    car.q.aborted = false;
  }
  if (chance(0.0005 * r.level)) startFailure(car);
}

// Does the car come back to the garage at the end of this lap?
function wantsGarage(car) {
  const r = race;
  const broken = car.damage.puncture || car.flag === "BO" || car.dsq || (car.failure && car.failure.toPits);
  // a push lap is always finished first (even after the chequered flag)
  if (car.q.phase === "PUSH" && !car.q.aborted && !broken) return false;
  // at the end of the out lap the push lap starts
  if (car.q.phase === "OUT" && r.q.state === "RUNNING" && !broken && !car.damage.wing) return false;
  return true;
}

// Speed factor for the different kinds of laps
function qualiSpeedFactor(car) {
  const q = race.q;
  if (car.q.phase === "OUT") return 0.86;
  if (car.q.phase === "COOL") return 0.74;
  let f = 1 + q.evolution;
  if (car.q.aborted) f = 0.8;
  if (car.q.compromised) f *= 0.99;
  return f;
}


// ---------- Traffic: a slow car in front of a car on a push lap ----------
function qualiTraffic(me, ahead) {
  const r = race;
  if (me.passing || me.attemptCooldown > 0) return;
  const mePush = me.q.phase === "PUSH" && !me.q.aborted;
  const aheadPush = ahead.q.phase === "PUSH" && !ahead.q.aborted;

  if (mePush && !aheadPush) {
    // the slow car should move out of the way
    if (ahead.q.yieldTo !== me.id) {
      ahead.q.yieldTo = me.id;
      ahead.q.impedes = chance(0.07 * r.level);
      ahead.q.heldSince = r.time;
      ahead.q.reported = false;
    }
    if (chance(ahead.q.impedes ? 0.006 : 0.09)) {
      startPass(me, ahead);
      r.overtakes--;
      if (r.time - ahead.q.heldSince > 1.5) me.q.compromised = true;
      ahead.q.yieldTo = null;
    } else if (ahead.q.impedes && !ahead.q.reported && r.time - ahead.q.heldSince > 2.5) {
      ahead.q.reported = true;
      me.q.compromised = true;
      impedingIncident(ahead, me, r.time - ahead.q.heldSince);
    }
    return;
  }

  // two cars on push laps: a pass is rare, the teams try to keep gaps
  if (mePush && aheadPush) {
    if (me.factorNow > ahead.factorNow * 1.004 && chance(0.004)) {
      startPass(me, ahead);
      me.attemptCooldown = 3;
    }
    return;
  }

  // two slow cars: they pass each other freely to find space
  if (!mePush && !aheadPush && me.q.phase === "OUT" && chance(0.01)) {
    startPass(me, ahead);
    r.overtakes--;
    me.attemptCooldown = 4;
  }
}

function impedingIncident(slow, fast, held, historic) {
  if (!historic && offenceSkipped()) return null; // championship: realistic number of offences
  const roll = random();
  let truth;
  if (roll < 0.65) {
    truth = { culprit: slow.id, penalty: "GRID3", points: 1, quali: true,
      reason: slow.code + " was on a slow lap, stayed on the racing line and unnecessarily impeded " + fast.code + " on a push lap. The standard penalty is a 3-place grid drop." };
  } else if (roll < 0.85) {
    truth = { culprit: slow.id, penalty: "REPRIMAND", points: 0, quali: true,
      reason: "The team did not warn " + slow.code + " in time that a car on a push lap was approaching. A reprimand (for the team) is usual." };
  } else {
    truth = { culprit: null, penalty: "NFA", points: 0, quali: true,
      reason: fast.code + " lost very little time and " + slow.code + " moved off the line as soon as possible. No further action." };
  }
  const warned = truth.penalty === "GRID3";
  const lost = truth.penalty === "NFA" ? rand(0.05, 0.15) : rand(0.3, 1.2);
  return makeIncident("IMPEDING", [slow, fast], {
    offence: "Impeding another driver", s: slow.s, truth, historic,
    summary: slow.code + " was on a slow lap in front of " + fast.code + ", who was on a push lap.",
    evidence: [
      ["Lap of " + slow.code, slow.q.phase === "OUT" ? "Out lap (preparing tyres)" : "Cool-down / in lap"],
      ["Lap of " + fast.code, "Push lap"],
      ["Time held up", held.toFixed(1) + " s"],
      ["Time lost by " + fast.code, lost.toFixed(2) + " s in the mini-sector"],
      ["Position of " + slow.code, warned || truth.penalty === "REPRIMAND" ? "On the racing line at the corner entry" : "Moved off the line before the corner"],
      ["Team radio to " + slow.code, warned ? "Warned: \"car behind on a fast lap\" " + rand(3, 8).toFixed(0) + " s before" : truth.penalty === "REPRIMAND" ? "No warning given" : "Warned early"]
    ],
    statements: [[fast.code, "He was right on the line, my lap is ruined!"], [slow.code, warned ? "I saw him late, sorry." : "Nobody told me he was coming."]]
  });
}

// A car on a push lap meets a yellow flag
function qualiYellow(car, index, flag) {
  if (car.q.phase !== "PUSH" || car.q.aborted) return;
  const abort = flag === "DOUBLE" ? chance(0.9) : chance(0.7);
  if (abort) {
    car.q.aborted = true; // the driver lifts and gives up this lap
    return;
  }
  if (chance(0.5)) {
    car.ignoreFlags = true;
    qualiYellowIncident(car, index, flag);
  }
}

function qualiYellowIncident(car, index, flag, historic) {
  const double = flag === "DOUBLE";
  const inc = makeIncident("YELLOW_FLAG", [car], {
    offence: "Failing to slow for " + (double ? "double " : "") + "yellow flags", s: car.s, historic,
    summary: car.code + " continued the push lap through a " + (double ? "double " : "") + "yellow flag in sector " + (index + 1) + ".",
    evidence: [
      ["Flag in sector " + (index + 1), double ? "Double yellow (be prepared to stop)" : "Single yellow (slow down, no overtaking)"],
      ["Mini-sector time", "Only " + rand(0.1, 0.6).toFixed(2) + " s slower than the driver's best"],
      ["Throttle lift", rand(0, 0.15).toFixed(2) + " s"],
      ["Lap", "Push lap – continued after the flag"]
    ],
    statements: [[car.code, "I lifted, the car was already off the track when I passed."]],
    truth: double
      ? { culprit: car.id, penalty: "GRID5", points: 3, quali: true, reason: "Under double yellow flags a driver must slow down significantly. Not doing so in qualifying is usually punished with a grid penalty." }
      : { culprit: car.id, penalty: "DELETE_LAP", points: 0, quali: true, reason: "A driver must clearly slow down under a single yellow flag. The lap time is deleted." }
  });
  inc.lapOf = { [car.id]: car.laps + 1 };
  return inc;
}


// ---------- Red flag in qualifying ----------
function qualiRedFlag() {
  const r = race;
  if (r.q.state !== "RUNNING") return "The session is not running.";
  r.status = "RED";
  r.pitExitOpen = false;
  r.evalData.redCount++;
  for (const car of r.cars) {
    car.passing = null;
    if (car.mode === "RACE" && !car.pit.state) {
      car.q.aborted = true; // every lap in progress is lost
      car.q.phase = "COOL";
    }
  }
  publish("RED FLAG", "Flag");
  publish("PIT EXIT CLOSED", "Info");
  addAlert("info", "The session clock is stopped at " + formatClock(r.q.remaining).slice(2) + ". All cars return to the pits.");
}

function resumeQualifying() {
  const r = race;
  if (r.status !== "RED") return "The session is not suspended.";
  const open = r.obstacles.filter(o => !o.cleared && (o.onTrack || o.type === "BARRIER"));
  if (open.length > 0) return "The track is not clear yet: " + open.map(o => o.label).join(", ") + ".";
  r.status = "GREEN";
  r.pitExitOpen = true;
  r.sectorFlags.fill("GREEN");
  for (const car of activeQualiCars()) {
    if (car.mode === "GARAGE") car.q.runs = planRuns(car);
  }
  publish("GREEN LIGHT - PIT EXIT OPEN", "Info");
  publish("SESSION RESUMED - " + formatClock(r.q.remaining).slice(2) + " REMAINING", "Info");
}


// ---------- Result and starting grid ----------
function qualiResults() {
  const r = race;
  const order = r.abandoned ? abandonedQualiOrder() : qualiOrder();
  const rows = order.map((car, i) => ({
    car,
    position: car.dsq ? "DSQ" : String(i + 1),
    times: [1, 2, 3].map(seg => {
      const lap = bestLapInSegment(car, seg);
      return lap ? lap.time : null;
    }),
    realPos: r.real && r.real.results ? r.real.results[car.number] : null
  }));

  // starting grid: grid penalties move a car back, "back of the grid" and DSQ go last
  const grid = rows.map((row, i) => ({ row, key: row.car.dsq ? 3000 + i : row.car.pen.back ? 2000 + i : i + 1 + (row.car.pen.grid || 0) + 0.5 * Math.sign(row.car.pen.grid || 0) }));
  grid.sort((a, b) => a.key - b.key);
  grid.forEach((g, i) => { g.row.grid = i + 1; });
  for (const row of rows) {
    const p = row.car.pen;
    const parts = [];
    if (p.grid) parts.push(p.grid + "-place grid penalty");
    if (p.back) parts.push("starts from the back");
    if (row.car.dsq) parts.push("disqualified");
    row.penaltyText = parts.join(", ");
  }
  return rows;
}
