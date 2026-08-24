import { matchesAny, parseUrl, uid } from "../shared/utils.js";
import { saveRequest, saveSession } from "../shared/db.js";

export class Recorder {
  constructor() {
    this.session = null;
    this.apiKeys = new Set();
  }

  startSession({ tabUrl }) {
    const now = Date.now();
    this.apiKeys = new Set();
    this.session = {
      id: uid(),
      name: `Session ${new Date(now).toLocaleString()}`,
      createdAt: now,
      updatedAt: now,
      status: "recording",
      tabUrl,
      startWallTime: now,
      endWallTime: null,
      stats: { requestCount: 0, errorCount: 0, sizeBytes: 0, apiCount: 0 },
    };
    return this.session;
  }

  async record(entry, settings) {
    if (!this.session) return null;
    if (settings.excludeTypes.includes(entry.resourceType)) return null;
    if (matchesAny(entry.url, settings.excludeKeywords)) return null;

    const parsed = parseUrl(entry.url);
    const record = {
      ...entry,
      id: `${this.session.id}_${entry.requestId}`,
      sessionId: this.session.id,
      host: parsed.host,
      path: parsed.pathname,
      query: parsed.query,
      protocol: parsed.protocol,
      port: parsed.port,
    };

    const apiKey = `${record.method} ${record.host}${record.path}`;
    if (!this.apiKeys.has(apiKey)) {
      this.apiKeys.add(apiKey);
      this.session.stats.apiCount++;
    }
    this.session.stats.requestCount++;
    if (record.statusCode >= 400 || record.errorText) this.session.stats.errorCount++;
    this.session.stats.sizeBytes += record.sizeBytes || 0;
    this.session.updatedAt = Date.now();

    await saveRequest(record);
    await saveSession(this.session);
    return record;
  }

  async finish(status = "closed") {
    if (!this.session) return null;
    this.session.status = status;
    this.session.endWallTime = Date.now();
    this.session.updatedAt = Date.now();
    await saveSession(this.session);
    const finished = this.session;
    this.session = null;
    this.apiKeys.clear();
    return finished;
  }
}
