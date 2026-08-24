import * as sessions from "./views/sessions.js";
import * as sessionDetail from "./views/session-detail.js";
import * as requestDetail from "./views/request-detail.js";
import * as stats from "./views/stats.js";
import { openSettingsModal, openVariablesModal } from "./views/modals.js";

const routes = [
  { pattern: /^#\/sessions$/, view: sessions, params: () => ({}) },
  { pattern: /^#\/session\/([^/]+)$/, view: sessionDetail, params: (match) => ({ sessionId: match[1] }) },
  { pattern: /^#\/request\/([^/]+)\/([^/]+)$/, view: requestDetail, params: (match) => ({ sessionId: match[1], requestId: match[2] }) },
  { pattern: /^#\/stats\/([^/]+)$/, view: stats, params: (match) => ({ sessionId: match[1] }) },
];

const view = document.getElementById("view");
const recordingPill = document.getElementById("recording-pill");

async function renderRoute() {
  const hash = location.hash || "#/sessions";
  for (const route of routes) {
    const match = hash.match(route.pattern);
    if (match) {
      view.innerHTML = "";
      await route.view.render(view, route.params(match));
      return;
    }
  }
  location.hash = "#/sessions";
}

function updateRecordingPill(state) {
  if (state.status === "recording") {
    recordingPill.textContent = `● 录制中 ${state.requestCount}`;
    recordingPill.className = "pill recording";
  } else if (state.status === "paused") {
    recordingPill.textContent = "‖ 已暂停";
    recordingPill.className = "pill paused";
  } else {
    recordingPill.className = "pill hidden";
  }
}

window.addEventListener("hashchange", renderRoute);
document.getElementById("btn-variables").addEventListener("click", () => openVariablesModal());
document.getElementById("btn-settings").addEventListener("click", () => openSettingsModal());

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "RECORDING_STATE_CHANGED") return;
  updateRecordingPill(message.state);
  if (location.hash === "#/sessions" || location.hash === "") renderRoute();
});

(async () => {
  updateRecordingPill(await chrome.runtime.sendMessage({ type: "GET_STATE" }));
  renderRoute();
})();
