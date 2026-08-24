import { isSensitiveHeader } from "../utils.js";
import { replaceTokens } from "../variables.js";

export function generate(records, options = {}) {
  return records.map((record) => toCurl(record, options)).join("\n\n");
}

function toCurl(record, { variables, maskSensitive }) {
  const url = variables ? replaceTokens(record.url, variables) : record.url;
  const parts = ["curl", "-sS", "-X", record.method, quote(url)];
  for (const header of record.requestHeaders || []) {
    if (maskSensitive && isSensitiveHeader(header.name)) continue;
    const value = variables ? replaceTokens(header.value, variables) : header.value;
    parts.push("-H", quote(`${header.name}: ${value}`));
  }
  if (record.requestBody?.content && !["GET", "HEAD"].includes(record.method)) {
    const body = variables ? replaceTokens(record.requestBody.content, variables) : record.requestBody.content;
    parts.push("--data-raw", quote(body));
  }
  return parts.join(" ");
}

function quote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
