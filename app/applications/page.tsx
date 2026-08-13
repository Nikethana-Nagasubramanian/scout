import Link from "next/link";
import {
  quickUpdateApplicationAction,
  searchContactsAction,
  updateApplicationAction,
} from "@/app/actions";
import { ContactSearchButton } from "@/components/ContactSearchButton";
import { CoverLetterEditor } from "@/components/CoverLetterEditor";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { partitionTrackedApplications } from "@/lib/application-tracker";
import { hunterConfigured } from "@/lib/contact-research";
import {
  contactResearchActionLabel,
  contactResearchIsTerminal,
} from "@/lib/contact-research-status";
import { db } from "@/lib/database";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ApplicationRow {
  id: number;
  job_id: number;
  resume_version_id: number | null;
  status: string;
  applied_at: string | null;
  follow_up_at: string | null;
  contact_name: string;
  contact_details: string;
  notes: string;
  title: string;
  company: string;
  location: string;
  apply_url: string;
  research_status: string | null;
  person_name: string | null;
  person_title: string | null;
  research_email: string | null;
  email_confidence: number | null;
  evidence_url: string | null;
  research_error: string | null;
  cover_letter_content: string | null;
  cover_letter_method: string | null;
  cover_letter_status: string | null;
  cover_letter_candidate_note: string | null;
}

type ApplicationCardMode = "active" | "attention" | "closed";

function ContactPanel({
  application,
  isHunterConfigured,
}: {
  application: ApplicationRow;
  isHunterConfigured: boolean;
}) {
  const researchStatus = application.research_status || "not_started";
  const contactName = application.person_name || application.contact_name;
  const contactEmail = application.research_email || application.contact_details;

  if (contactName || contactEmail) {
    return (
      <div className="application-contact-summary">
        <div>
          <small>Suggested contact</small>
          <strong>{contactName || "Saved contact"}</strong>
          {application.person_title ? <span>{application.person_title}</span> : null}
        </div>
        <div className="inline-actions">
          {contactEmail ? <a className="text-link" href={`mailto:${contactEmail}`}>{contactEmail}</a> : null}
          {application.evidence_url ? <a className="text-link" href={application.evidence_url} target="_blank" rel="noreferrer">Public evidence</a> : null}
          {application.email_confidence !== null ? <span className="job-meta">{application.email_confidence}% email confidence</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="application-contact-summary empty-contact-summary">
      <div>
        <small>Contact research</small>
        <strong>No validated contact yet</strong>
        {researchStatus !== "not_started" ? <StatusPill status={researchStatus} /> : null}
      </div>
      {!contactResearchIsTerminal(researchStatus) ? (
        <form action={searchContactsAction}>
          <input type="hidden" name="job_id" value={application.job_id} />
          <ContactSearchButton disabled={!isHunterConfigured}>
            {contactResearchActionLabel(application.research_status)}
          </ContactSearchButton>
        </form>
      ) : null}
      {application.research_error ? <span className="contact-research-note">{application.research_error}</span> : null}
    </div>
  );
}

function ApplicationStatusActions({ application }: { application: ApplicationRow }) {
  return (
    <div className="application-status-actions">
      {["applied", "recruiter_screen", "interview", "rejected", "offer"].map((status) => {
        const label = status.replaceAll("_", " ");
        return (
          <form action={quickUpdateApplicationAction} key={status}>
            <input type="hidden" name="id" value={application.id} />
            <input type="hidden" name="status" value={status} />
            <button
              className={status === application.status ? "button secondary small current-status" : status === "rejected" ? "button ghost small danger-text" : "button ghost small"}
              type="submit"
              disabled={status === application.status}
            >
              {label}
            </button>
          </form>
        );
      })}
    </div>
  );
}

function ApplicationCard({
  application,
  mode,
  isHunterConfigured,
}: {
  application: ApplicationRow;
  mode: ApplicationCardMode;
  isHunterConfigured: boolean;
}) {
  const isClosed = mode === "closed";
  const isAttention = mode === "attention";

  const heading = (
    <>
      <div>
        {mode === "active" ? (
          <strong className="job-title">{application.title}</strong>
        ) : (
          <Link className="job-title" href={`/jobs/${application.job_id}`}>{application.title}</Link>
        )}
        <p>{application.company} · {application.location}</p>
        {application.applied_at ? (
          <span className="job-meta">Applied {formatDate(application.applied_at)} · Follow-up {formatDate(application.follow_up_at)}</span>
        ) : null}
      </div>
      <StatusPill status={application.status} />
    </>
  );

  const body = (
    <>
      {application.notes && (isAttention || isClosed) ? <p className="application-state-note">{application.notes}</p> : null}

      <div className="card-body application-card-body">
        <div className="application-primary-actions">
          <Link className="text-link" href={`/jobs/${application.job_id}`}>Scout job details</Link>
          {application.apply_url ? <a className="button secondary small" href={application.apply_url} target="_blank" rel="noreferrer">Application link</a> : null}
          {isAttention ? (
            <>
              <form action={quickUpdateApplicationAction}>
                <input type="hidden" name="id" value={application.id} />
                <input type="hidden" name="status" value="applied" />
                <button className="button small" type="submit">Mark applied</button>
              </form>
              <form action={quickUpdateApplicationAction}>
                <input type="hidden" name="id" value={application.id} />
                <input type="hidden" name="status" value="rejected" />
                <button className="button ghost small danger-text" type="submit">Reject</button>
              </form>
            </>
          ) : null}
        </div>

        <CoverLetterEditor
          applicationId={application.id}
          company={application.company}
          initialContent={application.cover_letter_content || ""}
          initialMethod={application.cover_letter_method || ""}
          initialStatus={application.cover_letter_status || "not_started"}
          initialCandidateNote={application.cover_letter_candidate_note || ""}
        />

        {!isClosed && !isAttention ? <ContactPanel application={application} isHunterConfigured={isHunterConfigured} /> : null}
        {!isClosed && !isAttention ? <ApplicationStatusActions application={application} /> : null}

        {!isClosed ? (
          <details className="application-details">
            <summary className="text-link">Notes and contact details</summary>
            <form action={updateApplicationAction} className="form-section compact-form">
              <input type="hidden" name="id" value={application.id} />
              <input type="hidden" name="status" value={application.status} />
              <div className="form-grid">
                <div className="field"><label htmlFor={`contact-${application.id}`}>Contact name</label><input id={`contact-${application.id}`} name="contact_name" defaultValue={application.contact_name} placeholder="Recruiter or hiring manager" /></div>
                <div className="field"><label htmlFor={`details-${application.id}`}>Email or profile link</label><input id={`details-${application.id}`} name="contact_details" defaultValue={application.contact_details} placeholder="Email or profile URL" /></div>
                <div className="field full"><label htmlFor={`notes-${application.id}`}>Notes</label><textarea id={`notes-${application.id}`} name="notes" defaultValue={application.notes} /></div>
              </div>
              <div className="form-actions"><button className="button" type="submit">Save details</button></div>
            </form>
          </details>
        ) : null}
      </div>
    </>
  );

  if (mode === "active") {
    return (
      <details className="card application-card application-card-active">
        <summary className="application-card-summary">{heading}</summary>
        {body}
      </details>
    );
  }

  return (
    <article className={`card application-card application-card-${mode}`}>
      <div className="card-header application-card-header">
        {heading}
      </div>
      {body}
    </article>
  );
}

function ApplicationAccordion({
  title,
  subtitle,
  applications,
  mode,
  isHunterConfigured,
}: {
  title: string;
  subtitle: string;
  applications: ApplicationRow[];
  mode: "attention" | "closed";
  isHunterConfigured: boolean;
}) {
  if (!applications.length) return null;

  return (
    <details className={`card application-accordion application-accordion-${mode}`}>
      <summary className="application-accordion-summary">
        <span className="application-accordion-heading">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <StatusPill status={`${applications.length}_${title.toLowerCase().replaceAll(" ", "_")}`} />
      </summary>
      <div className="card-body stack">
        {applications.map((application) => (
          <ApplicationCard
            application={application}
            isHunterConfigured={isHunterConfigured}
            key={application.id}
            mode={mode}
          />
        ))}
      </div>
    </details>
  );
}

export default function ApplicationsPage() {
  const isHunterConfigured = hunterConfigured();
  const applications = db.prepare(`
    SELECT applications.*, jobs.title, jobs.company, jobs.location, jobs.apply_url,
      contact_research.status AS research_status,
      contact_research.person_name,
      contact_research.person_title,
      contact_research.email AS research_email,
      contact_research.email_confidence,
      contact_research.evidence_url,
      contact_research.last_error AS research_error,
      cover_letters.content AS cover_letter_content,
      cover_letters.generation_method AS cover_letter_method,
      cover_letters.status AS cover_letter_status,
      cover_letters.candidate_note AS cover_letter_candidate_note
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    LEFT JOIN contact_research ON contact_research.job_id = applications.job_id
    LEFT JOIN cover_letters ON cover_letters.application_id = applications.id
    ORDER BY applications.updated_at DESC
  `).all() as ApplicationRow[];
  const {
    activeApplications,
    needsReviewApplications,
    blockedApplications,
    expiredApplications,
    ineligibleApplications,
    rejectedApplications,
    archivedApplications,
  } = partitionTrackedApplications(applications);

  return (
    <div className="page">
      <PageHeader title="Applications" description="Track submitted applications, follow-ups, outcomes, and contact research in one place.">
        <a className="button secondary" href="/api/export/applications">Export CSV</a>
        <a className="button secondary" href="/api/backup">Back up database</a>
      </PageHeader>

      <section className="card application-active-section">
        <div className="card-header">
          <div>
            <h2>{activeApplications.length} active applications</h2>
            <p>Only submitted applications that still need tracking appear here.</p>
          </div>
        </div>
        {activeApplications.length ? (
          <div className="card-body stack">
            {activeApplications.map((application) => (
              <ApplicationCard
                application={application}
                isHunterConfigured={isHunterConfigured}
                key={application.id}
                mode="active"
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No active applications" body="Submitted applications will appear here automatically." href="/jobs" action="Review jobs" />
        )}
      </section>

      <div className="application-accordion-stack">
        <ApplicationAccordion title="Needs review" subtitle="A question or decision is required before submission" applications={needsReviewApplications} mode="attention" isHunterConfigured={isHunterConfigured} />
        <ApplicationAccordion title="Blocked" subtitle="The company portal prevented submission" applications={blockedApplications} mode="attention" isHunterConfigured={isHunterConfigured} />
        <ApplicationAccordion title="Expired" subtitle="The original role is no longer available" applications={expiredApplications} mode="closed" isHunterConfigured={isHunterConfigured} />
        <ApplicationAccordion title="Ineligible" subtitle="A stated requirement conflicts with the candidate profile" applications={ineligibleApplications} mode="closed" isHunterConfigured={isHunterConfigured} />
        <ApplicationAccordion title="Rejected" subtitle="Hidden from active tracking" applications={rejectedApplications} mode="closed" isHunterConfigured={isHunterConfigured} />
        <ApplicationAccordion title="Archived" subtitle="Withdrawn or archived records" applications={archivedApplications} mode="closed" isHunterConfigured={isHunterConfigured} />
      </div>
    </div>
  );
}
