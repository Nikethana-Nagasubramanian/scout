const RETRYABLE_CONTACT_STATUSES = new Set([
  "failed",
  "domain_not_found",
  "domain_ambiguous",
  "invalidated",
  "no_public_contact",
  "no_email",
  "email_unverified",
]);

export function contactResearchActionLabel(status: string | null): string {
  if (!status || status === "not_started") return "Search contacts";
  if (status === "large_company" || status === "size_unknown") return "Search contacts anyway";
  if (RETRYABLE_CONTACT_STATUSES.has(status)) return "Try contact search again";
  return "Search contacts";
}

export function contactResearchIsTerminal(status: string | null): boolean {
  return status === "found" || status === "budget_exhausted";
}
