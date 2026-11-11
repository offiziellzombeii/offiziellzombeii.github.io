// =====================================================================
//  map.js
//  Draws the track map with flags, cars, safety car and obstacles.
//  The same functions also draw the zoomed replay of an incident.
//
//  A "view" knows how to turn track coordinates into canvas pixels.
// =====================================================================

const COLOURS = {
  tarmac: "#3b4252",
  border: "#0d1017",
  yellow: "#ffd60a",
  double: "#ffb020",
  sc: "#ff7a00",
  red: "#ff3b30",
  green: "#2fd36b",
  pit: "#5d667c",
  drs: "#2fd36b",
  white: "#e6e9ef",
  muted: "#8b93a7"
};

let mainView = null;          // view of the big map
let hoverSector = -1;         // marshal sector under the mouse
let selectedSector = -1;      // marshal sector chosen by a click
let carScreen = {};           // car id -> {x, y} on the big map (for clicking)

// ---------- Views ----------

// Make a view that fits the region (track coordinates) into a canvas of w x h pixels
function makeView(track, ctx, w, h, region, padding) {
  const pad = padding == null ? 30 : padding;
  const width = Math.max(1, region.maxX - region.minX);
  const height = Math.max(1, region.maxY - region.minY);
  const scale = Math.min((w - 2 * pad) / width, (h - 2 * pad) / height);
  const view = {
    track, ctx, w, h, scale,
    minX: region.minX, minY: region.minY,
    offX: (w - width * scale) / 2,
    offY: (h - height * scale) / 2
  };
  // pixel position of every track point (computed once, used every frame)
  view.px = new Float32Array(track.n);
  view.py = new Float32Array(track.n);
  for (let i = 0; i < track.n; i++) {
    const p = toScreen(view, track.xs[i], track.ys[i]);
    view.px[i] = p.x;
    view.py[i] = p.y;
  }
  return view;
}

function toScreen(view, x, y) {
  return {
    x: view.offX + (x - view.minX) * view.scale,
    y: view.h - (view.offY + (y - view.minY) * view.scale) // y goes down on a canvas
  };
}

// Pixel position of metre s, moved sideways by "side" pixels (+ = inside of the loop)
function screenAt(view, s, side) {
  const tr = view.track;
  const p = trackPoint(tr, s);
  const off = (side || 0) / view.scale * tr.insideSign;
  return toScreen(view, p.x + p.nx * off, p.y + p.ny * off);
}

// ---------- Basic drawing ----------

// Draw the track between metre "from" and metre "to"
function strokeSegment(view, from, to, colour, width, dash, glow) {
  const ctx = view.ctx;
  const tr = view.track;
  const L = tr.length;
  const length = mod(to - from, L) || L;
  const steps = Math.max(2, Math.ceil(length / tr.ds));

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (dash) ctx.setLineDash(dash);
  if (glow) {
    ctx.shadowColor = colour;
    ctx.shadowBlur = 12;
  }
  ctx.beginPath();
  const startIndex = Math.round(from / tr.ds);
  for (let k = 0; k <= steps; k++) {
    const i = (startIndex + k) % tr.n;
    if (k === 0) ctx.moveTo(view.px[i], view.py[i]);
    else ctx.lineTo(view.px[i], view.py[i]);
  }
  ctx.stroke();
  ctx.restore();
}

// A line parallel to the track ("side" pixels away), e.g. the pit lane
function strokeParallel(view, from, to, side, colour, width, dash) {
  const ctx = view.ctx;
  const tr = view.track;
  const length = mod(to - from, tr.length) || tr.length;
  const steps = Math.max(2, Math.ceil(length / (tr.ds * 2)));
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  for (let k = 0; k <= steps; k++) {
    const p = screenAt(view, from + length * k / steps, side);
    if (k === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

function label(ctx, text, x, y, colour, size, bold) {
  ctx.font = (bold ? "700 " : "500 ") + (size || 11) + "px Inter, Arial, sans-serif";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#0d1017";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

// ---------- The whole map ----------
function drawTrackLayers(view, r, options) {
  const ctx = view.ctx;
  const tr = r.track;
  const L = tr.length;
  const M = tr.marshalSectors;
  const pitSide = options.pitSide || 11;

  // 1. pit lane
  const pit = tr.pit;
  strokeParallel(view, pit.entry, pit.exit, pitSide, COLOURS.border, 6);
  strokeParallel(view, pit.entry, pit.exit, pitSide, COLOURS.pit, 3);
  const entryA = screenAt(view, pit.entry - 30, 0);
  const entryB = screenAt(view, pit.entry + 25, pitSide);
  const exitA = screenAt(view, pit.exit - 25, pitSide);
  const exitB = screenAt(view, pit.exit + 30, 0);
  ctx.strokeStyle = COLOURS.pit;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(entryA.x, entryA.y);
  ctx.lineTo(entryB.x, entryB.y);
  ctx.moveTo(exitA.x, exitA.y);
  ctx.lineTo(exitB.x, exitB.y);
  ctx.stroke();

  // 2. dark border and the tarmac
  strokeSegment(view, 0, L, COLOURS.border, options.width + 7);
  strokeSegment(view, 0, L, COLOURS.tarmac, options.width);
  if (isCellWeather(r)) drawSectorWetness(view, r); // championship: where is the track wet?

  // 3. track status over the whole lap
  const st = r.status;
  if (st === "SC" || st === "SC_ENDING") strokeSegment(view, 0, L, COLOURS.sc, options.width, null, true);
  else if (st === "VSC" || st === "VSC_ENDING") strokeSegment(view, 0, L, COLOURS.yellow, options.width, [12, 9], true);
  else if (st === "RED") strokeSegment(view, 0, L, COLOURS.red, options.width, null, true);
  if (r.chequered) strokeSegment(view, 0, L, COLOURS.white, options.width * 0.6, [6, 6]);

  // 4. marshal sectors with flags
  for (let i = 0; i < M; i++) {
    const from = i * tr.msLen;
    const to = (i + 1) * tr.msLen;
    const flag = r.sectorFlags[i];
    if (flag === "YELLOW") strokeSegment(view, from, to, COLOURS.yellow, options.width + 2, null, true);
    if (flag === "DOUBLE") strokeSegment(view, from, to, COLOURS.double, options.width + 5, null, true);
    if (r.slippery[i]) {
      strokeSegment(view, from, to, COLOURS.yellow, options.width - 2, [5, 5]);
      strokeSegment(view, from + 2.5, to, COLOURS.red, options.width - 2, [5, 5]);
    }
    if (options.interactive && (i === hoverSector || i === selectedSector)) {
      strokeSegment(view, from, to, i === selectedSector ? "#ffffff" : "rgba(255,255,255,0.45)", 2, i === selectedSector ? null : [4, 4]);
    }
  }

  // 5. DRS zones (green line on the outside) – or, with the 2026 cars,
  //    Straight Mode zones (cyan) and the Overtake Mode detection point
  if (r.regs === "GEN2026") {
    tr.straightZones.forEach((zone, i) => {
      const on = r.straightEnabled && !r.straightOff[i];
      strokeParallel(view, zone.start, zone.end, -(options.width / 2 + 5), on ? "#4fd8ff" : "rgba(79,216,255,0.22)", 2, on ? null : [4, 4]);
    });
    const d = overtakeDetectPoint(tr);
    const p1 = screenAt(view, d, -(options.width / 2 + 2));
    const p2 = screenAt(view, d, -(options.width / 2 + 10));
    ctx.strokeStyle = r.drsEnabled ? "#4fd8ff" : "rgba(79,216,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  } else {
    for (const zone of tr.drsZones) {
      strokeParallel(view, zone.start, zone.end, -(options.width / 2 + 5), r.drsEnabled ? COLOURS.drs : "rgba(47,211,107,0.25)", 2);
    }
  }

  // 6. start / finish line
  const a = screenAt(view, 0, -options.width);
  const b = screenAt(view, 0, options.width);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // pit exit light and closed pit entry
  const exitLight = screenAt(view, pit.exit, pitSide + 9);
  ctx.beginPath();
  ctx.arc(exitLight.x, exitLight.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = r.pitExitOpen ? COLOURS.green : COLOURS.red;
  ctx.fill();
  if (!r.pitEntryOpen) {
    const e = screenAt(view, pit.entry + 10, pitSide);
    label(ctx, "✕", e.x - 4, e.y + 4, COLOURS.red, 13, true);
  }
}

function drawSectorNumbers(view, r) {
  const ctx = view.ctx;
  const tr = r.track;
  for (let i = 0; i < tr.marshalSectors; i++) {
    const p = screenAt(view, (i + 0.5) * tr.msLen, -16);
    const flag = r.sectorFlags[i];
    const colour = flag === "GREEN" ? "#5f6880" : COLOURS.yellow;
    ctx.font = "600 9px Inter, Arial, sans-serif";
    ctx.fillStyle = colour;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), p.x, p.y + 3);
    ctx.textAlign = "left";
    // little tick at the sector start
    const t1 = screenAt(view, i * tr.msLen, -5);
    const t2 = screenAt(view, i * tr.msLen, -9);
    ctx.strokeStyle = "#5f6880";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(t1.x, t1.y);
    ctx.lineTo(t2.x, t2.y);
    ctx.stroke();
  }
  for (const c of tr.corners) {
    const p = screenAt(view, c.apex, 22);
    label(ctx, "T" + c.number, p.x - 6, p.y + 4, "#7d869c", 9, false);
  }
}

function drawObstacles(view, r) {
  const ctx = view.ctx;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
  for (const ob of r.obstacles) {
    if (ob.cleared) continue;
    const side = ob.onTrack ? 0 : -18;
    const p = screenAt(view, ob.s, side);

    if (ob.type === "DEBRIS") {
      ctx.fillStyle = "#ffb020";
      for (let k = 0; k < 4; k++) ctx.fillRect(p.x - 6 + k * 4, p.y - 2 + (k % 2) * 4, 3, 3);
    } else if (ob.type === "OIL") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20,20,20,0.9)";
      ctx.fill();
      ctx.strokeStyle = COLOURS.yellow;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (ob.type === "BARRIER") {
      ctx.fillStyle = COLOURS.red;
      ctx.fillRect(p.x - 9, p.y - 3, 18, 6);
    }

    // warning ring and recovery progress
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13 + pulse * 3, 0, Math.PI * 2);
    ctx.strokeStyle = ob.onTrack ? "rgba(255,59,48," + (0.5 + pulse * 0.5) + ")" : "rgba(255,176,32,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (ob.progress > 0) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ob.progress));
      ctx.strokeStyle = COLOURS.green;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
}

// cars: list of {id, s, lateral, inPit, spun, speed}
function drawCars(view, r, cars, options) {
  const ctx = view.ctx;
  const pitSide = options.pitSide || 11;
  if (options.interactive) carScreen = {};

  const drawOne = c => {
    const car = carById(c.id);
    if (!car) return;
    const side = c.inPit ? pitSide : c.lateral;
    const p = screenAt(view, c.s, side);
    const selected = options.selected === car.id;
    const focus = options.focus && options.focus.includes(car.id);
    let radius = options.radius || (c.inPit ? 4.5 : 6.5);
    if (selected || focus) radius += 1.5;

    if (options.interactive) carScreen[car.id] = p;

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    if (c.spun) {
      ctx.fillStyle = "rgba(13,16,23,0.9)";
      ctx.fill();
      ctx.strokeStyle = car.colour;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = car.colour;
      ctx.fill();
      ctx.lineWidth = selected || focus ? 2.5 : 1.3;
      ctx.strokeStyle = selected || focus ? "#ffffff" : "#0d1017";
      ctx.stroke();
    }
    if (car.mode === "STOPPED") {
      label(ctx, "✕", p.x - 4, p.y + 4, COLOURS.red, 12, true);
    }
    if (options.live) {
      if (car.blue.active) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "#3d8bff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (car.flag) {
        ctx.fillStyle = car.flag === "BO" ? "#ff8a00" : car.flag === "BW" ? "#ffffff" : "#000000";
        ctx.fillRect(p.x + radius, p.y + 2, 6, 6);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x + radius, p.y + 2, 6, 6);
      }
    }
    if (options.noLabel) return;
    const text = options.showSpeed ? car.code + " " + Math.round(c.speed * 3.6) : car.code;
    label(ctx, text, p.x + radius + 3, p.y - radius + 1, selected || focus ? "#ffffff" : "#cbd2df", options.labelSize || 10, selected || focus);
  };

  for (const c of cars) if (c.id !== options.selected) drawOne(c);
  const sel = cars.find(c => c.id === options.selected);
  if (sel) drawOne(sel);
}

function drawSafetyCar(view, s) {
  const ctx = view.ctx;
  const p = screenAt(view, s, 0);
  ctx.save();
  ctx.fillStyle = COLOURS.sc;
  ctx.strokeStyle = "#0d1017";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(p.x - 10, p.y - 7, 20, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#000000";
  ctx.font = "800 9px Inter, Arial, sans-serif";
  ctx.fillText("SC", p.x - 7, p.y + 3);
  ctx.restore();
}

// Live cars of the race -> the format drawCars wants
function liveCarList(r) {
  const list = [];
  for (const car of r.cars) {
    if (car.hidden || car.mode === "PARKED") continue;
    list.push({ id: car.id, s: car.s, lateral: car.lateral, inPit: !!car.pit.state, spun: car.spin > 0 || car.mode === "STOPPED", speed: car.speed });
  }
  return list;
}

// ---------- The big map ----------
function drawMainMap(canvas, selectedCarId) {
  const r = race;
  if (!r) return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (w < 10 || h < 10) return;

  // (re)build the view when the size of the canvas changes
  if (!mainView || mainView.w !== w || mainView.h !== h || mainView.track !== r.track) {
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    mainView = makeView(r.track, ctx, w, h, r.track.bounds, 34);
  }
  ctx.clearRect(0, 0, w, h);

  // rain tint
  if (r.weather.rain > 0.05) {
    ctx.fillStyle = "rgba(60,120,255," + (r.weather.rain * 0.12) + ")";
    ctx.fillRect(0, 0, w, h);
  }

  drawTrackLayers(mainView, r, { width: 8, interactive: true });
  if (isCellWeather(r)) {
    drawRadar(ctx, r, w - 150, 10, 140);
  }
  drawSectorNumbers(mainView, r);
  drawObstacles(mainView, r);
  drawCars(mainView, r, liveCarList(r), { selected: selectedCarId, interactive: true, live: true });
  if (r.sc) drawSafetyCar(mainView, r.sc.s);
}

// Which marshal sector is near a pixel? (-1 = none)
function sectorAtPixel(x, y) {
  if (!mainView) return -1;
  const tr = mainView.track;
  let best = -1;
  let bestDistance = 18;
  for (let i = 0; i < tr.n; i += 2) {
    const d = Math.hypot(mainView.px[i] - x, mainView.py[i] - y);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  if (best < 0) return -1;
  return marshalSectorAt(tr, best * tr.ds) - 1;
}

function carAtPixel(x, y) {
  let best = null;
  let bestDistance = 13;
  for (const id in carScreen) {
    const p = carScreen[id];
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDistance) {
      best = Number(id);
      bestDistance = d;
    }
  }
  return best;
}


// ---------- Incident replay (zoomed in) ----------

// Show the replay frame at time t
function drawClip(canvas, inc, t) {
  const r = race;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (!inc.view || inc.view.w !== w || inc.view.h !== h) {
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    inc.view = makeView(r.track, ctx, w, h, clipRegion(r.track, inc), 20);
  }
  const view = inc.view;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0d1017";
  ctx.fillRect(0, 0, w, h);

  const wide = inc.wideView;
  drawTrackLayers(view, r, { width: wide ? 8 : 16, pitSide: wide ? 11 : 22 });
  const frames = inc.clip;
  if (!frames || frames.length === 0) return;

  // find the two frames around t and interpolate
  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].t <= t) i++;
  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  const f = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  const L = r.track.length;

  const cars = [];
  for (const ca of a.cars) {
    const cb = b.cars.find(x => x[0] === ca[0]) || ca;
    let ds = cb[1] - ca[1];
    if (ds < -L / 2) ds += L;
    if (ds > L / 2) ds -= L;
    cars.push({ id: ca[0], s: ca[1] + ds * f, lateral: lerp(ca[2], cb[2], f) * (wide ? 1 : 2), inPit: ca[3] === 1, spun: ca[4] === 1, speed: lerp(ca[5], cb[5], f) });
  }
  // in the wide view only the cars of the incident get a label
  const shown = wide ? cars.filter(c => inc.cars.includes(c.id)) : cars;
  if (wide) drawCars(view, r, cars.filter(c => !inc.cars.includes(c.id)), { radius: 3, noLabel: true, pitSide: 11 });
  drawCars(view, r, shown, { focus: inc.cars, radius: wide ? 6 : 8, labelSize: 12, showSpeed: true, pitSide: wide ? 11 : 22 });
  if (a.sc !== null) drawSafetyCar(view, a.sc);

  // time label
  const rel = t - inc.t;
  label(ctx, (rel >= 0 ? "+" : "") + rel.toFixed(1) + " s", 12, 22, rel >= -0.1 && rel <= 0.6 ? COLOURS.red : "#ffffff", 14, true);
}

// The area of the track around the incident.
// It always contains ALL cars of the incident; if they are far apart, the whole track is shown.
function clipRegion(track, inc) {
  const L = track.length;
  const spots = [inc.s];
  if (inc.clip && inc.clip.length > 0) {
    const frame = inc.clip.reduce((best, f) => (Math.abs(f.t - inc.t) < Math.abs(best.t - inc.t) ? f : best), inc.clip[0]);
    for (const id of inc.cars) {
      const c = frame.cars.find(x => x[0] === id);
      if (c) spots.push(c[1]);
    }
  }
  let spread = 0;
  for (const a of spots) {
    for (const b of spots) spread = Math.max(spread, Math.min(mod(a - b, L), mod(b - a, L)));
  }
  inc.wideView = spread > 450;
  if (inc.wideView) return track.bounds;

  const region = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const spot of spots) {
    for (let d = -220; d <= 220; d += 10) {
      const p = trackPoint(track, spot + d);
      region.minX = Math.min(region.minX, p.x);
      region.maxX = Math.max(region.maxX, p.x);
      region.minY = Math.min(region.minY, p.y);
      region.maxY = Math.max(region.maxY, p.y);
    }
  }
  // keep it from becoming a thin line on a straight
  const minSize = 220 * track.unitsPerMeter;
  const cx = (region.minX + region.maxX) / 2;
  const cy = (region.minY + region.maxY) / 2;
  const half = Math.max(region.maxX - region.minX, region.maxY - region.minY, minSize) / 2;
  return { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half };
}
