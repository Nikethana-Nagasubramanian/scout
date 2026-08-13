import { describe, expect, it } from "vitest";
import {
  atsJobIdentity,
  jobNeedsFreshReview,
  jobRoleSignature,
  normalizeCompanyName,
  normalizeRoleTitle,
} from "@/lib/job-deduplication";

describe("job deduplication identities", () => {
  it("matches manual and official Greenhouse URLs for the same requisition", () => {
    const manual = atsJobIdentity("https://my.greenhouse.io/jobs/tatari/8652422002?query=Product+Designer");
    const official = atsJobIdentity("https://job-boards.greenhouse.io/tatari/jobs/8652422002");
    expect(manual).toBe("greenhouse:tatari:8652422002");
    expect(official).toBe(manual);
  });

  it("extracts an Ashby board and requisition identity", () => {
    expect(atsJobIdentity(
      "https://jobs.ashbyhq.com/bjakcareer/3dfde650-4e74-4668-b190-6c832dd10797/application",
    )).toBe("ashby:bjakcareer:3dfde650-4e74-4668-b190-6c832dd10797");
  });

  it("normalizes company punctuation and role formatting", () => {
    expect(normalizeCompanyName("Co-Star, Inc.")).toBe("co star");
    expect(normalizeRoleTitle("Product Designer (UI/UX) (US)")).toBe("product designer ui ux us");
  });

  it("matches the same company and role across different sources", () => {
    const builtin = jobRoleSignature({
      company: "BJAK",
      title: "Product Designer (UI/UX) (US)",
    });
    const ashby = jobRoleSignature({
      company: "BJAK Inc.",
      title: "Product Designer UI/UX US",
    });
    expect(ashby).toBe(builtin);
  });

  it("keeps only genuinely new and unhandled jobs in the review set", () => {
    const newJob = {
      outcome: "new",
      classification: "eligible",
      duplicate_of_job_id: null,
      job_status: "discovered",
      application_status: null,
      has_resume: 0,
    };
    expect(jobNeedsFreshReview(newJob)).toBe(true);
    expect(jobNeedsFreshReview({ ...newJob, outcome: "refreshed" })).toBe(false);
    expect(jobNeedsFreshReview({ ...newJob, application_status: "applied" })).toBe(false);
    expect(jobNeedsFreshReview({ ...newJob, job_status: "irrelevant" })).toBe(false);
    expect(jobNeedsFreshReview({ ...newJob, duplicate_of_job_id: 12 })).toBe(false);
    expect(jobNeedsFreshReview({ ...newJob, has_resume: 1 })).toBe(false);
  });
});
