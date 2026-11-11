// =====================================================================
//  main.js
//  Session selection, the play/pause buttons, the slider and
//  the replay loop that runs all the time.
// =====================================================================

const yearSelect    = document.getElementById("yearSelect");
const meetingSelect = document.getElementById("meetingSelect");
const sessionSelect = document.getElementById("sessionSelect");
const loadButton    = document.getElementById("loadButton");
const playButton    = document.getElementById("playButton");
const speedSelect   = document.getElementById("speedSelect");
const timeSlider    = document.getElementById("timeSlider");

let playing = false;


// ---------- 1. Choose a session (fill the dropdowns) ----------

async function loadMeetings() {
  meetingSelect.innerHTML = "<option>Loading...</option>";
  const meetings = await getData("meetings", "year=" + yearSelect.value);

  // Only show Grand Prix weekends that already started
  const pastMeetings = meetings.filter(m => Date.parse(m.date_start) < Date.now());

  meetingSelect.innerHTML = "";
  for (const m of pastMeetings) {
    meetingSelect.innerHTML += `<option value="${m.meeting_key}">${m.meeting_name}</option>`;
  }
  meetingSelect.selectedIndex = pastMeetings.length - 1; // the newest one
  loadSessionList();
}

async function loadSessionList() {
  sessionSelect.innerHTML = "<option>Loading...</option>";
  const sessions = await getData("sessions", "meeting_key=" + meetingSelect.value);
  const pastSessions = sessions.filter(s => Date.parse(s.date_start) < Date.now());

  sessionSelect.innerHTML = "";
  for (const s of pastSessions) {
    sessionSelect.innerHTML += `<option value="${s.session_key}">${s.session_name}</option>`;
  }
  sessionSelect.selectedIndex = pastSessions.length - 1; // usually the race
}

yearSelect.addEventListener("change", loadMeetings);
meetingSelect.addEventListener("change", loadSessionList);

loadButton.addEventListener("click", async () => {
  setPlaying(false);
  selectedDriver = null;
  loadButton.disabled = true;

  await loadSession(sessionSelect.value);

  loadButton.disabled = false;
  if (!session) return;

  // The slider works in seconds since the start of the replay
  timeSlider.max = Math.floor((endTime - startTime) / 1000);
  timeSlider.value = 0;
  document.getElementById("sessionTitle").textContent =
    meetingSelect.options[meetingSelect.selectedIndex].text + " · " + session.session_name;

  resizeCanvas();
  updatePanels();
});


// ---------- 2. Replay controls ----------

function setPlaying(value) {
  playing = value;
  playButton.textContent = playing ? "❚❚" : "▶";
}

// Jump to another time (milliseconds since 1970, like currentTime)
function jumpTo(time) {
  if (!session) return;
  currentTime = Math.max(startTime, Math.min(endTime, time)); // stay between start and end
  timeSlider.value = Math.floor((currentTime - startTime) / 1000);
  updatePanels();
}

playButton.addEventListener("click", () => {
  if (session) setPlaying(!playing);
});

document.getElementById("backButton").addEventListener("click", () => jumpTo(currentTime - 30000));
document.getElementById("forwardButton").addEventListener("click", () => jumpTo(currentTime + 30000));

timeSlider.addEventListener("input", () => jumpTo(startTime + timeSlider.value * 1000));

document.getElementById("eventFilter").addEventListener("change", updatePanels);

// Keyboard: space = play/pause, arrow keys = jump 10 seconds
document.addEventListener("keydown", event => {
  // Don't react when the user is using a dropdown, the slider or a button
  const tag = event.target.tagName;
  if (tag === "SELECT" || tag === "INPUT" || tag === "BUTTON") return;

  if (event.code === "Space") {
    event.preventDefault(); // otherwise the page scrolls down
    if (session) setPlaying(!playing);
  } else if (event.code === "ArrowLeft") {
    jumpTo(currentTime - 10000);
  } else if (event.code === "ArrowRight") {
    jumpTo(currentTime + 10000);
  }
});


// ---------- 3. The replay loop (runs about 60 times per second) ----------

let lastFrame = performance.now();
let lastPanelUpdate = 0;

function loop() {
  const now = performance.now();
  const passed = now - lastFrame; // milliseconds since the last frame
  lastFrame = now;

  if (session) {
    // Move the replay clock forward
    if (playing) {
      currentTime += passed * Number(speedSelect.value);
      if (currentTime >= endTime) {
        currentTime = endTime;
        setPlaying(false);
      }
      timeSlider.value = Math.floor((currentTime - startTime) / 1000);
    }

    // Load car positions (and telemetry of the selected driver) for now and the next 2 minutes
    const chunk = chunkStartOf(currentTime);
    loadLocationChunk(chunk);
    loadLocationChunk(chunk + CHUNK);
    if (selectedDriver) {
      loadCarDataChunk(selectedDriver, chunk);
      loadCarDataChunk(selectedDriver, chunk + CHUNK);
    }

    drawMap();
    updateTelemetry();

    // The cards don't need 60 updates per second; 2 per second is enough
    if (now - lastPanelUpdate > 500) {
      updatePanels();
      lastPanelUpdate = now;
    }
  }

  requestAnimationFrame(loop); // run again at the next frame
}


// ---------- Start ----------
resizeCanvas();
loadMeetings();
requestAnimationFrame(loop);
