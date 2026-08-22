import { describe, expect, it } from "vitest";
import { buildFetchResourceAudit } from "@/lib/fetch-audit";
import type { WorkflowLog } from "@/lib/types";

function log(step: string, message: string, details: Record<string, unknown>, level: WorkflowLog["level"] = "success"): WorkflowLog {
  return {
    id: 1,
    run_id: 36,
    source_id: null,
    step,
    level,
    message,
    details_json: JSON.stringify(details),
    duration_ms: null,
    created_at: "2026-08-15 18:53:24",
    source_name: null,
  };
}

describe("buildFetchResourceAudit", () => {
  it("separates the five resource groups and preserves cooldowns", () => {
    const audit = buildFetchResourceAudit([
      log("workflow.start", "Workflow started.", {
        automaticFeeds: 3,
        companyWatchlistSources: 98,
        companyDiscoverySources: 5,
        gmailAlertsConfigured: true,
      }, "info"),
      log("gmail.complete", "Gmail read 4 messages.", {
        jobsFound: 8,
        relevantJobsFound: 3,
        jobsAdded: 2,
        hiringSignalsFound: 5,
      }),
      log("discovery.complete", "Jobicy returned jobs.", { source: "jobicy", jobsFound: 10, jobsAdded: 1 }),
      log("discovery.cooldown", "Himalayas is cooling down.", { source: "himalayas" }, "warning"),
      log("portfolio.complete", "Greylock UX Designer jobs exposed 2 direct jobs.", { directJobsFound: 2, boardsAdded: 1 }),
      log("portfolio.cooldown", "Designer Fund is cooling down.", {}, "warning"),
      log("portfolio.cooldown", "HiringCafe focused design search is cooling down.", {}, "warning"),
      log("source.complete", "Fireworks returned 60 jobs.", { jobsFound: 60, roleFamilyJobs: 1, jobsUpdated: 1 }),
    ]);

    expect(audit.map((item) => item.key)).toEqual(["gmail", "public", "portfolio", "hiring_cafe", "official"]);
    expect(audit.find((item) => item.key === "gmail")).toMatchObject({
      status: "complete",
      expected: 1,
      checked: 1,
      extracted: 3,
      hiringSignals: 5,
    });
    expect(audit.find((item) => item.key === "public")).toMatchObject({ status: "partial", expected: 3, checked: 1, skipped: 1 });
    expect(audit.find((item) => item.key === "portfolio")).toMatchObject({ status: "partial", expected: 4, checked: 1, skipped: 1 });
    expect(audit.find((item) => item.key === "hiring_cafe")).toMatchObject({ status: "cooldown", expected: 1, skipped: 1 });
    expect(audit.find((item) => item.key === "official")).toMatchObject({ status: "complete", expected: 98, extracted: 1 });
  });
});
