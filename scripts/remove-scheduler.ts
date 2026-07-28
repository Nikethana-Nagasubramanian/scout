import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

async function main(): Promise<void> {
  const plistPath = join(homedir(), "Library", "LaunchAgents", "local.scout.job-collector.plist");
  const userId = process.getuid?.();
  if (userId !== undefined) {
    try { execFileSync("launchctl", ["bootout", `gui/${userId}`, plistPath], { stdio: "ignore" }); } catch { }
  }
  try { await unlink(plistPath); } catch { }
  console.log("Scout scheduler removed.");
}

void main();
