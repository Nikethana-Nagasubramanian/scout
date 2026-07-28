import { describe, expect, it } from "vitest";
import { partitionTrackedApplications } from "@/lib/application-tracker";

describe("partitionTrackedApplications", () => {
  it("removes rejected applications from the active list", () => {
    const result = partitionTrackedApplications([
      { id: 1, status: "applied" },
      { id: 2, status: "rejected" },
      { id: 3, status: "interview" },
    ]);

    expect(result.activeApplications.map((application) => application.id)).toEqual([1, 3]);
    expect(result.rejectedApplications.map((application) => application.id)).toEqual([2]);
  });
});
