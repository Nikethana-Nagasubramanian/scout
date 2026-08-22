import { describe, expect, it } from "vitest";
import { applicationWorkflowStage } from "@/lib/application-workflow";

describe("applicationWorkflowStage", () => {
  it("keeps resume, cover letter, and final application approval as separate steps", () => {
    expect(applicationWorkflowStage({
      resumeApproved: false,
      coverLetterStatus: null,
      applicationStatus: null,
    })).toBe("resume");
    expect(applicationWorkflowStage({
      resumeApproved: true,
      coverLetterStatus: "edited",
      applicationStatus: "preparing",
    })).toBe("cover_letter");
    expect(applicationWorkflowStage({
      resumeApproved: true,
      coverLetterStatus: "approved",
      applicationStatus: "preparing",
    })).toBe("approve_to_apply");
    expect(applicationWorkflowStage({
      resumeApproved: true,
      coverLetterStatus: "approved",
      applicationStatus: "ready_to_apply",
    })).toBe("ready_to_apply");
  });

  it("does not reopen approval for a submitted application", () => {
    expect(applicationWorkflowStage({
      resumeApproved: true,
      coverLetterStatus: "approved",
      applicationStatus: "applied",
    })).toBe("submitted");
  });
});
