// =====================================================================
//  engine.js
//  The SIMULATION ENGINE. It moves every car, step by step
//  (one step = 0.1 seconds of race time).
//
//  It knows about: start procedure, racing and overtaking, tyres and
//  fuel, pit stops, safety car, VSC, red flag, weather, blue flags,
//  DRS, lap timing and the finish.
//  Incidents and penalties are in incidents.js,
//  the buttons of the Race Director are in director.js.
// =====================================================================

let race = null;          // everything about the running race

const DT = 0.1;           // seconds per simulation step
const PIT_SPEED = 80 / 3.6; // pit lane speed limit in m/s

const TYRES = {
  SOFT:         { base: 1.000,  wear: 0.042, colour: "#ff3333", slick: true,  letter: "S" },
  MEDIUM:       { base: 0.9935, wear: 0.027, colour: "#ffd60a", slick: true,  letter: "M" },
  HARD:         { base: 0.9875, wear: 0.018, colour: "#f0f0f0", slick: true,  letter: "H" },
  INTERMEDIATE: { base: 1.000,  wear: 0.030, colour: "#39b54a", slick: false, letter: "I" },
  WET:          { base: 1.000,  wear: 0.022, colour: "#0090ff", slick: false, letter: "W" }
};


// =====================================================================
//  1. CREATE A RACE
// =====================================================================
function createRace(setup) {
  const track = setup.track;
  const M = track.marshalSectors;

  race = {
    setup: setup,
    mode: setup.mode,
    session: setup.session || "RACE", // "RACE" or "QUALI"
    title: setup.title,
    track: track,
    totalLaps: setup.totalLaps,
    plannedLaps: setup.totalLaps,
    paceScale: setup.paceScale || 1,
    level: setup.incidentLevel,           // how many incidents (0.5 = few, 2 = chaos)
    offenceScale: setup.offenceScale !== undefined ? setup.offenceScale : 1, // share of minor offences that happen (championship: realistic)
    overtakeScale: setup.overtakeScale !== undefined ? setup.overtakeScale : 1, // how often cars try to overtake
    tyreDeg: setup.tyreDeg !== undefined ? setup.tyreDeg : 1,             // how much the tyres degrade
    wearScale: clamp(55 / setup.totalLaps, 0.8, 4), // short races wear tyres faster, so there are still pit stops
    fuelPerLap: 98 / setup.totalLaps,

    time: 0,                    // seconds since the session started
    clockStart: setup.clockStart, // time of day at time = 0
    phase: "PRE",               // PRE, FORMATION, GRID_READY, START_SEQ, RACE, FINISHED
    status: "GREEN",            // GREEN, VSC, VSC_ENDING, SC, SC_ENDING, RED
    raceStart: null,            // time of the first "lights out"
    lastStart: -999,            // time of the last start or restart
    starts: 0,
    lights: { count: 0, state: "OFF", t0: 0, outAt: 0, jumpRolled: false },

    sectorFlags: new Array(M).fill("GREEN"), // GREEN, YELLOW, DOUBLE
    flagSource: new Array(M).fill(null),
    slippery: new Array(M).fill(false),
    autoClear: [],
    pitEntryOpen: true,
    pitExitOpen: true,
    drsEnabled: false,
    drsAdviceLap: 3,
    drsAdvised: false,
    wetDeclared: false,
    autoMarshalYellow: true,
    autoSlow: true,

    sc: null,                   // the safety car (when it is on track)
    scInPit: false,
    restartGo: 0,
    vscEndAt: 0,
    lappedMayOvertake: false,
    neutralSince: 0,
    redQueueCount: 0,
    redOrder: null,
    releaseQueue: [],
    nextRelease: 0,
    resumeType: null,

    chequered: false,
    chequerTime: null,
    finished: false,

    weather: makeWeatherState(setup.weather, track),

    cars: [],
    order: [],
    leaderLap: 1,
    obstacles: [],
    incidents: [],
    trackLimits: [],
    messages: [],
    alerts: [],
    penaltyLog: [],
    history: [],
    lastHistory: -1,
    injections: (setup.injections || []).map(x => Object.assign({ done: false }, x)),
    waiting: [],                // real incidents waiting until the cars meet on track
    real: setup.real || null,

    overtakes: 0,
    pitStops: 0,
    evalData: {
      stallAtStart: false, startAborted: false, startedWithStall: false, abortsWithoutReason: 0,
      drsWetSeconds: 0, neutralNoReason: 0, marshalRisk: 0, unsafePasses: 0,
      debrisHits: 0, carHits: 0, scCount: 0, vscCount: 0, redCount: 0, bwShown: 0, bwNeeded: 0
    },
    nextId: 1,
    speedRequest: null,
    ver: 0
  };

  for (const entry of setup.entries) race.cars.push(makeCar(entry));
  race.cars.sort((a, b) => a.grid - b.grid);
  placeOnGrid(race.cars);
  initRegs(race); // car generation: DRS (2023–2025) or active aero + battery (2026)
  if (race.session === "QUALI") setupQualifying(race); // cars go to their garages instead
  updateOrder();
  return race;
}

function makeWeatherState(w, track) {
  const state = {
    rain: w.initialRain || 0,
    wet: w.initialWet || 0,
    air: w.air || 24,
    trackTemp: w.trackTemp || 36,
    schedule: (w.schedule || []).slice().sort((a, b) => a.lap - b.lap),
    raining: (w.initialRain || 0) > 0.05
  };
  // championship: local rain cells, wetness per marshal sector (weather.js)
  if (w.model === "cells") initCellWeather(state, w, track);
  return state;
}

function makeCar(e) {
  return {
    id: e.number, number: e.number, code: e.code, name: e.name,
    team: e.team, teamIndex: e.teamIndex, teamId: e.teamId || null, colour: e.colour, headshot: e.headshot || null,
    pace: e.pace, aggression: e.aggression, consistency: e.consistency,
    racecraft: e.racecraft, tyreMgmt: e.tyreMgmt,
    grid: e.grid,

    // where is the car?
    s: 0, speed: 0, laps: 0, skipLine: true, mode: "GRID",
    lateral: 0, targetLateral: 0,
    slot: 0, slotS: 0, formDist: 0, formDelay: 0, cooldown: 0,

    // timing
    lapStart: 0, sectorStart: 0, sectorTimes: [null, null, null],
    lapTimes: [], lastLap: null, bestLap: null, invalidLaps: {},
    pass: {}, lastKey: -1, gapAheadM: 9999,

    // car state
    tyre: { compound: e.startCompound, age: 0, wear: 0 },
    tyresUsed: [e.startCompound],
    fuel: 100,
    damage: { wing: false, floor: 0, puncture: false },
    spin: 0, stalled: false, launchDelay: 0, launchBoost: 1, launchTime: 0,
    coldTyres: 0, jump: 0, failure: null,
    status: "RUNNING", retireReason: "", retiredLap: null, retiredAt: null, hidden: false,
    finished: false, finishTime: null, dsq: false,

    pit: {
      state: null, reason: null, boxS: 0, stopLeft: 0, stopTotal: 0, excess: 0, maxSpeed: 0,
      lastStopLap: -99, stops: 0, queueS: 0, servedNow: 0, speedChecked: false
    },
    pen: { time: 0, post: 0, dt: null, sg: null, warnings: 0, reprimands: 0, points: 0, list: [], failedServe: false },
    flag: null,     // "BW" (black & white), "BO" (black & orange), "BLACK"
    blue: { active: false, since: 0, held: 0, ignore: false, reported: false, lastMsgLap: -1 },

    drsEligible: false, drsOpen: false, slip: false,
    straightOpen: false, ers: null, ersEff: e.ersEff || 1, // 2026 cars (regs.js)
    failureScale: e.failureScale || 1, // reliability of car and power unit (championship)
    passing: null, attemptCooldown: 0, slowDown: 0,
    lapNoise: 1, unlapping: false, unlapLeft: 0, restartOk: true,
    ignoreFlags: false, factorNow: 1,
    plan: (e.plan || []).slice(),
    tlStrikes: 0,
    pitStart: false,
    spinCheck: false,
    boxThisLap: null,
    // qualifying: phase = GARAGE, OUT (out lap), PUSH (flying lap), COOL (cool-down / in lap)
    q: { phase: "GARAGE", runs: [], pushesLeft: 0, aborted: false, compromised: false, eliminated: 0, prevPos: 0, yieldTo: null }
  };
}

// Put the cars on their grid boxes: pole 12 m behind the line, then every 8 m
function placeOnGrid(list) {
  const L = race.track.length;
  list.forEach((car, k) => {
    car.slot = k;
    car.slotS = mod(-12 - 8 * k, L);
    car.s = car.slotS;
    car.speed = 0;
    car.mode = "GRID";
    car.skipLine = true;
    car.lateral = car.targetLateral = (k % 2 === 0 ? -5 : 5);
    car.pit.boxS = race.track.pit.boxes[(car.teamIndex || 0) % race.track.pit.boxes.length];
  });
}


// =====================================================================
//  2. SMALL QUESTIONS
// =====================================================================
function carById(id) {
  return race.cars.find(c => c.id === id);
}

function carLabel(car) {
  return "CAR " + car.number + " (" + car.code + ")";
}

// How far did the car get in the race (metres)?
function progressOf(car) {
  if (car.pitStart) return -1e9;
  const L = race.track.length;
  return car.laps * L + (car.skipLine ? car.s - L : car.s);
}

function isNeutralised() {
  return ["VSC", "VSC_ENDING", "SC", "SC_ENDING", "RED"].includes(race.status);
}

function isRunning(car) {
  return car.status === "RUNNING" && !car.dsq;
}

// Current race order (also used by the timing screen)
function updateOrder() {
  const r = race;
  if (r.session === "QUALI") {
    r.order = qualiOrder();
    r.leaderLap = Math.max(1, r.q.segment);
    return;
  }
  const rank = c => (c.dsq ? 3 : c.status === "RETIRED" ? 2 : 0);

  r.order = r.cars.slice().sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) return (b.laps - a.laps) || (b.retiredAt - a.retiredAt);
    if (ra === 3) return a.grid - b.grid;
    if (r.raceStart === null) return a.slot - b.slot;
    if (a.laps !== b.laps) return b.laps - a.laps;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return progressOf(b) - progressOf(a);
  });

  const leader = r.order[0];
  r.leaderLap = leader ? clamp(leader.laps + 1, 1, r.totalLaps) : 1;
}

// Time gap between two cars, measured at the last timing point both have passed.
// Returns seconds, or a text like "+1 LAP"
function gapBetween(car, carAhead) {
  const M = race.track.marshalSectors;
  const key = car.lastKey;
  if (key < 0 || carAhead.lastKey < 0) return null;
  const lapsBehind = Math.floor((carAhead.lastKey - key) / M);
  if (lapsBehind >= 1) return "+" + lapsBehind + (lapsBehind === 1 ? " LAP" : " LAPS");
  const t = carAhead.pass[key];
  if (t === undefined) return null;
  return Math.max(0, car.pass[key] - t);
}

// The time to write into the timing: the exact crossing moment if we know it
function timingNow() {
  return race.stamp != null ? race.stamp : race.time;
}

function recordPassing(car, index) {
  const key = car.laps * race.track.marshalSectors + index;
  car.pass[key] = timingNow();
  car.lastKey = key;
}


// =====================================================================
//  3. ONE SIMULATION STEP
// =====================================================================
function simStep() {
  const r = race;
  if (!r || r.finished) return;

  r.time += DT;
  const newSecond = Math.floor(r.time) !== Math.floor(r.time - DT);

  if (newSecond) {
    updateWeather();
    updateBlueFlags();
    evaluationTick();
    adviceTick();
    fiaTick();          // time limits, heat, weather evaluation (fia-tools.js)
  }
  if (r.session === "QUALI") updateQualifying();
  else updateProcedures();
  processAutoClear();
  driveCars();
  runRaceTimers();
  updateObstacles();
  runInjections();
  processWaitingInjections();
  updateClips();
  recordHistory();
  updateOrder();
}


// =====================================================================
//  4. PROCEDURES: lights, formation lap, VSC end, finish ...
// =====================================================================
function updateProcedures() {
  const r = race;
  const L = r.track.length;

  // ----- start lights: one red light per second, then a random wait -----
  if (r.phase === "START_SEQ") {
    const t = r.time - r.lights.t0;
    r.lights.count = Math.min(5, Math.floor(t) + 1);

    if (t >= 5 && !r.lights.jumpRolled) {
      r.lights.jumpRolled = true;
      for (const car of r.cars) {
        if (car.mode === "GRID" && !car.stalled && chance(0.012 * r.level)) car.jump = rand(0.3, 1.8);
      }
    }
    // a car that jumps the start creeps forward
    for (const car of r.cars) {
      if (car.jump > 0 && t >= 5) car.s = mod(car.slotS + Math.min(car.jump, (t - 5) * 1.2), L);
    }
    if (r.time >= r.lights.outAt) lightsOut();
  }

  // ----- formation lap: finished when every car is back on its grid box -----
  if (r.phase === "FORMATION" && !r.cars.some(c => c.mode === "FORMATION")) {
    gridReady();
  }

  // ----- VSC ending: green flag after 10-15 seconds -----
  if (r.status === "VSC_ENDING" && r.time >= r.vscEndAt) {
    r.status = "GREEN";
    publish("TRACK CLEAR", "Flag");
    afterNeutralisation();
  }

  // ----- release cars from the pit lane after a red flag -----
  if (r.releaseQueue.length > 0 && r.time >= r.nextRelease && r.pitExitOpen) {
    const car = r.releaseQueue.shift();
    car.pit.state = "OUT";
    r.nextRelease = r.time + 1.3;
  }

  // ----- pit lane starters leave after the field has passed -----
  if (r.raceStart !== null && r.phase === "RACE") {
    for (const car of r.cars) {
      if (car.pitStart && car.pit.state === "HOLD" && r.time - r.lastStart > 12 && r.pitExitOpen && !carApproachingPitExit()) {
        car.pit.state = "OUT";
        car.mode = "RACE";
        car.lapStart = r.time;
        car.sectorStart = r.time;
      }
    }
  }

  // ----- end of the race -----
  if (r.chequered && !r.finished) {
    const stillRacing = r.cars.some(c => isRunning(c) && !c.finished && c.mode !== "STOPPED");
    if (!stillRacing || r.time - r.chequerTime > 300) finishRace();
  }
}

// Automatic "clear" of short marshal yellows (e.g. after a quick spin)
function processAutoClear() {
  const r = race;
  for (const item of r.autoClear) {
    if (item.done || r.time < item.at) continue;
    item.done = true;
    const i = item.sector;
    const busy = r.obstacles.some(o => !o.cleared && o.sector === i + 1);
    if (!busy && r.sectorFlags[i] === "YELLOW" && r.flagSource[i] === "MARSHAL") setSectorFlag(i, "GREEN", "MARSHAL");
  }
}

function carApproachingPitExit() {
  const r = race;
  const L = r.track.length;
  return r.cars.some(c => c.mode === "RACE" && !c.pit.state && c.speed > 5 &&
    mod(r.track.pit.exit - c.s, L) < 250);
}

// All cars are back on the grid after the formation lap
function gridReady() {
  const r = race;
  r.phase = "GRID_READY";
  r.lights.state = "OFF";
  addAlert("info", "All cars are in their grid positions. The start procedure can begin.");

  // sometimes a car stalls on the grid -> the marshal waves a yellow flag next to it
  const onGrid = r.cars.filter(c => c.mode === "GRID");
  if (onGrid.length > 0 && chance(0.06 * r.level)) {
    const car = pick(onGrid);
    car.stalled = true;
    r.evalData.stallAtStart = true;
    addAlert("danger", carLabel(car) + " has STALLED on the grid (slot " + (car.slot + 1) +
      "). The marshal next to the car is waving a yellow flag.", { carId: car.id, s: car.s });
  }
}

// The five red lights go out: the race starts!
function lightsOut() {
  const r = race;
  r.phase = "RACE";
  r.lights.state = "OUT";
  r.lights.count = 0;
  if (r.raceStart === null) r.raceStart = r.time;
  r.lastStart = r.time;
  r.status = "GREEN";
  r.starts++;
  r.drsEnabled = false;
  r.drsAdvised = false;
  publish(r.starts === 1 ? "RACE START" : "RACE RESUMED - STANDING START", "Info");

  for (const car of r.cars) {
    if (car.mode !== "GRID") continue;
    car.mode = "RACE";
    car.restartOk = true;
    car.lapStart = r.time;
    car.sectorStart = r.time;
    car.launchTime = r.time;
    car.launchBoost = rand(0.9, 1.07);
    if (car.stalled) {
      car.launchDelay = rand(8, 22);
      r.evalData.startedWithStall = true;
    } else if (car.jump > 0) {
      car.launchDelay = 0.02;
      car.launchBoost *= 1.04;
      jumpStartIncident(car);
    } else {
      car.launchDelay = rand(0.18, 0.36);
    }
  }
  const leader = r.order[0];
  r.drsAdviceLap = (leader ? leader.laps : 0) + 2;
}

// After a VSC / SC: DRS may be enabled again 2 laps later
function afterNeutralisation() {
  const r = race;
  const leader = r.order[0];
  r.drsAdviceLap = (leader ? leader.laps : 0) + 2;
  r.drsAdvised = false;
  for (const car of r.cars) {
    car.unlapping = false;
  }
}

function finishRace() {
  const r = race;
  r.finished = true;
  r.phase = "FINISHED";
  publish("SESSION FINISHED", "Info");
  addAlert("info", "The race is over. Decide any open investigations, then open the race report.");
}


// =====================================================================
//  5. WEATHER
// =====================================================================
function updateWeather() {
  const r = race;
  if (r.weather.model === "cells") {
    updateCellWeather(r);
    return;
  }
  const w = r.weather;
  const L = r.track.length;

  // where are we in the race? (in laps of the leader)
  let lapNow = 0;
  const leader = r.order[0];
  if (r.raceStart !== null && leader) lapNow = leader.laps + leader.s / L;
  if (r.session === "QUALI") lapNow = r.q.elapsed / r.q.lapSeconds; // in qualifying: session time in "laps"

  let target = r.setup.weather.initialRain || 0;
  for (const e of w.schedule) {
    if (e.lap <= lapNow) target = e.rain;
  }

  w.rain += (target - w.rain) * 0.03;
  if (w.rain < 0.005) w.rain = 0;
  if (w.rain > w.wet) {
    w.wet += (w.rain - w.wet) * 0.008;      // the track gets wet
  } else {
    w.wet = Math.max(w.rain, w.wet - 0.0011 * (1 - w.rain)); // a dry line appears
  }

  if (!w.raining && w.rain > 0.08) {
    w.raining = true;
    const sector = randInt(1, r.track.marshalSectors);
    addAlert("warn", "Rain reported by marshal posts in sector " + sector + " and spreading around the circuit.", { sector });
  } else if (w.raining && w.rain < 0.03) {
    w.raining = false;
    addAlert("info", "Rain has stopped. The track will start to dry.");
  }
  if (w.wet > 0.85 && !w.heavyWarned) {
    w.heavyWarned = true;
    addAlert("danger", "Heavy rain – standing water and aquaplaning reported on the straights.");
  }
  if (w.wet < 0.6) w.heavyWarned = false;
}


// =====================================================================
//  6. HOW FAST CAN A CAR GO?
// =====================================================================

// Grip of a tyre on a wet (w = 1) or dry (w = 0) track
function wetGrip(compound, w) {
  if (compound === "INTERMEDIATE") return w < 0.5 ? 0.945 + 0.11 * w : 1.0 - 0.18 * (w - 0.5);
  if (compound === "WET") return w < 0.7 ? 0.9 + 0.1 * w / 0.7 : 1.0;
  return 1 - 0.5 * Math.pow(w, 1.1); // slick tyres are terrible in the rain
}

function tyreFactor(car) {
  const t = TYRES[car.tyre.compound] || TYRES.MEDIUM;
  const deg = race.tyreDeg; // 1 = classic, < 1 = flatter degradation (championship)
  let f = t.base * (1 - car.tyre.wear * 0.035 * deg);
  if (car.tyre.wear > 0.75) f *= 1 - (car.tyre.wear - 0.75) * 0.3 * deg; // the tyre "falls off the cliff"
  f *= wetGrip(car.tyre.compound, wetAt(car.s));
  if (car.coldTyres > 0) f *= 0.975;
  return f;
}

// 1.0 = an ideal car. Everything that makes the car slower reduces this number.
function carFactor(car) {
  let f = car.pace * tyreFactor(car) * (1 - car.fuel * 0.00032) * (1 - 0.1 * wetAt(car.s)) * car.lapNoise;
  if (car.damage.wing) f *= 0.975;
  f *= 1 - car.damage.floor * 0.03;
  return f;
}

// The speed the driver WANTS to drive right now (before other cars are in the way)
function desiredSpeed(car) {
  const r = race;
  const tr = r.track;
  const L = tr.length;
  const profile = trackSpeed(tr, car.s) * r.paceScale;

  if (car.mode === "FORMATION") {
    if (car.formDelay > 0) return 0;
    let v = Math.min(profile * 0.55, 48);
    const remaining = mod(car.slotS - car.s, L);
    if (car.formDist > 400 && remaining < 350) v = Math.min(v, Math.sqrt(2 * 4 * Math.max(0, remaining - 0.3)));
    return v;
  }
  if (car.mode === "COOLDOWN") return Math.min(profile * 0.45, 40);
  if (car.mode !== "RACE") return 0;
  if (car.launchDelay > 0 || car.spin > 0) return 0;

  car.factorNow = carFactor(car);
  if (r.session === "QUALI") car.factorNow *= qualiSpeedFactor(car);
  let v = profile * car.factorNow;

  v *= aeroSpeedFactor(car); // DRS, Straight Mode, Overtake Mode, battery (regs.js)
  if (car.slip) v *= 1.01;
  if (car.slowDown > 0) v *= 0.985;
  if (car.passing) v = Math.max(v, Math.min(car.passing.target.speed + 3.5, profile * 1.08));
  if (car.damage.puncture) v = Math.min(v, profile * 0.45, 35);
  if (car.failure && car.failure.slow) v = Math.min(v, profile * 0.5, 38);
  if (car.flag === "BLACK") v = Math.min(v, profile * 0.6);

  // coming into the pits: brake down to the pit lane speed before the speed line
  if (car.boxThisLap || r.status === "RED") {
    const d = mod(tr.pit.entry + 60 - car.s, L);
    if (d < 420) v = Math.min(v, Math.sqrt(PIT_SPEED * PIT_SPEED + 2 * 16 * d));
  }

  // neutralisations
  const st = r.status;
  if (st === "VSC" || st === "VSC_ENDING") v = Math.min(v, profile * 0.64);
  if ((st === "SC" || st === "SC_ENDING") && !car.restartOk) {
    if (car.unlapping) v = Math.min(v, profile * 0.8);
    else v = Math.min(v, profile * 0.7, 62);

    // after the safety car went into the pits, the leader controls the pace until the restart
    if (st === "SC_ENDING" && !r.sc && r.order[0] === car && !inRange(car.s, r.restartGo, L - 1, L)) {
      v = Math.min(v, profile * 0.55, 45);
    }
  }
  if (st === "RED") v = Math.min(v, profile * 0.45, 40);

  // local yellow flags
  const index = marshalSectorAt(tr, car.s) - 1;
  const flag = r.sectorFlags[index];
  if (!car.ignoreFlags) {
    if (flag === "DOUBLE") v *= 0.9;
    else if (flag === "YELLOW") v *= 0.985;
  }
  if (r.slippery[index]) v *= 0.985;
  return v;
}

// Target speed of a car in the pit lane
function pitLaneSpeed(car) {
  const r = race;
  const tr = r.track;
  const L = tr.length;
  const p = car.pit;
  const limit = PIT_SPEED * (1 + p.excess);
  const intoLane = mod(car.s - tr.pit.entry, L);

  // brake from track speed down to the limit before the speed line (60 m into the lane)
  let v = limit;
  if (intoLane < 60) v = Math.max(limit, Math.sqrt(limit * limit + 2 * 16 * (60 - intoLane)));

  if (p.state === "STOP" || p.state === "HOLD" || p.state === "REDSTOP" || p.state === "GARAGE") return 0;
  if (p.state === "IN" && p.reason !== "DT") {
    const d = mod(p.boxS - car.s, L);
    if (d < L - 30) v = Math.min(v, Math.sqrt(2 * 12 * Math.max(0, d - 0.3)));
  }
  if (p.state === "RED") {
    const d = mod(p.queueS - car.s, L);
    if (d < L - 30) v = Math.min(v, Math.sqrt(2 * 8 * Math.max(0, d - 0.3)));
  }
  if (p.state === "OUT" && !r.pitExitOpen) {
    const d = mod(tr.pit.exit - 8 - car.s, L);
    if (d < L - 30) v = Math.min(v, Math.sqrt(2 * 10 * Math.max(0, d)));
  }
  return v;
}

// Accelerate / brake towards the target speed
function approachSpeed(car, target) {
  if (target > car.speed) {
    let a = accelerationAt(car.speed);
    if (race.time - car.launchTime < 8) a *= car.launchBoost;
    car.speed = Math.min(target, car.speed + a * DT);
  } else {
    const b = car.spin > 0 ? 25 : brakingAt(car.speed);
    car.speed = Math.max(target, car.speed - b * DT);
  }
}


// =====================================================================
//  7. MOVE ALL CARS
// =====================================================================
function driveCars() {
  const r = race;
  const L = r.track.length;

  // ----- a) timers and wanted speed -----
  for (const car of r.cars) {
    if (car.mode === "STOPPED" || car.mode === "PARKED" || car.mode === "GRID" || car.mode === "GARAGE") {
      car.speed = 0;
      continue;
    }
    if (car.attemptCooldown > 0) car.attemptCooldown -= DT;
    if (car.slowDown > 0) car.slowDown -= DT;
    if (car.coldTyres > 0) car.coldTyres -= DT;
    if (car.formDelay > 0) car.formDelay -= DT;
    if (car.launchDelay > 0) {
      car.launchDelay -= DT;
      if (car.launchDelay <= 0 && car.stalled) {
        car.stalled = false;
        addAlert("info", carLabel(car) + " got away from the grid at last.", { carId: car.id });
      }
    }
    if (car.spin > 0) {
      car.spin -= DT;
      if (car.spin <= 0) afterSpin(car);
    }
    if (car.failure) {
      car.failure.left -= DT;
      if (car.failure.left <= 0) failureStop(car);
      if (car.mode === "STOPPED") continue;
    }
    if (car.pit.state === "STOP") {
      car.pit.stopLeft -= DT;
      if (car.pit.stopLeft <= 0) finishPitStop(car);
    }

    const target = car.pit.state ? pitLaneSpeed(car) : desiredSpeed(car);
    approachSpeed(car, target);
  }

  // ----- b) cars can't drive through each other -----
  applyBlocking();

  // ----- c) move -----
  for (const car of r.cars) {
    if (car.speed <= 0) continue;
    if (!(car.mode === "RACE" || car.mode === "FORMATION" || car.mode === "COOLDOWN")) continue;
    const from = car.s;
    const to = from + car.speed * DT;
    moveCar(car, from, to);
  }

  moveSafetyCar();

  // ----- d) overtakes that are finished, side-by-side position for drawing -----
  for (const car of r.cars) {
    if (car.passing) {
      const target = car.passing.target;
      const lead = mod(car.s - target.s, L);
      const ahead = lead > 0 && lead < L / 2;
      const over = (ahead && lead > 7) || target.pit.state || target.mode !== "RACE" ||
                   target.spin > 0 || r.time - car.passing.since > 9;
      if (over) {
        if (!ahead && target.mode === "RACE" && !target.pit.state && target.spin <= 0) {
          car.s = mod(target.s - 6, L); // the move did not work: drop back behind
        }
        if (!ahead && car.passing.counted) r.overtakes--; // only completed moves are overtakes
        car.passing = null;
      }
    }

    if (car.mode === "FORMATION" && car.speed > 8) {
      car.targetLateral = Math.sin(r.time * 1.6 + car.number) * 5; // weaving to warm the tyres
    } else if (car.mode === "GRID") {
      car.targetLateral = car.slot % 2 === 0 ? -5 : 5;
    } else if (car.spin > 0 || car.mode === "STOPPED") {
      car.targetLateral = car.offTrackSide || 14;
    } else if (car.passing) {
      car.targetLateral = car.passing.side * 7;
    } else {
      car.targetLateral = 0;
    }
    car.lateral += (car.targetLateral - car.lateral) * 0.12;
  }
}

// Cars that are physically on the track and can block others
function blockingCars() {
  const r = race;
  return r.cars.filter(c =>
    (c.mode === "RACE" || c.mode === "FORMATION") && !c.pit.state && c.spin <= 0 &&
    !(c.stalled && c.launchDelay > 0) && !(c.formDelay > 0) && !c.finished && !c.pitStart);
}

function minimumGap(car, aheadIsSafetyCar) {
  const r = race;
  if (car.mode === "FORMATION") return 6 + car.speed * 0.3;
  if ((r.status === "SC" || r.status === "SC_ENDING") && !car.restartOk) {
    return aheadIsSafetyCar ? 30 : 10 + car.speed * 0.3;
  }
  if (r.status === "RED") return 10 + car.speed * 0.3;
  return 5 + car.speed * 0.12;
}

function applyBlocking() {
  const r = race;
  const L = r.track.length;
  const list = blockingCars().map(car => ({ car: car, s: car.s }));
  if (r.sc) list.push({ sc: true, s: r.sc.s });
  if (list.length < 2) return;
  list.sort((a, b) => a.s - b.s);
  const n = list.length;

  // who is in front of whom, and try to overtake
  for (let i = 0; i < n; i++) {
    const me = list[i];
    me.ahead = list[(i + 1) % n];
    me.gap = mod(me.ahead.s - me.s, L);
    if (me.sc) continue;
    me.car.gapAheadM = me.gap;
    me.car.slip = !me.ahead.sc && me.gap < 40 && trackSpeed(r.track, me.car.s) > r.track.vMax * 0.9;
    if (!me.ahead.sc && me.gap < 8 + me.car.speed * 0.45) considerOvertake(me.car, me.ahead.car);
  }

  // slow down when too close to the car in front (two rounds, so it spreads through a queue)
  for (let round = 0; round < 2; round++) {
    for (let i = n - 1; i >= 0; i--) {
      const me = list[i];
      if (me.sc) continue;
      const car = me.car;
      const ahead = me.ahead;
      if (car.unlapping) continue;
      if (!ahead.sc && car.passing && car.passing.target === ahead.car) continue;
      if (!ahead.sc && ahead.car.unlapping) continue;
      const aheadSpeed = ahead.sc ? r.sc.speed : ahead.car.speed;
      const room = me.gap + aheadSpeed * DT - minimumGap(car, !!ahead.sc);
      if (car.speed * DT > room) car.speed = Math.max(0, room / DT);
    }
  }
}

// Move one car from "from" to "to" and check everything it passed
function moveCar(car, from, to) {
  const r = race;
  const tr = r.track;
  const L = tr.length;

  // stalled car on the grid: cars behind have to avoid it
  for (const other of r.cars) {
    if (other.stalled && other.launchDelay > 0 && other !== car && car.mode === "RACE" &&
        passedPoint(from, to, other.s, L) && chance(0.03 * r.level)) {
      hitStalledCar(car, other);
    }
  }

  // The exact moment the car passed point x during this step (like a real timing loop).
  // Without this, all times would be rounded to the 0.1 s simulation step.
  const exactTime = x => r.time - DT + DT * clamp(mod(x - from, L) / Math.max(1e-9, to - from), 0, 1);

  if (passedPoint(from, to, 0, L)) {
    r.stamp = exactTime(0);
    crossLine(car);
  }
  if (car.mode === "PARKED") {
    r.stamp = null;
    return;
  }

  for (let k = 0; k < 2; k++) {
    if (passedPoint(from, to, tr.sectorBounds[k], L)) {
      const t = exactTime(tr.sectorBounds[k]);
      car.sectorTimes[k] = t - car.sectorStart;
      car.sectorStart = t;
    }
  }

  const msFrom = Math.floor(mod(from, L) / tr.msLen);
  const msTo = Math.floor(mod(to, L) / tr.msLen);
  if (msFrom !== msTo) {
    const index = Math.min(msTo, tr.marshalSectors - 1);
    r.stamp = exactTime(index * tr.msLen);
    enterMarshalSector(car, index);
  }
  r.stamp = null;

  if (car.mode === "RACE" && !car.pit.state) {
    for (const corner of tr.corners) {
      if (passedPoint(from, to, corner.apex, L)) cornerEvents(car, corner);
    }
    updateAeroZones(car, from, to); // DRS zones or Straight Mode / Overtake Mode / battery (regs.js)
    // the team decides 300 m before the pit entry, so the driver can slow down in time
    if (car.spin <= 0 && passedPoint(from, to, tr.pit.entry - 300, L)) pitEntryDecision(car);
    if (passedPoint(from, to, tr.pit.entry, L)) {
      if (r.status === "RED") enterPit(car, r.session === "QUALI" ? "GARAGE" : "RED");
      else if (car.boxThisLap) enterPit(car, car.boxThisLap);
      car.boxThisLap = null;
    }
  }

  const distance = to - from;
  car.s = mod(to, L);

  if (car.pit.state) updatePitCar(car);

  if (car.mode === "FORMATION") {
    car.formDist += distance;
    const remaining = mod(car.slotS - car.s, L);
    if (!car.pit.state && car.formDist > 400 && (remaining < 0.6 || remaining > L - 20)) {
      car.s = car.slotS;
      car.speed = 0;
      car.mode = "GRID";
      car.skipLine = true;
    }
  }

  if (car.mode === "COOLDOWN") {
    car.cooldown += distance;
    if (car.cooldown > L * 0.6 && !car.pit.state) {
      car.mode = "PARKED";
      car.hidden = true;
    }
  }

  if (car.mode === "RACE") {
    const lapsDriven = distance / L;
    const neutral = isNeutralised() ? 0.3 : 1;
    const tyre = TYRES[car.tyre.compound] || TYRES.MEDIUM;
    const wetMismatch = tyre.slick ? 1 : (wetAt(car.s) < 0.2 ? 2.2 : 1); // wet tyres overheat on a dry track
    car.tyre.wear = Math.min(1, car.tyre.wear + lapsDriven * tyre.wear * r.wearScale * neutral *
      (1.15 - car.tyreMgmt * 0.3) * wetMismatch);
    car.fuel = Math.max(0, car.fuel - lapsDriven * r.fuelPerLap * (isNeutralised() ? 0.5 : 1));
  }
}

// The car crosses the start/finish line
function crossLine(car) {
  const r = race;
  if (car.mode !== "RACE") return;
  if (car.skipLine) {
    car.skipLine = false;
    return;
  }
  if (r.session === "QUALI") {
    qualiCrossLine(car);
    return;
  }

  // safety car restart: green flag when the leader crosses the line
  if (r.status === "SC_ENDING" && !r.sc && r.order[0] === car) {
    r.status = "GREEN";
    publish("TRACK CLEAR", "Flag");
    afterNeutralisation();
  }
  if (r.status === "GREEN") car.restartOk = true;

  const now = timingNow();
  car.laps++;
  const record = {
    lap: car.laps,
    time: now - car.lapStart,
    s1: car.sectorTimes[0],
    s2: car.sectorTimes[1],
    s3: now - car.sectorStart,
    compound: car.tyre.compound,
    valid: !car.invalidLaps[car.laps],
    pitLane: !!car.pit.state || car.pit.lastStopLap === car.laps - 1,
    t: now
  };
  car.lapTimes.push(record);
  car.lastLap = record;
  if (record.valid && !record.pitLane && (!car.bestLap || record.time < car.bestLap.time)) car.bestLap = record;

  car.lapStart = now;
  car.sectorStart = now;
  car.sectorTimes = [null, null, null];
  car.tyre.age++;
  recordLapSnapshot(car); // for the count-back classification of an abandoned race
  car.lapNoise = 1 + (random() * 2 - 1) * 0.004 * (1.3 - car.consistency);
  if (car.flag === "BW") car.flag = null; // the black & white flag is shown for one lap

  // ----- the finish -----
  if (r.chequered) {
    finishCar(car);
    return;
  }
  if (car.laps >= r.totalLaps) {
    r.chequered = true;
    r.chequerTime = r.time;
    publish("CHEQUERED FLAG", "Flag");
    finishCar(car);
    return;
  }

  // ----- things that can happen once per lap -----
  if (r.raceStart !== null && chance(0.0007 * r.level * car.failureScale)) startFailure(car); // failureScale: reliability (championship)
  if (car.damage.wing && chance(0.08)) {
    addObstacle({ type: "DEBRIS", s: car.s + rand(200, 900), onTrack: true, required: rand(30, 70),
                  label: "parts from " + carLabel(car) });
    addAlert("warn", carLabel(car) + " is losing parts from the damaged front wing.", { carId: car.id });
  }
  checkPenaltyDeadline(car);
}

function finishCar(car) {
  car.finished = true;
  car.finishTime = timingNow();
  car.passing = null;
  closeAero(car);
  car.restartOk = true;
  if (!car.pit.state) {
    car.mode = "COOLDOWN";
    car.cooldown = 0;
  }
}

// The car enters a new marshal sector
function enterMarshalSector(car, index) {
  const r = race;
  if (car.mode !== "RACE") return;
  recordPassing(car, index);
  car.ignoreFlags = false;
  if (car.pit.state || car.finished || car.spin > 0) return;

  const flag = r.sectorFlags[index];

  if (r.session === "QUALI") {
    if (flag !== "GREEN") qualiYellow(car, index, flag);
    // a car on a slow lap that is slower than the maximum delta time (once per car and segment)
    const slowLap = car.q.phase === "OUT" || car.q.phase === "COOL";
    if (r.q.maxDelta && slowLap && r.status === "GREEN" && car.q.deltaReported !== r.q.segment && chance(0.0012 * r.level)) {
      car.q.deltaReported = r.q.segment;
      rdInstructionIncident([car], "MAX_DELTA");
    }
    for (const ob of r.obstacles) {
      if (!ob.cleared && ob.sector === index + 1) obstacleRisk(car, ob, flag);
    }
    return;
  }

  // flag offences (rare)
  if (flag === "DOUBLE" && r.status === "GREEN" && chance(0.006 * r.level)) {
    car.ignoreFlags = true;
    doubleYellowIncident(car, index);
  }
  if (r.status === "VSC" && chance(0.003 * r.level)) vscDeltaIncident(car, index);
  if (r.status === "SC" && !car.restartOk && !car.unlapping && chance(0.0005 * r.level)) rdInstructionIncident([car], "SC_DELTA");
  if (r.status === "SC" && !car.restartOk && !car.unlapping && chance(0.0006 * r.level)) {
    const victim = carDirectlyAhead(car);
    if (victim && car.gapAheadM < 40) safetyCarOvertakeIncident(car, victim);
  }

  // things lying on the track in this sector
  for (const ob of r.obstacles) {
    if (ob.cleared || ob.sector !== index + 1) continue;
    obstacleRisk(car, ob, flag);
  }
}

function carDirectlyAhead(car) {
  const L = race.track.length;
  let best = null;
  let bestGap = Infinity;
  for (const other of blockingCars()) {
    if (other === car) continue;
    const g = mod(other.s - car.s, L);
    if (g > 0 && g < bestGap) {
      best = other;
      bestGap = g;
    }
  }
  return best;
}


// =====================================================================
//  8. OVERTAKING
// =====================================================================
function zoneType(track, s) {
  const v = trackSpeed(track, s);
  const later = trackSpeed(track, s + 40);
  if (later < v * 0.93) return "BRAKING";
  if (v > track.vMax * 0.9) return "STRAIGHT";
  return "CORNER";
}

function considerOvertake(me, ahead) {
  const r = race;
  const L = r.track.length;
  if (me.mode !== "RACE" || ahead.mode !== "RACE") return;
  if (r.session === "QUALI") {
    if (r.status !== "RED") qualiTraffic(me, ahead);
    return;
  }
  if (me.passing || me.attemptCooldown > 0 || me.launchDelay > 0) return;
  if (me.finished || ahead.finished) return;

  const lapping = progressOf(me) - progressOf(ahead) > L * 0.5; // "me" is about to lap "ahead"

  // no overtaking under neutralisation (except at the restart after the line)
  if (r.status === "VSC" || r.status === "VSC_ENDING" || r.status === "RED") return;
  if ((r.status === "SC" || r.status === "SC_ENDING") && !(me.restartOk && ahead.restartOk)) return;
  if (!me.restartOk || !ahead.restartOk) return;

  // ----- a lapped car moves over for a blue flag -----
  if (lapping) {
    const p = ahead.blue.ignore ? 0.004 : 0.06;
    if (chance(p)) {
      startPass(me, ahead);
      race.overtakes--; // letting a faster car lap you is not an overtake
      me.passing.counted = false;
    }
    return;
  }

  let advantage = (me.factorNow - ahead.factorNow) / ahead.factorNow;
  advantage += overtakeAidAdvantage(me);
  if (me.slip) advantage += 0.004;
  const startPhase = r.time - r.lastStart < 25;
  // a car needs a real pace advantage to try a move. With overtakeScale < 1
  // (championship) the follower also loses grip in the dirty air of the car
  // ahead, so it needs 1.5–2.5 % more pace – or DRS / Overtake Mode – to pass
  if (advantage <= 0.0015 + (1 - r.overtakeScale) * 0.03 && !startPhase) return;

  const zone = zoneType(r.track, me.s);
  let p = 0.004 * clamp(advantage * 250, 0.2, 4);
  if (startPhase) p = Math.max(p, 0.02);
  p *= zone === "BRAKING" ? 2.5 : zone === "STRAIGHT" ? 1.0 : 0.25;
  p *= 0.6 + me.aggression * 0.8;
  p *= r.overtakeScale;
  p *= 1.25 - ahead.racecraft * 0.5;

  const sector = marshalSectorAt(r.track, me.s) - 1;
  const yellow = r.sectorFlags[sector] !== "GREEN";
  if (yellow) p *= 0.03; // drivers (almost) never overtake under yellow
  if (!chance(p)) return;

  me.attemptCooldown = rand(1.5, 4);

  // ----- what happens? contact, an off-track moment, or a clean move -----
  const wet = wetAt(me.s);
  const firstLap = me.laps === 0;
  const collisionChance = 0.012 * r.level * (0.5 + me.aggression) * (0.6 + ahead.aggression * 0.6) *
    (1 + wet * 1.5) * (firstLap ? 2.5 : 1) * (zone === "BRAKING" ? 1.3 : zone === "CORNER" ? 1.6 : 0.4);
  const roll = random();

  if (roll < collisionChance) {
    createCollision(me, ahead, zone, {});
    return;
  }
  if (roll < collisionChance + 0.012 * r.level) {
    racecraftIncident(me, ahead);
    return;
  }

  const success = clamp(0.45 + advantage * 40 + overtakeAidSuccess(me, ahead) + me.racecraft * 0.15 - ahead.racecraft * 0.15, 0.2, 0.92);
  if (chance(success)) {
    startPass(me, ahead);
    if (yellow) overtakeUnderYellowIncident(me, ahead, sector);
  }
}

function startPass(me, ahead) {
  me.passing = { target: ahead, since: race.time, side: chance(0.5) ? 1 : -1, counted: true };
  ahead.slowDown = 1.2;
  race.overtakes++;
}


// =====================================================================
//  9. CORNERS: spins, track limits, brake failures
// =====================================================================
function cornerEvents(car, corner) {
  const r = race;
  if (car.finished || car.spin > 0 || car.launchDelay > 0) return;

  if (car.failure && car.failure.brakes) {
    crashCar(car, corner, "brake failure", true);
    return;
  }

  const w = wetAt(corner.apex);
  const tyre = TYRES[car.tyre.compound] || TYRES.MEDIUM;
  const mismatch = tyre.slick ? w : car.tyre.compound === "WET" ? Math.max(0, 0.4 - w) : Math.max(0, 0.15 - w);
  const sector = marshalSectorAt(r.track, corner.apex) - 1;
  const oil = r.obstacles.some(o => !o.cleared && o.type === "OIL" && o.sector === sector + 1);

  let p = 0.0002 * r.level * (1.5 - car.consistency) * (1 + 40 * mismatch * mismatch) * (1 + 10 * w * w);
  if (car.tyre.wear > 0.8) p *= 3;
  if (car.coldTyres > 0) p *= 2.5;
  if (oil) p *= 6;
  if (r.slippery[sector]) p *= 1.5;
  if (car.damage.wing || car.damage.floor > 0.3) p *= 2;
  if (car.laps === 0 && r.session === "RACE") p *= 1.5;
  if (r.session === "QUALI" && car.q.phase === "PUSH") p *= 1.5; // drivers take more risk on a push lap
  if (r.session === "QUALI" && car.q.phase !== "PUSH") p *= 0.3;
  p *= 1 + 3 * windRisk(r.track, corner.apex); // gusts in fast corners
  if (r.heatStress) p *= 1.3;                    // heat hazard not declared: tired drivers
  if (isNeutralised()) p *= 0.1;

  if (chance(p)) {
    spinOutcome(car, corner);
    return;
  }

  // track limits at the exit of some corners (in qualifying only push laps matter, and they push harder)
  const tlChance = r.session === "QUALI" ? (car.q.phase === "PUSH" && !car.q.aborted ? 0.012 : 0) : 0.004;
  if (corner.trackLimits && r.status === "GREEN" && chance(tlChance * r.level * (0.6 + car.aggression) * (1 + car.tyre.wear))) {
    createTrackLimits(car, corner, {});
  }
}

// A spin can end in very different ways
function spinOutcome(car, corner) {
  const roll = random();
  if (roll < 0.6) {
    spinCar(car, corner, "spun");
  } else if (roll < 0.8) {
    spinCar(car, corner, "spun into the gravel");
    retireCar(car, "Stuck in the gravel at " + corner.name, { onTrack: chance(0.3), crash: false });
  } else if (roll < 0.93) {
    crashCar(car, corner, "lost control", false);
  } else {
    spinCar(car, corner, "spun and hit the barrier lightly");
    car.damage.wing = true;
    addObstacle({ type: "DEBRIS", s: car.s, onTrack: true, required: rand(30, 70), label: "debris from " + carLabel(car) });
  }
}

function spinCar(car, corner, what) {
  const r = race;
  car.spin = rand(3.5, 8);
  car.passing = null;
  closeAero(car);
  car.offTrackSide = chance(0.5) ? 16 : -16;
  car.spinCheck = true;
  car.lastSpinAt = r.time;
  const sector = marshalSectorAt(r.track, car.s);
  addAlert("warn", carLabel(car) + " " + what + " at " + corner.name + " (sector " + sector + ").", { carId: car.id, s: car.s, sector });
  marshalYellow(sector - 1, 15);

  // the car behind may hit the spinning car
  const behind = r.cars.find(o => o !== car && o.mode === "RACE" && !o.pit.state && o.spin <= 0 &&
    mod(car.s - o.s, r.track.length) < 40);
  if (behind && chance(0.18 * r.level)) {
    createCollision(behind, car, "CORNER", { forceBlame: "SPINNER", spinner: car });
  }
}

// After a spin the driver rejoins – sometimes in a dangerous way
function afterSpin(car) {
  const r = race;
  if (!car.spinCheck || car.mode !== "RACE") return;
  car.spinCheck = false;
  const L = r.track.length;
  const coming = r.cars.find(o => o !== car && o.mode === "RACE" && !o.pit.state && o.speed > 40 &&
    mod(car.s - o.s, L) < 120);
  if (coming && chance(0.25)) unsafeRejoinIncident(car, coming);
}

function crashCar(car, corner, reason, brakeFailure) {
  const r = race;
  car.offTrackSide = chance(0.5) ? 18 : -18;
  const onTrack = chance(0.25);
  retireCar(car, (brakeFailure ? "Brake failure – crashed at " : "Crashed at ") + corner.name, { onTrack, crash: true });
  addAlert("danger", "CRASH: " + carLabel(car) + " " + reason + " and hit the barrier at " + corner.name + ".",
    { carId: car.id, s: car.s, sector: marshalSectorAt(r.track, car.s) });

  if (chance(0.15)) {
    addObstacle({ type: "BARRIER", s: car.s, onTrack: false, required: rand(250, 420), label: "damaged barrier at " + corner.name });
    addAlert("danger", "Marshal post " + marshalSectorAt(r.track, car.s) + ": the barrier at " + corner.name +
      " is badly damaged and must be repaired (needs a Safety Car or red flag).", { s: car.s });
  }
}


// =====================================================================
//  10. FAILURES AND RETIREMENTS
// =====================================================================
function startFailure(car, forcedType) {
  if (car.failure || car.mode !== "RACE") return;
  const roll = random();
  const type = forcedType || (roll < 0.4 ? "Power unit" : roll < 0.6 ? "Hydraulics" : roll < 0.8 ? "Gearbox" : roll < 0.9 ? "Brakes" : "Puncture");

  if (type === "Puncture") {
    car.damage.puncture = true;
    addAlert("warn", carLabel(car) + " has a puncture and is slow on track.", { carId: car.id, s: car.s });
    if (chance(0.5)) addObstacle({ type: "DEBRIS", s: car.s + 50, onTrack: true, required: rand(25, 50), label: "tyre debris" });
    return;
  }
  if (type === "Brakes") {
    car.failure = { type, left: 9999, brakes: true };
    return;
  }
  if (type === "Hydraulics") {
    car.failure = { type, left: 9999, slow: true, toPits: true };
  } else {
    car.failure = { type, left: rand(8, 35), slow: true, oil: type === "Power unit" && chance(0.35) };
  }
  addAlert("warn", carLabel(car) + " is slow on track – team radio reports a " + type.toLowerCase() + " problem.",
    { carId: car.id, s: car.s });
}

function failureStop(car) {
  const r = race;
  const f = car.failure;
  car.failure = null;
  if (car.pit.state) {
    retireCar(car, f.type + " failure", { inGarage: true });
    return;
  }
  if (f.oil) {
    addObstacle({ type: "OIL", s: car.s - 30, onTrack: true, required: rand(90, 160), label: "oil from " + carLabel(car) });
    addAlert("danger", "Oil on the track in sector " + marshalSectorAt(r.track, car.s) + " (" + locationName(r.track, car.s) + ").",
      { s: car.s, sector: marshalSectorAt(r.track, car.s) });
  }
  car.offTrackSide = chance(0.5) ? 18 : -18;
  retireCar(car, f.type + " failure", { onTrack: chance(0.3), crash: false });
}

// opts: onTrack (car stopped in a dangerous place), inGarage, crash
function retireCar(car, reason, opts) {
  const r = race;
  if (car.status === "RETIRED") return;
  car.status = "RETIRED";
  car.retireReason = reason;
  car.retiredLap = car.laps;
  car.retiredAt = r.time;
  car.speed = 0;
  car.passing = null;
  car.failure = null;
  closeAero(car);
  car.spin = 0;

  if (opts.inGarage) {
    car.mode = "PARKED";
    car.hidden = true;
    car.pit.state = null;
    addAlert("info", carLabel(car) + " retired in the garage (" + reason + ").", { carId: car.id });
    return;
  }

  car.mode = "STOPPED";
  if (opts.onTrack) car.offTrackSide = 0;
  const sector = marshalSectorAt(r.track, car.s);
  addObstacle({
    type: "CAR", s: car.s, onTrack: !!opts.onTrack, carId: car.id, crash: !!opts.crash,
    required: opts.onTrack ? rand(70, 140) : rand(50, 120),
    label: "the car of " + car.name + " (" + car.number + ")"
  });
  if (opts.crash && chance(0.6)) {
    addObstacle({ type: "DEBRIS", s: car.s + rand(-20, 30), onTrack: true, required: rand(40, 90), label: "debris at " + locationName(r.track, car.s) });
  }
  addAlert(opts.onTrack ? "danger" : "warn",
    carLabel(car) + " has stopped " + (opts.onTrack ? "ON THE TRACK" : "in the run-off area") + " at " +
    locationName(r.track, car.s) + " (sector " + sector + "). " + reason + ".",
    { carId: car.id, s: car.s, sector });
}

function hitStalledCar(car, stalled) {
  createCollision(car, stalled, "STRAIGHT", { forceBlame: "STALLED" });
}


// =====================================================================
//  11. PIT STOPS
// =====================================================================

// Does the team call the car in? Returns a reason or null.
function wantsToPit(car) {
  const r = race;
  if (car.dsq || car.flag === "BLACK") return "DSQ";
  if (car.failure && car.failure.toPits) return "RETIRE";
  if (r.status === "RED") return "RED";
  if (car.finished) return null;

  const neutral = isNeutralised();
  if (car.damage.puncture || car.flag === "BO") return "REPAIR";
  if (car.damage.wing && chance(0.5)) return "REPAIR";
  if ((car.pen.dt || car.pen.sg) && !neutral) return car.pen.dt ? "DT" : "SG";

  const lapsLeft = r.totalLaps - car.laps;
  if (lapsLeft <= 1) return null;

  const w = teamWetView();
  const compound = car.tyre.compound;
  const slick = TYRES[compound].slick;
  if (slick && w > 0.28 && chance(0.55)) return "TYRES";
  if (compound === "INTERMEDIATE" && w > 0.82 && chance(0.4)) return "TYRES";
  if (compound === "WET" && w < 0.45 && chance(0.5)) return "TYRES";
  if (!slick && w < 0.12 && r.weather.rain < 0.05 && chance(0.45)) return "TYRES";

  if (lapsLeft <= 3) return null;
  if (car.tyre.wear > 0.78) return "TYRES";
  const next = car.plan[0];
  if (next && car.laps + 1 >= next.lap) return "TYRES";
  if (neutral && next && next.lap - car.laps <= 8 && car.laps - car.pit.lastStopLap > 5 && chance(0.75)) return "TYRES";
  return null;
}

function pitEntryDecision(car) {
  const r = race;
  car.boxThisLap = null;
  if (r.status === "RED") return; // under red every car goes in anyway
  if (r.session === "QUALI") {
    if (wantsGarage(car)) car.boxThisLap = "GARAGE";
    return;
  }
  const reason = wantsToPit(car);
  if (!reason) return;

  const allowedWhenClosed = ["REPAIR", "DSQ", "RETIRE"];
  if (!r.pitEntryOpen && !allowedWhenClosed.includes(reason)) {
    if (chance(0.01 * r.level)) {
      car.boxThisLap = reason;
      setTimeoutRace(4, () => pitEntryClosedIncident(car));
    }
    return;
  }
  car.boxThisLap = reason; // "box, box"
}

function enterPit(car, reason) {
  const r = race;
  const p = car.pit;
  p.reason = reason;
  p.excess = reason !== "RED" && chance(0.02 * r.level) ? rand(0.005, 0.07) : 0;
  p.maxSpeed = 0;
  p.speedChecked = false;
  closeAero(car);
  car.passing = null;
  if (reason === "RED") {
    p.state = "RED";
    p.queueS = mod(r.track.pit.exit - 15 - 11 * r.redQueueCount++, r.track.length);
  } else {
    p.state = "IN";
  }
}

// After moving: did the car reach its box, the end of the queue or the pit exit?
function updatePitCar(car) {
  const r = race;
  const tr = r.track;
  const L = tr.length;
  const p = car.pit;
  const intoLane = mod(car.s - tr.pit.entry, L);

  // the speed trap measures the speed in the pit lane
  if (intoLane > 75 && intoLane < tr.pit.length && mod(tr.pit.exit - car.s, L) > 30) p.maxSpeed = Math.max(p.maxSpeed, car.speed);

  if (p.state === "IN") {
    const d = mod(p.boxS - car.s, L);
    const reached = d < 0.5 || d > L - 30;
    if (p.reason === "DT") {
      if (reached) p.state = "OUT";
    } else if (reached) {
      car.s = p.boxS;
      car.speed = 0;
      checkPitSpeed(car);
      if (p.reason === "GARAGE") {
        parkInGarage(car); // qualifying: back in the garage
        return;
      }
      if (p.reason === "DSQ") {
        retireCar(car, "Disqualified", { inGarage: true });
        car.status = "RETIRED";
        return;
      }
      if (p.reason === "RETIRE") {
        retireCar(car, (car.failure ? car.failure.type : "Technical") + " problem", { inGarage: true });
        return;
      }
      p.state = "STOP";
      p.stopLeft = pitStopDuration(car);
      p.stopTotal = p.stopLeft;
    }
  } else if (p.state === "RED") {
    const d = mod(p.queueS - car.s, L);
    if (d < 0.5 || d > L - 30) {
      car.s = p.queueS;
      car.speed = 0;
      p.state = "REDSTOP";
    }
  } else if (p.state === "OUT") {
    if (r.status === "RED" && r.session === "RACE") {
      p.state = "RED";
      p.reason = "RED";
      p.queueS = mod(tr.pit.exit - 15 - 11 * r.redQueueCount++, L);
      return;
    }
    const d = mod(tr.pit.exit - car.s, L);
    if (d < 1 || d > L - 30) leavePitLane(car);
  }
}

function pitStopDuration(car) {
  const p = car.pit;
  if (p.reason === "SG") return 10;
  let t = rand(2.0, 3.1);
  p.slow = false;
  if (chance(0.05)) {
    t += rand(2, 8);
    p.slow = true; // problem with a wheel nut
  }
  if (car.damage.wing || car.flag === "BO") t += rand(5, 9); // new front wing
  if (car.pen.time > 0) {
    p.servedNow = car.pen.time; // mechanics must wait until the time penalty is served
    t += car.pen.time;
  }
  return t;
}

function finishPitStop(car) {
  const r = race;
  const L = r.track.length;
  const p = car.pit;

  if (p.reason === "SG") {
    servePenalty(car, "SG");
  } else {
    if (p.servedNow > 0) {
      servePenalty(car, "TIME", p.servedNow);
      p.servedNow = 0;
    }
    const compound = chooseCompound(car);
    car.tyre = { compound, age: 0, wear: 0 };
    if (!car.tyresUsed.includes(compound)) car.tyresUsed.push(compound);
    car.coldTyres = 25;
    car.damage.wing = false;
    car.damage.puncture = false;
    if (car.flag === "BO") car.flag = null;
    if (car.plan[0] && car.plan[0].lap - car.laps <= 8) car.plan.shift();
  }
  p.stops++;
  p.lastStopLap = car.laps;
  r.pitStops++;
  p.state = "OUT";

  // unsafe release: the car is sent out into the path of another car in the pit lane
  const other = r.cars.find(o => o !== car && (o.pit.state === "IN" || o.pit.state === "OUT") &&
    mod(car.s - o.s, L) > 0 && mod(car.s - o.s, L) < 25);
  if (other && chance(0.25 * r.level)) unsafeReleaseIncident(car, other, chance(0.3));
}

function leavePitLane(car) {
  const r = race;
  const p = car.pit;
  if (p.reason === "DT") servePenalty(car, "DT");
  checkPitSpeed(car);
  p.state = null;
  p.reason = null;
  p.excess = 0;
  p.maxSpeed = 0;
  if (car.pitStart) car.pitStart = false;
  if (car.mode === "RACE" && !car.finished && chance(0.008 * r.level)) pitExitLineIncident(car);
  if (car.finished) {
    car.mode = "PARKED";
    car.hidden = true;
  }
}

function checkPitSpeed(car) {
  const p = car.pit;
  if (p.speedChecked) return;
  if (p.maxSpeed > PIT_SPEED + 0.06) {
    p.speedChecked = true;
    pitSpeedingIncident(car, p.maxSpeed * 3.6);
  }
}

// Which tyres do we fit now?
function chooseCompound(car) {
  const r = race;
  const w = teamWetView();
  if (w > 0.78) return "WET";
  if (w > 0.22) return "INTERMEDIATE";
  const next = car.plan[0];
  if (next && next.lap - car.laps <= 8) return next.compound;

  const lapsLeft = r.totalLaps - car.laps;
  let choice = lapsLeft < 14 ? "SOFT" : lapsLeft < 25 ? "MEDIUM" : "HARD";
  const usedSlicks = car.tyresUsed.filter(c => TYRES[c].slick);
  if (usedSlicks.length === 1 && usedSlicks[0] === choice) choice = choice === "HARD" ? "MEDIUM" : "HARD";
  return choice;
}


// =====================================================================
//  12. SAFETY CAR
// =====================================================================
function moveSafetyCar() {
  const r = race;
  const sc = r.sc;
  if (!sc) return;
  const tr = r.track;
  const L = tr.length;

  let target = Math.min(trackSpeed(tr, sc.s) * r.paceScale * 0.6, 58);
  const leader = r.order.find(c => c.mode === "RACE" && !c.pit.state && isRunning(c));
  if (leader) {
    const gap = mod(sc.s - leader.s, L);
    if (gap > 400 && gap < L / 2) target *= 0.6; // wait for the leader
  }
  sc.speed = target > sc.speed ? Math.min(target, sc.speed + 8 * DT) : Math.max(target, sc.speed - 25 * DT);

  const from = sc.s;
  const to = sc.s + sc.speed * DT;
  if (sc.inLap && passedPoint(from, to, tr.pit.entry, L)) {
    r.sc = null;
    r.scInPit = true;
    r.restartGo = mod(-rand(250, 700), L);
    addAlert("info", "The Safety Car has entered the pit lane. The leader now controls the pace until the restart.");
    return;
  }
  sc.s = mod(to, L);

  // lapped cars that were allowed to overtake: are they past the safety car?
  for (const car of r.cars) {
    if (!car.unlapping) continue;
    car.unlapLeft -= car.speed * DT - sc.speed * DT;
    if (car.unlapLeft < -40) car.unlapping = false;
  }
}


// =====================================================================
//  13. BLUE FLAGS, ADVICE AND STATISTICS (once per second)
// =====================================================================
function updateBlueFlags() {
  const r = race;
  const L = r.track.length;
  if (r.status !== "GREEN" || r.raceStart === null || r.session === "QUALI") {
    for (const car of r.cars) car.blue.active = false;
    return;
  }

  const onTrack = blockingCars().filter(c => c.mode === "RACE").sort((a, b) => a.s - b.s);
  const n = onTrack.length;
  for (let i = 0; i < n; i++) {
    const car = onTrack[i];
    const behind = onTrack[(i - 1 + n) % n];
    if (behind === car) continue;
    const gapM = mod(car.s - behind.s, L);
    const lapping = progressOf(behind) - progressOf(car) > L * 0.5;
    const close = gapM < Math.max(behind.speed, 30) * 1.2;

    if (lapping && close) {
      if (!car.blue.active) {
        car.blue.active = true;
        car.blue.since = r.time;
        car.blue.held = 0;
        car.blue.ignore = chance(0.05 * r.level);
        car.blue.reported = false;
        if (car.blue.lastMsgLap !== car.laps) {
          car.blue.lastMsgLap = car.laps;
          publish("WAVED BLUE FLAG FOR " + carLabel(car) + " TIMED AT " + formatDayTime(r.clockStart + r.time), "Blue");
        }
      } else {
        car.blue.held++;
        if (car.blue.ignore && car.blue.held > 10 && !car.blue.reported) {
          car.blue.reported = true;
          blueFlagIncident(car, behind, car.blue.held);
        }
      }
    } else {
      car.blue.active = false;
    }
  }
  for (const car of r.cars) {
    if (!onTrack.includes(car)) car.blue.active = false;
  }
}

// DRS / Overtake Mode / Straight Mode advice for the Race Director (regs.js)
function adviceTick() {
  regsAdvice();
}

function evaluationTick() {
  const r = race;
  const e = r.evalData;
  regsEvaluationTick();

  const neutral = ["VSC", "SC", "SC_ENDING", "VSC_ENDING"].includes(r.status);
  if (!neutral) r.neutralSince = r.time;
  const reason = r.obstacles.some(o => !o.cleared) || (r.weather.wetMax !== undefined ? r.weather.wetMax : r.weather.wet) > 0.75 || r.weather.lightningKm < LIGHTNING_KM;
  if (neutral && !reason && r.time - r.neutralSince > 90) e.neutralNoReason++;
}


// =====================================================================
//  14. HISTORY (for the incident replays)
// =====================================================================
function recordHistory() {
  const r = race;
  if (r.time - r.lastHistory < 0.2) return;
  r.lastHistory = r.time;

  const frame = { t: r.time, sc: r.sc ? r.sc.s : null, cars: [] };
  for (const c of r.cars) {
    if (c.hidden || c.mode === "PARKED") continue;
    frame.cars.push([c.id, c.s, c.lateral, c.pit.state ? 1 : 0, c.spin > 0 || c.mode === "STOPPED" ? 1 : 0, c.speed]);
  }
  r.history.push(frame);
  while (r.history.length > 0 && r.history[0].t < r.time - 90) r.history.shift();
}

function updateClips() {
  const r = race;
  for (const inc of r.incidents) {
    if (!inc.clip && r.time >= inc.clipAt) {
      inc.clip = r.history.filter(f => f.t >= inc.t - 8 && f.t <= inc.clipAt);
      r.ver++;
    }
  }
}


// =====================================================================
//  15. HISTORIC RACE: real events that happen at the real lap
// =====================================================================
function runInjections() {
  const r = race;
  // qualifying: real events are timed by the session clock of their segment
  if (r.session === "QUALI") {
    if (r.q.state !== "RUNNING" || r.status === "RED") return;
    for (const inj of r.injections) {
      if (inj.done) continue;
      if (inj.segment < r.q.segment) inj.done = true; // that segment is over
      else if (inj.segment === r.q.segment && r.q.segElapsed >= inj.at) {
        inj.done = true;
        executeInjection(inj);
      }
    }
    return;
  }
  if (r.raceStart === null || r.phase !== "RACE") return;
  const leader = r.order[0];
  if (!leader) return;
  const lapNow = leader.laps + 1;
  const fraction = leader.s / r.track.length;

  for (const inj of r.injections) {
    if (inj.done) continue;
    if (lapNow > inj.lap || (lapNow === inj.lap && fraction >= inj.frac)) {
      inj.done = true;
      executeInjection(inj);
    }
  }
}

function executeInjection(inj) {
  const car = carById(inj.car);
  if (inj.kind === "DNF") {
    if (!car || !isRunning(car) || car.mode !== "RACE" || car.finished) return;
    if (inj.crash) {
      crashCar(car, cornerAt(race.track, car.s + 200), "went off", false);
    } else {
      startFailure(car, pick(["Power unit", "Gearbox", "Hydraulics"]));
      if (car.failure) car.failure.left = Math.min(car.failure.left, rand(5, 25));
    }
  } else if (inj.kind === "TL" || (inj.kind === "INCIDENT" && inj.cars.length === 2)) {
    // wait until the car is on track (TL) or until both cars really meet on track (incident),
    // otherwise the replay of the incident would not show them together
    // (at most 150 s in qualifying, about 2.5 laps in a race – then it happens anyway)
    const wait = race.session === "QUALI" ? 150 : Math.max(200, race.track.refLapTime / race.paceScale * 2.5);
    race.waiting.push({ inj, until: race.time + wait });
  } else if (inj.kind === "INCIDENT") {
    createHistoricIncident(inj);
  }
}

// Shortest distance between two cars along the track (metres)
function trackDistance(a, b) {
  const L = race.track.length;
  return Math.min(mod(a.s - b.s, L), mod(b.s - a.s, L));
}

function onTrackAndMoving(car) {
  return car && isRunning(car) && car.mode === "RACE" && !car.pit.state && !car.finished;
}

function processWaitingInjections() {
  const r = race;
  if (r.waiting.length === 0) return;
  for (const w of r.waiting) {
    if (w.done) continue;
    const inj = w.inj;
    const timeUp = r.time > w.until;

    if (inj.kind === "TL") {
      const car = carById(inj.car);
      const ready = onTrackAndMoving(car) && (r.session !== "QUALI" || car.q.phase === "PUSH");
      if (ready) {
        const corner = r.track.corners.find(c => c.number === inj.turn) || pick(r.track.corners);
        createTrackLimits(car, corner, { real: inj.text });
      }
      if (ready || timeUp) w.done = true;
      continue;
    }

    const [a, b] = inj.cars.map(carById);
    const together = onTrackAndMoving(a) && onTrackAndMoving(b) && trackDistance(a, b) < 120;
    if (together || timeUp) {
      w.done = true;
      createHistoricIncident(inj);
    }
  }
  r.waiting = r.waiting.filter(w => !w.done);
}
