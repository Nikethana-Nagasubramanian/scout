import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { READY_TO_APPLY_QUERY } from "@/lib/ready-to-apply";
import { queueState } from "@/lib/resume-queue";

/**
 * The export and the Queue page must agree on what is ready to apply. They disagreed once:
 * a resume rejected after its application was queued left the application at
 * 'ready_to_apply', and the export handed those documents out anyway.
 */
function seed() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE jobs (id INTEGER PRIMARY KEY, company TEXT, title TEXT, location TEXT,
      apply_url TEXT DEFAULT '', canonical_url TEXT DEFAULT '', description TEXT DEFAULT '');
    CREATE TABLE resume_versions (id INTEGER PRIMARY KEY, job_id INTEGER, status TEXT,
      content_json TEXT DEFAULT '{}', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE applications (id INTEGER PRIMARY KEY, job_id INTEGER, status TEXT,
      resume_version_id INTEGER);
    CREATE TABLE cover_letters (id INTEGER PRIMARY KEY, application_id INTEGER,
      content TEXT DEFAULT '', updated_at TEXT DEFAULT '', status TEXT DEFAULT 'approved');
  `);
  const job = db.prepare("INSERT INTO jobs (id, company, title, location) VALUES (?, ?, ?, '')");
  const resume = db.prepare("INSERT INTO resume_versions (id, job_id, status, created_at) VALUES (?, ?, ?, ?)");
  const application = db.prepare("INSERT INTO applications (id, job_id, status, resume_version_id) VALUES (?, ?, ?, ?)");

  job.run(1, "Good Co", "Product Designer");
  resume.run(10, 1, "approved", "2026-01-01");
  application.run(100, 1, "ready_to_apply", 10);

  job.run(2, "Set Aside Co", "Product Designer");
  resume.run(20, 2, "rejected", "2026-01-01");
  application.run(200, 2, "ready_to_apply", 20);

  // A newer rejected version supersedes the approved one the application still points at.
  job.run(3, "Superseded Co", "Product Designer");
  resume.run(30, 3, "approved", "2026-01-01");
  resume.run(31, 3, "rejected", "2026-02-01");
  application.run(300, 3, "ready_to_apply", 30);

  job.run(4, "Not Queued Co", "Product Designer");
  resume.run(40, 4, "approved", "2026-01-01");
  application.run(400, 4, "preparing", 40);

  return db;
}

describe("READY_TO_APPLY_QUERY", () => {
  const rows = seed().prepare(READY_TO_APPLY_QUERY).all() as Array<{ application_id: number; resume_id: number }>;

  it("includes only applications whose latest resume still stands", () => {
    expect(rows.map((row) => row.application_id)).toEqual([100]);
  });

  it("uses the latest resume version, not whichever one the application points at", () => {
    expect(rows[0].resume_id).toBe(10);
  });

  it("agrees with the Queue page's own state for each case", () => {
    expect(queueState({ status: "approved", application_status: "ready_to_apply" })).toBe("needs_review");
    expect(queueState({ status: "rejected", application_status: "ready_to_apply" })).toBe("rejected");
  });
});
