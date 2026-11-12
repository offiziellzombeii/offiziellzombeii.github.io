// =====================================================================
//  settings/neutralisation.js – VSC and Safety Car
// =====================================================================

const VSC_REF = 0.64;  // VSC: the minimum time as a share of the racing speed
const SC_REF = 0.7;    // Safety Car delta: share of the racing speed …
const SC_MAX_SPEED = 62; // … but at most this many m/s
// The Safety Car comes out of the pit lane
const SC_JOIN_GAP = 150;      // m: it waits at the pit exit while a car is closer than this
const SC_MAX_PIT_WAIT = 20;   // s: it joins at the latest after this long
const SC_WAIT_PACE = 0.4;     // share of the racing speed while it waits for the leader (at most 35 m/s)
const SC_PICKUP_GAP = 150;    // m: the leader is "picked up" when it is this close behind the Safety Car
const DELTA_GRACE = 5; // seconds after the deployment before the delta is measured (braking down)
const DELTA_PUSH_CHANCE = 0.02; // share of drivers who push and go below the delta (× incident level)
