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
const SEASON_OFFENCES = 0.2;
const SEASON_OVERTAKES = 0.4;
const SEASON_TYRE_DEG = 0.6;

const SESSION_NAMES = { SQ: "Sprint Qualifying", SPRINT: "Sprint", Q: "Qualifying", RACE: "Grand Prix" };

// ---------- 1. The sessions of a weekend ----------
function weekendSessions(round) {
  return round.sprint ? ["SQ", "SPRINT", "Q", "RACE"] : ["Q", "RACE"];
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
  prepareWeekend(s, round);
  const info = circuitInfo(round.circuit);
  const ch = info.character;
  const track = await loadSeasonTrack(round.circuit, s.zones[round.circuit], status);
  const quali = type === "SQ" || type === "Q";
  const sprintQuali = type === "SQ";
  const typeIndex = ["SQ", "SPRINT", "Q", "RACE"].indexOf(type);
  const attempt = (round.attempts = (round.attempts || 0) + 1);
  const seed = (hashText(s.id) % 100000) * 1000 + round.round * 40 + typeIndex * 10 + attempt;
  setSeed(seed);

  // distance: the Grand Prix has the real number of laps, the sprint ~100 km
  const fullLaps = type === "SPRINT" ? Math.ceil(100000 / track.length) : info.laps;
  const laps = Math.max(5, Math.round(fullLaps * options.distance));
  const durations = (sprintQuali ? SPRINT_QUALI_DURATIONS : QUALI_DURATIONS).map(d => Math.round(d * (options.distance < 1 ? 0.5 : 1)));

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
  const entries = seasonEntries(s, round.round, round.circuit);
  if (quali) {
    // timing screen order before the session: by car number
    entries.sort((a, b) => a.number - b.number);
    entries.forEach((e, i) => { e.grid = i + 1; e.startCompound = "SOFT"; e.plan = []; });
  } else {
    const gridFrom = round.sessions[type === "SPRINT" ? "SQ" : "Q"];
    const order = gridFrom && gridFrom.status === "DONE" ? gridFrom.grid : championshipOrder(s);
    entries.sort((a, b) => {
      const ia = order.indexOf(a.code);
      const ib = order.indexOf(b.code);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
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

  // heat hazard: declared by the FIA before the weekend when the forecast is hot enough
  const heat = { threshold: s.rules.heatHazard, declared: !!round.heatDeclared };

  return {
    mode: "season",
    regs: s.generation,
    session: quali ? "QUALI" : "RACE",
    sprint: sprintQuali,
    qualiDurations: durations,
    title: "Round " + round.round + " · " + info.gp + " · " + SESSION_NAMES[type],
    track,
    totalLaps: quali ? 30 : laps,
    paceScale: 1,
    incidentLevel: options.level,
    offenceScale: options.offences !== undefined ? options.offences : SEASON_OFFENCES, // realistic number of minor offences
    tyreDeg: SEASON_TYRE_DEG,                           // realistic tyre degradation
    overtakeScale: SEASON_OVERTAKES * (0.35 + 1.1 * (ch.overtaking !== undefined ? ch.overtaking : 0.5)), // Monaco ~0.15 … Baku ~0.5
    clockStart: Math.round(offset % 86400),   // local time of day at the start
    weather,
    heat,
    limits: quali ? null : { race: s.rules.maxRaceHours * 3600, window: s.rules.maxWindowHours * 3600 },
    entries,
    injections: [],
    real: null,
    seasonContext: { seasonId: s.id, round: round.round, type, distance: options.distance, seed, weatherKind: kind }
  };
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
  const info = circuitInfo(round.circuit);
  const night = !!info.character.night;
  const late = night ? 4 : 0;
  const log = text => s.log.push({ date: new Date().toISOString(), round: round.round, text: "FIA: " + text });
  if (action === "moveQ") {
    round.schedule = Object.assign({}, round.schedule, { Q: 2 * 86400 + (9.5 + late) * 3600 });
    log("Qualifying of the " + info.gp + " moved to Sunday morning.");
  } else if (action === "moveSQ") {
    round.schedule = Object.assign({}, round.schedule, { SQ: 1 * 86400 + (9 + late) * 3600 });
    log("Sprint Qualifying of the " + info.gp + " moved to Saturday morning.");
  } else if (action === "cancelSession") {
    round.sessions[value] = { status: "CANCELLED", rows: [], reason: "weather" };
    log(SESSION_NAMES[value] + " of the " + info.gp + " cancelled.");
    if (value === "RACE") round.status = "CANCELLED";
  } else if (action === "cancelEvent") {
    round.status = "CANCELLED";
    log("The " + info.gp + " has been cancelled.");
  } else if (action === "postpone") {
    const old = round.date;
    round.date = value;
    round.schedule = null;
    s.calendar.sort((a, b) => a.date.localeCompare(b.date));
    s.calendar.forEach((r, i) => { r.round = i + 1; });
    log("The " + info.gp + " has been postponed from " + old + " to " + value + ".");
  } else if (action === "heat") {
    round.heatDeclared = !round.heatDeclared;
    log((round.heatDeclared ? "Heat hazard declared" : "Heat hazard withdrawn") + " for the " + info.gp + ".");
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
  const lines = [].concat(autoApproveNominations(s, round), bansForWeekend(s, round), upgradesForWeekend(s, round), powerUnitsForWeekend(s, round));
  round.notes = lines;
  for (const text of lines) s.log.push({ date: new Date().toISOString(), round: round.round, text });
  saveSeason(s);
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

// Grid penalties from earlier races are applied in the Grand Prix qualifying
function applyCarriedGridPenalties(s, type) {
  if (type !== "Q") return;
  for (const car of race.cars) {
    const d = s.drivers[car.code];
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
  const round = s.calendar.find(r => r.round === roundNumber);
  const setup = await buildSeasonSetup(s, round, type, options, status);
  saveSeason(s); // the attempt counter

  createRace(setup);
  applyCarriedGridPenalties(s, type);
  $("seasonScreen").hidden = true;
  $("seasonRcBtn").hidden = false;
  const info = circuitInfo(round.circuit);
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

  // qualifying abandoned before the first segment was completed: no result, the stewards set the grid
  if (r.session === "QUALI" && r.abandoned && r.abandoned.completed === 0) {
    result.status = "CANCELLED";
    result.rows = [];
    return result;
  }

  if (r.session === "QUALI") {
    const rows = qualiResults();
    result.rows = rows.map(row => ({
      id: row.car.code, team: row.car.teamId || teamOfDriver(s, row.car.code), pos: row.car.dsq ? null : Number(row.position) || null,
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
    if (!fastest || row.car.bestLap.time < fastest.time) fastest = { id: row.car.code, time: row.car.bestLap.time };
  }
  result.fastestLap = fastest;

  result.rows = rows.map(row => {
    const classified = row.position !== "DNF" && row.position !== "DSQ";
    const pos = classified ? parseInt(row.position, 10) : null;
    let points = pos && pos <= table.length ? table[pos - 1] : 0;
    const fl = !sprint && rules.fastestLapPoint && fastest && fastest.id === row.car.code && pos && pos <= 10 && table.length >= 10;
    if (fl) points += 1;
    return {
      id: row.car.code, team: row.car.teamId || teamOfDriver(s, row.car.code), pos, status: row.status === "Running" ? "OK" : row.status === "Finished" ? "OK" : row.status,
      laps: row.laps, gap: row.gapText, penalty: row.penalty, grid: row.car.grid, best: row.car.bestLap ? row.car.bestLap.time : null,
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
function finishSeasonSession() {
  const r = race;
  const ctx = r.setup.seasonContext;
  if (!season || season.id !== ctx.seasonId) {
    if (!loadSeason(ctx.seasonId)) {
      showToast("The championship could not be found.");
      return;
    }
  }
  if (!r.finished && !confirm("The session is not finished yet. Save the current (provisional) classification anyway?")) return;
  const pending = r.incidents.filter(i => !["DECIDED", "NFI"].includes(i.status));
  if (pending.length && !confirm(pending.length + " incident(s) are still undecided. They will be closed with no further action. Save anyway?")) return;
  const roundNumber = commitSeasonSession();
  leaveControlRoom(roundNumber);
}

// Store the result of the session in the season (live and auto-simulated)
function commitSeasonSession() {
  const r = race;
  const ctx = r.setup.seasonContext;
  const s = season;
  const round = s.calendar.find(x => x.round === ctx.round);
  const result = sessionResultFromRace();
  round.sessions[ctx.type] = result;

  // penalty points, reprimands and grid penalties carry over to the next events
  const notes = [];
  for (const car of r.cars) {
    const d = s.drivers[car.code];
    if (!d) continue;
    if (car.pen.points) {
      d.penaltyPoints += car.pen.points;
      notes.push(car.code + " +" + car.pen.points + " penalty points (" + d.penaltyPoints + " total)");
    }
    if (car.pen.reprimands) {
      d.reprimands += car.pen.reprimands;
      notes.push(car.code + " reprimand (" + d.reprimands + " this season)");
      if (d.reprimands >= s.rules.reprimandsGridDrop && d.reprimands - car.pen.reprimands < s.rules.reprimandsGridDrop) {
        d.carryGrid += 10;
        notes.push(car.code + " reached " + s.rules.reprimandsGridDrop + " reprimands: 10-place grid penalty");
      }
    }
    if (ctx.type === "Q") {
      if (result.status === "DONE") {
        d.carryGrid = 0; // applied in this qualifying
        d.carryBack = false;
      }
    } else if (r.session === "RACE" && car.pen.grid) {
      d.carryGrid += car.pen.grid;
      notes.push(car.code + " " + car.pen.grid + "-place grid penalty for the next Grand Prix");
    }
  }

  const info = circuitInfo(round.circuit);
  let summary = (ctx.type === "RACE" ? "" : SESSION_NAMES[ctx.type] + " · ") + info.gp + ": ";
  if (result.status === "CANCELLED") summary += "abandoned before the first segment was completed – the grid follows the championship order";
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
let autoSimCancel = false;

async function autoSimulateSession(roundNumber, type, options, progress) {
  const s = season;
  const round = s.calendar.find(r => r.round === roundNumber);
  const setup = await buildSeasonSetup(s, round, type, options, text => progress(0, text));
  setup.seasonContext.auto = true;
  // the AI FIA declares a heat hazard when the forecast is hot enough
  if (!round.heatDeclared && heatForecast(s, round) >= s.rules.heatHazard) {
    round.heatDeclared = true;
    setup.heat.declared = true;
    s.log.push({ date: new Date().toISOString(), round: round.round, text: "Heat hazard declared for the " + circuitInfo(round.circuit).gp + " (AI FIA)." });
  }
  saveSeason(s);

  createRace(setup);
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
        if (autoSimCancel) {
          reject(new Error("cancelled"));
          return;
        }
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
async function autoSimulate(scope, options, progress) {
  autoSimCancel = false;
  const first = nextSession(season);
  if (!first) return 0;
  let count = 0;
  while (true) {
    const next = nextSession(season);
    if (!next) break;
    if (scope === "WEEKEND" && next.round !== first.round) break;
    if (scope === "SESSION" && count === 1) break;
    const label = "Round " + next.round.round + " · " + circuitInfo(next.round.circuit).gp + " · ";
    await autoSimulateSession(next.round.round, next.type, options, (share, text) => progress(share, label + text));
    count++;
  }
  return count;
}

// Back from Race Control to the championship (without saving: the session stays open)
function abandonSeasonSession() {
  if (!confirm("Leave Race Control? The session is not saved and can be run again.")) return;
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
function computeStandings(s) {
  const drivers = {};
  const teams = {};
  const driverRow = id => drivers[id] || (drivers[id] = { id, points: 0, wins: 0, podiums: 0, poles: 0, fastest: 0, dnf: 0, starts: 0, counts: [], best: 99, team: teamOfDriver(s, id) });
  const teamRow = id => teams[id] || (teams[id] = { id, points: 0, wins: 0, podiums: 0, counts: [], best: 99 });

  for (const round of s.calendar) {
    for (const type of ["SPRINT", "RACE"]) {
      const res = round.sessions[type];
      if (!res || res.status !== "DONE") continue;
      for (const row of res.rows) {
        const d = driverRow(row.id);
        const t = row.team ? teamRow(row.team) : null;
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
  return {
    drivers: Object.values(drivers).sort(compare),
    teams: Object.values(teams).sort(compare)
  };
}
