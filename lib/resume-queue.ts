export interface ResumeQueueRow {
  job_id: number;
  status: string;
  application_status: string | null;
}

export function partitionResumeQueue<T extends ResumeQueueRow>(resumes: T[]) {
  const eligibleResumes = resumes.filter((resume) => {
    return !resume.application_status || ["preparing", "ready_to_apply"].includes(resume.application_status);
  });
  const jobGroups = [...eligibleResumes.reduce((grouped, resume) => {
    const existing = grouped.get(resume.job_id) || [];
    existing.push(resume);
    grouped.set(resume.job_id, existing);
    return grouped;
  }, new Map<number, T[]>()).values()];

  const pendingGroups: T[][] = [];
  const approvedGroups: T[][] = [];
  const rejectedGroups: T[][] = [];

  for (const group of jobGroups) {
    const rejectedVersions = group.filter((resume) => resume.status === "rejected");
    if (rejectedVersions.length) rejectedGroups.push(rejectedVersions);
    if (group[0].status === "rejected") continue;

    const activeVersions = group.filter((resume) => resume.status !== "rejected");
    if (group[0].status === "draft") pendingGroups.push(activeVersions);
    if (group[0].status === "approved") approvedGroups.push(activeVersions);
  }

  return { pendingGroups, approvedGroups, rejectedGroups };
}
