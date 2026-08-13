import Link from "next/link";
import { searchContactsAction } from "@/app/actions";
import { ContactSearchButton } from "@/components/ContactSearchButton";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { hunterAccountUsage, hunterBudgetStatus, hunterConfigured } from "@/lib/contact-research";
import { contactResearchActionLabel, contactResearchIsTerminal } from "@/lib/contact-research-status";
import { partitionContactOpportunities } from "@/lib/contact-opportunity-tracker";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

interface ContactOpportunity {
  id: number;
  title: string;
  company: string;
  apply_url: string;
  status: string;
  application_status: string | null;
  contact_name: string | null;
  contact_details: string | null;
  research_status: string | null;
  company_size_label: string | null;
  person_name: string | null;
  person_title: string | null;
  research_email: string | null;
  email_confidence: number | null;
  evidence_url: string | null;
  evidence_summary: string | null;
  credits_used: number | null;
  last_error: string | null;
}

function ContactOpportunityTable({
  opportunities,
  isHunterConfigured,
}: {
  opportunities: ContactOpportunity[];
  isHunterConfigured: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="contact-table">
        <thead>
          <tr>
            <th>Opportunity</th>
            <th>Company context</th>
            <th>Evidence-based contact</th>
            <th>Contact action</th>
            <th>Application</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => {
            const researchStatus = opportunity.research_status || "not_started";
            const terminalResearch = contactResearchIsTerminal(researchStatus);
            const contactName = opportunity.person_name || opportunity.contact_name;
            const contactEmail = opportunity.research_email || opportunity.contact_details;

            return (
              <tr key={opportunity.id}>
                <td>
                  <Link className="job-title" href={`/jobs/${opportunity.id}`}>{opportunity.title}</Link>
                  <span className="job-meta">{opportunity.company}</span>
                </td>
                <td>
                  <StatusPill status={researchStatus} />
                  {opportunity.company_size_label ? (
                    <span className="job-meta">{opportunity.company_size_label} employees</span>
                  ) : (
                    <span className="job-meta">{researchStatus === "not_started" ? "Size not checked" : "Size unavailable, search allowed"}</span>
                  )}
                  {opportunity.credits_used ? (
                    <span className="job-meta">{opportunity.credits_used.toFixed(1)} Hunter credits used</span>
                  ) : null}
                </td>
                <td className="contact-evidence-cell">
                  {contactName || contactEmail ? (
                    <>
                      <span className="job-title">{contactName || "Saved contact"}</span>
                      {opportunity.person_title ? <span className="job-meta">{opportunity.person_title}</span> : null}
                      {contactEmail ? <a className="text-link" href={`mailto:${contactEmail}`}>{contactEmail}</a> : null}
                      {opportunity.email_confidence !== null ? <span className="job-meta">{opportunity.email_confidence}% Hunter confidence</span> : null}
                      {opportunity.evidence_url ? (
                        <a className="text-link" href={opportunity.evidence_url} target="_blank" rel="noreferrer">View public evidence</a>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">No validated contact yet</span>
                  )}
                  {opportunity.evidence_summary ? <span className="contact-evidence-summary">{opportunity.evidence_summary}</span> : null}
                  {opportunity.last_error ? <span className="contact-research-note">{opportunity.last_error}</span> : null}
                </td>
                <td>
                  {!terminalResearch ? (
                    <form action={searchContactsAction}>
                      <input type="hidden" name="job_id" value={opportunity.id} />
                      <ContactSearchButton disabled={!isHunterConfigured}>
                        {contactResearchActionLabel(opportunity.research_status)}
                      </ContactSearchButton>
                    </form>
                  ) : null}
                  <span className="job-meta">Fully automated</span>
                </td>
                <td>
                  {opportunity.apply_url
                    ? <a className="button secondary small" href={opportunity.apply_url} target="_blank" rel="noreferrer">Open application</a>
                    : <span className="muted">Unavailable</span>}
                </td>
                <td><StatusPill status={opportunity.application_status || opportunity.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContactOpportunityAccordion({
  title,
  subtitle,
  opportunities,
  isHunterConfigured,
  tone = "closed",
}: {
  title: string;
  subtitle: string;
  opportunities: ContactOpportunity[];
  isHunterConfigured: boolean;
  tone?: "attention" | "closed";
}) {
  if (!opportunities.length) return null;

  return (
    <details className={`card application-accordion application-accordion-${tone}`}>
      <summary className="application-accordion-summary">
        <span className="application-accordion-heading">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <StatusPill status={`${opportunities.length}_${title.toLowerCase().replaceAll(" ", "_")}`} />
      </summary>
      <ContactOpportunityTable opportunities={opportunities} isHunterConfigured={isHunterConfigured} />
    </details>
  );
}

function hunterResetLabel(value: string): string {
  if (!value) return "";
  const timestamp = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(timestamp);
}

export default async function ContactsPage() {
  const budget = hunterBudgetStatus();
  const accountUsage = await hunterAccountUsage();
  const isHunterConfigured = hunterConfigured();
  const opportunities = db.prepare(`
    SELECT jobs.id, jobs.title, jobs.company, jobs.apply_url, jobs.status,
      applications.status AS application_status,
      applications.contact_name,
      applications.contact_details,
      contact_research.status AS research_status,
      contact_research.company_size_label,
      contact_research.person_name,
      contact_research.person_title,
      contact_research.email AS research_email,
      contact_research.email_confidence,
      contact_research.evidence_url,
      contact_research.evidence_summary,
      contact_research.credits_used,
      contact_research.last_error
    FROM jobs
    LEFT JOIN applications ON applications.job_id = jobs.id
    LEFT JOIN contact_research ON contact_research.job_id = jobs.id
    WHERE applications.id IS NOT NULL OR jobs.status IN ('reviewing', 'shortlisted')
    ORDER BY applications.updated_at DESC, jobs.score DESC, jobs.first_seen_at DESC
    LIMIT 100
  `).all() as ContactOpportunity[];
  const {
    researchOpportunities,
    appliedOpportunities,
    needsReviewOpportunities,
    blockedOpportunities,
    expiredOpportunities,
    ineligibleOpportunities,
    rejectedOpportunities,
    archivedOpportunities,
  } = partitionContactOpportunities(opportunities);

  return (
    <div className="page">
      <PageHeader
        title="Contact research"
        description="Find one evidence-backed decision-maker for every serious application."
      >
        <div className="contact-budget">
          <StatusPill status={isHunterConfigured ? "hunter_ready" : "hunter_not_configured"} />
          <strong>{accountUsage
            ? `${accountUsage.remaining.toFixed(1)} of ${accountUsage.available.toFixed(1)} Hunter credits left`
            : `${budget.remaining.toFixed(1)} of ${budget.budget.toFixed(1)} Scout budget left`}</strong>
        </div>
      </PageHeader>

      <section className="card contact-policy-card">
        <div className="card-header">
          <div>
            <h2>On-demand and fully automated</h2>
            <p>Job fetching never starts contact research. Clicking Search contacts authorizes the full workflow for that company, regardless of company size.</p>
          </div>
        </div>
        <div className="contact-policy-grid">
          <div><strong>1. Resolve the company</strong><span>Scout resolves the company domain and records its employee range when Hunter has it. Company size never blocks your request.</span></div>
          <div><strong>2. Find a real person automatically</strong><span>Scout inspects company leadership, team, about, newsroom, and blog pages. You do not need to run a separate public or LinkedIn search.</span></div>
          <div><strong>3. Validate one email</strong><span>Scout uses Hunter only after finding a named person, then rejects generic addresses and low-confidence inferred patterns.</span></div>
          <div className="hunter-usage-step">
            <strong>4. Monitor Hunter usage</strong>
            <span>
              {accountUsage ? <><b>{accountUsage.used.toFixed(1)} of {accountUsage.available.toFixed(1)} Hunter credits used.</b> {accountUsage.remaining.toFixed(1)} remain{accountUsage.resetDate ? ` until ${hunterResetLabel(accountUsage.resetDate)}` : ""}. </> : null}
              Scout has recorded {budget.used.toFixed(1)} of its {budget.budget.toFixed(1)}-credit allowance.
            </span>
          </div>
        </div>
      </section>
      <div className="spacer" />

      <section className="card">
        <div className="card-header">
          <div>
            <h2>{researchOpportunities.length} contacts to research</h2>
            <p>Shortlisted opportunities that have not moved into the application tracker</p>
          </div>
        </div>
        {researchOpportunities.length ? (
          <ContactOpportunityTable opportunities={researchOpportunities} isHunterConfigured={isHunterConfigured} />
        ) : (
          <EmptyState title="No pre-application contacts waiting" body="Shortlist another job to create a new contact research plan." href="/jobs" action="Review jobs" />
        )}
      </section>

      <div className="spacer" />
      <div className="application-accordion-stack">
        <ContactOpportunityAccordion title="Applied" subtitle="Submitted applications and active interview stages" opportunities={appliedOpportunities} isHunterConfigured={isHunterConfigured} />
        <ContactOpportunityAccordion title="Needs review" subtitle="Applications waiting for a manual decision" opportunities={needsReviewOpportunities} isHunterConfigured={isHunterConfigured} tone="attention" />
        <ContactOpportunityAccordion title="Blocked" subtitle="Applications that could not be completed" opportunities={blockedOpportunities} isHunterConfigured={isHunterConfigured} tone="attention" />
        <ContactOpportunityAccordion title="Expired" subtitle="Roles that are no longer available" opportunities={expiredOpportunities} isHunterConfigured={isHunterConfigured} />
        <ContactOpportunityAccordion title="Ineligible" subtitle="Roles with a confirmed candidate requirement conflict" opportunities={ineligibleOpportunities} isHunterConfigured={isHunterConfigured} />
        <ContactOpportunityAccordion title="Rejected" subtitle="Closed opportunities kept out of the active contact queue" opportunities={rejectedOpportunities} isHunterConfigured={isHunterConfigured} />
        <ContactOpportunityAccordion title="Archived" subtitle="Withdrawn or archived opportunities" opportunities={archivedOpportunities} isHunterConfigured={isHunterConfigured} />
      </div>
    </div>
  );
}
