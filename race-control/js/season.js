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
    console.log("Could not save:", error);
    return false;
  }
}

function listSeasons() {
  return (storageGet(SEASON_INDEX_KEY) || []).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
}

function saveSeason(s) {
  s = s || season;
  if (!s) return false;
  s.updated = new Date().toISOString();
  const ok = storageSet(SEASON_KEY_PREFIX + s.id, s);
  const index = (storageGet(SEASON_INDEX_KEY) || []).filter(x => x.id !== s.id);
  index.push({ id: s.id, name: s.name, generation: s.generation, year: s.year, rounds: s.calendar.length,
    done: s.calendar.filter(r => r.status === "DONE").length, phase: s.phase, updated: s.updated });
  storageSet(SEASON_INDEX_KEY, index);
  return ok;
}

function loadSeason(id) {
  const s = storageGet(SEASON_KEY_PREFIX + id);
  if (!s || s.format !== SEASON_FORMAT) return null;
  season = s;
  return s;
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
  const calendar = realCalendar(baseYear).slice(0, MAX_ROUNDS).map(r => ({ circuit: r.circuit, sprint: r.sprint }));
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
    const usual = circuitInfo(round.circuit).date; // MM-DD
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
  if (draft.teams.length > MAX_TEAMS) problems.push("At most " + MAX_TEAMS + " teams fit into the pit lane.");
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
function createSeason(draft) {
  const dates = scheduleDates(draft.calendar, draft.year);
  const usedNumbers = {};
  const drivers = {};
  for (const t of draft.teams) {
    for (const id of t.drivers) {
      const c = catalogueDriver(id);
      let number = driverNumber(id, draft.baseYear);
      while (usedNumbers[number]) number = number + 1 > 99 ? 2 : number + 1; // two drivers with the same number
      usedNumbers[number] = id;
      drivers[id] = { id, code: id, first: c.first, last: c.last, country: c.country, headshot: c.headshot, number, team: t.id };
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
    calendar: draft.calendar.map((r, i) => ({ round: i + 1, circuit: r.circuit, sprint: !!r.sprint, date: dates[i], status: "PLANNED", sessions: {} })),
    teams: draft.teams.map(t => ({ id: t.id, name: t.name, colour: t.colour, drivers: t.drivers.slice() })),
    drivers,
    zones: JSON.parse(JSON.stringify(draft.zones || {})),
    phase: "PRESEASON",          // PRESEASON -> SEASON -> FINISHED
    nextRound: 0,
    standings: { drivers: {}, teams: {} },
    inbox: [],
    log: [{ date: new Date().toISOString(), text: "Season created by the FIA." }]
  };
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
