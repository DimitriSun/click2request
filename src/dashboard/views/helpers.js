import { escapeHtml, jsonToHtml } from "../../shared/utils.js";

export function methodBadge(method) {
  const safe = String(method).toLowerCase();
  return `<span class="method method-${safe}">${escapeHtml(method)}</span>`;
}

export function statusBadge(code) {
  const cls = code >= 500 ? "status-5xx" : code >= 400 ? "status-4xx" : code >= 300 ? "status-3xx" : code >= 200 ? "status-2xx" : "status-other";
  return `<span class="status ${cls}">${code ?? "-"}</span>`;
}

export function bodyHtml(body) {
  if (!body) return '<div class="empty-state small">无数据</div>';
  const content = body.content ?? "";
  const truncated = body.truncated ? '<span class="badge warn">响应体已截断</span>' : "";
  let inner;
  if (body.type === "json") {
    try {
      inner = jsonToHtml(JSON.parse(content));
    } catch {
      inner = `<pre class="code-block">${escapeHtml(content)}</pre>`;
    }
  } else {
    inner = `<pre class="code-block">${escapeHtml(content)}</pre>`;
  }
  return `${truncated}${inner}`;
}

export function headerTable(headers) {
  if (!headers?.length) return '<div class="empty-state small">无数据</div>';
  return `<table class="kv-table"><tbody>${headers
    .map((header) => `<tr><td class="k">${escapeHtml(header.name)}</td><td class="v">${escapeHtml(header.value)}</td></tr>`)
    .join("")}</tbody></table>`;
}

export function kvList(items) {
  return `<table class="kv-table"><tbody>${items
    .map(([key, value]) => `<tr><td class="k">${escapeHtml(key)}</td><td class="v">${escapeHtml(String(value ?? ""))}</td></tr>`)
    .join("")}</tbody></table>`;
}
