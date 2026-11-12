// =====================================================================
//  stewards.js
//  The stewards' room:
//  - precedents: earlier decisions about the same offence (this session and,
//    in the championship, the earlier rounds) – shown when deciding
//  - consistency: the same situation should get the same penalty
//    (part of the Race Director rating)
//  - the decision document: an FIA-style document of every decision (printable)
//  - championship: decisions are kept in season.decisions, and a team may ask for
//    a right of review of a time penalty with new evidence (FIA desk)
// =====================================================================

// The penalty given in an incident: the one of the guilty car, else the hardest one
function mainDecisionCode(inc) {
  if (!inc.decision) return null;
  const per = inc.decision.perCar;
  if (inc.truth && inc.truth.culprit && per[inc.truth.culprit]) return per[inc.truth.culprit].code;
  let best = "NFA";
  for (const id in per) if (PENALTIES[per[id].code].rank > PENALTIES[best].rank) best = per[id].code;
  return best;
}

// The offence without the team name of a complaint ("Complaint by X: defending" -> "Complaint: defending")
function offenceKey(offence) {
  return String(offence || "").replace(/^Complaint by [^:]*:/, "Complaint:");
}

function decisionCarsText(inc) {
  const per = inc.decision ? inc.decision.perCar : {};
  return inc.cars.map(id => {
    const c = carById(id);
    const d = per[id];
    return (c ? c.code : "#" + id) + (d && d.code !== "NFA" ? " " + PENALTIES[d.code].short : "");
  }).join(", ");
}

// Earlier decisions about the same offence: [{ where, code, text, truthPenalty, same }]
function precedentsFor(inc) {
  const r = race;
  const key = offenceKey(inc.offence);
  const list = [];
  for (const other of r.incidents) {
    if (other === inc || other.status !== "DECIDED" || offenceKey(other.offence) !== key) continue;
    list.push({ where: lapLabel(other.decision.lap || other.lap) + " (this session)", code: mainDecisionCode(other),
      points: guiltyPoints(other.decision.perCar),
      text: decisionCarsText(other), truthPenalty: other.truth ? other.truth.penalty : null, t: other.decision.t });
  }
  const s = typeof season !== "undefined" ? season : null;
  if (s && r.setup.seasonContext && s.id === r.setup.seasonContext.seasonId) {
    for (const d of s.decisions || []) {
      if (offenceKey(d.offence) !== key) continue;
      list.push({ where: "Round " + d.round + " · " + (SESSION_NAMES[d.session] || d.session) + (d.lap ? " · lap " + d.lap : ""), code: d.code, points: d.points || 0,
        text: d.cars, truthPenalty: d.truthPenalty, t: -1, earlierRound: true });
    }
  }
  return list.slice(-PRECEDENTS_SHOWN).reverse();
}

// Was this decision different from an earlier one in the same situation (same guideline)?
function inconsistentWith(inc) {
  if (!inc.truth || !inc.decision) return null;
  const code = mainDecisionCode(inc);
  const key = offenceKey(inc.offence);
  const r = race;
  for (const other of r.incidents) {
    if (other === inc || other.status !== "DECIDED" || !other.truth || (other.decision.seq || 0) >= (inc.decision.seq || 0)) continue;
    if (offenceKey(other.offence) !== key || other.truth.penalty !== inc.truth.penalty) continue;
    if (mainDecisionCode(other) !== code) return { where: lapLabel(other.decision.lap || other.lap), code: mainDecisionCode(other) };
  }
  const s = typeof season !== "undefined" ? season : null;
  if (s && r.setup.seasonContext && s.id === r.setup.seasonContext.seasonId) {
    for (const d of (s.decisions || []).slice().reverse()) {
      if (offenceKey(d.offence) === key && d.truthPenalty === inc.truth.penalty && d.code !== code) {
        return { where: "round " + d.round, code: d.code };
      }
    }
  }
  return null;
}

// The HTML of the precedents in the review window
function precedentsHtml(inc) {
  const list = precedentsFor(inc);
  if (!list.length) return `<p class="muted small">No earlier decision about this offence${race.setup.seasonContext ? " in this championship" : " in this session"}.</p>`;
  return `<table class="evidence precedents">${list.map(p => `<tr><td>${escapeHtml(p.where)}</td><td><b>${escapeHtml(PENALTIES[p.code] ? PENALTIES[p.code].label : p.code)}</b>${p.points ? " + " + p.points + " pt" : ""} · ${escapeHtml(p.text)}</td></tr>`).join("")}</table>
    <p class="muted small">Similar situations should get similar penalties – the rating checks the consistency of your decisions.</p>`;
}

// "Apply precedent": the penalty of the latest precedent, as it can be given in this session
// (a time penalty of a race becomes the grid penalty of qualifying and back). null = none.
function precedentPenalty(inc) {
  const list = precedentsFor(inc);
  if (!list.length) return null;
  const p = list[0];
  const codes = penaltyCodes();
  let code = p.code;
  if (!codes.includes(code) && QUALI_EQUIVALENT[code]) code = QUALI_EQUIVALENT[code];
  if (!codes.includes(code)) {
    const back = Object.keys(QUALI_EQUIVALENT).find(k => QUALI_EQUIVALENT[k] === code);
    code = back && codes.includes(back) ? back : null;
  }
  return code ? { code, points: p.points || 0, where: p.where } : null;
}


// ---------- Driver history (review window) ----------
// Earlier offences of a car / driver in this session and in the championship,
// with the penalty points and reprimands.
function driverHistory(inc, car) {
  const r = race;
  const items = [];
  for (const other of r.incidents) {
    if (other === inc || !other.cars.includes(car.id) || other.t > inc.t + 0.01) continue;
    const d = other.decision && other.decision.perCar[car.id];
    const result = other.status === "DECIDED" ? (d ? PENALTIES[d.code].label + (d.points ? " + " + d.points + " pt" : "") : "–")
      : statusText(other.status);
    items.push({ where: lapLabel(other.lap), offence: other.offence, result });
  }
  const s = typeof season !== "undefined" ? season : null;
  const inSeason = s && r.setup.seasonContext && s.id === r.setup.seasonContext.seasonId && car.driverId && s.drivers[car.driverId];
  let points = car.pen.points || 0;
  let reprimands = car.pen.reprimands || 0;
  if (inSeason) {
    for (const d of s.decisions || []) {
      const mine = d.perDriver && d.perDriver[car.driverId];
      if (!mine) continue;
      items.push({ where: "Round " + d.round + " · " + (SESSION_NAMES[d.session] || d.session), offence: d.offence,
        result: PENALTIES[mine.code] ? PENALTIES[mine.code].label + (mine.points ? " + " + mine.points + " pt" : "") : mine.code });
    }
    const sd = s.drivers[car.driverId];
    points += sd.penaltyPoints || 0;
    reprimands += sd.reprimands || 0;
  }
  return { items: items.slice(-3).reverse(), points, reprimands, warnings: car.pen.warnings || 0, inSeason: !!inSeason, more: Math.max(0, items.length - 3) };
}

function driverHistoryHtml(inc) {
  return inc.cars.map(carById).filter(Boolean).map(car => {
    const h = driverHistory(inc, car);
    const head = `<b><span class="team-bar" style="background:${car.colour}"></span>${car.number} ${escapeHtml(car.code)}</b>
      <span class="muted small">${h.points} penalty point${h.points === 1 ? "" : "s"}${h.inSeason ? " (12 months)" : ""} · ${h.reprimands} reprimand${h.reprimands === 1 ? "" : "s"}${h.warnings ? " · " + h.warnings + " warning" + (h.warnings === 1 ? "" : "s") : ""}</span>`;
    const rows = h.items.length
      ? `<table class="evidence history">${h.items.map(x => `<tr><td>${escapeHtml(x.where)}</td><td>${escapeHtml(x.offence)} – <b>${escapeHtml(x.result)}</b></td></tr>`).join("")}</table>` +
        (h.more ? `<p class="muted small">+ ${h.more} earlier offence${h.more > 1 ? "s" : ""}</p>` : "")
      : `<p class="muted small">No earlier offences${h.inSeason ? " this season" : " in this session"}.</p>`;
    return `<div class="history-car">${head}${rows}</div>`;
  }).join("");
}


// ---------- Two co-stewards give their opinion (advice only) ----------
// Generated once per incident from the reference decision: the FIA steward is usually right,
// the driver steward is sometimes harsher or softer. Own random numbers, so opening the
// review never changes the race simulation.
const OPINION_LADDER = ["NFA", "REPRIMAND", "5S", "10S", "DT", "SG10"];
const OPINION_LADDER_Q = ["NFA", "REPRIMAND", "GRID3", "GRID5", "GRID10", "BACK"];

function coStewardOpinions(inc) {
  if (inc.coStewards) return inc.coStewards;
  const truth = inc.truth;
  let seed = (inc.id * 2654435761 + Math.round(inc.t * 10)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cars = inc.cars.map(carById).filter(Boolean);
  const ladder = race.session === "QUALI" ? OPINION_LADDER_Q : OPINION_LADDER;
  inc.coStewards = CO_STEWARDS.map(st => {
    if (!truth || !cars.length) return { role: st.role, text: "No clear view on this one – it is your call as chairman." };
    let code = truth.penalty;
    let culprit = truth.culprit ? carById(truth.culprit) : null;
    if (rnd() > st.right) {
      // a different view: one step harsher or softer, sometimes the other car to blame
      const i = Math.max(0, ladder.indexOf(code));
      const step = i === 0 ? 1 : rnd() < 0.5 ? -1 : 1;
      code = ladder[clamp(i + step, 0, ladder.length - 1)];
      if (cars.length > 1 && rnd() < 0.3) culprit = cars.find(c => !culprit || c.id !== culprit.id);
      if (!culprit && code !== "NFA") culprit = cars[Math.floor(rnd() * cars.length)];
    }
    if (code === "NFA" || !culprit) {
      const why = ["it looks like a racing incident to me", "nobody was wholly or predominantly to blame", "I see no lasting advantage"];
      return { role: st.role, code: "NFA", text: "No further action – " + why[Math.floor(rnd() * why.length)] + "." };
    }
    const why = {
      COLLISION: ["the move was too optimistic", "the driver could not make the corner", "there was no real chance to pass"],
      FORCING_OFF: ["no racing room was left", "the other car had a significant overlap"],
      LEAVING_TRACK: ["the advantage was kept", "the position was not given back"],
      DEFENDING: ["more than one change of direction", "the move was made under braking"],
      IMPEDING: ["the car on a fast lap was clearly impeded", "the team did not warn the driver in time"],
      YELLOW_FLAG: ["the driver did not slow down enough", "the mini-sector was not slower"],
      UNSAFE_REJOIN: ["the rejoin was not safe", "the driver came back across the racing line"]
    }[inc.type] || ["the evidence is clear enough", "the telemetry backs the report", "this is how we judged it before"];
    return { role: st.role, code, carId: culprit.id,
      text: PENALTIES[code].label + " for car " + culprit.number + " (" + culprit.code + ") – " + why[Math.floor(rnd() * why.length)] + "." };
  });
  return inc.coStewards;
}

function coStewardsHtml(inc) {
  return coStewardOpinions(inc).map(o => `<p class="statement"><b>${o.role}:</b> “${escapeHtml(o.text)}”</p>`).join("") +
    `<p class="muted small">Advice only – the decision and the rating are yours.</p>`;
}


// ---------- The decision document ----------
function decisionReasonText(inc) {
  const per = inc.decision.perCar;
  const guilty = inc.cars.map(carById).filter(c => c && per[c.id] && PENALTIES[per[c.id].code].rank >= 1);
  if (!guilty.length) {
    return "The Stewards reviewed video, timing, positioning and telemetry evidence and heard the drivers. They determined that no driver was wholly or predominantly to blame. No further action.";
  }
  return "The Stewards reviewed video, timing, positioning and telemetry evidence and heard the drivers. " +
    guilty.map(c => "Car " + c.number + " (" + c.name + ")").join(" and ") + (guilty.length > 1 ? " were" : " was") +
    " found to be wholly or predominantly to blame for the incident: " + inc.summary;
}

// The document from plain data – used live (an incident) and for the stored documents of the
// championship (FIA desk, tab "Documents").
// d: { event, docNo, time, heading, cars: [{ number, name, team }], session, fact, offence, decisionLines, reason, note }
function documentHtml(d) {
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const teams = d.cars.map(c => escapeHtml(c.team)).filter((x, i, a) => a.indexOf(x) === i);
  return `
    <div class="fia-doc">
      <div class="doc-head">
        <div><b>FEDERATION INTERNATIONALE DE L'AUTOMOBILE</b><br>${escapeHtml(d.event)}</div>
        <div class="doc-no">Document ${d.docNo}<br>${escapeHtml(d.time || "")}</div>
      </div>
      <table class="doc-meta">
        ${row("From", "The Stewards")}
        ${row("To", "The Team Managers" + (teams.length ? " – " + teams.join(", ") : ""))}
        ${row("Title", escapeHtml(d.heading || "Decision") + " – " + d.cars.map(c => "Car " + c.number + " (" + escapeHtml(c.name) + ")").join(", "))}
      </table>
      ${d.note ? `<p><b>${escapeHtml(d.note)}</b></p>` : ""}
      <p>The Stewards, having received a report from the Race Director, heard the driver(s) and team representative(s) and examined the evidence, determine the following:</p>
      <table class="doc-table">
        ${row("No / Driver", d.cars.map(c => c.number + " – " + escapeHtml(c.name)).join("<br>"))}
        ${row("Competitor", d.cars.map(c => escapeHtml(c.team)).join("<br>"))}
        ${row("Session", escapeHtml(d.session))}
        ${row("Fact", escapeHtml(d.fact))}
        ${row("Infringement", escapeHtml(d.offence))}
        ${row("Decision", d.decisionLines.map(escapeHtml).join("<br>"))}
        ${row("Reason", escapeHtml(d.reason))}
      </table>
      <p class="doc-small">Competitors are reminded of their right to request a review of certain decisions of the Stewards if a significant and relevant new element is discovered, within the applicable time limits.</p>
      <p class="doc-sign">The Stewards</p>
    </div>`;
}

function penaltyLine(number, entry) {
  return "Car " + number + ": " + (entry ? PENALTIES[entry.code].label + (entry.points ? " and " + entry.points + " penalty point" + (entry.points > 1 ? "s" : "") : "") : "No further action");
}

// live: the document of an incident of the running session
function decisionDocumentHtml(inc) {
  const r = race;
  if (!inc.docNo) inc.docNo = (r.docCount = (r.docCount || 0) + 1);
  const per = inc.decision.perCar;
  const cars = inc.cars.map(carById).filter(Boolean);
  return documentHtml({
    event: r.title, docNo: inc.docNo, time: dayTime(inc.decision.t), heading: "Decision",
    cars: cars.map(c => ({ number: c.number, name: c.name, team: c.team })),
    session: (r.session === "QUALI" ? (r.setup.practice || "Qualifying") : "Race") + " · " + lapLabel(inc.lap) + " · " + dayTime(inc.t),
    fact: (inc.summary || inc.offence) + (String(inc.summary || "").includes(inc.location) ? "" : " (" + inc.location + ")"),
    offence: inc.offence,
    decisionLines: cars.map(c => penaltyLine(c.number, per[c.id])),
    reason: decisionReasonText(inc)
  });
}

// Print a document (only the document is printed – rc.css @media print)
function printDecision(inc) {
  printDocumentHtml(decisionDocumentHtml(inc));
}

function printDocumentHtml(html) {
  let holder = document.getElementById("printDoc");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "printDoc";
    document.body.appendChild(holder);
  }
  holder.innerHTML = html;
  document.body.classList.add("printing");
  const done = () => {
    document.body.classList.remove("printing");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}


// ---------- Championship: decisions are kept, teams may ask for a review ----------
const REVIEW_EVIDENCE = [
  "onboard footage from the car's own camera that was not available to the Stewards",
  "steering and brake telemetry of both cars",
  "a new camera angle from a marshal post",
  "GPS positioning data with a higher sample rate"
];

// An incident of the running session as stored data (documents, hearings)
function incidentRecord(inc, ctx) {
  const r = race;
  const cars = inc.cars.map(carById).filter(Boolean);
  const culprit = inc.truth && inc.truth.culprit ? carById(inc.truth.culprit) : null;
  return {
    offence: inc.offence, location: inc.location, summary: inc.summary, lap: inc.lap,
    time: dayTime(inc.t), lapText: lapLabel(inc.lap), session: ctx.type,
    cars: cars.map(c => ({ id: c.driverId, number: c.number, name: c.name, team: c.team, code: c.code })),
    evidence: inc.evidence, statements: inc.statements,
    truth: inc.truth ? { culprit: culprit ? culprit.driverId : null, penalty: inc.truth.penalty, reason: inc.truth.reason } : null,
    // for the review on the FIA desk: the speed traces and the opinions of the co-stewards
    trace: inc.clip && inc.clip.length > 1 && typeof speedTraceSeries === "function" ? traceForStore(speedTraceSeries(inc)) : null,
    coStewards: coStewardOpinions(inc).map(o => ({ role: o.role, text: o.text }))
  };
}

// a stored copy of a speed trace (no references to the cars of the race)
function traceForStore(tr) {
  return { incT: tr.incT, start: tr.start, end: tr.end, max: tr.max, series: tr.series.map(s => ({ code: s.code, colour: s.colour, pts: s.pts })) };
}

// perCar (car ids of the race) -> per (driver ids of the season)
// The penalty points of the hardest penalised car of a decision ({ id: { code, points } })
function guiltyPoints(per) {
  let best = null;
  for (const id in per) if (!best || PENALTIES[per[id].code].rank > PENALTIES[best.code].rank) best = per[id];
  return best ? best.points || 0 : 0;
}

function perByDriver(inc) {
  const per = {};
  for (const id in inc.decision.perCar) {
    const car = carById(Number(id));
    if (car) per[car.driverId] = { code: inc.decision.perCar[id].code, points: inc.decision.perCar[id].points || 0 };
  }
  return per;
}

// Publish a document of the championship (FIA desk, tab "Documents").
// Every weekend has its own numbers (Document 1, 2 … like in real F1); documents that do not
// belong to a weekend (cost cap, rookie rule) are in "Season" (round "S").
// doc.id is unique in the season – amends / amendedBy / desk items refer to it.
// doc: { round, session, kind: DECISION | HEARING | AMENDED | REVIEW | NOTICE, record, per, reason, note, amends }
function publishSeasonDocument(s, doc, wantedNo) {
  s.documents = s.documents || [];
  s.docSeqByRound = s.docSeqByRound || {};
  const key = docRoundKey(doc.round);
  doc.id = (s.docIdSeq = (s.docIdSeq || 0) + 1);
  const next = (s.docSeqByRound[key] || 0) + 1;
  doc.no = wantedNo && wantedNo >= next ? wantedNo : next; // the number seen live (decisions) if possible
  s.docSeqByRound[key] = doc.no;
  doc.date = new Date().toISOString();
  s.documents.push(doc);
  return doc;
}

function docRoundKey(round) {
  return round === null || round === undefined || round === "S" ? "S" : String(round);
}

function docById(s, id) {
  return (s.documents || []).find(d => d.id === id) || null;
}

// A notice of the FIA that is not a stewards' decision about an incident:
// weather and event changes, protests and reports, power units, starting grid, audits
// n: { title, session, from, to, lines: [[label, text]], body, sign }
function publishNotice(s, round, n) {
  return publishSeasonDocument(s, Object.assign({ kind: "NOTICE", round: round === null || round === undefined ? "S" : round }, n));
}

// The heading line of a document in lists
function docTitle(doc) {
  if (doc.kind === "NOTICE") return doc.title;
  return ({ DECISION: "Decision", HEARING: "Decision after the hearing", AMENDED: "Amended decision", REVIEW: "Right of review" }[doc.kind] || "Decision") +
    " – " + doc.record.offence;
}

function docEventTitle(s, doc) {
  if (docRoundKey(doc.round) === "S") return "Formula One World Championship " + s.year;
  const round = s.calendar.find(r => r.round === doc.round);
  return "Round " + doc.round + " · " + (round ? roundInfo(round).gp : "") + (doc.session ? " · " + (SESSION_NAMES[doc.session] || doc.session) : "");
}

function noticeHtml(s, doc) {
  const row = (k, v) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`;
  return `
    <div class="fia-doc">
      <div class="doc-head">
        <div><b>FEDERATION INTERNATIONALE DE L'AUTOMOBILE</b><br>${escapeHtml(docEventTitle(s, doc))}</div>
        <div class="doc-no">Document ${doc.no}<br>${escapeHtml(new Date(doc.date).toLocaleString())}</div>
      </div>
      <table class="doc-meta">
        ${row("From", doc.from || "The FIA")}
        ${row("To", doc.to || "All Teams, All Officials")}
        ${row("Title", doc.title)}
      </table>
      ${doc.body ? `<p>${escapeHtml(doc.body)}</p>` : ""}
      ${doc.lines && doc.lines.length ? `<table class="doc-table">${doc.lines.map(([k, v]) => row(k, v)).join("")}</table>` : ""}
      <p class="doc-sign">${escapeHtml(doc.sign || doc.from || "The FIA")}</p>
    </div>`;
}

function seasonDocumentHtml(s, doc) {
  if (doc.kind === "NOTICE") return noticeHtml(s, doc);
  const rec = doc.record;
  const replaced = doc.amends ? docById(s, doc.amends) : null;
  return documentHtml({
    event: docEventTitle(s, doc),
    docNo: doc.no, time: new Date(doc.date).toLocaleString(),
    heading: { DECISION: "Decision", HEARING: "Decision after the hearing", AMENDED: "Amended decision", REVIEW: "Right of review" }[doc.kind] || "Decision",
    cars: rec.cars,
    session: (SESSION_NAMES[doc.session] || doc.session) + " · " + rec.lapText + (rec.time ? " · " + rec.time : ""),
    fact: (rec.summary || rec.offence) + (!rec.location || String(rec.summary || "").includes(rec.location) ? "" : " (" + rec.location + ")"),
    offence: rec.offence,
    decisionLines: rec.cars.map(c => penaltyLine(c.number, doc.per[c.id])),
    reason: doc.reason,
    note: doc.note || (replaced ? "This decision replaces Document " + replaced.no + "." : "")
  });
}

// the reason text from stored data (like decisionReasonText of a live incident)
function storedReasonText(rec, per) {
  const guilty = rec.cars.filter(c => per[c.id] && PENALTIES[per[c.id].code].rank >= 1);
  if (!guilty.length) return "The Stewards reviewed video, timing, positioning and telemetry evidence and heard the drivers. They determined that no driver was wholly or predominantly to blame. No further action.";
  return "The Stewards reviewed video, timing, positioning and telemetry evidence and heard the drivers. " +
    guilty.map(c => "Car " + c.number + " (" + c.name + ")").join(" and ") + (guilty.length > 1 ? " were" : " was") +
    " found to be wholly or predominantly to blame for the incident: " + (rec.summary || rec.offence);
}

// Called when a session of the championship is saved (season-weekend.js commitSeasonSession):
// - every decision is published as a document
// - incidents still under investigation (or "after the session") go to the FIA desk as hearings
// - a team with a time penalty may ask for a right of review (only for sessions you directed)
function recordSeasonDecisions(s, round, ctx) {
  const r = race;
  s.decisions = s.decisions || [];
  const decided = r.incidents.filter(inc => inc.status === "DECIDED" && !inc.historic)
    .sort((a, b) => (a.decision.seq || 0) - (b.decision.seq || 0));
  for (const inc of decided) {
    const record = incidentRecord(inc, ctx);
    record.evidence = undefined; // documents keep the facts, not the whole evidence
    record.statements = undefined;
    record.trace = undefined;
    record.coStewards = undefined;
    const per = perByDriver(inc);
    const doc = publishSeasonDocument(s, { round: round.round, session: ctx.type, kind: "DECISION", record, per, reason: decisionReasonText(inc) }, inc.docNo);
    if (!inc.truth) continue;
    s.decisions.push({ round: round.round, session: ctx.type, offence: inc.offence, truthPenalty: inc.truth.penalty, code: mainDecisionCode(inc),
      points: guiltyPoints(per), perDriver: per,
      cars: decisionCarsText(inc), lap: ctx.type === "RACE" || ctx.type === "SPRINT" ? inc.lap : null });

    // right of review: a team with a time penalty may come back with "new evidence"
    if (r.session !== "RACE" || !ctx.reviews) continue;
    for (const id in inc.decision.perCar) {
      const d = inc.decision.perCar[id];
      const car = carById(Number(id));
      if (!car || !["5S", "10S"].includes(d.code)) continue;
      const tooHarsh = !inc.truth.culprit || Number(id) !== inc.truth.culprit ||
        PENALTIES[d.code].rank > PENALTIES[inc.truth.penalty].rank;
      if (!chance(tooHarsh ? 0.6 : 0.12)) continue;
      addDeskItem(s, {
        round: round.round, type: "REVIEW", status: "PENDING",
        title: "Right of review: " + car.team + " – " + PENALTIES[d.code].label + " for " + seasonDriverName(car.driverId),
        text: car.team + " asks the Stewards to review their decision about \"" + inc.offence + "\" (Document " + doc.no + " of this weekend, " + SESSION_NAMES[ctx.type] + ", " +
          roundInfo(round).gp + ", lap " + inc.lap + "). New element: " + pick(REVIEW_EVIDENCE) + ". " +
          "Original guideline for this situation: " + PENALTIES[inc.truth.penalty].label.toLowerCase() + (inc.truth.culprit ? "" : " (no driver predominantly to blame)") + ". " +
          "If you overturn the decision, the penalty is withdrawn and the result is recalculated.",
        options: [{ key: "UPHOLD", label: "Uphold the decision" }, { key: "OVERTURN", label: "Overturn – withdraw the penalty" }],
        data: { roundNumber: round.round, type: ctx.type, driver: car.driverId, docId: doc.id, shouldOverturn: tooHarsh }
      });
    }
  }

  // hearings: decided on the FIA desk after the session – before the next session starts
  if (ctx.reviews) {
    for (const inc of r.incidents) {
      if (inc.historic || (inc.status !== "AFTER_RACE" && inc.status !== "INVESTIGATING")) continue;
      const record = incidentRecord(inc, ctx);
      addDeskItem(s, {
        round: round.round, type: "HEARING", status: "PENDING",
        title: "Hearing: " + inc.offence + " – " + record.cars.map(c => c.code).join(" / "),
        text: inc.summary + " (" + SESSION_NAMES[ctx.type] + ", " + record.lapText + ", " + inc.location + ")",
        options: [], data: { roundNumber: round.round, session: ctx.type, record }
      });
    }
  }
  if (s.decisions.length > 400) s.decisions = s.decisions.slice(-400);
}

// ---------- The FIA opens an investigation after a session (FIA desk) ----------
const AFTER_SESSION_OFFENCES = [
  "Causing a collision", "Dangerous driving", "Unsporting behaviour", "Impeding another driver",
  "Technical infringement", "Failing to follow the instructions of the Race Director", "Unsafe release", "Breach of parc fermé"
];

// the sessions that may still be investigated: the running weekend and the last finished one
function investigableSessions(s) {
  const next = nextSession(s);
  const done = s.calendar.filter(r => r.status === "DONE");
  const rounds = [];
  if (next && Object.keys(next.round.sessions).length) rounds.push(next.round);
  if (done.length) rounds.push(done[done.length - 1]);
  const out = [];
  for (const round of rounds) {
    for (const type of weekendSessions(round)) {
      const res = round.sessions[type];
      if (res && res.status === "DONE" && res.rows && res.rows.length) out.push({ round, type, key: round.round + ":" + type });
    }
  }
  return out;
}

// the season drivers of a session (no rookies / juniors)
function sessionDrivers(s, round, type) {
  const res = round.sessions[type];
  return (res && res.rows ? res.rows : []).filter(row => !row.satOut && s.drivers[row.id]).map(row => row.id);
}

// the kinds of a technical infringement (the user chooses one)
const TECHNICAL_KINDS = [
  "Plank (skid block) wear", "Car under the minimum weight", "Fuel flow above the limit", "Fuel sample (not enough fuel left)",
  "Unauthorised engine mapping", "Floor / wing flexibility", "Tyre pressures below the minimum", "DRS / overtake aid opening",
  "Part not homologated"
];

function openAfterSessionInvestigation(s, roundNumber, type, driverIds, offence, technicalKind) {
  const technical = offence === "Technical infringement";
  if (technical && technicalKind) offence = "Technical infringement – " + technicalKind.charAt(0).toLowerCase() + technicalKind.slice(1);
  const round = s.calendar.find(r => r.round === roundNumber);
  if (!round || !driverIds.length) return null;
  const cars = driverIds.map(id => {
    const d = s.drivers[id];
    const team = seasonTeam(d.team) || s.teams.find(t => t.drivers.includes(id));
    return { id, number: d.number, name: d.first + " " + d.last, team: team ? team.name : "", code: d.code };
  });
  const record = {
    // the fact is just the reason
    offence, location: "", summary: offence + ".",
    lap: null, time: "", lapText: "after the session", session: type, cars,
    evidence: technical
      ? [["Source", "Report of the Technical Delegate after the " + (SESSION_NAMES[type] || type)], ["Finding", technicalKind || "Technical irregularity"]]
      : [["Source", "Investigation opened by the FIA after the " + (SESSION_NAMES[type] || type)], ["Material", "Video, timing, team radio and telemetry of the session"]],
    statements: [], truth: null
  };
  return addDeskItem(s, {
    round: roundNumber, type: "HEARING", status: "PENDING",
    title: "Hearing: " + offence + " – " + cars.map(c => c.code).join(" / ") + " (" + (SESSION_NAMES[type] || type) + ")",
    text: record.summary, options: [], data: { roundNumber, session: type, record, manual: true }
  });
}

// Hearings that must be decided before the next session
function pendingHearings(s) {
  return (s.inbox || []).filter(x => x.type === "HEARING" && x.status === "PENDING");
}

// ---------- Changing a decision afterwards: the results are corrected ----------
// (PENALTY_SECONDS, GRID_PLACES: settings/stewards.js)

// from one decision to another for one driver: race time, grid, penalty points, reprimands.
// Returns a note (text) when something could not be changed any more.
// resultsOnly: only the result of the session (no penalty points, reprimands, bans)
function applyDecisionChange(s, roundNumber, type, driverId, from, to, resultsOnly) {
  from = from || { code: "NFA", points: 0 };
  to = to || { code: "NFA", points: 0 };
  const round = s.calendar.find(r => r.round === roundNumber);
  const res = round && round.sessions[type];
  const d = s.drivers[driverId];
  let note = "";
  if (d && !resultsOnly) {
    d.penaltyPoints = Math.max(0, (d.penaltyPoints || 0) + (to.points || 0) - (from.points || 0));
    d.reprimands = Math.max(0, (d.reprimands || 0) + (to.code === "REPRIMAND" ? 1 : 0) - (from.code === "REPRIMAND" ? 1 : 0));
    // bans of the FIA desk: race ban (the next 1–3 Grands Prix, stand-in) and qualifying ban (back of the grid)
    const races = { BAN1: 1, BAN2: 2, BAN3: 3 };
    d.racesBanned = Math.max(0, (d.racesBanned || 0) + (races[to.code] || 0) - (races[from.code] || 0));
    if (to.code === "QBAN" && from.code !== "QBAN") d.carryBack = true;
    if (from.code === "QBAN" && to.code !== "QBAN") d.carryBack = false;
  }
  // a ban has no effect on the result of this session: take back / add only the other penalty
  if (DESK_PENALTY_CODES.includes(to.code) || DESK_PENALTY_CODES.includes(from.code)) {
    const none = { code: "NFA", points: 0 };
    let note = "";
    if (!DESK_PENALTY_CODES.includes(from.code) && from.code !== "NFA") note = applyDecisionChange(s, roundNumber, type, driverId, { code: from.code, points: 0 }, none, true) || note;
    if (!DESK_PENALTY_CODES.includes(to.code) && to.code !== "NFA") note = applyDecisionChange(s, roundNumber, type, driverId, none, { code: to.code, points: 0 }, true) || note;
    return note;
  }
  if (from.code === "DSQ" && to.code !== "DSQ") return "A disqualification cannot be lifted here.";
  if (type === "RACE" || type === "SPRINT") {
    if (to.code === "DSQ" && from.code !== "DSQ") {
      if (type === "RACE") disqualifyFromRace(s, roundNumber, [driverId]);
      else note = "Sprint: the disqualification is noted, the classification stays.";
      return note;
    }
    const delta = (PENALTY_SECONDS[to.code] || 0) - (PENALTY_SECONDS[from.code] || 0);
    if (delta) adjustRaceTime(s, roundNumber, type, driverId, delta);
    if (GRID_PLACES[to.code] && d) d.carryGrid += GRID_PLACES[to.code] === 99 ? 0 : GRID_PLACES[to.code];
    return note;
  }
  // qualifying / practice: grid places
  const delta = (GRID_PLACES[to.code] || (to.code === "DSQ" ? 99 : 0)) - (GRID_PLACES[from.code] || (from.code === "DSQ" ? 99 : 0));
  if (!delta) return note;
  const gridSession = type === "SQ" ? "SPRINT" : "RACE";
  const gridRun = round && round.sessions[gridSession];
  if ((type === "Q" || type === "SQ") && res && res.grid && !gridRun) {
    moveOnGrid(res, driverId, delta); // the grid of this weekend is changed
  } else if (d && delta > 0) {
    if (delta >= 99) d.carryBack = true;
    else d.carryGrid += delta; // already raced (or practice): at the next Grand Prix
    note = isPractice(type) ? "" : "The grid was already used – the penalty applies at the next Grand Prix.";
  }
  return note;
}

function moveOnGrid(res, driverId, delta) {
  const grid = res.grid.slice();
  const i = grid.indexOf(driverId);
  if (i < 0) return;
  grid.splice(i, 1);
  grid.splice(clamp(i + delta, 0, grid.length), 0, driverId);
  res.grid = grid;
  for (const row of res.rows) {
    const k = grid.indexOf(row.id);
    if (k >= 0) row.grid = k + 1;
  }
}

// Race time +/- seconds: positions, gaps and points of the result are recalculated
function adjustRaceTime(s, roundNumber, type, driverId, seconds) {
  const round = s.calendar.find(r => r.round === roundNumber);
  const res = round && round.sessions[type];
  if (!res || !res.rows) return;
  const row = res.rows.find(x => x.id === driverId);
  if (!row) return;
  row.penalty = Math.max(0, (row.penalty || 0) + seconds);
  if (row.total == null) return; // older results without the race time
  row.total += seconds;
  // new order of the classified cars: laps, then race time (the others keep their order)
  const classified = res.rows.filter(x => x.pos);
  classified.sort((a, b) => (b.laps - a.laps) || ((a.total == null ? 1e9 : a.total) - (b.total == null ? 1e9 : b.total)) || (a.pos - b.pos));
  classified.forEach((x, i) => { x.pos = i + 1; });
  const winner = classified[0];
  const table = res.table || [];
  for (const x of res.rows) {
    x.points = x.pos && x.pos <= table.length ? table[x.pos - 1] + (x.fl ? 1 : 0) : 0;
    if (!x.pos || !winner || x.total == null || winner.total == null) continue;
    // the same texts as computeResults (incidents.js)
    if (x === winner) x.gap = formatClock(x.total) + "." + String(Math.floor((x.total % 1) * 1000)).padStart(3, "0");
    else if (x.laps === winner.laps) x.gap = "+" + (x.total - winner.total).toFixed(3) + " s";
  }
  res.rows.sort((a, b) => (a.pos || 99) - (b.pos || 99));
}

// The Race Director changes a published decision: a new document replaces the old one
function amendDecision(s, doc, newPer, reason) {
  if (doc.amendedBy) return { error: "This document was already replaced by Document " + (docById(s, doc.amendedBy) || { no: "?" }).no + "." };
  const notes = [];
  for (const c of doc.record.cars) {
    const from = doc.per[c.id] || { code: "NFA", points: 0 };
    const to = newPer[c.id] || { code: "NFA", points: 0 };
    if (from.code === to.code && (from.points || 0) === (to.points || 0)) continue;
    const note = applyDecisionChange(s, doc.round, doc.session, c.id, from, to);
    if (note) notes.push(c.code + ": " + note);
  }
  const amended = publishSeasonDocument(s, { round: doc.round, session: doc.session, kind: "AMENDED", record: doc.record, per: newPer,
    reason: reason || storedReasonText(doc.record, newPer), amends: doc.id });
  doc.amendedBy = amended.id;
  s.log.push({ date: new Date().toISOString(), round: doc.round, text: "FIA: Document " + amended.no + " – amended decision (" + doc.record.offence + ") replaces Document " + doc.no + "." + (notes.length ? " " + notes.join(" ") : "") });
  saveSeason(s);
  return { doc: amended, notes };
}

// ---------- The review of a hearing on the FIA desk (championship, no race running) ----------
// Earlier decisions about the same offence in the championship (latest first)
function seasonPrecedents(s, offence) {
  const key = offenceKey(offence);
  return (s.decisions || []).filter(d => offenceKey(d.offence) === key).slice(-PRECEDENTS_SHOWN).reverse();
}

// The penalty of the latest precedent as it can be given in this session (race ↔ qualifying)
function seasonPrecedentPenalty(s, offence, session) {
  const p = seasonPrecedents(s, offence)[0];
  if (!p) return null;
  const codes = session === "RACE" || session === "SPRINT" ? PENALTY_CODES : QUALI_PENALTY_CODES;
  let code = p.code;
  if (!codes.includes(code) && QUALI_EQUIVALENT[code]) code = QUALI_EQUIVALENT[code];
  if (!codes.includes(code)) {
    const back = Object.keys(QUALI_EQUIVALENT).find(k => QUALI_EQUIVALENT[k] === code);
    code = back && codes.includes(back) ? back : null;
  }
  return code ? { code, points: p.points || 0, where: "Round " + p.round + " · " + (SESSION_NAMES[p.session] || p.session) } : null;
}

// The driver's record in the championship: earlier decisions, penalty points, reprimands
function seasonDriverHistoryHtml(s, cars) {
  return cars.map(c => {
    const d = s.drivers[c.id] || {};
    const items = (s.decisions || []).filter(x => x.perDriver && x.perDriver[c.id]);
    const rows = items.slice(-3).reverse().map(x => {
      const mine = x.perDriver[c.id];
      return `<tr><td>Round ${x.round} · ${escapeHtml(SESSION_NAMES[x.session] || x.session)}</td><td>${escapeHtml(x.offence)} – <b>${escapeHtml(PENALTIES[mine.code] ? PENALTIES[mine.code].label : mine.code)}${mine.points ? " + " + mine.points + " pt" : ""}</b></td></tr>`;
    }).join("");
    return `<div class="history-car"><b>${c.number} ${escapeHtml(c.code)}</b>
      <span class="muted small">${d.penaltyPoints || 0} penalty points · ${d.reprimands || 0} reprimands</span>
      ${rows ? `<table class="evidence history">${rows}</table>` + (items.length > 3 ? `<p class="muted small">+ ${items.length - 3} earlier</p>` : "") : `<p class="muted small">No earlier offences this season.</p>`}</div>`;
  }).join("");
}

// The Race Director decides a hearing on the FIA desk
function decideHearing(s, item, per) {
  if (item.status !== "PENDING") return null;
  const rec = item.data.record;
  const notes = [];
  for (const c of rec.cars) {
    const to = per[c.id] || { code: "NFA", points: 0 };
    if (to.code === "NFA" && !to.points) continue;
    const note = applyDecisionChange(s, item.data.roundNumber, item.data.session, c.id, null, to);
    if (note) notes.push(c.code + ": " + note);
  }
  item.status = "DONE";
  item.decision = rec.cars.map(c => c.code + " " + PENALTIES[(per[c.id] || { code: "NFA" }).code].short).join(", ");
  item.correct = hearingCorrect(rec, per);
  const doc = publishSeasonDocument(s, { round: item.data.roundNumber, session: item.data.session, kind: "HEARING", record: Object.assign({}, rec, { evidence: undefined, statements: undefined, trace: undefined, coStewards: undefined }),
    per, reason: storedReasonText(rec, per) });
  item.docId = doc.id;
  if (rec.truth) {
    s.decisions = s.decisions || [];
    const culpritCode = rec.truth.culprit && per[rec.truth.culprit] ? per[rec.truth.culprit].code : "NFA";
    s.decisions.push({ round: item.data.roundNumber, session: item.data.session, offence: rec.offence, truthPenalty: rec.truth.penalty, code: culpritCode,
      points: guiltyPoints(per), perDriver: per,
      cars: rec.cars.map(c => c.code + (per[c.id] && per[c.id].code !== "NFA" ? " " + PENALTIES[per[c.id].code].short : "")).join(", "), lap: rec.lap });
  }
  s.log.push({ date: new Date().toISOString(), round: item.data.roundNumber, text: "FIA: Document " + doc.no + " – decision after the hearing (" + rec.offence + "): " + item.decision + "." + (notes.length ? " " + notes.join(" ") : "") });
  saveSeason(s);
  return doc;
}

// like evaluateDecision (incidents.js), with the stored reference decision
function hearingCorrect(rec, per) {
  if (!rec.truth) return undefined;
  const rank = id => (per[id] ? PENALTIES[per[id].code].rank : 0);
  const others = rec.cars.filter(c => c.id !== rec.truth.culprit).map(c => rank(c.id));
  const worstOther = others.length ? Math.max(...others) : 0;
  if (!rec.truth.culprit || rec.truth.penalty === "NFA") return worstOther <= 1;
  if (worstOther >= 2) return false;
  return Math.abs(rank(rec.truth.culprit) - PENALTIES[rec.truth.penalty].rank) <= 1;
}

// Right of review decided on the desk: overturning withdraws the penalty with an amended document
function decideReview(s, item, key) {
  const d = item.data;
  const doc = docById(s, d.docId);
  if (key !== "OVERTURN") {
    if (doc) publishSeasonDocument(s, { round: doc.round, session: doc.session, kind: "REVIEW", record: doc.record, per: doc.per,
      reason: "The Stewards examined the new element and found it not significant and relevant enough. The decision of Document " + doc.no + " stands.",
      note: "Request for a right of review – rejected." });
    return;
  }
  if (doc && !doc.amendedBy) {
    const per = Object.assign({}, doc.per, { [d.driver]: { code: "NFA", points: 0 } });
    amendDecision(s, doc, per, "The Stewards examined the new element and found it significant and relevant. The penalty of Document " + doc.no + " is withdrawn.");
  } else if (d.seconds) {
    // requests of older saves (before the documents): only the time
    adjustRaceTime(s, d.roundNumber, d.type, d.driver, -d.seconds);
    const drv = s.drivers[d.driver];
    if (drv && d.points) drv.penaltyPoints = Math.max(0, drv.penaltyPoints - d.points);
  }
}

