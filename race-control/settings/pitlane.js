// =====================================================================
//  settings/pitlane.js – the pit lane
// =====================================================================

const PIT_SPEED = 80 / 3.6;      // m/s, default pit lane speed limit (80 km/h; the event notes can set 60)
const PIT_STOP_TIME = [2.0, 3.1]; // seconds stationary for a normal stop (from … to)
const SLOW_STOP_CHANCE = 0.05;   // share of stops with a wheel nut problem
const SLOW_STOP_EXTRA = [2, 8];  // seconds lost with a wheel nut problem
const UNSAFE_RELEASE_CHANCE = 0.12; // a team releases too early when a car comes in the fast lane (× incident level)
const DOUBLE_STACK_AVOID = 0.85; // chance a team keeps the second car out instead of double stacking (green flag)
const SPEEDING_CHANCE = 0.02;    // share of pit stops where the limiter is released too early (× incident level)
