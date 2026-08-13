import { describe, expect, it } from "vitest";
import { partitionTrackedApplications } from "@/lib/application-tracker";

describe("partitionTrackedApplications", () => {
  it("separates active, attention, and closed application states", () => {
    const result = partitionTrackedApplications([
      { id: 1, status: "applied" },
      { id: 2, status: "rejected" },
      { id: 3, status: "interview" },
      { id: 4, status: "needs_review" },
      { id: 5, status: "blocked" },
      { id: 6, status: "expired" },
      { id: 7, status: "ineligible" },
      { id: 8, status: "archived" },
      { id: 9, status: "ready_to_apply" },
    ]);

    expect(result.activeApplications.map((application) => application.id)).toEqual([1, 3]);
    expect(result.needsReviewApplications.map((application) => application.id)).toEqual([4]);
    expect(result.blockedApplications.map((application) => application.id)).toEqual([5]);
    expect(result.expiredApplications.map((application) => application.id)).toEqual([6]);
    expect(result.ineligibleApplications.map((application) => application.id)).toEqual([7]);
    expect(result.rejectedApplications.map((application) => application.id)).toEqual([2]);
    expect(result.archivedApplications.map((application) => application.id)).toEqual([8]);
  });
});
