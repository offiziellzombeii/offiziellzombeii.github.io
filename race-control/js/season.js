// =====================================================================
//  season.js
//  The championship: the season state, saving / loading, and creating
//  a new season from the choices of the setup wizard.
//
//  The player is the FIA: the FIA sets the calendar and the rulebook,
//  the teams (AI) build the cars and race. A season is saved in the
//  browser (localStorage) after every change and can be exported as a file.
// =====================================================================

const SEASON_FORMAT = 1;
const SEASON_INDEX_KEY = "rc.seasons";          // list of saved seasons
const SEASON_KEY_PREFIX = "rc.season.";         // one entry per season
let season = null;                              // the open season

// ---------- Saving and loading ----------
function storageGet(key) {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch (error) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn("Could not save:", error);
    return false;
  }
}

function listSeasons() {
  return (storageGet(SEASON_INDEX_KEY) || []).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
}

// false when the browser storage is full or blocked: the hub then shows a
// warning with an export button, so no progress is lost without notice
let seasonSaveFailed = false;

function saveSeason(s) {
  s = s || season;
  if (!s) return false;
  s.updated = new Date().toISOString();
  const ok = storageSet(SEASON_KEY_PREFIX + s.id, s);
  const index = (storageGet(SEASON_INDEX_KEY) || []).filter(x => x.id !== s.id);
  index.push({ id: s.id, name: s.name, generation: s.generation, year: s.year, rounds: s.calendar.length,
    done: s.calendar.filter(r => r.status === "DONE").length, phase: s.phase, updated: s.updated });
  storageSet(SEASON_INDEX_KEY, index);
  if (!ok && !seasonSaveFailed && typeof showToast === "function") {
    showToast("The season could not be saved – the browser storage is full. Export the season file to keep your progress.");
  }
  seasonSaveFailed = !ok;
  return ok;
}

// Older saves: fill in fields that were added later
function migrateSeason(s) {
  // stable id of a round for the random seeds (round numbers change when an event is postponed)
  for (const r of s.calendar) if (r.uid === undefined) r.uid = r.round;
  // free practice came later: weekends that had already begun stay without it
  if (!s.practiceVersion) {
    for (const r of s.calendar) {
      if (r.practice === undefined && (r.status === "DONE" || r.status === "CANCELLED" || Object.keys(r.sessions).length)) r.practice = false;
    }
    s.practiceVersion = 1;
  }
  // seasons from before the data packs only used the built-in data
  if (!s.packs) s.packs = ["core-2023"];
  // the weekend arrivals moved from the calendar to the FIA desk (Technical Delegate's information)
  if (!s.arrivalsOnDesk) {
    for (const r of s.calendar) if (r.prepared && r.arrivals && typeof addArrivalsDeskItem === "function") addArrivalsDeskItem(s, r);
    s.arrivalsOnDesk = true;
  }
  // documents: one numbering per weekend (before: one global list) – doc.id keeps the old number
  if (s.documents && s.documents.length && s.documents.some(d => d.id === undefined)) {
    s.docSeqByRound = {};
    for (const d of s.documents.slice().sort((a, b) => a.no - b.no)) {
      d.id = d.no;
      const key = d.round === null || d.round === undefined || d.round === "S" ? "S" : String(d.round);
      d.no = s.docSeqByRound[key] = (s.docSeqByRound[key] || 0) + 1;
    }
    s.docIdSeq = Math.max(...s.documents.map(d => d.id));
    for (const item of s.inbox || []) {
      if (item.data && item.data.docNo !== undefined && item.data.docId === undefined) item.data.docId = item.data.docNo;
      if (item.docNo !== undefined && item.docId === undefined) item.docId = item.docNo;
    }
  }
  // the timing code was the driver id ("VER2012") – now the real code ("VER")
  for (const id in s.drivers) if (s.drivers[id].code === id) s.drivers[id].code = driverCode(id);
  return s;
}

// The data packs a season needs that are not loaded (empty = all there)
function missingPacks(s) {
  return (s.packs || []).filter(id => !DATA_PACKS.some(p => p.pack.id === id));
}

function loadSeason(id) {
  const s = storageGet(SEASON_KEY_PREFIX + id);
  if (!s || s.format !== SEASON_FORMAT) return null;
  season = migrateSeason(s);
  return s;
}

// The seed of a round: stays the same when the round gets another number
function roundSeed(round) {
  return round.uid !== undefined ? round.uid : round.round;
}

// The calendar order changed (an event was postponed): give the rounds their
// new numbers and update everything that refers to a round by its number.
// oldDates = { old round number: date before the change }. Parts in production
// arrive at a point in time, so their "arrives" round is found by date.
function renumberRounds(s, oldDates) {
  const map = {};
  s.calendar.forEach((r, i) => { map[r.round] = i + 1; });
  const to = n => (n !== null && n !== undefined && map[n] !== undefined ? map[n] : n);
  const byDate = n => {
    const date = oldDates && oldDates[n];
    if (!date) return to(n);
    const i = s.calendar.findIndex(r => r.date >= date);
    return i < 0 ? s.calendar.length + 1 : i + 1;
  };
  for (const t of s.teams) {
    const f = s.finance && s.finance[t.id];
    for (const p of (f && f.packages) || []) if (!p.fitted) p.arrives = byDate(p.arrives);
  }
  s.calendar.forEach(r => { r.round = to(r.round); });
  for (const t of s.teams) {
    if (t.swappedAt) t.swappedAt = to(t.swappedAt);
    const f = s.finance && s.finance[t.id];
    if (!f) continue;
    for (const p of f.packages || []) {
      p.ordered = to(p.ordered);
      if (p.fitted) {
        p.fitted = to(p.fitted);
        p.arrives = to(p.arrives);
      }
    }
    for (const h of f.history || []) h.round = to(h.round);
  }
  for (const id in s.drivers) if (s.drivers[id].banServed) s.drivers[id].banServed = to(s.drivers[id].banServed);
  for (const item of s.inbox) {
    item.round = to(item.round);
    if (item.data && item.data.roundNumber !== undefined) item.data.roundNumber = to(item.data.roundNumber);
  }
  for (const entry of s.log) entry.round = to(entry.round);
  for (const d of s.decisions || []) d.round = to(d.round); // stewards' precedents (stewards.js)
  // the documents of a weekend move with it (and their numbering)
  for (const d of s.documents || []) if (d.round !== "S") d.round = to(d.round);
  if (s.docSeqByRound) {
    const seq = {};
    for (const key in s.docSeqByRound) seq[key === "S" ? "S" : String(to(Number(key)))] = s.docSeqByRound[key];
    s.docSeqByRound = seq;
  }
  // a ban starts at a point in time ("from the next event"), not with one particular event
  for (const ex of s.exclusions || []) ex.fromRound = byDate(ex.fromRound);
  return map;
}

function deleteSeason(id) {
  try {
    localStorage.removeItem(SEASON_KEY_PREFIX + id);
  } catch (error) { /* nothing to delete */ }
  storageSet(SEASON_INDEX_KEY, (storageGet(SEASON_INDEX_KEY) || []).filter(x => x.id !== id));
  if (season && season.id === id) season = null;
}

function exportSeason(s) {
  const blob = new Blob([JSON.stringify(s, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = s.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + ".season.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Import a season file; returns an error text or null
function importSeason(text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch (error) {
    return "This is not a season file.";
  }
  if (!s || s.format !== SEASON_FORMAT || !Array.isArray(s.calendar) || !Array.isArray(s.teams)) return "This is not a season file of this version.";
  if (listSeasons().some(x => x.id === s.id)) s.id = newSeasonId(); // keep both
  migrateSeason(s);
  saveSeason(s);
  return null;
}

function newSeasonId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}


// ---------- A new season ----------
// The wizard starts from a draft: the real season of "baseYear"
function newSeasonDraft(baseYear, generation) {
  const gen = generation || (baseYear >= 2026 ? "GEN2026" : "GE2023");
  const calendar = realCalendar(baseYear).slice(0, MAX_ROUNDS).map(r => ({ circuit: r.circuit, sprint: r.sprint, gp: r.gp, date: r.date }));
  const teams = SEASON_CATALOGUE.teams
    .filter(t => t.years[baseYear])
    .map(t => {
      const info = teamInYear(t.id, baseYear);
      return { id: t.id, name: info.name, colour: info.colour, drivers: info.drivers.slice(0, 2) };
    });
  return {
    name: "Championship " + (baseYear + 1),
    year: baseYear + 1,
    baseYear,
    generation: gen,
    rules: defaultRules(gen),
    calendar,
    teams,
    zones: {}
  };
}

// Dates of the rounds: the usual date of every Grand Prix in the season
// year, at least one week apart (two rounds on the same weekend are moved)
function scheduleDates(calendar, year) {
  let last = null;
  return calendar.map(round => {
    // MM-DD: the real date of this event (base season), else the usual date of the circuit
    const usual = round.date ? round.date.slice(5, 10) : roundInfo(round).date;
    let d = new Date(Date.UTC(year, Number(usual.slice(0, 2)) - 1, Number(usual.slice(3, 5))));
    // keep the order of the calendar: never before the last round + 7 days
    if (last && d < new Date(last.getTime() + 7 * 864e5)) d = new Date(last.getTime() + 7 * 864e5);
    last = d;
    return d.toISOString().slice(0, 10);
  });
}

// Check a draft; returns a list of problems (empty = ok)
function checkDraft(draft) {
  const problems = [];
  if (draft.calendar.length === 0) problems.push("The calendar is empty.");
  if (draft.calendar.length > MAX_ROUNDS) problems.push("At most " + MAX_ROUNDS + " rounds are allowed.");
  if (draft.teams.length < 2) problems.push("At least two teams are needed.");
  if (draft.teams.length > MAX_TEAMS) {
    const extra = draft.teams.length - MAX_TEAMS;
    problems.push(draft.teams.length + " teams – only " + MAX_TEAMS + " fit into the pit lane. Remove " + extra + " team" + (extra > 1 ? "s" : "") + " in \"Teams & drivers\".");
  }
  const seen = {};
  for (const t of draft.teams) {
    if (t.drivers.length !== 2 || t.drivers.some(d => !d)) problems.push(t.name + " needs two drivers.");
    for (const d of t.drivers) {
      if (!d) continue;
      if (seen[d]) problems.push(catalogueDriver(d).last + " drives for two teams (" + seen[d] + " and " + t.name + ").");
      seen[d] = t.name;
    }
  }
  return problems;
}

// Turn the draft of the wizard into a season and save it
// options.transient: a one-off race of a data pack (historic race card) – not saved,
// not the open championship
function createSeason(draft, options) {
  options = options || {};
  const dates = scheduleDates(draft.calendar, draft.year);
  const usedNumbers = {};
  const drivers = {};
  for (const t of draft.teams) {
    for (const id of t.drivers) {
      const c = catalogueDriver(id);
      let number = driverNumber(id, draft.baseYear);
      while (usedNumbers[number]) number = number + 1 > 99 ? 2 : number + 1; // two drivers with the same number
      usedNumbers[number] = id;
      drivers[id] = { id, code: driverCode(id), first: c.first, last: c.last, country: c.country, headshot: c.headshot, number, team: t.id };
    }
  }
  const s = {
    format: SEASON_FORMAT,
    id: newSeasonId(),
    name: draft.name.trim() || "Championship",
    created: new Date().toISOString(),
    updated: null,
    year: draft.year,
    baseYear: draft.baseYear,
    generation: draft.generation,
    rules: JSON.parse(JSON.stringify(draft.rules)),
    calendar: draft.calendar.map((r, i) => Object.assign({ round: i + 1, uid: i + 1, circuit: r.circuit, sprint: !!r.sprint, date: dates[i], status: "PLANNED", sessions: {} }, r.gp ? { gp: r.gp } : {})),
    teams: draft.teams.map(t => ({ id: t.id, name: t.name, colour: t.colour, drivers: t.drivers.slice() })),
    drivers,
    zones: JSON.parse(JSON.stringify(draft.zones || {})),
    // the data packs the season needs (circuits, teams, drivers) – data-registry.js
    packs: packsUsedBy(draft.calendar, Object.keys(drivers), draft.teams.map(t => t.id)),
    practiceVersion: 1,            // the weekends have free practice (season-practice.js)
    phase: "PRESEASON",          // PRESEASON -> SEASON -> FINISHED
    inbox: [],
    log: [{ date: new Date().toISOString(), text: "Season created by the FIA." }]
  };
  if (options.transient) return s;
  saveSeason(s);
  season = s;
  return s;
}

// Driver / team display helpers
function seasonDriverName(id) {
  const d = season.drivers[id] || catalogueDriver(id);
  return d ? d.first + " " + d.last : id;
}

function seasonTeam(id) {
  return season.teams.find(t => t.id === id);
}
