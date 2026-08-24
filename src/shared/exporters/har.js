export function generate(records) {
  const log = {
    version: "1.2",
    creator: { name: "Click2Request", version: chrome.runtime.getManifest().version },
    entries: records.map(toEntry),
  };
  return JSON.stringify({ log }, null, 2);
}

function toEntry(record) {
  const request = {
    method: record.method,
    url: record.url,
    httpVersion: "HTTP/1.1",
    headers: (record.requestHeaders || []).map((header) => ({ name: header.name, value: header.value })),
    queryString: (record.query || []).map((item) => ({ name: item.name, value: item.value })),
    cookies: [],
    headersSize: -1,
    bodySize: record.requestBody?.content ? record.requestBody.content.length : 0,
  };
  if (record.requestBody?.content && !["GET", "HEAD"].includes(record.method)) {
    request.postData = {
      mimeType: mimeOf(record.requestBody.type),
      text: record.requestBody.content,
    };
  }
  const response = {
    status: record.statusCode ?? 0,
    statusText: record.statusText || "",
    httpVersion: "HTTP/1.1",
    headers: (record.responseHeaders || []).map((header) => ({ name: header.name, value: header.value })),
    cookies: [],
    content: {
      size: record.responseBody?.content?.length ?? 0,
      mimeType: record.mimeType || "",
      text: record.responseBody?.content ?? undefined,
    },
    redirectURL: "",
    headersSize: -1,
    bodySize: record.sizeBytes || 0,
  };
  return {
    startedDateTime: new Date(record.wallTime || Date.now()).toISOString(),
    time: record.totalMs ?? 0,
    request,
    response,
    cache: {},
    timings: {
      send: 0,
      wait: record.ttfbMs ?? -1,
      receive: record.downloadMs ?? -1,
      connect: -1,
      ssl: -1,
    },
    _resourceType: record.resourceType,
    _initiator: record.initiatorType,
  };
}

function mimeOf(type) {
  return {
    json: "application/json",
    form: "application/x-www-form-urlencoded",
    multipart: "multipart/form-data",
    xml: "application/xml",
    html: "text/html",
    text: "text/plain",
  }[type] || "text/plain";
}
