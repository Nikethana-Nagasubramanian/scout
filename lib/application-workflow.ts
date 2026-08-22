export type ApplicationWorkflowStage =
  | "resume"
  | "cover_letter"
  | "approve_to_apply"
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
  if (input.coverLetterStatus !== "approved") return "cover_letter";
  if (input.applicationStatus !== "ready_to_apply") return "approve_to_apply";
  return "ready_to_apply";
}
