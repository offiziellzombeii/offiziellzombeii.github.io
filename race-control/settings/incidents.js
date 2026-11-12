// =====================================================================
//  settings/incidents.js – spins, crashes, track limits, failures
// =====================================================================

const SPIN_CHANCE = 0.0002;      // chance of a mistake per car and corner (× incident level, tyres, weather …)
const SPIN_PUSH_QUALI = 15;      // × on a qualifying push lap (everything on one lap)
const SPIN_PUSH_PRACTICE = 8;    // × on a practice run
const SPIN_SLOW_LAP = 0.3;       // × on out laps and in laps
const QUALI_PUSH_CRASH = 0.25;   // share of push-lap mistakes that end in the barrier at once
const FAILURE_CHANCE = 0.0007;   // chance of a technical failure per car and lap (race)
const FAILURE_CHANCE_QUALI = 0.0005; // the same in qualifying / practice
const TRACK_LIMITS_CHANCE = 0.004;       // per car and monitored corner (race)
const TRACK_LIMITS_CHANCE_QUALI = 0.012; // per car and monitored corner on a push lap

// Championship calibration
const SEASON_OFFENCES = 0.2;   // share of minor offences that happen (realistic number of investigations)
const SEASON_OVERTAKES = 0.4;  // how often cars try to overtake
