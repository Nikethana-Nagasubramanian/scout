import { db } from "@/lib/database";
import { saveEligibilityFinding } from "@/lib/eligibility-research";
import { sponsorshipFromPosting } from "@/lib/sponsorship-text";
import type { Job } from "@/lib/types";

/**
 * Usage: pnpm read:sponsorship [--dry-run]
 *
 * Reads the stated policy straight out of every posting. Free, instant, and the pass that
 * has to run before any research agent is pointed at the remainder.
 */
const dryRun = process.argv.includes("--dry-run");

const jobs = db.prepare(`
  SELECT jobs.* FROM jobs
  WHERE jobs.duplicate_of_job_id IS NULL
    AND jobs.eligibility_status = 'needs_verification'
    AND jobs.status NOT IN ('irrelevant', 'dismissed', 'archived')
  ORDER BY jobs.score DESC
`).all() as Job[];

let found = 0;
for (const job of jobs) {
  const stated = sponsorshipFromPosting(job.description);
  if (!stated) continue;
  found += 1;
  console.log(`[${job.id}] ${job.company} - ${stated.verdict}`);
  console.log(`     "${stated.quote.slice(0, 150)}"`);
  if (!dryRun) {
    saveEligibilityFinding({
      jobId: job.id,
      question: "us_eligibility",
      verdict: stated.verdict,
      quote: stated.quote,
      sourceUrl: job.canonical_url || job.apply_url || "",
      reasoning: "Stated directly in the job posting.",
      quoteVerified: true,
      pagesRead: 0,
      model: "deterministic",
      inputTokens: 0,
      outputTokens: 0,
    });
  }
}

console.log(`\n${found} of ${jobs.length} postings state a policy. Cost: $0.00${dryRun ? " (dry run, nothing saved)" : ""}.`);
