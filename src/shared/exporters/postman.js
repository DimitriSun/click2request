import { isSensitiveHeader, parseUrl } from "../utils.js";
import { collectTokens, resolveVariable } from "../variables.js";

export function generate(records, options = {}) {
  const { variables, maskSensitive, sessionName = "Click2Request" } = options;
  const tokens = collectTokens(records);
  const collection = {
    info: {
      name: sessionName,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: records.map((record) => toItem(record, { maskSensitive })),
    variable: tokens.map((token) => ({ key: token, value: resolveVariable(token, variables) ?? "" })),
  };
  return JSON.stringify(collection, null, 2);
}

function toItem(record, { maskSensitive }) {
  const parsed = parseUrl(record.url);
  const headers = (record.requestHeaders || [])
    .filter((header) => !(maskSensitive && isSensitiveHeader(header.name)))
    .map((header) => ({ key: header.name, value: header.value, type: "text" }));
  const request = {
    method: record.method,
    header: headers,
    url: {
      raw: record.url,
      protocol: parsed.protocol || undefined,
      host: [parsed.host],
      port: parsed.port || undefined,
      path: parsed.pathname.split("/").filter(Boolean),
      query: parsed.query.length ? parsed.query.map((item) => ({ key: item.name, value: item.value })) : undefined,
    },
  };
  const body = record.requestBody;
  if (body?.content && !["GET", "HEAD"].includes(record.method)) {
    if (body.type === "json") {
      request.body = { mode: "raw", raw: body.content, options: { raw: { language: "json" } } };
    } else if (body.type === "form") {
      const params = body.content
        .split("&")
        .filter(Boolean)
        .map((pair) => {
          const index = pair.indexOf("=");
          return {
            key: decodeURIComponent(pair.slice(0, index)),
            value: decodeURIComponent(pair.slice(index + 1)),
            type: "text",
          };
        });
      request.body = { mode: "urlencoded", urlencoded: params };
    } else {
      request.body = { mode: "raw", raw: body.content };
    }
  }
  return { name: `${record.method} ${parsed.pathname}`, request };
}
