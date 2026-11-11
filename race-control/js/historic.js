// =====================================================================
//  historic.js
//  Builds a race from a REAL race of the OpenF1 API:
//  - the real track shape and the real speed of the cars around the lap
//  - the real drivers, teams, colours and starting grid
//  - the pace of every driver (from the real lap times)
//  - the real tyre strategies and the real rain
//  - real incidents, track limits and retirements, injected at the real lap
//  The simulation engine then drives the race, so your decisions matter.
// =====================================================================

async function buildHistoricSetup(sessionKey, options, status) {
  status("Loading session info...");
  const info = (await getData("sessions", "session_key=" + sessionKey))[0];
  if (!info) throw new Error("This session could not be loaded.");

  status("Loading drivers...");
  const driverList = await getData("drivers", "session_key=" + sessionKey);
  status("Loading results...");
  const results = await getData("session_result", "session_key=" + sessionKey);
  status("Loading lap times...");
  const laps = await getData("laps", "session_key=" + sessionKey);
  status("Loading tyre stints...");
  const stints = await getData("stints", "session_key=" + sessionKey);
  status("Loading pit stops...");
  const pits = await getData("pit", "session_key=" + sessionKey);
  status("Loading weather...");
  const weather = await getData("weather", "session_key=" + sessionKey);
  status("Loading race control messages...");
  const raceControl = await getData("race_control", "session_key=" + sessionKey);

  // ----- qualifying is built differently -----
  if (isQualifyingSession(info)) {
    return buildHistoricQualifying(info, sessionKey, { driverList, results, laps, pits, weather, raceControl }, options, status);
  }

  const startMs = Date.parse(info.date_start);
  status("Loading the starting grid...");
  const positions = await getData("position", "session_key=" + sessionKey + "&date<" + isoTime(startMs + 10 * 60 * 1000));

  if (laps.length === 0) throw new Error("This session has no lap data in OpenF1.");

  for (const list of [laps, pits, weather, raceControl, positions]) {
    for (const item of list) item.t = Date.parse(item.date_start || item.date);
  }
  raceControl.sort((a, b) => a.t - b.t);
  positions.sort((a, b) => a.t - b.t);

  const realLaps = Math.max(...laps.map(l => l.lap_number));
  const totalLaps = Math.max(5, Math.round(realLaps * options.distance));
  const scaleLap = lap => clamp(Math.round(lap * totalLaps / realLaps), 1, totalLaps);

  // ----- 1. The track -----
  status("Loading the track shape...");
  const trackData = await loadHistoricTrack(sessionKey, laps, info, pits, raceControl);
  status("Building the track...");
  const track = buildTrack(trackData);

  // ----- 2. Driver pace from clean laps -----
  const clean = laps.filter(l => l.lap_duration && l.lap_number > 1 && !l.is_pit_out_lap);
  const fastest = Math.min(...clean.map(l => l.lap_duration));
  const byDriver = {};
  for (const l of clean) {
    if (l.lap_duration > fastest * 1.07) continue; // safety car laps, slow laps
    (byDriver[l.driver_number] = byDriver[l.driver_number] || []).push(l.lap_duration);
  }
  const medians = {};
  for (const n in byDriver) medians[n] = median(byDriver[n]);
  const bestMedian = Math.min(...Object.values(medians));

  // The ideal car of the simulation drives the real reference lap a bit faster
  // than the best median lap (the median includes fuel and worn tyres).
  const paceScale = track.refLapTime / (bestMedian * 0.975);

  // ----- 3. Grid -----
  const firstPosition = {};
  for (const p of positions) {
    if (firstPosition[p.driver_number] === undefined) firstPosition[p.driver_number] = p.position;
  }
  const resultByDriver = {};
  for (const r of results) resultByDriver[r.driver_number] = r;

  const teams = [];
  const entries = [];
  for (const d of driverList) {
    const result = resultByDriver[d.driver_number];
    if (result && result.dns) continue; // did not start
    if (!laps.some(l => l.driver_number === d.driver_number)) continue;

    let teamIndex = teams.indexOf(d.team_name);
    if (teamIndex < 0) {
      teams.push(d.team_name);
      teamIndex = teams.length - 1;
    }

    // character of the driver: always the same for the same driver number
    const own = makeRandom(d.driver_number * 7919 + 13);
    const pace = medians[d.driver_number] ? bestMedian / medians[d.driver_number] : 0.985;

    // tyre plan from the real stints
    const driverStints = stints.filter(s => s.driver_number === d.driver_number).sort((a, b) => a.stint_number - b.stint_number);
    const compound = s => {
      const c = (s && s.compound || "").toUpperCase();
      return TYRES[c] ? c : "MEDIUM";
    };
    const plan = [];
    for (let i = 1; i < driverStints.length; i++) {
      plan.push({ lap: scaleLap(driverStints[i].lap_start), compound: compound(driverStints[i]) });
    }

    entries.push({
      number: d.driver_number,
      code: d.name_acronym || ("#" + d.driver_number),
      name: d.full_name || d.broadcast_name || d.name_acronym,
      team: d.team_name || "Team",
      teamIndex,
      colour: d.team_colour ? "#" + d.team_colour : "#888888",
      headshot: d.headshot_url || null,
      pace: clamp(pace, 0.95, 1),
      aggression: 0.35 + own() * 0.5,
      consistency: 0.7 + own() * 0.25,
      racecraft: 0.6 + own() * 0.35,
      tyreMgmt: 0.55 + own() * 0.4,
      grid: firstPosition[d.driver_number] || 99,
      startCompound: compound(driverStints[0]),
      plan
    });
  }
  entries.sort((a, b) => a.grid - b.grid);
  entries.forEach((e, i) => { e.grid = i + 1; });

  // ----- 4. Weather (real rain becomes a rain schedule) -----
  // laps of the winner: used to find out "which lap was it at time t?"
  const winner = results.find(r => r.position === 1);
  const winnerNumber = winner ? winner.driver_number : entries[0].number;
  const leaderLaps = laps.filter(l => l.driver_number === winnerNumber).sort((a, b) => a.lap_number - b.lap_number);
  const lapAt = time => {
    let lap = 1;
    for (const l of leaderLaps) if (l.t <= time) lap = l.lap_number;
    return lap;
  };
  const w0 = weather[0] || {};
  const raceWeather = { air: Math.round(w0.air_temperature || 24), trackTemp: Math.round(w0.track_temperature || 35), schedule: [], initialRain: 0, initialWet: 0 };

  // The "rainfall" value switches on and off a lot, so we look at every lap:
  // how many of the weather records during this lap say "rain"?
  const rainOfLap = lap => {
    const from = leaderLaps.find(l => l.lap_number === lap);
    const to = leaderLaps.find(l => l.lap_number === lap + 1);
    if (!from || !from.t) return null;
    const end = to && to.t ? to.t : from.t + 120000;
    const records = weather.filter(w => w.t >= from.t - 60000 && w.t < end);
    if (records.length === 0) return null;
    const share = records.filter(w => w.rainfall).length / records.length;
    return share >= 0.3 ? Math.round((0.35 + 0.45 * share) * 20) / 20 : 0;
  };
  let lastRain = rainOfLap(1) || 0;
  raceWeather.initialRain = lastRain;
  raceWeather.initialWet = lastRain;
  for (let lap = 2; lap <= realLaps; lap++) {
    const rain = rainOfLap(lap);
    if (rain === null || Math.abs(rain - lastRain) < 0.1) continue;
    lastRain = rain;
    raceWeather.schedule.push({ lap: lap * totalLaps / realLaps - 0.5, rain });
  }
  if (raceWeather.initialRain > 0) {
    for (const e of entries) {
      if (TYRES[e.startCompound].slick) e.startCompound = "INTERMEDIATE";
    }
  }

  // ----- 5. Real events: incidents, track limits, retirements, safety cars -----
  const injections = [];
  const real = { scLaps: [], vscLaps: [], redLaps: [], incidents: [], realLaps };

  const lapOfMessage = m => m.lap_number || lapAt(m.t);
  for (const m of raceControl) {
    const msg = (m.message || "").toUpperCase();
    if (m.category === "SafetyCar" && msg.includes("VIRTUAL SAFETY CAR DEPLOYED")) real.vscLaps.push(lapOfMessage(m));
    else if (m.category === "SafetyCar" && msg.includes("SAFETY CAR DEPLOYED")) real.scLaps.push(lapOfMessage(m));
    if (m.flag === "RED" || msg.startsWith("RED FLAG")) real.redLaps.push(lapOfMessage(m));
  }

  if (options.realIncidents) {
    const found = parseRealIncidents(raceControl);
    for (const inc of found) {
      const lap = scaleLap(lapOfMessage(inc.message));
      injections.push({
        kind: "INCIDENT", lap, frac: rand(0.1, 0.9), cars: inc.cars, type: inc.type, reason: inc.reason,
        text: inc.message.message, real: { code: inc.code, culprit: inc.culprit, decisionText: inc.decisionText }
      });
      real.incidents.push({ lap: lapOfMessage(inc.message), text: inc.message.message, decision: inc.decisionText });
    }

    // track limits deletions (not too many)
    const tl = raceControl.filter(m => /DELETED - TRACK LIMITS/i.test(m.message || ""));
    for (const m of tl.slice(0, 40)) {
      const car = (m.message.match(/CAR (\d+)/) || [])[1];
      const turn = (m.message.match(/TURN (\d+)/) || [])[1];
      if (!car) continue;
      injections.push({ kind: "TL", lap: scaleLap(lapOfMessage(m)), frac: rand(0.1, 0.9), car: Number(car), turn: turn ? Number(turn) : null, text: m.message });
    }

    // real retirements
    for (const r of results) {
      if (!r.dnf || !entries.some(e => e.number === r.driver_number)) continue;
      const lastLap = r.number_of_laps || (laps.filter(l => l.driver_number === r.driver_number).length);
      const crash = raceControl.some(m => /COLLISION|CRASH|INCIDENT/i.test(m.message || "") &&
        (m.message || "").includes(" " + r.driver_number + " (") && Math.abs(lapOfMessage(m) - lastLap) <= 1);
      injections.push({ kind: "DNF", lap: scaleLap(Math.max(1, lastLap + 1)), frac: rand(0.1, 0.9), car: r.driver_number, crash });
    }
  }

  // ----- 6. Time of day (local time at the circuit) -----
  const clockStart = localClock(info) - 5 * 60;

  return {
    mode: "historic",
    regs: info.year >= 2026 ? "GEN2026" : "GE2023", // the real car generation of that year
    title: (info.country_name ? info.country_name + " " : "") + info.year + " · " + (info.circuit_short_name || info.location) + " · " + info.session_name,
    track,
    totalLaps,
    paceScale,
    incidentLevel: options.incidentLevel,
    clockStart,
    weather: raceWeather,
    entries,
    injections,
    real
  };
}

function isQualifyingSession(info) {
  return info.session_type === "Qualifying" || /qualifying|shootout/i.test(info.session_name || "");
}

// Seconds since midnight (local time at the circuit) when the session started
function localClock(info) {
  let offset = 0;
  if (info.gmt_offset) {
    const parts = info.gmt_offset.replace("-", "").split(":").map(Number);
    offset = (parts[0] * 3600 + (parts[1] || 0) * 60) * (info.gmt_offset.startsWith("-") ? -1 : 1);
  }
  const start = new Date(Date.parse(info.date_start));
  return start.getUTCHours() * 3600 + start.getUTCMinutes() * 60 + offset;
}


// =====================================================================
//  HISTORIC QUALIFYING
// =====================================================================
async function buildHistoricQualifying(info, sessionKey, data, options, status) {
  const { driverList, results, laps, pits, weather, raceControl } = data;
  for (const list of [laps, pits, weather, raceControl]) {
    for (const item of list) item.t = Date.parse(item.date_start || item.date);
  }
  raceControl.sort((a, b) => a.t - b.t);
  if (laps.length === 0) throw new Error("This session has no lap data in OpenF1.");

  const sprint = /sprint/i.test(info.session_name || "");
  const durations = (sprint ? SPRINT_QUALI_DURATIONS : QUALI_DURATIONS).map(d => Math.round(d * options.distance));

  status("Loading the track shape...");
  const trackData = await loadHistoricTrack(sessionKey, laps, info, pits, raceControl);
  status("Building the track...");
  const track = buildTrack(trackData);

  // ----- pace: the best lap of every driver -----
  const timed = laps.filter(l => l.lap_duration && !l.is_pit_out_lap);
  const overallBest = Math.min(...timed.map(l => l.lap_duration));
  const best = {};
  for (const l of timed) {
    if (l.lap_duration > overallBest * 1.07) continue;
    best[l.driver_number] = Math.min(best[l.driver_number] || Infinity, l.lap_duration);
  }
  // the simulated car loses a little on its push lap (tyre warm-up, wear, traffic), so the
  // ideal car is set ~1% faster than the real pole lap
  const paceScale = track.refLapTime / (overallBest * 0.988);

  const realResults = {};
  for (const r of results) if (r.position) realResults[r.driver_number] = r.position;

  const teams = [];
  const entries = [];
  driverList.forEach(d => {
    let teamIndex = teams.indexOf(d.team_name);
    if (teamIndex < 0) {
      teams.push(d.team_name);
      teamIndex = teams.length - 1;
    }
    const own = makeRandom(d.driver_number * 7919 + 13);
    entries.push({
      number: d.driver_number,
      code: d.name_acronym || ("#" + d.driver_number),
      name: d.full_name || d.broadcast_name || d.name_acronym,
      team: d.team_name || "Team",
      teamIndex,
      colour: d.team_colour ? "#" + d.team_colour : "#888888",
      headshot: d.headshot_url || null,
      pace: best[d.driver_number] ? clamp(overallBest / best[d.driver_number], 0.95, 1) : 0.97,
      aggression: 0.35 + own() * 0.5,
      consistency: 0.7 + own() * 0.25,
      racecraft: 0.6 + own() * 0.35,
      tyreMgmt: 0.55 + own() * 0.4,
      grid: 0,
      startCompound: "SOFT",
      plan: []
    });
  });
  // the order before the session: by car number, like the timing screen of a real session
  entries.sort((a, b) => a.number - b.number);
  entries.forEach((e, i) => { e.grid = i + 1; });

  // ----- real times -> simulated session clock -----
  const toSession = qualiTimeMapper(raceControl);
  const simOffset = t => {
    const m = toSession(t);
    if (!m) return null;
    const real = (sprint ? SPRINT_QUALI_DURATIONS : QUALI_DURATIONS)[m.segment - 1];
    // things reported after the chequered flag happen in the last seconds of the segment
    return { segment: m.segment, at: clamp(m.offset, 0, real - 8) * options.distance };
  };

  const injections = [];
  const real = { quali: true, results: realResults, redFlags: [], incidents: [] };
  for (const m of raceControl) {
    const msg = (m.message || "").toUpperCase();
    if (m.flag === "RED" || msg.startsWith("RED FLAG")) {
      const o = simOffset(m.t);
      if (o) real.redFlags.push(o);
    }
  }

  if (options.realIncidents) {
    for (const inc of parseRealIncidents(raceControl)) {
      const o = simOffset(inc.message.t);
      if (!o) continue;
      injections.push({
        kind: "INCIDENT", segment: o.segment, at: o.at, cars: inc.cars, type: inc.type, reason: inc.reason,
        text: inc.message.message, real: { code: inc.code, culprit: inc.culprit, decisionText: inc.decisionText }
      });
      real.incidents.push({ text: inc.message.message, decision: inc.decisionText });
    }
    const tl = raceControl.filter(m => /DELETED - TRACK LIMITS/i.test(m.message || ""));
    for (const m of tl.slice(0, 40)) {
      const car = (m.message.match(/CAR (\d+)/) || [])[1];
      const turn = (m.message.match(/TURN (\d+)/) || [])[1];
      const o = simOffset(m.t);
      if (!car || !o) continue;
      injections.push({ kind: "TL", segment: o.segment, at: o.at, car: Number(car), turn: turn ? Number(turn) : null, text: m.message });
    }
  }

  // ----- weather: real rain on the simulated session clock -----
  const lapSeconds = track.refLapTime / paceScale;
  const buckets = {};
  for (const w of weather) {
    const o = simOffset(w.t);
    if (!o) continue;
    const elapsed = durations.slice(0, o.segment - 1).reduce((a, b) => a + b, 0) + o.at;
    const k = Math.floor(elapsed / lapSeconds);
    buckets[k] = buckets[k] || { rain: 0, all: 0 };
    buckets[k].all++;
    if (w.rainfall) buckets[k].rain++;
  }
  const rainIn = k => {
    const b = buckets[k];
    if (!b) return null;
    const share = b.rain / b.all;
    return share >= 0.3 ? Math.round((0.35 + 0.45 * share) * 20) / 20 : 0;
  };
  const w0 = weather[0] || {};
  const raceWeather = { air: Math.round(w0.air_temperature || 24), trackTemp: Math.round(w0.track_temperature || 35), schedule: [], initialRain: rainIn(0) || 0 };
  raceWeather.initialWet = raceWeather.initialRain;
  let lastRain = raceWeather.initialRain;
  const maxK = Math.max(0, ...Object.keys(buckets).map(Number));
  for (let k = 1; k <= maxK; k++) {
    const rain = rainIn(k);
    if (rain === null || Math.abs(rain - lastRain) < 0.1) continue;
    lastRain = rain;
    raceWeather.schedule.push({ lap: k, rain });
  }

  return {
    mode: "historic",
    regs: info.year >= 2026 ? "GEN2026" : "GE2023", // the real car generation of that year
    session: "QUALI",
    sprint,
    qualiDurations: durations,
    title: (info.country_name ? info.country_name + " " : "") + info.year + " · " + (info.circuit_short_name || info.location) + " · " + info.session_name,
    track,
    totalLaps: 30,
    paceScale,
    incidentLevel: options.incidentLevel,
    clockStart: localClock(info),
    weather: raceWeather,
    entries,
    injections,
    real
  };
}

// Real time -> { segment, offset } on the session clock of that segment.
// Segments start with "GREEN LIGHT - PIT EXIT OPEN" and end with the chequered flag.
// The clock stops during a red flag, so red flag time is subtracted.
function qualiTimeMapper(raceControl) {
  const segments = [];
  let waitingForStart = true;
  let redSince = null;
  for (const m of raceControl) {
    const msg = (m.message || "").toUpperCase();
    if (msg.includes("PIT EXIT OPEN")) {
      if (waitingForStart) {
        segments.push({ start: m.t, pauses: [] });
        waitingForStart = false;
      } else if (redSince !== null) {
        segments[segments.length - 1].pauses.push([redSince, m.t]);
        redSince = null;
      }
      continue;
    }
    if (segments.length === 0) continue;
    if (m.flag === "RED" || msg.startsWith("RED FLAG")) redSince = m.t;
    if (m.flag === "CHEQUERED" || msg.includes("CHEQUERED FLAG")) {
      waitingForStart = true;
      redSince = null;
    }
  }
  return t => {
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (t < seg.start) continue;
      let offset = (t - seg.start) / 1000;
      for (const [a, b] of seg.pauses) {
        if (b <= t) offset -= (b - a) / 1000;
        else if (a <= t) offset -= (t - a) / 1000;
      }
      return { segment: Math.min(3, i + 1), offset };
    }
    return null;
  };
}

// Track shape from the car positions of one clean lap,
// track length and speed profile from the telemetry of the same lap.
async function loadHistoricTrack(sessionKey, laps, info, pits, raceControl) {
  const good = laps
    .filter(l => l.lap_number > 2 && l.lap_duration && !l.is_pit_out_lap && l.date_start)
    .sort((a, b) => a.lap_duration - b.lap_duration);
  const lap = good[Math.min(2, good.length - 1)];
  if (!lap) throw new Error("No clean lap found to draw the track.");

  const lapStart = Date.parse(lap.date_start);
  const window = "&date>=" + isoTime(lapStart) + "&date<" + isoTime(lapStart + lap.lap_duration * 1000);
  const location = await getData("location", "session_key=" + sessionKey + "&driver_number=" + lap.driver_number + window);
  const carData = await getData("car_data", "session_key=" + sessionKey + "&driver_number=" + lap.driver_number + window);

  const points = location.filter(p => p.x !== 0 || p.y !== 0).map(p => ({ x: p.x, y: p.y }));
  if (points.length < 50) throw new Error("Not enough position data to draw the track.");

  // track length = speed integrated over the lap
  let lengthMeters = null;
  let speedSamples = null;
  if (carData.length > 50) {
    carData.forEach(c => { c.t = Date.parse(c.date); });
    carData.sort((a, b) => a.t - b.t);
    let distance = 0;
    const samples = [{ d: 0, v: carData[0].speed / 3.6 }];
    for (let i = 1; i < carData.length; i++) {
      const dt = (carData[i].t - carData[i - 1].t) / 1000;
      distance += (carData[i].speed + carData[i - 1].speed) / 2 / 3.6 * dt;
      samples.push({ d: distance, v: carData[i].speed / 3.6 });
    }
    lengthMeters = distance;
    speedSamples = samples.map(s => ({ f: s.d / distance, v: s.v }));
  }
  if (!lengthMeters || lengthMeters < 2500 || lengthMeters > 8000) {
    lengthMeters = clamp(lap.lap_duration * 58, 3300, 7000); // rough guess: average speed ~ 210 km/h
    speedSamples = null;
  }

  const marshalSectors = (lap.segments_sector_1 || []).length + (lap.segments_sector_2 || []).length + (lap.segments_sector_3 || []).length;
  let maxSector = 0;
  for (const r of raceControl) if (r.scope === "Sector" && r.sector) maxSector = Math.max(maxSector, r.sector);

  // pit lane length from the real pit lane times (time in the lane at 80 km/h minus the stop)
  const laneTimes = pits.map(p => p.lane_duration || p.pit_duration).filter(t => t && t > 12 && t < 40);
  const laneTime = laneTimes.length ? median(laneTimes) : 22;
  const pitLaneLength = clamp((laneTime - 2.5) * PIT_SPEED, 280, 600);

  return {
    name: info.circuit_short_name || info.location,
    points,
    lengthMeters,
    speedSamples,
    smooth: 2,
    marshalSectors: clamp(Math.max(marshalSectors, maxSector) || Math.round(lengthMeters / 260), 12, 30),
    pitLaneLength
  };
}

// Find the real incidents in the race control messages, and what the stewards decided
function parseRealIncidents(raceControl) {
  const carsOf = text => {
    const list = [];
    const re = /(\d+) \(([A-Z]{3})\)/g;
    let m;
    while ((m = re.exec(text)) !== null) list.push(Number(m[1]));
    return list;
  };
  const reasonOf = text => {
    const i = text.lastIndexOf(" - ");
    return i >= 0 ? text.slice(i + 3).trim() : "";
  };

  const incidents = [];
  const seen = {};
  for (const m of raceControl) {
    const text = (m.message || "").toUpperCase().replace(/^UPDATE:\s*/, "");
    if (text.includes("DELETED")) continue;
    const opening = text.includes(" NOTED") || text.includes("UNDER INVESTIGATION") || text.includes("WILL BE INVESTIGATED AFTER THE");
    if (!opening) continue;
    const cars = carsOf(text);
    if (cars.length === 0) continue;
    const reason = reasonOf(text);
    const turn = (text.match(/TURN (\d+)/) || [])[1] || "";
    // the same cars at the same place = the same incident, if the reason is the same
    // or one message has no reason yet ("UPDATE:" messages often only add the reason)
    const key = cars.slice().sort((a, b) => a - b).join(",") + "|" + turn;
    const known = (seen[key] || []).find(k => !k.reason || !reason || k.reason === reason);
    if (known) {
      if (!known.reason && reason) {
        known.reason = reason;
        known.type = typeFromReason(reason);
      }
      continue;
    }
    const inc = { message: m, cars, reason, type: typeFromReason(reason) };
    (seen[key] = seen[key] || []).push(inc);
    incidents.push(inc);
  }

  const used = new Set(); // every decision message belongs to one incident only
  const decide = (inc, m, code, cars) => {
    inc.code = code;
    inc.culprit = code === "NFA" ? null : cars[0];
    inc.decisionText = m.message;
    used.add(m);
  };

  // 1st round: find the decision for every incident (same cars, same reason)
  for (const inc of incidents) {
    for (const m of raceControl) {
      if (m.t < inc.message.t || used.has(m)) continue;
      const text = (m.message || "").toUpperCase();
      if (text.includes("PENALTY SERVED")) continue;
      const cars = carsOf(text);
      if (!cars.some(c => inc.cars.includes(c))) continue;
      const reason = reasonOf(text);
      if (reason && inc.reason && reason !== inc.reason) continue;
      // without a reason in one of the messages, the cars must be exactly the same
      const sameCars = cars.length === inc.cars.length && cars.every(c => inc.cars.includes(c));
      const isPenalty = /PENALTY|DISQUALIF|REPRIMAND|WARNING/.test(text);
      if ((!reason || !inc.reason) && !sameCars && !isPenalty) continue;

      const code = decisionCode(text);
      if (!code) continue;
      decide(inc, m, code, cars);
      break;
    }
  }

  // 2nd round: the stewards sometimes punish a different offence than the one investigated
  // (e.g. investigated "forcing off", penalty for "more than one change of direction")
  for (const inc of incidents) {
    if (inc.code) continue;
    for (const m of raceControl) {
      if (m.t < inc.message.t || used.has(m)) continue;
      const text = (m.message || "").toUpperCase();
      if (text.includes("PENALTY SERVED") || !/PENALTY|DISQUALIF|REPRIMAND/.test(text)) continue;
      const cars = carsOf(text);
      if (cars.length !== 1 || !inc.cars.includes(cars[0])) continue;
      const code = decisionCode(text);
      if (!code) continue;
      decide(inc, m, code, cars);
      break;
    }
  }
  return incidents;
}

// What did the stewards decide? (text of a race control message -> penalty code)
function decisionCode(text) {
  if (/5 SECOND TIME PENALTY/.test(text)) return "5S";
  if (/10 SECOND TIME PENALTY/.test(text)) return "10S";
  if (/20 SECOND|DRIVE THROUGH/.test(text)) return "DT";
  if (/STOP\/GO|STOP AND GO|STOP-GO/.test(text)) return "SG10";
  if (/DISQUALIF/.test(text)) return "DSQ";
  const grid = text.match(/(\d+)[ -]PLACE GRID/);
  if (grid) return Number(grid[1]) >= 10 ? "GRID10" : Number(grid[1]) >= 5 ? "GRID5" : "GRID3";
  if (/BACK OF THE GRID|PIT LANE START/.test(text)) return "BACK";
  if (/LAP TIME.*DELETED|TIME DELETED|DELETION OF/.test(text)) return "DELETE_LAP";
  if (/\bFINE\b|€|EUR \d/.test(text)) return "FINE";
  if (/REPRIMAND/.test(text)) return "REPRIMAND";
  if (/WARNING/.test(text)) return "WARNING";
  if (/NO FURTHER (ACTION|INVESTIGATION)/.test(text)) return "NFA";
  return null;
}

function typeFromReason(reason) {
  const r = reason.toUpperCase();
  if (r.includes("COLLISION")) return "COLLISION";
  if (r.includes("FORCING")) return "FORCING_OFF";
  if (r.includes("LEAVING THE TRACK") || r.includes("GAINING")) return "LEAVING_TRACK";
  if (r.includes("SPEEDING") || r.includes("PIT LANE SPEED")) return "PIT_SPEEDING";
  if (r.includes("UNSAFE RELEASE")) return "UNSAFE_RELEASE";
  if (r.includes("FALSE START") || r.includes("JUMP") || r.includes("START PROCEDURE") || r.includes("POSITION AT THE START")) return "JUMP_START";
  if (r.includes("TRACK LIMITS")) return "TRACK_LIMITS_REPEAT";
  if (r.includes("BLUE")) return "BLUE_FLAGS";
  if (r.includes("MAXIMUM DELTA") || r.includes("RACE DIRECTOR") || r.includes("INSTRUCTIONS")) return "RD_INSTRUCTIONS";
  if (r.includes("IMPEDING")) return "IMPEDING";
  if (r.includes("YELLOW")) return "YELLOW_FLAG";
  if (r.includes("CHANGE OF DIRECTION") || r.includes("MOVING UNDER BRAKING") || r.includes("ERRATIC")) return "DEFENDING";
  if (r.includes("REJOIN")) return "UNSAFE_REJOIN";
  if (r.includes("PIT EXIT") || r.includes("WHITE LINE")) return "PIT_EXIT";
  return "OTHER";
}
