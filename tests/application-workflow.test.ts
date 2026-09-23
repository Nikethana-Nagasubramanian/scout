import { describe, expect, it } from "vitest";
import { applicationWorkflowStage, coverLetterQueueDecision } from "@/lib/application-workflow";

describe("applicationWorkflowStage", () => {
  it("keeps resume and cover letter as separate steps, with a single approval into ready to apply", () => {
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

describe("coverLetterQueueDecision", () => {
  const letter = "a".repeat(120);

  it("lets an application queue with no cover letter at all", () => {
    expect(coverLetterQueueDecision("")).toEqual({ allowed: true, skipped: true });
  });

  it("treats whitespace as no letter rather than a short one", () => {
    expect(coverLetterQueueDecision("   \n  ")).toEqual({ allowed: true, skipped: true });
  });

  it("still refuses an unfinished draft", () => {
    expect(coverLetterQueueDecision("Dear team,")).toEqual({ allowed: false, skipped: false });
  });

  it("accepts a real letter and does not mark it skipped", () => {
    expect(coverLetterQueueDecision(letter)).toEqual({ allowed: true, skipped: false });
  });

  it("refuses a letter past the maximum length", () => {
    expect(coverLetterQueueDecision("a".repeat(6_001))).toEqual({ allowed: false, skipped: false });
  });
});
