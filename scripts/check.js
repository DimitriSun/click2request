import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const jsFiles = [];
const jsonFiles = [];

walk(join(root, "src"));
for (const file of ["manifest.json", "package.json"]) {
  jsonFiles.push(join(root, file));
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "vendor") continue;
      walk(full);
    } else if (entry.endsWith(".js")) jsFiles.push(full);
    else if (entry.endsWith(".json")) jsonFiles.push(full);
  }
}

let failed = 0;

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status === 0) {
    console.log(`OK   ${relative(root, file)}`);
  } else {
    failed++;
    console.error(`ERR  ${relative(root, file)}`);
  }
}

for (const file of jsonFiles) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
    console.log(`OK   ${relative(root, file)}`);
  } catch (error) {
    failed++;
    console.error(`ERR  ${relative(root, file)}: ${error.message}`);
  }
}

console.log(failed ? `\n${failed} file(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
