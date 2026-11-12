// =====================================================================
//  season-tracks.js
//  The real circuits of the championship mode.
//  A circuit is built from the car positions and telemetry of a real
//  race (OpenF1, loadHistoricTrack() in historic.js). That needs ~5 API
//  requests, so the result is stored in the browser (IndexedDB) and every
//  later load is instant and works offline.
// =====================================================================

const TRACK_DB = "race-control";
const TRACK_DB_VERSION = 2;       // 2: + store "packs" (imported data packs)
const TRACK_STORE = "tracks";
const PACK_STORE = "packs";
const TRACK_CACHE_VERSION = 1;
let trackDbPromise = null;
const trackMemory = {}; // circuit key -> built track (this page load)

function openTrackDb() {
  if (trackDbPromise) return trackDbPromise;
  trackDbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(TRACK_DB, TRACK_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) db.createObjectStore(TRACK_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(PACK_STORE)) db.createObjectStore(PACK_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return trackDbPromise;
}

async function trackDbGet(key) {
  try {
    const db = await openTrackDb();
    return await new Promise(resolve => {
      const req = db.transaction(TRACK_STORE).objectStore(TRACK_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (error) {
    return null; // private window / storage blocked: just load from the API
  }
}

async function trackDbPut(value) {
  try {
    const db = await openTrackDb();
    await new Promise(resolve => {
      const tx = db.transaction(TRACK_STORE, "readwrite");
      tx.objectStore(TRACK_STORE).put(value);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (error) {
    // not stored – it will be loaded again next time
  }
}

async function trackDbDelete(key) {
  try {
    const db = await openTrackDb();
    await new Promise(resolve => {
      const tx = db.transaction(TRACK_STORE, "readwrite");
      tx.objectStore(TRACK_STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (error) {
    // nothing stored
  }
}

// Which circuits are already stored?
async function cachedTrackKeys() {
  try {
    const db = await openTrackDb();
    return await new Promise(resolve => {
      const req = db.transaction(TRACK_STORE).objectStore(TRACK_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (error) {
    return [];
  }
}

// Keep every k-th point so a track is ~600 points (enough for the spline in buildTrack)
function thinOut(list, max) {
  if (!list || list.length <= max) return list;
  const step = list.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

// Load the raw track data of a circuit: from the cache, or from OpenF1.
// Tries the newest meeting first; some meetings have no position data.
// Where the shape comes from:
//  1. a shape the player reloaded from OpenF1 on purpose (stored, "preferred")
//  2. the track file of the data pack (works offline, no API needed)
//  3. a shape stored in this browser earlier
//  4. OpenF1 (the newest race with usable data)
async function loadSeasonTrackData(circuitKey, status, forceReload) {
  status = status || (() => {});
  if (forceReload) {
    await trackDbDelete(circuitKey);
    delete trackMemory[circuitKey];
  } else {
    const cached = await trackDbGet(circuitKey);
    const cacheOk = cached && cached.version === TRACK_CACHE_VERSION;
    const usable = data => {
      try {
        buildSeasonTrackFromData(data);
        return true;
      } catch (error) {
        console.warn("Track " + circuitKey + ": stored shape not usable (" + error.message + ")");
        return false;
      }
    };
    if (cacheOk && cached.preferred && usable(cached)) return cached;
    const bundled = await loadTrackLayout(circuitKey);
    if (bundled && usable(bundled)) return bundled;
    if (cacheOk && usable(cached)) return cached;
  }

  const circuit = catalogueCircuit(circuitKey);
  if (!circuit) throw new Error("Unknown circuit " + circuitKey + " – is its data pack missing?");
  const name = circuitInfo(circuitKey).name;
  const fromApi = circuit.meetings.filter(m => m.race);
  if (!fromApi.length) throw new Error(name + ": no track shape in the data pack and no OpenF1 data (before 2023).");
  let lastError = null;

  for (const m of fromApi) {
    try {
      status(name + ": loading the " + m.year + " race...");
      const laps = await getData("laps", "session_key=" + m.race);
      if (laps.length < 50) throw new Error("no lap data");
      const pits = await getData("pit", "session_key=" + m.race);
      const raceControl = await getData("race_control", "session_key=" + m.race);
      for (const list of [pits, raceControl]) for (const item of list) item.t = Date.parse(item.date_start || item.date);
      status(name + ": loading the track shape...");
      const data = await loadHistoricTrack(m.race, laps, { circuit_short_name: name, location: circuit.location }, pits, raceControl);
      const value = {
        key: circuitKey,
        version: TRACK_CACHE_VERSION,
        year: m.year,
        session: m.race,
        name,
        points: thinOut(data.points, 700).map(p => [Math.round(p.x), Math.round(p.y)]),
        lengthMeters: Math.round(data.lengthMeters),
        speedSamples: data.speedSamples ? thinOut(data.speedSamples, 700).map(s => [Math.round(s.f * 100000) / 100000, Math.round(s.v * 10) / 10]) : null,
        marshalSectors: data.marshalSectors,
        pitLaneLength: Math.round(data.pitLaneLength),
        loaded: new Date().toISOString(),
        preferred: !!forceReload // reloaded on purpose: used instead of the track file of the pack
      };
      buildSeasonTrackFromData(value); // throws if the shape is unusable -> try an older race, don't cache it
      await trackDbPut(value);
      return value;
    } catch (error) {
      lastError = error;
      console.warn("Track " + circuitKey + " / " + m.year + ":", error.message);
      if (error.network) break; // OpenF1 can't be reached: an older race won't load either
    }
  }
  throw new Error(name + ": no usable track data (" + (lastError ? lastError.message : "unknown") + ")");
}

// The usable track (buildTrack) of a circuit, with the zones of the season
// Stored track data -> usable track. Throws if the data can't make a sane track.
function buildSeasonTrackFromData(raw) {
  if (!raw || !raw.points || raw.points.length < 50) throw new Error("track shape has too few points");
  // gaps in the position data (repeated points and long jumps) make sharp corners that are not there
  const q = trackDataQuality(raw.points.map(p => ({ x: p[0], y: p[1] })));
  if (q.repeated > 0.1 || q.jumpShare > 0.08) throw new Error("track shape has gaps in the position data");
  const tr = buildTrack({
    name: raw.name,
    points: raw.points.map(p => ({ x: p[0], y: p[1] })),
    lengthMeters: raw.lengthMeters,
    speedSamples: raw.speedSamples ? raw.speedSamples.map(s => ({ f: s[0], v: s[1] })) : null,
    smooth: 2,
    marshalSectors: raw.marshalSectors,
    pitLaneLength: raw.pitLaneLength
  });
  if (!(tr.length >= 2500 && tr.length <= 8000)) throw new Error("implausible track length " + Math.round(tr.length) + " m");
  return tr;
}

async function loadSeasonTrack(circuitKey, zones, status, forceReload) {
  if (forceReload) delete trackMemory[circuitKey];
  if (!trackMemory[circuitKey]) {
    let raw = await loadSeasonTrackData(circuitKey, status, forceReload);
    let tr;
    try {
      tr = buildSeasonTrackFromData(raw);
    } catch (error) {
      // a broken entry in the browser cache (or a broken track file): load it again from OpenF1
      console.warn("Track " + circuitKey + ": shape unusable (" + error.message + "), loading again");
      raw = await loadSeasonTrackData(circuitKey, status, true);
      tr = buildSeasonTrackFromData(raw);
    }
    trackMemory[circuitKey] = tr;
    tr.straightZones = makeStraightZones(tr);
    tr.autoZones = { drs: tr.drsZones.map(z => Object.assign({}, z)), straight: tr.straightZones.map(z => Object.assign({}, z)), overtakeDetect: overtakeDetectPoint(tr) };
    tr.autoTl = tr.corners.filter(c => c.trackLimits).map(c => c.number);
  }
  const track = trackMemory[circuitKey];
  applyZones(track, zones, circuitKey);
  return track;
}

// Put the zones on a track: the own zones of the season rulebook (zone editor) first,
// else the zones of the track editor of the start page (track-editor.js), else the automatic ones.
function applyZones(track, zones, circuitKey) {
  const a = track.autoZones;
  track.drsZones = a.drs.map(x => Object.assign({}, x));
  track.straightZones = a.straight.map(x => Object.assign({}, x));
  track.overtakeDetect = a.overtakeDetect;
  if (track.autoTl) for (const c of track.corners) c.trackLimits = track.autoTl.includes(c.number);
  if (typeof applyTrackEdits === "function") applyTrackEdits(track, circuitKey);
  if (zones) {
    if (zones.drs) track.drsZones = zones.drs.map(x => Object.assign({}, x));
    if (zones.straight) track.straightZones = zones.straight.map(x => Object.assign({}, x));
    if (zones.overtakeDetect !== undefined) track.overtakeDetect = zones.overtakeDetect;
  }
}


// ---------- Imported data packs (data-registry.js) ----------
// Packs the player imported (JSON files) are kept in the browser and
// registered again at every start.
async function packDbAll() {
  try {
    const db = await openTrackDb();
    return await new Promise(resolve => {
      const req = db.transaction(PACK_STORE).objectStore(PACK_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (error) {
    return [];
  }
}

async function packDbPut(pack) {
  const db = await openTrackDb(); // throws if the browser storage is blocked
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PACK_STORE, "readwrite");
    tx.objectStore(PACK_STORE).put(pack);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function packDbDelete(id) {
  try {
    const db = await openTrackDb();
    await new Promise(resolve => {
      const tx = db.transaction(PACK_STORE, "readwrite");
      tx.objectStore(PACK_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (error) {
    // nothing stored
  }
}

// At the start: register the imported packs (after the built-in ones)
async function loadImportedPacks() {
  const packs = await packDbAll();
  for (const pack of packs) registerPack(pack, { imported: true });
  return packs.length;
}

// Import a pack file. Returns { pack } or { problems: [...] }
async function importDataPack(text) {
  let pack;
  try {
    pack = JSON.parse(text);
  } catch (error) {
    return { problems: ["This is not a JSON file."] };
  }
  const builtIn = DATA_PACKS.find(p => p.builtIn && pack && p.pack.id === pack.id);
  if (builtIn) return { problems: ["A built-in pack with the id \"" + pack.id + "\" already exists."] };
  const problems = validatePack(pack);
  if (problems.length) return { problems };
  try {
    await packDbPut(pack);
  } catch (error) {
    return { problems: ["The pack could not be stored in this browser (" + (error && error.message || "storage blocked") + ")."] };
  }
  registerPack(pack, { imported: true });
  return { pack };
}

async function removeDataPack(id) {
  await packDbDelete(id);
  unregisterPack(id);
}
