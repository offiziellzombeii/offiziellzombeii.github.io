// =====================================================================
//  pack-builder.js  (tools/pack-builder.html)
//  Builds a data pack for the championship mode from open data:
//  1. Season: calendar, results and qualifying of one year from the
//     Jolpica F1 API (Ergast successor) -> circuits (meetings), teams, drivers
//     with the same statistics as the built-in pack
//  2. Layouts: circuits that no pack has yet get their shape from the
//     GeoJSON collection bacinger/f1-circuits (MIT): longitude / latitude
//     -> metres, direction and start line can be checked and corrected
//  3. Export: a JSON pack (import in Race Control) or – on the local
//     development server – the files of a built-in pack
//  Plain JavaScript, no libraries. Uses util.js, tracks.js, data-registry.js.
// =====================================================================

const $ = id => document.getElementById(id);
const JOLPICA = "https://api.jolpi.ca/ergast/f1/";
const GEOJSON_URL = "https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson";

// ---------- Reference tables ----------
// Jolpica circuit id -> key of the circuit in the built-in pack (OpenF1 circuit key)
const CORE_CIRCUITS = {
  silverstone: 2, hungaroring: 4, imola: 6, spa: 7, americas: 9, albert_park: 10, sepang: 12, interlagos: 14,
  catalunya: 15, red_bull_ring: 19, monaco: 22, villeneuve: 23, monza: 39, suzuka: 46, shanghai: 49, zandvoort: 55,
  marina_bay: 61, bahrain: 63, rodriguez: 65, yas_marina: 70, baku: 144, jeddah: 149, losail: 150, miami: 151,
  vegas: 152, madring: 153
};

// Jolpica circuit id -> feature of the GeoJSON collection
const GEO_FEATURES = {
  nurburgring: "de-1927", mugello: "it-1914", portimao: "pt-2008", istanbul: "tr-2005", sochi: "ru-2014",
  hockenheimring: "de-1932", ricard: "fr-1969", magny_cours: "fr-1960", sepang: "my-1999", buddh: "in-2011",
  yeongam: "kr-2010", valencia: "es-2008", indianapolis: "us-1909", fuji: "jp-1966", estoril: "pt-1972",
  jerez: "es-1985", adelaide: "au-1985", phoenix: "us-1989", detroit: "us-1982", kyalami: "za-1961"
};

// Direction of the race on circuits that are not in the built-in pack
const RACE_DIRECTION = {
  nurburgring: "cw", mugello: "cw", portimao: "cw", istanbul: "ccw", sochi: "cw", hockenheimring: "cw",
  ricard: "cw", magny_cours: "cw", buddh: "cw", yeongam: "ccw", valencia: "cw", indianapolis: "cw",
  fuji: "cw", estoril: "cw", jerez: "cw", kyalami: "cw"
};

// What the cars need on these circuits (0 ... 1, like CIRCUIT_CHARACTER) – an estimate
const CHARACTER_DEFAULTS = {
  nurburgring: { short: "Nürburgring", power: 0.6, downforce: 0.6, tyres: 0.5, overtaking: 0.5, street: 0, rain: 0.45, air: 11, wind: 0.4 },
  mugello: { short: "Mugello", power: 0.7, downforce: 0.8, tyres: 0.9, overtaking: 0.3, street: 0, rain: 0.15, air: 27, wind: 0.3 },
  portimao: { short: "Portimão", power: 0.6, downforce: 0.7, tyres: 0.6, overtaking: 0.4, street: 0, rain: 0.1, air: 20, wind: 0.7 },
  istanbul: { short: "Istanbul", power: 0.7, downforce: 0.7, tyres: 0.6, overtaking: 0.6, street: 0, rain: 0.25, air: 15, wind: 0.5 },
  sochi: { short: "Sochi", power: 0.75, downforce: 0.5, tyres: 0.3, overtaking: 0.5, street: 0.5, rain: 0.2, air: 22, wind: 0.3 },
  hockenheimring: { short: "Hockenheim", power: 0.75, downforce: 0.5, tyres: 0.5, overtaking: 0.6, street: 0, rain: 0.3, air: 24, wind: 0.3 },
  ricard: { short: "Paul Ricard", power: 0.75, downforce: 0.55, tyres: 0.6, overtaking: 0.5, street: 0, rain: 0.15, air: 27, wind: 0.6 }
};
const CHARACTER_FIELDS = ["power", "downforce", "tyres", "overtaking", "street", "rain", "air", "wind"];
const CHARACTER_LABELS = { power: "Power", downforce: "Downforce", tyres: "Tyre stress", overtaking: "Overtaking", street: "Street circuit",
  rain: "Rain chance", air: "Air temperature °C", wind: "Wind" };

// Jolpica constructor id -> franchise id of the built-in pack, colour, engine by year
const CONSTRUCTORS = {
  mercedes:     { franchise: "mercedes",    colour: "#00D2BE", engine: "Mercedes" },
  ferrari:      { franchise: "ferrari",     colour: "#DC0000", engine: "Ferrari" },
  red_bull:     { franchise: "redbull",     colour: "#1E41FF", engine: { 2019: "Honda", 2020: "Honda", 2021: "Honda", 2022: "Honda RBPT" } },
  mclaren:      { franchise: "mclaren",     colour: "#FF8700", engine: { 2018: "Renault", 2019: "Renault", 2020: "Renault", 2021: "Mercedes", 2022: "Mercedes" } },
  racing_point: { franchise: "astonmartin", colour: "#F596C8", engine: "Mercedes" },
  force_india:  { franchise: "astonmartin", colour: "#F596C8", engine: "Mercedes" },
  aston_martin: { franchise: "astonmartin", colour: "#006F62", engine: "Mercedes" },
  renault:      { franchise: "alpine",      colour: "#FFF500", engine: "Renault" },
  alpine:       { franchise: "alpine",      colour: "#0090FF", engine: "Renault" },
  alphatauri:   { franchise: "racingbulls", colour: "#2B4562", engine: "Honda" },
  toro_rosso:   { franchise: "racingbulls", colour: "#469BFF", engine: { 2018: "Honda", 2019: "Honda" } },
  alfa:         { franchise: "sauber",      colour: "#9B0000", engine: "Ferrari" },
  sauber:       { franchise: "sauber",      colour: "#9B0000", engine: "Ferrari" },
  haas:         { franchise: "haas",        colour: "#B6BABD", engine: "Ferrari" },
  williams:     { franchise: "williams",    colour: "#0082FA", engine: "Mercedes" }
};

const NATIONALITY = {
  British: "GBR", Dutch: "NED", Monegasque: "MON", Spanish: "ESP", Finnish: "FIN", Mexican: "MEX", Australian: "AUS",
  French: "FRA", Canadian: "CAN", German: "GER", Thai: "THA", Japanese: "JPN", Chinese: "CHN", Danish: "DEN",
  Italian: "ITA", American: "USA", "New Zealander": "NZL", Argentine: "ARG", Brazilian: "BRA", Russian: "RUS",
  Polish: "POL", Swedish: "SWE", Belgian: "BEL", Swiss: "SUI", Austrian: "AUT", Indian: "IND", Venezuelan: "VEN",
  Colombian: "COL", Indonesian: "INA", Hungarian: "HUN", Portuguese: "POR", Irish: "IRL", "South African": "RSA"
};

// Races on a different layout than the circuit's standard one: the race keeps its distance
const LAYOUT_EXCEPTIONS = {
  "2020/Sakhir Grand Prix": { note: "raced on the Outer circuit (87 laps of 3.5 km) – here on the Grand Prix layout, same distance (57 laps)", distanceKm: 308, laps: 57 }
};

const POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// The GeoJSON lines are coarse (a point every 40–50 m): every kink would be a slow corner.
// Calibrated against the 19 circuits that have both a layout and OpenF1 telemetry:
// smoothing over ±5 points (±30 m) and speeds x 1.075 give the same ideal lap time as
// the telemetry on average (spread ±4 %).
const GEO_SMOOTH = 5;
const GEO_SPEED = 1.075;
// Better: the real pole time of the season. On the 19 telemetry circuits the ideal lap
// is 1.04 x the real pole time of that year (spread ±1.5 %, wet sessions excluded).
// The profile is scaled to that – unless the pole time looks wrong (wet qualifying):
// then the general calibration above is kept.
const POLE_TO_IDEAL = 1.04;
const POLE_SCALE_RANGE = [0.92, 1.12];

function lapSeconds(text) {
  if (!text) return null;
  const parts = String(text).split(":");
  const s = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Number.isFinite(s) && s > 30 ? s : null;
}

// ---------- State ----------
const B = {
  year: null,
  races: [],          // Jolpica races with Results and QualifyingResults
  circuits: [],       // pack circuits
  teams: [],
  drivers: [],
  geo: null,          // GeoJSON collection
  editing: null       // circuit key in the layout editor
};

function log(text, css) {
  const el = $("log");
  const line = document.createElement("div");
  if (css) line.className = css;
  line.textContent = new Date().toLocaleTimeString() + "  " + text;
  el.prepend(line);
}

function showToast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------- 1. Jolpica ----------
// The API allows about 4 requests per second and 500 per hour
// Answers are kept in the browser (past seasons don't change: 30 days, the current one: 1 day),
// so loading a season again costs no requests.
let jolpicaNext = 0;
const JOLPICA_CACHE = "rc.jolpica.v1.";

function jolpicaCached(path) {
  try {
    const hit = JSON.parse(localStorage.getItem(JOLPICA_CACHE + path) || "null");
    const year = Number((path.match(/^(\d{4})\//) || [])[1]);
    const maxAge = year && year < new Date().getFullYear() ? 30 * 864e5 : 864e5;
    return hit && Date.now() - hit.t < maxAge ? hit.data : null;
  } catch (error) {
    return null;
  }
}

function jolpicaStore(path, data) {
  try {
    localStorage.setItem(JOLPICA_CACHE + path, JSON.stringify({ t: Date.now(), data }));
  } catch (error) { /* storage full: just not cached */ }
}

async function jolpica(path) {
  const cached = jolpicaCached(path);
  if (cached) return cached;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = jolpicaNext - Date.now();
    jolpicaNext = Math.max(Date.now(), jolpicaNext) + 350;
    if (wait > 0) await sleep(wait);
    let res;
    try {
      res = await fetch(JOLPICA + path);
    } catch (error) {
      // no connection for a moment: try again a little later
      log("Jolpica: network error – trying again (" + attempt + " of 5) …");
      await sleep(2000 * attempt);
      continue;
    }
    if (res.ok) {
      const data = (await res.json()).MRData;
      jolpicaStore(path, data);
      return data;
    }
    if (res.status === 429) {
      const asked = Number(res.headers.get("Retry-After"));
      const seconds = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 120) : 6 * attempt;
      log("Jolpica: too many requests, waiting " + seconds + " s …");
      await sleep(seconds * 1000);
      continue;
    }
    throw new Error("Jolpica " + path + ": " + res.status);
  }
  throw new Error("Jolpica " + path + ": no answer (rate limit or network) – try again later");
}

// All races of a list endpoint (results / qualifying come in pages of 100 rows)
async function jolpicaRaces(path, rowsKey, status) {
  const byRound = {};
  let offset = 0;
  while (true) {
    const data = await jolpica(path + "?limit=100&offset=" + offset);
    for (const race of data.RaceTable.Races) {
      const r = byRound[race.round] || (byRound[race.round] = Object.assign({}, race, { [rowsKey]: [] }));
      r[rowsKey].push(...(race[rowsKey] || []));
    }
    offset += 100;
    status(path + ": " + Math.min(offset, Number(data.total)) + " / " + data.total);
    if (offset >= Number(data.total)) break;
  }
  return byRound;
}

async function loadSeason() {
  const year = Number($("year").value);
  if (!year) return;
  const status = text => { $("seasonStatus").textContent = text; };
  $("loadSeason").disabled = true;
  try {
    status("Calendar …");
    const cal = await jolpica(year + "/races.json?limit=100");
    const results = await jolpicaRaces(year + "/results.json", "Results", status);
    const quali = await jolpicaRaces(year + "/qualifying.json", "QualifyingResults", status);
    let sprints = {};
    if (year >= 2021) sprints = await jolpicaRaces(year + "/sprint.json", "SprintResults", status);
    B.year = year;
    B.races = cal.RaceTable.Races.map(r => Object.assign({}, r, {
      Results: (results[r.round] || {}).Results || [],
      QualifyingResults: (quali[r.round] || {}).QualifyingResults || [],
      sprint: !!sprints[r.round]
    })).filter(r => r.Results.length);
    if (!B.races.length) throw new Error("no results for " + year + " (season not run yet?)");
    buildSeasonData();
    status(B.races.length + " races loaded.");
    log("Season " + year + ": " + B.races.length + " races, " + B.teams.length + " teams, " + B.drivers.length + " drivers.", "ok");
    $("packId").value = "season-" + year;
    $("packName").value = "Formula 1 " + year + " (Jolpica)";
    renderSeason();
    await prepareLayouts();
  } catch (error) {
    console.error(error);
    status("Error: " + error.message);
    log("Error: " + error.message, "bad");
  }
  $("loadSeason").disabled = false;
}

// ---------- Season -> pack data ----------
function engineOf(info, year) {
  if (!info || !info.engine) return null;
  return typeof info.engine === "string" ? info.engine : info.engine[year] || null;
}

function finished(res) {
  return res.status === "Finished" || /^\+\d+ Laps?$/.test(res.status);
}

function driverIdFor(d) {
  // The three-letter code. A different person with the same code – in a loaded pack
  // (Jos and Max Verstappen: same surname, so the first name counts too) or earlier in this
  // season (two drivers without an official code, e.g. the Rosiers 1956) -> code + year (+ letter).
  const code = plainName(d.code || d.familyName).replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
  const owners = B.codeOwners || (B.codeOwners = {});
  const known = catalogueIndex.drivers.get(code);
  const samePerson = known && plainName(known.last) === plainName(d.familyName) && plainName(known.first) === plainName(d.givenName);
  let id = known && !samePerson ? code + B.year : code;
  for (let k = 0; owners[id] && owners[id] !== d.driverId; k++) id = code + B.year + String.fromCharCode(97 + k);
  owners[id] = d.driverId;
  return id;
}

// "Pérez" -> "perez" (the packs write names with or without accents)
function plainName(text) {
  return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function buildSeasonData() {
  const year = B.year;
  B.codeOwners = {}; // pack id -> Jolpica driverId (driverIdFor)
  const circuits = {};
  const teams = {};
  const drivers = {};
  const idOf = {}; // Jolpica driverId -> pack id

  for (const race of B.races) {
    // ----- the circuit and the meeting -----
    const cid = race.Circuit.circuitId;
    const coreKey = CORE_CIRCUITS[cid];
    const key = coreKey !== undefined ? coreKey : cid;
    const winner = race.Results.find(r => r.position === "1");
    let laps = winner ? Number(winner.laps) : null;
    const exception = LAYOUT_EXCEPTIONS[year + "/" + race.raceName];
    const meeting = { year, gp: race.raceName, date: race.date, laps, sprint: race.sprint ? true : null, race: null };
    const c = circuits[key] || (circuits[key] = {
      key, jolpicaId: cid, core: coreKey !== undefined, name: race.Circuit.circuitName, country: race.Circuit.Location.country,
      location: race.Circuit.Location.locality, lat: Number(race.Circuit.Location.lat), lon: Number(race.Circuit.Location.long), meetings: []
    });
    if (exception) {
      meeting.note = exception.note;
      meeting.distanceKm = exception.distanceKm;
      if (exception.laps) meeting.laps = exception.laps;
    }
    c.meetings.push(meeting);
    // the real pole time (fastest Q1 / Q2 / Q3 lap): reference for the speed profile of a new layout
    const qTimes = race.QualifyingResults.flatMap(q => [q.Q1, q.Q2, q.Q3].map(lapSeconds)).filter(Boolean);
    if (qTimes.length && !exception) {
      const pole = Math.min(...qTimes);
      if (!c.refPole || pole < c.refPole) c.refPole = pole;
    }

    // ----- teams and drivers -----
    const pos = {}; // pack driver id -> finishing position (99 = not classified)
    for (const res of race.Results) {
      const d = res.Driver;
      const id = idOf[d.driverId] || (idOf[d.driverId] = driverIdFor(d));
      const cons = CONSTRUCTORS[res.Constructor.constructorId] || { franchise: res.Constructor.constructorId, colour: "#888888" };
      const teamId = cons.franchise;
      const dr = drivers[id] || (drivers[id] = { id, first: d.givenName, last: d.familyName, country: NATIONALITY[d.nationality] || "",
        season: { number: Number(res.number || d.permanentNumber), teams: {}, races: 0, dnf: 0, points: 0, finish: [], quali: [], h2hQ: [0, 0], h2hR: [0, 0] } });
      const se = dr.season;
      se.number = Number(res.number || d.permanentNumber) || se.number;
      se.teams[teamId] = (se.teams[teamId] || 0) + 1;
      se.races++;
      const ok = finished(res) && res.positionText !== "D";
      if (!ok) se.dnf++;
      else {
        const p = Number(res.position);
        se.finish.push(p);
        if (p <= 10) se.points += POINTS_TABLE[p - 1];
      }
      pos[id] = ok ? Number(res.position) : 99;

      const t = teams[teamId] || (teams[teamId] = { id: teamId, name: res.Constructor.name, colour: cons.colour,
        engine: engineOf(cons, year), drivers: {}, finish: [] });
      t.name = res.Constructor.name;
      t.drivers[id] = (t.drivers[id] || 0) + 1;
      if (ok) t.finish.push(Number(res.position));
      res._id = id;
      res._team = teamId;
    }
    headToHead(race.Results.map(r => ({ id: r._id, team: r._team, pos: pos[r._id] })), drivers, "h2hR");

    // qualifying
    const qpos = [];
    for (const q of race.QualifyingResults) {
      const id = idOf[q.Driver.driverId] || (idOf[q.Driver.driverId] = driverIdFor(q.Driver));
      const cons = CONSTRUCTORS[q.Constructor.constructorId] || { franchise: q.Constructor.constructorId };
      if (drivers[id]) drivers[id].season.quali.push(Number(q.position));
      qpos.push({ id, team: cons.franchise, pos: Number(q.position) });
    }
    headToHead(qpos, drivers, "h2hQ");
  }

  const avg = l => l.length ? Math.round(l.reduce((x, y) => x + y, 0) / l.length * 10) / 10 : null;
  B.drivers = Object.values(drivers).map(d => {
    const s = d.season;
    const team = Object.keys(s.teams).sort((a, b) => s.teams[b] - s.teams[a])[0];
    const known = catalogueIndex.drivers.get(d.id);
    return {
      id: d.id, code: d.id.replace(/\d{4}[a-z]?$/, ""), first: d.first, last: d.last, country: d.country || (known && known.country) || "",
      seasons: { [year]: { number: s.number, races: s.races, dnf: s.dnf, points: s.points, h2hQ: s.h2hQ, h2hR: s.h2hR, team,
        avgFinish: avg(s.finish), avgQuali: avg(s.quali) } }
    };
  });
  B.teams = Object.values(teams).map(t => ({
    id: t.id,
    years: { [year]: Object.assign({ name: t.name, colour: t.colour,
      drivers: Object.keys(t.drivers).sort((a, b) => t.drivers[b] - t.drivers[a]), avgFinish: avg(t.finish) }, t.engine ? { engine: t.engine } : {}) }
  }));
  B.circuits = Object.values(circuits);
  for (const c of B.circuits) {
    if (c.core) continue;
    c.character = Object.assign({ short: c.location, power: 0.5, downforce: 0.6, tyres: 0.6, overtaking: 0.5, street: 0, rain: 0.2, air: 22, wind: 0.4 },
      CHARACTER_DEFAULTS[c.jolpicaId] || {});
    c.layoutOptions = { feature: GEO_FEATURES[c.jolpicaId] || null, direction: RACE_DIRECTION[c.jolpicaId] || "file", startOffset: 0, pitLaneLength: 380 };
  }
}

// Head to head against the team mate (two cars of a team, not both out)
function headToHead(list, drivers, field) {
  const byTeam = {};
  for (const x of list) (byTeam[x.team] = byTeam[x.team] || []).push(x);
  for (const pair of Object.values(byTeam)) {
    if (pair.length !== 2 || (pair[0].pos === 99 && pair[1].pos === 99)) continue;
    const a = drivers[pair[0].id];
    const b = drivers[pair[1].id];
    if (!a || !b) continue;
    (pair[0].pos < pair[1].pos ? a : b).season[field][0]++;
    a.season[field][1]++;
    b.season[field][1]++;
  }
}

// the text a row can be found by (search field)
function searchText(...parts) {
  return escapeHtml(parts.filter(x => x !== undefined && x !== null).join(" ").toLowerCase());
}

function renderSeason() {
  const rows = B.circuits.flatMap(c => c.meetings.map(m => ({ date: m.date, html: `<tr data-s="${searchText(m.gp, c.name, c.location, c.country, m.date, c.core ? "built-in" : "new circuit")}"><td class="mono small">${m.date}</td><td><b>${escapeHtml(m.gp)}</b>${m.note ? `<br><span class="small mark-warn">${escapeHtml(m.note)}</span>` : ""}</td>
    <td class="small">${escapeHtml(c.name)}</td><td class="small">${m.laps || "–"} laps</td>
    <td>${c.core ? `<span class="state ok">in the built-in pack</span>` : `<span class="state edit">new circuit</span>`}</td></tr>` })))
    .sort((a, b) => a.date.localeCompare(b.date)).map(x => x.html);
  const teams = B.teams.map(t => {
    const y = t.years[B.year];
    return `<tr data-s="${searchText(y.name, t.id, y.engine, y.drivers.join(" "))}"><td><span class="team-bar" style="background:${y.colour}"></span><b>${escapeHtml(y.name)}</b></td><td class="small muted">${t.id}</td>
      <td class="small">${y.engine || "–"}</td><td class="small">${y.drivers.join(", ")}</td><td class="small">avg ${y.avgFinish}</td></tr>`;
  }).join("");
  const drivers = B.drivers.slice().sort((a, b) => (a.seasons[B.year].avgFinish || 99) - (b.seasons[B.year].avgFinish || 99)).map(d => {
    const s = d.seasons[B.year];
    return `<tr data-s="${searchText(d.id, d.first, d.last, d.nationality, s.team, "#" + s.number, catalogueIndex.drivers.get(d.id) ? "" : "new")}"><td class="mono">${d.id}</td><td>${escapeHtml(d.first + " " + d.last)}${catalogueIndex.drivers.get(d.id) ? "" : ` <span class="state edit">new</span>`}</td>
      <td class="small">${s.team}</td><td class="small">#${s.number}</td><td class="small">${s.races} races · ${s.dnf} DNF</td>
      <td class="small">finish ${s.avgFinish ?? "–"} · quali ${s.avgQuali ?? "–"}</td><td class="small">H2H Q ${s.h2hQ[0]}/${s.h2hQ[1]} · R ${s.h2hR[0]}/${s.h2hR[1]}</td></tr>`;
  }).join("");
  const f = B.filter || { q: "", kind: "ALL" };
  $("seasonResult").innerHTML = `
    <div class="builder-search">
      <input id="seasonSearch" type="search" placeholder="Search circuits, Grands Prix, teams, drivers, engines, numbers …" value="${escapeHtml(f.q)}" autocomplete="off">
      <select id="seasonFilter">${[["ALL", "Everything"], ["CAL", "Calendar & circuits"], ["TEAMS", "Teams"], ["DRIVERS", "Drivers"]].map(([v, t]) => `<option value="${v}" ${f.kind === v ? "selected" : ""}>${t}</option>`).join("")}</select>
      <span id="seasonHits" class="muted small"></span>
    </div>
    <div class="season-grid two">
      <div data-kind="CAL"><h3>Calendar <span class="muted small" data-count></span></h3><div class="builder-scroll"><table class="season-table"><tbody>${rows.join("")}</tbody></table></div></div>
      <div data-kind="TEAMS"><h3>Teams <span class="muted small" data-count></span></h3><table class="season-table"><tbody>${teams}</tbody></table></div>
    </div>
    <div data-kind="DRIVERS"><h3>Drivers <span class="muted small" data-count></span></h3><div class="builder-scroll"><table class="season-table"><tbody>${drivers}</tbody></table></div></div>`;
  $("seasonSearch").addEventListener("input", applySeasonFilter);
  $("seasonFilter").addEventListener("change", applySeasonFilter);
  applySeasonFilter();
}

// Search field and kind filter: rows that don't match are hidden (also the circuits of step 2)
function applySeasonFilter() {
  const input = $("seasonSearch");
  if (!input) return;
  const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const kind = $("seasonFilter").value;
  B.filter = { q: input.value, kind };
  const match = text => words.every(w => text.includes(w));
  let hits = 0;
  for (const block of $("seasonResult").querySelectorAll("[data-kind]")) {
    const shownKind = kind === "ALL" || block.dataset.kind === kind;
    block.hidden = !shownKind;
    let n = 0;
    for (const row of block.querySelectorAll("tr[data-s]")) {
      const ok = shownKind && match(row.dataset.s);
      row.hidden = !ok;
      if (ok) n++;
    }
    const count = block.querySelector("[data-count]");
    if (count) count.textContent = words.length ? "(" + n + ")" : "";
    if (shownKind) hits += n;
  }
  $("seasonHits").textContent = words.length ? hits + " found" : "";
  // step 2: the new circuits
  for (const b of document.querySelectorAll("#circuitList button[data-edit]")) b.hidden = words.length > 0 && !match(b.textContent.toLowerCase());
}

// ---------- 2. Layouts from GeoJSON ----------
async function loadGeo() {
  if (B.geo) return B.geo;
  log("Loading the circuit layouts (bacinger/f1-circuits) …");
  const res = await fetch(GEOJSON_URL);
  if (!res.ok) throw new Error("GeoJSON: " + res.status);
  B.geo = await res.json();
  log(B.geo.features.length + " circuit layouts loaded.", "ok");
  return B.geo;
}

// A layout: from the f1-circuits collection or one found in OpenStreetMap for this circuit
function geoFeature(id, c) {
  if (!id) return null;
  if (c && c.fileFeature && c.fileFeature.properties.id === id) return c.fileFeature;
  if (c && c.osmCandidates) {
    const osm = c.osmCandidates.find(f => f.properties.id === id);
    if (osm) return osm;
  }
  return B.geo && B.geo.features.find(f => f.properties.id === id) || null;
}

// The layout of the collection for a circuit: from the table, else only a feature at
// exactly the same place. (No guessing by words: "Circuit" or "International" are in
// almost every name – that made Valencia, Korea or India show Albert Park.)
function collectionFeature(c) {
  if (c.layoutOptions.feature && geoFeature(c.layoutOptions.feature)) return c.layoutOptions.feature;
  if (!B.geo) return null; // the collection could not be loaded
  const place = plainName(c.location);
  const f = B.geo.features.find(x => plainName(x.properties.Location) === place);
  return f ? f.properties.id : null;
}

async function prepareLayouts() {
  const fresh = B.circuits.filter(c => !c.core);
  if (!fresh.length) {
    $("circuitList").innerHTML = `<p class="muted small">All circuits of ${B.year} are already in the built-in pack.</p>`;
    $("layoutEditor").innerHTML = "";
    return;
  }
  setBusy(true);
  for (const c of fresh) c.loadState = "waiting";
  $("layoutEditor").innerHTML = "";
  renderCircuitList();
  try {
    showProgress("Loading the circuit layouts …", 0, "f1-circuits collection");
    await loadGeo();
    let i = 0;
    for (const c of fresh) {
      i++;
      const name = c.character.short || c.location;
      c.loadState = "loading";
      renderCircuitList();
      showProgress("Track layouts " + i + " / " + fresh.length + " · " + name, (i - 1) / fresh.length, "f1-circuits collection");
      c.layoutOptions.feature = collectionFeature(c);
      if (!c.layoutOptions.feature) {
        // not in the collection: look for the track in OpenStreetMap
        await findOsmLayouts(c, sub => showProgress("Track layouts " + i + " / " + fresh.length + " · " + name, (i - 1) / fresh.length, sub));
      }
      rebuildLayout(c);
      c.loadState = null;
      renderCircuitList();
    }
  } finally {
    for (const c of fresh) c.loadState = null;
    setBusy(false);
  }
  const missing = fresh.filter(c => !c.layout).length;
  $("seasonStatus").textContent = B.races.length + " races loaded · " + (fresh.length - missing) + " / " + fresh.length + " new circuit layouts found" +
    (missing ? " – the circuits without a layout are left out of the pack (or load a layout file in step 2)." : ".");
  B.editing = fresh[0].key;
  renderLayouts();
}

// ---------- Progress while layouts load (OpenStreetMap can take a while) ----------
let layoutsBusy = false;
function setBusy(on) {
  layoutsBusy = on;
  for (const id of ["loadSeason", "downloadJson", "saveProject"]) if ($(id)) $(id).disabled = on;
  $("layoutProgress").hidden = !on;
  if (!on) $("seasonBusy").hidden = true;
}

function showProgress(text, share, sub) {
  $("layoutProgressText").textContent = text;
  $("layoutProgressBar").style.width = Math.round(clamp(share, 0, 1) * 100) + "%";
  $("layoutProgressSub").textContent = sub || "";
  // also next to the season (step 1), so it is seen without scrolling
  $("seasonBusy").hidden = false;
  $("seasonBusyText").textContent = text + (sub ? " · " + sub : "");
}

// ---------- Layouts from OpenStreetMap ----------
// Race tracks are mapped as "highway=raceway" ways. The ways around the circuit are
// joined into closed loops; the loop closest to the expected length (race distance /
// laps) is the Grand Prix layout. Data © OpenStreetMap contributors (ODbL).
const OSM_API = "https://api.openstreetmap.org/api/0.6/map.json?bbox=";

// All map data around a point. Areas with too much data (a city) are split into four.
// OpenStreetMap allows only a few requests per minute: at least 1 s between two,
// and when it answers 429 ("too many requests") we wait as long as it asks and try again.
let osmNextRequest = 0;
const osmCache = {}; // "lat,lon" -> elements (this page load)

async function osmFetch(url, report) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = osmNextRequest - Date.now();
    if (wait > 0) await sleep(wait);
    osmNextRequest = Date.now() + 1000;
    let res;
    try {
      res = await fetch(url);
    } catch (error) {
      // no connection for a moment: try again a little later
      log("OpenStreetMap: network error – trying again (" + attempt + " of 5) …");
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status !== 429 && res.status !== 509) return res;
    const asked = Number(res.headers.get("Retry-After"));
    let seconds = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 120) : 10 * attempt;
    log("OpenStreetMap: too many requests – waiting " + seconds + " s (attempt " + attempt + ")");
    while (seconds > 0) {
      if (report) report("OpenStreetMap asks us to slow down – trying again in " + seconds + " s …");
      await sleep(1000);
      seconds--;
    }
  }
  const busy = new Error("OpenStreetMap is busy (too many requests) – try again later with \"Search OpenStreetMap\".");
  busy.busy = true;
  throw busy;
}

// radius in degrees of latitude around the point (0.008 ≈ 900 m). The map API returns
// every way with at least one point in the area complete – so a small area is enough
// to get the whole race track, and a city needs far fewer requests.
async function osmArea(lat, lon, report, radius) {
  radius = radius || 0.008;
  const cacheKey = lat.toFixed(4) + "," + lon.toFixed(4) + "," + radius;
  if (osmCache[cacheKey]) return osmCache[cacheKey];
  const elements = new Map();
  let requests = 0;
  async function load(w, s, e, n, depth) {
    requests++;
    if (report) report("OpenStreetMap: loading the map around the circuit – request " + requests + (depth ? " (a city: the area is loaded in parts)" : "") + " …");
    const res = await osmFetch(OSM_API + [w, s, e, n].map(x => x.toFixed(5)).join(","), report);
    if (res.status === 400 && depth < 3) {
      const mx = (w + e) / 2;
      const my = (s + n) / 2;
      for (const [a, b, c, d] of [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]]) await load(a, b, c, d, depth + 1);
      return;
    }
    if (!res.ok) throw new Error("OpenStreetMap: " + res.status);
    const data = await res.json();
    for (const el of data.elements) elements.set(el.type + el.id, el);
  }
  const dLat = radius;
  const dLon = radius / Math.cos(lat * Math.PI / 180);
  await load(lon - dLon, lat - dLat, lon + dLon, lat + dLat, 0);
  log("OpenStreetMap: " + elements.size + " map elements (" + requests + " request" + (requests > 1 ? "s" : "") + ")");
  osmCache[cacheKey] = [...elements.values()];
  return osmCache[cacheKey];
}

// Distance in metres between two [lon, lat] points (short distances)
function metres(a, b) {
  const kx = 111320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540);
}

// Expected track length: a Grand Prix is ~305 km (since 1989), so 305 km / laps
function expectedLength(c) {
  if (B.year < 1989) return null;
  const laps = Math.max(...c.meetings.map(m => m.laps || 0));
  return laps ? 305000 / laps : null;
}

// The closed loops of the race track ways: candidates for the layout
function osmLoops(elements, expected) {
  const nodes = new Map();
  for (const el of elements) if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
  const text = w => [w.tags.name, w.tags.raceway, w.tags.service, w.tags.sport, w.tags.description].filter(Boolean).join(" ").toLowerCase();
  const ways = elements.filter(e => e.type === "way" && e.tags && e.tags.highway === "raceway" && e.tags.area !== "yes" &&
    e.nodes.length >= 2 && e.nodes.every(n => nodes.has(n)) && !/kart|go-kart|drag|oval|rally|motocross|cart track/.test(text(e)));
  const isPit = w => /pit|boxen|garage/.test(text(w));
  const track = ways.filter(w => !isPit(w));
  const pits = ways.filter(isPit);

  // junctions: ends of ways and nodes used by more than one way
  const uses = new Map();
  for (const w of track) for (const n of new Set(w.nodes)) uses.set(n, (uses.get(n) || 0) + 1);

  // Small gaps in the map: a way that ends 20 m from where it should join (or a whole
  // lap drawn as one open line). Open ends are joined to the nearest track point within 40 m.
  const gaps = [];
  const wayOf = new Map();
  for (const w of track) for (const n of w.nodes) if (!wayOf.has(n)) wayOf.set(n, w);
  for (const w of track) {
    const first = w.nodes[0];
    const last = w.nodes[w.nodes.length - 1];
    if (first === last) continue; // closed
    for (const end of [first, last]) {
      if (uses.get(end) > 1) continue; // already joined
      const other = end === first ? last : first;
      let best = null;
      let bestD = 40;
      for (const v of track) {
        const own = v === w;
        for (const n of own ? [other] : v.nodes) {
          if (n === end) continue;
          const d = metres(nodes.get(end), nodes.get(n));
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
      if (best !== null) {
        gaps.push({ a: end, b: best, length: bestD });
        uses.set(best, (uses.get(best) || 0) + 1); // the target becomes a junction
        uses.set(end, (uses.get(end) || 0) + 1);
      }
    }
  }
  const junction = n => uses.get(n) > 1;
  // the ways cut into pieces between junctions. dir: 0 = both ways, 1 = only from -> to, -1 = only to -> from
  let edges = [];
  for (const w of track) {
    let part = [w.nodes[0]];
    for (let i = 1; i < w.nodes.length; i++) {
      part.push(w.nodes[i]);
      if (i === w.nodes.length - 1 || junction(w.nodes[i])) {
        let length = 0;
        for (let k = 1; k < part.length; k++) length += metres(nodes.get(part[k - 1]), nodes.get(part[k]));
        edges.push({ from: part[0], to: part[part.length - 1], nodes: part, length, dir: w.tags.oneway === "yes" ? 1 : 0, names: new Set(w.tags.name ? [w.tags.name] : []) });
        part = [w.nodes[i]];
      }
    }
  }
  for (const g of gaps) edges.push({ from: g.a, to: g.b, nodes: [g.a, g.b], length: g.length, dir: 0, names: new Set(), gap: true });
  edges = simplifyTrackGraph(edges);
  edges.forEach((e, i) => { e.id = i; });
  const out = new Map();
  for (const e of edges) {
    if (e.dir >= 0) (out.get(e.from) || out.set(e.from, []).get(e.from)).push({ edge: e, forward: true, to: e.to });
    if (e.dir <= 0) (out.get(e.to) || out.set(e.to, []).get(e.to)).push({ edge: e, forward: false, to: e.from });
  }

  // simple cycles (depth-first search, limited by length)
  const maxLength = expected ? expected * 1.35 : 9000;
  const cycles = [];
  let steps = 0;
  for (const start of out.keys()) {
    const path = [];
    const visited = new Set([start]);
    const usedEdges = new Set();
    const walk = (at, length) => {
      if (++steps > 300000 || cycles.length > 400) return;
      for (const step of out.get(at) || []) {
        if (usedEdges.has(step.edge.id)) continue;
        const total = length + step.edge.length;
        if (total > maxLength) continue;
        if (step.to === start) {
          if (total > 1500) cycles.push({ steps: path.concat([step]), length: total });
          continue;
        }
        if (visited.has(step.to)) continue;
        visited.add(step.to);
        usedEdges.add(step.edge.id);
        path.push(step);
        walk(step.to, total);
        path.pop();
        usedEdges.delete(step.edge.id);
        visited.delete(step.to);
      }
    };
    walk(start, 0);
  }

  // one candidate per set of track pieces (the same loop is found from every junction)
  const unique = new Map();
  for (const cy of cycles) {
    const key = cy.steps.map(s => s.edge.id).sort((a, b) => a - b).join(",");
    const prev = unique.get(key);
    const directed = cy.steps.every(s => (s.forward && s.edge.dir === 1) || (!s.forward && s.edge.dir === -1));
    if (!prev || (directed && !prev.directed)) unique.set(key, Object.assign(cy, { directed }));
  }

  // the middle of the main pit lane: the start / finish line is next to it
  let pitPoint = null;
  if (pits.length) {
    const main = pits.map(w => ({ w, len: w.nodes.reduce((a, n, i) => i ? a + metres(nodes.get(w.nodes[i - 1]), nodes.get(n)) : 0, 0) }))
      .sort((a, b) => b.len - a.len)[0].w;
    pitPoint = nodes.get(main.nodes[Math.floor(main.nodes.length / 2)]);
  }

  const candidates = [...unique.values()].map((cy, i) => {
    const coords = [];
    for (const s of cy.steps) {
      const list = s.forward ? s.edge.nodes : s.edge.nodes.slice().reverse();
      for (let k = coords.length ? 1 : 0; k < list.length; k++) coords.push(nodes.get(list[k]));
    }
    if (coords.length > 1 && metres(coords[0], coords[coords.length - 1]) < 1) coords.pop();
    // start next to the pit lane
    let startIndex = 0;
    if (pitPoint) {
      let best = Infinity;
      coords.forEach((p, k) => {
        const d = metres(p, pitPoint);
        if (d < best) {
          best = d;
          startIndex = k;
        }
      });
    }
    const names = [...new Set(cy.steps.flatMap(s => [...s.edge.names]))];
    return {
      properties: { id: "osm-" + i, Name: "OpenStreetMap: " + (names.join(" + ") || "race track") + " (" + (cy.length / 1000).toFixed(2) + " km)",
        Location: "", length: Math.round(cy.length) },
      geometry: { type: "LineString", coordinates: coords.slice(startIndex).concat(coords.slice(0, startIndex)) },
      osm: { directed: cy.directed, startFromPits: !!pitPoint, length: cy.length }
    };
  });
  // closest to the expected length; a lap that is one-way all round (mapped in the race
  // direction on purpose) gets a small bonus: 2 % of the length
  const score = f => (expected ? Math.abs(f.osm.length - expected) - (f.osm.directed ? 0.02 * expected : 0) : -f.osm.length);
  // overlapping ways give the same lap several times: keep one per length (20 m steps)
  const seen = new Set();
  const distinct = candidates.sort((a, b) => score(a) - score(b) || (b.osm.directed ? 1 : 0) - (a.osm.directed ? 1 : 0)).filter(f => {
    const key = Math.round(f.osm.length / 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return distinct.slice(0, 8).map((f, i) => {
    f.properties.id = "osm-" + i;
    return f;
  });
}

// ---------- A layout from a file (GeoJSON, GPX, KML) ----------
// For circuits that neither collection has (e.g. street circuits that are normal
// roads today): draw the lap on geojson.io or export a GPS track, then load the file.
function parseLayoutFile(name, text) {
  let lines = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed);
    const collect = g => {
      if (!g) return;
      if (g.type === "FeatureCollection") g.features.forEach(f => collect(f.geometry));
      else if (g.type === "Feature") collect(g.geometry);
      else if (g.type === "GeometryCollection") g.geometries.forEach(collect);
      else if (g.type === "LineString") lines.push(g.coordinates);
      else if (g.type === "MultiLineString" || g.type === "Polygon") g.coordinates.forEach(c => lines.push(c));
      else if (g.type === "MultiPolygon") g.coordinates.forEach(p => p.forEach(c => lines.push(c)));
    };
    collect(data);
  } else {
    const xml = new DOMParser().parseFromString(trimmed, "application/xml");
    const points = [...xml.querySelectorAll("trkpt, rtept")];
    if (points.length) lines.push(points.map(p => [Number(p.getAttribute("lon")), Number(p.getAttribute("lat"))]));
    for (const el of xml.querySelectorAll("coordinates")) {
      lines.push(el.textContent.trim().split(/\s+/).map(s => s.split(",").map(Number)).filter(p => p.length >= 2 && p.every(Number.isFinite)));
    }
  }
  const length = l => l.reduce((a, p, i) => (i ? a + metres(l[i - 1], p) : 0), 0);
  lines = lines.filter(l => l.length >= 10).sort((a, b) => length(b) - length(a));
  if (!lines.length) throw new Error("no line with at least 10 points in the file");
  const coords = lines[0].map(p => [p[0], p[1]]);
  const total = length(coords) + metres(coords[coords.length - 1], coords[0]);
  if (total < 1500 || total > 25000) throw new Error("the line is " + Math.round(total) + " m long – not a race track lap");
  return {
    properties: { id: "file-" + Date.now(), Name: "File: " + name + " (" + (total / 1000).toFixed(2) + " km)", Location: "", length: Math.round(total) },
    geometry: { type: "LineString", coordinates: coords },
    file: true
  };
}

// Make the network of track pieces small, so the search for laps is quick:
// 1. a stretch mapped twice (two ways on the same points) is kept once
// 2. a chain of pieces without a real fork becomes one piece
// One-way directions are kept: a merged piece is one-way if one of its parts is.
function simplifyTrackGraph(edges) {
  const flip = e => Object.assign({}, e, { from: e.to, to: e.from, nodes: e.nodes.slice().reverse(), dir: -e.dir });
  for (let round = 0; round < 50; round++) {
    let changed = false;
    // 1. parallel pieces between the same two junctions with (almost) the same length
    const byPair = new Map();
    const kept = [];
    for (const e of edges) {
      if (e.from === e.to) {
        kept.push(e);
        continue;
      }
      const key = e.from < e.to ? e.from + "-" + e.to : e.to + "-" + e.from;
      const list = byPair.get(key) || [];
      const twin = list.find(x => Math.abs(x.length - e.length) < Math.max(10, 0.03 * e.length));
      if (twin) {
        if (!twin.dir && e.dir) twin.dir = twin.from === e.from ? e.dir : -e.dir;
        for (const n of e.names) twin.names.add(n);
        changed = true;
        continue;
      }
      list.push(e);
      byPair.set(key, list);
      kept.push(e);
    }
    edges = kept;
    // 2. join two pieces that meet at a point without a fork
    const touching = new Map();
    for (const e of edges) {
      (touching.get(e.from) || touching.set(e.from, []).get(e.from)).push(e);
      (touching.get(e.to) || touching.set(e.to, []).get(e.to)).push(e);
    }
    const gone = new Set();
    const added = [];
    for (const [v, list] of touching) {
      if (list.length !== 2 || list[0] === list[1] || gone.has(list[0]) || gone.has(list[1])) continue;
      const a = list[0].to === v ? list[0] : flip(list[0]);
      const b = list[1].from === v ? list[1] : flip(list[1]);
      const forward = a.dir >= 0 && b.dir >= 0;
      const backward = a.dir <= 0 && b.dir <= 0;
      if (!forward && !backward) continue; // the one-way directions don't fit together
      gone.add(list[0]);
      gone.add(list[1]);
      added.push({ from: a.from, to: b.to, nodes: a.nodes.concat(b.nodes.slice(1)), length: a.length + b.length,
        dir: forward && backward ? 0 : forward ? 1 : -1, names: new Set([...a.names, ...b.names]), gap: a.gap || b.gap });
    }
    if (added.length) {
      edges = edges.filter(e => !gone.has(e)).concat(added);
      changed = true;
    }
    if (!changed) break;
  }
  return edges;
}

// The result of a search is kept in this browser for 30 days – also "no race track here" –
// so the same circuit is not searched again and again (OpenStreetMap allows only a few
// requests). "Search OpenStreetMap" (force) asks again.
const OSM_STORE_PREFIX = "rc.osm.v1.";
const OSM_STORE_DAYS = 30;

function osmStoreKey(c) {
  return OSM_STORE_PREFIX + c.lat.toFixed(4) + "," + c.lon.toFixed(4);
}

function osmStored(c) {
  try {
    const data = JSON.parse(localStorage.getItem(osmStoreKey(c)) || "null");
    if (!data || Date.now() - data.saved > OSM_STORE_DAYS * 864e5) return null;
    return data;
  } catch (error) {
    return null;
  }
}

function osmStore(c, candidates) {
  // only the best loops, coordinates to ~10 cm
  const slim = candidates.slice(0, 4).map(f => ({
    properties: f.properties,
    geometry: { type: "LineString", coordinates: f.geometry.coordinates.map(p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]) },
    osm: f.osm
  }));
  try {
    localStorage.setItem(osmStoreKey(c), JSON.stringify({ saved: Date.now(), candidates: slim }));
  } catch (error) {
    // storage full: then it is searched again next time
  }
}

async function findOsmLayouts(c, report, force) {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
  c.osmError = null;
  const expected = expectedLength(c);
  const stored = force ? null : osmStored(c);
  if (stored) {
    c.osmCandidates = stored.candidates;
    const when = new Date(stored.saved).toLocaleDateString();
    if (!c.osmCandidates.length) {
      log(c.location + ": no race track in OpenStreetMap (searched " + when + ") – load a layout file, or \"Search OpenStreetMap\" to try again.", "bad");
      return;
    }
    log(c.location + ": layout from an earlier OpenStreetMap search (" + when + ").");
  } else {
    try {
      // a small area first; only if there is no lap in it, a larger one
      let elements = await osmArea(c.lat, c.lon, report, 0.008);
      if (report) report("OpenStreetMap: looking for the lap in " + elements.length + " map elements …");
      await sleep(0); // let the page show the message
      c.osmCandidates = osmLoops(elements, expected);
      if (!c.osmCandidates.length) {
        elements = await osmArea(c.lat, c.lon, report, 0.02);
        if (report) report("OpenStreetMap: looking for the lap in " + elements.length + " map elements …");
        await sleep(0);
        c.osmCandidates = osmLoops(elements, expected);
      }
      osmStore(c, c.osmCandidates);
    } catch (error) {
      // busy / no network: not "no race track" – nothing is stored, the player can try again
      c.osmError = error.message;
      log(c.location + ": " + error.message, "bad");
      return;
    }
  }
  try {
    if (!c.osmCandidates.length) {
      log(c.location + ": no closed race track found in OpenStreetMap.", "bad");
      return;
    }
    const best = c.osmCandidates[0];
    c.layoutOptions.feature = best.properties.id;
    // the direction of the race: the one-way race track ways in OpenStreetMap (mapped by
    // people who know the circuit) – else the table / as chosen
    if (best.osm.directed) c.layoutOptions.direction = "file";
    log(c.location + ": " + c.osmCandidates.length + " loop(s) in OpenStreetMap, chosen " + best.properties.Name +
      (expected ? " – expected ~" + (expected / 1000).toFixed(2) + " km" : "") + (best.osm.directed ? ", direction from the one-way tags" : ""), "ok");
  } catch (error) {
    // busy / no network: not "no race track" – the player can try again
    c.osmError = error.message;
    log(c.location + ": " + error.message, "bad");
  }
}

// Longitude / latitude -> metres around the middle of the circuit (y = north)
function project(coords) {
  let lat0 = 0;
  let lon0 = 0;
  for (const [lon, lat] of coords) {
    lat0 += lat;
    lon0 += lon;
  }
  lat0 /= coords.length;
  lon0 /= coords.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  const ky = 110540;
  return coords.map(([lon, lat]) => ({ x: (lon - lon0) * kx, y: (lat - lat0) * ky }));
}

// > 0: anticlockwise (with y pointing north)
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function rebuildLayout(c) {
  c.layout = null;
  c.layoutError = null;
  const o = c.layoutOptions;
  const f = geoFeature(o.feature, c);
  if (!f) {
    c.layoutError = c.osmError && !c.osmCandidates
      ? "No layout yet: " + c.osmError
      : c.osmCandidates && !c.osmCandidates.length
      ? "No layout: this circuit is not in the f1-circuits collection, and OpenStreetMap has no closed race track here (street circuits are often mapped as normal roads). Load a layout file – e.g. draw the lap on geojson.io and save it as GeoJSON."
      : "No layout chosen – this circuit is not in the f1-circuits collection. Try \"Search OpenStreetMap\" or load a layout file.";
    return;
  }
  try {
    let coords = f.geometry.type === "LineString" ? f.geometry.coordinates.slice() : f.geometry.coordinates[0].slice();
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) coords.pop();
    let pts = project(coords);
    // direction of the race
    const ccw = signedArea(pts) > 0;
    const reverse = (o.direction === "cw" && ccw) || (o.direction === "ccw" && !ccw) || o.direction === "reverse";
    if (reverse) pts = [pts[0]].concat(pts.slice(1).reverse()); // same start point, other direction
    // evenly spaced points (~6 m)
    pts = resampleClosed(pts, 6).points;
    const lengthMeters = Number(f.properties.length) || resampleClosed(pts, 6).length;
    // move the start / finish line along the track
    if (o.startOffset) {
      const shift = Math.round(o.startOffset / (lengthMeters / pts.length));
      const n = pts.length;
      pts = pts.map((_, i) => pts[((i + shift) % n + n) % n]);
    }
    // smooth shape and calibrated speed profile (see GEO_SMOOTH / GEO_SPEED / POLE_TO_IDEAL)
    const base = buildTrack({ name: "base", points: pts, lengthMeters, speedSamples: null, smooth: GEO_SMOOTH, marshalSectors: 18, pitLaneLength: 400 });
    const generic = idealLap(base) / GEO_SPEED;
    let speed = GEO_SPEED;
    c.calibration = "general calibration (x" + GEO_SPEED + ")";
    // reference: a dry lap entered by hand, else the real pole of the season
    const ref = o.refLap || c.refPole;
    const refName = o.refLap ? "the reference lap " : "the real pole ";
    if (ref) {
      const scale = generic / (POLE_TO_IDEAL * ref);
      if (scale >= POLE_SCALE_RANGE[0] && scale <= POLE_SCALE_RANGE[1]) {
        speed = GEO_SPEED * scale;
        c.calibration = "calibrated to " + refName + formatLapTime(ref) + " (x" + speed.toFixed(3) + ")";
      } else {
        c.calibration = refName + formatLapTime(ref) + " looks unusual (wet?) – general calibration (x" + GEO_SPEED + "). Enter a dry reference lap.";
      }
    }
    const every = Math.max(1, Math.ceil(base.n / 700)); // ~700 points, like the OpenF1 shapes
    const points = [];
    const speedSamples = [];
    for (let i = 0; i < base.n; i += every) {
      points.push([Math.round(base.xs[i]), Math.round(base.ys[i])]);
      speedSamples.push([Math.round(i / base.n * 100000) / 100000, Math.round(base.profile[i] * speed * 10) / 10]);
    }
    const layout = {
      key: c.key, name: c.character.short || c.location,
      source: (f.osm ? "© OpenStreetMap contributors (ODbL), " + f.properties.Name.replace("OpenStreetMap: ", "")
        : f.file ? "layout file " + f.properties.Name.replace("File: ", "")
        : "bacinger/f1-circuits " + f.properties.id + " (MIT licence)") + ", direction " + (reverse ? "reversed" : "as in the data") +
        ", speed profile from physics, " + c.calibration,
      lengthMeters: Math.round(lengthMeters),
      marshalSectors: clamp(Math.round(lengthMeters / 260), 12, 30),
      pitLaneLength: Math.round(o.pitLaneLength),
      points,
      speedSamples
    };
    // check it: the program must be able to build a track from it (as season-tracks.js does)
    const track = buildTrack({ name: layout.name, points: points.map(p => ({ x: p[0], y: p[1] })), lengthMeters: layout.lengthMeters,
      speedSamples: speedSamples.map(s => ({ f: s[0], v: s[1] })), smooth: 2, marshalSectors: layout.marshalSectors, pitLaneLength: layout.pitLaneLength });
    c.layout = layout;
    c.track = track;
    c.direction = ccw !== reverse ? "anticlockwise" : "clockwise";
  } catch (error) {
    c.layoutError = error.message;
  }
}

// Ideal lap time from the speed profile (seconds)
function idealLap(track) {
  let t = 0;
  for (const v of track.profile) t += track.ds / Math.max(5, v);
  return t;
}

// The new circuits with their state: waiting / loading / ✔ / ✘
function renderCircuitList() {
  const fresh = B.circuits.filter(c => !c.core);
  $("circuitList").innerHTML = fresh.map(c => {
    const state = c.loadState === "loading" ? `<span class="builder-spinner small" title="loading"></span>`
      : c.loadState === "waiting" ? `<span class="muted small">waiting</span>`
      : `<span class="${c.layout ? "ok-mark" : "bad-mark"}" title="${c.layout ? "layout found" : "no layout – left out of the pack"}">${c.layout ? "✔" : "✘"}</span>`;
    return `
    <button data-edit="${escapeHtml(String(c.key))}" class="${B.editing === c.key && !layoutsBusy ? "active" : ""} ${c.loadState === "loading" ? "loading" : ""}" ${layoutsBusy ? "disabled" : ""}>
      <span><b>${escapeHtml(c.character.short || c.location)}</b><span class="muted small">${escapeHtml(c.meetings.map(m => m.gp).join(", "))}${c.loadState === "loading" ? " · loading …" : ""}</span></span>
      ${state}
    </button>`;
  }).join("");
  applySeasonFilter(); // the search of step 1 also filters the circuits
}

function renderLayouts() {
  const fresh = B.circuits.filter(c => !c.core);
  renderCircuitList();
  const c = fresh.find(x => x.key === B.editing);
  if (!c) return;
  const o = c.layoutOptions;
  const option = (f, label) => `<option value="${f.properties.id}" ${f.properties.id === o.feature ? "selected" : ""}>${escapeHtml(label)}</option>`;
  const options =
    (c.fileFeature ? `<optgroup label="Your file">${option(c.fileFeature, c.fileFeature.properties.Name.replace("File: ", ""))}</optgroup>` : "") +
    (c.osmCandidates && c.osmCandidates.length ? `<optgroup label="OpenStreetMap (found around the circuit)">${c.osmCandidates.map(f => option(f, f.properties.Name.replace("OpenStreetMap: ", ""))).join("")}</optgroup>` : "") +
    `<optgroup label="f1-circuits collection">${((B.geo && B.geo.features) || []).map(f => option(f, f.properties.Name + " (" + f.properties.Location + ")")).join("")}</optgroup>`;
  const sliders = CHARACTER_FIELDS.map(k => {
    const max = k === "air" ? 40 : 1;
    const step = k === "air" ? 1 : 0.05;
    return `<label>${CHARACTER_LABELS[k]} <span class="value">${c.character[k]}</span>
      <input type="range" min="0" max="${max}" step="${step}" value="${c.character[k]}" data-char="${k}"></label>`;
  }).join("");
  $("layoutEditor").innerHTML = `
    <div class="builder-fields">
      <label class="wide">Layout <select id="lyFeature"><option value="">– none –</option>${options}</select></label>
      <label>&nbsp;<button id="lyOsm" title="Look for the race track around the circuit in OpenStreetMap">Search OpenStreetMap</button></label>
      <label title="A lap of the circuit as GeoJSON, GPX or KML – e.g. drawn on geojson.io">&nbsp;<span class="file-btn">Load a layout file<input type="file" id="lyFile" accept=".geojson,.json,.gpx,.kml,application/json,application/gpx+xml"></span></label>
      <label>Direction of the race
        <select id="lyDirection">
          <option value="file" ${o.direction === "file" ? "selected" : ""}>as in the file</option>
          <option value="cw" ${o.direction === "cw" ? "selected" : ""}>clockwise</option>
          <option value="ccw" ${o.direction === "ccw" ? "selected" : ""}>anticlockwise</option>
        </select></label>
      <label>Start line (m) <input type="number" id="lyStart" value="${o.startOffset}" step="10"></label>
      <label>Pit lane (m) <input type="number" id="lyPit" value="${o.pitLaneLength}" step="10" min="250" max="650"></label>
      <label>Short name <input type="text" id="lyName" value="${escapeHtml(c.character.short || "")}"></label>
      <label title="A dry pole lap (m:ss.sss) to calibrate the speed profile – empty: the real pole of the season">Reference lap
        <input type="text" id="lyRef" value="${o.refLap ? formatLapTime(o.refLap) : ""}" placeholder="${c.refPole ? formatLapTime(c.refPole) : "e.g. 1:22.868"}"></label>
    </div>
    <canvas id="preview" class="builder-preview"></canvas>
    <p class="small">${c.layout
      ? `<span class="ok-mark">✔</span> ${c.layout.lengthMeters} m · ${c.direction} · ${c.track.corners.length} corners · ${c.layout.marshalSectors} marshal sectors · ideal lap ${formatLapTime(idealLap(c.track))} · ${c.meetings.map(m => m.laps + " laps").join(" / ")}<br><span class="muted">Speed profile: ${escapeHtml(c.calibration || "")}</span>`
      : `<span class="bad-mark">✘</span> ${escapeHtml(c.layoutError || "")}`}</p>
    <h3>Character <span class="muted small">(what the cars need here – an estimate)</span></h3>
    <div class="builder-sliders">${sliders}
      <label class="check"><input type="checkbox" data-char-night="1" ${c.character.night ? "checked" : ""}> Night race</label>
    </div>`;
  drawPreview(c);
}

function drawPreview(c) {
  const canvas = $("preview");
  if (!canvas || !c.track) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const tr = c.track;
  const minX = Math.min(...tr.xs), maxX = Math.max(...tr.xs), minY = Math.min(...tr.ys), maxY = Math.max(...tr.ys);
  const pad = 30;
  const scale = Math.min((rect.width - 2 * pad) / (maxX - minX), (rect.height - 2 * pad) / (maxY - minY));
  const ox = (rect.width - (maxX - minX) * scale) / 2;
  const oy = (rect.height - (maxY - minY) * scale) / 2;
  const P = i => [ox + (tr.xs[i] - minX) * scale, rect.height - (oy + (tr.ys[i] - minY) * scale)];
  // track coloured by speed (slow = red, fast = green)
  const vMax = tr.vMax;
  ctx.lineCap = "round";
  for (let i = 0; i < tr.n; i++) {
    const [x1, y1] = P(i);
    const [x2, y2] = P((i + 1) % tr.n);
    const f = clamp(tr.profile[i] / vMax, 0, 1);
    ctx.strokeStyle = `hsl(${Math.round(f * 120)}, 70%, 50%)`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  // start / finish line and the direction
  const [sx, sy] = P(0);
  const [ax, ay] = P(Math.round(tr.n * 0.012));
  const dx = ax - sx;
  const dy = ay - sy;
  const len = Math.hypot(dx, dy) || 1;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx - dy / len * 12, sy + dx / len * 12);
  ctx.lineTo(sx + dy / len * 12, sy - dx / len * 12);
  ctx.stroke();
  const [bx, by] = P(Math.round(tr.n * 0.04));
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  const ux = (bx - ax) / (Math.hypot(bx - ax, by - ay) || 1);
  const uy = (by - ay) / (Math.hypot(bx - ax, by - ay) || 1);
  ctx.moveTo(bx + ux * 10, by + uy * 10);
  ctx.lineTo(bx - uy * 6, by + ux * 6);
  ctx.lineTo(bx + uy * 6, by - ux * 6);
  ctx.fill();
  // corners
  ctx.font = "600 10px Inter, Arial, sans-serif";
  ctx.fillStyle = "#cbd2df";
  for (const corner of tr.corners) {
    const [x, y] = P(Math.round(corner.apex / tr.ds) % tr.n);
    ctx.fillText("T" + corner.number, x + 6, y - 6);
  }
  ctx.fillStyle = "#8b93a7";
  ctx.fillText("START / FINISH", sx + 10, sy + 16);
}

// ---------- 3. Export ----------
// Circuits without a layout are left out (with their races) – the rest of the pack works
function missingLayouts() {
  return B.circuits.filter(c => !c.core && !c.layout);
}

function missingText() {
  const missing = missingLayouts();
  if (!missing.length) return "";
  return " Left out (no layout): " + missing.map(c => (c.character.short || c.location) + " – " + c.meetings.map(m => m.gp).join(", ")).join("; ") +
    ". Load a layout file for them in step 2 to include them.";
}

function buildPack(builtInPaths) {
  const id = $("packId").value.trim() || "season-" + B.year;
  if (!B.circuits.length) throw new Error("Load a season first.");
  const usable = B.circuits.filter(c => c.core || c.layout);
  if (!usable.length) throw new Error("No circuit of this season has a layout.");
  const circuits = usable.map(c => {
    const meetings = c.meetings.map(m => {
      const out = { year: m.year, gp: m.gp, date: m.date, laps: m.laps, sprint: m.sprint, race: null };
      if (m.distanceKm) out.distanceKm = m.distanceKm;
      if (m.note) out.note = m.note;
      return out;
    });
    if (c.core) return { key: c.key, meetings };
    const out = { key: c.key, name: c.character.short || c.name, country: c.country, location: c.location, meetings, character: c.character };
    if (builtInPaths) out.layout = "data/tracks/" + c.key + ".js";
    else out.layoutData = c.layout;
    return out;
  });
  return {
    format: PACK_FORMAT, version: PACK_VERSION, id, name: $("packName").value.trim() || id,
    source: "Jolpica F1 API (results " + B.year + "), layouts: bacinger/f1-circuits (MIT licence)" +
      (usable.some(c => c.layout && /OpenStreetMap/.test(c.layout.source)) ? ", © OpenStreetMap contributors (ODbL)" : "") +
      " – built " + new Date().toISOString().slice(0, 10),
    circuits, teams: B.teams, drivers: B.drivers
  };
}

function download(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadJson() {
  try {
    const pack = buildPack(false);
    const problems = validatePack(pack);
    if (problems.length) throw new Error(problems.join(" "));
    download(pack.id + ".json", JSON.stringify(pack));
    $("exportStatus").textContent = "Downloaded " + pack.id + ".json – import it in Race Control (Championship → Data packs)." + missingText();
    if (missingLayouts().length) log("Pack downloaded without " + missingLayouts().length + " circuit(s) that have no layout.", "bad");
  } catch (error) {
    $("exportStatus").textContent = "Error: " + error.message;
  }
}

// Only on the local development server (POST /__save): the files of a built-in pack
async function saveIntoProject() {
  try {
    const pack = buildPack(true);
    const line = x => JSON.stringify(x);
    const text = "// data/" + pack.id + ".js – built-in data pack (made with tools/pack-builder.html)\n// " + pack.source + "\nregisterPack({\n" +
      `"format": "${pack.format}", "version": ${pack.version}, "id": ${line(pack.id)}, "name": ${line(pack.name)}, "source": ${line(pack.source)},\n` +
      `"circuits": [\n${pack.circuits.map(line).join(",\n")}\n],\n"teams": [\n${pack.teams.map(line).join(",\n")}\n],\n"drivers": [\n${pack.drivers.map(line).join(",\n")}\n]\n}, { builtIn: true });\n`;
    await saveFile("data/" + pack.id + ".js", text);
    const withLayout = B.circuits.filter(x => !x.core && x.layout);
    for (const c of withLayout) {
      await saveFile("data/tracks/" + c.key + ".js", "// " + c.layout.name + " – " + c.layout.source + " (generated)\nregisterTrackLayout(" + JSON.stringify(c.layout) + ");\n");
    }
    $("exportStatus").textContent = "Saved data/" + pack.id + ".js and " + withLayout.length + " track files. Add <script src=\"data/" + pack.id + ".js\"> to index.html (after core-2023.js)." + missingText();
    log("Saved into the project: " + pack.id, "ok");
  } catch (error) {
    $("exportStatus").textContent = "Error: " + error.message;
  }
}

async function saveFile(path, text) {
  const res = await fetch("/__save/race-control/" + path, { method: "POST", body: text });
  if (!res.ok) throw new Error("save " + path + ": " + res.status);
}

// ---------- The seasons that have data ----------
// Only years the Jolpica API has results for can be chosen. Years that a built-in
// pack already has are marked.
async function fillYearList() {
  const select = $("year");
  let years = [];
  try {
    const data = await jolpica("seasons.json?limit=100");
    years = data.SeasonTable.Seasons.map(s => Number(s.season)).filter(Number.isFinite);
  } catch (error) {
    log("The list of seasons could not be loaded (" + error.message + ") – using 1950 to last year.", "bad");
    for (let y = 1950; y < new Date().getFullYear(); y++) years.push(y);
  }
  years.sort((a, b) => b - a);
  const builtIn = new Set(SEASON_YEARS);
  const preferred = years.find(y => !builtIn.has(y)) || years[0];
  select.innerHTML = years.map(y => `<option value="${y}" ${y === preferred ? "selected" : ""}>${y}${builtIn.has(y) ? " (already built in)" : ""}</option>`).join("");
  $("loadSeason").disabled = false;
}

// ---------- Wiring ----------
$("loadSeason").disabled = true; // until the list of seasons is there
fillYearList();
$("loadSeason").addEventListener("click", loadSeason);
$("downloadJson").addEventListener("click", downloadJson);
$("saveProject").addEventListener("click", saveIntoProject);
// the save button only on the local development server
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) $("saveProject").hidden = false;

$("circuitList").addEventListener("click", event => {
  const b = event.target.closest("button[data-edit]");
  if (!b) return;
  B.editing = circuitKeyOf(b.dataset.edit);
  renderLayouts();
});

$("layoutEditor").addEventListener("change", event => {
  const c = B.circuits.find(x => x.key === B.editing);
  if (!c) return;
  const t = event.target;
  if (t.id === "lyFile") {
    const file = t.files[0];
    if (!file) return;
    file.text().then(text => {
      try {
        c.fileFeature = parseLayoutFile(file.name, text);
        c.layoutOptions.feature = c.fileFeature.properties.id;
        log(c.location + ": layout loaded from " + file.name + " (" + (c.fileFeature.properties.length / 1000).toFixed(2) + " km)", "ok");
      } catch (error) {
        log(c.location + ": " + file.name + " – " + error.message, "bad");
        showToast("Layout file not usable: " + error.message);
      }
      rebuildLayout(c);
      renderLayouts();
    });
    return;
  }
  if (t.id === "lyFeature") c.layoutOptions.feature = t.value || null;
  if (t.id === "lyDirection") c.layoutOptions.direction = t.value;
  if (t.id === "lyStart") c.layoutOptions.startOffset = Number(t.value) || 0;
  if (t.id === "lyPit") c.layoutOptions.pitLaneLength = clamp(Number(t.value) || 380, 250, 650);
  if (t.id === "lyName") c.character.short = t.value.trim();
  if (t.id === "lyRef") c.layoutOptions.refLap = lapSeconds(t.value.trim()) || null;
  if (t.dataset.char) c.character[t.dataset.char] = Number(t.value);
  if (t.dataset.charNight) c.character.night = t.checked || undefined;
  rebuildLayout(c);
  renderLayouts();
});

$("layoutEditor").addEventListener("click", async event => {
  if (!event.target.closest("#lyOsm")) return;
  const c = B.circuits.find(x => x.key === B.editing);
  if (!c) return;
  const name = c.character.short || c.location;
  setBusy(true);
  c.loadState = "loading";
  $("layoutEditor").innerHTML = "";
  renderCircuitList();
  try {
    await findOsmLayouts(c, sub => showProgress("Searching OpenStreetMap · " + name, 0.5, sub), true);
    rebuildLayout(c);
  } finally {
    c.loadState = null;
    setBusy(false);
  }
  renderLayouts();
});

$("layoutEditor").addEventListener("input", event => {
  const t = event.target;
  if (t.dataset.char && t.previousElementSibling) t.previousElementSibling.textContent = t.value;
});

window.addEventListener("resize", () => {
  const c = B.circuits.find(x => x.key === B.editing);
  if (c) drawPreview(c);
});
