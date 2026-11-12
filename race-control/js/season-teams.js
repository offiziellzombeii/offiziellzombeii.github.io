// =====================================================================
//  season-teams.js
//  How fast are the cars and how good are the drivers of a championship?
//
//  Car: see season-cars.js (five ratings, matched to the circuit).
//  Driver: ratings from the real statistics of the driver
//       (head-to-head against the team mate in qualifying and races,
//       retirements) – always the same for the same driver.
// =====================================================================

// Make sure a season has car and driver ratings (old saves get them too)
function ensureRatings(s) {
  // the cars, their money and power units (season-cars.js)
  ensureCarModel(s);
  ensureFinances(s);
  ensurePowerUnits(s);
  for (const id in s.drivers) {
    const d = s.drivers[id];
    if (!d.ratings) d.ratings = driverRatings(id, s.baseYear);
    if (d.penaltyPoints === undefined) d.penaltyPoints = 0;
    if (d.reprimands === undefined) d.reprimands = 0;
    if (d.carryGrid === undefined) d.carryGrid = 0;
  }
}

// Ratings of a real driver from the statistics of the seasons up to the base year
function driverRatings(id, baseYear) {
  const c = catalogueDriver(id);
  const years = Object.keys(c.seasons).map(Number).sort();
  const useYears = years.filter(y => y <= baseYear);
  const list = (useYears.length ? useYears : years.slice(0, 1)).map(y => c.seasons[y]);

  const share = field => {
    let won = 0;
    let all = 0;
    list.forEach((s, i) => {
      const weight = i + 1; // the latest season counts most
      won += s[field][0] * weight;
      all += s[field][1] * weight;
    });
    // few races = less certain: pulled towards 40 % (a newcomer is rarely better than an established driver)
    return (won + 2.4) / (all + 6);
  };
  const q = share("h2hQ");
  const r = share("h2hR");
  const races = list.reduce((a, s) => a + s.races, 0);
  const dnfs = list.reduce((a, s) => a + s.dnf, 0);
  const own = makeRandom(hashText(id) % 100000 + 17);

  return {
    skill: Math.round((0.9935 + 0.0065 * (0.65 * q + 0.35 * r)) * 10000) / 10000, // best ~0.3 % ahead of the weakest
    racecraft: Math.round((0.55 + 0.4 * r) * 100) / 100,
    consistency: Math.round(clamp(0.95 - (races ? dnfs / races : 0.1) * 0.9, 0.65, 0.95) * 100) / 100,
    aggression: Math.round((0.35 + own() * 0.5) * 100) / 100,
    tyres: Math.round((0.55 + own() * 0.4) * 100) / 100
  };
}

// A number from a text (for seeds that are always the same)
function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Form of a weekend: no team and no driver is equally strong everywhere
// (setup, track fit, upgrades of the others ...). The same for all sessions
// of one weekend, different every weekend.
function weekendForm(s, roundNumber) {
  const rnd = makeRandom(hashText(s.id + "/" + roundNumber) % 1000000 + 1);
  const bell = () => (rnd() + rnd() + rnd() - 1.5) / 1.5; // -1 ... 1, most values near 0
  const form = { teams: {}, drivers: {} };
  for (const t of s.teams) form.teams[t.id] = 1 + bell() * 0.004;
  for (const id in s.drivers) form.drivers[id] = 1 + bell() * 0.0025;
  return form;
}

// The entries of a session: every car with its pace for this circuit
function seasonEntries(s, roundNumber, circuitKey) {
  const entries = [];
  const form = roundNumber ? weekendForm(s, roundNumber) : null;
  s.teams.forEach((t, teamIndex) => {
    for (const id of t.drivers) {
      const d = s.drivers[id];
      const rt = d.ratings;
      const formFactor = form ? form.teams[t.id] * form.drivers[id] : 1;
      entries.push({
        number: d.number,
        code: d.code,
        driverId: id,                 // the season id of the driver (the code is only for the screen)
        name: d.first + " " + d.last,
        team: t.name,
        teamId: t.id,
        teamIndex,
        colour: t.colour,
        headshot: d.headshot || null,
        pace: carPace(s, t.id, circuitKey) * rt.skill * formFactor,
        failureScale: carFailureScale(s, t.id, id),
        aggression: rt.aggression,
        consistency: rt.consistency,
        racecraft: rt.racecraft,
        tyreMgmt: clamp(rt.tyres * 0.6 + s.cars[t.id].tyres / 100 * 0.4, 0, 1), // driver and car
        grid: 0,
        startCompound: "MEDIUM",
        plan: []
      });
    }
  });
  return entries;
}
