// =====================================================================
//  settings/simulation.js – how the simulation runs
// =====================================================================

const DT = 0.1;           // seconds of race time per simulation step (smaller = more exact, slower)
const SIM_BUDGET_MS = 20; // milliseconds per screen frame the simulation may use (the rest is for drawing)
const MAX_BACKLOG = 1;    // seconds of race time the simulation may fall behind before it skips ahead
