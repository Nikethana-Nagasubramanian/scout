interface TrackedApplication {
  status: string;
}

export function partitionTrackedApplications<T extends TrackedApplication>(applications: T[]) {
  return {
    activeApplications: applications.filter((application) => ![
      "needs_review",
      "preparing",
      "blocked",
      "expired",
      "ineligible",
      "rejected",
      "withdrawn",
      "archived",
      "ready_to_apply",
    ].includes(application.status)),
    needsReviewApplications: applications.filter((application) => application.status === "needs_review"),
    blockedApplications: applications.filter((application) => application.status === "blocked"),
    expiredApplications: applications.filter((application) => application.status === "expired"),
    ineligibleApplications: applications.filter((application) => application.status === "ineligible"),
    rejectedApplications: applications.filter((application) => application.status === "rejected"),
    archivedApplications: applications.filter((application) => ["withdrawn", "archived"].includes(application.status)),
  };
}
