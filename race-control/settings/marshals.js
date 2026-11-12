// =====================================================================
//  settings/marshals.js – recovery crews, medical car
// =====================================================================

// The crews the Race Director sends: travel = seconds to get there (from … to)
const CREWS = {
  MEDICAL:     { name: "medical car", travel: [20, 40] },
  CAR_ON_TRACK:{ name: "recovery vehicle", travel: [25, 45] },
  CAR_OFF:     { name: "crane", travel: [30, 55] },
  OIL:         { name: "marshals with cement dust", travel: [12, 25] },
  BARRIER:     { name: "barrier repair crew", travel: [35, 60] },
  DEBRIS:      { name: "marshals", travel: [8, 18] }
};

// How long the work takes at full speed (seconds, from … to). The real time depends on the
// protection: a red flag is fastest, a single yellow slow, a green sector not allowed.
const WORK_TIME = {
  CAR_ON_TRACK: [70, 140],
  CAR_OFF: [90, 180],      // the crane lifts the car over the barrier
  DEBRIS: [40, 90],
  BARRIER: [250, 420],
  MEDICAL: [30, 60]
};

const HEAVY_IMPACT_G = 35;   // from this impact the driver must be checked (medical car)
const NEXT_EVENT_G = 55;     // an unfit driver after this impact also misses the next event
