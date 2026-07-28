interface TrackedApplication {
  status: string;
}

export function partitionTrackedApplications<T extends TrackedApplication>(applications: T[]) {
  return {
    activeApplications: applications.filter((application) => application.status !== "rejected"),
    rejectedApplications: applications.filter((application) => application.status === "rejected"),
  };
}
