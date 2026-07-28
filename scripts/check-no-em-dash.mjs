import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".md", ".json", ".sh"]);
const ignoredDirectories = new Set([".git", ".next", "node_modules", "data", "coverage"]);
const failures = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      await scan(path);
    } else if (textExtensions.has(extname(entry.name))) {
      const content = await readFile(path, "utf8");
      if (content.includes("\u2014")) failures.push(path);
    }
  }
}

await scan(".");

if (failures.length) {
  console.error(`Forbidden em dash found in: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("No em dash characters found.");
