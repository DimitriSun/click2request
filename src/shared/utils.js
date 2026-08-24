export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "-";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatClock(ms) {
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString();
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
}

export function truncate(value, max = 200) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function parseUrl(raw) {
  try {
    const url = new URL(raw);
    return {
      protocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      query: [...url.searchParams.entries()].map(([name, value]) => ({ name, value })),
    };
  } catch {
    return { protocol: "", host: "", port: "", pathname: String(raw), search: "", query: [] };
  }
}

export function headerList(headers) {
  if (Array.isArray(headers)) return headers;
  return Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }));
}

export function findHeader(headers, name) {
  const target = String(name).toLowerCase();
  return (headers || []).find((item) => String(item.name).toLowerCase() === target)?.value;
}

const SENSITIVE_HEADER_PATTERN = /^(cookie|authorization|proxy-authorization|x-api-key)|token|apikey|secret/i;

export function isSensitiveHeader(name) {
  return SENSITIVE_HEADER_PATTERN.test(String(name));
}

export function classifyBody(mimeType, content) {
  const mime = String(mimeType || "").toLowerCase();
  const text = content === undefined || content === null ? "" : String(content);
  if (mime.includes("json")) return { type: "json", content: text };
  if (mime.includes("x-www-form-urlencoded")) return { type: "form", content: text };
  if (mime.includes("multipart")) return { type: "multipart", content: text };
  if (mime.includes("xml")) return { type: "xml", content: text };
  if (mime.includes("html")) return { type: "html", content: text };
  return { type: "text", content: text };
}

export function deepEqualJson(a, b) {
  const normalize = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  try {
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  } catch {
    return String(a) === String(b);
  }
}

export function jsonToHtml(value, key = "") {
  const esc = escapeHtml;
  const row = (name, bodyHtml) => `<div class="json-row"><span class="json-key">${esc(name)}</span>: ${bodyHtml}</div>`;
  if (value === null) return row(key, '<span class="json-null">null</span>');
  if (Array.isArray(value)) {
    if (value.length === 0) return row(key, '<span class="json-empty">[]</span>');
    return `<details open><summary>${esc(key) || "[]"}<span class="json-meta"> (${value.length})</span></summary>${value.map((item, index) => jsonToHtml(item, String(index))).join("")}</details>`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return row(key, '<span class="json-empty">{}</span>');
    return `<details open><summary>${esc(key) || "{}"}<span class="json-meta"> (${keys.length})</span></summary>${keys.map((item) => jsonToHtml(value[item], item)).join("")}</details>`;
  }
  if (typeof value === "string") return row(key, `<span class="json-str">"${esc(value)}"</span>`);
  if (typeof value === "number") return row(key, `<span class="json-num">${esc(value)}</span>`);
  if (typeof value === "boolean") return row(key, `<span class="json-bool">${esc(value)}</span>`);
  return row(key, esc(value));
}

export function matchesAny(text, patterns) {
  const haystack = String(text ?? "");
  return (patterns || []).some((pattern) => pattern && haystack.includes(pattern));
}
