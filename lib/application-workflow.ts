export type ApplicationWorkflowStage =
  | "resume"
  | "cover_letter"
  | "ready_to_apply"
  | "submitted";

export interface CoverLetterQueueDecision {
  /** Whether this submission may queue the application. */
  allowed: boolean;
  /** True when the user is queueing without a letter at all. */
  skipped: boolean;
}

export const COVER_LETTER_MIN_LENGTH = 80;
export const COVER_LETTER_MAX_LENGTH = 6_000;

/**
 * A cover letter is optional. Empty means "apply without one", which is allowed.
 * A few characters is not a choice, it is an unfinished draft, so the minimum still
 * applies to anything actually written.
 */
export function coverLetterQueueDecision(content: string): CoverLetterQueueDecision {
  const trimmed = content.trim();
  if (trimmed.length === 0) return { allowed: true, skipped: true };
  const allowed = trimmed.length >= COVER_LETTER_MIN_LENGTH && trimmed.length <= COVER_LETTER_MAX_LENGTH;
  return { allowed, skipped: false };
}

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
