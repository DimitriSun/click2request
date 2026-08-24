import { isSensitiveHeader } from "../utils.js";
import { replaceTokens } from "../variables.js";

export function generate(records, options = {}) {
  const lines = ["import requests", "", "session = requests.Session()", ""];
  for (const [index, record] of records.entries()) {
    lines.push(`# ${index + 1}. ${record.method} ${record.path || record.url}`, buildCall(record, options), "");
  }
  return lines.join("\n");
}

function buildCall(record, { variables, maskSensitive }) {
  const url = variables ? replaceTokens(record.url, variables) : record.url;
  const method = record.method.toLowerCase();
  const args = [pyString(url)];
  const headers = (record.requestHeaders || [])
    .filter((header) => !(maskSensitive && isSensitiveHeader(header.name)))
    .map((header) => `${pyString(header.name)}: ${pyString(variables ? replaceTokens(header.value, variables) : header.value)}`);
  if (headers.length) args.push(`headers={${headers.join(", ")}}`);

  const body = record.requestBody;
  if (body?.content && !["GET", "HEAD"].includes(record.method)) {
    const content = variables ? replaceTokens(body.content, variables) : body.content;
    if (body.type === "json") {
      try {
        args.push(`json=${pyLiteral(JSON.parse(content))}`);
      } catch {
        args.push(`data=${pyString(content)}`);
      }
    } else {
      args.push(`data=${pyString(content)}`);
    }
  }

  const call = `response = session.${method}(${args.join(", ")})`;
  const assert = `assert response.status_code == ${record.statusCode ?? 200}, f"unexpected status: {response.status_code}"`;
  const log = `print("${pyEscape(record.method)} ${pyEscape(record.path || record.url)} ->", response.status_code, f"{response.elapsed.total_seconds():.3f}s")`;
  return `${call}\n${assert}\n${log}`;
}

function pyString(value) {
  return JSON.stringify(String(value ?? ""));
}

function pyEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function pyLiteral(value) {
  if (value === null) return "None";
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => `${pyString(key)}: ${pyLiteral(item)}`);
    return `{${entries.join(", ")}}`;
  }
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  return pyString(value);
}
