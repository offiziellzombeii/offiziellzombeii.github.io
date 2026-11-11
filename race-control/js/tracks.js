// =====================================================================
//  tracks.js
//  Everything about the circuit:
//  1. Three invented circuits for the fictitious race
//  2. buildTrack(): turns a list of points into a usable track
//     (length, speed profile, corners, DRS zones, pit lane, sectors ...)
//  3. Small helper functions like "where on the map is metre 1234?"
//
//  A position on the track is always "s" = metres after the start/finish line.
// =====================================================================

// ---------- 1. Fictional circuits ----------
// The points are corners of a rough drawing (in metres). We draw a smooth
// curve through them, so a few points are enough for a whole circuit.
const FICTIONAL_TRACKS = [
  {
    id: "valmonte",
    name: "Autodromo di Valmonte",
    country: "Valmonte",
    description: "Fast and flowing, with a tight hairpin and two long DRS straights.",
    scale: 0.8,
    laps: 32,
    pitLaneLength: 420,
    points: [
      [0, 0], [600, 0], [900, 0], [1000, 60], [1020, 180], [950, 300], [800, 350], [700, 450],
      [720, 600], [850, 700], [1050, 720], [1250, 650], [1350, 500], [1400, 300], [1500, 150],
      [1650, 120], [1750, 200], [1760, 400], [1700, 650], [1600, 850], [1400, 950], [1100, 1000],
      [700, 1000], [400, 950], [200, 850], [100, 700], [150, 550], [300, 480], [350, 380],
      [250, 280], [100, 250], [-50, 200], [-120, 100], [-80, 20]
    ]
  },
  {
    id: "harbourside",
    name: "Harbourside Street Circuit",
    country: "Port Calder",
    description: "Tight street circuit with 90° corners and walls close to the track.",
    scale: 1.0,
    laps: 40,
    pitLaneLength: 380,
    points: [
      [0, 0], [500, 0], [800, 0], [850, 30], [860, 100], [860, 400], [880, 450], [930, 460],
      [1200, 460], [1250, 480], [1260, 530], [1260, 700], [1230, 750], [1180, 760], [900, 760],
      [400, 760], [350, 780], [340, 830], [340, 950], [310, 1000], [250, 1010], [0, 1010],
      [-150, 1000], [-200, 950], [-210, 800], [-200, 600], [-150, 500], [-120, 450], [-180, 400],
      [-200, 300], [-200, 100], [-170, 30], [-100, 0]
    ]
  },
  {
    id: "monteverdi",
    name: "Monte Verdi Ring",
    country: "Verdania",
    description: "Parkland circuit with fast sweepers, a chicane and a tight hairpin at the far end.",
    scale: 1.0,
    laps: 36,
    pitLaneLength: 400,
    points: [
      [0, 0], [700, 0], [950, -30], [1050, -120], [1080, -250], [1000, -330], [880, -330],
      [800, -400], [820, -520], [950, -600], [1150, -620], [1250, -700], [1230, -820], [1100, -850],
      [800, -800], [500, -760], [300, -700], [150, -720], [0, -800], [-150, -760], [-250, -600],
      [-260, -400], [-200, -250], [-220, -120], [-150, -30]
    ]
  }
];

// Build a track from one of the fictional circuits above
function buildFictionalTrack(def) {
  const control = def.points.map(p => ({ x: p[0] * def.scale, y: p[1] * def.scale }));
  const curve = closedSpline(control);
  return buildTrack({
    name: def.name,
    points: curve,
    unitsPerMeter: 1,      // the drawing is already in metres
    rotateToStraight: true, // put the start line on the longest straight
    pitLaneLength: def.pitLaneLength
  });
}


// ---------- 2. Geometry helpers ----------

// A smooth closed curve through all control points
// ("centripetal Catmull-Rom spline" – it never makes strange loops)
function closedSpline(points) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];

    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.max(1e-6, Math.hypot(p1.x - p0.x, p1.y - p0.y)));
    const t2 = t1 + Math.sqrt(Math.max(1e-6, Math.hypot(p2.x - p1.x, p2.y - p1.y)));
    const t3 = t2 + Math.sqrt(Math.max(1e-6, Math.hypot(p3.x - p2.x, p3.y - p2.y)));

    const steps = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2));
    for (let k = 0; k < steps; k++) {
      const t = t1 + (t2 - t1) * k / steps;
      const a1 = mix(p0, p1, (t - t0) / (t1 - t0));
      const a2 = mix(p1, p2, (t - t1) / (t2 - t1));
      const a3 = mix(p2, p3, (t - t2) / (t3 - t2));
      const b1 = mix(a1, a2, (t - t0) / (t2 - t0));
      const b2 = mix(a2, a3, (t - t1) / (t3 - t1));
      out.push(mix(b1, b2, (t - t1) / (t2 - t1)));
    }
  }
  return out;
}

function mix(a, b, f) {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Points with exactly the same distance between them
function resampleClosed(points, step) {
  const n = points.length;
  const cumulative = [0];
  for (let i = 1; i <= n; i++) {
    const a = points[i - 1];
    const b = points[i % n];
    cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[n];
  const count = Math.max(50, Math.round(total / step));
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const d = k * total / count;
    while (cumulative[j + 1] < d) j++;
    const a = points[j];
    const b = points[(j + 1) % n];
    const f = (d - cumulative[j]) / Math.max(1e-9, cumulative[j + 1] - cumulative[j]);
    out.push(mix(a, b, f));
  }
  return { points: out, length: total };
}

// Moving average – removes the "wobble" from real GPS data
function smoothClosed(points, window) {
  const n = points.length;
  return points.map((p, i) => {
    let x = 0, y = 0;
    for (let k = -window; k <= window; k++) {
      const q = points[(i + k + n) % n];
      x += q.x;
      y += q.y;
    }
    return { x: x / (2 * window + 1), y: y / (2 * window + 1) };
  });
}

function rotateArray(list, start) {
  return list.slice(start).concat(list.slice(0, start));
}

// Is s between a and b (going forward around the loop)?
function inRange(s, a, b, L) {
  return mod(s - a, L) <= mod(b - a, L);
}


// ---------- 3. Speed profile (how fast an ideal car can go at every point) ----------
const TOP_SPEED = 93; // m/s = 335 km/h

// Simple physics: an F1 car can take a corner faster at higher speed
// because of downforce. Then we add the limits of accelerating and braking.
function physicsSpeedProfile(curvature, ds) {
  const g = 9.81;
  const n = curvature.length;
  const v = curvature.map(c => {
    const radius = 1 / Math.max(Math.abs(c), 1e-6);
    const denominator = 1 - radius * g * 0.00025;
    if (denominator <= 0) return TOP_SPEED;
    return Math.min(TOP_SPEED, Math.sqrt(1.8 * radius * g / denominator));
  });

  // Accelerating (forward) – go around twice so the loop is closed
  for (let k = 0; k < 2 * n; k++) {
    const i = k % n;
    const prev = (i - 1 + n) % n;
    v[i] = Math.min(v[i], Math.sqrt(v[prev] * v[prev] + 2 * accelerationAt(v[prev]) * ds));
  }
  // Braking (backward)
  for (let k = 2 * n; k > 0; k--) {
    const i = k % n;
    const next = (i + 1) % n;
    v[i] = Math.min(v[i], Math.sqrt(v[next] * v[next] + 2 * brakingAt(v[next]) * ds));
  }
  return v;
}

function accelerationAt(v) {
  return Math.max(0.5, 14 * (1 - Math.pow(Math.min(v / TOP_SPEED, 1), 1.6)));
}

function brakingAt(v) {
  return 9.81 * (1.9 + 0.00045 * v * v);
}

// Real speed samples (from OpenF1 telemetry) -> one speed per track point
function profileFromSamples(samples, n) {
  const v = new Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    while (j < samples.length - 2 && samples[j + 1].f < f) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    const t = b.f > a.f ? clamp((f - a.f) / (b.f - a.f), 0, 1) : 0;
    v[i] = lerp(a.v, b.v, t);
  }
  // smooth a little
  const out = v.map((_, i) => {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += v[(i + k + n) % n];
    return Math.max(15, sum / 5);
  });
  return out;
}


// ---------- 4. Build the track ----------
// options: name, points, unitsPerMeter OR lengthMeters, speedSamples,
//          smooth, rotateToStraight, marshalSectors, pitLaneLength
function buildTrack(options) {
  let raw = options.points;
  let polyLength = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % raw.length];
    polyLength += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const lengthMeters = options.lengthMeters || polyLength / options.unitsPerMeter;
  const unitsPerMeter = polyLength / lengthMeters;

  // one point every ~5 metres
  let pts = resampleClosed(raw, 5 * unitsPerMeter).points;
  if (options.smooth) {
    pts = smoothClosed(pts, options.smooth);
    pts = resampleClosed(pts, 5 * unitsPerMeter).points;
  }
  const n = pts.length;
  const L = lengthMeters;
  const ds = L / n;

  // Curvature (1 / radius in metres) at every point
  const k = Math.max(1, Math.round(12 / ds));
  let curvature = pts.map((b, i) => {
    const a = pts[(i - k + n) % n];
    const c = pts[(i + k) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ac = Math.hypot(c.x - a.x, c.y - a.y);
    return 2 * cross / Math.max(1e-9, ab * bc * ac) * unitsPerMeter;
  });
  curvature = curvature.map((_, i) => {
    let sum = 0;
    for (let j = -k; j <= k; j++) sum += curvature[(i + j + n) % n];
    return sum / (2 * k + 1);
  });

  let profile = options.speedSamples && options.speedSamples.length > 20
    ? profileFromSamples(options.speedSamples, n)
    : physicsSpeedProfile(curvature, ds);

  // Put the start/finish line 45% into the longest straight
  if (options.rotateToStraight) {
    const main = findStraights(profile, ds)[0];
    if (main) {
      const start = (main.start + Math.round(main.count * 0.45)) % n;
      pts = rotateArray(pts, start);
      curvature = rotateArray(curvature, start);
      profile = rotateArray(profile, start);
    }
  }

  const track = {
    name: options.name,
    n: n,
    length: L,
    ds: ds,
    unitsPerMeter: unitsPerMeter,
    xs: pts.map(p => p.x),
    ys: pts.map(p => p.y),
    nx: [],
    ny: [],
    curvature: curvature,
    profile: profile,
    vMax: Math.max(...profile)
  };

  // Normal vectors (pointing to the left of the driving direction)
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    track.nx.push(-(b.y - a.y) / len);
    track.ny.push((b.x - a.x) / len);
  }

  // Which side is the inside of the loop? (signed area of the polygon)
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  track.insideSign = area > 0 ? 1 : -1;

  // Lap time of an "ideal" car
  track.refLapTime = profile.reduce((sum, v) => sum + ds / v, 0);

  // Bounds for drawing
  track.bounds = {
    minX: Math.min(...track.xs), maxX: Math.max(...track.xs),
    minY: Math.min(...track.ys), maxY: Math.max(...track.ys)
  };

  findCorners(track);

  // DRS zones on the longest straights
  const straights = findStraights(profile, ds, 0.88);
  const zoneCount = L > 5500 ? 3 : 2;
  track.drsZones = straights
    .filter(st => st.count * ds >= 400)
    .slice(0, zoneCount)
    .map(st => {
      const startS = st.start * ds;
      const endS = (st.start + st.count) * ds;
      return {
        start: mod(startS + 50, L),
        end: mod(endS - 40, L),
        detect: mod(startS - 150, L)
      };
    });

  // Pit lane: runs next to the start/finish straight
  const laneLength = options.pitLaneLength || 400;
  track.pit = {
    length: laneLength,
    entry: mod(-laneLength * 0.45, L),
    exit: laneLength * 0.55,
    boxes: []
  };
  for (let t = 0; t < 12; t++) {
    track.pit.boxes.push(mod(track.pit.entry + laneLength * (0.28 + 0.04 * t), L));
  }

  // Marshal sectors (for yellow flags) and the 3 timing sectors
  track.marshalSectors = options.marshalSectors || clamp(Math.round(L / 260), 14, 24);
  track.msLen = L / track.marshalSectors;
  track.sectorBounds = [L / 3, 2 * L / 3];

  return track;
}

// Find the straights: parts where the car is near top speed.
// Result is sorted: the longest straight first.
function findStraights(profile, ds, threshold) {
  const n = profile.length;
  const vMax = Math.max(...profile);
  const fast = profile.map(v => v >= vMax * (threshold || 0.93));

  // start counting at a slow point, so no straight is cut in two
  let first = fast.indexOf(false);
  if (first < 0) return [{ start: 0, count: n }];

  const straights = [];
  let current = null;
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    if (fast[i]) {
      if (!current) current = { start: i, count: 0 };
      current.count++;
    } else if (current) {
      straights.push(current);
      current = null;
    }
  }
  if (current) straights.push(current);
  return straights.sort((a, b) => b.count - a.count);
}

// Corners = the slowest points of the speed profile
function findCorners(track) {
  const { profile, n, ds } = track;
  const window = Math.max(3, Math.round(70 / ds));
  const minima = [];

  for (let i = 0; i < n; i++) {
    const v = profile[i];
    if (v > track.vMax * 0.9) continue;
    let isMinimum = true;
    for (let j = -window; j <= window && isMinimum; j++) {
      if (j === 0) continue;
      const other = profile[(i + j + n) % n];
      if (other < v || (other === v && j < 0)) isMinimum = false;
    }
    if (isMinimum) minima.push(i);
  }

  // corners closer than 100 m count as one
  const merged = [];
  for (const i of minima) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (i - last) * ds < 100) {
      if (profile[i] < profile[last]) merged[merged.length - 1] = i;
    } else {
      merged.push(i);
    }
  }
  if (merged.length > 1 && (merged[0] + n - merged[merged.length - 1]) * ds < 100) merged.pop();

  track.corners = merged.map((i, index) => {
    // braking zone: go back while the speed goes up (backwards)
    let entry = i;
    for (let k = 0; k < 400 / ds; k++) {
      const prev = (entry - 1 + n) % n;
      if (profile[prev] < profile[entry]) break;
      entry = prev;
    }
    let exit = i;
    for (let k = 0; k < 300 / ds; k++) {
      const next = (exit + 1) % n;
      if (profile[next] < profile[exit]) break;
      exit = next;
    }
    return {
      number: index + 1,
      name: "Turn " + (index + 1),
      apex: i * ds,
      entry: entry * ds,
      exit: exit * ds,
      minSpeed: profile[i],
      direction: track.curvature[i] > 0 ? "left" : "right",
      trackLimits: false
    };
  });

  // Track limits are checked at medium-speed corners with a fast exit
  const candidates = track.corners
    .filter(c => c.minSpeed > track.vMax * 0.3 && c.minSpeed < track.vMax * 0.8)
    .sort((a, b) => b.minSpeed - a.minSpeed)
    .slice(0, 3);
  for (const c of candidates) c.trackLimits = true;
  if (candidates.length === 0 && track.corners.length > 0) track.corners[0].trackLimits = true;
}


// ---------- 5. Questions about a position on the track ----------

// x, y and the left normal vector at metre s
function trackPoint(track, s) {
  const f = mod(s, track.length) / track.ds;
  const i = Math.floor(f) % track.n;
  const j = (i + 1) % track.n;
  const t = f - Math.floor(f);
  return {
    x: lerp(track.xs[i], track.xs[j], t),
    y: lerp(track.ys[i], track.ys[j], t),
    nx: track.nx[i],
    ny: track.ny[i]
  };
}

// Speed of an ideal car at metre s (m/s)
function trackSpeed(track, s) {
  const f = mod(s, track.length) / track.ds;
  const i = Math.floor(f) % track.n;
  const j = (i + 1) % track.n;
  return lerp(track.profile[i], track.profile[j], f - Math.floor(f));
}

// Marshal sector number (1, 2, 3 ...) at metre s
function marshalSectorAt(track, s) {
  return Math.min(track.marshalSectors, Math.floor(mod(s, track.length) / track.msLen) + 1);
}

// The corner at (or nearest to) metre s
function cornerAt(track, s) {
  const L = track.length;
  if (track.corners.length === 0) return { name: "the main straight", number: 0, apex: 0 };
  for (const c of track.corners) {
    if (inRange(s, c.entry - 30, c.exit + 30, L)) return c;
  }
  let best = track.corners[0];
  let bestDistance = Infinity;
  for (const c of track.corners) {
    const d = Math.min(mod(s - c.apex, L), mod(c.apex - s, L));
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

// A human readable position like "Turn 4" or "after Turn 4"
function locationName(track, s) {
  const c = cornerAt(track, s);
  if (inRange(s, c.entry - 30, c.exit + 30, track.length)) return c.name;
  return mod(s - c.apex, track.length) < track.length / 2 ? "after " + c.name : "before " + c.name;
}

// Is s inside the pit lane area (between pit entry and pit exit)?
function inPitArea(track, s) {
  return inRange(s, track.pit.entry, track.pit.exit, track.length);
}
