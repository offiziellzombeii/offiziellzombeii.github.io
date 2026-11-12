// =====================================================================
//  season-weekend.js
//  The race weekends of the championship:
//  1. Which sessions a weekend has (normal or sprint weekend)
//  2. Building a session for Race Control (track, cars, grid, weather)
//  3. Saving the result of a session: classification, points,
//     penalty points / reprimands / grid penalties that carry over
//  4. The championship standings
// =====================================================================

// Calibration of the championship mode against real seasons (2023–2025):
// ~2–4 penalties per weekend and ~40–70 overtakes per Grand Prix
// (SEASON_OFFENCES, SEASON_OVERTAKES: settings/incidents.js · SEASON_TYRE_DEG: settings/tyres.js)

const SESSION_NAMES = { FP1: "Free Practice 1", FP2: "Free Practice 2", FP3: "Free Practice 3", SQ: "Sprint Qualifying", SPRINT: "Sprint", Q: "Qualifying", RACE: "Grand Prix" };

// ---------- 1. The sessions of a weekend ----------
// free practice first (season-practice.js): FP1–FP3, or FP1 on a sprint weekend
function weekendSessions(round) {
  return practiceSessions(round).concat(round.sprint ? ["SQ", "SPRINT", "Q", "RACE"] : ["Q", "RACE"]);
}

// The next session that has to be run (sessions are run in order)
function nextSession(s) {
  for (const round of s.calendar) {
    if (round.status === "CANCELLED" || round.status === "DONE") continue;
    for (const type of weekendSessions(round)) {
      const done = round.sessions[type];
      if (!done || done.status !== "DONE" && done.status !== "CANCELLED") return { round, type };
    }
  }
  return null;
}


// ---------- 2. Build a session ----------
// options: { distance: 1 | 0.5 | 0.25, level: incident level }
async function buildSeasonSetup(s, round, type, options, status) {
  ensureRatings(s);
  const info = roundInfo(round);
  const ch = info.character;
  let track;
  try {
    track = await loadSeasonTrack(round.circuit, s.zones[round.circuit], status);
  } catch (error) {
    // the hub offers: try again, postpone or cancel the event (season-ui.js)
    error.trackProblem = round.circuit;
    throw error;
  }
  prepareWeekend(s, round); // the teams arrive at the circuit
  const eventNotes = ensureWeekendNotes(s, round, track); // published before FP1 (or the standard notes)
  const practice = isPractice(type);
  // free practice runs like a qualifying with one long segment (qualifying.js, practice mode)
  const quali = type === "SQ" || type === "Q" || practice;
  const sprintQuali = type === "SQ";
  const typeIndex = ["SQ", "SPRINT", "Q", "RACE", "FP1", "FP2", "FP3"].indexOf(type);
  const attempt = (round.attempts = (round.attempts || 0) + 1);
  const seed = (hashText(s.id) % 100000) * 1000 + roundSeed(round) * 40 + typeIndex * 10 + attempt;
  setSeed(seed);

  // distance: the Grand Prix has the real number of laps, the sprint ~100 km
  const fullLaps = type === "SPRINT" ? Math.ceil(100000 / track.length) : info.laps;
  const laps = Math.max(5, Math.round(fullLaps * options.distance));
  const durations = (practice ? [PRACTICE_MINUTES * 60] : sprintQuali ? SPRINT_QUALI_DURATIONS : QUALI_DURATIONS).map(d => Math.round(d * (options.distance < 1 ? 0.5 : 1)));

  // weather: the weekend weather of this round (weather.js), at the time of the session
  const W = roundWeather(s, round);
  const schedule = roundSchedule(s, round);
  const offset = schedule[type] - (quali ? 0 : 5 * 60);
  const weather = { model: "cells", weekend: W, offset };
  const preview = {};
  initCellWeather(preview, weather, track);
  weather.air = preview.air;
  weather.trackTemp = preview.trackTemp;
  const startWet = 0.6 * preview.wet + 0.4 * preview.wetMax;
  if (startWet > 0.78) weather.startCompound = "WET";
  else if (startWet > 0.22) weather.startCompound = "INTERMEDIATE";
  const kind = startWet > 0.22 ? "wet start" : "dry start";

  // the cars
  // a team excluded and banned by the FIA does not start any more
  const entries = seasonEntries(s, roundSeed(round), round.circuit).filter(e => !bannedFromEvents(s, "TEAM", e.teamId, round.round));
  if (quali) {
    // timing screen order before the session: by car number
    entries.sort((a, b) => a.number - b.number);
    entries.forEach((e, i) => { e.grid = i + 1; e.startCompound = "SOFT"; e.plan = []; });
  } else {
    const gridFrom = round.sessions[type === "SPRINT" ? "SQ" : "Q"];
    const order = gridFrom && gridFrom.status === "DONE" ? gridFrom.grid : championshipOrder(s);
    entries.sort((a, b) => {
      const ia = order.indexOf(a.driverId);
      const ib = order.indexOf(b.driverId);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    // no qualifying (cancelled): the carried grid penalties are applied to this grid
    if (type === "RACE" && !(gridFrom && gridFrom.status === "DONE")) applyCarriedToGrid(s, entries);
    entries.forEach((e, i) => {
      e.grid = i + 1;
      if (type === "SPRINT") {
        e.startCompound = weather.startCompound || (random() < 0.7 ? "MEDIUM" : "SOFT");
        e.plan = [];
      } else {
        const strategy = planStrategy(laps);
        e.startCompound = weather.startCompound || strategy.start;
        e.plan = strategy.stops;
      }
    });
  }

  // what free practice brought: setup confidence (pace, consistency), knowledge of the tyres (strategy)
  if (!practice) applyPracticeToEntries(s, round, type, entries, laps);
  // parc fermé: a team that changes the car after qualifying starts from the pit lane
  if (!quali) applyParcFerme(s, round, type, entries, weather);
  // FP1: some teams put a rookie in the second car (season-practice.js)
  const rookies = practice ? practiceRookieEntries(s, round, type, entries, startWet) : [];
  // tyre sets of the weekend: new softs for qualifying (a rookie uses the sets of the car's driver)
  if (quali) {
    for (const e of entries) {
      const rookie = rookies.find(x => x.id === e.driverId);
      const owner = rookie ? rookie.replaced : e.driverId;
      if (!s.drivers[owner]) continue;
      e.tyreOwner = owner;
      const t = driverTyres(s, round, owner);
      e.newSofts = t.SOFT;
      // the medium and hard sets practice may use (one of each stays new for the race)
      e.spareSets = { MEDIUM: Math.max(0, t.MEDIUM - 1), HARD: Math.max(0, t.HARD - 1) };
    }
  }

  // heat hazard: declared by the FIA before the weekend when the forecast is hot enough
  const heat = { threshold: s.rules.heatHazard, declared: !!round.heatDeclared };

  return {
    mode: "season",
    regs: s.generation,
    session: quali ? "QUALI" : "RACE",
    sprint: sprintQuali,
    practice: practice ? type : null,
    qualiDurations: durations,
    title: "Round " + round.round + " · " + info.gp + " · " + SESSION_NAMES[type],
    track,
    totalLaps: quali ? 30 : laps,
    paceScale: 1,
    incidentLevel: options.level,
    offenceScale: options.offences !== undefined ? options.offences : SEASON_OFFENCES, // realistic number of minor offences
    tyreDeg: SEASON_TYRE_DEG,                           // realistic tyre degradation
    tyreStress: ch.tyres !== undefined ? ch.tyres : 0.5, // graining at circuits that are hard on the tyres
    // rubber on the track: built up over the weekend, washed away by rain (round.rubber)
    rubber: (round.rubber !== undefined ? round.rubber : RUBBER_START) * (1 - 0.7 * startWet),
    rubberRef: RUBBER_EXPECTED[type],
    overtakeScale: SEASON_OVERTAKES * (0.35 + 1.1 * (ch.overtaking !== undefined ? ch.overtaking : 0.5)), // Monaco ~0.15 … Baku ~0.5
    clockStart: Math.round(offset % 86400),   // local time of day at the start
    weather,
    heat,
    limits: quali ? null : { race: s.rules.maxRaceHours * 3600, window: s.rules.maxWindowHours * 3600 },
    entries,
    eventNotes,
    injections: [],
    real: null,
    seasonContext: { seasonId: s.id, round: round.round, type, distance: options.distance, seed, weatherKind: kind, rookies }
  };
}

// ---------- Parc fermé ----------
// From qualifying on, the cars are in parc fermé: no setup changes, no new parts.
// An AI team may break it – the car then starts from the pit lane. Typical reasons:
// the weather changed between qualifying and the race (wet ↔ dry setup), the car is at
// the back anyway (grid penalty), or a bad qualifying. Decided once per race and stored
// in round.parcFerme, so a live session and the auto-simulation see the same decisions.
function applyParcFerme(s, round, type, entries, weather) {
  const q = round.sessions[type === "SPRINT" ? "SQ" : "Q"];
  if (!q || q.status !== "DONE" || !q.rows || !q.rows.length) return;
  round.parcFerme = round.parcFerme || {};
  if (!round.parcFerme[type]) {
    round.parcFerme[type] = parcFermeDecisions(s, round, type, q, weather);
    for (const d of round.parcFerme[type]) {
      const team = seasonTeam(d.team);
      const text = "Parc fermé: " + (team ? team.name : d.team) + " " + d.reason + " on the car of " + seasonDriverName(d.id) + " – " + SESSION_NAMES[type] + " start from the pit lane";
      round.notes = round.notes || [];
      round.notes.push(text);
      if (round.arrivals) round.arrivals.push({ kind: "PARC", team: d.team, driver: d.id, session: type, text: d.reason });
      s.log.push({ date: new Date().toISOString(), round: round.round, text });
    }
    if (round.parcFerme[type].length) {
      publishNotice(s, round.round, { session: type, title: "Changes under parc fermé conditions", from: "The Technical Delegate", to: "The Stewards",
        sign: "The Technical Delegate", body: "The following cars were changed under parc fermé conditions with the approval of the Technical Delegate. They must start the " + SESSION_NAMES[type] + " from the pit lane.",
        lines: round.parcFerme[type].map(d => [seasonDriverName(d.id), (seasonTeam(d.team) || { name: d.team }).name + " " + d.reason]) });
    }
  }
  const lane = new Set();
  for (const d of round.parcFerme[type]) {
    const e = entries.find(x => x.driverId === d.id);
    if (!e) continue;
    e.pitLaneStart = true;
    e.pace *= 1 + d.gain;            // the new setup / the new parts
    e.consistency = clamp(e.consistency + 0.02, 0.5, 0.97);
    lane.add(e);
  }
  if (!lane.size) return;
  // the grid closes up, the pit lane starters come last
  entries.sort((a, b) => (lane.has(a) ? 1 : 0) - (lane.has(b) ? 1 : 0) || a.grid - b.grid);
  entries.forEach((e, i) => { e.grid = i + 1; });
}

function parcFermeDecisions(s, round, type, q, weather) {
  const rnd = makeRandom(hashText(s.id + "/parcferme/" + roundSeed(round) + "/" + type) % 1000000 + 7);
  const n = q.rows.length;
  const raceWet = !!weather.startCompound;
  const qualiWet = !!q.weather && q.weather !== "dry";
  const out = [];
  for (const row of q.rows.slice().sort((a, b) => (a.grid || n) - (b.grid || n))) {
    const grid = row.grid || n;
    if (grid <= Math.round(n * 0.6)) continue;  // a team near the front keeps its grid slot
    const back = clamp((grid - n * 0.6) / (n * 0.4), 0, 1);
    let reason = null;
    let gain = 0;
    // about 1 car per race when the weather changed, 1 in 4 races otherwise
    if (qualiWet !== raceWet && rnd() < 0.05 + 0.15 * back) {
      reason = raceWet ? "changes to a wet setup" : "changes back to a dry setup";
      gain = 0.004;
    } else if (row.pos && grid - row.pos >= 10 && rnd() < 0.4) {
      reason = "is at the back anyway (grid penalty) and fits new parts";
      gain = 0.002;
    } else if (rnd() < 0.012 + 0.04 * back) {
      reason = "changes the setup after a difficult qualifying";
      gain = 0.0025;
    }
    if (reason) out.push({ id: row.id, team: row.team, reason, gain });
  }
  return out.slice(0, 3);
}

// The weekend weather of a round (always the same for the same round and date)
const weatherMemory = {};
function roundWeather(s, round) {
  const key = s.id + "/" + round.circuit + "/" + round.date;
  if (!weatherMemory[key]) weatherMemory[key] = makeWeekendWeather(key, round.circuit);
  return weatherMemory[key];
}

// When the sessions take place (weekend time); the FIA can move sessions
function roundSchedule(s, round) {
  const base = sessionSchedule(round, !!(CIRCUIT_CHARACTER[round.circuit] || {}).night);
  return Object.assign(base, round.schedule || {});
}

// ---------- Weekend forecast and the FIA decisions about the event ----------
// "Now" for the forecast: Thursday noon before the weekend, or the last session that was run
function forecastNow(s, round) {
  const schedule = roundSchedule(s, round);
  const done = weekendSessions(round).filter(t => round.sessions[t]);
  return done.length ? Math.max(...done.map(t => schedule[t])) + 7200 : -36 * 3600;
}

// The forecast of every session that is still to come
function weekendForecast(s, round) {
  const W = roundWeather(s, round);
  const schedule = roundSchedule(s, round);
  const now = forecastNow(s, round);
  return weekendSessions(round).filter(t => !round.sessions[t]).map(type => {
    const at = schedule[type];
    const length = type === "RACE" ? 2 * 3600 : type === "SPRINT" ? 3600 : 3600;
    let worst = null;
    for (let t = at; t <= at + length; t += 1800) {
      const f = weatherForecast(W, now, t);
      if (!worst || f.rain > worst.rain || f.thunder > worst.thunder) worst = f;
    }
    const severe = worst.thunder >= 40 || (worst.rain >= 60 && worst.intensity === "heavy");
    return { type, at, forecast: worst, severe };
  });
}

function heatForecast(s, round) {
  const W = roundWeather(s, round);
  const at = roundSchedule(s, round).RACE;
  return forecastMaxAir(W, at, at + 2 * 3600);
}

// Free weekends to postpone an event to (no other round within 6 days)
function freeWeekends(s, round) {
  const day = 864e5;
  const dates = s.calendar.filter(r => r !== round && r.status !== "CANCELLED").map(r => Date.parse(r.date));
  const lastDone = Math.max(...s.calendar.filter(r => r.status === "DONE").map(r => Date.parse(r.date)), Date.parse(round.date) - day);
  const last = Math.max(...dates, Date.parse(round.date));
  const out = [];
  for (let t = Date.parse(round.date) + 7 * day; t <= last + 35 * day && out.length < 5; t += 7 * day) {
    if (t <= lastDone) continue;
    if (dates.every(d => Math.abs(d - t) >= 6 * day)) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// The FIA moves / cancels a session or the whole event
function fiaWeekendAction(s, round, action, value) {
  const info = roundInfo(round);
  const night = !!info.character.night;
  const late = night ? 4 : 0;
  const log = text => s.log.push({ date: new Date().toISOString(), round: round.round, text: "FIA: " + text });
  // every decision about the event is also published as a document of the weekend
  const notice = (title, body, lines) => publishNotice(s, round.round, { title, body, lines, from: "The FIA", sign: "The Race Director" });
  const forecast = () => {
    const f = weekendForecast(s, round).find(x => x.type === value) || weekendForecast(s, round)[0];
    return f ? [["Forecast", f.forecast.rain + " % rain" + (f.forecast.thunder ? " · thunderstorms " + f.forecast.thunder + " %" : "") + (f.forecast.intensity ? " · " + f.forecast.intensity : "")]] : [];
  };
  if (action === "moveQ") {
    round.schedule = Object.assign({}, round.schedule, { Q: 2 * 86400 + (9.5 + late) * 3600 });
    log("Qualifying of the " + info.gp + " moved to Sunday morning.");
    notice("Change of the timetable – Qualifying", "Due to the weather forecast, Qualifying is moved to Sunday morning.", [["New time", "Sunday " + formatDayTime(round.schedule.Q % 86400)]]);
  } else if (action === "moveSQ") {
    round.schedule = Object.assign({}, round.schedule, { SQ: 1 * 86400 + (9 + late) * 3600 });
    log("Sprint Qualifying of the " + info.gp + " moved to Saturday morning.");
    notice("Change of the timetable – Sprint Qualifying", "Due to the weather forecast, Sprint Qualifying is moved to Saturday morning.", [["New time", "Saturday " + formatDayTime(round.schedule.SQ % 86400)]]);
  } else if (action === "cancelSession") {
    const lines = forecast();
    round.sessions[value] = { status: "CANCELLED", rows: [], reason: "weather" };
    log(SESSION_NAMES[value] + " of the " + info.gp + " cancelled.");
    notice(SESSION_NAMES[value] + " cancelled", "Due to the weather conditions the " + SESSION_NAMES[value] + " will not take place." +
      (value === "Q" || value === "SQ" ? " The grid will be set according to the championship order." : value === "RACE" ? " No points are awarded." : ""), lines);
    if (value === "RACE") {
      round.status = "CANCELLED";
      if (round.prepared) standInsBack(s); // the stand-ins of this weekend go back to the bench
    }
  } else if (action === "cancelEvent") {
    round.status = "CANCELLED";
    if (round.prepared) standInsBack(s);
    log("The " + info.gp + " has been cancelled.");
    notice("Event cancelled", "The " + info.gp + " has been cancelled. No points are awarded.", forecast());
  } else if (action === "postpone") {
    const old = round.date;
    const oldDates = {};
    for (const r of s.calendar) oldDates[r.round] = r.date;
    round.date = value;
    round.schedule = null;
    s.calendar.sort((a, b) => a.date.localeCompare(b.date));
    renumberRounds(s, oldDates);
    if (typeof hubRound !== "undefined") hubRound = null;
    log("The " + info.gp + " has been postponed from " + old + " to " + value + ".");
    notice("Event postponed", "The " + info.gp + " has been postponed.", [["Original date", old], ["New date", value], ["Round", String(round.round)]]);
  } else if (action === "heat") {
    round.heatDeclared = !round.heatDeclared;
    log((round.heatDeclared ? "Heat hazard declared" : "Heat hazard withdrawn") + " for the " + info.gp + ".");
    notice(round.heatDeclared ? "Heat hazard declared" : "Heat hazard withdrawn",
      round.heatDeclared ? "A heat hazard is declared for the race: the cooling systems for the drivers must be fitted (Technical Regulations)." : "The heat hazard declared for this event is withdrawn.",
      [["Forecast air temperature", Math.round(heatForecast(s, round)) + " °C"], ["Threshold", s.rules.heatHazard + " °C"]]);
  }
  if (s.calendar.every(x => x.status === "DONE" || x.status === "CANCELLED")) {
    s.phase = "FINISHED";
    seasonEndAudit(s);
  }
  saveSeason(s);
}

// ---------- The teams between the races (season-cars.js) ----------
// Before the first session of a weekend: race bans, new parts, power units
function prepareWeekend(s, round) {
  if (round.prepared) return;
  round.prepared = true;
  const arrivals = [];
  const other = [].concat(autoApproveNominations(s, round), bansForWeekend(s, round));
  const lines = other.concat(upgradesForWeekend(s, round, arrivals), powerUnitsForWeekend(s, round, arrivals));
  // nominations, bans and stand-ins: short news lines in the card
  for (const text of other) arrivals.push({ kind: "NOTE", text });
  round.notes = lines;
  round.arrivals = arrivals; // the "Weekend arrivals" card of the hub (season-ui.js)
  // the power unit elements of the weekend: a document of the Technical Delegate
  const pu = arrivals.filter(a => a.kind === "PU");
  if (pu.length) {
    publishNotice(s, round.round, { title: "Power unit elements used", from: "The Technical Delegate", to: "The Stewards", sign: "The Technical Delegate",
      body: "The following new power unit elements were used for this event. Elements above the allocation lead to grid penalties.",
      lines: pu.map(a => [seasonDriverName(a.driver),
        a.parts.map(p => (PU_SHORT_NAMES[p.k] || p.k) + " " + p.count + " of " + p.allowed).join(" · ") +
        (a.back ? " – starts from the back of the grid" : a.places ? " – " + a.places + "-place grid penalty" : "")]) });
  }
  // the parts the teams brought: an information of the Technical Delegate on the FIA desk
  // (the full "Weekend arrivals" view) and a document like the real "car presentation submissions"
  addArrivalsDeskItem(s, round);
  const upgrades = arrivals.filter(a => a.kind === "UPGRADE");
  if (upgrades.length) {
    const byTeam = new Map();
    for (const a of upgrades) byTeam.set(a.team, (byTeam.get(a.team) || []).concat(a));
    publishNotice(s, round.round, { title: "Car presentation submissions – new parts", from: "The Technical Delegate", to: "All Teams", sign: "The Technical Delegate",
      body: "The teams declared the following updated components for this event.",
      lines: Array.from(byTeam.entries()).map(([team, list]) => [(seasonTeam(team) || { name: team }).name,
        list.map(a => a.name + " (" + (AREA_SHORT[a.area] || a.area) + ")").join(" · ")]) });
  }
  for (const text of lines) s.log.push({ date: new Date().toISOString(), round: round.round, text });
  saveSeason(s);
}

// The information item of the Technical Delegate on the FIA desk (no decision needed)
function addArrivalsDeskItem(s, round) {
  if ((s.inbox || []).some(x => x.type === "ARRIVALS" && x.round === round.round)) return;
  addDeskItem(s, { round: round.round, type: "ARRIVALS", status: "INFO",
    title: "Technical Delegate: weekend arrivals – " + roundInfo(round).gp,
    text: "New parts, power unit elements and pit lane starts of this weekend.", options: [], data: { roundNumber: round.round } });
}

// After the Grand Prix: power units age, money is spent, packages are ordered, drivers change
function afterRoundTeams(s, round, raceResult) {
  powerUnitsAfterRace(s, round, raceResult);
  const lines = [].concat(developmentAfterRound(s, round, raceResult), marketAfterRound(s, round));
  for (const text of lines) s.log.push({ date: new Date().toISOString(), round: round.round, text });
}

// Grid when the grid session was not run: championship order (then car number)
function championshipOrder(s) {
  const st = computeStandings(s);
  const ranked = st.drivers.map(d => d.id);
  const rest = Object.keys(s.drivers).filter(id => !ranked.includes(id)).sort((a, b) => s.drivers[a].number - s.drivers[b].number);
  return ranked.concat(rest);
}

// Grid without qualifying: carried grid penalties move the cars back (back of the grid last)
function applyCarriedToGrid(s, entries) {
  const key = new Map();
  entries.forEach((e, i) => {
    const d = s.drivers[e.driverId];
    key.set(e, d && d.carryBack ? 1000 + i : i + (d && d.carryGrid > 0 ? d.carryGrid + 0.5 : 0));
  });
  entries.sort((a, b) => key.get(a) - key.get(b));
}

// Grid penalties from earlier races are applied in the Grand Prix qualifying
function applyCarriedGridPenalties(s, type) {
  if (type !== "Q") return;
  for (const car of race.cars) {
    const d = s.drivers[car.driverId];
    if (d && d.carryGrid > 0) {
      car.pen.grid = (car.pen.grid || 0) + d.carryGrid;
      addAlert("info", carLabel(car) + " has a " + d.carryGrid + "-place grid penalty (earlier event / power unit).", { carId: car.id });
    }
    if (d && d.carryBack) {
      car.pen.back = true;
      addAlert("info", carLabel(car) + " will start from the back of the grid (power unit elements).", { carId: car.id });
    }
  }
}

// Start a session live in Race Control
async function startSeasonSession(roundNumber, type, options, status) {
  const s = season;
  if (pendingHearings(s).length) throw new Error("Decide the hearings on the FIA desk first – their decisions must be published before the next session.");
  const round = s.calendar.find(r => r.round === roundNumber);
  const setup = await buildSeasonSetup(s, round, type, options, status);
  saveSeason(s); // the attempt counter

  createRace(setup);
  race.docCount = (s.docSeqByRound || {})[String(roundNumber)] || 0; // decision documents continue the weekend's numbers
  applyCarriedGridPenalties(s, type);
  $("seasonScreen").hidden = true;
  $("seasonRcBtn").hidden = false;
  const info = roundInfo(round);
  $("raceSub").textContent = s.name + " · " + REGS_INFO[s.generation].short + " cars · " + info.name + " · " +
    (setup.session === "QUALI" ? setup.qualiDurations.map(d => formatMinutes(d)).join(" / ") + " min" : setup.totalLaps + " laps") +
    " · " + (setup.track.length / 1000).toFixed(3) + " km";
  showControlRoom();
}


// ---------- 3. Save the result ----------
function sessionResultFromRace() {
  const r = race;
  const ctx = r.setup.seasonContext;
  const s = season;
  const rules = s.rules;
  const wetSeen = r.weather.maxSeen || 0;
  const weatherText = wetSeen < 0.05 ? "dry" : wetSeen < 0.3 ? "damp patches" : wetSeen < 0.75 ? "wet" : "heavy rain";
  const result = { status: "DONE", date: new Date().toISOString(), distance: ctx.distance, weather: weatherText,
    rdScore: ctx.auto ? null : computeEvaluation().overall, auto: !!ctx.auto, overtakes: r.overtakes, safetyCars: r.evalData.scCount, vsc: r.evalData.vscCount, redFlags: r.evalData.redCount,
    abandoned: r.abandoned ? r.abandoned.reason : null };

  // free practice directed live: the time sheet, long runs and tyre data (season-practice.js)
  if (r.setup.practice) return Object.assign(result, practiceResultFromRace(r, ctx, wetSeen));

  // qualifying abandoned before the first segment was completed: no result, the stewards set the grid
  if (r.session === "QUALI" && r.abandoned && r.abandoned.completed === 0) {
    result.status = "CANCELLED";
    result.rows = [];
    return result;
  }

  if (r.session === "QUALI") {
    const rows = qualiResults();
    result.rows = rows.map(row => ({
      id: row.car.driverId, team: row.car.teamId || teamOfDriver(s, row.car.driverId), pos: row.car.dsq ? null : Number(row.position) || null,
      status: row.car.dsq ? "DSQ" : "OK", times: row.times, grid: row.grid, note: row.penaltyText || ""
    }));
    result.grid = result.rows.slice().sort((a, b) => a.grid - b.grid).map(row => row.id);
    result.pole = result.rows.find(row => row.pos === 1) ? result.rows.find(row => row.pos === 1).id : null;
    return result;
  }

  // ----- race or sprint -----
  const rows = computeResults();
  const sprint = ctx.type === "SPRINT";
  // abandoned race: the count-back lap counts, and only laps under green flag make a race
  const leaderLaps = r.abandoned ? r.abandoned.lap : Math.max(...r.cars.map(c => c.laps));
  const greenLaps = r.abandoned ? Math.min(r.greenLaps || 0, leaderLaps) : leaderLaps;
  const distanceShare = leaderLaps / r.plannedLaps;
  let table = sprint ? (rules.sprintPoints ? SPRINT_POINTS : []) : POINTS_SYSTEMS[rules.points].race;
  if (!sprint && distanceShare < 0.999) table = shortenedPointsTable(rules.shortened, table, distanceShare, greenLaps);
  if (sprint && greenLaps < 2) table = [];
  if (sprint && distanceShare < 0.5) table = []; // a sprint below half distance gives no points
  result.shortened = distanceShare < 0.999 ? Math.round(distanceShare * 100) : null;

  // fastest lap (classified drivers only)
  let fastest = null;
  for (const row of rows) {
    if (row.status === "DSQ" || !row.car.bestLap) continue;
    if (!fastest || row.car.bestLap.time < fastest.time) fastest = { id: row.car.driverId, time: row.car.bestLap.time };
  }
  result.fastestLap = fastest;

  result.rows = rows.map(row => {
    const classified = row.position !== "DNF" && row.position !== "DSQ";
    const pos = classified ? parseInt(row.position, 10) : null;
    let points = pos && pos <= table.length ? table[pos - 1] : 0;
    const fl = !sprint && rules.fastestLapPoint && fastest && fastest.id === row.car.driverId && pos && pos <= 10 && table.length >= 10;
    if (fl) points += 1;
    return {
      id: row.car.driverId, team: row.car.teamId || teamOfDriver(s, row.car.driverId), pos, status: row.status === "Running" ? "OK" : row.status === "Finished" ? "OK" : row.status,
      laps: row.laps, gap: row.gapText, penalty: row.penalty, total: row.total, grid: row.car.grid, best: row.car.bestLap ? row.car.bestLap.time : null,
      reason: row.status === "DNF" ? row.car.retireReason : "", points, fl: !!fl
    };
  });
  result.table = table; // kept to recalculate the points after a disqualification (FIA desk)
  return result;
}

function teamOfDriver(s, id) {
  const t = s.teams.find(team => team.drivers.includes(id));
  return t ? t.id : null;
}

// The Race Director saves the session and goes back to the championship
async function finishSeasonSession() {
  const r = race;
  const ctx = r.setup.seasonContext;
  if (!season || season.id !== ctx.seasonId) {
    if (!loadSeason(ctx.seasonId)) {
      showToast("The championship could not be found.");
      return;
    }
  }
  if (!r.finished && !await askConfirm("The session is not finished yet. Save the current (provisional) classification anyway?", { title: "Session not finished", ok: "Save anyway" })) return;
  // incidents under investigation (or "after the session") become hearings on the FIA desk;
  // incidents nobody looked at are closed with no further action
  const hearings = r.incidents.filter(i => !i.historic && ["AFTER_RACE", "INVESTIGATING"].includes(i.status));
  const pending = r.incidents.filter(i => ["NEW", "NOTED"].includes(i.status));
  if ((pending.length || hearings.length) && !await askConfirm(
    (hearings.length ? hearings.length + " incident(s) under investigation go to the FIA desk as hearings – decide them before the next session. " : "") +
    (pending.length ? pending.length + " incident(s) nobody investigated will be closed with no further action." : ""),
    { title: "Open incidents", ok: "Save the session" })) return;
  if (race !== r) return; // left meanwhile
  const roundNumber = commitSeasonSession();
  leaveControlRoom(roundNumber);
}

// ---------- Event notes of the weekend ----------
// Like in real F1 the Race Director publishes the event notes before FP1: they are the rules
// of the whole weekend (round.eventNotes) and apply to every session (setup.eventNotes).
// A weekend that starts without notes gets the standard notes automatically.
function weekendNotesLines(s, n) {
  const gen2026 = s.generation === "GEN2026";
  const zonesOff = (n.zonesOff || []).map((x, i) => (x ? i + 1 : 0)).filter(Boolean);
  const lines = [["Pit lane speed limit", n.pitKmh + " km/h"],
    ["Track limits monitored at", n.corners.length ? n.corners.map(x => "Turn " + x).join(", ") : "–"],
    ["Track limits (sprint and race)", "black and white flag after " + n.tlBwAt + ", penalty after " + n.tlPenaltyAt + " deleted lap times"]];
  if (zonesOff.length) lines.push([gen2026 ? "Straight Mode zones" : "DRS zones", "zone " + zonesOff.join(", ") + " disabled"]);
  lines.push(["Pit exit line", n.pitExitLine === false ? "not investigated" : "crossing the line is investigated"]);
  if (n.scPitClosed) lines.push(["Safety Car", "pit entry closed until the field is behind the Safety Car"]);
  lines.push(["Lapped cars under the SC", n.lappedAllowed === false ? "may not overtake" : "may overtake when the Race Director allows it"]);
  lines.push(["Blue flags", "faster car within " + Number(n.blueGap).toFixed(1) + " s"]);
  lines.push(["Maximum delta time (practice, qualifying)", n.maxDelta ? "in force" : "not in force"], ["Practice starts", PRACTICE_START_TEXT[n.practiceStarts] || "–"]);
  if (n.tyreChecks) lines.push(["Technical checks", "minimum tyre pressures will be checked"]);
  if (n.text) lines.push(["Note", n.text]);
  return lines;
}

function publishWeekendNotes(s, round, notes, track, auto) {
  const n = normaliseNotes(notes, defaultNotesFor(track, s.generation === "GEN2026"));
  n.auto = !!auto;
  // published again during the weekend (FIA desk): a revised version, from the next session on
  const started = Object.keys(round.sessions).length > 0;
  const previous = round.eventNotes && round.eventNotesDocId ? docById(s, round.eventNotesDocId) : null;
  const next = weekendSessions(round).find(t => !round.sessions[t]);
  n.revision = started && round.eventNotes ? (round.eventNotes.revision || 0) + 1 : 0;
  round.eventNotes = n;
  if (n.tyreChecks) round.tyreChecks = true; // the technical delegate checks the tyre pressures (season-fia.js)
  const doc = publishNotice(s, round.round, {
    session: started ? next : weekendSessions(round)[0],
    title: "Race Director's event notes" + (auto ? " (standard)" : n.revision ? " – revised" + (n.revision > 1 ? " (" + n.revision + ")" : "") : ""),
    from: "The Race Director", sign: "The Race Director",
    body: n.revision
      ? "These event notes replace " + (previous ? "Document " + previous.no : "the earlier event notes") + " and apply from " + (SESSION_NAMES[next] || "the next session") + " on. Track limits will be judged at the exit of the corners listed below."
      : "The following applies to all sessions of the " + roundInfo(round).gp + ". Track limits will be judged at the exit of the corners listed below; a lap time is deleted when a car leaves the track there.",
    lines: weekendNotesLines(s, n) });
  round.eventNotesDocId = doc.id;
  return n;
}

// The FIA desk: the event notes of the running weekend can be revised between the sessions
function weekendNotesDeskCard(s) {
  const next = nextSession(s);
  const round = next && next.round;
  if (!round || !round.eventNotes || !Object.keys(round.sessions).length) return "";
  const doc = round.eventNotesDocId ? docById(s, round.eventNotesDocId) : null;
  const n = round.eventNotes;
  return `
    <div class="setup-card notes-desk">
      <div class="notes-strip">
        <span>📋 <b>Event notes – ${escapeHtml(roundInfo(round).gp)}</b>${doc ? ` <span class="muted small">(Document ${doc.no}${n.revision ? ", revision " + n.revision : ""})</span>` : ""}<br>
          <span class="muted small">Revise them between the sessions – the revised notes are published as a new document and apply from ${escapeHtml(SESSION_NAMES[next.type])} on.</span></span>
        <span class="btn-row">${doc ? `<button class="small-btn" data-doc-view="${doc.id}">Read</button>` : ""}<button class="notes-btn" data-notes-revise="${round.round}">📋 Revise event notes…</button></span>
      </div>
    </div>`;
}

async function reviseWeekendNotes(roundNumber) {
  const s = season;
  const round = s.calendar.find(r => r.round === roundNumber);
  if (!round || !round.eventNotes) return;
  let track;
  try {
    track = await loadSeasonTrack(round.circuit, s.zones[round.circuit], text => showToast(text));
  } catch (error) {
    showToast("The circuit could not be loaded: " + error.message);
    return;
  }
  const gen2026 = s.generation === "GEN2026";
  openNotesDialog({
    track, gen2026, race: true, quali: true, what: "weekend", revise: true,
    notes: Object.assign(defaultNotesFor(track, gen2026), round.eventNotes),
    onPublish: notes => {
      if (race && $("app") && !$("app").hidden) return "A session is running – revise the event notes between the sessions.";
      const n = publishWeekendNotes(s, round, notes, track, false);
      saveSeason(s);
      renderHub();
      showToast("Revised event notes published (revision " + n.revision + ").");
    }
  });
}

// before the first session of a weekend: the notes exist (the standard ones if none were published)
function ensureWeekendNotes(s, round, track) {
  if (!round.eventNotes) publishWeekendNotes(s, round, {}, track, true);
  return round.eventNotes;
}

// The hub: publish the notes before FP1, or read them afterwards
async function openWeekendNotes(roundNumber) {
  const s = season;
  const round = s.calendar.find(r => r.round === roundNumber);
  if (!round) return;
  let track;
  try {
    track = await loadSeasonTrack(round.circuit, s.zones[round.circuit], text => showToast(text));
  } catch (error) {
    showToast("The circuit could not be loaded: " + error.message);
    return;
  }
  const gen2026 = s.generation === "GEN2026";
  const started = Object.keys(round.sessions).length > 0;
  openNotesDialog({
    track, gen2026, race: true, quali: true, what: "weekend", readOnly: started,
    notes: Object.assign(defaultNotesFor(track, gen2026), round.eventNotes || {}),
    onPublish: notes => {
      if (Object.keys(round.sessions).length) return "The weekend has started – the event notes can't be changed any more.";
      const n = publishWeekendNotes(s, round, notes, track, false);
      saveSeason(s);
      renderHub();
      showToast("Event notes published (" + n.corners.length + " track limits corners).");
    }
  });
}

// The checks of the FIA doctor after heavy impacts (incidents.js scheduleMedicalCheck):
// a driver who is not fit misses the rest of the weekend (a stand-in drives),
// after a very heavy impact (55 g and more) also the next weekend.
function medicalAfterSession(s, round, type, checks) {
  for (const m of checks) {
    const d = s.drivers[m.driverId];
    if (!d) continue;
    const who = seasonDriverName(m.driverId);
    if (m.fit) {
      publishNotice(s, round.round, { session: type, title: "Medical delegate – " + who, from: "The FIA Medical Delegate", sign: "The FIA Medical Delegate",
        body: "Following the impact of " + m.g + " g in the " + SESSION_NAMES[type] + ", " + who + " was examined at the circuit medical centre and has been declared fit to continue." });
      continue;
    }
    const untilRound = round.round + (m.g >= NEXT_EVENT_G ? 1 : 0);
    d.unfitUntilRound = Math.max(d.unfitUntilRound || 0, untilRound);
    const lines = [["Driver", who], ["Impact", m.g + " g"], ["Session", SESSION_NAMES[type]],
      ["Not fit until", untilRound > round.round ? "the end of the next event" : "the end of this event"]];
    // the rest of this weekend: a stand-in drives the car (not after the race – the weekend is over)
    let standIn = "";
    if (type !== "RACE") {
      const team = s.teams.find(t => t.drivers.includes(m.driverId));
      const sub = team && bestFreeAgent(s);
      if (sub) {
        signDriver(s, team, m.driverId, sub, true);
        standIn = seasonDriverName(sub);
        lines.push(["Replaced by", standIn + " (" + team.name + ")"]);
      }
    }
    publishNotice(s, round.round, { session: type, title: "Medical delegate – driver not fit to race", from: "The FIA Medical Delegate", sign: "The FIA Medical Delegate",
      body: "Following the impact of " + m.g + " g in the " + SESSION_NAMES[type] + ", " + who + " was examined at the circuit medical centre and has been declared NOT FIT to take part in the remaining sessions" +
        (untilRound > round.round ? " of this event and of the next event." : " of this event.") + (standIn ? " " + standIn + " will drive the car." : ""),
      lines });
  }
}

// Store the result of the session in the season (live and auto-simulated)
function commitSeasonSession() {
  const r = race;
  const ctx = r.setup.seasonContext;
  const s = season;
  const round = s.calendar.find(x => x.round === ctx.round);
  const result = sessionResultFromRace();
  round.sessions[ctx.type] = result;
  if (r.rubber !== undefined) round.rubber = Math.round(r.rubber * 1000) / 1000; // the rubber the session left on the track
  // the tyre sets used in this session (practice live, qualifying) – season-practice.js
  if (result.status === "DONE" || r.session === "QUALI") {
    for (const car of r.cars) {
      if (!car.tyreOwner) continue;
      for (const c in car.setsUsed) useTyreSets(s, round, car.tyreOwner, c, car.setsUsed[c]);
    }
  }
  // the decisions of the stewards: precedents for later rounds, right of review (stewards.js)
  if (result.status === "DONE") recordSeasonDecisions(s, round, Object.assign({}, ctx, { reviews: !ctx.auto }));
  // documents of the session: wet race declared, the final starting grid after qualifying
  if (r.wetDeclared && r.session === "RACE") {
    publishNotice(s, round.round, { session: ctx.type, title: "Wet race declared", from: "The Race Director", sign: "The Race Director",
      body: "The " + SESSION_NAMES[ctx.type] + " was declared wet: the use of intermediate or wet-weather tyres is free, the requirement to use two dry compounds does not apply." });
  }
  // (the event notes of the weekend are a document from before FP1: publishWeekendNotes)
  medicalAfterSession(s, round, ctx.type, r.medical || []);
  if ((ctx.type === "Q" || ctx.type === "SQ") && result.status === "DONE" && result.grid) {
    const rowOf = id => result.rows.find(x => x.id === id) || {};
    publishNotice(s, round.round, { session: ctx.type, title: "Final starting grid – " + SESSION_NAMES[ctx.type === "SQ" ? "SPRINT" : "RACE"],
      from: "The Stewards", sign: "The Stewards",
      body: "The final starting grid, including all grid penalties applied by the Stewards.",
      lines: result.grid.map((id, i) => [String(i + 1), seasonDriverName(id) + (rowOf(id).note ? " – " + rowOf(id).note : "")]) });
  }

  // penalty points, reprimands and grid penalties carry over to the next events
  const notes = [];
  for (const car of r.cars) {
    const d = s.drivers[car.driverId];
    if (!d) continue;
    const who = seasonDriverName(car.driverId);
    // first: the carried penalties that this qualifying has just applied are used up
    // (before new ones are added – a 10-place drop from reprimands in this Q counts for the next GP)
    const qDone = round.sessions.Q && round.sessions.Q.status === "DONE";
    if ((ctx.type === "Q" && result.status === "DONE") || (ctx.type === "RACE" && !qDone)) {
      d.carryGrid = 0; // applied in this qualifying (or, without one, to the race grid)
      d.carryBack = false;
    }
    if (car.pen.points) {
      d.penaltyPoints += car.pen.points;
      notes.push(who + " +" + car.pen.points + " penalty points (" + d.penaltyPoints + " total)");
    }
    if (car.pen.reprimands) {
      d.reprimands += car.pen.reprimands;
      notes.push(who + " reprimand (" + d.reprimands + " this season)");
      if (d.reprimands >= s.rules.reprimandsGridDrop && d.reprimands - car.pen.reprimands < s.rules.reprimandsGridDrop) {
        d.carryGrid += 10;
        notes.push(who + " reached " + s.rules.reprimandsGridDrop + " reprimands: 10-place grid penalty");
      }
    }
    if (isPractice(ctx.type)) {
      // grid penalties from practice (impeding, unsafe release ...) count in the Grand Prix
      if (car.pen.grid) {
        d.carryGrid += car.pen.grid;
        notes.push(who + " " + car.pen.grid + "-place grid penalty for the Grand Prix");
      }
    } else if (r.session === "RACE" && car.pen.grid) {
      d.carryGrid += car.pen.grid;
      notes.push(who + " " + car.pen.grid + "-place grid penalty for the next Grand Prix");
    }
  }

  const info = roundInfo(round);
  let summary = (ctx.type === "RACE" ? "" : SESSION_NAMES[ctx.type] + " · ") + info.gp + ": ";
  if (r.setup.practice) {
    const top = result.rows.find(x => x.best);
    summary += top ? "fastest " + (top.name || seasonDriverName(top.id)) + " " + formatLapTime(top.best) : "no time set";
    // the rookie runs count for the rookie rule
    s.rookieRuns = s.rookieRuns || {};
    for (const x of ctx.rookies || []) if (!x.skipped) s.rookieRuns[x.team] = rookieCount(s, x.team) + 1;
  } else if (result.status === "CANCELLED") summary += "abandoned before the first segment was completed – the grid follows the championship order";
  else if (r.session === "QUALI") summary += "pole for " + seasonDriverName(result.pole) + (r.abandoned ? " (abandoned, grid from " + segName(r.abandoned.completed) + ")" : "");
  else {
    const win = result.rows.find(x => x.pos === 1);
    summary += "won by " + (win ? seasonDriverName(win.id) : "–") + (result.shortened ? " (" + result.shortened + " % distance" + (r.abandoned ? ", abandoned" : "") + ")" : "");
  }
  s.log.push({ date: new Date().toISOString(), round: ctx.round, text: summary + (notes.length ? " · " + notes.join(" · ") : "") });

  // the weekend is over after the Grand Prix: the teams work on their cars, money and drivers
  if (ctx.type === "RACE") {
    round.status = "DONE";
    afterRoundTeams(s, round, result);
    fiaDeskAfterRace(s, round, result); // protests and technical reports (season-fia.js)
  }
  if (s.phase === "PRESEASON") s.phase = "SEASON";
  if (s.calendar.every(x => x.status === "DONE" || x.status === "CANCELLED")) {
    s.phase = "FINISHED";
    seasonEndAudit(s); // cost cap audit (season-fia.js)
  }
  saveSeason(s);
  return round.round;
}

// ---------- Auto-simulation ----------
// The session runs at full speed without drawing; the AI Race Director and
// the AI Stewards (ai-director.js) take all decisions. progress(0...1, text)

async function autoSimulateSession(roundNumber, type, options, progress) {
  if (pendingHearings(season).length) throw new Error("decide the hearings on the FIA desk first – their decisions must be published before the next session");
  if (isPractice(type)) {
    // free practice is simulated in an instant (season-practice.js)
    progress(0.5, SESSION_NAMES[type] + " …");
    await runPracticeSession(roundNumber, type, text => progress(0, text));
    return;
  }
  const s = season;
  const round = s.calendar.find(r => r.round === roundNumber);
  const setup = await buildSeasonSetup(s, round, type, options, text => progress(0, text));
  setup.seasonContext.auto = true;
  // the AI FIA declares a heat hazard when the forecast is hot enough
  if (!round.heatDeclared && heatForecast(s, round) >= s.rules.heatHazard) {
    round.heatDeclared = true;
    setup.heat.declared = true;
    s.log.push({ date: new Date().toISOString(), round: round.round, text: "Heat hazard declared for the " + roundInfo(round).gp + " (AI FIA)." });
    publishNotice(s, round.round, { title: "Heat hazard declared", from: "The FIA", sign: "The Race Director",
      body: "A heat hazard is declared for the race: the cooling systems for the drivers must be fitted (Technical Regulations).",
      lines: [["Forecast air temperature", Math.round(heatForecast(s, round)) + " °C"], ["Threshold", s.rules.heatHazard + " °C"]] });
  }
  saveSeason(s);

  createRace(setup);
  race.docCount = (s.docSeqByRound || {})[String(roundNumber)] || 0;
  applyCarriedGridPenalties(s, type);
  setPaused(true);
  race.autoSlow = false;
  const ai = makeAiDirector();
  const quali = race.session === "QUALI";
  const totalQuali = quali ? race.q.durations.reduce((a, b) => a + b, 0) : 0;
  // long suspensions are possible: qualifying gets 2 extra hours, a race its full time window
  const maxSteps = quali ? (totalQuali + 7200) / DT : ((race.setup.limits ? race.setup.limits.window : 10800) + 3600) / DT;
  let steps = 0;

  await new Promise((resolve, reject) => {
    const chunk = () => {
      try {
        const until = performance.now() + 40; // keep the page responsive
        while (performance.now() < until) {
          for (let k = 0; k < 200; k++) {
            simStep();
            aiTick(ai);
            steps++;
          }
          const over = quali ? race.q.state === "DONE" : race.finished;
          if (over || steps > maxSteps) {
            resolve();
            return;
          }
        }
        const share = quali ? race.q.elapsed / totalQuali : (race.order[0] ? race.order[0].laps / race.totalLaps : 0);
        progress(clamp(share, 0, 1), SESSION_NAMES[type] + ": " + (quali ? segName() : "lap " + Math.min(race.leaderLap, race.totalLaps) + " / " + race.totalLaps));
        setTimeout(chunk, 0);
      } catch (error) {
        reject(error);
      }
    };
    chunk();
  }).catch(error => {
    race = null;
    setPaused(false);
    throw error;
  });

  if (!quali && !race.finished) {
    // safety net (should not happen): end the race where it is
    race.finished = true;
    race.phase = "FINISHED";
  }
  aiCloseAllIncidents(ai);
  commitSeasonSession();
  race = null;
  setPaused(false);
}

// Several sessions in a row: "SESSION", "WEEKEND" (to the end of this weekend) or "SEASON"
// The FIA pressed "Stop": the running session is finished and saved, then the run ends
let autoSimStop = false;

async function autoSimulate(scope, options, progress) {
  autoSimStop = false;
  const first = nextSession(season);
  if (!first) return 0;
  let count = 0;
  while (true) {
    if (autoSimStop) break;
    const next = nextSession(season);
    if (!next) break;
    if (scope === "WEEKEND" && next.round !== first.round) break;
    if (scope === "SESSION" && count === 1) break;
    const label = "Round " + next.round.round + " · " + roundInfo(next.round).gp + " · ";
    await autoSimulateSession(next.round.round, next.type, options, (share, text) => progress(share, label + text));
    count++;
  }
  return count;
}

// Back from Race Control to the championship (without saving: the session stays open)
async function abandonSeasonSession() {
  if (!await askConfirm("The session is not saved and can be run again.", { title: "Leave Race Control?", ok: "Leave", danger: true })) return;
  if (!race) return;
  const ctx = race && race.setup.seasonContext;
  leaveControlRoom(ctx ? ctx.round : null);
}

function leaveControlRoom(roundNumber) {
  closeModal();
  race = null;
  setPaused(false);
  $("app").hidden = true;
  $("seasonRcBtn").hidden = true;
  document.body.classList.remove("quali-mode", "gen-2026");
  if (!season) {
    showSeasonScreen(false);
    return;
  }
  showSeasonScreen(true);
  hubTab = "calendar";
  hubRound = roundNumber;
  renderHub();
}


// ---------- 4. Standings ----------
// While the hub is drawn, the standings are computed only once (they are needed
// by many cards: ATR, team cards, review ...). Outside of a hub render: always fresh.
let standingsMemo = null;
let standingsMemoOn = false;

function computeStandings(s) {
  if (standingsMemoOn && standingsMemo && standingsMemo.s === s) return standingsMemo.value;
  const value = computeStandingsNow(s);
  if (standingsMemoOn) standingsMemo = { s, value };
  return value;
}

function computeStandingsNow(s) {
  const drivers = {};
  const teams = {};
  const ex = exclusionSets(s); // drivers / teams excluded from the championship by the FIA
  const driverRow = id => drivers[id] || (drivers[id] = { id, points: 0, wins: 0, podiums: 0, poles: 0, fastest: 0, dnf: 0, starts: 0, counts: [], best: 99, team: teamOfDriver(s, id) });
  const teamRow = id => teams[id] || (teams[id] = { id, points: 0, wins: 0, podiums: 0, counts: [], best: 99 });

  for (const round of s.calendar) {
    for (const type of ["SPRINT", "RACE"]) {
      const res = round.sessions[type];
      if (!res || res.status !== "DONE") continue;
      for (const row of res.rows) {
        const d = driverRow(row.id);
        if (row.team && ex.teamsWithDrivers.has(row.team)) ex.drivers.add(row.id); // drove for an excluded team
        const t = row.team && !ex.noTeamPoints.has(row.id) ? teamRow(row.team) : null;
        d.points += row.points;
        if (t) t.points += row.points;
        if (type !== "RACE") continue;
        d.starts++;
        if (!row.pos) d.dnf++;
        if (row.pos) {
          d.counts[row.pos] = (d.counts[row.pos] || 0) + 1;
          d.best = Math.min(d.best, row.pos);
          if (row.pos === 1) d.wins++;
          if (row.pos <= 3) d.podiums++;
          if (t) {
            t.counts[row.pos] = (t.counts[row.pos] || 0) + 1;
            t.best = Math.min(t.best, row.pos);
            if (row.pos === 1) t.wins++;
            if (row.pos <= 3) t.podiums++;
          }
        }
      }
      if (type === "RACE" && res.fastestLap) driverRow(res.fastestLap.id).fastest++;
    }
    const q = round.sessions.Q;
    if (q && q.status === "DONE" && q.pole) driverRow(q.pole).poles++;
  }

  // ties: most wins, then most second places ... (count-back)
  const compare = (a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (let p = 1; p <= 30; p++) {
      const diff = (b.counts[p] || 0) - (a.counts[p] || 0);
      if (diff) return diff;
    }
    return 0;
  };
  // points deducted from constructors by the FIA (cost cap breach)
  for (const id in (s.deductions || {})) {
    teamRow(id).points -= s.deductions[id];
    teamRow(id).deducted = s.deductions[id];
  }
  // excluded by the FIA: shown at the end, not classified
  for (const id in drivers) drivers[id].excluded = ex.drivers.has(id);
  for (const id in teams) teams[id].excluded = ex.teams.has(id);
  const classified = (a, b) => (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0) || compare(a, b);
  return {
    drivers: Object.values(drivers).sort(classified),
    teams: Object.values(teams).sort(classified)
  };
}
