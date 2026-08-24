import { CaptureSession } from "./capture.js";
import { Recorder } from "./recorder.js";
import { replayInPage, replayRecords } from "./replay.js";
import { ensureOriginsPermission, originOf } from "../shared/permissions.js";
import { getSettings } from "../shared/settings.js";
import { getVariables } from "../shared/variables.js";
import { getRequest, getRequestsByIds, getSession, requestIds } from "../shared/db.js";

const SESSION_KEY = "activeRecording";

const state = {
  status: "idle",
  sessionId: null,
  tabId: null,
  tabUrl: "",
  requestCount: 0,
  note: "",
};

let capture = null;
let recorder = new Recorder();
let keepalivePort = null;

chrome.runtime.onInstalled.addListener(recoverRecording);
chrome.runtime.onStartup.addListener(recoverRecording);
recoverRecording();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error?.message || error) }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keepalive") return;
  port.onMessage.addListener(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-recording") return;
  if (state.status === "idle") await startRecording();
  else await stopRecording();
});

async function handleMessage(message) {
  switch (message.type) {
    case "GET_STATE":
      return getPublicState();
    case "START_RECORDING":
      return startRecording();
    case "PAUSE_RECORDING":
      return pauseRecording();
    case "RESUME_RECORDING":
      return resumeRecording();
    case "STOP_RECORDING":
      return stopRecording();
    case "REPLAY":
      return handleReplay(message);
    case "REPLAY_IN_PAGE":
      return handleReplayInPage(message);
    default:
      return { error: `unknown message: ${message.type}` };
  }
}

function getPublicState() {
  return {
    status: state.status,
    sessionId: state.sessionId,
    sessionName: recorder.session?.name || null,
    tabId: state.tabId,
    tabUrl: state.tabUrl,
    requestCount: state.requestCount,
    note: state.note,
  };
}

async function startRecording() {
  if (state.status !== "idle") await stopRecording();
  const tab = await pickRecordTargetTab();
  if (!tab?.id) return { error: "No active tab to record" };
  const settings = await getSettings();
  const session = recorder.startSession({ tabUrl: tab.url || "" });
  state.sessionId = session.id;
  state.tabId = tab.id;
  state.tabUrl = tab.url || "";
  state.requestCount = 0;
  state.note = "";

  capture = new CaptureSession({
    tabId: tab.id,
    tabUrl: tab.url || "",
    maxBodyBytes: settings.maxBodyBytes,
    onRecord: (entry) => onRecorded(entry),
    onDetach: (reason) => onUnexpectedDetach(reason),
  });
  try {
    await capture.start();
  } catch (error) {
    await recorder.finish("interrupted");
    resetState();
    return { error: `Cannot attach debugger: ${String(error?.message || error)}. Close DevTools on that tab and try again.` };
  }

  state.status = "recording";
  await persistState();
  startKeepalive();
  updateBadge();
  broadcastState();
  return getPublicState();
}

async function pauseRecording() {
  if (state.status !== "recording") return getPublicState();
  await capture?.stop();
  capture = null;
  state.status = "paused";
  state.note = "";
  await persistState();
  stopKeepalive();
  updateBadge();
  broadcastState();
  return getPublicState();
}

async function resumeRecording() {
  if (state.status !== "paused" || !state.tabId) return getPublicState();
  const settings = await getSettings();
  capture = new CaptureSession({
    tabId: state.tabId,
    tabUrl: state.tabUrl,
    maxBodyBytes: settings.maxBodyBytes,
    onRecord: (entry) => onRecorded(entry),
    onDetach: (reason) => onUnexpectedDetach(reason),
  });
  try {
    await capture.start();
  } catch (error) {
    return { error: `Cannot re-attach: ${String(error?.message || error)}` };
  }
  state.status = "recording";
  state.note = "";
  await persistState();
  startKeepalive();
  updateBadge();
  broadcastState();
  return getPublicState();
}

async function stopRecording() {
  if (state.status === "idle") return getPublicState();
  await capture?.stop();
  capture = null;
  const finished = await recorder.finish();
  const finishedId = finished?.id;
  resetState();
  await persistState();
  stopKeepalive();
  updateBadge();
  broadcastState();
  return { ...getPublicState(), finishedSessionId: finishedId };
}

async function onRecorded(entry) {
  const settings = await getSettings();
  const record = await recorder.record(entry, settings);
  if (record && recorder.session) {
    state.requestCount = recorder.session.stats.requestCount;
    updateBadge();
  }
}

async function onUnexpectedDetach(reason) {
  if (state.status !== "recording") return;
  if (reason === "target_closed") return stopRecording();
  capture = null;
  state.status = "paused";
  state.note = "录制已暂停：可能是 DevTools 打开了该标签页，关闭后点继续";
  await persistState();
  stopKeepalive();
  updateBadge();
  broadcastState();
}

async function handleReplay(message) {
  const { sessionId, requestIds: ids, options = {} } = message;
  const records = ids?.length
    ? await getRequestsByIds(ids)
    : await getRequestsByIds(await requestIds(sessionId));
  if (!records.length) return { error: "No requests to replay" };

  const origins = [...new Set(records.map((record) => originOf(record.url)).filter(Boolean))];
  const missing = await ensureOriginsPermission(origins);
  if (missing.length) {
    return { needPermission: true, origins: missing.map((pattern) => pattern.replace("/*", "")) };
  }

  const variables = await getVariables();
  const results = await replayRecords(records, { variables, cookieStrategy: options.cookieStrategy });
  const ok = results.filter((result) => result.ok).length;
  return { results, summary: { total: results.length, ok, failed: results.length - ok } };
}

async function handleReplayInPage(message) {
  const { requestId, tabId } = message;
  const record = await getRequest(requestId);
  if (!record) return { error: "Request not found" };
  const origin = originOf(record.url);
  const missing = await ensureOriginsPermission([origin]);
  if (missing.length) return { needPermission: true, origins: [origin] };
  const variables = await getVariables();
  const result = await replayInPage(record, tabId, variables);
  const ok = result.ok ? 1 : 0;
  return { results: [result], summary: { total: 1, ok, failed: 1 - ok } };
}

async function pickRecordTargetTab() {
  const windows = await chrome.windows.getAll();
  const tabs = [];
  for (const win of windows) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (tab) tabs.push(tab);
  }
  return tabs.find((tab) => !String(tab.url || "").startsWith("chrome-extension://")) || tabs[0] || null;
}

async function persistState() {
  await chrome.storage.session.set({
    [SESSION_KEY]: {
      status: state.status,
      sessionId: state.sessionId,
      tabId: state.tabId,
      tabUrl: state.tabUrl,
      requestCount: state.requestCount,
    },
  });
}

async function recoverRecording() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const active = stored[SESSION_KEY];
  if (!active?.sessionId || active.status === "idle") return;
  const session = await getSession(active.sessionId);
  if (!session) {
    await chrome.storage.session.remove(SESSION_KEY);
    return;
  }
  state.sessionId = session.id;
  state.tabId = active.tabId;
  state.tabUrl = active.tabUrl || session.tabUrl || "";
  state.requestCount = active.requestCount || session.stats?.requestCount || 0;
  recorder.session = session;

  let tabExists = false;
  try {
    await chrome.tabs.get(active.tabId);
    tabExists = true;
  } catch {
    tabExists = false;
  }
  if (!tabExists) {
    await recorder.finish("interrupted");
    resetState();
    await persistState();
    return;
  }

  const settings = await getSettings();
  capture = new CaptureSession({
    tabId: state.tabId,
    tabUrl: state.tabUrl,
    maxBodyBytes: settings.maxBodyBytes,
    onRecord: (entry) => onRecorded(entry),
    onDetach: (reason) => onUnexpectedDetach(reason),
  });
  try {
    await capture.start();
    state.status = "recording";
    state.note = "已自动恢复录制";
  } catch {
    state.status = "paused";
    state.note = "录制已暂停，可在弹窗中手动继续";
  }
  await persistState();
  if (state.status === "recording") startKeepalive();
  updateBadge();
  broadcastState();
}

function resetState() {
  state.status = "idle";
  state.sessionId = null;
  state.tabId = null;
  state.tabUrl = "";
  state.requestCount = 0;
  state.note = "";
  capture = null;
  recorder = new Recorder();
}

async function startKeepalive() {
  if (keepalivePort) return;
  try {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: ["TESTING"],
      justification: "Keep the service worker alive while recording API traffic.",
    });
  } catch {
    return;
  }
  keepalivePort = chrome.runtime.connect({ name: "keepalive" });
  keepalivePort.onDisconnect.addListener(() => {
    keepalivePort = null;
  });
}

async function stopKeepalive() {
  if (keepalivePort) {
    try {
      keepalivePort.disconnect();
    } catch {
      // already disconnected
    }
    keepalivePort = null;
  }
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // no offscreen document
  }
}

function updateBadge() {
  if (state.status === "recording") {
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    chrome.action.setBadgeText({ text: String(state.requestCount) });
    chrome.action.setTitle({ title: `Click2Request 录制中 (${state.requestCount} 个请求)` });
  } else if (state.status === "paused") {
    chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
    chrome.action.setBadgeText({ text: "P" });
    chrome.action.setTitle({ title: "Click2Request 已暂停" });
  } else {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Click2Request" });
  }
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: "RECORDING_STATE_CHANGED", state: getPublicState() }).catch(() => {});
}
