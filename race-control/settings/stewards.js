// =====================================================================
//  settings/stewards.js – penalties and the stewards' room
// =====================================================================

// seconds a penalty is worth when it is added to the race time after the race
const PENALTY_SECONDS = { "5S": 5, "10S": 10, DT: 20, SG10: 30 };
// places of a grid penalty (BACK = the back of the grid)
const GRID_PLACES = { GRID3: 3, GRID5: 5, GRID10: 10, BACK: 99 };

// the two co-stewards in the review: right = how often they agree with the reference decision
const CO_STEWARDS = [{ role: "FIA steward", right: 0.8 }, { role: "Driver steward", right: 0.6 }];
const PRECEDENTS_SHOWN = 3;   // earlier decisions shown in the incident review
