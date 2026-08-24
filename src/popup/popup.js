const elements = {
  statusDot: document.getElementById("status-dot"),
  recordingInfo: document.getElementById("recording-info"),
  sessionName: document.getElementById("session-name"),
  sessionMeta: document.getElementById("session-meta"),
  btnRecord: document.getElementById("btn-record"),
  btnPause: document.getElementById("btn-pause"),
  btnResume: document.getElementById("btn-resume"),
  btnStop: document.getElementById("btn-stop"),
  btnDashboard: document.getElementById("btn-dashboard"),
};

async function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function render(state) {
  const recording = state.status === "recording";
  const paused = state.status === "paused";
  elements.statusDot.className = `dot ${recording ? "recording" : paused ? "paused" : "idle"}`;
  elements.recordingInfo.classList.toggle("hidden", !recording && !paused);
  if (state.sessionName) elements.sessionName.textContent = state.sessionName;
  elements.sessionMeta.textContent = recording
    ? `${state.requestCount} 个请求已记录`
    : paused
      ? `已暂停（${state.requestCount} 个请求）${state.note ? " · " + state.note : ""}`
      : "";
  elements.btnRecord.classList.toggle("hidden", recording || paused);
  elements.btnPause.classList.toggle("hidden", !recording);
  elements.btnResume.classList.toggle("hidden", !paused);
  elements.btnStop.classList.toggle("hidden", !recording && !paused);
}

elements.btnRecord.addEventListener("click", async () => {
  const result = await send("START_RECORDING");
  if (result?.error) {
    alert(result.error);
    return;
  }
  render(result);
  window.close();
});

elements.btnPause.addEventListener("click", async () => {
  render(await send("PAUSE_RECORDING"));
});

elements.btnResume.addEventListener("click", async () => {
  const result = await send("RESUME_RECORDING");
  if (result?.error) alert(result.error);
  else render(result);
});

elements.btnStop.addEventListener("click", async () => {
  await send("STOP_RECORDING");
  window.close();
});

elements.btnDashboard.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "RECORDING_STATE_CHANGED") render(message.state);
});

(async () => {
  render(await send("GET_STATE"));
})();
