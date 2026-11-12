// =====================================================================
//  settings/changelog.js – the version shown on the Race Control start page
//  and the changelog (button "Changelog"). Edit freely:
//   - APP_VERSION: the text next to the title
//   - CHANGELOG: newest first; every entry has a version, a date (YYYY-MM-DD) and a list of changes
// =====================================================================

const APP_VERSION = "0.9.2";

const CHANGELOG = [
  {
    version: "0.9.2", date: "2026-11-12",
    changes: [
      "Rain signal like on the LED flag panels (a cloud with falling rain): per marshal sector, or the whole track when no sector is selected; sectors with rain are marked blue",
      "Marshals show the rain signal automatically (option, on by default)",
      "Event notes can be revised on the FIA desk between the sessions (new document, applies from the next session)",
      "Driver card without a scroll bar (compact layout)",
      "Data Pack Builder: search and filter in a loaded season"
    ]
  },
  {
    version: "0.9.1", date: "2026-11-12",
    changes: [
      "Your data & settings: export everything as a .zip and import it again (merge or replace)",
      "Weekend arrivals moved to the FIA desk as information of the Technical Delegate, with a 'Car presentation submissions' document",
      "Bigger event notes button on the weekend card",
      "The start buttons of the fictitious and the historic race are on the same height"
    ]
  },
  {
    version: "0.9.0", date: "2026-11-12",
    changes: [
      "The Safety Car leaves the pit lane, waits for the leader and the field closes up behind it",
      "Edit track: DRS zones and detection, Straight Mode zones and Overtake Mode detection, track limits corners – for every circuit",
      "Changelog and version on the start page",
      "Event notes are published before the first session of the weekend (FP1) and apply to the whole weekend",
      "Settings folder: every value that tunes the simulation in one file per topic",
      "Keyboard shortcuts can be changed, removed and added",
      "Track limits review, hearings with the full review on the FIA desk, more event notes options",
      "Crashes and red flags in qualifying and practice; slower crane recovery",
      "Performance: the simulation step is about 30–40 % faster (no new objects every step, corners looked up by position)"
    ]
  },
  {
    version: "0.8.0", date: "2026-11-12",
    changes: [
      "Realism: live SC / VSC delta, digital flag panels, team orders, double stacks, pit lane traffic, slow stops",
      "Tyres: cold tyres after a neutralisation, graining, track temperature, drying line, slick crossover, fuel-corrected laps",
      "Rubber on the track over a weekend",
      "Better investigations: speed traces, driver history, apply precedent, two co-stewards",
      "Medical car and driver checks (stand-in for a driver who is not fit)"
    ]
  },
  {
    version: "0.7.0", date: "2026-11-12",
    changes: [
      "Documents per race weekend, with a weekend dropdown on the FIA desk",
      "Control room console grouped by purpose, marshal sectors by click or drag, keyboard shortcuts",
      "Hearings after a session, disqualifications, race and qualifying bans",
      "Team radio, stewards' room with precedents and decision documents, tyre sets"
    ]
  },
  {
    version: "0.5.0", date: "2026-11-11",
    changes: [
      "Championship mode: calendar, teams and drivers, rulebook, live or simulated sessions, FIA desk",
      "Weather with rain cells, forecast and radar; data packs for other seasons",
      "Free practice, parc fermé, power units, development and the driver market"
    ]
  }
];
