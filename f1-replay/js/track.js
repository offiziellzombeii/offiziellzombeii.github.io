// =====================================================================
//  track.js
//  Draws the track map: the track line, flags, cars and battles.
// =====================================================================

const canvas = document.getElementById("trackCanvas");
const ctx = canvas.getContext("2d"); // the "pen" we draw with

let mapWidth = 600;   // size of the canvas on screen (in CSS pixels)
let mapHeight = 450;
let carScreenPositions = {}; // driver number -> {x, y} on the canvas (used for clicking)

// Colours of the track (the same colours are used in the legend in index.html)
const TRACK_COLOURS = {
  normal: "#3b4252",
  yellow: "#ffd60a",
  doubleYellow: "#ffb020",
  safetyCar: "#ff7a00",
  red: "#ff3b30",
  chequered: "#e6e9ef",
  battle: "#ff7a00"
};

// Make the canvas sharp on every screen size.
// The canvas has "real" pixels (canvas.width) and a size on screen (CSS).
// We make the real pixels match the screen size.
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1; // e.g. 2 on high resolution screens
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); // now we can draw in CSS pixels
  mapWidth = rect.width;
  mapHeight = rect.height;
}
window.addEventListener("resize", resizeCanvas);

// Convert track coordinates to pixel coordinates on the canvas
function toCanvas(x, y) {
  const padding = 30;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const scale = Math.min((mapWidth - 2 * padding) / width, (mapHeight - 2 * padding) / height);
  const offsetX = (mapWidth - width * scale) / 2;
  const offsetY = (mapHeight - height * scale) / 2;
  return {
    x: offsetX + (x - bounds.minX) * scale,
    y: mapHeight - (offsetY + (y - bounds.minY) * scale) // canvas y goes down, so we flip it
  };
}

// Draw a line through a list of track points
function drawPath(points, colour, width, dashed, glow) {
  if (points.length < 2) return;

  ctx.save(); // remember the pen settings, so we can undo our changes below
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (dashed) ctx.setLineDash([14, 10]);
  if (glow) {
    ctx.shadowColor = colour;
    ctx.shadowBlur = 16;
  }

  ctx.beginPath();
  points.forEach((p, index) => {
    const c = toCanvas(p.x, p.y);
    if (index === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  });
  ctx.stroke();
  ctx.restore(); // undo the pen changes
}

// Text with a dark outline, so it is readable on every background
function drawLabel(text, x, y, colour, bold) {
  ctx.font = (bold ? "700 12px" : "500 11px") + " Inter, Arial, sans-serif";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#0d1017";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function drawMessage(text) {
  ctx.fillStyle = "#8b93a7";
  ctx.font = "14px Inter, Arial, sans-serif";
  ctx.fillText(text, 20, 30);
}

// The points that belong to one marshal sector.
// We simply split the lap into equal parts (this is an estimate).
function sectorPoints(sector) {
  const n = trackOutline.length;
  const from = Math.floor((sector - 1) / marshalSectorCount * n);
  const to = Math.min(n - 1, Math.ceil(sector / marshalSectorCount * n));
  return trackOutline.slice(from, to + 1);
}

// ---------- The track with flag colours ----------
function drawTrack(status) {
  if (trackOutline.length === 0) return;
  const fullLap = trackOutline.concat([trackOutline[0]]); // go back to the start to close the loop

  // 1. dark border below the track
  drawPath(fullLap, "#0d1017", 16);

  // 2. the track itself, coloured by the track status
  drawPath(fullLap, TRACK_COLOURS.normal, 8);
  if (status.main === "SC" || status.main === "SC_ENDING") {
    drawPath(fullLap, TRACK_COLOURS.safetyCar, 8, false, true);
  } else if (status.main === "VSC" || status.main === "VSC_ENDING") {
    drawPath(fullLap, TRACK_COLOURS.yellow, 8, true, true); // dashed line for the VSC
  } else if (status.main === "RED") {
    drawPath(fullLap, TRACK_COLOURS.red, 8, false, true);
  } else if (status.main === "YELLOW") {
    drawPath(fullLap, TRACK_COLOURS.yellow, 8, false, true);
  } else if (status.main === "CHEQUERED" || status.main === "FINISHED") {
    drawPath(fullLap, TRACK_COLOURS.chequered, 8, true);
  }

  // 3. sectors with a yellow flag
  if (marshalSectorCount > 0) {
    for (const sector in status.yellowSectors) {
      const isDouble = status.yellowSectors[sector] === "DOUBLE YELLOW";
      const points = sectorPoints(Number(sector));
      drawPath(points, isDouble ? TRACK_COLOURS.doubleYellow : TRACK_COLOURS.yellow, isDouble ? 12 : 10, false, true);

      // write the sector number next to it
      const middle = points[Math.floor(points.length / 2)];
      if (middle) {
        const c = toCanvas(middle.x, middle.y);
        drawLabel((isDouble ? "!! " : "! ") + "S" + sector, c.x + 10, c.y - 10, TRACK_COLOURS.yellow, true);
      }
    }
  }

  // 4. start / finish line
  const start = toCanvas(trackOutline[0].x, trackOutline[0].y);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(start.x - 3, start.y - 3, 6, 6);
}

// ---------- The cars ----------
function drawCar(number, c, inBattle) {
  const selected = Number(number) === selectedDriver;

  // Cars in a battle get smaller circles, so you can see them better
  let radius = inBattle ? 4.5 : 7;
  if (selected) radius += 2;

  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = teamColour(number);
  ctx.fill();
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.strokeStyle = selected ? "#ffffff" : "#0d1017";
  ctx.stroke();

  drawLabel(driverName(number), c.x + radius + 3, c.y - radius, selected ? "#ffffff" : "#cbd2df", selected);
}

function drawCars() {
  carScreenPositions = {};

  // 1. Where is every car on the screen?
  for (const number in drivers) {
    if (isRetired(number)) continue;
    const pos = getCarPosition(number, currentTime);
    if (pos) carScreenPositions[number] = toCanvas(pos.x, pos.y);
  }

  // 2. Draw a circle around every battle (below the cars)
  const inBattle = {};
  const pulse = 2 * Math.sin(performance.now() / 200); // makes the circle "breathe"
  for (const b of currentBattles) {
    const c1 = carScreenPositions[b.ahead];
    const c2 = carScreenPositions[b.behind];
    if (!c1 || !c2) continue;

    const distance = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    if (distance > 80) continue; // too far apart on the map, don't draw a giant circle

    inBattle[b.ahead] = true;
    inBattle[b.behind] = true;

    ctx.save();
    ctx.beginPath();
    ctx.arc((c1.x + c2.x) / 2, (c1.y + c2.y) / 2, distance / 2 + 11 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 122, 0, 0.12)";
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = TRACK_COLOURS.battle;
    ctx.stroke();
    ctx.restore();
  }

  // 3. Draw the cars. The selected car is drawn last, so it is on top.
  for (const number in carScreenPositions) {
    if (Number(number) !== selectedDriver) {
      drawCar(number, carScreenPositions[number], inBattle[number]);
    }
  }
  if (carScreenPositions[selectedDriver]) {
    drawCar(selectedDriver, carScreenPositions[selectedDriver], inBattle[selectedDriver]);
  }
}

// ---------- Draw everything (called many times per second) ----------
function drawMap() {
  ctx.clearRect(0, 0, mapWidth, mapHeight);

  if (!bounds) {
    drawMessage("Loading track...");
    return;
  }

  drawTrack(getTrackStatus());
  drawCars();

  if (Object.keys(carScreenPositions).length === 0) {
    drawMessage("Loading car positions...");
  }
}

// ---------- Clicking on a car selects the driver ----------

// Find the car closest to a point on the canvas (max. 20 pixels away)
function carAt(x, y) {
  let closest = null;
  let closestDistance = 20;
  for (const number in carScreenPositions) {
    const c = carScreenPositions[number];
    const distance = Math.hypot(c.x - x, c.y - y);
    if (distance < closestDistance) {
      closest = Number(number);
      closestDistance = distance;
    }
  }
  return closest;
}

canvas.addEventListener("click", event => {
  const rect = canvas.getBoundingClientRect();
  const number = carAt(event.clientX - rect.left, event.clientY - rect.top);
  if (number !== null) selectDriver(number);
});

// Show a "hand" mouse cursor when you are over a car
canvas.addEventListener("mousemove", event => {
  const rect = canvas.getBoundingClientRect();
  const number = carAt(event.clientX - rect.left, event.clientY - rect.top);
  canvas.style.cursor = number !== null ? "pointer" : "default";
});
