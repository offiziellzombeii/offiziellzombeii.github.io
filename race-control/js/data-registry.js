// =====================================================================
//  data-registry.js
//  The data of the championship mode comes from DATA PACKS: circuits,
//  teams and drivers of any era. A pack is a plain object:
//
//  { format: "rc-pack", version: 1, id, name, source,
//    circuits: [{ key, name, country, location, layout?, layoutData?, character?,
//                 meetings: [{ year, gp, date, laps, sprint, race?, quali?, ... }] }],
//    teams:    [{ id, years: { 2020: { name, colour, drivers: [..], avgFinish, engine? } } }],
//    drivers:  [{ id, first, last, country, headshot?,
//                 seasons: { 2020: { number, team, races, dnf, points, h2hQ, h2hR, avgFinish, avgQuali } } }],
//    character: { circuitKey: { short, power, downforce, tyres, overtaking, street, rain, air, wind, night } } }
//
//  - circuit "key": the OpenF1 circuit key (a number) for circuits raced
//    since 2023, a text for others ("nurburgring")
//  - "layout": path of a track file (data/tracks/<key>.js) that calls
//    registerTrackLayout(); "layoutData": the same data inside the pack
//    (imported packs). Without both, the shape is loaded from OpenF1.
//
//  Built-in packs are script files (data/*.js) that call registerPack().
//  Imported packs (JSON files) are stored in the browser (season-tracks.js).
//  Several packs add up: the same circuit / driver / team gets the meetings /
//  seasons of every pack. The merged result is SEASON_CATALOGUE and
//  CIRCUIT_CHARACTER – the rest of the program only reads those.
// =====================================================================

const PACK_FORMAT = "rc-pack";
const PACK_VERSION = 1;
// paths in the packs ("data/tracks/15.js") are relative to the race-control folder –
// the folder above this script, so they also work from tools/pack-builder.html
const DATA_BASE = document.currentScript && document.currentScript.src ? new URL("../", document.currentScript.src).href : "";

const SEASON_CATALOGUE = { circuits: [], drivers: [], teams: [] };
const CIRCUIT_CHARACTER = {};
const SEASON_YEARS = [];          // every year with a calendar in the packs
const DATA_PACKS = [];            // the registered packs (in order)
const TRACK_LAYOUTS = {};         // circuit key -> track shape (from a track file or a pack)
const catalogueIndex = { circuits: new Map(), drivers: new Map(), teams: new Map() };

// "15" -> 15 (OpenF1 key), "nurburgring" stays a text
function circuitKeyOf(key) {
  if (typeof key === "number") return key;
  const n = Number(key);
  return key !== "" && key !== null && key !== undefined && Number.isFinite(n) ? n : String(key);
}

// ---------- Checking a pack ----------
function validatePack(pack) {
  const problems = [];
  if (!pack || typeof pack !== "object") return ["This is not a data pack."];
  if (pack.format !== PACK_FORMAT) problems.push("Not a Race Control data pack (format \"" + pack.format + "\").");
  if (pack.version !== PACK_VERSION) problems.push("Pack version " + pack.version + " is not supported (expected " + PACK_VERSION + ").");
  if (!pack.id || typeof pack.id !== "string") problems.push("The pack has no id.");
  for (const c of pack.circuits || []) {
    if (c.key === undefined || c.key === null || c.key === "") problems.push("A circuit has no key.");
    if (!Array.isArray(c.meetings)) problems.push("Circuit " + c.key + " has no meetings list.");
    if (c.layoutData && !(Array.isArray(c.layoutData.points) && c.layoutData.points.length >= 50)) problems.push("Circuit " + c.key + ": the track shape has too few points.");
  }
  for (const d of pack.drivers || []) {
    if (!d.id || !d.seasons) problems.push("A driver has no id or no seasons.");
  }
  for (const t of pack.teams || []) {
    if (!t.id || !t.years) problems.push("A team has no id or no years.");
  }
  // references: drivers of the teams must exist in this pack or in a registered pack
  const known = new Set((pack.drivers || []).map(d => d.id).concat(SEASON_CATALOGUE.drivers.map(d => d.id)));
  for (const t of pack.teams || []) {
    for (const y in t.years) for (const id of t.years[y].drivers || []) {
      if (!known.has(id)) problems.push("Team " + t.id + " (" + y + "): unknown driver " + id + ".");
    }
  }
  return problems.slice(0, 8);
}

// ---------- Registering ----------
// options: { builtIn: true } for the packs that come with the program
function registerPack(pack, options) {
  options = options || {};
  const problems = validatePack(pack);
  if (problems.length) {
    console.warn("Data pack " + (pack && pack.id) + " not loaded:", problems);
    return problems;
  }
  const old = DATA_PACKS.findIndex(p => p.pack.id === pack.id);
  const entry = { pack, builtIn: !!options.builtIn, imported: !!options.imported };
  if (old >= 0) DATA_PACKS[old] = entry;
  else DATA_PACKS.push(entry);
  rebuildCatalogue();
  return [];
}

function unregisterPack(id) {
  const i = DATA_PACKS.findIndex(p => p.pack.id === id);
  if (i < 0) return;
  DATA_PACKS.splice(i, 1);
  rebuildCatalogue();
}

// A track file (data/tracks/<key>.js) calls this
function registerTrackLayout(layout) {
  if (!layout || layout.key === undefined) return;
  TRACK_LAYOUTS[String(layout.key)] = layout;
}

// Merge all packs into the catalogue (the arrays / objects are kept, only their content changes)
function rebuildCatalogue() {
  SEASON_CATALOGUE.circuits.length = 0;
  SEASON_CATALOGUE.drivers.length = 0;
  SEASON_CATALOGUE.teams.length = 0;
  for (const k in CIRCUIT_CHARACTER) delete CIRCUIT_CHARACTER[k];
  catalogueIndex.circuits.clear();
  catalogueIndex.drivers.clear();
  catalogueIndex.teams.clear();

  for (const { pack } of DATA_PACKS) {
    for (const src of pack.circuits || []) {
      const key = circuitKeyOf(src.key);
      let c = catalogueIndex.circuits.get(String(key));
      if (!c) {
        c = { key, name: src.name, country: src.country, location: src.location, meetings: [], packs: [] };
        catalogueIndex.circuits.set(String(key), c);
        SEASON_CATALOGUE.circuits.push(c);
      }
      c.packs.push(pack.id);
      for (const field of ["name", "country", "location"]) if (!c[field] && src[field]) c[field] = src[field];
      if (src.layout) c.layout = src.layout;
      if (src.layoutData) TRACK_LAYOUTS[String(key)] = Object.assign({ key, name: src.name }, src.layoutData);
      for (const m of src.meetings || []) {
        if (!c.meetings.some(x => x.year === m.year && x.gp === m.gp)) c.meetings.push(Object.assign({}, m));
      }
      c.meetings.sort((a, b) => b.year - a.year || (b.date || "").localeCompare(a.date || ""));
      if (src.character) CIRCUIT_CHARACTER[key] = Object.assign({}, CIRCUIT_CHARACTER[key], src.character);
    }
    for (const k in pack.character || {}) {
      const key = circuitKeyOf(k);
      CIRCUIT_CHARACTER[key] = Object.assign({}, CIRCUIT_CHARACTER[key], pack.character[k]);
    }
    for (const src of pack.drivers || []) {
      let d = catalogueIndex.drivers.get(src.id);
      if (!d) {
        d = { id: src.id, first: src.first, last: src.last, country: src.country, headshot: src.headshot || null, seasons: {}, packs: [] };
        catalogueIndex.drivers.set(src.id, d);
        SEASON_CATALOGUE.drivers.push(d);
      }
      d.packs.push(pack.id);
      if (src.headshot && !d.headshot) d.headshot = src.headshot;
      if (src.code && !d.code) d.code = String(src.code).slice(0, 3).toUpperCase();
      Object.assign(d.seasons, src.seasons);
    }
    for (const src of pack.teams || []) {
      let t = catalogueIndex.teams.get(src.id);
      if (!t) {
        t = { id: src.id, years: {}, packs: [] };
        catalogueIndex.teams.set(src.id, t);
        SEASON_CATALOGUE.teams.push(t);
      }
      t.packs.push(pack.id);
      Object.assign(t.years, src.years);
    }
  }

  // the years that have a calendar (base seasons for a new championship)
  const years = new Set();
  for (const c of SEASON_CATALOGUE.circuits) for (const m of c.meetings) years.add(m.year);
  SEASON_YEARS.length = 0;
  for (const y of [...years].sort((a, b) => a - b)) SEASON_YEARS.push(y);
}

// ---------- Track files ----------
// The track shape of a circuit from a built-in track file or a pack (null = none: load from OpenF1)
const layoutLoading = {};
function loadTrackLayout(key) {
  const k = String(key);
  if (TRACK_LAYOUTS[k]) return Promise.resolve(TRACK_LAYOUTS[k]);
  const c = catalogueIndex.circuits.get(k);
  if (!c || !c.layout) return Promise.resolve(null);
  if (!layoutLoading[k]) {
    layoutLoading[k] = new Promise(resolve => {
      const script = document.createElement("script");
      script.src = DATA_BASE ? new URL(c.layout, DATA_BASE).href : c.layout;
      script.onload = () => resolve(TRACK_LAYOUTS[k] || null);
      script.onerror = () => {
        delete layoutLoading[k]; // try again next time
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }
  return layoutLoading[k];
}

function hasBundledLayout(key) {
  const c = catalogueIndex.circuits.get(String(key));
  return !!(TRACK_LAYOUTS[String(key)] || (c && c.layout));
}

// Which packs does a season use? (to tell the player what to import when one is missing)
function packsUsedBy(calendar, driverIds, teamIds) {
  const ids = new Set();
  for (const r of calendar) {
    const c = catalogueIndex.circuits.get(String(r.circuit));
    if (c) c.packs.forEach(p => ids.add(p));
  }
  for (const id of driverIds) {
    const d = catalogueIndex.drivers.get(id);
    if (d) d.packs.forEach(p => ids.add(p));
  }
  for (const id of teamIds) {
    const t = catalogueIndex.teams.get(id);
    if (t) t.packs.forEach(p => ids.add(p));
  }
  return [...ids];
}
