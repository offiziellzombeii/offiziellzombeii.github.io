// =====================================================================
//  grid.js
//  The invented teams and drivers of the fictitious race,
//  and the tyre strategy every team plans before the race.
// =====================================================================

// perf = how fast the car is (1.000 = the best car)
const FICTIONAL_TEAMS = [
  { name: "Aurora Racing",        colour: "#00b3a4", perf: 1.000 },
  { name: "Vortex Motorsport",    colour: "#e8112d", perf: 0.9985 },
  { name: "Kestrel GP",           colour: "#ff8a00", perf: 0.9975 },
  { name: "Nordlicht Racing",     colour: "#2f6bff", perf: 0.9955 },
  { name: "Solano Corse",         colour: "#ffd400", perf: 0.9935 },
  { name: "Ironbridge F1 Team",   colour: "#8a94a8", perf: 0.9915 },
  { name: "Cascadia Racing",      colour: "#2fbf71", perf: 0.9905 },
  { name: "Meridian Autosport",   colour: "#b14cff", perf: 0.9890 },
  { name: "Tsunami Racing",       colour: "#ff5fa2", perf: 0.9875 },
  { name: "Halcyon Motorsport",   colour: "#f2f2f2", perf: 0.9860 }
];

// skill: 1.000 = perfect. aggression / consistency / racecraft / tyres: 0 ... 1
const FICTIONAL_DRIVERS = [
  { team: 0, number: 7,  code: "BER", name: "Luca Bertolini",   skill: 1.000, aggression: 0.55, consistency: 0.90, racecraft: 0.90, tyres: 0.80 },
  { team: 0, number: 21, code: "FRZ", name: "Mateo Ferraz",     skill: 0.996, aggression: 0.45, consistency: 0.85, racecraft: 0.75, tyres: 0.70 },
  { team: 1, number: 3,  code: "LIN", name: "Elias Lindqvist",  skill: 0.999, aggression: 0.70, consistency: 0.80, racecraft: 0.85, tyres: 0.60 },
  { team: 1, number: 12, code: "ARA", name: "Kenji Arata",      skill: 0.997, aggression: 0.40, consistency: 0.92, racecraft: 0.80, tyres: 0.85 },
  { team: 2, number: 9,  code: "WHI", name: "Oscar Whitmore",   skill: 0.999, aggression: 0.60, consistency: 0.88, racecraft: 0.88, tyres: 0.75 },
  { team: 2, number: 28, code: "DUM", name: "Rafael Dumont",    skill: 0.995, aggression: 0.80, consistency: 0.70, racecraft: 0.65, tyres: 0.55 },
  { team: 3, number: 5,  code: "FAL", name: "Jonas Falk",       skill: 0.998, aggression: 0.35, consistency: 0.95, racecraft: 0.82, tyres: 0.90 },
  { team: 3, number: 17, code: "BRA", name: "Noah Brandt",      skill: 0.994, aggression: 0.65, consistency: 0.78, racecraft: 0.70, tyres: 0.65 },
  { team: 4, number: 11, code: "SAL", name: "Diego Salcedo",    skill: 0.997, aggression: 0.75, consistency: 0.82, racecraft: 0.86, tyres: 0.70 },
  { team: 4, number: 33, code: "VEN", name: "Marco Venturi",    skill: 0.995, aggression: 0.50, consistency: 0.86, racecraft: 0.72, tyres: 0.75 },
  { team: 5, number: 19, code: "PEM", name: "Harry Pembroke",   skill: 0.996, aggression: 0.45, consistency: 0.90, racecraft: 0.78, tyres: 0.85 },
  { team: 5, number: 6,  code: "KER", name: "Aiden Kerr",       skill: 0.993, aggression: 0.85, consistency: 0.65, racecraft: 0.60, tyres: 0.50 },
  { team: 6, number: 24, code: "HER", name: "Tomás Herrera",    skill: 0.996, aggression: 0.60, consistency: 0.84, racecraft: 0.80, tyres: 0.70 },
  { team: 6, number: 41, code: "OCN", name: "Liam O'Connell",   skill: 0.994, aggression: 0.55, consistency: 0.80, racecraft: 0.70, tyres: 0.80 },
  { team: 7, number: 14, code: "SOK", name: "Viktor Sokolov",   skill: 0.997, aggression: 0.65, consistency: 0.87, racecraft: 0.84, tyres: 0.65 },
  { team: 7, number: 88, code: "NAK", name: "Yuto Nakamura",    skill: 0.993, aggression: 0.50, consistency: 0.83, racecraft: 0.68, tyres: 0.75 },
  { team: 8, number: 22, code: "MOR", name: "Adrien Moreau",    skill: 0.995, aggression: 0.70, consistency: 0.76, racecraft: 0.74, tyres: 0.60 },
  { team: 8, number: 10, code: "AAL", name: "Felix Aalto",      skill: 0.994, aggression: 0.40, consistency: 0.89, racecraft: 0.70, tyres: 0.85 },
  { team: 9, number: 31, code: "OKA", name: "Samuel Okafor",    skill: 0.996, aggression: 0.60, consistency: 0.85, racecraft: 0.79, tyres: 0.75 },
  { team: 9, number: 77, code: "REI", name: "Nico Reinholt",    skill: 0.992, aggression: 0.90, consistency: 0.62, racecraft: 0.58, tyres: 0.55 }
];

// Make the list of cars for a fictitious race.
// The grid order comes from a quick "qualifying" with a bit of luck.
function makeFictionalEntries(totalLaps, weather) {
  const entries = FICTIONAL_DRIVERS.map(d => {
    const team = FICTIONAL_TEAMS[d.team];
    return {
      number: d.number,
      code: d.code,
      name: d.name,
      team: team.name,
      teamIndex: d.team,
      colour: team.colour,
      pace: team.perf * d.skill,
      aggression: d.aggression,
      consistency: d.consistency,
      racecraft: d.racecraft,
      tyreMgmt: d.tyres,
      qualifying: team.perf * d.skill * rand(0.9975, 1.0025)
    };
  });

  entries.sort((a, b) => b.qualifying - a.qualifying);
  entries.forEach((e, index) => {
    e.grid = index + 1;
    const strategy = planStrategy(totalLaps);
    e.startCompound = weather.startCompound || strategy.start;
    e.plan = strategy.stops;
  });
  return entries;
}

// A tyre strategy: which tyre to start on and on which laps to stop.
function planStrategy(totalLaps) {
  if (totalLaps < 12) return { start: "SOFT", stops: [] };

  const r = random();
  if (r < 0.4) {
    return { start: "MEDIUM", stops: [{ lap: Math.round(totalLaps * rand(0.38, 0.52)), compound: "HARD" }] };
  }
  if (r < 0.68) {
    return { start: "SOFT", stops: [{ lap: Math.round(totalLaps * rand(0.24, 0.33)), compound: "HARD" }] };
  }
  if (r < 0.86) {
    return { start: "HARD", stops: [{ lap: Math.round(totalLaps * rand(0.52, 0.64)), compound: "MEDIUM" }] };
  }
  return {
    start: "SOFT",
    stops: [
      { lap: Math.round(totalLaps * rand(0.22, 0.3)), compound: "MEDIUM" },
      { lap: Math.round(totalLaps * rand(0.58, 0.68)), compound: "SOFT" }
    ]
  };
}

// Weather options of the fictitious race -> rain schedule
function makeFictionalWeather(kind, totalLaps) {
  const weather = { air: Math.round(rand(19, 30)), trackTemp: 0, schedule: [], initialRain: 0, initialWet: 0 };
  weather.trackTemp = weather.air + Math.round(rand(8, 18));

  if (kind === "changeable") {
    const start = totalLaps * rand(0.3, 0.55);
    const length = totalLaps * rand(0.15, 0.3);
    const intensity = rand(0.45, 0.85);
    weather.schedule.push({ lap: start, rain: intensity });
    weather.schedule.push({ lap: start + length * 0.5, rain: intensity * rand(0.6, 1.2) });
    weather.schedule.push({ lap: start + length, rain: 0 });
  } else if (kind === "wet") {
    weather.initialRain = rand(0.6, 0.85);
    weather.initialWet = weather.initialRain;
    weather.startCompound = weather.initialRain > 0.7 ? "WET" : "INTERMEDIATE";
    weather.schedule.push({ lap: totalLaps * rand(0.2, 0.35), rain: rand(0.3, 0.5) });
    weather.schedule.push({ lap: totalLaps * rand(0.45, 0.6), rain: 0 });
    weather.air -= 6;
    weather.trackTemp = weather.air + 3;
  }
  return weather;
}
