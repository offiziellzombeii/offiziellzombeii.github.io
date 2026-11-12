// =====================================================================
//  incidents.js
//  1. Alerts (messages from marshals and systems to Race Control)
//  2. Obstacles on track (stopped cars, debris, oil) and the marshals
//  3. Incidents for the stewards, with evidence and the "correct" answer
//  4. Track limits
//  5. Penalties
//  6. Evaluation of the Race Director's decisions
// =====================================================================

const PENALTIES = {
  NFA:       { label: "No further action",          short: "NFA",  rank: 0 },
  WARNING:   { label: "Warning",                    short: "WARN", rank: 1 },
  REPRIMAND: { label: "Reprimand",                  short: "REP",  rank: 1 },
  "5S":      { label: "5 second time penalty",      short: "+5s",  rank: 2 },
  "10S":     { label: "10 second time penalty",     short: "+10s", rank: 3 },
  DT:        { label: "Drive-through penalty",      short: "DT",   rank: 4 },
  SG10:      { label: "10 second stop/go penalty",  short: "SG",   rank: 5 },
  DSQ:       { label: "Disqualification",           short: "DSQ",  rank: 7 },
  // qualifying
  FINE:       { label: "Fine (for the team)",            short: "FINE", rank: 1 },
  DELETE_LAP: { label: "Lap time deleted",               short: "DEL",  rank: 2 },
  GRID3:      { label: "3-place grid penalty",           short: "-3",   rank: 3 },
  GRID5:      { label: "5-place grid penalty",           short: "-5",   rank: 4 },
  GRID10:     { label: "10-place grid penalty",          short: "-10",  rank: 5 },
  BACK:       { label: "Start from the back of the grid", short: "BACK", rank: 6 },
  // championship, FIA desk only (hearings after the session): bans for the next events
  QBAN:       { label: "Qualifying ban – back of the grid at the next event", short: "QBAN", rank: 6 },
  BAN1:       { label: "Race ban – 1 Grand Prix",  short: "BAN×1", rank: 8 },
  BAN2:       { label: "Race ban – 2 Grands Prix", short: "BAN×2", rank: 9 },
  BAN3:       { label: "Race ban – 3 Grands Prix", short: "BAN×3", rank: 10 }
};
const DESK_PENALTY_CODES = ["QBAN", "BAN1", "BAN2", "BAN3"];
const PENALTY_CODES = ["NFA", "WARNING", "REPRIMAND", "5S", "10S", "DT", "SG10", "DSQ"];
const QUALI_PENALTY_CODES = ["NFA", "WARNING", "REPRIMAND", "FINE", "DELETE_LAP", "GRID3", "GRID5", "GRID10", "BACK", "DSQ"];

function penaltyCodes() {
  return race.session === "QUALI" ? QUALI_PENALTY_CODES : PENALTY_CODES;
}

// In qualifying there are no time penalties: the guideline answer becomes a grid penalty etc.
const QUALI_EQUIVALENT = { "5S": "GRID3", "10S": "GRID5", DT: "GRID5", SG10: "GRID10" };
const QUALI_BY_TYPE = {
  PIT_SPEEDING: ["FINE", "Outside the race, speeding in the pit lane is punished with a fine for the team (€100 per km/h over the limit)."],
  UNSAFE_RELEASE: ["FINE", "Outside the race, an unsafe release is usually punished with a fine for the team."],
  PIT_EXIT: ["REPRIMAND", "Crossing the pit exit line in qualifying or practice usually gives a reprimand."],
  LEAVING_TRACK: ["DELETE_LAP", "The lap was completed with an advantage gained off track, so the lap time is deleted."]
};

function qualiTruth(type, truth) {
  if (!truth || truth.quali || !truth.culprit) return truth;
  const byType = QUALI_BY_TYPE[type];
  if (byType) return Object.assign({}, truth, { penalty: byType[0], reason: byType[1], quali: true });
  return Object.assign({}, truth, { penalty: QUALI_EQUIVALENT[truth.penalty] || truth.penalty, quali: true });
}

// "Lap 12" in a race, "Q2" in qualifying
function lapLabel(n) {
  if (race.session === "QUALI" && race.setup.practice) return race.setup.practice;
  return race.session === "QUALI" ? (race.setup.sprint ? "SQ" : "Q") + n : "Lap " + n;
}


// =====================================================================
//  1. ALERTS
// =====================================================================
// level: "info", "warn" or "danger"
function addAlert(level, text, opts) {
  const r = race;
  opts = opts || {};
  r.alerts.push({
    id: r.nextId++, t: r.time, lap: r.leaderLap, level, text,
    carId: opts.carId, s: opts.s, sector: opts.sector
  });
  if (level === "danger" && r.autoSlow) r.speedRequest = 1;
  r.ver++;
}


// =====================================================================
//  2. OBSTACLES AND MARSHALS
// =====================================================================
// type: CAR, DEBRIS, OIL, BARRIER
function addObstacle(o) {
  const r = race;
  const s = mod(o.s, r.track.length);
  const ob = {
    id: r.nextId++, type: o.type, s, sector: marshalSectorAt(r.track, s),
    onTrack: !!o.onTrack, required: o.required, progress: 0, carId: o.carId || null, crash: !!o.crash,
    label: o.label, created: r.time, measureAt: null, cleared: false, clearedAt: null,
    unsafePasses: 0, lastNag: r.time, medicalCarId: o.medicalCarId || null,
    crew: null // the recovery crew the Race Director sent: { name, arriveAt } (sendRecovery)
  };
  r.obstacles.push(ob);
  marshalYellow(ob.sector - 1, 0);
  r.ver++;
  return ob;
}

// A marshal post shows a yellow flag on its own (if this option is on).
// autoClearAfter > 0: the marshal also takes the flag back after that many seconds.
function marshalYellow(index, autoClearAfter) {
  const r = race;
  if (!r.autoMarshalYellow || r.status === "RED") return;
  if (r.sectorFlags[index] === "GREEN") {
    setSectorFlag(index, "YELLOW", "MARSHAL");
    if (autoClearAfter > 0) r.autoClear.push({ sector: index, at: r.time + autoClearAfter, done: false });
  }
}

// How fast can the marshals clear an obstacle right now? 0 = they are not allowed to go out.
function recoveryRate(ob) {
  const r = race;
  const st = r.status;
  const flag = shownFlag(ob.sector - 1);
  if (ob.type === "MEDICAL") {
    // the medical car only goes out under a Safety Car or a red flag
    if (st === "RED") return 2;
    if (st === "SC" || st === "SC_ENDING") return 1.2;
    return 0;
  }
  if (ob.type === "BARRIER") {
    if (st === "RED") return 2.2;
    if (st === "SC" || st === "SC_ENDING") return 0.6;
    if (st === "VSC" || st === "VSC_ENDING") return 0.3;
    return 0;
  }
  if (st === "RED") return 2.2;
  if (st === "SC" || st === "SC_ENDING") return 1.3;
  if (st === "VSC" || st === "VSC_ENDING") return 1.0;
  if (flag === "DOUBLE") return ob.onTrack ? 0.55 : 1.0;
  if (flag === "YELLOW") return ob.onTrack ? 0 : 0.8;
  return 0;
}

// Is the protection of the marshals and drivers good enough?
function adequateMeasure(ob) {
  const r = race;
  const st = r.status;
  const flag = shownFlag(ob.sector - 1);
  if (ob.type === "BARRIER" || ob.type === "MEDICAL") return st === "SC" || st === "SC_ENDING" || st === "RED";
  if (["VSC", "VSC_ENDING", "SC", "SC_ENDING", "RED"].includes(st)) return true;
  if (ob.onTrack) return flag === "DOUBLE";
  return flag !== "GREEN";
}

// ---------- Recovery crews: the Race Director sends them ----------
// Nothing is cleared on its own: the Race Director sends the right crew (travel time),
// and it only works when the flags protect it.
function crewFor(ob) {
  // the crews and their travel times: settings/marshals.js
  if (ob.type === "CAR") return ob.onTrack ? CREWS.CAR_ON_TRACK : CREWS.CAR_OFF;
  return CREWS[ob.type] || CREWS.DEBRIS;
}

// " is" / " are" (the marshals)
function crewVerb(ob) {
  return /^marshals/.test(ob.crew.name) ? " are" : " is";
}

function sendRecovery(id) {
  const r = race;
  const ob = r.obstacles.find(o => o.id === id);
  if (!ob || ob.cleared) return "This has been cleared already.";
  if (ob.crew) return "Already sent: " + ob.crew.name + ".";
  const c = crewFor(ob);
  ob.crew = { name: c.name, arriveAt: r.time + rand(c.travel[0], c.travel[1]), sentAt: r.time };
  addAlert("info", "Marshal post " + ob.sector + ": " + c.name + " sent to " + ob.label + ".", { s: ob.s, sector: ob.sector });
  r.ver++;
}

// The state of a recovery job for the "On track" list (ui.js)
function recoveryState(ob) {
  const r = race;
  if (!ob.crew) return { key: "NONE", text: "no crew sent" };
  if (r.time < ob.crew.arriveAt) return { key: "TRAVEL", text: ob.crew.name + " arrives in " + Math.ceil(ob.crew.arriveAt - r.time) + " s" };
  if (recoveryRate(ob) === 0) {
    const needs = ob.type === "BARRIER" || ob.type === "MEDICAL" ? "SC or red flag" : ob.onTrack ? "double yellow or neutralisation" : "a yellow flag";
    return { key: "WAIT", text: ob.crew.name + " waiting for " + needs };
  }
  return { key: "WORK", text: ob.crew.name + " working – " + Math.round(ob.progress * 100) + " %" };
}

function updateObstacles() {
  const r = race;
  for (const ob of r.obstacles) {
    if (ob.cleared) continue;
    // the option "send recovery automatically" (and the AI Race Director)
    if (!ob.crew && r.autoRecovery && r.time - ob.created > 3) sendRecovery(ob.id);
    const crewThere = ob.crew && r.time >= ob.crew.arriveAt;
    const rate = crewThere ? recoveryRate(ob) : 0;
    if (rate > 0) {
      ob.progress += DT * rate / ob.required;
      ob.working = true;
    }
    if (ob.measureAt === null && adequateMeasure(ob)) ob.measureAt = r.time;

    // marshals working on the track while cars still pass at (almost) racing speed
    const neutral = NEUTRALISED.has(r.status);
    if (ob.onTrack && rate > 0 && !neutral) r.evalData.marshalRisk += DT;

    // the crew is out on the track and the protection was taken away (sector green / single yellow)
    if (crewThere && ob.working && (ob.onTrack || ob.type === "MEDICAL") && !adequateMeasure(ob) && r.status !== "RED") {
      r.evalData.marshalExposed += DT;
      if (!ob.exposedWarned) {
        ob.exposedWarned = true;
        addAlert("danger", "Marshal post " + ob.sector + ": the " + ob.crew.name + crewVerb(ob) + " still on the track at " + ob.label +
          " – the sector needs a double yellow flag (or a neutralisation) until the work is done!", { s: ob.s, sector: ob.sector });
      }
      if (chance(DT * 0.012 * r.level)) {
        r.evalData.nearMisses++;
        addAlert("danger", "NEAR MISS at marshal post " + ob.sector + ": a car passed the " + ob.crew.name + " at racing speed.", { s: ob.s, sector: ob.sector });
      }
    } else if (ob.exposedWarned && adequateMeasure(ob)) ob.exposedWarned = false;

    if (ob.progress >= 1) {
      clearObstacle(ob);
    } else if (!ob.crew && r.time - ob.lastNag > 30) {
      ob.lastNag = r.time;
      addAlert("warn", "Marshal post " + ob.sector + ": " + ob.label + " – send the " + crewFor(ob).name + " (list \"On track\").",
        { s: ob.s, sector: ob.sector });
    } else if (crewThere && rate === 0 && r.time - ob.lastNag > 45) {
      ob.lastNag = r.time;
      const needs = ob.type === "BARRIER" || ob.type === "MEDICAL" ? "a Safety Car or a red flag"
                  : ob.onTrack ? "a double yellow flag or a neutralisation" : "at least a yellow flag";
      addAlert("warn", "Marshal post " + ob.sector + ": the " + ob.crew.name + crewVerb(ob) + " waiting for " + needs + " to recover " + ob.label + ".",
        { s: ob.s, sector: ob.sector });
    }
    // the time obstacles wait for a crew counts in the rating
    if (!ob.cleared && !ob.crew) r.evalData.recoveryWait += DT;
    // a driver after a heavy impact waits for the medical car (no neutralisation yet)
    if (!ob.cleared && ob.type === "MEDICAL" && !adequateMeasure(ob)) r.evalData.medicalWait = (r.evalData.medicalWait || 0) + DT;
  }
}

// =====================================================================
//  TEAM RADIO: complaints and requests of the teams to the Race Director
// =====================================================================
// kind COMPLAINT: about another car. valid = there really was an offence (an incident the
//   Race Director has not handled yet – inc), or not (a complaint about clean racing).
// kind REQUEST: wet race, debris, pit exit – it is resolved when the problem is solved.
// status: NEW, NOTED, INVESTIGATING, REJECTED, RESOLVED
function addRadio(car, kind, text, o) {
  const r = race;
  o = o || {};
  const msg = { id: r.nextId++, t: r.time, lap: r.leaderLap, kind, carId: car ? car.id : null, team: car ? car.team : "",
    text, valid: o.valid !== false, incId: o.incId || null, accused: o.accused || null, topic: o.topic || null,
    status: o.status || "NEW", answeredAt: null };
  r.radio.push(msg);
  r.ver++;
  return msg;
}

// ---------- Team orders: team-mates swap places (legal, heard on the team radio) ----------
// A faster car right behind its team-mate: the team may tell the car ahead to let it by.
// Sometimes the driver refuses; a swap in a dangerous place becomes an incident.
function teamOrdersTick() {
  const r = race;
  if (r.session !== "RACE" || r.phase !== "RACE" || r.status !== "GREEN" || r.chequered) return;
  r.teamOrderLap = r.teamOrderLap || {};
  for (const b of r.cars) {
    const a = b.aheadCar;
    if (!a || a.team !== b.team || b.mode !== "RACE" || a.mode !== "RACE" || b.pit.state || a.pit.state || b.passing || a.passing) continue;
    if (b.gapAheadM > Math.max(20, b.speed * 1.0) || b.laps < 2 || b.laps !== a.laps) continue;
    if ((r.teamOrderLap[b.team] || -99) > b.laps - 12) continue;
    const faster = b.factorNow > a.factorNow * 1.004 || b.tyre.wear + 0.15 < a.tyre.wear;
    if (!faster || !chance(0.03)) continue;
    r.teamOrderLap[b.team] = b.laps;
    const refuse = chance(0.15);
    addRadio(a, "TEAM", a.team + " → car " + a.number + " (" + a.code + "): let car " + b.number + " (" + b.code + ") through, " +
      (b.tyre.wear + 0.15 < a.tyre.wear ? "the tyres are going off." : "the other car is faster."), { status: "INFO" });
    setTimeoutRace(rand(4, 9), () => {
      if (race !== r) return;
      if (refuse) {
        addRadio(a, "TEAM", "Car " + a.number + " (" + a.code + "): \"No. If that car is faster, it can pass me on track.\"", { status: "INFO" });
        return;
      }
      if (a.mode !== "RACE" || b.mode !== "RACE" || b.aheadCar !== a || a.pit.state || b.pit.state) return;
      addRadio(a, "TEAM", "Car " + a.number + " (" + a.code + "): \"Understood.\" – lets car " + b.number + " (" + b.code + ") by (" + locationName(r.track, a.s) + ").", { status: "INFO" });
      startPass(b, a);
      r.overtakes--; // a swap is not an overtake on track
      // a swap in a braking zone or a fast corner can be dangerous for the cars behind
      if (chance(0.04)) {
        const behind = r.cars.find(c => c.aheadCar === b && c.mode === "RACE" && c.gapAheadM < 40);
        if (behind) {
          makeIncident("OTHER", [a, behind], {
            offence: "Erratic driving (slowing down to let the team-mate by)", s: a.s,
            summary: a.code + " lifted suddenly to let " + b.code + " by; " + behind.code + " had to take avoiding action.",
            evidence: [["Team radio", "Team order to let car " + b.number + " by"], ["Speed drop of " + a.code, rand(40, 90).toFixed(0) + " km/h on the racing line"],
              [behind.code + " reaction", "Braked hard and went off line"]],
            statements: [[a.code, "The team told me to let him by, I did it as early as I could."], [behind.code, "He just stopped on the racing line."]],
            truth: { culprit: a.id, penalty: "REPRIMAND", points: 0, reason: "Letting a team-mate by is allowed, but not by slowing down suddenly on the racing line in front of other cars." }
          });
        }
      }
    });
  }
}

function radioTick() {
  const r = race;
  if (!r.radio || r.finished || r.phase === "PRE") return;
  teamOrdersTick();
  const L = r.track.length;
  const open = topic => r.radio.some(m => m.topic === topic && (m.status === "NEW" || m.status === "NOTED"));

  // 0. a complaint about an incident the Race Director has handled meanwhile is answered by that
  //    (decided, not investigated, under investigation) – it does not stay open in the list
  for (const m of r.radio) {
    if (m.kind !== "COMPLAINT" || !m.incId || (m.status !== "NEW" && m.status !== "NOTED")) continue;
    const inc = r.incidents.find(i => i.id === m.incId);
    if (inc && inc.status !== "NEW" && inc.status !== "NOTED") {
      m.status = inc.status === "NFI" ? "REJECTED" : inc.status === "DECIDED" ? "RESOLVED" : "INVESTIGATING";
      m.answeredAt = r.time;
      m.autoClosed = true;
    }
  }

  // 1. a real offence the Race Director has not looked at: the victim's team asks for an investigation
  for (const inc of r.incidents) {
    if (inc.radioAsked || inc.historic || inc.status !== "NEW" || r.time - inc.t < 50) continue;
    inc.radioAsked = true;
    if (!inc.truth || !inc.truth.culprit || inc.cars.length < 2 || !chance(0.6)) continue;
    const victim = carById(inc.cars.find(id => id !== inc.truth.culprit));
    const culprit = carById(inc.truth.culprit);
    if (!victim || !culprit) continue;
    addRadio(victim, "COMPLAINT", "Car " + victim.number + " (" + victim.code + "): we ask the stewards to look at car " + culprit.number +
      " (" + culprit.code + ") – " + inc.offence.toLowerCase() + " at " + inc.location + ".", { incId: inc.id, accused: culprit.id, valid: true });
  }

  // 2. complaints about clean racing (the Race Director should not punish everything)
  if (r.session === "RACE" && r.status === "GREEN" && chance(0.001 * r.level)) {
    const close = r.cars.filter(c => c.mode === "RACE" && !c.pit.state && c.aheadCar && c.gapAheadM < 12 && c.speed > 30);
    if (close.length) {
      const me = pick(close);
      const them = me.aheadCar;
      const what = pick(["moved under braking", "blocked us on the straight", "squeezed us towards the wall", "changed direction twice"]);
      addRadio(me, "COMPLAINT", "Car " + me.number + " (" + me.code + "): car " + them.number + " (" + them.code + ") " + what +
        " at " + locationName(r.track, me.s) + ". Please investigate!", { accused: them.id, valid: false, topic: "S" + Math.round(me.s / 50) });
    }
  }

  // 3. requests: something the Race Director should do
  const someone = () => pick(r.cars.filter(c => isRunning(c)));
  if (r.session === "RACE" && !r.wetDeclared && (r.weather.wetMax !== undefined ? r.weather.wetMax : r.weather.wet) > 0.35 && !open("WET") && chance(0.05)) {
    const c = someone();
    if (c) addRadio(c, "REQUEST", c.team + ": the track is getting wet – please declare a wet race.", { topic: "WET" });
  }
  for (const ob of r.obstacles) {
    if (ob.cleared || ob.crew || ob.radioAsked || r.time - ob.created < 20) continue;
    ob.radioAsked = true;
    const c = someone();
    if (c) addRadio(c, "REQUEST", c.team + ": " + ob.label + " at marshal post " + ob.sector + " – please send the marshals.", { topic: "OB" + ob.id });
  }
  if (r.session === "RACE" && !r.pitExitOpen && r.status !== "RED" && r.raceStart !== null && r.time - r.lastStart > 30 && !open("EXIT")) {
    const waiting = r.cars.find(c => (c.pitStart && c.pit.state === "HOLD") || (c.pit.state === "OUT" && c.mode === "RACE"));
    if (waiting) addRadio(waiting, "REQUEST", "Car " + waiting.number + " (" + waiting.code + ") is waiting at the red light – please open the pit exit.", { topic: "EXIT" });
  }

  // requests that are solved close themselves
  for (const m of r.radio) {
    if (m.kind !== "REQUEST" || (m.status !== "NEW" && m.status !== "NOTED")) continue;
    let solved = false;
    if (m.topic === "WET") solved = r.wetDeclared;
    else if (m.topic === "EXIT") solved = r.pitExitOpen;
    else if (m.topic && m.topic.startsWith("OB")) {
      const ob = r.obstacles.find(o => "OB" + o.id === m.topic);
      solved = !ob || ob.cleared || !!ob.crew;
    }
    if (solved) {
      m.status = "RESOLVED";
      m.answeredAt = r.time;
      r.ver++;
    }
  }
}

// The Race Director answers: "NOTE", "INVESTIGATE" or "REJECT". Returns an error text or null.
function answerRadio(id, answer) {
  const r = race;
  const m = r.radio.find(x => x.id === id);
  if (!m || (m.status !== "NEW" && m.status !== "NOTED")) return "Already answered.";
  m.answeredAt = r.time;
  const inc = m.incId ? r.incidents.find(i => i.id === m.incId) : null;
  if (answer === "NOTE") {
    m.status = "NOTED";
    if (inc && inc.status === "NEW") noteIncident(inc);
  } else if (answer === "REJECT") {
    m.status = "REJECTED";
    publish("FIA: " + (m.kind === "COMPLAINT" ? "THE COMPLAINT OF " + teamWord(m) + " WILL NOT BE INVESTIGATED" : "THE REQUEST OF " + teamWord(m) + " IS DECLINED"), "Stewards");
  } else if (answer === "INVESTIGATE") {
    if (m.kind !== "COMPLAINT") return "Only a complaint can be investigated.";
    m.status = "INVESTIGATING";
    if (inc) {
      if (inc.status === "NEW" || inc.status === "NOTED") investigateIncident(inc);
      return { openIncident: inc.id };
    }
    // a complaint about clean racing: the stewards look at it – the footage shows no offence
    const me = carById(m.carId);
    const them = carById(m.accused);
    if (!me || !them) return null;
    const complaint = makeIncident("COMPLAINT", [them, me], {
      offence: "Complaint by " + (m.team || "a team") + ": defending", s: me.s,
      truth: { culprit: null, penalty: "NFA", points: 0, reason: "The footage shows one move only and no change of direction under braking. Hard but fair racing – no further action." },
      summary: m.text,
      evidence: [
        ["Complaint", m.text],
        ["Steering " + them.code, "One defensive move before the braking zone, then the normal line"],
        ["Gap", rand(0.2, 0.6).toFixed(2) + " s between the cars"],
        ["Contact", "None"]
      ],
      statements: [[me.code, "He moved when I was already committed."], [them.code, "I defended once, that is allowed."]]
    });
    m.incId = complaint.id;
    investigateIncident(complaint);
    return { openIncident: complaint.id };
  }
  r.ver++;
  return null;
}

function teamWord(m) {
  return (m.team || "the team").toUpperCase();
}

function clearObstacle(ob) {
  const r = race;
  ob.cleared = true;
  ob.clearedAt = r.time;
  if (ob.carId) {
    const car = carById(ob.carId);
    if (car) {
      car.hidden = true;
      car.mode = "PARKED";
    }
  }
  const othersInSector = r.obstacles.some(o => !o.cleared && o.sector === ob.sector);
  if (ob.type === "MEDICAL") {
    addAlert("info", "Medical car: the driver has been taken to the medical centre (" + ob.label + ").", { s: ob.s, sector: ob.sector });
    scheduleMedicalCheck(ob);
  } else {
    addAlert("info", "Marshal post " + ob.sector + ": " + ob.label + " has been cleared." +
      (othersInSector ? "" : " Sector " + ob.sector + " is clear."), { s: ob.s, sector: ob.sector });
  }
  r.ver++;
}

// After the medical car: the FIA doctor checks the driver in the medical centre.
// The heavier the impact, the more likely the driver is not fit to continue.
function scheduleMedicalCheck(ob) {
  const r = race;
  const car = carById(ob.medicalCarId);
  if (!car) return;
  setTimeoutRace(rand(20, 60), () => {
    if (race !== r) return;
    const g = car.impactG || 40;
    const fit = !chance(clamp((g - 30) / 45, 0.05, 0.8));
    r.medical = r.medical || [];
    r.medical.push({ carId: car.id, driverId: car.driverId, g, fit });
    addAlert(fit ? "info" : "warn", "Medical centre: " + car.name + " (" + car.number + ") has been checked after the " + g + " g impact – " +
      (fit ? "declared FIT." : "declared NOT FIT to continue."), { carId: car.id });
    publish("MEDICAL: CAR " + car.number + " (" + car.code + ") DRIVER " + (fit ? "DECLARED FIT" : "NOT FIT TO CONTINUE – CHECKED BY THE FIA DOCTOR"), "Info");
  });
}

// A car drives past an obstacle: does something happen?
function obstacleRisk(car, ob, flag) {
  const r = race;
  if (!ob.onTrack || ob.type === "BARRIER") return;

  let factor = 1;
  if (r.status === "RED") factor = 0;
  else if (r.status === "SC" || r.status === "SC_ENDING") factor = 0.03;
  else if (r.status === "VSC" || r.status === "VSC_ENDING") factor = 0.05;
  else if (flag === "DOUBLE") factor = 0.15;
  else if (flag === "YELLOW") factor = 0.4;

  const neutral = factor <= 0.05;
  if (!neutral && !adequateMeasure(ob)) {
    ob.unsafePasses++;
    r.evalData.unsafePasses++;
  }

  const base = { DEBRIS: 0.012, CAR: 0.0025, OIL: 0.02 }[ob.type] || 0;
  if (!chance(base * factor * r.level)) return;

  if (ob.type === "DEBRIS") {
    r.evalData.debrisHits++;
    if (chance(0.5)) {
      car.damage.puncture = true;
      addAlert("warn", carLabel(car) + " ran over debris in sector " + ob.sector + " – puncture!", { carId: car.id, s: car.s });
    } else {
      car.damage.wing = true;
      addAlert("warn", carLabel(car) + " hit debris in sector " + ob.sector + " – front wing damage.", { carId: car.id, s: car.s });
    }
  } else if (ob.type === "OIL") {
    spinCar(car, cornerAt(r.track, car.s), "spun on the oil");
  } else if (ob.type === "CAR") {
    r.evalData.carHits++;
    addAlert("danger", "MAJOR ACCIDENT: " + carLabel(car) + " hit " + ob.label + " that was stopped on the track!",
      { carId: car.id, s: car.s });
    car.offTrackSide = 18;
    retireCar(car, "Hit a stopped car", { onTrack: true, crash: true });
  }
}


// =====================================================================
//  3. INCIDENTS
// =====================================================================
function makeIncident(type, cars, o) {
  const r = race;
  const s = o.s != null ? o.s : cars[0].s;
  const inc = {
    id: r.nextId++,
    type,
    offence: o.offence,
    t: r.time,
    lap: r.leaderLap,
    s: mod(s, r.track.length),
    location: o.location || locationName(r.track, s),
    cars: cars.map(c => c.id),
    status: "NEW",              // NEW, NOTED, INVESTIGATING, AFTER_RACE, NFI, DECIDED
    summary: o.summary || "",
    evidence: o.evidence || [],
    statements: o.statements || [],
    truth: r.session === "QUALI" ? qualiTruth(type, o.truth || null) : (o.truth || null), // { culprit, penalty, points, reason }
    historic: o.historic || null,
    decision: null,
    clip: null,
    clipAt: r.time + 5,
    lapOf: {}                   // lap number of every car at the moment of the incident (for "lap time deleted")
  };
  for (const c of cars) inc.lapOf[c.id] = c.laps + 1;
  r.incidents.push(inc);
  addAlert("warn", "New incident: " + incidentCars(inc) + " – " + inc.offence + " (" + inc.location + ").",
    { carId: cars[0].id, s: inc.s });
  r.ver++;
  return inc;
}

function incidentCars(inc) {
  return inc.cars.map(id => {
    const c = carById(id);
    return c ? c.number + " " + c.code : "#" + id;
  }).join(" / ");
}

// "TURN 4 INCIDENT INVOLVING CARS 7 (BER) AND 12 (ARA)"
function incidentHeadline(inc) {
  const cars = inc.cars.map(id => carById(id)).filter(Boolean);
  const list = cars.map(c => c.number + " (" + c.code + ")");
  const who = list.length === 1 ? "CAR " + list[0] : "CARS " + list.slice(0, -1).join(", ") + " AND " + list[list.length - 1];
  return inc.location.toUpperCase() + " INCIDENT INVOLVING " + who;
}

function pct(x) {
  return Math.round(x) + "%";
}

// ---------- Collision ----------
// opts.forceBlame: "ATTACKER", "DEFENDER", "RACING", "SPINNER", "STALLED"
// opts.light: only light contact (used for real historic incidents)
function createCollision(att, def, zone, opts) {
  const r = race;
  const corner = cornerAt(r.track, att.s);
  const position = r.order.indexOf(def) + 1;

  let blame = opts.forceBlame;
  if (!blame) {
    const wA = 0.4 + att.aggression * 0.35;
    const wD = 0.1 + def.aggression * 0.15;
    const wR = 0.3;
    const roll = random() * (wA + wD + wR);
    blame = roll < wA ? "ATTACKER" : roll < wA + wD ? "DEFENDER" : "RACING";
  }

  // ----- consequences -----
  const victim = blame === "DEFENDER" ? att : blame === "RACING" ? (chance(0.5) ? att : def) : def;
  const other = victim === att ? def : att;
  let severity = "minor";
  let consequence = "";
  const c = opts.light ? random() * 0.4 : random();

  if (blame === "STALLED") {
    severity = "major";
    const otherRetires = chance(0.4);
    retireCar(def, "Hit from behind while stalled on the grid", { onTrack: true, crash: true });
    if (otherRetires) retireCar(att, "Collision with a stalled car at the start", { onTrack: true, crash: true });
    else att.damage.wing = true;
    consequence = def.code + " retired" + (otherRetires ? ", " + att.code + " retired" : ", " + att.code + " front wing damage");
  } else if (c < 0.4) {
    victim.damage.wing = true;
    consequence = victim.code + " front wing damage, both continue";
    att.spin = Math.max(att.spin, 0);
  } else if (c < 0.65) {
    victim.damage.puncture = true;
    other.damage.wing = true;
    severity = "moderate";
    consequence = victim.code + " puncture, " + other.code + " front wing damage";
  } else if (c < 0.82) {
    victim.spin = rand(5, 9);
    victim.offTrackSide = 16;
    victim.damage.floor = Math.min(1, victim.damage.floor + 0.4);
    severity = "moderate";
    consequence = victim.code + " spun and lost several positions (floor damage)";
  } else if (c < 0.94) {
    severity = "major";
    victim.offTrackSide = 18;
    retireCar(victim, "Collision with " + other.code + " at " + corner.name, { onTrack: chance(0.35), crash: true });
    other.damage.wing = true;
    consequence = victim.code + " retired, " + other.code + " front wing damage";
  } else {
    severity = "major";
    att.offTrackSide = 18;
    def.offTrackSide = -18;
    retireCar(def, "Collision with " + att.code + " at " + corner.name, { onTrack: chance(0.5), crash: true });
    retireCar(att, "Collision with " + def.code + " at " + corner.name, { onTrack: chance(0.3), crash: true });
    consequence = "Both cars retired";
  }
  if (severity !== "minor" || chance(0.5)) {
    if (!r.obstacles.some(o => !o.cleared && o.type === "DEBRIS" && Math.abs(o.s - att.s) < 60)) {
      addObstacle({ type: "DEBRIS", s: att.s + 15, onTrack: true, required: rand(30, 80), label: "debris from the collision" });
    }
  }
  if (att.mode === "RACE" && att.spin <= 0) att.spin = rand(1.5, 3);
  if (def.mode === "RACE" && def.spin <= 0) def.spin = rand(1.5, 3);
  att.passing = null;
  def.passing = null;

  addAlert(severity === "major" ? "danger" : "warn",
    "CONTACT at " + corner.name + " between " + carLabel(att) + " and " + carLabel(def) + ". " + consequence + ".",
    { carId: att.id, s: att.s, sector: marshalSectorAt(r.track, att.s) });

  // ----- evidence that matches who is really to blame -----
  const evidence = [];
  const statements = [];
  let truth;
  const inside = chance(0.7);

  if (blame === "SPINNER") {
    const spinner = opts.spinner || def;
    const hitter = spinner === def ? att : def;
    evidence.push(["Situation", spinner.code + " lost control at " + corner.name + " and spun across the track"]);
    evidence.push(["Gap before the spin", (rand(0.3, 0.9)).toFixed(2) + " s between " + hitter.code + " and " + spinner.code]);
    evidence.push(["Yellow flag at the moment of contact", "No (the spin happened right in front of " + hitter.code + ")"]);
    evidence.push([hitter.code + " reaction", "Braked " + rand(0.3, 0.6).toFixed(2) + " s after the start of the spin – no time to avoid"]);
    evidence.push(["Consequence", consequence]);
    statements.push([hitter.code, "He spun right in front of me, there was nowhere to go."]);
    statements.push([spinner.code, "I lost the rear on the kerb, sorry."]);
    truth = { culprit: null, penalty: "NFA", points: 0,
      reason: "A driver losing control is not an offence on its own and the following driver could not avoid the car. No driver wholly or predominantly to blame." };
    return makeIncident("COLLISION", [hitter, spinner], {
      offence: "Collision after a spin", s: att.s, location: corner.name, evidence, statements, truth, historic: opts.historic,
      summary: hitter.code + " hit the spinning car of " + spinner.code + "."
    });
  }

  if (blame === "STALLED") {
    evidence.push(["Situation", def.code + " stalled on the grid, " + att.code + " started from further back"]);
    evidence.push(["Start aborted?", r.evalData.startAborted ? "Yes" : "No – the start went ahead with a stalled car"]);
    evidence.push([att.code + " visibility", "Cars in front blocked the view until " + rand(10, 25).toFixed(0) + " m before the stalled car"]);
    evidence.push(["Consequence", consequence]);
    statements.push([att.code, "The car in front of me moved left and suddenly he was there, standing still."]);
    statements.push([def.code, "The car stalled, I had my hands up."]);
    truth = { culprit: null, penalty: "NFA", points: 0,
      reason: "Unavoidable start accident. The driver behind could not see the stalled car. (Race Control should have aborted the start.)" };
    return makeIncident("COLLISION", [att, def], {
      offence: "Collision at the start", s: def.s, location: "the grid", evidence, statements, truth,
      summary: att.code + " hit the stalled car of " + def.code + " at the start."
    });
  }

  evidence.push(["Situation", att.code + " attacks " + def.code + (position > 0 ? " for P" + position : "") +
    " into " + corner.name + " on the " + (inside ? "inside" : "outside")]);

  let overlap;
  if (blame === "ATTACKER") overlap = rand(0, 30);
  else if (blame === "DEFENDER") overlap = rand(50, 90);
  else overlap = rand(35, 60);
  const overlapText = overlap >= 50 ? "alongside" : overlap >= 25 ? "level with the rear wheels of" : "behind the rear wheels of";
  evidence.push(["Overlap at turn-in", pct(overlap) + " – front axle of " + att.code + " " + overlapText + " " + def.code]);

  if (blame === "ATTACKER") {
    evidence.push(["Braking point " + att.code, rand(10, 22).toFixed(0) + " m later than on previous laps, front-left wheel locked"]);
    evidence.push(["Car control " + att.code, "Understeer – could not stop the car before the apex"]);
  } else {
    evidence.push(["Braking point " + att.code, rand(1, 6).toFixed(0) + " m later than on previous laps (normal for an overtake)"]);
    evidence.push(["Car control " + att.code, "Car under control, apex speed " + Math.round(rand(80, 140)) + " km/h"]);
  }

  if (blame === "DEFENDER") {
    evidence.push(["Defending " + def.code, "Moved " + rand(0.8, 1.6).toFixed(1) + " m towards " + att.code + " in the braking zone (second move)"]);
    evidence.push(["Space left at the apex", "About " + rand(0.1, 0.5).toFixed(1) + " car widths"]);
  } else if (blame === "ATTACKER") {
    evidence.push(["Defending " + def.code, "One defensive move before the braking zone, then normal line"]);
    evidence.push(["Space left at the apex", "More than one car width"]);
  } else {
    evidence.push(["Defending " + def.code, "Normal racing line, no change of direction under braking"]);
    evidence.push(["Space left at the apex", "About " + rand(0.7, 1.0).toFixed(1) + " car widths – very tight"]);
  }
  evidence.push(["Consequence", consequence]);

  if (blame === "ATTACKER") {
    statements.push([att.code, "I was alongside, he just closed the door on me."]);
    statements.push([def.code, "He came from very far back, locked up and hit me."]);
    truth = { culprit: att.id, penalty: severity === "major" ? "10S" : "5S", points: severity === "major" ? 3 : 2,
      reason: "The overtaking car was not sufficiently alongside (front axle not at least level with the other car's mirrors at the apex) and locked up. " +
              att.code + " is wholly or predominantly to blame." };
  } else if (blame === "DEFENDER") {
    statements.push([att.code, "I was clearly alongside and he moved under braking."]);
    statements.push([def.code, "I was defending my line, I didn't see him there."]);
    truth = { culprit: def.id, penalty: severity === "major" ? "10S" : "5S", points: 2,
      reason: "The defending car moved in the braking zone and did not leave a car's width while the attacker had a significant overlap. " +
              def.code + " is predominantly to blame." };
  } else {
    statements.push([att.code, "I had the inside, we touched, that's racing."]);
    statements.push([def.code, "Hard but fair, we just ran out of space."]);
    truth = { culprit: null, penalty: "NFA", points: 0,
      reason: "Both drivers had a fair share of the corner. No driver was wholly or predominantly to blame – a racing incident." };
  }

  return makeIncident("COLLISION", [att, def], {
    offence: "Causing a collision", s: att.s, location: corner.name, evidence, statements, truth, historic: opts.historic,
    summary: "Contact between " + att.code + " and " + def.code + " at " + corner.name + "."
  });
}

// ---------- How many offences happen? ----------
// race.offenceScale < 1 (championship mode): only this share of the minor
// offences (speeding, impeding, blue flags, forcing off, delta times ...)
// happens at all. Physical incidents (collisions, spins, crashes) are not affected.
function offenceSkipped() {
  return race.offenceScale < 1 && random() > race.offenceScale;
}

// ---------- Forcing off / leaving the track and gaining an advantage ----------
function racecraftIncident(att, def, forced) {
  if (!(forced && forced.historic) && offenceSkipped()) return null; // championship: realistic number of offences
  const r = race;
  const corner = cornerAt(r.track, att.s);
  const kind = forced ? forced.kind : (chance(0.5) ? "FORCING_OFF" : "LEAVING_TRACK");

  if (kind === "FORCING_OFF") {
    const guilty = forced ? forced.guilty : chance(0.6);
    const overlap = guilty ? rand(45, 85) : rand(5, 35);
    att.spin = rand(1, 2);
    att.offTrackSide = 16;
    const truth = guilty
      ? { culprit: def.id, penalty: "5S", points: 2, reason: "The attacking car had a significant overlap and was entitled to racing room. " + def.code + " did not leave space and forced " + att.code + " off the track." }
      : { culprit: null, penalty: "NFA", points: 0, reason: att.code + " was not sufficiently alongside to be entitled to space. No further action." };
    return makeIncident("FORCING_OFF", [def, att], {
      offence: "Forcing another driver off the track", s: att.s, location: corner.name, truth, historic: forced && forced.historic,
      summary: att.code + " went off track at " + corner.name + " while trying to pass " + def.code + ".",
      evidence: [
        ["Situation", att.code + " attempts to pass " + def.code + " around the outside of " + corner.name],
        ["Overlap at the apex", pct(overlap) + " (" + (overlap >= 50 ? "front axle at least level with the mirrors" : "not alongside") + ")"],
        ["Steering " + def.code, guilty ? "Kept turning to the track edge on the exit, no space left" : "Normal line, used the full width of the track"],
        ["Result", att.code + " with all four wheels off the track, lost " + rand(0.4, 1.2).toFixed(1) + " s"]
      ],
      statements: [[att.code, "He pushed me off, I was alongside."], [def.code, "I just took my normal line."]]
    });
  }

  // leaving the track and gaining a lasting advantage
  const gaveBack = forced ? forced.gaveBack : chance(0.35);
  startPass(att, def);
  if (gaveBack) {
    att.slowDown = 4;
    setTimeoutRace(4, () => {
      if (def.mode === "RACE" && att.mode === "RACE") startPass(def, att);
    });
  }
  const truth = gaveBack
    ? { culprit: null, penalty: "NFA", points: 0, reason: att.code + " gained an advantage off track but gave the position back straight away. No further action." }
    : { culprit: att.id, penalty: "5S", points: 2, reason: att.code + " completed the overtake with all four wheels off the track and kept the position: a lasting advantage." };
  return makeIncident("LEAVING_TRACK", [att, def], {
    offence: "Leaving the track and gaining a lasting advantage", s: att.s, location: corner.name, truth,
    historic: forced && forced.historic,
    summary: att.code + " passed " + def.code + " off the track at " + corner.name + ".",
    evidence: [
      ["Situation", att.code + " was behind " + def.code + " into " + corner.name],
      ["Off track", "All four wheels beyond the white line, cut the corner"],
      ["Time gained off track", rand(0.3, 0.8).toFixed(2) + " s"],
      ["Position given back", gaveBack ? "Yes – within " + rand(2, 5).toFixed(0) + " seconds" : "No"]
    ],
    statements: [[att.code, gaveBack ? "I gave the place back right away." : "He pushed me wide, I had nowhere to go."],
                 [def.code, "He went off and came back in front."]]
  });
}

// small timer helper that works in race time
function setTimeoutRace(seconds, action) {
  race.timers = race.timers || [];
  race.timers.push({ at: race.time + seconds, action });
}

function runRaceTimers() {
  const r = race;
  if (!r.timers || r.timers.length === 0) return;
  let fired = false;
  for (const t of r.timers) {
    if (!t.done && r.time >= t.at) {
      t.done = true;
      fired = true;
      t.action();
    }
  }
  if (fired) r.timers = r.timers.filter(t => !t.done);
}

// ---------- Pit lane speeding ----------
function pitSpeedingIncident(car, kmh, historic) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  const limitKmh = race.pitLimitKmh || 80;
  return makeIncident("PIT_SPEEDING", [car], {
    offence: "Speeding in the pit lane", s: race.track.pit.boxes[0], location: "the pit lane",
    summary: carLabel(car) + " was too fast in the pit lane.",
    evidence: [
      ["Speed trap (pit lane)", kmh.toFixed(1) + " km/h – limit " + limitKmh.toFixed(1) + " km/h"],
      ["Over the limit by", (kmh - limitKmh).toFixed(1) + " km/h"],
      ["Pit limiter", kmh - limitKmh < 1 ? "Engaged, but released a little too early before the exit line" : "Engaged " + rand(5, 20).toFixed(0) + " m after the speed line"]
    ],
    statements: [[car.code, "The limiter was on, I don't know what happened."]],
    truth: { culprit: car.id, penalty: "5S", points: 0, reason: "Any speed above " + limitKmh + " km/h in the pit lane is an offence. In the race the standard penalty is a 5 second time penalty." },
    historic
  });
}

// ---------- Unsafe release ----------
function unsafeReleaseIncident(car, other, contact, historic) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  return makeIncident("UNSAFE_RELEASE", [car, other], {
    offence: "Unsafe release", s: car.s, location: "the pit lane",
    summary: carLabel(car) + " was released into the path of " + carLabel(other) + ".",
    evidence: [
      ["Distance to " + other.code + " at release", rand(3, 12).toFixed(1) + " m"],
      [other.code + " reaction", contact ? "Could not avoid – wheel-to-wheel contact in the fast lane" : "Had to brake hard / take avoiding action"],
      ["Contact", contact ? "Yes" : "No"],
      ["Note", "The team is also liable for a fine (usually €5,000)"]
    ],
    statements: [[other.code, "He was released right into me!"]],
    truth: { culprit: car.id, penalty: contact ? "10S" : "5S", points: 0, reason: "The car was released when it was not safe to do so" + (contact ? " and there was contact." : ".") },
    historic
  });
}

// ---------- Jump start ----------
function jumpStartIncident(car, historic) {
  const moved = car.jump || rand(0.3, 1.5);
  const big = moved > 0.8;
  return makeIncident("JUMP_START", [car], {
    offence: "False start", s: car.slotS, location: "the grid",
    summary: carLabel(car) + " moved before the lights went out.",
    evidence: [
      ["Start transponder", "Movement detected " + rand(0.05, 0.25).toFixed(2) + " s before lights out"],
      ["Distance moved", moved.toFixed(2) + " m"],
      ["Stopped again before lights out", big ? "No" : "Yes"]
    ],
    statements: [[car.code, "The car crept forward, I had the clutch at the bite point."]],
    truth: { culprit: car.id, penalty: big ? "10S" : "5S", points: 0, reason: "The transponder detected movement before the start signal. " + (big ? "Clear advantage gained." : "Small movement, car stopped again.") },
    historic
  });
}

// ---------- Blue flags ----------
function blueFlagIncident(car, follower, held, historic) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  const big = held > 14 || chance(0.6);
  return makeIncident("BLUE_FLAGS", [car, follower], {
    offence: "Ignoring blue flags", s: car.s,
    summary: carLabel(car) + " held up the faster car " + carLabel(follower) + ".",
    evidence: [
      ["Time held up behind", held.toFixed(0) + " s"],
      ["Blue flags shown", (big ? 3 + randInt(1, 3) : 2) + " marshal posts and the light panels"],
      ["Time lost by " + follower.code, rand(0.6, 2.2).toFixed(1) + " s"],
      ["Moment " + car.code + " moved over", big ? "Only after " + held.toFixed(0) + " s" : "At the first safe place after 2 flags"]
    ],
    statements: [[follower.code, "He completely ignored the blue flags!"], [car.code, "I was in a fight myself, I let him by as soon as I could."]],
    truth: big
      ? { culprit: car.id, penalty: "5S", points: 2, reason: "The lapped car ignored more than three blue flags and held up the faster car." }
      : { culprit: car.id, penalty: "REPRIMAND", points: 0, reason: "Slow to let the faster car by, but not three blue flags. A reprimand or warning is enough." },
    historic
  });
}

// ---------- Yellow / SC / VSC offences ----------
function overtakeUnderYellowIncident(att, victim, sectorIndex, historic) {
  const flag = shownFlag(sectorIndex);
  const gaveBack = chance(0.3);
  if (gaveBack) {
    setTimeoutRace(4, () => {
      if (victim.mode === "RACE" && att.mode === "RACE") startPass(victim, att);
    });
  }
  return makeIncident("YELLOW_FLAG", [att, victim], {
    offence: "Overtaking under " + (flag === "DOUBLE" ? "double " : "") + "yellow flags", s: att.s,
    summary: att.code + " passed " + victim.code + " in sector " + (sectorIndex + 1) + " (" + (flag === "DOUBLE" ? "double yellow" : "yellow") + ").",
    evidence: [
      ["Flag in sector " + (sectorIndex + 1), flag === "DOUBLE" ? "Double yellow" : "Single yellow"],
      ["Overtake completed", "Inside the yellow flag zone"],
      ["Position given back", gaveBack ? "Yes, within the same lap" : "No"]
    ],
    statements: [[att.code, gaveBack ? "I saw the flag late and gave the place back." : "He slowed down a lot, I could not avoid passing him."]],
    truth: gaveBack
      ? { culprit: null, penalty: "NFA", points: 0, reason: "The position was given back immediately, so no advantage was gained." }
      : { culprit: att.id, penalty: flag === "DOUBLE" ? "10S" : "5S", points: 2, reason: "Overtaking under yellow flags is not allowed." },
    historic
  });
}

function doubleYellowIncident(car, sectorIndex, historic) {
  const slower = rand(0.5, 2.5);
  return makeIncident("YELLOW_FLAG", [car], {
    offence: "Failing to slow for double yellow flags", s: car.s,
    summary: carLabel(car) + " did not slow down enough in sector " + (sectorIndex + 1) + ".",
    evidence: [
      ["Flag in sector " + (sectorIndex + 1), "Double yellow (be prepared to stop)"],
      ["Mini-sector time", "Only " + slower.toFixed(1) + "% slower than the driver's best lap"],
      ["Throttle lift", rand(0, 0.2).toFixed(2) + " s"]
    ],
    statements: [[car.code, "I lifted, I don't know what else they want."]],
    truth: { culprit: car.id, penalty: "10S", points: 3, reason: "Under double yellow flags a driver must slow down significantly and be prepared to stop." },
    historic
  });
}

// measured: { delta, segs, sector } from the live delta check (engine.js checkNeutralDelta)
function vscDeltaIncident(car, sectorIndex, historic, measured) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  const delta = measured ? measured.delta : rand(0.1, 0.9);
  const segs = measured ? measured.segs : delta > 0.4 ? 3 : 1;
  return makeIncident("VSC_DELTA", [car], {
    offence: "Exceeding the VSC delta time", s: car.s,
    summary: carLabel(car) + " was faster than allowed under the VSC.",
    evidence: [
      ["Delta time", "-" + delta.toFixed(2) + " s below the minimum time (worst value" + (measured ? ", first in marshal sector " + measured.sector : " in marshal sector " + (sectorIndex + 1)) + ")"],
      ["Number of segments below the minimum time", String(segs)]
    ],
    statements: [[car.code, "The delta on my dash was positive the whole time."]],
    truth: delta > (measured ? 0.3 : 0.4)
      ? { culprit: car.id, penalty: "5S", points: 1, reason: "The driver was clearly under the VSC minimum time." }
      : { culprit: car.id, penalty: "REPRIMAND", points: 0, reason: "A small and short deviation from the VSC delta – a reprimand is usual." },
    historic
  });
}

function safetyCarOvertakeIncident(att, victim, historic) {
  const gaveBack = chance(0.3);
  startPass(att, victim);
  if (gaveBack) setTimeoutRace(5, () => { if (victim.mode === "RACE" && att.mode === "RACE") startPass(victim, att); });
  return makeIncident("SC_INFRINGEMENT", [att, victim], {
    offence: "Overtaking under the Safety Car", s: att.s,
    summary: att.code + " passed " + victim.code + " while the Safety Car was out.",
    evidence: [
      ["Track status", "SAFETY CAR"],
      ["Overtake", att.code + " passed " + victim.code + " at " + locationName(race.track, att.s)],
      ["Position given back", gaveBack ? "Yes" : "No"]
    ],
    statements: [[att.code, gaveBack ? "I got a run and gave the place back." : "He braked suddenly, I could not avoid passing."]],
    truth: gaveBack
      ? { culprit: null, penalty: "NFA", points: 0, reason: "Position given back immediately." }
      : { culprit: att.id, penalty: "10S", points: 2, reason: "Overtaking under the Safety Car is forbidden." },
    historic
  });
}

// ---------- Pit lane offences ----------
function pitEntryClosedIncident(car, historic) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  return makeIncident("PIT_ENTRY", [car], {
    offence: "Entering the pit lane while it was closed", s: race.track.pit.entry, location: "the pit entry",
    summary: carLabel(car) + " entered the closed pit lane.",
    evidence: [["Pit entry status", "CLOSED (red light, message sent)"], ["Reason for the stop", "Tyre change (no damage)"]],
    statements: [[car.code, "The team called me in, we didn't see the message."]],
    truth: { culprit: car.id, penalty: "SG10", points: 0, reason: "Entering the closed pit lane without an emergency is punished with a 10 second stop/go penalty." },
    historic
  });
}

// Practice starts (qualifying / practice): the event notes say where they are allowed.
// A car leaving the pit lane sometimes does one in the wrong place – a reprimand.
const PRACTICE_START_RISK = { PIT_EXIT: 0.006, AFTER_LIGHT: 0.003, NONE: 0.012 };
function practiceStartCheck(car) {
  const r = race;
  const rule = (r.eventNotes && r.eventNotes.practiceStarts) || "PIT_EXIT";
  if (!chance(PRACTICE_START_RISK[rule] * r.level)) return null;
  if (offenceSkipped()) return null;
  const where = rule === "NONE" ? "after the pit exit" : rule === "PIT_EXIT" ? "on the track after the pit exit, in the racing line" : "on the racing line before the pit exit light";
  return makeIncident("PRACTICE_START", [car], {
    offence: "Practice start in a non-designated area", s: r.track.pit.exit + 80, location: "the pit exit",
    summary: carLabel(car) + " carried out a practice start " + where + ".",
    evidence: [["Event notes", "Practice starts " + (PRACTICE_START_TEXT[rule] || "only at the end of the pit exit")], ["Onboard camera", "Full-throttle start from standstill " + where]],
    statements: [[car.code, "I thought it was allowed there, the track behind me was clear."]],
    truth: { culprit: car.id, penalty: "REPRIMAND", points: 0, reason: "Practice starts are only allowed where the event notes say. A practice start in another place is usually punished with a reprimand." }
  });
}

function pitExitLineIncident(car, historic) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  return makeIncident("PIT_EXIT", [car], {
    offence: "Crossing the white line at the pit exit", s: race.track.pit.exit, location: "the pit exit",
    summary: carLabel(car) + " crossed the line at the pit exit.",
    evidence: [["Onboard camera", "Left wheels crossed the solid white line by " + rand(0.2, 0.6).toFixed(1) + " m"]],
    statements: [[car.code, "Cold tyres, the car stepped out a little."]],
    truth: { culprit: car.id, penalty: "5S", points: 1, reason: "Any part of the car crossing the pit exit line is an offence." },
    historic
  });
}

// ---------- Unsafe rejoin ----------
function unsafeRejoinIncident(car, other, historic) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  const evasive = chance(0.6);
  return makeIncident("UNSAFE_REJOIN", [car, other], {
    offence: "Unsafe rejoin after leaving the track", s: car.s,
    summary: carLabel(car) + " rejoined the track in front of " + carLabel(other) + ".",
    evidence: [
      ["Closing speed of " + other.code, Math.round(rand(60, 140)) + " km/h"],
      [other.code + " reaction", evasive ? "Had to brake and swerve to avoid a collision" : "Small lift, no evasive action"],
      ["Distance at rejoin", (evasive ? rand(10, 25) : rand(40, 80)).toFixed(0) + " m"]
    ],
    statements: [[other.code, evasive ? "He came back right in front of me, very dangerous." : "No problem."]],
    truth: evasive
      ? { culprit: car.id, penalty: "5S", points: 2, reason: "The driver rejoined unsafely and forced another driver to take evasive action." }
      : { culprit: null, penalty: "NFA", points: 0, reason: "The rejoin did not endanger the other car." },
    historic
  });
}

// ---------- Failing to follow the Race Director's instructions ----------
// variant "MAX_DELTA": qualifying – a car on an out lap / in lap was slower than the maximum
//                      delta time (driving too slowly to create a gap is dangerous)
// variant "SC_DELTA":  race – a car under the Safety Car was faster than the SC delta time
// measured (SC_DELTA): { delta, segs, sector } from the live delta check (engine.js checkNeutralDelta)
function rdInstructionIncident(cars, variant, historic, measured) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  const car = cars[0];
  const list = cars.map(c => c.code).join(", ");
  let evidence;
  let truth;
  let summary;
  let offence;

  if (variant === "SC_DELTA") {
    const delta = measured ? measured.delta : rand(0.2, 1.6);
    const limit = measured ? 0.5 : 0.8;
    offence = "Failing to follow the Race Director's instructions – Safety Car delta time";
    summary = list + " did not respect the Safety Car delta time.";
    evidence = [
      ["Track status", "SAFETY CAR"],
      ["Race Director's instruction", "Stay above the Safety Car delta time until the Safety Car line"],
      ["Delta time of " + car.code, "-" + delta.toFixed(2) + " s (faster than allowed, worst value) from marshal sector " + (measured ? measured.sector : marshalSectorAt(race.track, car.s))],
      ["Segments below the minimum time", measured ? String(measured.segs) : "–"],
      ["Advantage", delta > limit ? "Closed up about " + delta.toFixed(1) + " s on the queue" : "None measurable"]
    ];
    truth = delta > limit
      ? { culprit: car.id, penalty: "5S", points: 1, reason: "The driver clearly went faster than the Safety Car delta time and gained time on the queue." }
      : { culprit: car.id, penalty: "REPRIMAND", points: 0, reason: "A small and short deviation from the Safety Car delta – a reprimand is usual." };
  } else {
    const over = rand(0.4, 4.5);
    const affected = chance(0.35);
    const lap = car.q.phase === "COOL" ? "In lap (cool-down)" : "Out lap";
    offence = "Failing to follow the Race Director's instructions – maximum delta time";
    summary = list + " drove slower than the maximum delta time on a slow lap.";
    evidence = [
      ["Race Director's instruction", "Maximum delta time between Safety Car line 1 and Safety Car line 2 on every lap (event notes)"],
      ["Lap of " + car.code, lap],
      ["Maximum delta exceeded by", "+" + over.toFixed(2) + " s"],
      ["Reason given by the team", pick(["Traffic ahead – creating a gap", "Cooling the tyres", "Car ahead slowed down"])],
      ["Other cars affected", affected ? "Yes – a car on a push lap had to pass on the racing line" : "No"]
    ];
    if (over > 2.5 && affected) {
      truth = { culprit: car.id, penalty: "REPRIMAND", points: 0, quali: true, reason: "The car was clearly slower than the maximum delta time and other drivers were affected. A reprimand is the usual decision." };
    } else {
      truth = { culprit: null, penalty: "NFA", points: 0, quali: true, reason: "The delta was only exceeded slightly or for a good reason (traffic) and no other driver was put at risk. No further action – like most real cases." };
    }
  }

  return makeIncident("RD_INSTRUCTIONS", cars, { offence, s: car.s, summary, evidence, truth, historic,
    statements: [[car.code, variant === "SC_DELTA" ? "My dash showed a positive delta." : "There was traffic in front, I had to back off."]] });
}

// ---------- Defending: more than one change of direction / moving under braking ----------
function defendingIncident(def, att, guilty, historic) {
  if (!(historic) && offenceSkipped()) return null; // championship: realistic number of offences
  return makeIncident("DEFENDING", [def, att], {
    offence: "More than one change of direction / moving under braking", s: def.s, historic,
    summary: def.code + " defended against " + att.code + " at " + locationName(race.track, def.s) + ".",
    evidence: [
      ["Moves by " + def.code, guilty ? "Two changes of direction on the straight, the second " + rand(0.5, 1.2).toFixed(1) + " m towards " + att.code : "One move to the inside, then held the line"],
      ["Move in the braking zone", guilty ? "Yes – " + rand(0.3, 0.8).toFixed(1) + " m after braking started" : "No"],
      [att.code + " reaction", guilty ? "Had to brake / swerve to avoid contact" : "Stayed on his line"]
    ],
    statements: [[att.code, "He moved twice, that's dangerous at this speed."], [def.code, "One move, that's allowed."]],
    truth: guilty
      ? { culprit: def.id, penalty: "5S", points: 1, reason: "A driver may make only one change of direction to defend, and must not move under braking." }
      : { culprit: null, penalty: "NFA", points: 0, reason: "Only one defensive move before the braking zone. Allowed." }
  });
}

// ---------- Failure to serve a penalty ----------
function checkPenaltyDeadline(car) {
  const p = car.pen;
  const pending = p.dt || p.sg;
  if (!pending || p.failedServe) return;
  if (isNeutralised()) pending.deadline++;
  if (car.laps > pending.deadline) {
    p.failedServe = true;
    makeIncident("FAILED_SERVE", [car], {
      offence: "Failing to serve a " + (p.dt ? "drive-through" : "stop/go") + " penalty", s: car.s,
      summary: carLabel(car) + " did not serve the penalty within three laps.",
      evidence: [["Penalty notified on lap", String(pending.lap)], ["Laps completed since", String(car.laps - pending.lap)]],
      truth: { culprit: car.id, penalty: "DSQ", points: 0, reason: "A drive-through or stop/go penalty must be served within three laps, otherwise the car is shown the black flag." }
    });
  }
}

// ---------- Real incidents of a historic race ----------
function createHistoricIncident(inj) {
  const cars = inj.cars.map(carById).filter(Boolean);
  if (cars.length === 0) return;
  const culprit = inj.real.culprit ? carById(inj.real.culprit) : null;
  const historic = { text: inj.text, decision: inj.real.decisionText || "No decision was published.", code: inj.real.code };
  const nfa = inj.real.code === "NFA";
  const other = culprit ? cars.find(c => c !== culprit) : cars[1];
  const main = culprit || cars[0];
  let inc = null;

  if (inj.type === "COLLISION" && cars.length >= 2) {
    inc = createCollision(main, other || cars[1], "BRAKING", { forceBlame: nfa || !culprit ? "RACING" : "ATTACKER", light: true, historic });
  } else if (inj.type === "FORCING_OFF" && cars.length >= 2) {
    const victim = cars.find(c => c !== main) || cars[1];
    inc = racecraftIncident(victim, main, { kind: "FORCING_OFF", guilty: !!culprit && !nfa, historic });
  } else if (inj.type === "LEAVING_TRACK") {
    const victim = cars.find(c => c !== main) || main;
    if (victim !== main) inc = racecraftIncident(main, victim, { kind: "LEAVING_TRACK", gaveBack: nfa, historic });
  } else if (inj.type === "PIT_SPEEDING") {
    inc = pitSpeedingIncident(main, rand(80.4, 84), historic);
  } else if (inj.type === "UNSAFE_RELEASE" && cars.length >= 1) {
    inc = unsafeReleaseIncident(main, other || pick(race.cars.filter(c => c !== main)), false, historic);
  } else if (inj.type === "JUMP_START") {
    inc = jumpStartIncident(main, historic);
  } else if (inj.type === "BLUE_FLAGS") {
    inc = blueFlagIncident(main, other || pick(race.cars.filter(c => c !== main)), rand(10, 20), historic);
  } else if (inj.type === "UNSAFE_REJOIN") {
    inc = unsafeRejoinIncident(main, other || pick(race.cars.filter(c => c !== main)), historic);
  } else if (inj.type === "TRACK_LIMITS_REPEAT") {
    inc = trackLimitsRepeatIncident(main, historic);
  } else if (inj.type === "PIT_EXIT") {
    inc = pitExitLineIncident(main, historic);
  } else if (inj.type === "IMPEDING" && cars.length >= 2) {
    inc = impedingIncident(main, other || cars[1], rand(2, 5), historic);
  } else if (inj.type === "YELLOW_FLAG") {
    const sector = marshalSectorAt(race.track, main.s) - 1;
    inc = race.session === "QUALI" ? qualiYellowIncident(main, sector, "DOUBLE", historic) : doubleYellowIncident(main, sector, historic);
  } else if (inj.type === "RD_INSTRUCTIONS") {
    inc = rdInstructionIncident(cars, race.session === "QUALI" ? "MAX_DELTA" : "SC_DELTA", historic);
  } else if (inj.type === "DEFENDING" && cars.length >= 2) {
    inc = defendingIncident(main, other || cars[1], !nfa && !!culprit, historic);
  }

  if (!inc) {
    inc = makeIncident("OTHER", cars, {
      offence: titleCase(inj.reason || "Incident"),
      summary: "Incident reported by race control during the real race.",
      evidence: [["Source", "Real race control message"], ["Message", inj.text]]
    });
  }
  // the real decision is the reference answer
  inc.historic = historic;
  if (inj.real.code) {
    inc.truth = {
      culprit: inj.real.code === "NFA" ? null : (inj.real.culprit || null),
      penalty: inj.real.code,
      points: inc.truth && inc.truth.points || 0,
      reason: "Real stewards' decision: " + historic.decision
    };
  } else {
    inc.truth = null;
  }
}

function titleCase(text) {
  return text.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
}


// =====================================================================
//  4. TRACK LIMITS
// =====================================================================
function createTrackLimits(car, corner, opts) {
  const r = race;
  const violation = opts.real ? true : chance(0.88);
  // how far the car was beyond the white line (m): + = all four wheels off, ≤ 0 = still touching the line
  const beyond = violation ? Math.round(rand(0.2, 1.3) * 10) / 10 : -Math.round(rand(0.05, 0.3) * 100) / 100;
  const item = {
    id: r.nextId++, carId: car.id, lap: car.laps + 1, corner: corner.name, cornerNo: corner.number, t: r.time,
    s: mod(corner.apex + 35, r.track.length), // the exit of the corner
    status: "NEW", violation, beyond,
    evidence: violation
      ? "All four wheels beyond the white line at the exit of " + corner.name + " (" + beyond.toFixed(1) + " m)"
      : "Right-side wheels ON the white line – part of the car still touching the track",
    real: opts.real || null,
    clip: null, clipAt: r.time + 3 // the replay: 5 s before to 3 s after (engine.js updateClips)
  };
  r.trackLimits.push(item);
  r.ver++;
  return item;
}

function trackLimitsRepeatIncident(car, historic) {
  const count = Math.max(car.tlStrikes, 4);
  return makeIncident("TRACK_LIMITS_REPEAT", [car], {
    offence: "Repeatedly leaving the track (track limits)", s: car.s,
    summary: carLabel(car) + " exceeded the track limits " + count + " times.",
    evidence: [
      ["Lap times deleted", String(count)],
      ["Black and white flag shown", car.bwShown ? "Yes" : "No"]
    ],
    truth: { culprit: car.id, penalty: count >= 8 ? "10S" : "5S", points: 0, reason: "After a black and white flag, the next track limits offence is punished with a 5 second time penalty (10 s after the 8th)." },
    historic
  });
}


// =====================================================================
//  5. PENALTIES
// =====================================================================
function penaltyText(code) {
  if (code === "5S") return "5 SECOND TIME PENALTY";
  if (code === "10S") return "10 SECOND TIME PENALTY";
  if (code === "DT") return "DRIVE THROUGH PENALTY";
  if (code === "SG10") return "10 SECOND STOP/GO PENALTY";
  if (code === "DSQ") return "DISQUALIFICATION";
  if (code === "REPRIMAND") return "REPRIMAND (DRIVING)";
  if (code === "WARNING") return "WARNING";
  if (code === "FINE") return "FINE";
  if (code === "DELETE_LAP") return "LAP TIME DELETED";
  if (code === "GRID3") return "3 PLACE GRID PENALTY";
  if (code === "GRID5") return "5 PLACE GRID PENALTY";
  if (code === "GRID10") return "10 PLACE GRID PENALTY";
  if (code === "BACK") return "REQUIRED TO START FROM THE BACK OF THE GRID";
  return "NO FURTHER ACTION";
}

function applyPenalty(car, code, points, reason, inc) {
  const r = race;
  const lapsLeft = r.totalLaps - car.laps;
  const over = r.finished || car.finished || car.status !== "RUNNING";
  const entry = { id: r.nextId++, carId: car.id, code, points, reason, t: r.time, lap: r.leaderLap, served: false, note: "" };
  car.pen.points += points;

  if (code === "FINE") {
    entry.served = true;
    entry.note = "fine for the team";
  } else if (code === "DELETE_LAP") {
    const lapNumber = inc && inc.lapOf ? inc.lapOf[car.id] : car.laps;
    deleteLapByNumber(car, lapNumber);
    entry.served = true;
    entry.note = "lap " + lapNumber + " deleted";
  } else if (code === "GRID3" || code === "GRID5" || code === "GRID10") {
    car.pen.grid = (car.pen.grid || 0) + Number(code.slice(4));
    entry.served = true;
    entry.note = "applied to the starting grid of the race";
  } else if (code === "BACK") {
    car.pen.back = true;
    entry.served = true;
    entry.note = "starts from the back of the grid";
  } else if (code === "WARNING") {
    car.pen.warnings++;
    entry.served = true;
  } else if (code === "REPRIMAND") {
    car.pen.reprimands++;
    entry.served = true;
    if (car.pen.reprimands >= 3) entry.note = "3rd reprimand – 10 place grid penalty at the next event";
  } else if (code === "5S" || code === "10S") {
    const seconds = code === "5S" ? 5 : 10;
    if (over) {
      car.pen.post += seconds;
      entry.served = true;
      entry.note = "added to the race time";
    } else {
      car.pen.time += seconds;
      entry.seconds = seconds;
      entry.note = "to be served at the next pit stop (or added to the race time)";
    }
  } else if (code === "DT" || code === "SG10") {
    if (over || lapsLeft <= 3) {
      const seconds = code === "DT" ? 20 : 30;
      car.pen.post += seconds;
      entry.served = true;
      entry.note = "issued in the last laps – converted into +" + seconds + " s";
    } else {
      const pending = { lap: car.laps, deadline: car.laps + 3, entry };
      if (code === "DT") car.pen.dt = pending;
      else car.pen.sg = pending;
      entry.note = "must be served within 3 laps";
    }
  } else if (code === "DSQ") {
    disqualify(car);
    entry.served = true;
  }
  car.pen.list.push(entry);
  r.penaltyLog.push(entry);
  if (car.pen.points >= 12) addAlert("warn", carLabel(car) + " has reached " + car.pen.points + " penalty points – race ban.", { carId: car.id });
  r.ver++;
  return entry;
}

function servePenalty(car, kind, seconds) {
  const r = race;
  if (kind === "TIME") {
    car.pen.time = Math.max(0, car.pen.time - seconds);
    let left = seconds;
    for (const e of car.pen.list) {
      if (!e.served && e.seconds && left >= e.seconds) {
        e.served = true;
        e.note = "served during the pit stop";
        left -= e.seconds;
      }
    }
    publish(carLabel(car) + " SERVED " + seconds + " SECOND TIME PENALTY", "Stewards");
  } else {
    const pending = kind === "DT" ? car.pen.dt : car.pen.sg;
    if (pending) {
      pending.entry.served = true;
      pending.entry.note = "served on lap " + (car.laps + 1);
    }
    if (kind === "DT") car.pen.dt = null;
    else car.pen.sg = null;
    publish(carLabel(car) + " SERVED " + (kind === "DT" ? "DRIVE THROUGH" : "STOP/GO") + " PENALTY", "Stewards");
  }
  r.ver++;
}

// Mark one lap as deleted (it can still be running – then it is deleted when it ends)
function deleteLapByNumber(car, lapNumber) {
  car.invalidLaps[lapNumber] = true;
  const lap = car.lapTimes.find(l => l.lap === lapNumber);
  if (lap) lap.valid = false;
  car.bestLap = null;
  for (const l of car.lapTimes) {
    if (l.valid && !l.pitLane && !l.aborted && (!car.bestLap || l.time < car.bestLap.time)) car.bestLap = l;
  }
  return lap;
}

function disqualify(car) {
  car.dsq = true;
  car.flag = "BLACK";
  publish("BLACK FLAG FOR " + carLabel(car) + " - DISQUALIFIED", "Flag");
  if (race.session === "QUALI") {
    if (car.mode === "RACE" && !car.pit.state) car.q.phase = "COOL";
    return;
  }
  if (car.status === "RUNNING" && car.mode === "RACE" && !car.finished) {
    addAlert("warn", carLabel(car) + " has been shown the black flag and must return to the pits.", { carId: car.id });
  }
}


// =====================================================================
//  6. EVALUATION
// =====================================================================

// Compare a decision of the user with the guidelines (or the real stewards)
function evaluateDecision(inc) {
  if (!inc.truth || !inc.decision) return null;
  const truth = inc.truth;
  const per = inc.decision.perCar;

  let worstOther = 0;
  for (const id in per) {
    if (Number(id) !== truth.culprit) worstOther = Math.max(worstOther, PENALTIES[per[id].code].rank);
  }

  if (!truth.culprit || truth.penalty === "NFA") {
    if (worstOther <= 1) return { result: "correct", text: "Correct – no penalty was needed.", score: 10 };
    if (worstOther === 2) return { result: "harsh", text: "Too harsh – no driver was predominantly to blame.", score: 3 };
    return { result: "harsh", text: "Much too harsh – no driver was predominantly to blame.", score: 0 };
  }

  if (worstOther >= 2) return { result: "wrong", text: "Wrong driver penalised.", score: 0 };
  const given = per[truth.culprit] ? PENALTIES[per[truth.culprit].code].rank : 0;
  const expected = PENALTIES[truth.penalty].rank;
  const diff = given - expected;
  if (diff === 0) return { result: "correct", text: "Correct decision.", score: 10 };
  if (diff === -1) return { result: "lenient", text: "Slightly lenient (guideline: " + PENALTIES[truth.penalty].label + ").", score: 6 };
  if (diff === 1) return { result: "harsh", text: "Slightly harsh (guideline: " + PENALTIES[truth.penalty].label + ").", score: 6 };
  if (diff < 0) return { result: "lenient", text: "Too lenient (guideline: " + PENALTIES[truth.penalty].label + ").", score: given === 0 ? 0 : 2 };
  return { result: "harsh", text: "Too harsh (guideline: " + PENALTIES[truth.penalty].label + ").", score: 2 };
}

// The final classification, including time penalties
function computeResults() {
  const r = race;
  if (r.abandoned) return countbackResults(); // abandoned race: classification of an earlier lap (fia-tools.js)
  const rows = r.cars.map(car => {
    const penalty = car.pen.time + car.pen.post;
    const raceTime = car.finished && r.raceStart !== null ? car.finishTime - r.raceStart : null;
    let status = "Running";
    if (car.dsq) status = "DSQ";
    else if (car.status === "RETIRED") status = "DNF";
    else if (car.finished) status = "Finished";
    return { car, laps: car.laps, raceTime, total: raceTime !== null ? raceTime + penalty : null, penalty, status };
  });

  const rank = row => (row.status === "DSQ" ? 2 : row.status === "DNF" ? 1 : 0);
  rows.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.laps !== b.laps) return b.laps - a.laps;
    if (a.total !== null && b.total !== null) return a.total - b.total;
    if (a.total !== null) return -1;
    if (b.total !== null) return 1;
    return progressOf(b.car) - progressOf(a.car);
  });

  const winner = rows[0];
  rows.forEach((row, i) => {
    row.position = row.status === "DSQ" ? "DSQ" : row.status === "DNF" ? "DNF" : String(i + 1);
    if (row.status === "DNF" && row.laps >= Math.floor(r.totalLaps * 0.9)) row.position = String(i + 1) + "*";
    if (i === 0) row.gapText = row.total !== null ? formatClock(row.total) + "." + String(Math.floor((row.total % 1) * 1000)).padStart(3, "0") : "–";
    else if (row.status === "DSQ") row.gapText = "Disqualified";
    else if (row.status === "DNF") row.gapText = row.car.retireReason || "Retired";
    else if (row.laps < winner.laps) {
      const down = winner.laps - row.laps;
      row.gapText = "+" + down + (down === 1 ? " lap" : " laps");
    } else if (row.total !== null && winner.total !== null) row.gapText = "+" + (row.total - winner.total).toFixed(3) + " s";
    else row.gapText = "–";
  });
  return rows;
}

// The race report: how well did the Race Director do?
function computeEvaluation() {
  const r = race;
  const e = r.evalData;
  const items = [];

  // ----- 1. Safety: reaction to stopped cars and debris -----
  let safetyScore = 100;
  const safetyNotes = [];
  for (const ob of r.obstacles) {
    if (ob.type === "CAR" && !ob.onTrack && ob.measureAt === null && ob.cleared) continue;
    const reaction = ob.measureAt !== null ? ob.measureAt - ob.created : null;
    const label = ob.label + " (sector " + ob.sector + ", " + (ob.onTrack ? "on track" : "off track") + ")";
    if (reaction === null) {
      if (ob.onTrack || ob.type === "BARRIER") {
        safetyScore -= 20;
        safetyNotes.push(["bad", label + ": never protected by an adequate flag or neutralisation."]);
      }
    } else if (reaction <= 10) {
      safetyNotes.push(["good", label + ": protected after " + reaction.toFixed(0) + " s."]);
    } else if (reaction <= 30) {
      safetyScore -= 4;
      safetyNotes.push(["ok", label + ": protected after " + reaction.toFixed(0) + " s."]);
    } else {
      safetyScore -= 10;
      safetyNotes.push(["bad", label + ": protected only after " + reaction.toFixed(0) + " s."]);
    }
  }
  if (e.unsafePasses > 0) {
    safetyScore -= Math.min(25, e.unsafePasses);
    safetyNotes.push(["bad", e.unsafePasses + " cars passed a dangerous obstacle without adequate protection."]);
  }
  if (e.carHits > 0) {
    safetyScore -= 30 * e.carHits;
    safetyNotes.push(["bad", e.carHits + " car(s) hit a car that was stopped on the track."]);
  }
  if (e.debrisHits > 0) {
    safetyScore -= 4 * e.debrisHits;
    safetyNotes.push(["ok", e.debrisHits + " car(s) were damaged by debris."]);
  }
  if (e.marshalRisk > 30) {
    safetyScore -= 8;
    safetyNotes.push(["ok", "Marshals worked on the track for " + Math.round(e.marshalRisk) + " s under double yellow only (cars still at racing speed)."]);
  }
  if (e.marshalExposed > 3) {
    safetyScore -= Math.min(35, 10 + Math.round(e.marshalExposed / 2) + 10 * (e.nearMisses || 0));
    safetyNotes.push(["bad", "Recovery crews were on the track without protection (sector green or single yellow) for " + Math.round(e.marshalExposed) + " s" +
      (e.nearMisses ? " – " + e.nearMisses + " near miss(es)." : ".")]);
  }
  if (e.rainUnsignalled > 30) {
    safetyScore -= Math.min(15, 4 + Math.round(e.rainUnsignalled / 30));
    safetyNotes.push(["ok", "It rained in parts of the track for " + Math.round(e.rainUnsignalled) + " s without the rain signal (or the slippery flag) in those sectors."]);
  }
  if (e.medicalWait > 20) {
    safetyScore -= Math.min(30, 8 + Math.round((e.medicalWait - 20) / 5));
    safetyNotes.push(["bad", "After a heavy impact the medical car could not go out for " + Math.round(e.medicalWait) + " s – call a Safety Car or a red flag at once."]);
  }
  if (e.recoveryWait > 60) {
    safetyScore -= Math.min(20, Math.round((e.recoveryWait - 60) / 10));
    safetyNotes.push(["ok", "Obstacles waited " + Math.round(e.recoveryWait) + " s in total until you sent a recovery crew."]);
  }
  if (safetyNotes.length === 0) safetyNotes.push(["good", "No dangerous situations on track."]);
  items.push({ title: "Track safety", score: clamp(safetyScore, 0, 100), notes: safetyNotes });

  // ----- 2. Start procedure -----
  let startScore = 100;
  const startNotes = [];
  if (e.stallAtStart) {
    if (e.startAborted) startNotes.push(["good", "A car stalled on the grid and you aborted the start. Correct."]);
    else {
      startScore -= 60;
      startNotes.push(["bad", "A car stalled on the grid but the start was not aborted."]);
    }
  }
  if (e.abortsWithoutReason > 0) {
    startScore -= 15 * e.abortsWithoutReason;
    startNotes.push(["ok", "Start aborted " + e.abortsWithoutReason + " time(s) without a visible reason."]);
  }
  if (startNotes.length === 0) startNotes.push(["good", "Clean start procedure."]);
  if (r.session !== "QUALI") items.push({ title: "Start procedure", score: clamp(startScore, 0, 100), notes: startNotes });

  // ----- 3. Stewarding -----
  const stewardNotes = [];
  let total = 0;
  let max = 0;
  for (const inc of r.incidents) {
    if (!inc.truth) continue;
    if (inc.status === "NFI") {
      max += 10;
      const score = inc.truth.penalty === "NFA" ? 10 : 0;
      total += score;
      stewardNotes.push([score ? "good" : "bad", incidentCars(inc) + " – " + inc.offence + ": not investigated" +
        (score ? " (fine, no offence)." : " – guideline: " + PENALTIES[inc.truth.penalty].label + ".")]);
      continue;
    }
    // championship: still under investigation -> a hearing on the FIA desk (rated there)
    if ((inc.status === "AFTER_RACE" || inc.status === "INVESTIGATING") && r.setup.seasonContext && !r.setup.seasonContext.auto) {
      stewardNotes.push(["ok", incidentCars(inc) + " – " + inc.offence + ": goes to a hearing on the FIA desk."]);
      continue;
    }
    if (inc.status !== "DECIDED") {
      max += 10;
      stewardNotes.push(["bad", incidentCars(inc) + " – " + inc.offence + ": no decision taken."]);
      continue;
    }
    const ev = evaluateDecision(inc);
    max += 10;
    // consistency: the same situation got another penalty before (stewards.js)
    const other = inconsistentWith(inc);
    const score = other ? Math.max(0, ev.score - 3) : ev.score;
    total += score;
    stewardNotes.push([score >= 10 ? "good" : score >= 6 ? "ok" : "bad", incidentCars(inc) + " – " + inc.offence + ": " + ev.text +
      (other ? " Not consistent: the same situation at " + other.where + " got " + PENALTIES[other.code].label.toLowerCase() + "." : "")]);
  }
  if (stewardNotes.length === 0) stewardNotes.push(["good", "No incidents needed a decision."]);
  items.push({ title: "Stewarding decisions", score: max ? Math.round(total / max * 100) : 100, notes: stewardNotes });

  // ----- Team radio: were the complaints and requests of the teams handled well? -----
  const radio = (r.radio || []).filter(m => m.kind !== "TEAM"); // team orders are only heard, not answered
  if (radio.length) {
    const radioNotes = [];
    let got = 0;
    let of = 0;
    // (a complaint answered by handling the incident itself is rated with that incident)
    for (const m of radio.filter(x => x.kind === "COMPLAINT" && !x.autoClosed)) {
      of += 10;
      const who = m.team + " about car " + (carById(m.accused) ? carById(m.accused).code : "?");
      const table = m.valid
        ? { INVESTIGATING: [10, "good", "investigated – the complaint was justified"], NOTED: [7, "ok", "noted – it was a real offence, an investigation was needed"],
            REJECTED: [0, "bad", "rejected – but it was a real offence"], NEW: [2, "bad", "never answered – it was a real offence"] }
        : { REJECTED: [10, "good", "rejected – right, it was hard but fair racing"], NOTED: [8, "ok", "noted – no offence"],
            INVESTIGATING: [7, "ok", "investigated – the footage showed no offence"], NEW: [6, "ok", "never answered (no offence)"] };
      const [score, kind, text] = table[m.status] || [5, "ok", m.status];
      got += score;
      radioNotes.push([kind, "Complaint of " + who + ": " + text + "."]);
    }
    const requests = radio.filter(x => x.kind === "REQUEST");
    const slow = requests.filter(m => (m.status === "RESOLVED" ? m.answeredAt : r.time) - m.t > 60);
    if (requests.length) {
      of += 10 * requests.length;
      got += 10 * (requests.length - slow.length) + 3 * slow.length;
      radioNotes.push([slow.length ? "ok" : "good", requests.length + " request(s) of the teams, " + (slow.length ? slow.length + " of them handled only after more than a minute." : "all handled within a minute.")]);
    }
    items.push({ title: "Team radio", score: of ? Math.round(got / of * 100) : 100, notes: radioNotes });
  }

  // ----- 4. Track limits -----
  let tlRight = 0;
  let tlTotal = 0;
  for (const tl of r.trackLimits) {
    tlTotal++;
    if ((tl.status === "DELETED" && tl.violation) || (tl.status === "DISMISSED" && !tl.violation)) tlRight++;
  }
  const tlNotes = [[tlTotal ? (tlRight === tlTotal ? "good" : "ok") : "good",
    tlTotal ? tlRight + " of " + tlTotal + " track limits reports handled correctly." : "No track limits reports."]];
  if (e.bwNeeded > e.bwShown) tlNotes.push(["ok", "Black and white flag not shown " + (e.bwNeeded - e.bwShown) + " time(s) after a 3rd track limits offence."]);
  const tlScore = (tlTotal ? Math.round(tlRight / tlTotal * 100) : 100) - Math.max(0, e.bwNeeded - e.bwShown) * 10;
  items.push({ title: "Track limits", score: clamp(tlScore, 0, 100), notes: tlNotes });

  // ----- 5. Race management -----
  let manageScore = 100;
  const manageNotes = [];
  if (e.drsWetSeconds > 20) {
    manageScore -= Math.min(30, Math.round(e.drsWetSeconds / 10));
    manageNotes.push(["bad", aidName() + " was enabled on a wet track for " + e.drsWetSeconds + " s."]);
  }
  if (e.straightWetSeconds > 20) {
    manageScore -= Math.min(30, Math.round(e.straightWetSeconds / 10));
    manageNotes.push(["bad", "Straight Mode stayed active on a wet track for " + e.straightWetSeconds + " s."]);
  }
  if (e.neutralNoReason > 60) {
    manageScore -= Math.min(30, Math.round(e.neutralNoReason / 20));
    manageNotes.push(["ok", "The race was neutralised for " + e.neutralNoReason + " s after the track was already clear."]);
  }
  const unserved = r.cars.filter(c => c.pen.failedServe).length;
  if (unserved) manageNotes.push(["ok", unserved + " penalty(ies) were not served in time."]);
  if (e.exitWait > 15) {
    manageScore -= Math.min(30, Math.round(e.exitWait / 6));
    manageNotes.push(["bad", "Cars waited " + Math.round(e.exitWait) + " s at the closed pit exit after the field had passed."]);
  }
  if (manageNotes.length === 0) manageNotes.push(["good", "Neutralisations and " + (is2026() ? "the active aero / Overtake Mode were" : "DRS were") + " used sensibly."]);
  items.push({ title: r.session === "QUALI" ? "Session management" : "Race management", score: clamp(manageScore, 0, 100), notes: manageNotes });

  // ----- 6. Weather decisions (championship weather, fia-tools.js) -----
  if (isCellWeather(r)) items.push(weatherEvaluation());

  const overall = Math.round(items.reduce((sum, it) => sum + clamp(it.score, 0, 100), 0) / items.length);
  return { items, overall };
}
