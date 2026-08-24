export const DEFAULTS = {
  maxBodyBytes: 2 * 1024 * 1024,
  excludeTypes: ["image", "media", "font", "stylesheet", "script", "manifest"],
  excludeKeywords: ["/__webpack_hm", "sockjs", "google-analytics", "hm.baidu", "beacon", "metrics"],
  cookieStrategy: "browser",
};

let cache = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) cache = null;
});

export async function getSettings() {
  if (!cache) {
    const stored = await chrome.storage.local.get("settings");
    cache = { ...DEFAULTS, ...(stored.settings || {}) };
  }
  return cache;
}

export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  cache = next;
  return next;
}
