// =====================================================================
//  data.js
//  1. Variables that hold all data of the loaded session
//  2. Small helper functions
//  3. Downloading the data from the OpenF1 API (https://openf1.org)
// =====================================================================

const API = "https://api.openf1.org/v1/";

// ---------- 1. Data of the loaded session (used by all other files) ----------
let session = null;          // info about the session (null = nothing loaded yet)
let drivers = {};            // driver_number -> driver info (name, team, colour ...)
let results = {};            // driver_number -> final result (we only use it to know who retired)
let lapsByDriver = {};       // driver_number -> list of laps
let positionsByDriver = {};  // driver_number -> list of position changes
let intervalsByDriver = {};  // driver_number -> list of gaps
let stintsByDriver = {};     // driver_number -> list of tyre stints
let pits = [];
let weather = [];
let raceControl = [];        // messages from race control (flags, safety car ...)
let overtakes = [];
let teamRadio = [];
let events = [];             // overtakes + pit stops + race control in one list
let trackOutline = [];       // points of one lap, used to draw the track
let bounds = null;           // smallest and largest x/y of the track
let totalLaps = 0;
let marshalSectorCount = 0;  // the track is split into small "marshal sectors" for yellow flags

// Car positions and telemetry are a LOT of data, so we load them in pieces of 2 minutes.
const CHUNK = 2 * 60 * 1000;
let locationChunks = {};     // chunk start -> car positions, grouped by driver
let carDataChunks = {};      // "driver_chunkstart" -> telemetry of one driver

// ---------- The replay clock (all times in milliseconds) ----------
let startTime = 0;
let endTime = 0;
let currentTime = 0;


// =====================================================================
//  2. HELPER FUNCTIONS
// =====================================================================

// Wait for some milliseconds. Use it like: await sleep(500);
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

// Add a number "t" (time in milliseconds) to every item, then sort by it.
function addTimes(list, field) {
  for (const item of list) {
    item.t = Date.parse(item[field]);
  }
  list.sort((a, b) => a.t - b.t);
}

// Turn one long list into an object: { driverNumber: [items of that driver] }
function groupByDriver(list) {
  const groups = {};
  for (const item of list) {
    if (!groups[item.driver_number]) {
      groups[item.driver_number] = [];
    }
    groups[item.driver_number].push(item);
  }
  return groups;
}

// Find the newest item that happened before (or at) "time".
// The list must be sorted by time.
function latestBefore(list, time) {
  let result = null;
  if (!list) return null;
  for (const item of list) {
    if (item.t <= time) {
      result = item;
    } else {
      break; // the rest of the list is in the future
    }
  }
  return result;
}

// Which 2-minute piece does a time belong to?
function chunkStartOf(time) {
  return Math.floor(time / CHUNK) * CHUNK;
}

// Time in milliseconds -> "2024-11-03T16:00:00" (the format the API wants)
function isoTime(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}

// 83.407 -> "1:23.407"
function formatLapTime(seconds) {
  if (seconds == null) return "–";
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(3).padStart(6, "0");
  return minutes + ":" + rest;
}

// 3723000 ms -> "01:02:03"
function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// Short name like "VER" for a driver number
function driverName(number) {
  return drivers[number] ? drivers[number].name_acronym : "#" + number;
}

function teamColour(number) {
  const d = drivers[number];
  return d && d.team_colour ? "#" + d.team_colour : "#888888";
}


// =====================================================================
//  3. DOWNLOADING DATA
// =====================================================================

// The API allows only about 3 requests per second.
// So every request waits for "its turn", 350 ms after the one before.
let nextRequestAllowed = 0;

// Download data from the API.
// Example: getData("drivers", "session_key=9158")
async function getData(endpoint, params) {
  const url = API + endpoint + "?" + params;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const now = Date.now();
    const myTurn = Math.max(now, nextRequestAllowed);
    nextRequestAllowed = myTurn + 350;
    await sleep(myTurn - now);

    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      if (response.status === 429) { // 429 = "too many requests" -> wait and try again
        await sleep(3000);
        continue;
      }
      return []; // e.g. 404 = no data found
    } catch (error) {
      console.log("Network error:", error);
      await sleep(1000);
    }
  }
  return [];
}

// Download everything we need for one session
async function loadSession(key) {
  session = null; // stops the replay from drawing while we load
  locationChunks = {};
  carDataChunks = {};

  setStatus("Loading session info...");
  const info = (await getData("sessions", "session_key=" + key))[0];
  if (!info) {
    setStatus("Could not load this session.");
    return;
  }

  setStatus("Loading drivers...");
  drivers = {};
  for (const d of await getData("drivers", "session_key=" + key)) {
    drivers[d.driver_number] = d;
  }

  setStatus("Loading results...");
  results = {};
  for (const r of await getData("session_result", "session_key=" + key)) {
    results[r.driver_number] = r;
  }

  setStatus("Loading laps...");
  const laps = await getData("laps", "session_key=" + key);
  addTimes(laps, "date_start");
  laps.sort((a, b) => a.lap_number - b.lap_number);
  lapsByDriver = groupByDriver(laps);
  totalLaps = 0;
  for (const lap of laps) {
    totalLaps = Math.max(totalLaps, lap.lap_number);
  }

  setStatus("Loading positions...");
  const positions = await getData("position", "session_key=" + key);
  addTimes(positions, "date");
  positionsByDriver = groupByDriver(positions);

  setStatus("Loading gaps...");
  const intervals = await getData("intervals", "session_key=" + key);
  addTimes(intervals, "date");
  intervalsByDriver = groupByDriver(intervals);

  setStatus("Loading tyres...");
  const stints = await getData("stints", "session_key=" + key);
  stints.sort((a, b) => a.stint_number - b.stint_number);
  stintsByDriver = groupByDriver(stints);

  setStatus("Loading pit stops...");
  pits = await getData("pit", "session_key=" + key);
  addTimes(pits, "date");

  setStatus("Loading weather...");
  weather = await getData("weather", "session_key=" + key);
  addTimes(weather, "date");

  setStatus("Loading race control...");
  raceControl = await getData("race_control", "session_key=" + key);
  addTimes(raceControl, "date");

  setStatus("Loading overtakes...");
  overtakes = await getData("overtakes", "session_key=" + key);
  addTimes(overtakes, "date");

  setStatus("Loading team radio...");
  teamRadio = await getData("team_radio", "session_key=" + key);
  addTimes(teamRadio, "date");

  buildEvents();

  setStatus("Loading track shape...");
  await loadTrackOutline(key, laps, info.meeting_key);

  // ----- Set up the replay clock -----
  // Start 2 minutes before the session really started (it can be delayed!)
  startTime = Date.parse(info.date_start);
  const started = raceControl.find(r => r.message === "SESSION STARTED");
  if (started) {
    startTime = started.t - 2 * 60 * 1000;
  }

  // The planned end time can be too early (e.g. after a red flag),
  // so we also look at when the chequered flag was shown.
  endTime = Date.parse(info.date_end);
  for (const r of raceControl) {
    if (r.flag === "CHEQUERED") {
      endTime = Math.max(endTime, r.t + 3 * 60 * 1000);
    }
  }

  currentTime = startTime;
  session = info; // now everything is ready
  setStatus("");
}

// Put overtakes, pit stops and race control messages into one list
function buildEvents() {
  events = [];

  for (const o of overtakes) {
    events.push({
      t: o.t,
      type: "overtake",
      text: "<b>" + driverName(o.overtaking_driver_number) + "</b> overtakes " +
            driverName(o.overtaken_driver_number) + " for P" + o.position
    });
  }

  for (const p of pits) {
    let text = "<b>" + driverName(p.driver_number) + "</b> pit stop on lap " + p.lap_number;
    if (p.stop_duration) {
      text += " – stationary " + p.stop_duration + " s";
    } else if (p.pit_duration) {
      text += " – pit lane " + p.pit_duration + " s";
    }
    events.push({ t: p.t, type: "pit", text: text });
  }

  for (const r of raceControl) {
    // Flags and safety car messages get their own type (except blue flags, there are too many)
    let type = "control";
    if ((r.category === "Flag" && r.flag !== "BLUE") || r.category === "SafetyCar") {
      type = "flag";
    }
    events.push({ t: r.t, type: type, text: r.message });
  }

  events.sort((a, b) => a.t - b.t);
}

// Find a lap that has a time and is not an out-lap from the pits
function findGoodLap(laps) {
  return laps.find(lap => lap.lap_number > 1 && lap.lap_duration && !lap.is_pit_out_lap && lap.date_start);
}

// To draw the track, we take the car positions of one driver during one normal lap.
async function loadTrackOutline(key, laps, meetingKey) {
  trackOutline = [];
  bounds = null;
  marshalSectorCount = 0;

  let goodLap = findGoodLap(laps);
  let lapSessionKey = key;

  // Some sessions have no lap data. Then we borrow a lap from another
  // session of the same weekend - it's the same track!
  if (!goodLap) {
    const otherSessions = await getData("sessions", "meeting_key=" + meetingKey);
    for (const s of otherSessions) {
      if (s.session_key === Number(key)) continue;
      const otherLaps = await getData("laps", "session_key=" + s.session_key + "&lap_number=5");
      goodLap = findGoodLap(otherLaps);
      if (goodLap) {
        lapSessionKey = s.session_key;
        break; // found one, stop searching
      }
    }
  }
  if (!goodLap) return;

  const lapStart = Date.parse(goodLap.date_start);
  trackOutline = await getData("location",
    "session_key=" + lapSessionKey +
    "&driver_number=" + goodLap.driver_number +
    "&date>=" + isoTime(lapStart) +
    "&date<" + isoTime(lapStart + goodLap.lap_duration * 1000));
  bounds = findBounds(trackOutline);

  // How many marshal sectors does the track have?
  // The lap data has one "segment" per mini sector, so we count them.
  // (This is an estimate: we split the track into equal parts later.)
  marshalSectorCount = (goodLap.segments_sector_1 || []).length +
                       (goodLap.segments_sector_2 || []).length +
                       (goodLap.segments_sector_3 || []).length;
  for (const r of raceControl) {
    if (r.scope === "Sector" && r.sector > marshalSectorCount) {
      marshalSectorCount = r.sector;
    }
  }
}

// Find the smallest and largest x and y values
function findBounds(points) {
  if (points.length === 0) return null;
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

// Load the car positions of 2 minutes (all drivers at once)
async function loadLocationChunk(chunkStart) {
  if (!session || locationChunks[chunkStart] || chunkStart > endTime) return;

  locationChunks[chunkStart] = "loading";
  const data = await getData("location",
    "session_key=" + session.session_key +
    "&date>=" + isoTime(chunkStart) +
    "&date<" + isoTime(chunkStart + CHUNK));
  addTimes(data, "date");
  locationChunks[chunkStart] = groupByDriver(data);

  // If we had no track outline, use these points to find the size of the track
  if (!bounds) bounds = findBounds(data);
}

// Load the telemetry (speed, gear, throttle ...) of ONE driver for 2 minutes
async function loadCarDataChunk(number, chunkStart) {
  const name = number + "_" + chunkStart;
  if (!session || carDataChunks[name] || chunkStart > endTime) return;

  carDataChunks[name] = "loading";
  const data = await getData("car_data",
    "session_key=" + session.session_key +
    "&driver_number=" + number +
    "&date>=" + isoTime(chunkStart) +
    "&date<" + isoTime(chunkStart + CHUNK));
  addTimes(data, "date");
  carDataChunks[name] = data;
}
