// =====================================================================
//  race.js
//  Functions that answer questions about the race at "currentTime".
//  For example: "Which lap is driver 44 on?" or "Is there a safety car?"
// =====================================================================

// Which lap is the driver on?
function currentLap(number) {
  let lapNumber = 1;
  for (const lap of lapsByDriver[number] || []) {
    if (lap.t <= currentTime) lapNumber = lap.lap_number;
  }
  return lapNumber;
}

// All laps the driver has already finished
function finishedLaps(number) {
  return (lapsByDriver[number] || []).filter(lap =>
    lap.lap_duration && lap.t + lap.lap_duration * 1000 <= currentTime);
}

// The fastest time in a list of laps (or null)
function bestLapTime(laps) {
  let best = null;
  for (const lap of laps) {
    if (best === null || lap.lap_duration < best) best = lap.lap_duration;
  }
  return best;
}

// The tyre stint the driver uses on a lap
function currentStint(number, lap) {
  for (const s of stintsByDriver[number] || []) {
    const end = s.lap_end || 999; // lap_end is empty for the last stint
    if (lap >= s.lap_start && lap <= end) return s;
  }
  return null;
}

// How many pit stops has the driver made so far?
function countPits(number) {
  return pits.filter(p => p.driver_number === Number(number) && p.t <= currentTime).length;
}

// Is the driver in the pit lane right now?
// The "date" of a pit stop is when the car LEAVES the pit lane,
// so the car was in the pit lane during the "lane_duration" seconds before that.
function isInPit(number) {
  for (const p of pits) {
    if (p.driver_number !== Number(number)) continue;
    const seconds = p.lane_duration || p.pit_duration || 25;
    if (currentTime >= p.t - seconds * 1000 && currentTime <= p.t) return true;
  }
  return false;
}

// Has the driver retired (DNF) already?
function isRetired(number) {
  const result = results[number];
  if (!result || !(result.dnf || result.dns)) return false;

  const laps = lapsByDriver[number] || [];
  // Without lap data we don't know WHEN they retired,
  // so we only mark drivers who never started (DNS).
  if (laps.length === 0) return result.dns === true;

  // We guess they retired at the end of their last lap
  const last = laps[laps.length - 1];
  const lastLapStart = last.t || startTime;
  const retiredAt = lastLapStart + (last.lap_duration || 120) * 1000;
  return currentTime > retiredAt;
}

// One row of information per driver, sorted by position
function getStandings() {
  const rows = [];

  for (const number in drivers) {
    const list = positionsByDriver[number] || [];
    const now = latestBefore(list, currentTime) || list[0];

    rows.push({
      number: Number(number),
      position: now ? now.position : 99,
      startPosition: list.length > 0 ? list[0].position : null,
      lap: currentLap(number),
      interval: latestBefore(intervalsByDriver[number], currentTime),
      retired: isRetired(number),
      inPit: isInPit(number)
    });
  }

  rows.sort((a, b) => {
    if (a.retired !== b.retired) {
      return a.retired ? 1 : -1; // retired drivers go to the bottom
    }
    return a.position - b.position;
  });
  return rows;
}

// Two cars are "in a battle" when they are less than 1 second apart
function getBattles(standings) {
  const battles = [];
  for (let i = 1; i < standings.length; i++) {
    const car = standings[i];
    const ahead = standings[i - 1];
    if (car.retired || ahead.retired || car.inPit || ahead.inPit) continue;

    const gap = car.interval ? car.interval.interval : null;
    if (typeof gap === "number" && gap < 1.0) {
      battles.push({ ahead: ahead.number, behind: car.number, gap: gap, position: ahead.position });
    }
  }
  return battles;
}

// Read all race control messages up to now and find out the track status.
// Result example: { main: "SC", yellowSectors: { 5: "DOUBLE YELLOW" } }
function getTrackStatus() {
  const status = { main: "GREEN", yellowSectors: {} };

  for (const r of raceControl) {
    if (r.t > currentTime) break; // the rest is in the future
    const message = r.message || "";

    if (r.category === "SafetyCar") {
      // Check "VIRTUAL" first, because "VIRTUAL SAFETY CAR DEPLOYED" also contains "SAFETY CAR DEPLOYED"
      if (message.includes("VIRTUAL SAFETY CAR DEPLOYED") || message.includes("VSC DEPLOYED")) status.main = "VSC";
      else if (message.includes("VIRTUAL SAFETY CAR ENDING") || message.includes("VSC ENDING")) status.main = "VSC_ENDING";
      else if (message.includes("SAFETY CAR DEPLOYED")) status.main = "SC";
      else if (message.includes("SAFETY CAR IN THIS LAP")) status.main = "SC_ENDING";
    }

    if (r.category === "SessionStatus") {
      // The session continues after a red flag
      if (message === "SESSION STARTED" && status.main === "RED") status.main = "GREEN";
      // The session is over (sometimes it ends while the red flag is still out)
      if (message === "SESSION FINISHED") status.main = "FINISHED";
    }


    if (r.category === "Flag") {
      if (r.flag === "RED" || r.message.toUpperCase().startsWith("RED FLAG")) {
        status.main = "RED";
        status.yellowSectors = {};
      } else if (r.flag === "CHEQUERED") {
        status.main = "CHEQUERED";
      } else if (r.scope === "Track" && (r.flag === "GREEN" || r.flag === "CLEAR")) {
        // Careful: during a red flag, "TRACK CLEAR" only means the crash has been cleaned up.
        // The session is still stopped until the green light ("GREEN LIGHT - PIT EXIT OPEN").
        const stillRed = status.main === "RED" && r.flag === "CLEAR";
        if (!stillRed) {
          status.main = "GREEN";
          status.yellowSectors = {};
        }
      } else if (r.scope === "Track" && (r.flag === "YELLOW" || r.flag === "DOUBLE YELLOW")) {
        status.main = "YELLOW";
      } else if (r.scope === "Sector") {
        if (r.flag === "YELLOW" || r.flag === "DOUBLE YELLOW") {
          status.yellowSectors[r.sector] = r.flag;
        } else if (r.flag === "CLEAR" || r.flag === "GREEN") {
          delete status.yellowSectors[r.sector];
        }
      }
    }

    if (r.category === "Other" && r.message.toUpperCase().startsWith("RED FLAG")) {
      status.main = "RED";
      status.yellowSectors = {};
    }
    
  }
  return status;
}

// Is the race neutralised (safety car, VSC or red flag)?
function isNeutralised(status) {
  return ["SC", "SC_ENDING", "VSC", "VSC_ENDING", "RED"].includes(status.main);
}

// Where is a car at "time"? We take the two nearest points and go
// part of the way between them (this makes the movement smooth).
function getCarPosition(number, time) {
  const chunk = locationChunks[chunkStartOf(time)];
  if (!chunk || chunk === "loading") return null;
  const points = chunk[number];
  if (!points || points.length === 0) return null;

  let i = 0;
  while (i < points.length - 1 && points[i + 1].t <= time) {
    i++;
  }
  const a = points[i];
  const b = points[i + 1];
  if (!b || time < a.t) return a;

  const fraction = (time - a.t) / (b.t - a.t); // 0 = at point a, 1 = at point b
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction
  };
}

// Telemetry (speed, gear ...) of a driver at "time"
function getCarData(number, time) {
  const chunk = carDataChunks[number + "_" + chunkStartOf(time)];
  if (!chunk || chunk === "loading" || chunk.length === 0) return null;
  return latestBefore(chunk, time) || chunk[0];
}
