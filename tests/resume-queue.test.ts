import { describe, expect, it } from "vitest";
import { coverLetterPdfFilename, resumePdfFilename } from "@/lib/resume-filename";
import { partitionResumeQueue, queueState } from "@/lib/resume-queue";

describe("resumePdfFilename", () => {
  it("uses the candidate prefix and a safe company segment", () => {
    expect(resumePdfFilename("Fieldguide")).toBe("Nikethana_Resume_Fieldguide.pdf");
    expect(resumePdfFilename("Brown Brothers & Harriman")).toBe("Nikethana_Resume_Brown_Brothers_Harriman.pdf");
    expect(resumePdfFilename("  ")).toBe("Nikethana_Resume_Company.pdf");
  });

  it("uses the cover letter naming convention", () => {
    expect(coverLetterPdfFilename("Fieldguide")).toBe("Nikethana_CoverLetter_Fieldguide.pdf");
    expect(coverLetterPdfFilename("Brown Brothers & Harriman")).toBe("Nikethana_CoverLetter_Brown_Brothers_Harriman.pdf");
  });
});

describe("partitionResumeQueue", () => {
  it("separates an earlier rejected version from the latest pending version", () => {
    const queue = partitionResumeQueue([
      { id: 3, job_id: 8, status: "draft", application_status: "ready_to_apply" },
      { id: 2, job_id: 8, status: "rejected", application_status: "ready_to_apply" },
      { id: 1, job_id: 7, status: "draft", application_status: null },
    ]);

    expect(queue.pendingGroups.map((group) => group[0].job_id)).toEqual([8, 7]);
    expect(queue.pendingGroups[0].map((resume) => resume.id)).toEqual([3]);
    expect(queue.rejectedGroups.map((group) => group[0].job_id)).toEqual([8]);
    expect(queue.rejectedGroups[0].map((resume) => resume.id)).toEqual([2]);
  });

  it("moves the job out of pending when its latest version is rejected", () => {
    const queue = partitionResumeQueue([
      { id: 3, job_id: 8, status: "rejected", application_status: null },
      { id: 2, job_id: 8, status: "draft", application_status: null },
    ]);

    expect(queue.pendingGroups).toEqual([]);
    expect(queue.rejectedGroups[0].map((resume) => resume.id)).toEqual([3]);
  });

  it("removes jobs only after an application is actually active", () => {
    const queue = partitionResumeQueue([
      { id: 2, job_id: 8, status: "approved", application_status: "applied" },
      { id: 1, job_id: 7, status: "approved", application_status: null },
    ]);

    expect(queue.approvedGroups.map((group) => group[0].job_id)).toEqual([7]);
  });

  it("keeps an approved resume visible while the application package is being prepared", () => {
    const queue = partitionResumeQueue([
      { id: 3, job_id: 9, status: "approved", application_status: "preparing" },
    ]);

    expect(queue.approvedGroups.map((group) => group[0].job_id)).toEqual([9]);
  });
});

describe("queue state model", () => {
  it("treats a rejected resume as rejected whatever the application says", () => {
    expect(queueState({ status: "rejected", application_status: "ready_to_apply" })).toBe("rejected");
    expect(queueState({ status: "rejected", application_status: null })).toBe("rejected");
  });

  it("treats an applied application as finished", () => {
    expect(queueState({ status: "approved", application_status: "applied" })).toBe("applied");
  });

  it("leaves everything else waiting on a decision", () => {
    expect(queueState({ status: "draft", application_status: null })).toBe("needs_review");
    expect(queueState({ status: "approved", application_status: "ready_to_apply" })).toBe("needs_review");
    expect(queueState({ status: "approved", application_status: "preparing" })).toBe("needs_review");
  });

  it("keeps a rejected application out of the applied tab", () => {
    // A rejected resume on an applied job is history, not an active application.
    expect(queueState({ status: "rejected", application_status: "applied" })).toBe("rejected");
  });
});
