import {
  jobsNeedingEligibilityResearch,
  researchJobEligibility,
  saveEligibilityFinding,
  type EligibilityQuestion,
} from "@/lib/eligibility-research";

/**
 * Usage: pnpm research:eligibility [limit] [--dry-run] [--clearance]
 *
 * Runs outside the request path on purpose: each job takes tens of seconds across several
 * page fetches, which no server action should ever hold open.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const question: EligibilityQuestion = args.includes("--clearance") ? "clearance" : "us_eligibility";
  const limit = Number(args.find((arg) => /^\d+$/.test(arg)) || 5);

  const jobs = jobsNeedingEligibilityResearch(limit, question);
  if (!jobs.length) {
    console.log("No jobs are waiting on this question.");
    return;
  }
  console.log(`Researching ${question} for ${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}${dryRun ? " (dry run, nothing saved)" : ""}.\n`);

  // Haiku 4.5 list price, for a rough per-run cost rather than a guess.
  const INPUT_PER_TOKEN = 1 / 1_000_000;
  const OUTPUT_PER_TOKEN = 5 / 1_000_000;
  let spend = 0;
  const counts = new Map<string, number>();
  for (const job of jobs) {
    console.log(`[${job.id}] ${job.company} - ${job.title}`);
    try {
      const finding = await researchJobEligibility(job, {
        question,
        onTrace: (line) => console.log(line),
      });
      counts.set(finding.verdict, (counts.get(finding.verdict) || 0) + 1);
      const cost = finding.inputTokens * INPUT_PER_TOKEN + finding.outputTokens * OUTPUT_PER_TOKEN;
      spend += cost;
      const mark = finding.verdict === "unknown" ? "-" : finding.quoteVerified ? "verified" : "QUOTE NOT FOUND";
      console.log(`  => ${finding.verdict} [${mark}] after ${finding.pagesRead} ${finding.pagesRead === 1 ? "page" : "pages"}, ${finding.inputTokens} in / ${finding.outputTokens} out, $${cost.toFixed(4)}`);
      if (finding.quote) console.log(`     "${finding.quote.slice(0, 160)}"`);
      if (finding.sourceUrl) console.log(`     ${finding.sourceUrl}`);
      if (!dryRun) saveEligibilityFinding(finding);
    } catch (error) {
      console.log(`  => failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log("");
  }

  console.log("Verdicts:", [...counts.entries()].map(([verdict, n]) => `${verdict}=${n}`).join(" ") || "none");
  console.log(`Spend: $${spend.toFixed(4)} total, $${(spend / jobs.length).toFixed(4)} per job.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
