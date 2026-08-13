import { describe, expect, it } from "vitest";
import { partitionContactOpportunities } from "@/lib/contact-opportunity-tracker";

describe("partitionContactOpportunities", () => {
  it("separates pre-application research from every application state", () => {
    const result = partitionContactOpportunities([
      { id: 1, status: "shortlisted", application_status: null },
      { id: 2, status: "reviewing", application_status: null },
      { id: 3, status: "shortlisted", application_status: "applied" },
      { id: 4, status: "shortlisted", application_status: "recruiter_screen" },
      { id: 5, status: "shortlisted", application_status: "needs_review" },
      { id: 6, status: "shortlisted", application_status: "blocked" },
      { id: 7, status: "shortlisted", application_status: "expired" },
      { id: 8, status: "shortlisted", application_status: "ineligible" },
      { id: 9, status: "shortlisted", application_status: "rejected" },
      { id: 10, status: "shortlisted", application_status: "archived" },
    ]);

    expect(result.researchOpportunities.map((item) => item.id)).toEqual([1, 2]);
    expect(result.appliedOpportunities.map((item) => item.id)).toEqual([3, 4]);
    expect(result.needsReviewOpportunities.map((item) => item.id)).toEqual([5]);
    expect(result.blockedOpportunities.map((item) => item.id)).toEqual([6]);
    expect(result.expiredOpportunities.map((item) => item.id)).toEqual([7]);
    expect(result.ineligibleOpportunities.map((item) => item.id)).toEqual([8]);
    expect(result.rejectedOpportunities.map((item) => item.id)).toEqual([9]);
    expect(result.archivedOpportunities.map((item) => item.id)).toEqual([10]);
  });
});
