import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const RULES = [
  {
    directory: "src/grade",
    forbidden: ["@mariozechner/pi-coding-agent", "@mariozechner/pi-ai", "createAgentSession", "ModelRegistry", "SessionManager", "AuthStorage"],
  },
  {
    directory: "src/aggregate",
    forbidden: ["@mariozechner/pi-coding-agent", "@mariozechner/pi-ai", "createAgentSession", "ModelRegistry", "SessionManager", "AuthStorage"],
  },
];

function listFiles(directory) {
  const results = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...listFiles(fullPath));
      continue;
    }
    if (extname(fullPath) === ".ts") {
      results.push(fullPath);
    }
  }
  return results;
}

const violations = [];

for (const rule of RULES) {
  for (const filePath of listFiles(rule.directory)) {
    const source = readFileSync(filePath, "utf8");
    for (const forbiddenFragment of rule.forbidden) {
      if (source.includes(forbiddenFragment)) {
        violations.push(`${filePath}: contains forbidden fragment ${JSON.stringify(forbiddenFragment)}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture check failed. Grade and aggregate must stay pure file-based stages.");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Architecture check passed.");
