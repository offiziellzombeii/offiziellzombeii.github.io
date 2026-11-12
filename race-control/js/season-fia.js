// =====================================================================
//  season-fia.js
//  The FIA desk – the decisions of the FIA away from the race track:
//  1. Desk items: information and decisions waiting for the FIA
//  2. Protests of the teams and reports of the technical delegate
//     (decided by the FIA: dismiss, or disqualify -> the results change)
//  3. Driver nominations: superlicence and entry list
//  4. The cost cap audit after the season
//  5. The season review and the next season
//  6. Exclusion of a driver or a team from the championship
// =====================================================================

// ---------- 1. Desk items ----------
// { id, round, type, status: "INFO" | "PENDING" | "DONE", title, text, options: [{ key, label, danger }], data, decision }
function addDeskItem(s, item) {
  s.inbox = s.inbox || [];
  s.deskSeq = (s.deskSeq || 0) + 1;
  item.id = s.deskSeq;
  item.date = new Date().toISOString();
  s.inbox.push(item);
  return item;
}

function pendingDeskItems(s) {
  return (s.inbox || []).filter(x => x.status === "PENDING");
}


// ---------- 2. Protests and technical reports ----------
const PROTEST_SUBJECTS = [
  { key: "FLOOR", name: "the flexibility of the floor", test: "load test of the floor", unit: "mm deflection", limit: 8 },
  { key: "WING", name: "the flexibility of the rear wing", test: "rear wing load test", unit: "mm deflection", limit: 5 },
  { key: "FUEL", name: "the fuel flow", test: "analysis of the fuel flow data", unit: "kg/h peak", limit: 100 },
  { key: "PARC", name: "work on the car under parc fermé", test: "review of the parc fermé logs", unit: "", limit: 0 }
];

// only when the event notes announced tyre pressure checks
const TYRE_PRESSURE_CHECK = { key: "PRESSURE", text: "the tyre pressures were below the minimum prescribed by the tyre supplier",
  measure: () => pick(["front-left", "front-right", "rear-left", "rear-right"]) + " tyre " + rand(0.2, 0.9).toFixed(1) + " psi below the minimum" };
const TECH_CHECKS = [
  { key: "PLANK", text: "the skid block (plank) is worn below the minimum thickness of 9 mm", measure: () => "8." + Math.floor(rand(1, 9)) + " mm measured at the rear" },
  { key: "WEIGHT", text: "the car is below the minimum weight after the race", measure: () => "under the limit by " + rand(0.2, 1.4).toFixed(1) + " kg" },
  { key: "FUEL", text: "a fuel sample of less than 1 litre could be taken", measure: () => rand(0.4, 0.9).toFixed(2) + " litres in the tank" }
];

// After every Grand Prix: maybe a protest and a scrutineering report
function fiaDeskAfterRace(s, round, result) {
  if (!result || !result.rows) return;
  const rnd = makeRandom(hashText(s.id + "/desk/" + roundSeed(round)) % 1000000 + 21);
  const info = roundInfo(round);
  const classified = result.rows.filter(r => r.pos);

  // a team protests the legality of a car that finished ahead of it (~12 % of the races)
  if (rnd() < 0.12 && classified.length > 6) {
    const target = classified[Math.floor(rnd() * 4)];
    const protester = classified.filter(r => r.team !== target.team && r.pos > target.pos)[Math.floor(rnd() * 3)];
    if (protester) {
      const subject = PROTEST_SUBJECTS[Math.floor(rnd() * PROTEST_SUBJECTS.length)];
      const guilty = rnd() < 0.25;
      // the technical delegate's report: usually clear, sometimes at the limit
      const clear = rnd() < 0.75;
      let finding;
      if (subject.key === "PARC") {
        finding = guilty ? (clear ? "The logs show that a setup part was changed after qualifying without permission." : "The logs show a repair; it is unclear whether the part was replaced like-for-like.")
                         : (clear ? "All work on the car was authorised by the technical delegate." : "A repair was made; the replaced part appears to be identical.");
      } else {
        const ratio = guilty ? (clear ? rand(1.05, 1.25) : rand(0.99, 1.02)) : (clear ? rand(0.7, 0.93) : rand(0.97, 1.0));
        finding = "Result of the " + subject.test + ": " + (subject.limit * ratio).toFixed(1) + " " + subject.unit + " (limit " + subject.limit + ").";
      }
      const tTeam = seasonTeam(target.team);
      const pTeam = seasonTeam(protester.team);
      addDeskItem(s, {
        round: round.round, type: "PROTEST", status: "PENDING",
        title: "Protest: " + pTeam.name + " v " + tTeam.name,
        text: pTeam.name + " protest " + subject.name + " of the " + tTeam.name + " cars after the " + info.gp + ". " + finding,
        options: [{ key: "DISMISS", label: "Dismiss the protest" }, { key: "DSQ", label: "Uphold – disqualify both " + tTeam.name + " cars", danger: true }],
        data: { roundNumber: round.round, team: target.team, drivers: classified.filter(r => r.team === target.team).map(r => r.id), guilty, subject: subject.key }
      });
      // the protest and the technical delegate's report are documents of the weekend
      publishNotice(s, round.round, { session: "RACE", title: "Protest – " + pTeam.name + " against " + tTeam.name, from: pTeam.name, to: "The Stewards", sign: "Lodged with the Stewards",
        body: pTeam.name + " protest " + subject.name + " of the " + tTeam.name + " cars.",
        lines: [["Cars concerned", classified.filter(r => r.team === target.team).map(r => seasonDriverName(r.id)).join(", ")], ["Report of the Technical Delegate", finding]] });
    }
  }

  // the technical delegate finds an irregularity at a car in the top 10 (~6 % of the races;
  // more when the event notes announced tyre pressure checks)
  const pressureChecks = !!round.tyreChecks;
  if (rnd() < (pressureChecks ? 0.14 : 0.06) && classified.length > 3) {
    const row = classified[Math.floor(rnd() * Math.min(10, classified.length))];
    const check = pressureChecks && rnd() < 0.6 ? TYRE_PRESSURE_CHECK : TECH_CHECKS[Math.floor(rnd() * TECH_CHECKS.length)];
    const measured = check.measure();
    addDeskItem(s, {
      round: round.round, type: "TECHNICAL", status: "PENDING",
      title: "Technical delegate: " + seasonDriverName(row.id),
      text: "After the " + info.gp + " the technical delegate reports that on the car of " + seasonDriverName(row.id) + " (P" + row.pos + ") " +
        check.text + ": " + measured + ". The rule is absolute – there is no tolerance.",
      options: [{ key: "DSQ", label: "Disqualify " + seasonDriverName(row.id), danger: true }, { key: "NFA", label: "No further action" }],
      data: { roundNumber: round.round, drivers: [row.id], guilty: true }
    });
    publishNotice(s, round.round, { session: "RACE", title: "Technical Delegate's report – car of " + seasonDriverName(row.id), from: "The Technical Delegate", to: "The Stewards",
      sign: "The Technical Delegate", body: "After the race the car of " + seasonDriverName(row.id) + " (P" + row.pos + ") was checked. The matter is referred to the Stewards.",
      lines: [["Check", check.text], ["Result", measured]] });
  }
}

// Disqualify drivers from a Grand Prix: the others move up, the points are recalculated
function disqualifyFromRace(s, roundNumber, driverIds) {
  const round = s.calendar.find(r => r.round === roundNumber);
  const res = round && round.sessions.RACE;
  if (!res || !res.rows) return;
  for (const row of res.rows) {
    if (driverIds.includes(row.id)) {
      row.status = "DSQ";
      row.pos = null;
      row.reason = "Disqualified (FIA)";
      row.fl = false;
    }
  }
  const table = res.table || POINTS_SYSTEMS[s.rules.points].race;
  const order = res.rows.filter(r => r.pos).sort((a, b) => a.pos - b.pos);
  order.forEach((row, i) => { row.pos = i + 1; });
  // the fastest lap of a disqualified driver does not count: the next fastest driver gets it
  if (res.fastestLap && driverIds.includes(res.fastestLap.id)) {
    let fastest = null;
    for (const row of res.rows) if (row.status !== "DSQ" && row.best && (!fastest || row.best < fastest.time)) fastest = { id: row.id, time: row.best };
    res.fastestLap = fastest;
    const pointFor = s.rules.fastestLapPoint && table.length >= 10;
    for (const row of res.rows) row.fl = !!(pointFor && fastest && row.id === fastest.id && row.pos && row.pos <= 10);
  }
  for (const row of res.rows) row.points = row.pos && row.pos <= table.length ? table[row.pos - 1] + (row.fl ? 1 : 0) : 0;
  res.rows.sort((a, b) => (a.pos || 99) - (b.pos || 99));
}


// ---------- 3. Driver nominations ----------
function nominationItem(s, round, team, outId, inId) {
  const c = catalogueDriver(inId);
  const years = Object.keys(c.seasons).sort();
  const races = years.reduce((a, y) => a + c.seasons[y].races, 0);
  const points = years.reduce((a, y) => a + c.seasons[y].points, 0);
  addDeskItem(s, {
    round: round.round, type: "NOMINATION", status: "PENDING",
    title: "Driver change: " + team.name,
    text: team.name + " nominate " + c.first + " " + c.last + " in place of " + seasonDriverName(outId) + " from the next event. " +
      c.first + " " + c.last + " holds a superlicence (" + races + (races === 1 ? " Grand Prix " : " Grands Prix ") + (years.length > 1 ? years[0] + "–" + years[years.length - 1] : years[0]) + ", " + points + (points === 1 ? " point)." : " points)."),
    options: [{ key: "APPROVE", label: "Approve the entry change" }, { key: "REJECT", label: "Reject", danger: true }],
    data: { team: team.id, out: outId, in: inId }
  });
}

// Nominations not decided before the next weekend are approved (the FIA did not object)
function autoApproveNominations(s, round) {
  const lines = [];
  for (const item of pendingDeskItems(s).filter(x => x.type === "NOMINATION")) {
    decideDeskItem(s, item, "APPROVE", true);
    lines.push(item.title + " – approved (no objection from the FIA before the deadline).");
  }
  return lines;
}


// ---------- Decisions ----------
function decideDeskItem(s, item, key, automatic) {
  if (item.status !== "PENDING") return;
  item.status = "DONE";
  item.decision = key;
  item.automatic = !!automatic;
  const d = item.data || {};
  let text = "";
  if (item.type === "PROTEST" || item.type === "TECHNICAL") {
    item.correct = (key === "DSQ") === !!d.guilty;
    if (key === "DSQ") {
      disqualifyFromRace(s, d.roundNumber, d.drivers);
      text = "FIA: " + d.drivers.map(id => seasonDriverName(id)).join(" and ") + " disqualified from round " + d.roundNumber + ".";
    } else {
      text = "FIA: " + item.title + " – no action.";
    }
    publishNotice(s, d.roundNumber, { session: "RACE", title: "Decision – " + item.title, from: "The Stewards", sign: "The Stewards",
      to: "The Team Managers", body: item.text,
      lines: [["Decision", key === "DSQ" ? d.drivers.map(id => seasonDriverName(id)).join(" and ") + " disqualified from the results of the race" : "No further action"],
              ["Reason", key === "DSQ" ? "The car(s) did not comply with the Technical Regulations at all times during the competition." : "The Stewards found no breach of the regulations."]] });
  } else if (item.type === "NOMINATION") {
    const team = seasonTeam(d.team);
    if (key === "APPROVE" && team && team.drivers.includes(d.out)) {
      signDriver(s, team, d.out, d.in, false);
      text = "FIA: " + seasonDriverName(d.in) + " replaces " + seasonDriverName(d.out) + " at " + team.name + ".";
    } else {
      text = "FIA: the driver change at " + (team ? team.name : d.team) + " was rejected.";
    }
  } else if (item.type === "AUDIT") {
    applyAuditDecision(s, item, key);
    text = "FIA: " + item.title + " – " + item.options.find(o => o.key === key).label + ".";
    publishNotice(s, "S", { title: "Cost cap – " + item.title, from: "The Cost Cap Administration", sign: "The FIA", body: item.text,
      lines: [["Decision", item.options.find(o => o.key === key).label]] });
  } else if (item.type === "REVIEW") {
    // right of review: overturning is right when the penalty was not deserved (stewards.js)
    item.correct = (key === "OVERTURN") === !!d.shouldOverturn;
    decideReview(s, item, key); // amended document + recalculated result (stewards.js)
    if (key === "OVERTURN") {
      text = "FIA: right of review granted – the penalty of " + seasonDriverName(d.driver) + " (round " + d.roundNumber + ") is withdrawn, the result is recalculated.";
    } else {
      text = "FIA: right of review – the decision about " + seasonDriverName(d.driver) + " (round " + d.roundNumber + ") stands.";
    }
  } else if (item.type === "ROOKIE") {
    // a fine is right unless the team could not do it (cancelled or wet FP1 sessions)
    item.correct = (key === "FINE") === !d.excused;
    text = "FIA: " + item.title + " – " + (key === "FINE" ? "the team is fined € 100,000." : "no sanction (circumstances beyond the team's control).");
    publishNotice(s, "S", { title: item.title, from: "The FIA", sign: "The FIA", body: item.text,
      lines: [["Decision", key === "FINE" ? "Fine of € 100,000 for the team" : "No sanction – circumstances beyond the team's control"]] });
  }
  if (text) s.log.push({ date: new Date().toISOString(), round: item.round, text });
  saveSeason(s);
}


// ---------- 4. The cost cap audit ----------
function seasonEndAudit(s) {
  if (s.audited) return;
  s.audited = true;
  ensureFinances(s);
  const cap = seasonCostCap(s);
  for (const t of s.teams) {
    const spent = s.finance[t.id].spent;
    const over = spent / cap - 1;
    if (over <= 0) continue;
    const major = over >= 0.05;
    addDeskItem(s, {
      round: null, type: "AUDIT", status: "PENDING",
      title: "Cost cap: " + t.name + " – " + (major ? "major" : "minor") + " breach",
      text: "The cost cap administration found that " + t.name + " spent " + spent.toFixed(1) + " M USD – " + (over * 100).toFixed(1) +
        " % above the cap of " + cap.toFixed(1) + " M USD. " + (major ? "A major breach (5 % or more): the rules allow a deduction of championship points and further sanctions."
          : "A minor breach (below 5 %): the FIA may offer an Accepted Breach Agreement with a fine and reduced wind tunnel time."),
      options: major
        ? [{ key: "POINTS", label: "Deduct 50 constructors' points + 20 % less wind tunnel time", danger: true }, { key: "ABA", label: "Accepted Breach Agreement: 7 M fine + 10 % less wind tunnel time" }, { key: "NONE", label: "No sanction" }]
        : [{ key: "ABA", label: "Accepted Breach Agreement: " + Math.max(1, Math.round(over * cap * 1.5)) + " M fine + 10 % less wind tunnel time" }, { key: "FINE", label: "Fine only" }, { key: "NONE", label: "No sanction" }],
      data: { team: t.id, over, major }
    });
  }
  if (!s.inbox.some(x => x.type === "AUDIT")) {
    addDeskItem(s, { round: null, type: "AUDIT_OK", status: "INFO", title: "Cost cap: all teams compliant",
      text: "The cost cap administration found no breach – every team stayed below " + cap.toFixed(1) + " M USD." });
  }
  rookieRuleAudit(s); // FP1 sessions with a rookie (season-practice.js)
}

function applyAuditDecision(s, item, key) {
  const d = item.data;
  item.correct = d.major ? key === "POINTS" : key === "ABA";
  s.atrPenalty = s.atrPenalty || {};
  if (key === "POINTS") {
    s.deductions = s.deductions || {};
    s.deductions[d.team] = (s.deductions[d.team] || 0) + 50;
    s.atrPenalty[d.team] = 0.2;
  } else if (key === "ABA") {
    s.atrPenalty[d.team] = 0.1;
  }
}


// ---------- 5. The season review and the next season ----------
function seasonReviewData(s) {
  const st = computeStandings(s);
  const races = s.calendar.filter(r => r.sessions.RACE && r.sessions.RACE.status === "DONE");
  const all = [];
  for (const r of s.calendar) for (const t in r.sessions) if (r.sessions[t] && r.sessions[t].status === "DONE" && !isPractice(t)) all.push({ round: r, type: t, res: r.sessions[t] });
  const live = all.filter(x => !x.res.auto && x.res.rdScore !== null && x.res.rdScore !== undefined);
  const desk = (s.inbox || []).filter(x => x.status === "DONE" && x.correct !== undefined && !x.automatic);
  const count = re => s.log.filter(l => re.test(l.text)).length;
  return {
    champion: st.drivers.find(d => !d.excluded) || null,
    constructor: st.teams.find(t => !t.excluded) || null,
    exclusions: activeExclusions(s).length,
    standings: st,
    races: races.length,
    cancelled: s.calendar.filter(r => r.status === "CANCELLED").length,
    winners: new Set(races.map(r => (r.sessions.RACE.rows.find(x => x.pos === 1) || {}).id).filter(Boolean)).size,
    safetyCars: races.reduce((a, r) => a + (r.sessions.RACE.safetyCars || 0), 0),
    vsc: races.reduce((a, r) => a + (r.sessions.RACE.vsc || 0), 0),
    redFlags: all.reduce((a, x) => a + (x.res.redFlags || 0), 0),
    overtakes: races.reduce((a, r) => a + (r.sessions.RACE.overtakes || 0), 0),
    wet: all.filter(x => x.res.weather && x.res.weather !== "dry").length,
    abandoned: all.filter(x => x.res.abandoned).length,
    puPenalties: count(/new .*(grid penalty|back of the grid)/),
    upgrades: count(/ bring a /),
    bans: (s.inbox || []).filter(x => x.type === "BAN").length,
    liveSessions: live.length,
    rdAverage: live.length ? Math.round(live.reduce((a, x) => a + x.res.rdScore, 0) / live.length) : null,
    deskDecisions: desk.length,
    deskCorrect: desk.filter(x => x.correct).length,
    pending: pendingDeskItems(s).length
  };
}

// Every team needs two different drivers: remove doubles, fill empty seats
// with the best free drivers of the catalogue
function fillEmptySeats(draft, baseYear) {
  const seated = new Set();
  for (const t of draft.teams) {
    t.drivers = t.drivers.filter(id => {
      if (!id || seated.has(id) || !catalogueDriver(id)) return false;
      seated.add(id);
      return true;
    });
  }
  const free = SEASON_CATALOGUE.drivers
    .filter(d => !seated.has(d.id))
    .map(d => ({ id: d.id, skill: driverRatings(d.id, baseYear).skill }))
    .sort((a, b) => b.skill - a.skill);
  for (const t of draft.teams) {
    while (t.drivers.length < 2 && free.length) t.drivers.push(free.shift().id);
  }
}

// Start the next season with the same teams, drivers and rulebook; the cars carry over
function createNextSeason(prev, options) {
  options = options || {};
  const draft = {
    name: "Championship " + (prev.year + 1),
    year: prev.year + 1,
    baseYear: prev.baseYear,
    generation: prev.generation,
    rules: JSON.parse(JSON.stringify(prev.rules)),
    calendar: prev.calendar.map(r => ({ circuit: r.circuit, sprint: r.sprint, gp: r.gp || null })),
    // a stand-in hands the seat back to the driver he stood in for
    teams: prev.teams.map(t => ({ id: t.id, name: t.name, colour: t.colour, drivers: t.drivers.map(id => (prev.drivers[id] || {}).standInFor || id) })),
    zones: JSON.parse(JSON.stringify(prev.zones || {}))
  };
  fillEmptySeats(draft, prev.baseYear);
  draft.calendar.sort((a, b) => roundInfo(a).date.localeCompare(roundInfo(b).date));
  const problems = checkDraft(draft);
  if (problems.length) throw new Error(problems[0]);
  const s = createSeason(draft);
  // the drivers keep their numbers and ratings
  for (const id in s.drivers) {
    const p = prev.drivers[id];
    if (p) {
      s.drivers[id].number = p.number;
      s.drivers[id].ratings = p.ratings;
    }
  }
  // the cars carry over; over the winter every team develops, with its wind tunnel time
  const st = computeStandings(prev);
  s.atrOrder = st.teams.map(t => t.id);
  s.atrPenalty = {};
  s.cars = {};
  const rnd = makeRandom(hashText(s.id + "/winter") % 1000000 + 23);
  for (const t of s.teams) {
    const old = prev.cars[t.id];
    const pos = Math.max(0, s.atrOrder.indexOf(t.id));
    const atr = (ATR_SCALE[Math.min(pos, ATR_SCALE.length - 1)] / 100) * (1 - ((prev.atrPenalty || {})[t.id] || 0));
    s.cars[t.id] = Object.assign({}, old, {
      aero: round1(old.aero + (1 + rnd() * 4) * atr),
      chassis: round1(old.chassis + 1 + rnd() * 3),
      tyres: round1(clamp(old.tyres + (rnd() - 0.3) * 6, 30, 95)),
      reliability: round1(clamp(old.reliability + rnd() * 4, 50, 97))
    });
    s.atrPenalty[t.id] = (prev.atrPenalty || {})[t.id] || 0; // a wind tunnel penalty counts for the new season too
  }
  // keep the best car at 100 (only the gaps matter)
  for (const k of ["aero", "chassis"]) {
    const best = Math.max(...s.teams.map(t => s.cars[t.id][k]));
    if (best > 100) for (const t of s.teams) s.cars[t.id][k] = round1(s.cars[t.id][k] - (best - 100));
  }
  // bans of the FIA that continue (excluded and banned from the start of the new season)
  if (options.keepBans) {
    s.exclusions = activeExclusions(prev).filter(x => x.banned).map((x, i) => Object.assign({}, x, {
      id: i + 1, fromRound: 1, date: new Date().toISOString(), reason: x.reason + " (ban continued from " + prev.name + ")"
    }));
    s.exclusionSeq = s.exclusions.length;
    for (const x of s.exclusions) s.log.push({ date: x.date, text: "FIA: the ban of " + exclusionName(s, x) + " continues in this season." });
  }
  s.previousSeason = prev.id;
  s.log.push({ date: new Date().toISOString(), text: "Season created from " + prev.name + " – teams, drivers and cars carried over." });
  saveSeason(s);
  prev.nextSeason = s.id;
  saveSeason(prev);
  return s;
}


// ---------- 6. Exclusion from the championship ----------
// The FIA can exclude a driver or a team from the championship, like Michael
// Schumacher in 1997 (drivers' championship) or McLaren in 2007 (constructors'):
// the race results stay as they are – nobody moves up in a race – but the
// driver / team is no longer classified in the championship.
// { id, kind: "DRIVER" | "TEAM", target, alsoOther, banned, fromRound, reason, date, revoked, revokedDate }
//   alsoOther: DRIVER -> his points don't count for his team either
//              TEAM   -> its drivers are excluded from the drivers' championship too
//   banned:    also excluded from the remaining events (from round fromRound on):
//              a driver is replaced by a stand-in, a team does not start any more
function activeExclusions(s) {
  return (s.exclusions || []).filter(x => !x.revoked);
}

// Who is out of which standings
function exclusionSets(s) {
  const sets = { drivers: new Set(), teams: new Set(), teamsWithDrivers: new Set(), noTeamPoints: new Set() };
  for (const x of activeExclusions(s)) {
    if (x.kind === "DRIVER") {
      sets.drivers.add(x.target);
      if (x.alsoOther) sets.noTeamPoints.add(x.target);
    } else {
      sets.teams.add(x.target);
      if (x.alsoOther) {
        sets.teamsWithDrivers.add(x.target);
        const team = s.teams.find(t => t.id === x.target);
        if (team) for (const id of team.drivers) sets.drivers.add(id);
      }
    }
  }
  return sets;
}

// Is a driver / team banned from the events of this round?
function bannedFromEvents(s, kind, id, roundNumber) {
  return activeExclusions(s).some(x => x.banned && x.kind === kind && x.target === id && roundNumber >= x.fromRound);
}

// The first round the decision can apply to: a weekend that has already started is finished as it is
function nextAffectedRound(s) {
  const next = nextSession(s);
  if (!next) return s.calendar.length + 1;
  return next.round.prepared ? next.round.round + 1 : next.round.round;
}

function exclusionName(s, x) {
  return x.kind === "DRIVER" ? seasonDriverName(x.target) : (s.teams.find(t => t.id === x.target) || { name: x.target }).name;
}

function excludeFromChampionship(s, kind, target, options) {
  s.exclusions = s.exclusions || [];
  s.exclusionSeq = (s.exclusionSeq || 0) + 1;
  const x = {
    id: s.exclusionSeq, kind, target, alsoOther: !!options.alsoOther, banned: !!options.banned,
    fromRound: nextAffectedRound(s), reason: String(options.reason || "").trim(), date: new Date().toISOString(), revoked: false
  };
  s.exclusions.push(x);
  const name = exclusionName(s, x);
  const what = kind === "DRIVER"
    ? name + " is excluded from the drivers' championship" + (x.alsoOther ? " (his points don't count for the constructors either)" : "")
    : name + " is excluded from the constructors' championship" + (x.alsoOther ? " – its drivers from the drivers' championship too" : "");
  const ban = x.banned ? (x.fromRound <= s.calendar.length ? " Banned from all remaining events (from round " + x.fromRound + ")." : " Banned from the remaining events.") : " The race results stand.";
  const text = "FIA: " + what + "." + ban + " Reason: " + x.reason;
  s.log.push({ date: x.date, round: null, text });
  addDeskItem(s, { round: null, type: "EXCLUSION", status: "INFO", title: "Excluded from the championship: " + name, text: what + "." + ban + " Reason: " + x.reason });
  saveSeason(s);
  return x;
}

// An appeal is upheld: everything counts again (a banned driver / team is back from the next weekend)
function revokeExclusion(s, id) {
  const x = (s.exclusions || []).find(e => e.id === id);
  if (!x || x.revoked) return;
  x.revoked = true;
  x.revokedDate = new Date().toISOString();
  const name = exclusionName(s, x);
  s.log.push({ date: x.revokedDate, round: null, text: "FIA: the exclusion of " + name + " from the championship has been lifted." });
  addDeskItem(s, { round: null, type: "EXCLUSION", status: "INFO", title: "Exclusion lifted: " + name, text: "The exclusion of " + name + " has been lifted (appeal upheld). " + (x.banned ? "Back in the races from the next weekend; " : "") + "the points count again." });
  saveSeason(s);
}
