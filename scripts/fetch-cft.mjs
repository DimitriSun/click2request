import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "E:\\click2request\\.e2e-cft";
mkdirSync(OUT, { recursive: true });

const metaUrl = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
const meta = await (await fetch(metaUrl)).json();
const stable = meta.channels.Stable;
const entry = stable.downloads.chrome.find((d) => d.platform === "win64");
if (!entry) throw new Error("no win64 chrome download for Stable");
console.log("CFT version:", stable.version);
console.log("URL:", entry.url);

const res = await fetch(entry.url);
if (!res.ok) throw new Error("download failed: " + res.status);
const buf = Buffer.from(await res.arrayBuffer());
const zip = `${OUT}\\chrome-win64.zip`;
writeFileSync(zip, buf);
console.log("downloaded bytes:", buf.byteLength);
