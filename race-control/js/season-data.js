// =====================================================================
//  season-data.js
//  Static data of the championship mode:
//  1. The character of every real circuit (what the cars need there,
//     how likely rain / heat / wind are)
//  2. Points systems and the FIA rulebook defaults
//  3. Helpers to read the catalogue (merged from the data packs, data-registry.js)
//  4. buildCatalogueFromOpenF1(): regenerates the data of the core pack
// =====================================================================

// ---------- 1. Circuit character ----------
// Comes from the data packs (data-registry.js, CIRCUIT_CHARACTER). 0 ... 1 values:
//   power      = how much a strong power unit / low drag counts (Monza = 1)
//   downforce  = how much downforce / mechanical grip counts (Monaco = 1)
//   tyres      = tyre stress (abrasive surface, high-energy corners)
//   overtaking = how easy it is to overtake
//   street     = street circuit (walls close to the track -> more SC)
//   rain       = chance of rain on a race weekend
//   air        = typical air temperature (°C)
//   wind       = how windy the circuit usually is
//   night      = night race (no sun on the track)
// SEASON_YEARS (the years with a calendar) also comes from the packs.
const MAX_ROUNDS = 24;
const MAX_TEAMS = 12; // the pit lane has 12 garages


// ---------- 2. Points and the rulebook ----------
const POINTS_SYSTEMS = {
  STANDARD: { name: "25-18-15-12-10-8-6-4-2-1 (since 2010)", race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] },
  TOP8:     { name: "10-8-6-5-4-3-2-1 (2003–2009)",          race: [10, 8, 6, 5, 4, 3, 2, 1] },
  TOP6:     { name: "10-6-4-3-2-1 (1991–2002)",              race: [10, 6, 4, 3, 2, 1] }
};
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

// Points when a race is abandoned and cannot be restarted
const SHORTENED_RULES = {
  REAL2022: { name: "Distance scale (FIA since 2022)" },
  HALF:     { name: "Half points below 75% (before 2022)" },
  FULL:     { name: "Full points if 2 green-flag laps were completed" },
  NONE:     { name: "No points below 75% distance" }
};

// The default rulebook for a car generation. The FIA (the player)
// can change all of it before the season.
function defaultRules(generation) {
  const gen2026 = generation === "GEN2026";
  return {
    points: "STANDARD",
    sprintPoints: true,
    fastestLapPoint: false,      // 2019–2024: 1 point for the fastest lap in the top 10
    shortened: "REAL2022",
    costCap: gen2026 ? 215 : 135, // million USD for a 21-race season
    costCapPerExtraRace: 1.8,
    atr: true,                   // aerodynamic testing restrictions by championship position
    pu: gen2026
      ? { ICE: 4, TC: 4, "MGU-K": 4, ES: 2, CE: 2, EX: 4 }
      : { ICE: 4, TC: 4, "MGU-H": 4, "MGU-K": 4, ES: 2, CE: 2, EX: 4 },
    penaltyPointsBan: 12,        // penalty points within 12 months -> race ban
    reprimandsGridDrop: 5,       // reprimands in one season -> 10-place grid penalty
    heatHazard: 31,              // °C forecast -> heat hazard declared (2025 rule)
    maxRaceHours: 2,             // race running time
    maxWindowHours: 3            // total time including suspensions
  };
}

// ATR sliding scale: % of the base wind tunnel / CFD allowance by
// position in last season's constructors' championship
const ATR_SCALE = [70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 115, 115];

// Points for an abandoned race. distance = share of the planned laps
// completed by the leader (0...1), greenLaps = laps under green flag.
function shortenedPointsTable(rule, base, distance, greenLaps) {
  if (greenLaps < 2) return [];
  if (rule === "FULL" || distance >= 0.75) return base;
  if (rule === "NONE") return [];
  if (rule === "HALF") return base.map(p => p / 2);
  // REAL2022 (FIA Sporting Regulations Art. 6.5)
  if (distance < 0.25) return [6, 4, 3, 2, 1];
  if (distance < 0.5) return [13, 10, 8, 6, 5, 4, 3, 2, 1];
  return [19, 14, 12, 9, 8, 6, 5, 3, 2, 1];
}


// ---------- 3. Catalogue helpers ----------
function catalogueCircuit(key) {
  return catalogueIndex.circuits.get(String(key));
}

function catalogueDriver(id) {
  return catalogueIndex.drivers.get(id);
}

// The three-letter code on the timing screen. The id can be longer when two
// drivers of different eras share a code (Vergne "VER2012" next to Verstappen "VER").
function driverCode(id) {
  const c = catalogueDriver(id);
  if (c && c.code) return c.code;
  return String(id).replace(/\d{4}[a-z]?$/, "");
}

function catalogueTeam(id) {
  return catalogueIndex.teams.get(id);
}

// Display data of a circuit: name, country, Grand Prix name, usual date
function circuitInfo(key) {
  const c = catalogueCircuit(key);
  if (!c) {
    // a circuit of a data pack that is not loaded (any more)
    return { key, name: String(key), country: "", gp: "Unknown circuit " + key, years: [], laps: 50, date: "07-01", sprintYears: [], character: {}, missing: true };
  }
  const ch = CIRCUIT_CHARACTER[c.key] || {};
  const latest = c.meetings[0];
  return {
    key: c.key,
    name: ch.short || c.name,
    country: ch.country || c.country,
    gp: latest.gp,
    years: c.meetings.map(m => m.year).sort(),
    laps: Math.max(...c.meetings.map(m => m.laps || 0)),
    date: latest.date.slice(5),            // MM-DD of the latest race
    sprintYears: c.meetings.filter(m => m.sprint).map(m => m.year),
    character: ch
  };
}

// Display data of a round: like circuitInfo, with the round's own Grand Prix name
// (a circuit can host two events in a year, e.g. British and 70th Anniversary GP 2020)
function roundInfo(round) {
  const info = circuitInfo(round.circuit);
  return round.gp ? Object.assign({}, info, { gp: round.gp }) : info;
}

// The real calendar of a year (circuit keys in date order, with sprints) – every event,
// also two at the same circuit
function realCalendar(year) {
  const rounds = [];
  for (const c of SEASON_CATALOGUE.circuits) {
    for (const m of c.meetings) {
      if (m.year === year) rounds.push({ circuit: c.key, sprint: !!m.sprint, date: m.date, gp: m.gp || null });
    }
  }
  return rounds.sort((a, b) => a.date.localeCompare(b.date));
}

// The team (franchise) as it was in a year: name, colour, the two main drivers
function teamInYear(teamId, year) {
  const t = catalogueTeam(teamId);
  if (!t) return null;
  const years = Object.keys(t.years).map(Number).sort();
  const y = t.years[year] ? year : years.reduce((best, v) => Math.abs(v - year) < Math.abs(best - year) ? v : best, years[0]);
  const data = t.years[y];
  return { id: t.id, year: y, name: data.name, colour: data.colour, drivers: data.drivers.slice(0, 2), avgFinish: data.avgFinish, engine: data.engine || null };
}

// The driver's race number in (or nearest to) a year
function driverNumber(id, year) {
  const d = catalogueDriver(id);
  const years = Object.keys(d.seasons).map(Number).sort();
  const y = d.seasons[year] ? year : years.reduce((best, v) => Math.abs(v - year) < Math.abs(best - year) ? v : best, years[0]);
  return d.seasons[y].number;
}


// ---------- 4. Regenerate the core data pack (run in the browser console) ----------
// const cat = await buildCatalogueFromOpenF1(); copy(JSON.stringify(cat));
// then replace circuits / teams / drivers in data/core-2023.js (keep "layout" and "character").
async function buildCatalogueFromOpenF1() {
  const sessions = await getData("sessions", "date_start>=2023-01-01");
  const driversAll = await getData("drivers", "meeting_key>=1140");
  const resultsAll = await getData("session_result", "meeting_key>=1140");
  const meetingName = {};
  for (const y of SEASON_YEARS) for (const x of await getData("meetings", "year=" + y)) meetingName[x.meeting_key] = x.meeting_name;

  const FRANCHISE = { "Red Bull Racing": "redbull", "Ferrari": "ferrari", "Mercedes": "mercedes", "McLaren": "mclaren",
    "Aston Martin": "astonmartin", "Alpine": "alpine", "Williams": "williams", "AlphaTauri": "racingbulls", "RB": "racingbulls",
    "Racing Bulls": "racingbulls", "Alfa Romeo": "sauber", "Kick Sauber": "sauber", "Audi": "sauber", "Haas F1 Team": "haas", "Cadillac": "cadillac" };
  const drvBySess = {};
  for (const d of driversAll) (drvBySess[d.session_key] = drvBySess[d.session_key] || {})[d.driver_number] = d;
  const resBySess = {};
  for (const r of resultsAll) (resBySess[r.session_key] = resBySess[r.session_key] || []).push(r);

  const meetings = {};
  for (const s of sessions) {
    if (s.is_cancelled || Date.parse(s.date_start) > Date.now()) continue;
    const m = meetings[s.meeting_key] || (meetings[s.meeting_key] = { year: s.year, meeting: s.meeting_key, circuit: s.circuit_key,
      name: s.circuit_short_name, country: s.country_name, loc: s.location, gmt: s.gmt_offset, date: s.date_start });
    if (s.session_name === "Race") { m.race = s.session_key; m.date = s.date_start; }
    if (s.session_name === "Qualifying") m.quali = s.session_key;
    if (s.session_name === "Sprint") m.sprint = s.session_key;
    if (s.session_name === "Sprint Qualifying" || s.session_name === "Sprint Shootout") m.sprintQuali = s.session_key;
  }

  const circuits = {};
  for (const m of Object.values(meetings)) {
    if (!m.race || !resBySess[m.race] || !resBySess[m.race].length) continue;
    const winner = resBySess[m.race].find(r => r.position === 1);
    const c = circuits[m.circuit] || (circuits[m.circuit] = { key: m.circuit, name: m.name, country: m.country, location: m.loc, meetings: [] });
    c.meetings.push({ year: m.year, meeting: m.meeting, gp: meetingName[m.meeting] || "", race: m.race, quali: m.quali || null,
      sprint: m.sprint || null, sprintQuali: m.sprintQuali || null, laps: winner ? winner.number_of_laps : null, date: m.date.slice(0, 10), gmt: m.gmt });
  }
  for (const c of Object.values(circuits)) c.meetings.sort((a, b) => b.year - a.year);

  const drivers = {};
  const teams = {};
  const pts = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  for (const m of Object.values(meetings)) {
    if (!m.race || !resBySess[m.race]) continue;
    for (const kind of ["race", "quali"]) {
      const key = m[kind];
      if (!key || !resBySess[key]) continue;
      for (const r of resBySess[key]) {
        const d = drvBySess[key] && drvBySess[key][r.driver_number];
        if (!d) continue;
        const id = d.name_acronym;
        const dr = drivers[id] || (drivers[id] = { id, first: d.first_name, last: d.last_name, country: d.country_code, headshot: d.headshot_url, seasons: {} });
        if (d.headshot_url) dr.headshot = d.headshot_url;
        if (d.country_code) dr.country = d.country_code;
        const se = dr.seasons[m.year] || (dr.seasons[m.year] = { teams: {}, number: d.driver_number, races: 0, finish: [], quali: [], dnf: 0, points: 0, h2hQ: [0, 0], h2hR: [0, 0] });
        se.number = d.driver_number;
        if (kind === "race") {
          se.teams[d.team_name] = (se.teams[d.team_name] || 0) + 1;
          se.races++;
          if (r.dnf || r.dns || r.dsq || !r.position) se.dnf++;
          else {
            se.finish.push(r.position);
            if (r.position <= 10) se.points += pts[r.position - 1];
          }
          const fr = FRANCHISE[d.team_name] || d.team_name;
          const t = teams[fr] || (teams[fr] = { id: fr, years: {} });
          const ty = t.years[m.year] || (t.years[m.year] = { name: d.team_name, colour: "#" + (d.team_colour || "888888"), drivers: {}, finish: [] });
          if (d.team_colour) ty.colour = "#" + d.team_colour;
          ty.drivers[id] = (ty.drivers[id] || 0) + 1;
          if (r.position && !r.dnf && !r.dsq) ty.finish.push(r.position);
        } else if (r.position) {
          se.quali.push(r.position);
        }
      }
      // head to head with the team mate
      const byTeam = {};
      for (const r of resBySess[key]) {
        const d = drvBySess[key] && drvBySess[key][r.driver_number];
        if (d) (byTeam[d.team_name] = byTeam[d.team_name] || []).push({ id: d.name_acronym, pos: (r.dnf || r.dsq || r.dns || !r.position) ? 99 : r.position });
      }
      for (const list of Object.values(byTeam)) {
        if (list.length !== 2 || (list[0].pos === 99 && list[1].pos === 99)) continue;
        const field = kind === "race" ? "h2hR" : "h2hQ";
        const sa = drivers[list[0].id].seasons[m.year];
        const sb = drivers[list[1].id].seasons[m.year];
        if (!sa || !sb) continue;
        (list[0].pos < list[1].pos ? sa : sb)[field][0]++;
        sa[field][1]++;
        sb[field][1]++;
      }
    }
  }
  const avg = l => l.length ? Math.round(l.reduce((x, y) => x + y, 0) / l.length * 10) / 10 : null;
  for (const d of Object.values(drivers)) {
    for (const y in d.seasons) {
      const s = d.seasons[y];
      s.team = FRANCHISE[Object.entries(s.teams).sort((a, b) => b[1] - a[1])[0][0]] || null;
      s.avgFinish = avg(s.finish);
      s.avgQuali = avg(s.quali);
      delete s.finish; delete s.quali; delete s.teams;
    }
  }
  for (const t of Object.values(teams)) {
    for (const y in t.years) {
      const ty = t.years[y];
      ty.avgFinish = avg(ty.finish);
      delete ty.finish;
      ty.drivers = Object.entries(ty.drivers).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    }
  }
  return { circuits: Object.values(circuits), drivers: Object.values(drivers), teams: Object.values(teams) };
}
