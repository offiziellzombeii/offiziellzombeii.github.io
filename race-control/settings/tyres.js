// =====================================================================
//  settings/tyres.js – tyres
// =====================================================================

// base = grip (1 = fastest), wear = share of the tyre used per lap (before the race scaling)
const TYRES = {
  SOFT:         { base: 1.000,  wear: 0.042, colour: "#ff3333", slick: true,  letter: "S" },
  MEDIUM:       { base: 0.9935, wear: 0.027, colour: "#ffd60a", slick: true,  letter: "M" },
  HARD:         { base: 0.9875, wear: 0.018, colour: "#f0f0f0", slick: true,  letter: "H" },
  INTERMEDIATE: { base: 1.000,  wear: 0.030, colour: "#39b54a", slick: false, letter: "I" },
  WET:          { base: 1.000,  wear: 0.022, colour: "#0090ff", slick: false, letter: "W" }
};

const COLD_TYRE_SECONDS = 25;   // seconds after a pit stop with cold tyres
const COLD_TYRE_GRIP = 0.975;   // grip with cold tyres (0.975 = 2.5 % less)
const COLD_TRACK_TEMP = 22;     // °C: below this the tyres take longer to warm up (×1.3)
const RESTART_COLD_PER_SECOND = 0.08; // after a SC / VSC: seconds of cold tyres per second of neutralisation …
const RESTART_COLD_MIN = 3;           // … at least
const RESTART_COLD_MAX = 14;          // … at most
const RED_FLAG_COLD = 5;              // after a red flag (tyre blankets in the pit lane)

const GRAINING_RATE = 2;        // how often cold tyres grain at circuits that are hard on the tyres
const GRAINING_WEAR = 1.6;      // wear while the tyre grains
const GRAINING_GRIP = 0.995;    // grip while the tyre grains

// track temperature: wear × (1 + (temperature − 35 °C) × this), limited to −15 % … +25 %
const TRACK_TEMP_WEAR = 0.012;

// Championship: tyre sets per driver and weekend
const TYRE_ALLOCATION = { normal: { SOFT: 8, MEDIUM: 3, HARD: 2 }, sprint: { SOFT: 6, MEDIUM: 4, HARD: 2 } };
const USED_SOFT_FACTOR = 0.996; // a qualifying run on a used soft set: ~0.4 % slower
// The sets a team uses in a simulated practice session (dry)
const PRACTICE_SETS = {
  FP1: { HARD: 1, MEDIUM: 1 },
  FP2: { SOFT: 1, MEDIUM: 1, HARD: 1 },
  FP3: { SOFT: 2 },
  SPRINT_FP1: { SOFT: 1, MEDIUM: 1 }
};
const SEASON_TYRE_DEG = 0.6;    // championship: how much the tyres degrade (1 = the old, steeper model)
