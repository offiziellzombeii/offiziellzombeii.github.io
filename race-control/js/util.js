// =====================================================================
//  util.js
//  Small helper functions used by all other files:
//  random numbers, maths, text formatting and downloading from OpenF1.
// =====================================================================

const API = "https://api.openf1.org/v1/";

// ---------- Random numbers ----------
// We use our own random generator with a "seed" number.
// The same seed always gives the same race (nice for testing).
function makeRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let random = makeRandom(Date.now() % 1000000000);

function setSeed(seed) {
  random = makeRandom(seed);
}

// A random number between min and max
function rand(min, max) {
  return min + random() * (max - min);
}

// A random whole number between min and max (both included)
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

// true with a probability of p (0 = never, 1 = always)
function chance(p) {
  return random() < p;
}

// A random item of a list
function pick(list) {
  return list[Math.floor(random() * list.length)];
}


// ---------- Maths ----------
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, fraction) {
  return a + (b - a) * fraction;
}

// Like "%", but the result is never negative: mod(-10, 100) = 90
function mod(a, n) {
  return ((a % n) + n) % n;
}

function median(list) {
  if (list.length === 0) return null;
  const sorted = list.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Did a car that moved from "from" to "to" pass the point "x"?
// The track is a loop of length L, so "to" may be bigger than L.
function passedPoint(from, to, x, L) {
  return (x > from && x <= to) || (x + L > from && x + L <= to);
}


// ---------- Formatting ----------

// 83.407 -> "1:23.407"
function formatLapTime(seconds) {
  if (seconds == null || !isFinite(seconds)) return "–";
  const ms = Math.round(seconds * 1000);
  const minutes = Math.floor(ms / 60000);
  const rest = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return minutes + ":" + rest;
}

// 3723 -> "1:02:03"
function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// Seconds since midnight -> "14:03:22"
function formatDayTime(seconds) {
  const total = Math.floor(mod(seconds, 86400));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// Make text safe to put into HTML
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// ---------- Downloading from the OpenF1 API ----------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Time in milliseconds -> "2024-11-03T16:00:00" (the format the API wants)
function isoTime(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}

// The API allows about 3 requests per second AND 30 requests per minute.
// So every request waits 350 ms after the one before, and we never send
// more than 28 requests in 60 seconds.
let nextRequestAllowed = 0;
const recentRequests = [];   // times of the last requests

async function waitForTurn() {
  while (true) {
    const now = Date.now();
    while (recentRequests.length > 0 && recentRequests[0] < now - 60000) recentRequests.shift();
    if (recentRequests.length < 28) break;
    await sleep(recentRequests[0] + 60000 - now + 50); // wait until the oldest request is a minute old
  }
  const now = Date.now();
  const myTurn = Math.max(now, nextRequestAllowed);
  nextRequestAllowed = myTurn + 350;
  await sleep(myTurn - now);
  recentRequests.push(Date.now());
}

// Returns the list of records. OpenF1 answers 404 when a query finds no
// records, so 404 -> [] ("no data"). Everything else that goes wrong
// (no network, server errors, still rate-limited after all attempts)
// throws, so the caller can tell "empty" from "failed".
async function getData(endpoint, params) {
  const url = API + endpoint + "?" + params;
  let problem = "unknown error";
  let networkErrors = 0;

  for (let attempt = 1; attempt <= 6; attempt++) {
    await waitForTurn();

    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      if (response.status === 404) return []; // no records for this query
      if (response.status === 429) { // too many requests -> wait and try again
        problem = "too many requests (429)";
        await sleep(12000);
        continue;
      }
      problem = "server error " + response.status;
      if (response.status >= 400 && response.status < 500) break; // bad request: trying again won't help
      await sleep(2000);
    } catch (error) {
      problem = "network error – no connection to OpenF1";
      console.warn("Network error:", error);
      if (++networkErrors >= 3) break; // offline: give up quickly instead of waiting a minute
      await sleep(1000 * attempt);
    }
  }
  const failure = new Error("OpenF1 " + endpoint + ": " + problem);
  failure.network = true; // the request failed (not "no data"): trying other sessions won't help
  throw failure;
}
