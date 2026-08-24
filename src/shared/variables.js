const STORAGE_KEY = "variables";

const EMPTY = { vars: {}, environments: [], activeEnvId: null };

export async function getVariables() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return { ...EMPTY, ...(stored[STORAGE_KEY] || {}) };
}

export async function saveVariables(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function resolveVariable(name, variables) {
  const data = variables || EMPTY;
  const env = data.environments?.find((item) => item.id === data.activeEnvId);
  if (env?.vars && name in env.vars) return env.vars[name];
  if (name === "baseUrl" && env?.baseUrl) return env.baseUrl;
  if (data.vars && name in data.vars) return data.vars[name];
  return undefined;
}

export function replaceTokens(text, variables) {
  return String(text ?? "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) => {
    const value = resolveVariable(name, variables);
    return value === undefined || value === "" ? match : String(value);
  });
}

export function collectTokens(records) {
  const tokens = new Set();
  const walk = (text) => {
    if (typeof text !== "string") return;
    for (const match of text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) tokens.add(match[1]);
  };
  for (const record of records) {
    walk(record.url);
    for (const header of record.requestHeaders || []) walk(header.value);
    if (record.requestBody?.content) walk(record.requestBody.content);
  }
  return [...tokens];
}
