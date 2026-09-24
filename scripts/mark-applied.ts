import { db } from "@/lib/database";

/**
 * Usage: pnpm mark:applied 183 196 201 [--dry-run]
 *
 * Records submissions made somewhere Scout cannot reach - an external applier running off
 * an exported bundle, or an application submitted by hand. Same effect as the Mark applied
 * button, including the follow-up date and the event trail.
 */
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ids = args.filter((arg) => /^\d+$/.test(arg)).map(Number);

if (!ids.length) {
  console.log("Pass one or more application ids, e.g. pnpm mark:applied 183 196");
  process.exit(1);
}

const lookup = db.prepare(`
  SELECT applications.id, applications.status, jobs.company, jobs.title
  FROM applications JOIN jobs ON jobs.id = applications.job_id
  WHERE applications.id = ?
`);
const markApplied = db.prepare(`
  UPDATE applications
  SET status = 'applied',
    applied_at = COALESCE(applied_at, CURRENT_TIMESTAMP),
    follow_up_at = COALESCE(follow_up_at, datetime('now', '+7 days')),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);
const logEvent = db.prepare("INSERT INTO application_events (application_id, status, note) VALUES (?, 'applied', ?)");

let applied = 0;
let skipped = 0;
for (const id of ids) {
  const row = lookup.get(id) as { id: number; status: string; company: string; title: string } | undefined;
  if (!row) {
    console.log(`[${id}] no such application - skipped`);
    skipped += 1;
    continue;
  }
  if (row.status === "applied") {
    console.log(`[${id}] ${row.company} - already applied, left alone`);
    continue;
  }
  if (row.status !== "ready_to_apply") {
    // Refusing here is the point: marking a half-prepared application applied would hide it forever.
    console.log(`[${id}] ${row.company} - is '${row.status}', not ready_to_apply - skipped`);
    skipped += 1;
    continue;
  }
  if (!dryRun) {
    markApplied.run(id);
    logEvent.run(id, "Submitted outside Scout and recorded by hand.");
  }
  console.log(`[${id}] ${row.company} - ${row.title} -> applied`);
  applied += 1;
}

console.log(`\n${applied} marked applied${dryRun ? " (dry run, nothing written)" : ""}, ${skipped} skipped.`);
