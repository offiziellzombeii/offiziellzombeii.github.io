// =====================================================================
//  weather.js
//  The weather of a race weekend (championship mode):
//  1. The weekend weather: temperature with a daily cycle, wind with
//     gusts, and rain cells that move across the circuit with the wind.
//     - frontal rain: big, slow, long-lasting, steady
//     - showers / thunderstorms: small, short, heavy, sometimes lightning
//     How much of it depends on the climate of the circuit.
//     Everything comes from a seed: the same weekend has the same weather.
//  2. Sampling: rain at a point, lightning distance, sun, wind
//  3. The forecast: the truth with an error that grows with the lead time
//  4. The engine side: rain and wetness per marshal sector
//  5. Drawing: wet sectors on the map and the rain radar
//
//  Time: seconds since Friday 00:00 local time ("weekend time").
//  Positions: metres from the centre of the circuit (x = east, y = north).
// =====================================================================

const WEEKEND_SECONDS = 3 * 86400;
const DAY_NAMES = ["Friday", "Saturday", "Sunday"];
const LIGHTNING_KM = 10;   // lightning closer than this: marshals must take cover

// ---------- 1. The weekend weather ----------
function makeWeekendWeather(seedText, circuitKey) {
  const ch = CIRCUIT_CHARACTER[circuitKey] || {};
  const rnd = makeRandom(hashText(seedText) % 1000000 + 7);
  const climateRain = ch.rain !== undefined ? ch.rain : 0.2;
  const air = ch.air || 24;
  const tropical = air >= 26 && climateRain >= 0.25;

  const W = {
    circuit: circuitKey,
    night: !!ch.night,
    air: air + (rnd() - 0.5) * 2.5,
    dayShift: [0, 1, 2].map(() => (rnd() - 0.5) * 2.5),
    windBase: (ch.wind !== undefined ? ch.wind : 0.4) * 9 + rnd() * 3,  // m/s
    windDir: rnd() * Math.PI * 2,                                     // direction the wind blows TO
    gustiness: 0.25 + rnd() * 0.35,
    gustPhase: rnd() * 1000,
    cells: []
  };

  // number of rain cells: ~10 x the chance of rain (Spa ~5, Bahrain ~0)
  const expected = climateRain * 10;
  let count = 0;
  for (let k = 0; k < 14; k++) if (rnd() < expected / 14) count++;

  for (let i = 0; i < count; i++) {
    const convective = tropical ? rnd() < 0.7 : rnd() < 0.3;
    const day = Math.floor(rnd() * 3);
    // showers like the afternoon, fronts come at any time
    const hour = convective ? 11 + rnd() * 9 : 6 + rnd() * 16;
    const t0 = day * 86400 + hour * 3600;
    const speed = convective ? 4 + rnd() * 6 : 7 + rnd() * 8;          // m/s
    const dir = W.windDir + (rnd() - 0.5) * 0.6;
    const radius = convective ? 2500 + rnd() * 4500 : 9000 + rnd() * 14000;
    const peak = convective ? 0.55 + rnd() * 0.45 : 0.3 + Math.pow(rnd(), 1.3) * 0.7;
    const life = convective ? 3600 + rnd() * 5400 : 3 * 3600 + rnd() * 4 * 3600;
    // the cell passes the circuit at t0 – exactly over it, or a bit to the side
    const miss = (rnd() - 0.5) * 2.4 * radius;
    const vx = Math.cos(dir) * speed;
    const vy = Math.sin(dir) * speed;
    W.cells.push({
      t0, vx, vy, radius, peak, life, convective,
      x0: -Math.sin(dir) * miss, y0: Math.cos(dir) * miss,
      lightning: convective && peak > 0.75,
      ripple: rnd() * 6.28
    });
  }
  return W;
}

// The weekend time of a session: { SQ, SPRINT, Q, RACE } -> seconds
function sessionSchedule(round, night) {
  const late = night ? 4 : 0; // night races run in the evening
  return round.sprint
    ? { SQ: 0 * 86400 + (16.5 + late) * 3600, SPRINT: 1 * 86400 + (12 + late) * 3600, Q: 1 * 86400 + (16 + late) * 3600, RACE: 2 * 86400 + (15 + late) * 3600 }
    : { Q: 1 * 86400 + (16 + late) * 3600, RACE: 2 * 86400 + (15 + late) * 3600 };
}

function formatWeekendTime(t) {
  const day = clamp(Math.floor(t / 86400), 0, 2);
  const s = t - day * 86400;
  return DAY_NAMES[day].slice(0, 3) + " " + String(Math.floor(s / 3600)).padStart(2, "0") + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0");
}


// ---------- 2. Sampling ----------
function cellIntensity(c, t) {
  const x = (t - c.t0) / c.life;           // -0.5 ... 0.5 = the life of the cell
  if (x <= -0.5 || x >= 0.5) return 0;
  return c.peak * Math.cos(x * Math.PI);    // grows, peaks, dies
}

function cellPosition(c, t) {
  return { x: c.x0 + c.vx * (t - c.t0), y: c.y0 + c.vy * (t - c.t0) };
}

// Rain (0 = dry ... 1 = very heavy) at point (x, y) metres from the centre
function rainAtPoint(W, t, x, y) {
  let rain = 0;
  for (const c of W.cells) {
    const i = cellIntensity(c, t);
    if (i <= 0) continue;
    const p = cellPosition(c, t);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d >= c.radius) continue;
    const core = 1 - (d / c.radius) * (d / c.radius);
    const patchy = 0.8 + 0.2 * Math.sin(d / 900 + c.ripple); // showers are not even
    rain = Math.max(rain, i * core * patchy);
  }
  return clamp(rain, 0, 1);
}

// Distance (km) of the closest lightning; Infinity = none
function lightningDistance(W, t) {
  let best = Infinity;
  for (const c of W.cells) {
    if (!c.lightning || cellIntensity(c, t) < c.peak * 0.6) continue;
    const p = cellPosition(c, t);
    best = Math.min(best, Math.max(0, Math.hypot(p.x, p.y) - c.radius * 0.7) / 1000);
  }
  return best;
}

// How much of the sky over the circuit is covered (0 = sunny ... 1 = overcast)
function cloudCover(W, t) {
  let cover = 0;
  for (const c of W.cells) {
    const i = cellIntensity(c, t - 900) > 0 || cellIntensity(c, t + 900) > 0 ? Math.max(cellIntensity(c, t), 0.3) : 0;
    if (i <= 0) continue;
    const p = cellPosition(c, t);
    const d = Math.hypot(p.x, p.y);
    cover = Math.max(cover, clamp(1.6 - d / (c.radius * 1.5), 0, 1) * 0.9);
  }
  return cover;
}

// Air / track temperature, wind and gusts at weekend time t
function weatherConditions(W, t) {
  const day = clamp(Math.floor(t / 86400), 0, 2);
  const hour = (t % 86400) / 3600;
  const rainHere = rainAtPoint(W, t, 0, 0);
  const cover = cloudCover(W, t);
  // warmest at 15:00; the typical temperature of the circuit is the one at race time
  const daily = h => Math.cos((h - 15) / 24 * Math.PI * 2);
  const air = W.air + W.dayShift[day] + 5 * (daily(hour) - daily(W.night ? 20 : 15)) - 2.5 * cover - 3 * rainHere;
  const sunUp = hour > 7 && hour < 19.5;
  const sun = sunUp ? Math.max(0, Math.sin((hour - 7) / 12.5 * Math.PI)) * (1 - cover) : 0;
  // gusts: a slow wave plus faster changes; showers bring strong gusts
  const g = Math.sin((t + W.gustPhase) / 70) * 0.6 + Math.sin((t + W.gustPhase) / 17) * 0.4;
  let storm = 0;
  for (const c of W.cells) {
    if (!c.convective) continue;
    const p = cellPosition(c, t);
    const d = Math.hypot(p.x, p.y);
    if (d < c.radius * 1.6) storm = Math.max(storm, cellIntensity(c, t) * (1 - d / (c.radius * 1.6)));
  }
  const wind = W.windBase * (1 + 0.3 * storm);
  const gust = wind * (1 + W.gustiness * Math.max(0, g)) + storm * 9;
  return {
    air: Math.round(air * 10) / 10,
    trackTemp: Math.round((air + 4 + 18 * sun) * 10) / 10,
    sun, cover, wind, gust,
    rain: rainHere,
    lightningKm: lightningDistance(W, t)
  };
}


// ---------- 3. The forecast ----------
// What the weather service expects at time "at", seen from time "now".
// The further ahead, the bigger the error (timing and strength of the cells).
function weatherForecast(W, now, at) {
  const lead = Math.max(0, at - now) / 3600; // hours
  let rainChance = 0;
  let intensity = 0;
  let thunder = 0;
  for (let k = 0; k < W.cells.length; k++) {
    const c = W.cells[k];
    // a fixed "forecast error" for this cell (the same every time you look)
    const e = makeRandom(Math.floor(c.t0) + k * 7919 + Math.floor(lead * 2));
    const shift = (e() - 0.5) * 2 * lead * 1800;           // timing error, ±30 min per hour of lead time
    const scale = 1 + (e() - 0.5) * Math.min(1.2, lead * 0.12); // strength error
    const spread = Math.min(0.9, 0.15 + lead * 0.05);     // uncertainty: where exactly will it pass?
    const i = cellIntensity(c, at + shift) * scale;
    if (i <= 0) continue;
    const p = cellPosition(c, at + shift);
    const d = Math.hypot(p.x, p.y);
    const near = clamp(1 - d / (c.radius * (1 + spread)), 0, 1);
    const pass = clamp(near + spread * 0.5 * (1 - near) * (d < c.radius * 3 ? 1 : 0), 0, 1);
    rainChance = Math.max(rainChance, clamp(pass * (0.6 + 0.4 * Math.min(1, i / 0.5)), 0, 1));
    intensity = Math.max(intensity, i * near);
    if (c.lightning) thunder = Math.max(thunder, pass);
  }
  const cond = weatherConditions(W, at);
  return {
    rain: Math.round(rainChance * 10) * 10,                  // % in 10 % steps, like a real forecast
    intensity: intensity < 0.05 ? "" : intensity < 0.3 ? "light" : intensity < 0.6 ? "moderate" : "heavy",
    thunder: Math.round(thunder * 10) * 10,
    air: Math.round(cond.air + (lead > 6 ? (makeRandom(Math.floor(at / 3600))() - 0.5) * 3 : 0)),
    wind: Math.round(cond.wind * 3.6),
    gust: Math.round(cond.gust * 3.6)
  };
}

// The hottest air temperature of the forecast for a session window
function forecastMaxAir(W, from, to) {
  let max = -99;
  for (let t = from; t <= to; t += 1800) max = Math.max(max, weatherForecast(W, from - 86400, t).air);
  return max;
}


// ---------- 4. The engine side ----------
// setup.weather for the championship: { model: "cells", weekend: W, offset: weekend time at race.time = 0 }
function isCellWeather(r) {
  return r && r.setup.weather && r.setup.weather.model === "cells";
}

// Called by makeWeatherState
function initCellWeather(state, setupWeather, track) {
  const W = setupWeather.weekend;
  // where are the marshal sectors (metres from the centre of the circuit)?
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const M = track.marshalSectors;
  state.model = "cells";
  state.sectorPos = [];
  for (let i = 0; i < M; i++) {
    const p = trackPoint(track, (i + 0.5) * track.msLen);
    state.sectorPos.push({ x: (p.x - cx) / track.unitsPerMeter, y: (p.y - cy) / track.unitsPerMeter });
  }
  state.rainS = new Array(M).fill(0);
  state.wetS = new Array(M).fill(0);
  // the hour before the session decides how wet the track is at the start
  const t0 = setupWeather.offset;
  for (let t = t0 - 3600; t <= t0; t += 30) stepSectorWetness(state, W, t, 30);
  applyConditions(state, W, t0);
  state.lastLightningAlert = -999;
  state.lastGustAlert = -999;
}

function stepSectorWetness(state, W, t, dt) {
  const cond = weatherConditions(W, t);
  const dryRate = 0.0011 * (0.5 + cond.sun + cond.wind / 20 + Math.max(0, cond.air - 15) / 25);
  for (let i = 0; i < state.sectorPos.length; i++) {
    const p = state.sectorPos[i];
    const rain = rainAtPoint(W, t, p.x, p.y);
    state.rainS[i] = rain;
    let wet = state.wetS[i];
    if (rain > wet) wet += (rain - wet) * Math.min(1, 0.008 * dt) * (0.6 + rain); // heavier rain soaks the track faster
    else wet = Math.max(rain, wet - dryRate * dt * (1 - rain));
    state.wetS[i] = clamp(wet, 0, 1);
  }
}

function applyConditions(state, W, t) {
  const cond = weatherConditions(W, t);
  const n = state.wetS.length;
  state.rain = state.rainS.reduce((a, b) => a + b, 0) / n;
  state.wet = state.wetS.reduce((a, b) => a + b, 0) / n;
  state.rainMax = Math.max(...state.rainS);
  state.wetMax = Math.max(...state.wetS);
  state.air = Math.round(cond.air);
  state.trackTemp = Math.round(cond.trackTemp - state.wet * 8);
  state.wind = cond.wind;
  state.gust = cond.gust;
  state.lightningKm = cond.lightningKm;
  state.weekendTime = t;
}

// Every second (engine updateWeather)
function updateCellWeather(r) {
  const w = r.weather;
  const W = r.setup.weather.weekend;
  const t = r.setup.weather.offset + r.time;
  const wasRaining = w.rainS.map(x => x > 0.08);
  stepSectorWetness(w, W, t, 1);
  applyConditions(w, W, t);

  // the marshal posts report rain where it starts
  const started = w.rainS.findIndex((x, i) => x > 0.08 && !wasRaining[i]);
  if (!w.raining && w.rainMax > 0.08) {
    w.raining = true;
    addAlert("warn", "Rain reported by marshal post " + (started + 1) + (w.rain < 0.6 * w.rainMax ? " – only parts of the circuit are wet so far." : " – it is spreading around the circuit."), { sector: started + 1 });
  } else if (w.raining && w.rainMax < 0.03) {
    w.raining = false;
    addAlert("info", "Rain has stopped all around the circuit. The track will start to dry.");
  }
  if (w.wetMax > 0.85 && !w.heavyWarned) {
    w.heavyWarned = true;
    const worst = w.wetS.indexOf(w.wetMax) + 1;
    addAlert("danger", "Heavy rain – standing water and aquaplaning reported in sector " + worst + ".", { sector: worst });
  }
  if (w.wetMax < 0.6) w.heavyWarned = false;

  // lightning: the marshals must take cover, no session can run
  if (w.lightningKm < LIGHTNING_KM && r.time - w.lastLightningAlert > 120) {
    w.lastLightningAlert = r.time;
    addAlert("danger", "Weather service: lightning " + w.lightningKm.toFixed(1) + " km from the circuit. Marshals must take cover – the session must be suspended.");
  }
  if (w.gust > 17 && r.time - w.lastGustAlert > 300) {
    w.lastGustAlert = r.time;
    addAlert("warn", "Strong gusts of " + Math.round(w.gust * 3.6) + " km/h – cars are moving around in the fast corners.");
  }
}

// Wetness / rain where the car is
function wetAt(s) {
  const w = race.weather;
  if (!w.wetS) return w.wet;
  return w.wetS[marshalSectorAt(race.track, s) - 1];
}

function rainAt(s) {
  const w = race.weather;
  if (!w.rainS) return w.rain;
  return w.rainS[marshalSectorAt(race.track, s) - 1];
}

// The teams choose tyres from the whole lap, the wettest part counts more
function teamWetView() {
  const w = race.weather;
  if (!w.wetS) return w.wet;
  return 0.6 * w.wet + 0.4 * w.wetMax;
}

// Wind: extra spin risk in fast corners (0 = none)
function windRisk(track, s) {
  const w = race.weather;
  if (!w.gust || w.gust < 12) return 0;
  if (trackSpeed(track, s) < track.vMax * 0.55) return 0; // slow corners: no problem
  return clamp((w.gust - 12) / 10, 0, 1.5);
}


// ---------- 5. Drawing ----------
// Wet sectors as a blue shade on the track
function drawSectorWetness(view, r) {
  const w = r.weather;
  if (!w.wetS) return;
  const tr = r.track;
  for (let i = 0; i < w.wetS.length; i++) {
    const wet = w.wetS[i];
    if (wet < 0.05) continue;
    strokeSegment(view, i * tr.msLen, (i + 1) * tr.msLen, "rgba(70,140,255," + (0.15 + wet * 0.55).toFixed(2) + ")", 8);
  }
}

// The rain radar: 40 x 40 km around the circuit, in a corner of the map
function drawRadar(ctx, r, x, y, size) {
  const W = r.setup.weather.weekend;
  const t = r.setup.weather.offset + r.time;
  const km = 40;
  const scale = size / (km * 1000);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.fillStyle = "rgba(11,13,18,0.85)";
  ctx.fill();
  ctx.strokeStyle = "#252b38";
  ctx.stroke();
  ctx.clip();
  const cx = x + size / 2;
  const cy = y + size / 2;
  for (const c of W.cells) {
    const i = cellIntensity(c, t);
    if (i <= 0.02) continue;
    const p = cellPosition(c, t);
    const px = cx + p.x * scale;
    const py = cy - p.y * scale;
    const rad = c.radius * scale;
    if (px < x - rad || px > x + size + rad || py < y - rad || py > y + size + rad) continue;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    const colour = i > 0.6 ? "255,70,70" : i > 0.35 ? "255,214,10" : "47,211,107";
    g.addColorStop(0, "rgba(" + colour + "," + (0.35 + i * 0.5).toFixed(2) + ")");
    g.addColorStop(1, "rgba(" + colour + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
    if (c.lightning && i > c.peak * 0.6) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 11px Inter, Arial, sans-serif";
      ctx.fillText("⚡", px - 4, py + 4);
    }
  }
  // the circuit, the 10 km lightning ring and the wind
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(cx, cy, LIGHTNING_KM * 1000 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const wx = Math.cos(W.windDir);
  const wy = Math.sin(W.windDir);
  ctx.strokeStyle = "#8b93a7";
  ctx.beginPath();
  ctx.moveTo(x + 16 - wx * 8, y + size - 16 + wy * 8);
  ctx.lineTo(x + 16 + wx * 8, y + size - 16 - wy * 8);
  ctx.stroke();
  ctx.fillStyle = "#8b93a7";
  ctx.font = "600 10px Inter, Arial, sans-serif";
  ctx.fillText("RADAR " + km + " km", x + 6, y + 13);
  ctx.fillText(Math.round(r.weather.wind * 3.6) + " km/h", x + 28, y + size - 12);
  ctx.restore();
}
