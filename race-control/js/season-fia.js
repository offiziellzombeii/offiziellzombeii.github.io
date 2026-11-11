// =====================================================================
//  season-fia.js
//  The FIA desk – the decisions of the FIA away from the race track:
//  1. Desk items: information and decisions waiting for the FIA
//  2. Protests of the teams and reports of the technical delegate
//     (decided by the FIA: dismiss, or disqualify -> the results change)
//  3. Driver nominations: superlicence and entry list
//  4. The cost cap audit after the season
//  5. The season review and the next season
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

const TECH_CHECKS = [
  { key: "PLANK", text: "the skid block (plank) is worn below the minimum thickness of 9 mm", measure: () => "8." + Math.floor(rand(1, 9)) + " mm measured at the rear" },
  { key: "WEIGHT", text: "the car is below the minimum weight after the race", measure: () => "under the limit by " + rand(0.2, 1.4).toFixed(1) + " kg" },
  { key: "FUEL", text: "a fuel sample of less than 1 litre could be taken", measure: () => rand(0.4, 0.9).toFixed(2) + " litres in the tank" }
];

// After every Grand Prix: maybe a protest and a scrutineering report
function fiaDeskAfterRace(s, round, result) {
  if (!result || !result.rows) return;
  const rnd = makeRandom(hashText(s.id + "/desk/" + round.round) % 1000000 + 21);
  const info = circuitInfo(round.circuit);
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
    }
  }

  // the technical delegate finds an irregularity at a car in the top 10 (~6 % of the races)
  if (rnd() < 0.06 && classified.length > 3) {
    const row = classified[Math.floor(rnd() * Math.min(10, classified.length))];
    const check = TECH_CHECKS[Math.floor(rnd() * TECH_CHECKS.length)];
    addDeskItem(s, {
      round: round.round, type: "TECHNICAL", status: "PENDING",
      title: "Technical delegate: " + seasonDriverName(row.id),
      text: "After the " + info.gp + " the technical delegate reports that on the car of " + seasonDriverName(row.id) + " (P" + row.pos + ") " +
        check.text + ": " + check.measure() + ". The rule is absolute – there is no tolerance.",
      options: [{ key: "DSQ", label: "Disqualify " + seasonDriverName(row.id), danger: true }, { key: "NFA", label: "No further action" }],
      data: { roundNumber: round.round, drivers: [row.id], guilty: true }
    });
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
  for (const r of s.calendar) for (const t in r.sessions) if (r.sessions[t] && r.sessions[t].status === "DONE") all.push({ round: r, type: t, res: r.sessions[t] });
  const live = all.filter(x => !x.res.auto && x.res.rdScore !== null && x.res.rdScore !== undefined);
  const desk = (s.inbox || []).filter(x => x.status === "DONE" && x.correct !== undefined && !x.automatic);
  const count = re => s.log.filter(l => re.test(l.text)).length;
  return {
    champion: st.drivers[0] || null,
    constructor: st.teams[0] || null,
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

// Start the next season with the same teams, drivers and rulebook; the cars carry over
function createNextSeason(prev) {
  const draft = {
    name: "Championship " + (prev.year + 1),
    year: prev.year + 1,
    baseYear: prev.baseYear,
    generation: prev.generation,
    rules: JSON.parse(JSON.stringify(prev.rules)),
    calendar: prev.calendar.map(r => ({ circuit: r.circuit, sprint: r.sprint })),
    teams: prev.teams.map(t => ({ id: t.id, name: t.name, colour: t.colour, drivers: t.drivers.filter(id => !(prev.drivers[id] || {}).standInFor) })),
    zones: JSON.parse(JSON.stringify(prev.zones || {}))
  };
  draft.calendar.sort((a, b) => circuitInfo(a.circuit).date.localeCompare(circuitInfo(b.circuit).date));
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
  s.previousSeason = prev.id;
  s.log.push({ date: new Date().toISOString(), text: "Season created from " + prev.name + " – teams, drivers and cars carried over." });
  saveSeason(s);
  prev.nextSeason = s.id;
  saveSeason(prev);
  return s;
}
