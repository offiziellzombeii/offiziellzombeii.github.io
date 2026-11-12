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
  muted: "#8b93a7",
  rain: "#3d8bff"   // the rain signal (same blue as the blue flag / --blue)
};

let mainView = null;          // view of the big map
let hoverSector = -1;         // marshal sector under the mouse
let selectedSector = -1;      // marshal sector chosen by a click (the first of selectedSectors)
let selectedSectors = [];     // marshal sectors chosen by a click or by dragging along the track
let carScreen = {};           // car id -> {x, y} on the big map (for clicking)

// ---------- Views ----------

// Make a view that fits the region (track coordinates) into a canvas of w x h pixels
// bottom: extra free space at the bottom (the legend of the main map)
function makeView(track, ctx, w, h, region, padding, bottom) {
  const pad = padding == null ? 30 : padding;
  const extra = bottom || 0;
  const width = Math.max(1, region.maxX - region.minX);
  const height = Math.max(1, region.maxY - region.minY);
  const scale = Math.min((w - 2 * pad) / width, (h - extra - 2 * pad) / height);
  const view = {
    track, ctx, w, h, scale, bottom: extra,
    minX: region.minX, minY: region.minY,
    offX: (w - width * scale) / 2,
    offY: extra + (h - extra - height * scale) / 2
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
  ctx.beginPath();
  const startIndex = Math.round(from / tr.ds);
  for (let k = 0; k <= steps; k++) {
    const i = (startIndex + k) % tr.n;
    if (k === 0) ctx.moveTo(view.px[i], view.py[i]);
    else ctx.lineTo(view.px[i], view.py[i]);
  }
  if (glow) {
    // a soft halo: a wide, transparent stroke under the line
    // (shadowBlur looks the same but is very slow on phones)
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = width + 10;
    ctx.stroke();
    ctx.restore();
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
// Which side of the track the pit lane is drawn on: the side with more room.
// (Always "inside the loop" put the Monaco pit lane and its exit light onto the
// swimming pool section.) Decided once per view.
function pitSign(view) {
  if (view.pitSign) return view.pitSign;
  const tr = view.track;
  const L = tr.length;
  const pit = tr.pit;
  const length = mod(pit.exit - pit.entry, L);
  const clearance = sign => {
    let worst = Infinity;
    for (let k = 0; k <= 24; k++) {
      const s = pit.entry + length * k / 24;
      const p = screenAt(view, s, sign * 20); // the pit lane and the exit light (~20 px from the track)
      for (let i = 0; i < tr.n; i += 2) {
        if (Math.abs(mod(i * tr.ds - s + L / 2, L) - L / 2) < 120) continue; // the track right next to it
        const d = Math.hypot(view.px[i] - p.x, view.py[i] - p.y);
        if (d < worst) worst = d;
      }
    }
    return worst;
  };
  const inside = clearance(1);
  view.pitSign = inside >= 14 || inside >= clearance(-1) ? 1 : -1;
  return view.pitSign;
}

// Where the start lights fit: a place on the map with no track under it, not where the
// radar or the legend is. Chosen once per session (like the radar), top centre if possible.
let lightsChoice = null; // { race, index }
function lightsSpot(view, boxW, boxH) {
  const margin = 10;
  const spots = [
    { x: (view.w - boxW) / 2, y: margin },                         // top centre
    { x: margin, y: margin },                                       // top left
    { x: view.w - boxW - margin, y: margin },                       // top right
    { x: (view.w - boxW) / 2, y: view.h - view.bottom - boxH - 4 }, // bottom centre, above the legend
    { x: view.w - boxW - margin, y: (view.h - boxH) / 2 },          // right middle
    { x: margin, y: (view.h - boxH) / 2 }                           // left middle
  ];
  if (!lightsChoice || lightsChoice.race !== race) {
    const radar = isCellWeather(race) ? radarSpot(view) : null;
    let best = null;
    spots.forEach((c, index) => {
      let hits = 0;
      for (let i = 0; i < view.px.length; i++) {
        const x = view.px[i];
        const y = view.py[i];
        if (x > c.x - 16 && x < c.x + boxW + 16 && y > c.y - 16 && y < c.y + boxH + 16) hits++;
      }
      if (radar && c.x < radar.x + radar.size && c.x + boxW > radar.x && c.y < radar.y + radar.size && c.y + boxH > radar.y) hits += 1e6;
      if (!best || hits < best.hits) best = { index, hits };
    });
    lightsChoice = { race, index: best.index };
  }
  return spots[lightsChoice.index];
}

function drawTrackLayers(view, r, options) {
  const ctx = view.ctx;
  const tr = r.track;
  const L = tr.length;
  const M = tr.marshalSectors;
  const pitSide = (options.pitSide || 11) * pitSign(view);
  const pitOut = Math.sign(pitSide); // the side away from the track

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
    const flag = view.track === r.track && r.flagPanels ? shownFlag(i) : r.sectorFlags[i];
    // rain signal: a blue band (wider, under a yellow flag – both stay visible)
    if (r.rainFlags && r.rainFlags[i]) strokeSegment(view, from, to, COLOURS.rain, options.width + (flag === "GREEN" ? 2 : 9), null, true);
    if (flag === "YELLOW") strokeSegment(view, from, to, COLOURS.yellow, options.width + 2, null, true);
    if (flag === "DOUBLE") strokeSegment(view, from, to, COLOURS.double, options.width + 5, null, true);
    if (r.slippery[i]) {
      strokeSegment(view, from, to, COLOURS.yellow, options.width - 2, [5, 5]);
      strokeSegment(view, from + 2.5, to, COLOURS.red, options.width - 2, [5, 5]);
    }
    const chosen = i === selectedSector || selectedSectors.includes(i);
    if (options.interactive && (i === hoverSector || chosen)) {
      strokeSegment(view, from, to, chosen ? "#ffffff" : "rgba(255,255,255,0.45)", 2, chosen ? null : [4, 4]);
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
    tr.drsZones.forEach((zone, i) => {
      const off = r.drsOff && r.drsOff[i]; // switched off in the event notes
      strokeParallel(view, zone.start, zone.end, -(options.width / 2 + 5), r.drsEnabled && !off ? COLOURS.drs : "rgba(47,211,107,0.25)", 2, off ? [4, 4] : null);
    });
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
  // the light stands at the end of the pit lane, on the far side from the track
  const exitLight = screenAt(view, pit.exit - 22, pitSide + 7 * pitOut);
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
    } else if (ob.type === "MEDICAL") {
      // a white cross on red: the driver must be checked
      ctx.fillStyle = COLOURS.red;
      ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(p.x - 1.5, p.y - 4.5, 3, 9);
      ctx.fillRect(p.x - 4.5, p.y - 1.5, 9, 3);
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
    // the recovery crew: on its way (dashed, coming from the side of the track) or at work
    if (ob.crew) {
      const there = r.time >= ob.crew.arriveAt;
      const c = screenAt(view, ob.s + (there ? 6 : 30), there ? (ob.onTrack ? 9 : -26) : -34);
      ctx.save();
      const med = ob.type === "MEDICAL";
      ctx.fillStyle = med ? "#ffffff" : COLOURS.sc;
      ctx.globalAlpha = there ? 1 : 0.5 + 0.5 * pulse;
      ctx.fillRect(c.x - 4, c.y - 3, 8, 6);
      if (med) { ctx.fillStyle = COLOURS.red; ctx.fillRect(c.x - 1, c.y - 2, 2, 4); }
      ctx.restore();
      label(ctx, there ? (med ? "medical" : "crew") : "→", c.x + 6, c.y + 3, med ? "#ffffff" : COLOURS.sc, 9, true);
    }
  }
}

// cars: list of {id, s, lateral, inPit, spun, speed}
function drawCars(view, r, cars, options) {
  const ctx = view.ctx;
  const pitSide = (options.pitSide || 11) * pitSign(view);
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

// Live cars of the race -> the format drawCars wants.
// lead = race time (s) between the last simulation step and "now": the cars are
// drawn where they are at this moment (the simulation moves in 0.1 s steps,
// the screen 60 times per second) – so they glide instead of jumping.
function liveCarList(r, lead) {
  const list = [];
  const L = r.track.length;
  for (const car of r.cars) {
    if (car.hidden || car.mode === "PARKED") continue;
    const moving = lead > 0 && car.speed > 0 && (car.mode === "RACE" || car.mode === "FORMATION" || car.mode === "COOLDOWN");
    list.push({ id: car.id, s: moving ? mod(car.s + car.speed * lead, L) : car.s, lateral: car.lateral, inPit: !!car.pit.state, spun: car.spin > 0 || car.mode === "STOPPED", speed: car.speed });
  }
  return list;
}

// ---------- The big map ----------
// Pixel density of the map: phones have 3x screens, but 9x the pixels to
// fill every frame is too much for them. 2x (1.5x on small screens) looks the same.
function mapPixelRatio(w) {
  return Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
}

// The size of the canvas, kept up to date by a ResizeObserver
// (reading it from the layout every frame forces a layout every frame)
function canvasSize(canvas) {
  if (!canvas._size) {
    const rect = canvas.getBoundingClientRect();
    canvas._size = { w: rect.width, h: rect.height };
    if (window.ResizeObserver && !canvas._observer) {
      canvas._observer = new ResizeObserver(entries => {
        const e = entries[entries.length - 1];
        const box = e.borderBoxSize && e.borderBoxSize[0];
        canvas._size = box ? { w: box.inlineSize, h: box.blockSize } : { w: e.contentRect.width, h: e.contentRect.height };
        if (typeof mapDirty !== "undefined") mapDirty = true;
      });
      canvas._observer.observe(canvas);
    } else if (!window.ResizeObserver) {
      canvas._size = null; // old browser: measure every frame
      return { w: rect.width, h: rect.height };
    }
  }
  return canvas._size;
}

// Everything on the map that only changes when the track status changes
// (track, pit lane, flags, zones, sector numbers) is drawn once into a
// hidden canvas; every frame copies it and draws the cars on top.
let staticLayer = null; // { canvas, ctx, key }

function staticLayerKey(r, view) {
  const w = r.weather;
  return [
    view.w, view.h, view.ratio, r.track.n,
    r.status, r.chequered ? 1 : 0, r.sectorFlags.map((f, i) => shownFlag(i)).join(""), r.slippery.map(x => (x ? 1 : 0)).join(""),
    hoverSector, selectedSector, selectedSectors.join("."), r.drsEnabled ? 1 : 0, r.straightEnabled ? 1 : 0, (r.straightOff || []).map(x => (x ? 1 : 0)).join(""), (r.drsOff || []).map(x => (x ? 1 : 0)).join(""), (r.rainFlags || []).map(x => (x ? 1 : 0)).join(""),
    r.pitExitOpen ? 1 : 0, r.pitEntryOpen ? 1 : 0,
    r.track.drsZones.map(z => Math.round(z.start) + "-" + Math.round(z.end)).join(","),
    (r.track.straightZones || []).map(z => Math.round(z.start) + "-" + Math.round(z.end)).join(","),
    w.rain > 0.05 ? Math.round(w.rain * 100) : 0,
    w.wetS ? w.wetS.map(x => (x < 0.05 ? 0 : Math.round(x * 20))).join("") : ""
  ].join("|");
}

function drawStaticLayer(view, r) {
  const key = staticLayerKey(r, view);
  if (staticLayer && staticLayer.key === key) return staticLayer.canvas;
  if (!staticLayer) {
    const c = document.createElement("canvas");
    staticLayer = { canvas: c, ctx: c.getContext("2d"), key: "" };
  }
  const c = staticLayer.canvas;
  const ctx = staticLayer.ctx;
  const pw = Math.round(view.w * view.ratio);
  const ph = Math.round(view.h * view.ratio);
  if (c.width !== pw || c.height !== ph) {
    c.width = pw;
    c.height = ph;
  }
  ctx.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);

  // rain tint
  if (r.weather.rain > 0.05) {
    ctx.fillStyle = "rgba(60,120,255," + (r.weather.rain * 0.12) + ")";
    ctx.fillRect(0, 0, view.w, view.h);
  }
  const layerView = Object.assign({}, view, { ctx });
  drawTrackLayers(layerView, r, { width: 8, interactive: true });
  drawSectorNumbers(layerView, r);
  staticLayer.key = key;
  return c;
}

// The rain radar changes slowly (the cells move with the wind): drawn every 5 s of race time
let radarLayer = null; // { canvas, ctx, key }
function drawRadarLayer(ctx, r, x, y, size, ratio) {
  const key = Math.floor(r.time / 5) + "|" + ratio + "|" + size + "|" + Math.round(r.weather.wind * 3.6) + "|" + (r.setup && r.setup.weather && r.setup.weather.offset);
  if (!radarLayer) {
    const c = document.createElement("canvas");
    radarLayer = { canvas: c, ctx: c.getContext("2d"), key: "" };
  }
  if (radarLayer.key !== key || radarLayer.race !== r) {
    const c = radarLayer.canvas;
    const px = Math.round(size * ratio);
    if (c.width !== px) {
      c.width = px;
      c.height = px;
    }
    radarLayer.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    radarLayer.ctx.clearRect(0, 0, size, size);
    drawRadar(radarLayer.ctx, r, 0, 0, size);
    radarLayer.key = key;
    radarLayer.race = r;
  }
  ctx.drawImage(radarLayer.canvas, x, y, size, size);
}

// Where the rain radar fits: the corner of the map with the fewest track points under it
// (bottom left is the legend). Smaller if no corner is free.
// The corner is chosen once per session: the view is rebuilt when the canvas
// size changes, and the radar must not jump to another corner mid-session.
let radarChoice = null; // { race, corner, size }

function radarCorners(view, size) {
  const margin = 10;
  return [
    { x: view.w - size - margin, y: margin },               // top right
    { x: margin, y: margin },                               // top left
    { x: view.w - size - margin, y: view.h - size - margin }  // bottom right
  ];
}

function radarSpot(view) {
  if (view.radarSpot) return view.radarSpot;
  if (!radarChoice || radarChoice.race !== race) {
    let best = null;
    for (const size of [140, 120, 100]) {
      radarCorners(view, size).forEach((c, corner) => {
        let hits = 0;
        for (let i = 0; i < view.px.length; i += 2) {
          const x = view.px[i];
          const y = view.py[i];
          if (x > c.x - 14 && x < c.x + size + 14 && y > c.y - 14 && y < c.y + size + 14) hits++;
        }
        if (!best || hits < best.hits || (hits === best.hits && size > best.size)) best = { corner, size, hits };
      });
      if (best.hits === 0) break;
    }
    radarChoice = { race, corner: best.corner, size: best.size };
  }
  const c = radarCorners(view, radarChoice.size)[radarChoice.corner];
  view.radarSpot = { x: c.x, y: c.y, size: radarChoice.size };
  return view.radarSpot;
}

function drawMainMap(canvas, selectedCarId, lead) {
  lead = lead || 0;
  const r = race;
  if (!r) return;
  const ctx = canvas._ctx || (canvas._ctx = canvas.getContext("2d"));
  const size = canvasSize(canvas);
  const w = Math.round(size.w);
  const h = Math.round(size.h);
  if (w < 10 || h < 10) return;
  const ratio = mapPixelRatio(w);

  // (re)build the view when the size of the canvas changes
  if (!mainView || mainView.w !== w || mainView.h !== h || mainView.track !== r.track || mainView.ratio !== ratio) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // the track is fitted above the legend, so no corner label ends up under it
    const legend = canvas.parentElement && canvas.parentElement.querySelector(".map-legend");
    // (labels stick out up to ~22 px from the track: the legend height + its margin is kept free)
    const legendSpace = legend ? legend.offsetHeight + 12 : 0;
    mainView = makeView(r.track, ctx, w, h, r.track.bounds, 34, legendSpace);
    mainView.ratio = ratio;
  }
  ctx.clearRect(0, 0, w, h);

  ctx.drawImage(drawStaticLayer(mainView, r), 0, 0, w, h);
  drawPendingFlagPanels(mainView, r);
  drawRainPanels(mainView, r);
  if (isCellWeather(r)) {
    const spot = radarSpot(mainView);
    drawRadarLayer(ctx, r, spot.x, spot.y, spot.size, ratio);
  }
  drawObstacles(mainView, r);
  drawCars(mainView, r, liveCarList(r, lead), { selected: selectedCarId, interactive: true, live: true });
  if (r.sc) drawSafetyCar(mainView, mod(r.sc.s + (r.sc.speed || 0) * lead, r.track.length));
  const med = lapOneMedicalCar(r, lead);
  if (med !== null) drawMedicalCar(mainView, med);
}

// The rain signal of the LED flag panels: a white cloud with falling rain on a dark panel,
// next to every marshal sector that shows it (a few small shapes – cheap to animate)
function drawRainPanels(view, r) {
  if (!(r.rainFlags && r.rainFlags.some(Boolean))) return;
  const tr = r.track;
  const ctx = view.ctx;
  const t = performance.now() / 700;
  ctx.save();
  for (let i = 0; i < r.sectorFlags.length; i++) {
    if (!rainShown(i)) continue;
    const at = screenAt(view, (i + 0.5) * tr.msLen, -34);
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.scale(1.4, 1.4); // the panel is drawn at 0,0 and scaled
    const p = { x: 0, y: 0 };
    // the panel
    ctx.fillStyle = "rgba(10,12,16,0.92)";
    ctx.strokeStyle = "#5f6880";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.rect(p.x - 9, p.y - 9, 18, 18);
    ctx.fill();
    ctx.stroke();
    // the cloud
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x - 3, p.y - 2, 3, 0, Math.PI * 2);
    ctx.arc(p.x + 1, p.y - 4, 3.6, 0, Math.PI * 2);
    ctx.arc(p.x + 4, p.y - 1.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(p.x - 4.5, p.y - 2, 9, 2.6);
    // the falling rain (three drops, each moving down and starting again)
    ctx.strokeStyle = COLOURS.rain;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const f = (t + k / 3 + i * 0.17) % 1;
      const x = p.x - 3 + k * 3 - f * 1.2;
      const y = p.y + 1.5 + f * 5;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 0.8, y + 2.2);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// A flag that was set but is not on the light panels yet (1–2 s): drawn pulsing
function drawPendingFlagPanels(view, r) {
  if (!r.flagPanels || !r.flagPanels.length) return;
  const tr = r.track;
  const ctx = view.ctx;
  for (let i = 0; i < r.sectorFlags.length; i++) {
    if (!flagPanelPending(i)) continue;
    const flag = r.sectorFlags[i];
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(performance.now() / 90));
    const colour = flag === "DOUBLE" ? COLOURS.double : flag === "YELLOW" ? COLOURS.yellow : COLOURS.green;
    strokeSegment(view, i * tr.msLen, (i + 1) * tr.msLen, colour, flag === "GREEN" ? 3 : 8, [6, 4]);
    ctx.restore();
  }
}

// On lap 1 the medical car follows the field (only drawn) and goes back into the pits.
function lapOneMedicalCar(r, lead) {
  if (r.session !== "RACE" || r.phase !== "RACE" || !r.order) return null;
  let last = null;
  for (let i = r.order.length - 1; i >= 0; i--) {
    const c = r.order[i];
    if (c.mode === "RACE" && !c.pit.state && !c.hidden) { last = c; break; }
  }
  if (!last || last.laps > 0) return null;
  return mod(last.s + (last.speed || 0) * lead - 70, r.track.length);
}

function drawMedicalCar(view, s) {
  const ctx = view.ctx;
  const p = screenAt(view, s, 0);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#0d1017";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(p.x - 7, p.y - 6, 14, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COLOURS.red;
  ctx.fillRect(p.x - 1.5, p.y - 4, 3, 8);
  ctx.fillRect(p.x - 4, p.y - 1.5, 8, 3);
  ctx.restore();
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
