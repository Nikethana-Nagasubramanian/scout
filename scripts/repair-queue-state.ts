import { db } from "@/lib/database";

/**
 * Usage: pnpm repair:queue [--dry-run]
 *
 * One-off repair for applications left at 'ready_to_apply' while their latest resume was
 * rejected. Rejecting a resume now demotes the application, but rows created before that
 * still claim to be ready. Applications already applied to are never touched.
 */
const dryRun = process.argv.includes("--dry-run");

const stale = db.prepare(`
  SELECT applications.id, applications.status, jobs.company, jobs.title,
    latest_resume.id AS resume_id, latest_resume.status AS resume_status
  FROM applications
  JOIN jobs ON jobs.id = applications.job_id
  JOIN resume_versions AS latest_resume ON latest_resume.id = (
    SELECT candidate.id FROM resume_versions AS candidate
    WHERE candidate.job_id = jobs.id
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  )
  WHERE applications.status = 'ready_to_apply'
    AND latest_resume.status = 'rejected'
  ORDER BY applications.id
`).all() as Array<{ id: number; company: string; title: string; resume_id: number; resume_status: string }>;

if (!stale.length) {
  console.log("Nothing to repair: no queued application has a rejected resume.");
} else {
  const demote = db.prepare("UPDATE applications SET status = 'preparing', updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  const log = db.prepare("INSERT INTO application_events (application_id, status, note) VALUES (?, 'preparing', ?)");
  const apply = db.transaction(() => {
    for (const row of stale) {
      demote.run(row.id);
      log.run(row.id, "Returned to preparation because the resume was rejected.");
    }
  });

  for (const row of stale) {
    console.log(`[${row.id}] ${row.company} - ${row.title} (resume ${row.resume_id} rejected)`);
  }
  if (!dryRun) apply();
  console.log(`\n${stale.length} ${stale.length === 1 ? "application" : "applications"} moved back to preparing${dryRun ? " (dry run, nothing written)" : ""}.`);
}
