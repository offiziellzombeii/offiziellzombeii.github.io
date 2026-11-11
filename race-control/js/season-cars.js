// =====================================================================
//  season-cars.js
//  The cars and the teams behind them (championship mode):
//  1. The car: five ratings (0 ... 100) and the power unit supplier
//       aero        – downforce and aero efficiency
//       power       – power unit (and low drag)
//       chassis     – mechanical grip, kerbs, braking
//       tyres       – how kind the car is to its tyres
//       reliability – of the car and its power unit
//     The pace at a circuit depends on what the circuit needs.
//  2. Power units: every driver has a limited number of elements per
//     season (rulebook). More elements = grid penalties.
//  3. Development and money: a budget under the cost cap, upgrade
//     packages that arrive a few rounds later (and sometimes do not work),
//     wind tunnel time by championship position (ATR), crash damage.
//  4. The driver market: race bans, stand-ins, drivers who lose their seat.
//  5. Pre-season testing.
//
//  All of this is decided by the AI teams. The FIA (the player) sees
//  everything and audits the cost cap at the end of the season.
// =====================================================================

// ---------- Power unit suppliers ----------
// Ratings of the 2026 power units are assumptions: the new engines were
// rated from the early 2026 races, the field is expected to spread more.
const PU_SUPPLIERS = {
  GE2023: {
    teams: { redbull: "Honda RBPT", racingbulls: "Honda RBPT", mercedes: "Mercedes", mclaren: "Mercedes", williams: "Mercedes",
             astonmartin: "Mercedes", ferrari: "Ferrari", haas: "Ferrari", sauber: "Ferrari", alpine: "Renault", cadillac: "Ferrari" },
    rating: { "Honda RBPT": 93, Mercedes: 91, Ferrari: 91, Renault: 84 },
    reliability: { "Honda RBPT": 90, Mercedes: 88, Ferrari: 85, Renault: 80 }
  },
  GEN2026: {
    teams: { redbull: "Red Bull Ford", racingbulls: "Red Bull Ford", mercedes: "Mercedes", mclaren: "Mercedes", williams: "Mercedes",
             alpine: "Mercedes", ferrari: "Ferrari", haas: "Ferrari", cadillac: "Ferrari", astonmartin: "Honda", sauber: "Audi" },
    rating: { Mercedes: 96, Ferrari: 90, "Red Bull Ford": 88, Honda: 84, Audi: 83 },
    reliability: { Mercedes: 86, Ferrari: 84, "Red Bull Ford": 74, Honda: 76, Audi: 72 }
  }
};

const CAR_AREAS = { aero: "Aerodynamics", power: "Power unit", chassis: "Chassis", tyres: "Tyre wear", reliability: "Reliability" };
const PU_ELEMENT_NAMES = { ICE: "Internal combustion engine", TC: "Turbocharger", "MGU-H": "MGU-H", "MGU-K": "MGU-K", ES: "Energy store", CE: "Control electronics", EX: "Exhaust" };

function puSupplier(s, teamId) {
  const table = PU_SUPPLIERS[s.generation] || PU_SUPPLIERS.GE2023;
  return table.teams[teamId] || "Ferrari";
}


// =====================================================================
//  1. THE CAR
// =====================================================================
// Build the cars of a season (also for older saves without a car model)
function ensureCarModel(s) {
  s.cars = s.cars || {};
  const table = PU_SUPPLIERS[s.generation] || PU_SUPPLIERS.GE2023;
  for (const t of s.teams) {
    const car = s.cars[t.id];
    if (car && car.aero !== undefined) continue;
    const info = teamInYear(t.id, s.baseYear);
    const avg = info && info.avgFinish ? info.avgFinish : 12;
    const overall = clamp(100 - (avg - 2.5) * 2.1, 66, 100); // the real strength of the team in the base year
    const rnd = makeRandom(hashText(s.id + "/" + t.id) % 1000000 + 3);
    const supplier = puSupplier(s, t.id);
    const power = table.rating[supplier] + (rnd() - 0.5) * 3;
    // aero and chassis so that the car on an average circuit is as good as the team really was
    const w = carWeights(s, { power: 0.5, downforce: 0.6 });
    const rest = (overall * (w.aero + w.chassis + w.power) - w.power * power) / (w.aero + w.chassis);
    s.cars[t.id] = {
      supplier,
      aero: round1(clamp(rest + (rnd() - 0.5) * 6, 55, 100)),
      chassis: round1(clamp(rest + (rnd() - 0.5) * 6, 55, 100)),
      power: round1(clamp(power, 55, 100)),
      tyres: round1(clamp(55 + (overall - 80) * 0.6 + (rnd() - 0.5) * 30, 30, 95)),
      reliability: round1(clamp(0.5 * table.reliability[supplier] + 0.5 * (60 + (overall - 70) * 0.9) + (rnd() - 0.5) * 8, 50, 97)),
      perf: null // old interim value, no longer used
    };
  }
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

// How much each area counts at a circuit
function carWeights(s, ch) {
  const gen2026 = s.generation === "GEN2026";
  return {
    aero: 0.5 + (ch.downforce !== undefined ? ch.downforce : 0.6),
    power: (gen2026 ? 0.7 : 0.45) + (ch.power !== undefined ? ch.power : 0.5) * (gen2026 ? 1.0 : 0.8),
    chassis: 0.8
  };
}

// The score of a car at a circuit (0 ... 100)
function carScore(s, teamId, circuitKey) {
  const car = s.cars[teamId];
  const ch = CIRCUIT_CHARACTER[circuitKey] || {};
  const w = carWeights(s, ch);
  return (car.aero * w.aero + car.power * w.power + car.chassis * w.chassis) / (w.aero + w.power + w.chassis);
}

// Score -> pace factor of the simulation (100 = 1.000, every point ~0.04 %)
function carPace(s, teamId, circuitKey) {
  return 1 - (100 - carScore(s, teamId, circuitKey)) * 0.00042;
}

// Reliability -> how often the car breaks (1 = average)
function carFailureScale(s, teamId, driverId) {
  const car = s.cars[teamId];
  let f = clamp(2.7 - car.reliability / 50, 0.6, 1.9); // reliability 85 = the classic failure rate
  const d = s.drivers[driverId];
  if (d && d.pu) {
    // power unit elements beyond their planned life break more often
    let worst = 0;
    for (const k in d.pu) worst = Math.max(worst, d.pu[k].age / d.pu[k].life);
    if (worst > 0.85) f *= 1 + (worst - 0.85) * 2.5;
  }
  return f;
}


// =====================================================================
//  2. POWER UNITS
// =====================================================================
function ensurePowerUnits(s) {
  const rounds = Math.max(1, s.calendar.filter(r => r.status !== "CANCELLED").length);
  for (const id in s.drivers) {
    const d = s.drivers[id];
    if (d.pu) continue;
    const rnd = makeRandom(hashText(s.id + "/pu/" + id) % 1000000 + 5);
    d.pu = {};
    for (const k in s.rules.pu) {
      const allowed = s.rules.pu[k];
      // planned life of one element in race weekends
      d.pu[k] = { count: 1, age: 0, life: round1(rounds / allowed * (0.95 + rnd() * 0.25)), failed: false };
    }
  }
}

// Before the first session of a weekend: does a driver need new elements?
// Returns the log lines. Grid penalties go to carryGrid / carryBack.
function powerUnitsForWeekend(s, round) {
  ensurePowerUnits(s);
  const lines = [];
  const ch = CIRCUIT_CHARACTER[round.circuit] || {};
  for (const id in s.drivers) {
    const d = s.drivers[id];
    if (!d.team) continue;
    let places = 0;
    const fitted = [];
    for (const k in d.pu) {
      const el = d.pu[k];
      const allowed = s.rules.pu[k];
      const due = el.failed || el.age >= el.life;
      // a team that will take a penalty anyway does it at a circuit where overtaking is easy
      const tactical = !due && el.count >= allowed && el.age >= el.life * 0.75 && (ch.overtaking || 0) >= 0.7;
      if (!due && !tactical) continue;
      el.count++;
      el.age = 0;
      el.failed = false;
      fitted.push(k + " #" + el.count);
      if (el.count > allowed) places += el.count === allowed + 1 ? 10 : 5;
    }
    if (!fitted.length) continue;
    let text = seasonDriverName(id) + ": new " + fitted.join(", ");
    if (places > 15) {
      d.carryBack = true;
      text += " – starts from the back of the grid";
    } else if (places > 0) {
      d.carryGrid += places;
      text += " – " + places + "-place grid penalty";
    }
    lines.push(text);
  }
  return lines;
}

// After a race weekend: the elements age, failures are noted
function powerUnitsAfterRace(s, round, raceResult) {
  ensurePowerUnits(s);
  const weight = round.sprint ? 1.3 : 1;
  for (const id in s.drivers) {
    const d = s.drivers[id];
    for (const k in d.pu) d.pu[k].age = round1(d.pu[k].age + weight);
  }
  if (!raceResult || !raceResult.rows) return;
  for (const row of raceResult.rows) {
    const d = s.drivers[row.id];
    if (!d || !/power unit/i.test(row.reason || "")) continue;
    // a power unit failure destroys one of the main elements
    const keys = Object.keys(d.pu).filter(k => ["ICE", "TC", "MGU-H", "MGU-K"].includes(k));
    d.pu[keys[hashText(row.id + round.round) % keys.length]].failed = true;
  }
}


// =====================================================================
//  3. DEVELOPMENT AND MONEY
// =====================================================================
function seasonCostCap(s) {
  const rounds = s.calendar.filter(r => r.status !== "CANCELLED").length;
  return s.rules.costCap + Math.max(0, rounds - 21) * s.rules.costCapPerExtraRace;
}

function ensureFinances(s) {
  s.finance = s.finance || {};
  const cap = seasonCostCap(s);
  for (const t of s.teams) {
    if (s.finance[t.id]) continue;
    const car = s.cars[t.id];
    const rnd = makeRandom(hashText(s.id + "/money/" + t.id) % 1000000 + 9);
    const strength = (car.aero + car.chassis) / 2;
    // top teams spend up to the cap (some try a little more), small teams cannot afford it
    let budget = cap * clamp(0.82 + (strength - 70) * 0.006 + (rnd() - 0.5) * 0.04, 0.8, 1.0);
    // some rich top teams push the limit and spend more than the cap allows (the FIA audits it after the season)
    if (strength > 88 && rnd() < 0.15) budget = cap * (1 + rnd() * 0.05);
    s.finance[t.id] = {
      budget: round1(budget),
      spent: 0,
      fixed: 0,
      development: 0,
      crashes: 0,
      aggression: Math.round((0.97 + rnd() * 0.04 + (strength > 90 ? 0.012 : 0)) * 1000) / 1000, // > 1: spends beyond the plan (cost cap risk)
      focus: pick(["aero", "aero", "chassis", "tyres", "reliability"]),
      packages: [],     // { area, gain, arrives (round number), cost, name, works }
      history: []
    };
  }
}

// ATR: wind tunnel / CFD time by position in the constructors' championship
function atrFactor(s, teamId) {
  if (!s.rules.atr) return 1;
  const st = computeStandings(s);
  let pos = st.teams.findIndex(t => t.id === teamId);
  if (pos < 0 || st.teams.every(t => t.points === 0)) {
    // before the first race: last season's order (or the base year)
    if (s.atrOrder) pos = s.atrOrder.indexOf(teamId);
    else {
      const order = s.teams.map(t => ({ id: t.id, avg: (teamInYear(t.id, s.baseYear) || {}).avgFinish || 12 })).sort((a, b) => a.avg - b.avg);
      pos = order.findIndex(t => t.id === teamId);
    }
  }
  // a cost cap breach can cost wind tunnel time
  const penalty = (s.atrPenalty || {})[teamId] || 0;
  return ATR_SCALE[clamp(pos, 0, ATR_SCALE.length - 1)] / 100 * (1 - penalty);
}

const PACKAGE_NAMES = {
  aero: ["new floor", "front wing", "rear wing", "sidepod update", "diffuser", "beam wing", "floor edge"],
  chassis: ["suspension update", "new front suspension", "brake ducts", "lighter chassis parts"],
  tyres: ["suspension geometry", "brake cooling update", "rear suspension"],
  reliability: ["cooling update", "gearbox update", "hydraulics fix"],
  power: ["power unit software", "fuel upgrade"]
};

// After every race weekend: costs, development decisions, packages ordered
function developmentAfterRound(s, round, raceResult) {
  ensureFinances(s);
  const cap = seasonCostCap(s);
  const rounds = s.calendar.filter(r => r.status !== "CANCELLED");
  const left = Math.max(1, rounds.filter(r => r.status !== "DONE").length + 1);
  const lines = [];
  for (const t of s.teams) {
    const f = s.finance[t.id];
    const car = s.cars[t.id];
    const rnd = makeRandom(hashText(s.id + "/dev/" + t.id + "/" + round.round) % 1000000 + 11);

    // running the team: staff, logistics, parts (~55 % of the cap over the season)
    const fixed = cap * 0.55 / rounds.length;
    f.fixed = round1(f.fixed + fixed);
    // crash damage
    let crash = 0;
    if (raceResult && raceResult.rows) {
      for (const row of raceResult.rows) {
        if (row.team === t.id && !row.pos && /crash|collision|hit|accident|spun/i.test(row.reason || "")) crash += 0.6 + rnd() * 1.2;
      }
    }
    f.crashes = round1(f.crashes + crash);

    // development money for this round: what is left of the budget, spread over the rest of the season
    // (the running costs of the rounds still to come are kept aside)
    const remaining = f.budget - (f.fixed + f.crashes + f.development) - fixed * (left - 1);
    const plan = Math.max(0, remaining / left) * f.aggression;
    if (plan > 0.2) {
      f.development = round1(f.development + plan);
      // what to develop: the weakest area that matters, the team's own focus, or what the next circuits need
      // aero and chassis bring lap time; tyres and reliability only when they are a real weakness
      const needs = { aero: (101 - car.aero) * 1.2, chassis: 101 - car.chassis, tyres: Math.max(0, 55 - car.tyres) * 0.8, reliability: Math.max(0, 80 - car.reliability) * 0.8 };
      needs[f.focus] = (needs[f.focus] || 0) * 1.3;
      const area = Object.keys(needs).sort((a, b) => needs[b] - needs[a])[rnd() < 0.7 ? 0 : 1];
      const atr = area === "aero" ? atrFactor(s, t.id) : 1;
      const current = car[area];
      // diminishing returns: the closer to the limit, the harder it gets
      const gain = plan * 0.28 * atr * clamp((101 - current) / 25, 0.15, 1.5) * (0.5 + rnd());
      const works = rnd() > 0.15;
      f.packages.push({
        area, cost: round1(plan), gain: round1(works ? gain : (rnd() < 0.3 ? -gain * 0.3 : 0)), works,
        ordered: round.round, arrives: round.round + 2 + Math.floor(rnd() * 3),
        name: pick(PACKAGE_NAMES[area])
      });
    }
    f.spent = round1(f.fixed + f.crashes + f.development);
    f.history.push({ round: round.round, spent: f.spent });
  }
  return lines;
}

// Before a weekend: packages that arrive now are fitted to the car
function upgradesForWeekend(s, round) {
  ensureFinances(s);
  const lines = [];
  for (const t of s.teams) {
    const f = s.finance[t.id];
    const car = s.cars[t.id];
    for (const p of f.packages) {
      if (p.fitted || p.arrives > round.round) continue;
      p.fitted = round.round;
      car[p.area] = round1(clamp(car[p.area] + p.gain, 30, 110)); // above 100: better than the best car at the start
      lines.push(t.name + " bring a " + p.name + " (" + CAR_AREAS[p.area].toLowerCase() + ")" +
        (p.gain > 0.05 ? "" : p.gain < 0 ? " – it makes the car worse, the team goes back to the old parts" : " – it does not work as expected"));
      if (p.gain < 0) car[p.area] = round1(car[p.area] - p.gain); // they take it off again
    }
  }
  return lines;
}


// =====================================================================
//  4. THE DRIVER MARKET, BANS AND STAND-INS
// =====================================================================
function freeAgents(s) {
  const seated = new Set(s.teams.flatMap(t => t.drivers));
  return SEASON_CATALOGUE.drivers.filter(d => !seated.has(d.id));
}

// The best free driver (for a stand-in or a new seat)
function bestFreeAgent(s) {
  const list = freeAgents(s).map(d => ({ id: d.id, skill: driverRatings(d.id, s.baseYear).skill }));
  list.sort((a, b) => b.skill - a.skill);
  return list[0] ? list[0].id : null;
}

// Sign a driver (catalogue driver) for a team, replacing another one
function signDriver(s, team, outId, inId, standIn) {
  const c = catalogueDriver(inId);
  if (!s.drivers[inId]) {
    const used = new Set(Object.values(s.drivers).map(d => d.number));
    let number = driverNumber(inId, s.baseYear);
    while (used.has(number)) number = number + 1 > 99 ? 2 : number + 1;
    s.drivers[inId] = { id: inId, code: inId, first: c.first, last: c.last, country: c.country, headshot: c.headshot, number,
      team: team.id, ratings: driverRatings(inId, s.baseYear), penaltyPoints: 0, reprimands: 0, carryGrid: 0 };
  }
  s.drivers[inId].team = team.id;
  team.drivers = team.drivers.map(id => (id === outId ? inId : id));
  if (standIn) s.drivers[inId].standInFor = outId;
  else if (s.drivers[outId]) s.drivers[outId].team = null;
}

// Before a weekend: drivers with a race ban sit out, a stand-in drives
function bansForWeekend(s, round) {
  const lines = [];
  for (const t of s.teams) {
    for (const id of t.drivers.slice()) {
      const d = s.drivers[id];
      if (!d || !d.banNext) continue;
      const sub = bestFreeAgent(s);
      if (!sub) continue;
      d.banNext = false;
      d.banServed = round.round;
      signDriver(s, t, id, sub, true);
      lines.push(seasonDriverName(id) + " serves a race ban – " + seasonDriverName(sub) + " drives the " + t.name + " this weekend.");
    }
  }
  return lines;
}

// After a weekend: stand-ins hand the car back, bans are decided, teams change drivers
function marketAfterRound(s, round) {
  const lines = [];
  // stand-ins go back to the bench
  for (const t of s.teams) {
    for (const id of t.drivers.slice()) {
      const d = s.drivers[id];
      if (d && d.standInFor) {
        const back = d.standInFor;
        d.standInFor = null;
        d.team = null;
        t.drivers = t.drivers.map(x => (x === id ? back : x));
        s.drivers[back].team = t.id;
      }
    }
  }
  // race bans: penalty points over the limit (counted again after a ban)
  for (const id in s.drivers) {
    const d = s.drivers[id];
    if (!d.team || d.banNext) continue;
    const since = d.pointsAtBan || 0;
    if (d.penaltyPoints - since >= s.rules.penaltyPointsBan) {
      d.banNext = true;
      d.pointsAtBan = d.penaltyPoints;
      lines.push(seasonDriverName(id) + " has " + d.penaltyPoints + " penalty points and is banned from the next race.");
      addDeskItem(s, { round: round.round, type: "BAN", status: "INFO", title: "Race ban: " + seasonDriverName(id),
        text: seasonDriverName(id) + " reached " + d.penaltyPoints + " penalty points – under the rulebook the driver is banned from the next event. The team nominates a stand-in." });
    }
  }
  // a team replaces a driver who is far behind his team mate (from round 8, not in the last rounds)
  const done = s.calendar.filter(r => r.status === "DONE").length;
  const total = s.calendar.filter(r => r.status !== "CANCELLED").length;
  if (done >= 8 && done < total - 3) {
    const st = computeStandings(s);
    const points = id => (st.drivers.find(x => x.id === id) || { points: 0 }).points;
    for (const t of s.teams) {
      if (t.swappedAt) continue;
      const [a, b] = t.drivers;
      const weak = points(a) < points(b) ? a : b;
      const strong = weak === a ? b : a;
      const gap = points(strong) - points(weak);
      const rnd = makeRandom(hashText(s.id + "/market/" + t.id + "/" + round.round) % 1000000 + 13);
      if (gap < 40 || points(weak) > points(strong) * 0.25 || rnd() > 0.12) continue;
      if ((s.inbox || []).some(x => x.type === "NOMINATION" && x.status === "PENDING" && x.data.team === t.id)) continue;
      const sub = bestFreeAgent(s);
      if (!sub || driverRatings(sub, s.baseYear).skill <= s.drivers[weak].ratings.skill) continue;
      // the change needs the FIA: the new driver's superlicence and the entry list (season-fia.js)
      t.swappedAt = round.round;
      lines.push(t.name + " want to replace " + seasonDriverName(weak) + " with " + seasonDriverName(sub) + " – waiting for the FIA.");
      nominationItem(s, round, t, weak, sub);
    }
  }
  return lines;
}


// =====================================================================
//  5. PRE-SEASON TESTING
// =====================================================================
// Three days of testing: lap times with fuel loads and "sandbagging"
function preSeasonTesting(s) {
  ensureCarModel(s);
  const rnd = makeRandom(hashText(s.id + "/testing") % 1000000 + 17);
  const venue = 63; // Bahrain, like the real tests
  const rows = s.teams.map(t => {
    const pace = carPace(s, t.id, venue);
    const hide = rnd() * 0.012;                 // fuel load / engine modes nobody knows
    return { team: t.id, time: 92 / pace * (1 + hide), laps: Math.round(330 + rnd() * 120 * s.cars[t.id].reliability / 100) };
  });
  rows.sort((a, b) => a.time - b.time);
  s.testing = { venue, rows, date: new Date().toISOString() };
  return s.testing;
}
