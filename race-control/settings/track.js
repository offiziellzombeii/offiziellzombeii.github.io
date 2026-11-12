// =====================================================================
//  settings/track.js – the track over a weekend
// =====================================================================

// Rubber on the track (0 = green … 1 = fully rubbered in)
const RUBBER_START = 0.05; // at the start of FP1
// the usual level at the start of each session: at this level the lap times are as calibrated
const RUBBER_EXPECTED = { FP1: 0.05, FP2: 0.3, FP3: 0.45, SQ: 0.5, SPRINT: 0.55, Q: 0.55, RACE: 0.65 };
const RUBBER_PACE = 0.01;      // a fully rubbered-in track is ~1 % faster than a green one
const RUBBER_PER_LAP = 0.0006; // rubber laid down by one lap of one car
const RUBBER_RAIN_WASH = 0.0015; // share of the rubber the rain washes away per second (× rain)
