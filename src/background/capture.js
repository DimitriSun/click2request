import { classifyBody, headerList } from "../shared/utils.js";

const DEBUGGER_VERSION = "1.3";
const TOTAL_BUFFER_BYTES = 256 * 1024 * 1024;

export class CaptureSession {
  constructor({ tabId, tabUrl, maxBodyBytes, onRecord, onDetach }) {
    this.tabId = tabId;
    this.tabUrl = tabUrl;
    this.maxBodyBytes = maxBodyBytes;
    this.onRecord = onRecord;
    this.onDetach = onDetach;
    this.pending = new Map();
    this.seq = 0;
    this.handleDetach = this.handleDetach.bind(this);
    this.handleEvent = this.handleEvent.bind(this);
  }

  async start() {
    chrome.debugger.onDetach.addListener(this.handleDetach);
    chrome.debugger.onEvent.addListener(this.handleEvent);
    await chrome.debugger.attach({ tabId: this.tabId }, DEBUGGER_VERSION);
    await chrome.debugger.sendCommand({ tabId: this.tabId }, "Network.enable", {
      maxTotalBufferSize: TOTAL_BUFFER_BYTES,
      maxResourceBufferSize: this.maxBodyBytes,
    });
  }

  async stop() {
    chrome.debugger.onDetach.removeListener(this.handleDetach);
    chrome.debugger.onEvent.removeListener(this.handleEvent);
    this.pending.clear();
    try {
      await chrome.debugger.detach({ tabId: this.tabId });
    } catch {
      // tab may already be gone
    }
  }

  handleDetach(source, reason) {
    if (source.tabId !== this.tabId) return;
    chrome.debugger.onDetach.removeListener(this.handleDetach);
    chrome.debugger.onEvent.removeListener(this.handleEvent);
    this.pending.clear();
    this.onDetach(reason);
  }

  handleEvent(source, method, params) {
    if (source.tabId !== this.tabId) return;
    switch (method) {
      case "Network.requestWillBeSent":
        this.onRequestWillBeSent(params);
        break;
      case "Network.responseReceived":
        this.onResponseReceived(params);
        break;
      case "Network.loadingFinished":
        this.onLoadingFinished(params);
        break;
      case "Network.loadingFailed":
        this.onLoadingFailed(params);
        break;
    }
  }

  onRequestWillBeSent(params) {
    const entry = {
      requestId: params.requestId,
      wallTime: Math.round((params.wallTime || Date.now() / 1000) * 1000),
      timestamp: params.timestamp,
      method: params.request.method,
      url: params.request.url,
      resourceType: params.type || "other",
      initiatorType: params.initiator?.type || "other",
      frameId: params.frameId,
      pageUrl: params.documentURL || this.tabUrl,
      requestHeaders: headerList(params.request.headers),
      requestBody: decodeRequestBody(params.request),
      statusCode: null,
      statusText: "",
      mimeType: "",
      responseHeaders: [],
      responseBody: null,
      ttfbMs: null,
      downloadMs: null,
      totalMs: null,
      sizeBytes: 0,
      errorText: null,
    };
    this.pending.set(params.requestId, entry);
  }

  onResponseReceived(params) {
    const entry = this.pending.get(params.requestId);
    if (!entry) return;
    const response = params.response;
    entry.statusCode = response.status;
    entry.statusText = response.statusText || "";
    entry.mimeType = response.mimeType || "";
    entry.responseHeaders = headerList(response.headers);
    entry.ttfbMs = Math.round((params.timestamp - entry.timestamp) * 1000);
  }

  async onLoadingFinished(params) {
    const entry = this.pending.get(params.requestId);
    if (!entry) return;
    this.pending.delete(params.requestId);
    const receivedAt = entry.timestamp + (entry.ttfbMs || 0) / 1000;
    entry.downloadMs = Math.round((params.timestamp - receivedAt) * 1000);
    entry.totalMs = Math.round((params.timestamp - entry.timestamp) * 1000);
    try {
      const result = await chrome.debugger.sendCommand(
        { tabId: this.tabId },
        "Network.getResponseBody",
        { requestId: params.requestId }
      );
      entry.responseBody = decodeBody(result.body, result.base64Encoded, entry.mimeType, this.maxBodyBytes);
      entry.sizeBytes = entry.responseBody ? entry.responseBody.content.length : 0;
    } catch {
      entry.responseBody = null;
    }
    this.emit(entry);
  }

  onLoadingFailed(params) {
    const entry = this.pending.get(params.requestId);
    if (!entry) return;
    this.pending.delete(params.requestId);
    entry.errorText = params.errorText || "failed";
    this.emit(entry);
  }

  emit(entry) {
    entry.seq = this.seq++;
    this.onRecord(entry);
  }
}

function decodeRequestBody(request) {
  const contentType = request.headers?.["content-type"] || "";
  if (request.postData !== undefined && request.postData !== null) {
    return { ...classifyBody(contentType, request.postData), truncated: false };
  }
  const entries = request.postDataEntries;
  if (entries?.length) {
    const entry = entries[0];
    if (entry.bytes) {
      const text = new TextDecoder().decode(base64ToBytes(entry.bytes));
      return { ...classifyBody(entry.headers?.["content-type"] || contentType, text), truncated: false };
    }
    if (entry.text) {
      return { ...classifyBody(entry.headers?.["content-type"] || contentType, entry.text), truncated: false };
    }
  }
  return null;
}

function decodeBody(body, base64Encoded, mimeType, maxBytes) {
  if (body === undefined || body === null) return null;
  if (!base64Encoded) {
    if (body.length > maxBytes) {
      return { ...classifyBody(mimeType, body.slice(0, maxBytes)), truncated: true };
    }
    return { ...classifyBody(mimeType, body), truncated: false };
  }
  const text = new TextDecoder().decode(base64ToBytes(body));
  if (text.length > maxBytes) {
    return { ...classifyBody(mimeType, text.slice(0, maxBytes)), truncated: true };
  }
  return { ...classifyBody(mimeType, text), truncated: false };
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
