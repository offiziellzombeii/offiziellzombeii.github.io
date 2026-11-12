// =====================================================================
//  season-practice.js
//  Free practice of the championship weekends (FP1 – FP3)
//  Practice is directed live (qualifying.js in practice mode) or simulated in an instant:
//  - time sheet: best laps and laps run, depending on the running time
//    (red flags, technical problems, rain from the weekend weather)
//  - long-run pace and tyre wear per compound, more precise the more
//    dry laps were run
//  - setup confidence of every driver: the dry laps of the weekend.
//    It counts in qualifying and the race (±0.3 % pace, consistency),
//    and little dry running makes the race strategies less accurate
//  - the rookie rule: every team must run a rookie in FP1 twice a season
//  - offences in practice (pit lane speeding, unsafe release): fines by
//    the stewards
//  Normal weekend: FP1, FP2, FP3 · sprint weekend: FP1 only.
// =====================================================================

const PRACTICE_TYPES = ["FP1", "FP2", "FP3"];

function isPractice(type) {
  return PRACTICE_TYPES.includes(type);
}

function practiceSessions(round) {
  if (round.practice === false) return []; // older saves: weekends without practice
  return round.sprint ? ["FP1"] : ["FP1", "FP2", "FP3"];
}

// Setup confidence of a driver at this weekend (0 ... 1), null = no practice at this weekend
function practiceConfidence(s, round, driverId) {
  const types = practiceSessions(round);
  if (!types.length) return null;
  let dry = 0;
  for (const t of types) {
    const res = round.sessions[t];
    if (!res || res.status !== "DONE") continue;
    const row = res.rows.find(x => x.id === driverId);
    if (row) dry += row.dryLaps || 0;
  }
  return clamp(dry / (round.sprint ? PRACTICE_TARGET_LAPS_SPRINT : PRACTICE_TARGET_LAPS), 0, 1);
}

// What practice changes in qualifying and the race (called by buildSeasonSetup)
function applyPracticeToEntries(s, round, type, entries, laps) {
  for (const e of entries) {
    const c = practiceConfidence(s, round, e.driverId);
    if (c === null) continue;
    // a well set-up car: up to 0.3 % faster, a car without running: up to 0.3 % slower
    e.pace *= 1 + (c - 0.5) * 0.006;
    e.consistency = clamp(e.consistency + (c - 0.5) * 0.06, 0.5, 0.97);
    // little dry running: the tyre wear is a guess – the pit stops are less well placed
    if (type === "RACE" && c < 0.6 && e.plan && e.plan.length) {
      const spread = (0.6 - c) * 0.25 * laps;
      for (const stop of e.plan) stop.lap = clamp(Math.round(stop.lap + (random() * 2 - 1) * spread), 3, Math.max(4, laps - 3));
      e.plan.sort((a, b) => a.lap - b.lap);
    }
  }
}

// ---------- Tyre sets of a weekend ----------
// Every driver gets a fixed allocation of dry tyre sets per weekend (since 2023: 13 sets,
// a sprint weekend 12). Practice uses sets, and every qualifying run wants a NEW soft set –
// a run on a used set is slower. Skipping practice saves tyres (but costs setup work).

// round.tyres[driverId] = { SOFT: new sets left, MEDIUM, HARD, used: { SOFT, MEDIUM, HARD } }
function driverTyres(s, round, driverId) {
  round.tyres = round.tyres || {};
  if (!round.tyres[driverId]) {
    const a = TYRE_ALLOCATION[round.sprint ? "sprint" : "normal"];
    round.tyres[driverId] = { SOFT: a.SOFT, MEDIUM: a.MEDIUM, HARD: a.HARD, used: { SOFT: 0, MEDIUM: 0, HARD: 0 } };
  }
  return round.tyres[driverId];
}

// n new sets of a compound are used (wet tyres are not counted)
function useTyreSets(s, round, driverId, compound, n) {
  if (!["SOFT", "MEDIUM", "HARD"].includes(compound) || !(n > 0)) return;
  const t = driverTyres(s, round, driverId);
  const take = Math.min(n, t[compound]);
  t[compound] -= take;
  t.used[compound] += take;
}

// The sets a team uses in a simulated practice session (dry): long runs on the harder
// tyres, short runs on softs – FP3 is the qualifying preparation

// the race driver's sets (a rookie drives the same car and uses the same allocation)
function practiceTyreUse(s, round, type, rows, wetShare) {
  if (wetShare > 0.6) return; // a wet session: intermediates and wets only
  const plan = PRACTICE_SETS[round.sprint ? "SPRINT_FP1" : type] || {};
  for (const row of rows) {
    if (row.satOut || !(row.laps > 3)) continue;
    const driverId = row.rookie ? (s.teams.find(t => t.id === row.team) || { drivers: [] }).drivers[1] : row.id;
    if (!driverId) continue;
    // one medium and one hard set stay new for the race (the rules)
    const t = driverTyres(s, round, driverId);
    for (const c in plan) useTyreSets(s, round, driverId, c, Math.min(plan[c], c === "SOFT" ? plan[c] : Math.max(0, t[c] - 1)));
  }
}

// a short text for the hub: "Soft 4 new · Medium 3 · Hard 2"
function tyreText(s, round, driverId) {
  const t = driverTyres(s, round, driverId);
  return "S " + t.SOFT + " · M " + t.MEDIUM + " · H " + t.HARD;
}

// ---------- The junior drivers (rookies) ----------
// Every team has one invented junior driver per season (the same all season, editable in
// "Teams & cars"). Names are made from small lists per nationality.
const JUNIOR_NAMES = {
  GBR: [["Oliver", "Harry", "Jack", "Thomas", "Callum", "Freddie"], ["Ashworth", "Pembroke", "Hallam", "Whitlock", "Carver", "Mansell-Price"]],
  ITA: [["Luca", "Matteo", "Andrea", "Lorenzo", "Davide", "Pietro"], ["Ferrandi", "Castellini", "Moretto", "Bianconi", "Galluzzo", "Rinaldi"]],
  FRA: [["Théo", "Hugo", "Louis", "Maxime", "Arthur", "Jules"], ["Delacroix", "Marchand", "Rouvière", "Lefèvre", "Garnier", "Dumont"]],
  GER: [["Lukas", "Jonas", "Felix", "Niklas", "Moritz", "Paul"], ["Brandauer", "Kessler", "Hofmann", "Lindner", "Vogt", "Steiner"]],
  ESP: [["Pablo", "Álvaro", "Diego", "Marcos", "Adrián", "Iker"], ["Navarro", "Echeverría", "Castaño", "Robles", "Herrera", "Valdés"]],
  NED: [["Daan", "Sem", "Bram", "Lars", "Thijs", "Ruben"], ["van Dijkhuis", "de Wolff", "Verhoeven", "Bakker", "van Leent", "Hoekstra"]],
  BRA: [["Gabriel", "Rafael", "Enzo", "Caio", "Thiago", "Bruno"], ["Moraes", "Barreto", "Cardoso", "Ribeiro", "Teixeira", "Fonseca"]],
  JPN: [["Haruto", "Ren", "Sota", "Yuto", "Kaito", "Riku"], ["Takeda", "Morimoto", "Fujisaki", "Kanemura", "Shibata", "Arakawa"]],
  AUS: [["Liam", "Cooper", "Mason", "Lachlan", "Hunter", "Riley"], ["Brennan", "Gallagher", "McAllister", "Thorpe", "Kingsley", "Doyle"]],
  USA: [["Tyler", "Logan", "Carter", "Austin", "Brody", "Chase"], ["Whitfield", "Donovan", "Brooks", "Callahan", "Mercer", "Hartley"]],
  DEN: [["Magnus", "Emil", "Oskar", "Frederik", "Anton", "Viktor"], ["Lindholm", "Kjær", "Østergaard", "Bech", "Rasmussen", "Holm"]],
  FIN: [["Eetu", "Aleksi", "Joona", "Veeti", "Onni", "Lauri"], ["Koskinen", "Lehtola", "Mäkelä", "Rantanen", "Hiltunen", "Vainio"]],
  MEX: [["Santiago", "Emiliano", "Mateo", "Rodrigo", "Sebastián", "Andrés"], ["Ortega", "Villaseñor", "Cárdenas", "Ibarra", "Montoya", "Salazar"]],
  CHN: [["Hao", "Jun", "Wei", "Yichen", "Zihan", "Ming"], ["Zhang", "Liu", "Chen", "Wang", "Zhao", "Lin"]],
  CAN: [["Nathan", "Owen", "Félix", "Ethan", "Samuel", "William"], ["Tremblay", "Gagnon", "MacLeod", "Bouchard", "Fraser", "Lavoie"]],
  ARG: [["Tomás", "Valentino", "Joaquín", "Bautista", "Franco", "Lautaro"], ["Pereyra", "Giménez", "Acosta", "Benítez", "Sosa", "Ledesma"]],
  NZL: [["Finn", "Jayden", "Ryan", "Blake", "Isaac", "Nico"], ["Paterson", "Whitmore", "Kerr", "Lockwood", "Bannister", "Reid"]],
  BEL: [["Arnaud", "Victor", "Lucas", "Tibo", "Wout", "Robin"], ["Peeters", "Vandamme", "Dewulf", "Lambrecht", "Verbeke", "Claes"]],
  SUI: [["Noah", "Loris", "Gian", "Nils", "Fabio", "Yannick"], ["Brunner", "Gerber", "Bachmann", "Zürcher", "Imhof", "Rüegg"]],
  AUT: [["Florian", "Tobias", "Elias", "Simon", "Maximilian", "Jakob"], ["Pichler", "Gruber", "Moser", "Wallner", "Hager", "Egger"]]
};

function seasonJunior(s, team) {
  s.juniors = s.juniors || {};
  if (s.juniors[team.id]) return s.juniors[team.id];
  const rnd = makeRandom(hashText(s.id + "/junior/" + team.id) % 1000000 + 17);
  const pick = list => list[Math.floor(rnd() * list.length)];
  const usedLast = new Set(Object.values(s.drivers).map(d => plainDriverName(d.last)).concat(Object.values(s.juniors).map(j => plainDriverName(j.last))));
  let country, first, last;
  for (let tries = 0; tries < 40; tries++) {
    country = pick(Object.keys(JUNIOR_NAMES));
    first = pick(JUNIOR_NAMES[country][0]);
    last = pick(JUNIOR_NAMES[country][1]);
    if (!usedLast.has(plainDriverName(last))) break;
  }
  const j = { first, last, country };
  j.code = juniorCode(s, last);
  s.juniors[team.id] = j;
  return j;
}

function plainDriverName(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Three letters from the surname, different from every driver and junior of the season
function juniorCode(s, last, own) {
  const used = new Set(Object.values(s.drivers).map(d => d.code).concat(Object.values(s.juniors || {}).filter(j => j !== own).map(j => j.code)));
  const letters = plainDriverName(last).replace(/^(van|de|di|da|le|la)\s+/, "").replace(/[^a-z]/g, "").toUpperCase();
  const options = [letters.slice(0, 3)];
  for (let i = 3; i < letters.length; i++) options.push(letters.slice(0, 2) + letters[i]);
  for (let i = 0; i < 26; i++) options.push(letters.slice(0, 2) + String.fromCharCode(65 + i));
  return options.find(c => c.length === 3 && !used.has(c)) || "JNR";
}

function juniorName(s, teamId) {
  const team = s.teams.find(t => t.id === teamId);
  if (!team) return teamId + " junior driver";
  const j = seasonJunior(s, team);
  return j.first + " " + j.last;
}

// ---------- The rookie rule ----------
function rookieCount(s, teamId) {
  return ((s.rookieRuns || {})[teamId] || 0);
}

// The AI team decides: a rookie in this FP1? (so that the two runs are done by the end of the season)
function teamRunsRookie(s, round, team, rnd) {
  const needed = ROOKIE_FP1_PER_SEASON - rookieCount(s, team.id);
  if (needed <= 0) return false;
  const left = s.calendar.filter(r => r.round >= round.round && r.status !== "CANCELLED" && practiceSessions(r).length &&
    !(r.sessions.FP1 && r.sessions.FP1.status === "DONE")).length;
  if (left <= needed) return true;
  return rnd() < needed / left;
}

// ---------- One practice session ----------
async function runPracticeSession(roundNumber, type, status) {
  const s = season;
  const round = s.calendar.find(r => r.round === roundNumber);
  ensureRatings(s);
  let track;
  try {
    track = await loadSeasonTrack(round.circuit, s.zones[round.circuit], status);
  } catch (error) {
    error.trackProblem = round.circuit;
    throw error;
  }
  prepareWeekend(s, round); // the teams arrive at the circuit
  ensureWeekendNotes(s, round, track); // the event notes exist before FP1 (the standard ones if none were published)
  round.sessions[type] = simulatePractice(s, round, type, track);
  const res = round.sessions[type];
  const info = roundInfo(round);
  const top = res.rows.find(x => x.best);
  s.log.push({ date: new Date().toISOString(), round: round.round, text: SESSION_NAMES[type] + " · " + info.gp + ": " +
    (top ? "fastest " + seasonDriverName(top.id) + " " + formatLapTime(top.best) : "no time set") +
    (res.weather !== "dry" ? " (" + res.weather + ")" : "") + (res.redFlags ? " · " + res.redFlags + " red flag" + (res.redFlags > 1 ? "s" : "") : "") +
    (res.notes.length ? " · " + res.notes.join(" · ") : "") });
  if (s.phase === "PRESEASON") s.phase = "SEASON";
  saveSeason(s);
}

function simulatePractice(s, round, type, track) {
  const rnd = makeRandom(hashText(s.id + "/fp/" + roundSeed(round) + "/" + type) % 1000000 + 31);
  const ch = roundInfo(round).character || {};
  const entries = seasonEntries(s, roundSeed(round), round.circuit).filter(e => !bannedFromEvents(s, "TEAM", e.teamId, round.round));

  // weather during the hour (weekend weather, weather.js)
  const W = roundWeather(s, round);
  const start = roundSchedule(s, round)[type];
  let wetSamples = 0;
  for (let m = 0; m < PRACTICE_MINUTES; m += 10) if (weatherConditions(W, start + m * 60).rain > 0.12) wetSamples++;
  const wetShare = wetSamples / (PRACTICE_MINUTES / 10);

  // red flags: crashes stop the session (more on street circuits)
  let redFlags = 0;
  if (rnd() < 0.22 + 0.3 * (ch.street || 0)) redFlags++;
  if (rnd() < 0.06 + 0.1 * (ch.street || 0)) redFlags++;
  let minutes = PRACTICE_MINUTES;
  for (let k = 0; k < redFlags; k++) minutes -= 6 + Math.round(rnd() * 8);

  // lap time: the ideal lap of the circuit (speed profile), like the simulation of a session
  let ideal = 0;
  for (const v of track.profile) ideal += track.ds / Math.max(5, v);
  // the track gets faster, the teams turn the engines up: FP3 ≈ 0.5 % off the pole time
  const progress = { FP1: 1.01, FP2: 1.004, FP3: 1.0 }[type];
  // rubber on the track (engine.js RUBBER_*): a rain-washed track is slower than usual
  const rubberStart = (round.rubber !== undefined ? round.rubber : RUBBER_START) * (1 - 0.7 * (wetShare > 0 && weatherConditions(W, start).rain > 0.12 ? 1 : 0));
  const rubberPace = 1 - RUBBER_PACE * (rubberStart - RUBBER_EXPECTED[type]);
  // ~500 laps of all cars in the hour lay down rubber; the rain washes it off again
  round.rubber = Math.round((1 - (1 - rubberStart) * Math.exp(-0.3 * (1 - wetShare))) * (1 - 0.6 * wetShare) * 1000) / 1000;
  const baseLap = ideal * 1.007 * progress * (1 + 0.1 * wetShare) * rubberPace;
  const bestPace = Math.max(...entries.map(e => e.pace));

  const rows = [];
  const notes = [];
  for (const e of entries) {
    const team = s.teams.find(t => t.id === e.teamId);
    // FP1: the second car may be driven by a rookie (the race driver sits out)
    let id = e.driverId;
    let name = null;
    let rookie = false;
    if (type === "FP1" && team && team.drivers[1] === e.driverId && teamRunsRookie(s, round, team, rnd)) {
      if (wetShare > 0.6) {
        notes.push(team.name + " kept the race driver in the car (wet track) – rookie run postponed");
      } else {
        rookie = true;
        id = team.id + "-junior";
        name = juniorName(s, team.id);
        s.rookieRuns = s.rookieRuns || {};
        s.rookieRuns[team.id] = rookieCount(s, team.id) + 1;
      }
    }
    // laps: about 20–30 in an hour, less with red flags, problems and rain
    let laps = Math.round(minutes / PRACTICE_MINUTES * (20 + rnd() * 10) * (1 - 0.45 * wetShare));
    let problem = null;
    if (rnd() < 0.035 * (e.failureScale || 1)) {
      const lost = 0.3 + rnd() * 0.7;
      laps = Math.round(laps * (1 - lost));
      problem = ["gearbox", "hydraulics", "power unit", "brakes", "electronics"][Math.floor(rnd() * 5)] + " problem";
    }
    const dryLaps = Math.round(laps * (1 - wetShare));
    const best = laps > 0
      ? baseLap * (bestPace / e.pace) * (1 + (rnd() - 0.5) * 0.006 + (laps < 6 ? 0.01 : 0) + (rookie ? 0.008 : 0))
      : null;
    // a long run on high fuel: race pace, tyre management counts
    const longRun = dryLaps >= 10 ? best * (1.045 + (1 - e.tyreMgmt) * 0.012 + (rnd() - 0.5) * 0.004) : null;
    rows.push({ id, name, team: e.teamId, rookie, best, laps, dryLaps: rookie ? 0 : dryLaps, longRun, problem });
    if (rookie) rows.push({ id: e.driverId, team: e.teamId, best: null, laps: 0, dryLaps: 0, longRun: null, problem: null, satOut: true });
  }
  rows.sort((a, b) => (a.best || 9999) - (b.best || 9999));

  // tyre wear per compound: the teams' estimate – more precise with more long-run laps
  const longRunLaps = rows.reduce((a, r) => a + (r.longRun ? r.dryLaps : 0), 0);
  const tyreData = practiceTyreData(ch, longRunLaps, rnd);

  // offences in practice: the stewards fine the teams
  const running = rows.filter(r => r.laps > 0 && !r.satOut);
  if (running.length && rnd() < 0.3) {
    const r = running[Math.floor(rnd() * running.length)];
    const over = 2 + Math.floor(rnd() * 12);
    notes.push((r.name || seasonDriverName(r.id)) + " fined €" + (over * 100).toLocaleString("en") + " for speeding in the pit lane (+" + over + " km/h)");
  }
  if (running.length && rnd() < 0.12) {
    const r = running[Math.floor(rnd() * running.length)];
    const team = s.teams.find(t => t.id === r.team);
    notes.push((team ? team.name : r.team) + " fined €5,000 for an unsafe release");
  }
  for (const r of rows) if (r.problem) notes.push((r.name || seasonDriverName(r.id)) + ": " + r.problem);

  practiceTyreUse(s, round, type, rows, wetShare); // the tyre sets of the weekend

  return {
    status: "DONE", practice: true, auto: true, rows,
    weather: wetShare > 0.5 ? "wet" : wetShare > 0 ? "mixed" : "dry",
    wetShare, redFlags, minutes,
    longRuns: rows.filter(r => r.longRun).sort((a, b) => a.longRun - b.longRun).map(r => ({ id: r.id, name: r.name, time: r.longRun })),
    tyreData, notes
  };
}

// The teams' estimate of the tyre wear (seconds per lap): more precise with more long-run laps
function practiceTyreData(ch, longRunLaps, rnd) {
  if (!(longRunLaps > 0)) return null;
  const tyres = ch && ch.tyres !== undefined ? ch.tyres : 0.6;
  const error = 1 + (rnd() - 0.5) * Math.min(0.6, 6 / Math.max(1, Math.sqrt(longRunLaps)));
  return {
    SOFT: Math.round((0.1 + 0.12 * tyres) * error * 1000) / 1000,
    MEDIUM: Math.round((0.06 + 0.08 * tyres) * error * 1000) / 1000,
    HARD: Math.round((0.04 + 0.05 * tyres) * error * 1000) / 1000,
    laps: longRunLaps
  };
}

// ---------- Free practice directed live (Race Control, qualifying.js practice mode) ----------
// FP1: the AI teams decide about their rookie runs before the session. The rookie drives the
// second car (same number, a bit slower). Counted for the rookie rule when the session is saved.
function practiceRookieEntries(s, round, type, entries, wet) {
  if (type !== "FP1") return [];
  const rnd = makeRandom(hashText(s.id + "/fp-live/" + roundSeed(round)) % 1000000 + 31);
  const out = [];
  for (const team of s.teams) {
    const e = entries.find(x => x.teamId === team.id && x.driverId === team.drivers[1]);
    if (!e || !teamRunsRookie(s, round, team, rnd)) continue;
    if (wet > 0.6) {
      // no rookie run on a wet track – noted, so the rookie rule audit can excuse the team
      out.push({ team: team.id, skipped: true });
      continue;
    }
    const id = team.id + "-junior";
    out.push({ team: team.id, id, replaced: e.driverId });
    const junior = seasonJunior(s, team);
    e.driverId = id;
    e.code = junior.code;
    e.name = junior.first + " " + junior.last;
    e.headshot = null;
    e.pace *= 0.992;
    e.consistency = clamp(e.consistency - 0.05, 0.5, 0.97);
  }
  return out;
}

// The result of a live practice session, in the same form as simulatePractice()
function practiceResultFromRace(r, ctx, wetSeen) {
  const s = season;
  const round = s.calendar.find(x => x.round === ctx.round);
  const rookies = (ctx.rookies || []).filter(x => !x.skipped);
  const rows = r.cars.map(car => {
    const rookie = rookies.find(x => x.id === car.driverId);
    const timed = car.lapTimes.filter(l => l.type === "PUSH" && l.valid && !l.aborted);
    const dry = car.lapTimes.filter(l => l.compound !== "INTERMEDIATE" && l.compound !== "WET").length;
    // long run: the best average of a run with at least 6 timed laps (without its first lap)
    const byRun = {};
    for (const l of timed) (byRun[l.run] = byRun[l.run] || []).push(l.time);
    let longRun = null;
    for (const k in byRun) {
      const laps = byRun[k];
      if (laps.length < 6) continue;
      const avg = laps.slice(1).reduce((a, b) => a + b, 0) / (laps.length - 1);
      if (longRun === null || avg < longRun) longRun = avg;
    }
    return {
      id: car.driverId, name: rookie ? car.name : null, team: car.teamId, rookie: !!rookie,
      best: car.bestLap ? car.bestLap.time : null, laps: car.laps, dryLaps: rookie ? 0 : dry, longRun,
      problem: car.status === "RETIRED" || car.dsq ? (car.retireReason || "stopped") : null
    };
  });
  for (const x of rookies) rows.push({ id: x.replaced, team: x.team, best: null, laps: 0, dryLaps: 0, longRun: null, problem: null, satOut: true });
  rows.sort((a, b) => (a.best || 9999) - (b.best || 9999));
  const longRunLaps = rows.reduce((a, row) => a + (row.longRun ? row.dryLaps : 0), 0);
  const rnd = makeRandom(hashText(s.id + "/fp-tyres/" + roundSeed(round) + "/" + ctx.type) % 1000000 + 3);
  const notes = (ctx.rookies || []).filter(x => x.skipped).map(x => (seasonTeam(x.team) || { name: x.team }).name + " kept the race driver in the car (wet track) – rookie run postponed")
    .concat(rows.filter(row => row.problem).map(row => (row.name || seasonDriverName(row.id)) + ": " + row.problem));
  return {
    practice: true, live: true, rows,
    weather: wetSeen < 0.05 ? "dry" : wetSeen < 0.3 ? "damp patches" : "wet",
    wetShare: clamp(wetSeen, 0, 1),
    minutes: Math.round(r.q.elapsed / 60),
    planned: Math.round(r.q.durations[0] / 60),
    longRuns: rows.filter(row => row.longRun).sort((a, b) => a.longRun - b.longRun).map(row => ({ id: row.id, name: row.name, time: row.longRun })),
    tyreData: practiceTyreData(roundInfo(round).character, longRunLaps, rnd),
    notes
  };
}

// ---------- End of the season: the rookie rule ----------
function rookieRuleAudit(s) {
  const fp1Run = s.calendar.filter(r => r.sessions.FP1 && r.sessions.FP1.status === "DONE").length;
  if (!fp1Run) return; // a season without practice
  const fp1Cancelled = s.calendar.filter(r => practiceSessions(r).includes("FP1") && (r.status === "CANCELLED" || (r.sessions.FP1 && r.sessions.FP1.status === "CANCELLED"))).length;
  for (const t of s.teams) {
    const runs = rookieCount(s, t.id);
    if (runs >= ROOKIE_FP1_PER_SEASON) continue;
    // a team excluded and banned by the FIA could not run any more
    if (activeExclusions(s).some(x => x.kind === "TEAM" && x.target === t.id && x.banned)) continue;
    // a team that could not do it (FP1 sessions cancelled, rookie runs postponed in the rain) should not be punished
    const postponed = s.calendar.filter(r => r.sessions.FP1 && (r.sessions.FP1.notes || []).some(n => n.startsWith(t.name + " kept the race driver"))).length;
    const excused = fp1Cancelled + postponed >= ROOKIE_FP1_PER_SEASON - runs;
    addDeskItem(s, {
      round: null, type: "ROOKIE", status: "PENDING",
      title: "Rookie rule: " + t.name + " – " + runs + " of " + ROOKIE_FP1_PER_SEASON + " FP1 sessions with a rookie",
      text: "The regulations require every team to give a rookie driver at least " + ROOKIE_FP1_PER_SEASON + " FP1 sessions per season. " +
        t.name + " ran a rookie in " + runs + ". " +
        (fp1Cancelled ? fp1Cancelled + " FP1 session(s) of the season were cancelled. " : "") +
        (postponed ? "The team postponed " + postponed + " planned rookie run(s) because of a wet track. " : "No session of the team was cancelled or wet."),
      options: [{ key: "FINE", label: "Fine the team (€ 100,000)", danger: true }, { key: "WAIVE", label: "Waive it (circumstances beyond the team's control)" }],
      data: { team: t.id, runs, excused }
    });
  }
}
