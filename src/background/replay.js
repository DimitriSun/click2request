import { deepEqualJson, findHeader } from "../shared/utils.js";
import { replaceTokens } from "../shared/variables.js";

const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "accept-encoding",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "te",
  "expect",
]);

export async function replayRecords(records, options = {}) {
  const { variables, cookieStrategy = "browser" } = options;
  const results = [];
  for (const record of records) {
    results.push(await replayOne(record, { variables, cookieStrategy }));
  }
  return results;
}

async function replayOne(record, { variables, cookieStrategy }) {
  const url = replaceTokens(record.url, variables);
  const headers = replayHeaders(record.requestHeaders, variables);
  const body = record.requestBody?.content ? replaceTokens(record.requestBody.content, variables) : undefined;
  const useBody = body !== undefined && !["GET", "HEAD"].includes(record.method);

  const start = performance.now();
  try {
    const response = await fetchWithCookies(url, {
      method: record.method,
      headers,
      body: useBody ? body : undefined,
      cookieStrategy,
      record,
    });
    const duration = Math.round(performance.now() - start);
    const text = await response.text();
    return verdict(record, { status: response.status, duration, body: text, url });
  } catch (error) {
    return verdict(record, { error: String(error?.message || error), url });
  }
}

async function fetchWithCookies(url, { method, headers, body, cookieStrategy, record }) {
  const plain = () => fetch(url, {
    method,
    headers,
    body,
    credentials: cookieStrategy === "browser" ? "include" : "omit",
    redirect: "follow",
  });
  if (cookieStrategy === "recorded") {
    return withRecordedCookies(url, record, plain);
  }
  return plain();
}

function replayHeaders(headers, variables) {
  const result = {};
  for (const { name, value } of headers || []) {
    const lower = String(name).toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower) || lower === "cookie") continue;
    result[name] = replaceTokens(value, variables);
  }
  return result;
}

async function withRecordedCookies(url, record, request) {
  const cookieHeader = findHeader(record.requestHeaders, "cookie");
  if (!cookieHeader) return request();
  const pairs = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      return index < 0 ? { name: part, value: "" } : { name: part.slice(0, index), value: part.slice(index + 1) };
    });
  const origin = new URL(url).origin;
  const previous = await chrome.cookies.getAll({ url: origin }).catch(() => []);
  for (const pair of pairs) {
    await chrome.cookies.set({ url: origin, name: pair.name, value: pair.value }).catch(() => {});
  }
  try {
    return await request();
  } finally {
    for (const pair of pairs) {
      await chrome.cookies.remove({ url: origin, name: pair.name }).catch(() => {});
    }
    for (const cookie of previous) {
      await chrome.cookies
        .set({
          url: origin,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expirationDate,
          ...(cookie.sameSite && cookie.sameSite !== "unspecified" ? { sameSite: cookie.sameSite } : {}),
        })
        .catch(() => {});
    }
  }
}

function verdict(record, replay) {
  if (replay.error) {
    return { requestId: record.id, method: record.method, url: replay.url || record.url, ok: false, error: replay.error };
  }
  const statusMatch = record.statusCode === replay.status;
  const bodyMatch = bodiesEqual(record.responseBody?.content, replay.body);
  return {
    requestId: record.id,
    method: record.method,
    url: replay.url || record.url,
    ok: statusMatch && bodyMatch,
    statusMatch,
    bodyMatch,
    recordedStatus: record.statusCode,
    replayedStatus: replay.status,
    recordedDuration: record.totalMs,
    replayedDuration: replay.duration,
  };
}

function bodiesEqual(recorded, replayed) {
  if (!recorded && !replayed) return true;
  if (recorded === undefined || recorded === null || replayed === undefined || replayed === null) return false;
  return deepEqualJson(recorded, replayed);
}

export async function replayInPage(record, tabId, variables) {
  const url = replaceTokens(record.url, variables);
  const headers = {};
  for (const { name, value } of record.requestHeaders || []) {
    const lower = String(name).toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower) || lower === "cookie") continue;
    headers[name] = replaceTokens(value, variables);
  }
  const body = record.requestBody?.content ? replaceTokens(record.requestBody.content, variables) : undefined;
  const useBody = body !== undefined && !["GET", "HEAD"].includes(record.method);

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: runFetchInPage,
    args: [{ url, method: record.method, headers, body: useBody ? body : undefined }],
  });
  const value = result?.result;
  if (!value?.ok) {
    return verdict(record, { error: value?.error || "in-page replay failed", url });
  }
  return verdict(record, { status: value.status, duration: value.duration, body: value.body, url });
}

function runFetchInPage({ url, method, headers, body }) {
  const started = performance.now();
  return fetch(url, {
    method,
    headers,
    body,
    credentials: "include",
    redirect: "follow",
  })
    .then(async (response) => ({
      ok: true,
      status: response.status,
      duration: Math.round(performance.now() - started),
      body: await response.text(),
    }))
    .catch((error) => ({ ok: false, error: String(error?.message || error) }));
}
