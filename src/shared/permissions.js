export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export async function ensureOriginsPermission(origins) {
  const missing = [];
  for (const origin of origins) {
    if (!origin) continue;
    const granted = await chrome.permissions.contains({ origins: [origin + "/*"] });
    if (!granted) missing.push(origin + "/*");
  }
  return missing;
}
