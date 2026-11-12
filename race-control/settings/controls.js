// =====================================================================
//  settings/controls.js – keyboard shortcuts
//  Every action that can get a key. "key" is the default key ("" = no key by default –
//  each user can add it in the app with the ⌨ button, change every key or remove it;
//  that is stored in the user's browser).
//  Keys: a letter or digit ("S", "1"), "Space", or a key name like "F2", "ArrowUp", "+".
// =====================================================================

const SHORTCUT_ACTIONS = [
  // neutralisation and red flag
  { id: "sc", label: "Safety Car", key: "S" },
  { id: "vsc", label: "Virtual Safety Car", key: "V" },
  { id: "end", label: "VSC ending / Safety Car in this lap", key: "E" },
  { id: "lapped", label: "Lapped cars may overtake", key: "" },
  { id: "red", label: "Red flag (asks first)", key: "R" },
  // marshal sectors (the sector under the mouse, else the selected sectors)
  { id: "YELLOW", label: "Yellow flag", key: "1" },
  { id: "DOUBLE", label: "Double yellow flag", key: "2" },
  { id: "SLIPPERY", label: "Slippery surface on / off", key: "3" },
  { id: "GREEN", label: "Clear the sector", key: "4" },
  { id: "RAIN", label: "Rain signal on / off (sector – without one: the whole track)", key: "5" },
  { id: "clearAll", label: "Clear all sectors", key: "" },
  // pit lane and conditions
  { id: "pitExit", label: "Pit exit open / closed", key: "P" },
  { id: "pitEntry", label: "Pit entry open / closed", key: "" },
  { id: "drs", label: "DRS (Overtake Mode) on / off", key: "D" },
  { id: "wet", label: "Declare wet race", key: "" },
  // simulation
  { id: "pause", label: "Pause / continue", key: "Space" },
  { id: "speed1", label: "Sim speed 1×", key: "" },
  { id: "speed2", label: "Sim speed 2×", key: "" },
  { id: "speed4", label: "Sim speed 4×", key: "" },
  { id: "speed8", label: "Sim speed 8×", key: "" },
  { id: "speed16", label: "Sim speed 16×", key: "" },
  { id: "speed32", label: "Sim speed 32×", key: "" },
  { id: "faster", label: "Sim speed: faster", key: "" },
  { id: "slower", label: "Sim speed: slower", key: "" },
  // panels
  { id: "tabIncidents", label: "Side panel: Incidents", key: "" },
  { id: "tabLimits", label: "Side panel: Track limits", key: "" },
  { id: "tabPenalties", label: "Side panel: Penalties", key: "" },
  { id: "tabRadio", label: "Side panel: Radio", key: "" },
  { id: "report", label: "Race report", key: "" },
  { id: "help", label: "Keyboard shortcuts (this list)", key: "?" }
];
