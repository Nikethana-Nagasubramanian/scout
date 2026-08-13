interface ContactOpportunityStatus {
  status: string;
  application_status: string | null;
}

export function effectiveContactOpportunityStatus(opportunity: ContactOpportunityStatus): string {
  return opportunity.application_status || opportunity.status;
}

export function partitionContactOpportunities<T extends ContactOpportunityStatus>(opportunities: T[]) {
  const hasStatus = (opportunity: T, statuses: string[]) => (
    statuses.includes(effectiveContactOpportunityStatus(opportunity))
  );

  return {
    researchOpportunities: opportunities.filter((opportunity) => (
      !opportunity.application_status && ["reviewing", "shortlisted"].includes(opportunity.status)
    )),
    appliedOpportunities: opportunities.filter((opportunity) => hasStatus(opportunity, [
      "applied",
      "follow_up_due",
      "recruiter_screen",
      "interview",
      "offer",
    ])),
    needsReviewOpportunities: opportunities.filter((opportunity) => hasStatus(opportunity, ["needs_review"])),
    blockedOpportunities: opportunities.filter((opportunity) => hasStatus(opportunity, ["blocked"])),
    expiredOpportunities: opportunities.filter((opportunity) => hasStatus(opportunity, ["expired"])),
    ineligibleOpportunities: opportunities.filter((opportunity) => hasStatus(opportunity, ["ineligible"])),
    rejectedOpportunities: opportunities.filter((opportunity) => hasStatus(opportunity, ["rejected"])),
    archivedOpportunities: opportunities.filter((opportunity) => hasStatus(opportunity, ["withdrawn", "archived"])),
  };
}
