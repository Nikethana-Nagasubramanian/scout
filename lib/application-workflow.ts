export type ApplicationWorkflowStage =
  | "resume"
  | "cover_letter"
  | "ready_to_apply"
  | "submitted";

export function applicationWorkflowStage(input: {
  resumeApproved: boolean;
  coverLetterStatus: string | null;
  applicationStatus: string | null;
}): ApplicationWorkflowStage {
  if (input.applicationStatus && !["preparing", "ready_to_apply"].includes(input.applicationStatus)) {
    return "submitted";
  }
  if (!input.resumeApproved) return "resume";
  if (input.applicationStatus !== "ready_to_apply") return "cover_letter";
  return "ready_to_apply";
}
