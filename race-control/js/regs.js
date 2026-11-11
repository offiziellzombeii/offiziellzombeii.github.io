// =====================================================================
//  regs.js
//  The technical regulations of a session – which car generation?
//
//  GE2023  : 2023–2025 ground-effect cars with DRS.
//            DRS opens in the DRS zones when a car is within 1 s at the
//            detection point (in qualifying: on every push lap).
//  GEN2026 : 2026 cars with active aero and the 50/50 hybrid.
//            - Straight Mode: every car opens its wings in the straight
//              zones, every lap (the Race Director can switch it off,
//              e.g. in the wet, for the whole track or one zone).
//            - Overtake Mode: within 1 s at the detection point the car
//              gets extra electrical energy for the next lap.
//            - Battery: every car has a state of charge. It is used on the
//              straights and recharged under braking. An empty battery
//              means "clipping" – the car loses speed on the straight.
//
//  The engine only calls the functions of this file, so the rest of the
//  simulation does not need to know which generation is running.
//  The flag race.drsEnabled is the "overtaking aid" of both generations:
//  DRS (2023–2025) or Overtake Mode (2026).
// =====================================================================

const REGS_INFO = {
  GE2023:  { name: "2023–2025 · ground effect + DRS", short: "2023–25", aid: "DRS" },
  GEN2026: { name: "2026 · active aero + 50/50 hybrid", short: "2026", aid: "Overtake Mode" }
};

const DRS_SPEED = 1.035;           // top speed gain with DRS open
const STRAIGHT_MODE_SPEED = 1.025; // top speed gain with Straight Mode (all cars)
const OVERTAKE_SPEED = 1.015;      // extra speed with Overtake Mode on the fast parts of the lap
const CLIPPING_SPEED = 0.97;       // empty battery on a straight
const RECHARGE_SPEED = 0.995;      // the driver saves energy (lift and coast)

function is2026() {
  return !!race && race.regs === "GEN2026";
}

function aidName() {
  return REGS_INFO[race.regs].aid;
}

// Called by createRace(), after the cars were made
function initRegs(r) {
  r.regs = REGS_INFO[r.setup.regs] ? r.setup.regs : "GE2023";
  const tr = r.track;
  if (!tr.straightZones) tr.straightZones = makeStraightZones(tr);
  r.straightEnabled = r.regs === "GEN2026"; // Straight Mode is active unless the Race Director stops it
  r.straightOff = tr.straightZones.map(() => false);
  r.straightWetWarned = false;
  r.evalData.straightWetSeconds = 0;

  if (r.regs !== "GEN2026") return;

  // ----- energy calibration of this circuit -----
  // How many seconds per lap is an ideal car on full power (fast) and braking?
  let fastTime = 0;
  let brakeTime = 0;
  const n = tr.n;
  const look = Math.max(1, Math.round(40 / tr.ds));
  for (let i = 0; i < n; i++) {
    const v = tr.profile[i];
    const dt = tr.ds / v;
    const braking = tr.profile[(i + look) % n] < v * 0.93;
    if (braking) brakeTime += dt;
    else if (v > tr.vMax * 0.8) fastTime += dt;
  }
  // share of the battery used per lap: circuits with long straights and little
  // braking (Monza, Baku, Las Vegas) empty the battery much more than street circuits
  // harvest < deploy: a driver who always deploys fully slowly empties the battery
  // and has to "lift and coast" to recharge – that is the 2026 energy game
  r.energy = {
    swing: clamp(0.3 + 0.02 * (fastTime - brakeTime * 2), 0.3, 0.85),
    harvest: clamp(0.97 - 0.004 * (fastTime - brakeTime * 2), 0.85, 0.97),
    fastTime: Math.max(5, fastTime),
    brakeTime: Math.max(2, brakeTime)
  };

  // Straight Mode makes every car faster; the reference lap of the track is
  // already a real lap, so the overall pace is reduced by the same amount
  let zoneTime = 0;
  for (const z of tr.straightZones) {
    const len = mod(z.end - z.start, tr.length);
    for (let d = 0; d < len; d += tr.ds) zoneTime += tr.ds / trackSpeed(tr, z.start + d);
  }
  r.paceScale *= 1 - (zoneTime / tr.refLapTime) * (1 - 1 / STRAIGHT_MODE_SPEED);

  for (const car of r.cars) {
    car.ers = { soc: 0.9, boostLeft: 0, recharge: false, clipping: false, eff: car.ersEff || 1 };
    car.straightOpen = false;
  }
}

// Straight Mode zones: more and longer than DRS zones (all real straights)
function makeStraightZones(tr) {
  const L = tr.length;
  return findStraights(tr.profile, tr.ds, 0.84)
    .filter(st => st.count * tr.ds >= 250)
    .slice(0, 5)
    .map(st => ({
      start: mod(st.start * tr.ds + 30, L),
      end: mod((st.start + st.count) * tr.ds - 60, L)
    }))
    .sort((a, b) => a.start - b.start);
}

// The detection point of Overtake Mode: one per lap (before the main straight)
function overtakeDetectPoint(tr) {
  if (tr.overtakeDetect !== undefined) return tr.overtakeDetect;
  return tr.drsZones.length ? tr.drsZones[0].detect : mod(-300, tr.length);
}

// A car stops using any aero / energy aid (pit, spin, retirement, finish ...)
function closeAero(car) {
  car.drsOpen = false;
  car.drsEligible = false;
  car.straightOpen = false;
  if (car.ers) car.ers.boostLeft = 0;
}

// Are both ends of a zone under green flags?
function zoneIsGreen(tr, zone) {
  return race.sectorFlags[marshalSectorAt(tr, zone.start) - 1] === "GREEN" &&
         race.sectorFlags[marshalSectorAt(tr, zone.end) - 1] === "GREEN";
}


// ---------- 1. Speed ----------
// Multiplier for the wanted speed of a car (called by desiredSpeed)
function aeroSpeedFactor(car) {
  if (!is2026()) return car.drsOpen ? DRS_SPEED : 1;

  let f = car.straightOpen ? STRAIGHT_MODE_SPEED : 1;
  const e = car.ers;
  if (!e || race.session === "QUALI" && car.q.phase !== "PUSH") return f;
  const tr = race.track;
  if (trackSpeed(tr, car.s) > tr.vMax * 0.8) {
    if (e.soc <= 0.03) f *= CLIPPING_SPEED;
    else if (e.boostLeft > 0) f *= OVERTAKE_SPEED;
    else if (e.recharge) f *= RECHARGE_SPEED;
  }
  return f;
}

// Extra chance for an overtake (added to the speed advantage)
// In the championship (overtakeScale < 1) the aids are weaker: DRS is worth ~0.3–0.4 s per lap,
// a car also needs real pace to pass
function aidStrength() {
  return race.overtakeScale < 1 ? 0.6 : 1;
}

function overtakeAidAdvantage(car) {
  if (!is2026()) return car.drsOpen ? 0.02 * aidStrength() : 0;
  let a = car.straightOpen ? 0.002 : 0;
  const tr = race.track;
  const fast = trackSpeed(tr, car.s) > tr.vMax * 0.8 || zoneType(tr, car.s) === "BRAKING";
  if (fast && car.ers && car.ers.boostLeft > 0 && car.ers.soc > 0.03) a += 0.009;
  return a * aidStrength();
}

// Extra chance that the overtake is successful
function overtakeAidSuccess(car, defender) {
  if (!is2026()) return car.drsOpen ? 0.25 * aidStrength() : 0;
  let s = 0;
  if (car.ers && car.ers.boostLeft > 0 && car.ers.soc > 0.03) s += 0.1;
  if (defender && defender.ers && defender.ers.soc <= 0.03) s += 0.12; // the defender is clipping
  return s * aidStrength();
}


// ---------- 2. Zones and energy (called by moveCar every step) ----------
function updateAeroZones(car, from, to) {
  const r = race;
  const tr = r.track;
  const L = tr.length;
  const quali = r.session === "QUALI";

  if (!is2026()) {
    // ----- DRS -----
    for (const zone of tr.drsZones) {
      if (passedPoint(from, to, zone.detect, L)) {
        const timeGap = car.gapAheadM / Math.max(car.speed, 10);
        car.drsEligible = r.drsEnabled && r.status === "GREEN" && zoneIsGreen(tr, zone) &&
          (quali ? car.q.phase === "PUSH" : timeGap < 1.0);
      }
      if (passedPoint(from, to, zone.start, L)) car.drsOpen = car.drsEligible && r.drsEnabled && r.status === "GREEN";
      if (passedPoint(from, to, zone.end, L)) {
        car.drsOpen = false;
        car.drsEligible = false;
      }
    }
    const wetHere = wetAt(car.s);
    if (car.drsOpen && wetHere > 0.35 && chance(0.004 * wetHere)) {
      spinCar(car, cornerAt(tr, car.s), "lost the rear with DRS open on a wet track");
    }
    return;
  }

  // ----- Straight Mode -----
  tr.straightZones.forEach((zone, i) => {
    if (passedPoint(from, to, zone.start, L)) {
      car.straightOpen = r.straightEnabled && !r.straightOff[i] && r.status === "GREEN" && zoneIsGreen(tr, zone);
    }
    if (passedPoint(from, to, zone.end, L)) car.straightOpen = false;
  });
  const wetHere = wetAt(car.s);
  if (car.straightOpen && wetHere > 0.3 && chance(0.004 * wetHere)) {
    spinCar(car, cornerAt(tr, car.s), "lost the rear with Straight Mode open on a wet track");
  }

  // ----- Overtake Mode (detection point) -----
  const e = car.ers;
  if (!quali && passedPoint(from, to, overtakeDetectPoint(tr), L)) {
    const timeGap = car.gapAheadM / Math.max(car.speed, 10);
    const ahead = carDirectlyAhead(car);
    const eligible = r.drsEnabled && r.status === "GREEN" && timeGap < 1.0 && ahead && !ahead.pit.state;
    // the driver only uses it with enough energy in the battery
    e.boostLeft = eligible && e.soc > 0.25 ? L : 0;
  }

  // ----- the battery -----
  const distance = to - from;
  const dt = distance / Math.max(car.speed, 1);
  const v = trackSpeed(tr, car.s);
  const en = r.energy;
  if (quali && car.q.phase !== "PUSH") {
    e.soc = Math.min(1, e.soc + dt * 0.02); // out lap / in lap: the battery is charged for the next push
  } else if (isNeutralised()) {
    e.soc = Math.min(1, e.soc + dt * 0.01);
  } else if (zoneType(tr, car.s) === "BRAKING") {
    e.soc = Math.min(1, e.soc + dt * en.swing * en.harvest / en.brakeTime * e.eff * (e.recharge ? 1.3 : 1));
  } else if (v > tr.vMax * 0.8) {
    let use = dt * en.swing / en.fastTime;
    if (e.boostLeft > 0) use *= 1.6;
    if (e.recharge) use *= 0.7;
    e.soc = Math.max(0, e.soc - use);
  }
  if (e.boostLeft > 0) e.boostLeft = Math.max(0, e.boostLeft - distance);

  // the driver manages the energy: save when the battery is low
  if (e.soc < 0.18) e.recharge = true;
  else if (e.soc > 0.45) e.recharge = false;
  const clipping = e.soc <= 0.03 && v > tr.vMax * 0.8;
  if (clipping && !e.clipping && car.mode === "RACE" && !quali) e.clipStart = r.time;
  e.clipping = clipping;
}


// ---------- 3. The Race Director ----------
// Overtaking aid: DRS (2023–2025) or Overtake Mode (2026)
function setOvertakeAid(on) {
  const r = race;
  if (on && r.phase !== "RACE" && r.session !== "QUALI") return aidName() + " can only be enabled during the race.";
  if (on && r.status !== "GREEN") return aidName() + " cannot be enabled under a neutralisation.";
  if (r.drsEnabled === on) return;
  r.drsEnabled = on;
  if (!on) for (const car of r.cars) { car.drsOpen = false; if (car.ers) car.ers.boostLeft = 0; }
  publish(aidName().toUpperCase() + (on ? " ENABLED" : " DISABLED"), "Drs");
}

function disableOvertakeAidQuietly() {
  const r = race;
  if (!r.drsEnabled) return;
  r.drsEnabled = false;
  for (const car of r.cars) { car.drsOpen = false; if (car.ers) car.ers.boostLeft = 0; }
  publish(aidName().toUpperCase() + " DISABLED", "Drs");
}

// 2026: Straight Mode for the whole track
function setStraightMode(on) {
  const r = race;
  if (!is2026()) return "Straight Mode only exists with the 2026 cars.";
  if (r.straightEnabled === on) return;
  r.straightEnabled = on;
  if (!on) for (const car of r.cars) car.straightOpen = false;
  publish(on ? "STRAIGHT MODE ENABLED" : "STRAIGHT MODE DISABLED", "Drs");
}

// 2026: one Straight Mode zone on or off
function setStraightZone(index, on) {
  const r = race;
  if (!is2026() || index < 0 || index >= r.straightOff.length) return "There is no Straight Mode zone here.";
  if (r.straightOff[index] === !on) return;
  r.straightOff[index] = !on;
  const zone = r.track.straightZones[index];
  if (!on) for (const car of r.cars) if (inRange(car.s, zone.start, zone.end, r.track.length)) car.straightOpen = false;
  publish("STRAIGHT MODE ZONE " + (index + 1) + " (" + locationName(r.track, zone.start).toUpperCase() + ") " +
    (on ? "ENABLED" : "DISABLED"), "Drs");
}

// The Straight Mode zone that lies in a marshal sector (or -1)
function straightZoneInSector(sectorIndex) {
  const r = race;
  if (!is2026() || sectorIndex < 0) return -1;
  const tr = r.track;
  const from = sectorIndex * tr.msLen;
  const to = from + tr.msLen;
  return tr.straightZones.findIndex(z =>
    inRange(z.start, from, to, tr.length) || inRange(z.end, from, to, tr.length) || inRange(from, z.start, z.end, tr.length));
}


// ---------- 4. Advice and evaluation ----------
function regsAdvice() {
  const r = race;
  const leader = r.order[0];
  if (!leader || r.phase !== "RACE") return;
  const name = aidName();
  if (!r.drsEnabled && !r.drsAdvised && r.status === "GREEN" && leader.laps >= r.drsAdviceLap && r.weather.wet < 0.3) {
    r.drsAdvised = true;
    addAlert("info", "Two laps completed since the start/restart – " + name + " may be enabled.");
  }
  if (r.drsEnabled && r.weather.wet > 0.35 && !r.drsWetWarned) {
    r.drsWetWarned = true;
    addAlert("warn", "The track is getting wet. Consider disabling " + name + ".");
  }
  if (r.weather.wet < 0.2) r.drsWetWarned = false;

  if (is2026()) {
    if (r.straightEnabled && r.weather.wet > 0.3 && !r.straightWetWarned) {
      r.straightWetWarned = true;
      addAlert("warn", "Wet track: cars are losing the rear with Straight Mode open. Consider disabling Straight Mode.");
    }
    if (r.weather.wet < 0.15) r.straightWetWarned = false;
  }
}

function regsEvaluationTick() {
  const r = race;
  const e = r.evalData;
  if (r.drsEnabled && r.weather.wet > 0.4) e.drsWetSeconds++;
  if (is2026() && r.straightEnabled && r.weather.wet > 0.4) e.straightWetSeconds++;
}
