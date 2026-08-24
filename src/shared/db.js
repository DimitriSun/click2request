const DB_NAME = "click2request";
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("sessions")) {
          const store = db.createObjectStore("sessions", { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains("requests")) {
          const store = db.createObjectStore("requests", { keyPath: "id" });
          store.createIndex("sessionId", "sessionId");
          store.createIndex("sessionIdTimestamp", ["sessionId", "timestamp"]);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

const sessionRange = (sessionId) => IDBKeyRange.bound([sessionId], [sessionId, []]);

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function iterateCursor(source, query, direction, onItem) {
  return new Promise((resolve, reject) => {
    const request = source.openCursor(query, direction);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const keepGoing = onItem(cursor.value);
      if (keepGoing === false) return resolve();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function storePut(storeName, value) {
  const db = await openDb();
  return requestResult(db.transaction(storeName, "readwrite").objectStore(storeName).put(value));
}

async function storeGet(storeName, key) {
  const db = await openDb();
  return requestResult(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
}

export async function saveSession(session) {
  return storePut("sessions", session);
}

export async function getSession(id) {
  return storeGet("sessions", id);
}

export async function listSessions() {
  const db = await openDb();
  const index = db.transaction("sessions", "readonly").objectStore("sessions").index("createdAt");
  const sessions = [];
  await iterateCursor(index, null, "prev", (session) => {
    sessions.push(session);
    return true;
  });
  return sessions;
}

export async function deleteSession(id) {
  const db = await openDb();
  const tx = db.transaction(["sessions", "requests"], "readwrite");
  tx.objectStore("sessions").delete(id);
  const requestStore = tx.objectStore("requests");
  await iterateCursor(requestStore.index("sessionId"), id, "next", (record) => {
    requestStore.delete(record.id);
    return true;
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveRequest(record) {
  return storePut("requests", record);
}

export async function getRequest(id) {
  return storeGet("requests", id);
}

export async function listRequests(sessionId, options = {}) {
  const { offset = 0, limit = Infinity, method = "", status = "", host = "", search = "" } = options;
  const db = await openDb();
  const index = db.transaction("requests", "readonly").objectStore("requests").index("sessionIdTimestamp");
  const results = [];
  let skipped = 0;
  const needle = search.toLowerCase();
  await iterateCursor(index, sessionRange(sessionId), "next", (record) => {
    if (method && record.method !== method) return true;
    if (status && statusBucket(record.statusCode) !== status) return true;
    if (host && record.host !== host) return true;
    if (search && !`${record.method} ${record.url}`.toLowerCase().includes(needle)) return true;
    if (skipped < offset) {
      skipped++;
      return true;
    }
    results.push(record);
    return results.length < limit;
  });
  return results;
}

export async function allRequests(sessionId) {
  return listRequests(sessionId, { limit: Infinity });
}

export async function requestIds(sessionId) {
  const db = await openDb();
  const index = db.transaction("requests", "readonly").objectStore("requests").index("sessionId");
  const ids = [];
  await iterateCursor(index, sessionId, "next", (record) => {
    ids.push(record.id);
    return true;
  });
  return ids;
}

export async function getRequestsByIds(ids) {
  const db = await openDb();
  const store = db.transaction("requests", "readonly").objectStore("requests");
  const results = [];
  for (const id of ids) {
    const record = await requestResult(store.get(id));
    if (record) results.push(record);
  }
  return results;
}

export async function distinctHosts(sessionId) {
  const db = await openDb();
  const index = db.transaction("requests", "readonly").objectStore("requests").index("sessionId");
  const hosts = new Set();
  await iterateCursor(index, sessionId, "next", (record) => {
    if (record.host) hosts.add(record.host);
    return true;
  });
  return [...hosts].sort();
}

export function statusBucket(code) {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  if (code >= 300) return "3xx";
  if (code >= 200) return "2xx";
  return "other";
}

export function sessionStats(records) {
  const stats = {
    requestCount: records.length,
    apiCount: 0,
    errorCount: 0,
    sizeBytes: 0,
    totalMs: 0,
    avgMs: 0,
    maxMs: 0,
    methods: {},
    statuses: {},
    apis: new Map(),
    timeline: [],
  };
  for (const record of records) {
    stats.methods[record.method] = (stats.methods[record.method] || 0) + 1;
    const bucket = statusBucket(record.statusCode);
    stats.statuses[bucket] = (stats.statuses[bucket] || 0) + 1;
    if (record.statusCode >= 400 || record.errorText) stats.errorCount++;
    stats.sizeBytes += record.sizeBytes || 0;
    if (Number.isFinite(record.totalMs)) {
      stats.totalMs += record.totalMs;
      stats.maxMs = Math.max(stats.maxMs, record.totalMs);
      stats.timeline.push({ index: record.seq, totalMs: record.totalMs, ttfbMs: record.ttfbMs });
    }
    const apiKey = `${record.method} ${record.host}${record.path}`;
    const api = stats.apis.get(apiKey) || {
      method: record.method,
      host: record.host,
      path: record.path,
      count: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
      lastStatus: 0,
    };
    api.count++;
    if (record.statusCode >= 400) api.errors++;
    if (Number.isFinite(record.totalMs)) {
      api.totalMs += record.totalMs;
      api.maxMs = Math.max(api.maxMs, record.totalMs);
    }
    api.lastStatus = record.statusCode || api.lastStatus;
    stats.apis.set(apiKey, api);
  }
  stats.apiCount = stats.apis.size;
  stats.avgMs = stats.requestCount ? Math.round(stats.totalMs / stats.requestCount) : 0;
  return stats;
}
