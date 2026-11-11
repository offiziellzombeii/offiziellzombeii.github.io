// =====================================================================
//  season-tracks.js
//  The real circuits of the championship mode.
//  A circuit is built from the car positions and telemetry of a real
//  race (OpenF1, loadHistoricTrack() in historic.js). That needs ~5 API
//  requests, so the result is stored in the browser (IndexedDB) and every
//  later load is instant and works offline.
// =====================================================================

const TRACK_DB = "race-control";
const TRACK_STORE = "tracks";
const TRACK_CACHE_VERSION = 1;
let trackDbPromise = null;
const trackMemory = {}; // circuit key -> built track (this page load)

function openTrackDb() {
  if (trackDbPromise) return trackDbPromise;
  trackDbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(TRACK_DB, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) db.createObjectStore(TRACK_STORE, { keyPath: "key" });
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
async function loadSeasonTrackData(circuitKey, status) {
  status = status || (() => {});
  const cached = await trackDbGet(circuitKey);
  if (cached && cached.version === TRACK_CACHE_VERSION) return cached;

  const circuit = catalogueCircuit(circuitKey);
  if (!circuit) throw new Error("Unknown circuit " + circuitKey);
  const name = circuitInfo(circuitKey).name;
  let lastError = null;

  for (const m of circuit.meetings) {
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
        loaded: new Date().toISOString()
      };
      await trackDbPut(value);
      return value;
    } catch (error) {
      lastError = error;
      console.log("Track " + circuitKey + " / " + m.year + ":", error.message);
    }
  }
  throw new Error(name + ": no usable track data (" + (lastError ? lastError.message : "unknown") + ")");
}

// The usable track (buildTrack) of a circuit, with the zones of the season
async function loadSeasonTrack(circuitKey, zones, status) {
  if (!trackMemory[circuitKey]) {
    const raw = await loadSeasonTrackData(circuitKey, status);
    trackMemory[circuitKey] = buildTrack({
      name: raw.name,
      points: raw.points.map(p => ({ x: p[0], y: p[1] })),
      lengthMeters: raw.lengthMeters,
      speedSamples: raw.speedSamples ? raw.speedSamples.map(s => ({ f: s[0], v: s[1] })) : null,
      smooth: 2,
      marshalSectors: raw.marshalSectors,
      pitLaneLength: raw.pitLaneLength
    });
    const tr = trackMemory[circuitKey];
    tr.straightZones = makeStraightZones(tr);
    tr.autoZones = { drs: tr.drsZones.map(z => Object.assign({}, z)), straight: tr.straightZones.map(z => Object.assign({}, z)), overtakeDetect: overtakeDetectPoint(tr) };
  }
  const track = trackMemory[circuitKey];
  applyZones(track, zones);
  return track;
}

// Put the zones of the season rulebook (zone editor) on a track.
// Without own zones the automatic zones are used.
function applyZones(track, zones) {
  const z = zones || track.autoZones;
  track.drsZones = (z.drs || track.autoZones.drs).map(x => Object.assign({}, x));
  track.straightZones = (z.straight || track.autoZones.straight).map(x => Object.assign({}, x));
  track.overtakeDetect = z.overtakeDetect !== undefined ? z.overtakeDetect : track.autoZones.overtakeDetect;
}
