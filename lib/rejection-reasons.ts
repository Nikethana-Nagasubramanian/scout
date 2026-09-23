/**
 * The reason vocabulary, kept free of any database import so client components
 * (the Reject dropdown) can render it without pulling SQLite into the browser bundle.
 */

export type RejectionReason =
  | "wrong_seniority"
  | "wrong_location"
  | "wrong_role_type"
  | "not_this_company"
  | "comp_stage";

export const REJECTION_REASONS: ReadonlyArray<{ value: RejectionReason; label: string }> = [
  { value: "wrong_seniority", label: "Wrong seniority" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "wrong_role_type", label: "Wrong role type" },
  { value: "not_this_company", label: "Not this company" },
  { value: "comp_stage", label: "Comp or stage" },
];

const REASON_LABELS = new Map(REJECTION_REASONS.map((reason) => [reason.value, reason.label]));

export function isRejectionReason(value: string): value is RejectionReason {
  return REASON_LABELS.has(value as RejectionReason);
}

export function reasonLabel(reason: string): string {
  return REASON_LABELS.get(reason as RejectionReason) || reason.replaceAll("_", " ");
}
