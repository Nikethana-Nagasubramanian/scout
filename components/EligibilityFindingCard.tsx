import { acceptEligibilityFindingAction, dismissEligibilityFindingAction } from "@/app/actions";
import { describeVerdict, type ProposedFinding } from "@/lib/eligibility-research";

/**
 * A proposal, shown as one. The quote and its source are the point: the user is being
 * asked to trust a sentence someone else wrote, not Scout's judgement about it.
 */
export function EligibilityFindingCard({
  finding,
  sponsorshipRequired,
}: {
  finding: ProposedFinding;
  sponsorshipRequired: boolean;
}) {
  const blocking = sponsorshipRequired
    && ["us_work_authorization_required", "clearance_required"].includes(finding.verdict);
  const researched = finding.model !== "deterministic";

  return (
    <div className={`eligibility-finding${blocking ? " is-blocking" : ""}`}>
      <div className="eligibility-finding-head">
        <strong>{describeVerdict(finding.verdict, sponsorshipRequired)}</strong>
        <span className="eligibility-finding-origin">
          {researched ? `Researched across ${finding.pages_read} ${finding.pages_read === 1 ? "page" : "pages"}` : "Found in the posting"}
          {finding.quote_verified ? " · quote checked" : " · quote not confirmed"}
        </span>
      </div>
      {finding.quote ? <blockquote>{finding.quote}</blockquote> : null}
      {finding.source_url ? (
        <a className="text-link" href={finding.source_url} rel="noreferrer" target="_blank">
          Read it in context<span aria-hidden="true"> ↗</span>
        </a>
      ) : null}
      <div className="eligibility-finding-actions">
        <form action={acceptEligibilityFindingAction}>
          <input type="hidden" name="finding_id" value={finding.id} />
          <button className="button small" type="submit">
            {blocking ? "Accept and remove" : "Accept and mark eligible"}
          </button>
        </form>
        <form action={dismissEligibilityFindingAction}>
          <input type="hidden" name="finding_id" value={finding.id} />
          <button className="button ghost small" type="submit">Dismiss</button>
        </form>
      </div>
    </div>
  );
}
