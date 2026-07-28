import { db, getSetting } from "../lib/database";
import { runCollection } from "../lib/collector";

try {
  process.loadEnvFile(".env");
} catch {
  // Scheduled collection can still use environment variables provided by launchd.
}

interface Slot {
  key: string;
  enabled: boolean;
  time: string;
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

async function main(): Promise<void> {
  if (getSetting("collection_mode", "manual") !== "automatic") {
    console.log("Automatic collection is disabled.");
    return;
  }

  const slots: Slot[] = ["morning", "afternoon", "evening", "night"].map((key) => ({
    key,
    enabled: getSetting(`${key}_enabled`, "0") === "1",
    time: getSetting(`${key}_time`, "00:00"),
  }));
  const now = new Date();
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  for (const slot of slots) {
    if (!slot.enabled) continue;
    const delta = currentMinute - minutes(slot.time);
    if (delta < 0) continue;
    const existing = db.prepare(`
      SELECT id FROM collection_runs
      WHERE slot = ? AND date(started_at, 'localtime') = ? AND status != 'running'
      LIMIT 1
    `).get(slot.key, date);
    if (existing) continue;
    const result = await runCollection(slot.key);
    console.log(`${slot.key}: ${result.jobsFound} found, ${result.jobsAdded} new`);
  }
}

void main();
