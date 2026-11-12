// =====================================================================
//  backup.js
//  "Your data & settings" on the start page: everything this browser stores for Race Control
//  in one .zip file – and back.
//   - championships (rc.seasons, rc.season.*)
//   - edited tracks and keyboard shortcuts (rc.trackEdits, rc.shortcuts) and other rc.* values
//   - imported data packs (IndexedDB "packs")
//   - the track & map cache (IndexedDB "tracks", rc.osm.*, rc.jolpica.*)
//  The settings/ folder is part of the program (files on disk) and is not in the backup.
//  Plain JavaScript: a small ZIP writer / reader (the browser's CompressionStream and
//  DecompressionStream do the "deflate" packing when they exist).
// =====================================================================

const BACKUP_FORMAT = "rc-backup";
const BACKUP_VERSION = 1;

// which part of the backup a stored key belongs to
function backupCategory(key) {
  if (key === "rc.seasons" || key.startsWith("rc.season.")) return "championships";
  if (key === TRACK_EDIT_STORE || key === SHORTCUT_STORE) return "tracksKeys";
  if (key.startsWith("rc.osm.") || key.startsWith("rc.jolpica.")) return "cache";
  return "settings";
}

const BACKUP_LABELS = {
  championships: "Championships",
  tracksKeys: "Edited tracks & keyboard shortcuts",
  settings: "Other settings",
  packs: "Imported data packs",
  cache: "Track & map cache"
};


// ---------- ZIP: CRC-32, writer, reader ----------
let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function streamBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// files: [{ name, data (Uint8Array) }] -> Blob (application/zip)
async function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const canDeflate = typeof CompressionStream === "function";
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let body = f.data;
    let method = 0;
    if (canDeflate && f.data.length > 256) {
      const packed = await streamBytes(f.data, new CompressionStream("deflate-raw"));
      if (packed.length < f.data.length) { body = packed; method = 8; }
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // version needed
    local.setUint16(6, 0x0800, true);    // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, body.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
}

// ArrayBuffer of a .zip -> Map(name -> Uint8Array)
async function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This is not a .zip file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("The .zip file is damaged.");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue; // a folder
    const lNameLen = view.getUint16(localAt + 26, true);
    const lExtraLen = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const body = bytes.slice(start, start + size);
    if (method === 0) files.set(name, body);
    else if (method === 8) {
      if (typeof DecompressionStream !== "function") throw new Error("This browser can't unpack compressed .zip files – please use a current browser.");
      files.set(name, await streamBytes(body, new DecompressionStream("deflate-raw")));
    } else throw new Error("Unsupported packing in the .zip file (" + name + ").");
  }
  return files;
}


// ---------- Reading the stores ----------
async function idbAll(store) {
  try {
    const db = await openTrackDb();
    return await new Promise(resolve => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

async function idbPutAll(store, values) {
  const db = await openTrackDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(store) {
  try {
    const db = await openTrackDb();
    await new Promise(resolve => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (e) { /* nothing stored */ }
}

function storedKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("rc.")) keys.push(k);
    }
  } catch (e) { /* storage blocked */ }
  return keys;
}


// ---------- Export ----------
async function exportAllData() {
  const { blob, counts } = await buildBackup();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "race-control-backup-" + new Date().toISOString().slice(0, 10) + ".zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { counts, size: blob.size };
}

// the .zip of everything (not downloaded yet)
async function buildBackup() {
  const enc = new TextEncoder();
  const files = [];
  const counts = { championships: 0, tracksKeys: 0, settings: 0, packs: 0, cache: 0 };
  for (const key of storedKeys()) {
    const value = localStorage.getItem(key);
    if (value === null) continue;
    const cat = backupCategory(key);
    if (cat === "championships" && key !== "rc.seasons") counts.championships++;
    else if (cat !== "championships") counts[cat]++;
    files.push({ name: "storage/" + encodeURIComponent(key) + ".json", data: enc.encode(value) });
  }
  const packs = await idbAll(PACK_STORE);
  for (const pack of packs) files.push({ name: "packs/" + encodeURIComponent(String(pack.id)) + ".json", data: enc.encode(JSON.stringify(pack)) });
  counts.packs = packs.length;
  const tracks = await idbAll(TRACK_STORE);
  for (const t of tracks) files.push({ name: "tracks/" + encodeURIComponent(String(t.key)) + ".json", data: enc.encode(JSON.stringify(t)) });
  counts.cache += tracks.length;
  const manifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, app: APP_VERSION, created: new Date().toISOString(), counts };
  files.unshift({ name: "manifest.json", data: enc.encode(JSON.stringify(manifest, null, 2)) });
  return { blob: await makeZip(files), counts };
}


// ---------- Import ----------
// reads the file and returns what is in it (nothing is changed yet)
async function readBackup(file) {
  const files = await readZip(await file.arrayBuffer());
  const dec = new TextDecoder();
  const man = files.get("manifest.json");
  if (!man) throw new Error("This .zip is not a Race Control backup (manifest.json is missing).");
  const manifest = JSON.parse(dec.decode(man));
  if (manifest.format !== BACKUP_FORMAT) throw new Error("This .zip is not a Race Control backup.");
  if (manifest.version > BACKUP_VERSION) throw new Error("This backup was made by a newer version of Race Control.");
  const storage = [];
  const packs = [];
  const tracks = [];
  for (const [name, data] of files) {
    if (name.startsWith("storage/") && name.endsWith(".json")) {
      const key = decodeURIComponent(name.slice(8, -5));
      if (key.startsWith("rc.")) storage.push({ key, value: dec.decode(data) });
    } else if (name.startsWith("packs/")) packs.push(JSON.parse(dec.decode(data)));
    else if (name.startsWith("tracks/")) tracks.push(JSON.parse(dec.decode(data)));
  }
  const counts = { championships: 0, tracksKeys: 0, settings: 0, packs: packs.length, cache: tracks.length };
  for (const s of storage) {
    const cat = backupCategory(s.key);
    if (cat === "championships") { if (s.key !== "rc.seasons") counts.championships++; } else counts[cat]++;
  }
  return { manifest, storage, packs, tracks, counts };
}

// mode "MERGE": keep the data of this browser, the file adds and replaces;
// "REPLACE": everything of Race Control in this browser is deleted first
async function applyBackup(b, mode) {
  if (mode === "REPLACE") {
    for (const k of storedKeys()) localStorage.removeItem(k);
    await idbClear(PACK_STORE);
    await idbClear(TRACK_STORE);
  }
  for (const s of b.storage) {
    if (mode === "MERGE" && s.key === "rc.seasons") {
      // the list of championships: both lists together (the file wins for the same season)
      let mine = [];
      let theirs = [];
      try { mine = JSON.parse(localStorage.getItem("rc.seasons") || "[]") || []; } catch (e) { mine = []; }
      try { theirs = JSON.parse(s.value) || []; } catch (e) { theirs = []; }
      const idOf = x => (x && typeof x === "object" ? x.id : x);
      const merged = mine.filter(m => !theirs.some(t => idOf(t) === idOf(m))).concat(theirs);
      localStorage.setItem("rc.seasons", JSON.stringify(merged));
      continue;
    }
    if (mode === "MERGE" && (s.key === TRACK_EDIT_STORE || s.key === SHORTCUT_STORE)) {
      // edited tracks / keys: per circuit / per action, the file wins
      let mine = {};
      try { mine = JSON.parse(localStorage.getItem(s.key) || "{}") || {}; } catch (e) { mine = {}; }
      localStorage.setItem(s.key, JSON.stringify(Object.assign(mine, JSON.parse(s.value))));
      continue;
    }
    localStorage.setItem(s.key, s.value);
  }
  if (b.packs.length) await idbPutAll(PACK_STORE, b.packs);
  if (b.tracks.length) await idbPutAll(TRACK_STORE, b.tracks);
}

function backupCountsHtml(counts) {
  return `<table class="evidence">${Object.keys(BACKUP_LABELS).map(k => `<tr><td>${BACKUP_LABELS[k]}</td><td><b>${counts[k] || 0}</b></td></tr>`).join("")}</table>`;
}

// the start page: buttons "Export" and the file field "Import"
function initBackup() {
  const btn = $("exportAll");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    $("backupStatus").textContent = "Packing your data…";
    try {
      const res = await exportAllData();
      const c = res.counts;
      $("backupStatus").textContent = "Downloaded (" + (res.size / 1024 / 1024).toFixed(2) + " MB): " + c.championships + " championship(s), " +
        c.packs + " data pack(s), " + c.cache + " cached item(s), tracks, keys and settings.";
    } catch (error) {
      console.error(error);
      $("backupStatus").textContent = "The export failed: " + error.message;
    }
    btn.disabled = false;
  });
  $("importAll").addEventListener("change", async event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    let b;
    try {
      b = await readBackup(file);
    } catch (error) {
      $("backupStatus").textContent = error.message;
      return;
    }
    showImportDialog(b, file.name);
  });
}

function showImportDialog(b, fileName) {
  const box = $("modalBox");
  box.className = "modal-box narrow";
  box.innerHTML = `
    <div class="modal-head">
      <div><h2>Import your data &amp; settings</h2><p class="muted">${escapeHtml(fileName)} · made ${escapeHtml(new Date(b.manifest.created).toLocaleString())} with version ${escapeHtml(b.manifest.app || "?")}</p></div>
      <button class="close-btn" aria-label="Close" data-close="1">✕</button>
    </div>
    <h3>In the file</h3>
    ${backupCountsHtml(b.counts)}
    <h3>What happens with the data in this browser?</h3>
    <p class="small"><b>Merge</b> – keep your data; what is in the file is added (the same championship, data pack or track is replaced by the file).</p>
    <p class="small"><b>Replace everything</b> – all Race Control data of this browser is deleted first, then the file is loaded.</p>
    <div class="btn-row notes-foot">
      <button data-close="1">Cancel</button>
      <button data-import-mode="REPLACE" class="danger-btn">Replace everything</button>
      <button data-import-mode="MERGE" class="button-primary">Merge</button>
    </div>`;
  showModal();
  box.querySelectorAll("[data-import-mode]").forEach(button => button.addEventListener("click", async () => {
    const mode = button.dataset.importMode;
    if (mode === "REPLACE") {
      const ok = await askConfirm("All championships, data packs, edited tracks, keyboard shortcuts and the cache of this browser are deleted and replaced by the file. This can't be undone.",
        { title: "Replace everything?", ok: "Replace everything", danger: true });
      if (!ok) return;
    }
    box.querySelectorAll("button").forEach(x => { x.disabled = true; });
    try {
      await applyBackup(b, mode);
      closeModal();
      $("backupStatus").textContent = "Imported – the page reloads…";
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      console.error(error);
      showToast("The import failed: " + error.message);
      box.querySelectorAll("button").forEach(x => { x.disabled = false; });
    }
  }));
}
