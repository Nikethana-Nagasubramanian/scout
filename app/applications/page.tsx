import Link from "next/link";
import { quickUpdateApplicationAction, updateApplicationAction } from "@/app/actions";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { partitionTrackedApplications } from "@/lib/application-tracker";
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
}

function ApplicationCard({ application }: { application: ApplicationRow }) {
  const recruiterSearch = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${application.company} recruiter talent acquisition`)}`;
  const hiringManagerSearch = `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in ${application.company} ${application.title} manager`)}`;

  return (
    <article className="card">
      <div className="card-header">
        <div>
          <Link className="job-title" href={`/jobs/${application.job_id}`}>{application.title}</Link>
          <p>{application.company} · {application.location}</p>
          <span className="job-meta">Applied automatically recorded: {formatDate(application.applied_at)} · Follow-up: {formatDate(application.follow_up_at)}</span>
        </div>
        <StatusPill status={application.status} />
      </div>
      <div className="card-body stack">
        <div className="inline-actions">
          {application.apply_url ? <a className="button secondary small" href={application.apply_url} target="_blank" rel="noreferrer">Application link</a> : null}
          <a className="button secondary small" href={recruiterSearch} target="_blank" rel="noreferrer">Find recruiters</a>
          <a className="button secondary small" href={hiringManagerSearch} target="_blank" rel="noreferrer">Find hiring manager</a>
        </div>
        <div className="inline-actions">
          {[["applied", "Applied"], ["recruiter_screen", "Recruiter screen"], ["interview", "Interview"], ["rejected", "Rejected"], ["offer", "Offer"]].map(([status, label]) => (
            <form action={quickUpdateApplicationAction} key={status}>
              <input type="hidden" name="id" value={application.id} />
              <input type="hidden" name="status" value={status} />
              <button className={status === "rejected" ? "button ghost small danger-text" : "button ghost small"} type="submit">{label}</button>
            </form>
          ))}
        </div>
        <details>
          <summary className="text-link">Optional notes and saved contact</summary>
          <form action={updateApplicationAction} className="form-section compact-form">
            <input type="hidden" name="id" value={application.id} />
            <input type="hidden" name="status" value={application.status} />
            <div className="form-grid">
              <div className="field"><label htmlFor={`contact-${application.id}`}>Contact name</label><input id={`contact-${application.id}`} name="contact_name" defaultValue={application.contact_name} placeholder="Recruiter or hiring manager" /></div>
              <div className="field"><label htmlFor={`details-${application.id}`}>Email or profile link</label><input id={`details-${application.id}`} name="contact_details" defaultValue={application.contact_details} placeholder="Email or LinkedIn URL" /></div>
              <div className="field full"><label htmlFor={`notes-${application.id}`}>Notes</label><textarea id={`notes-${application.id}`} name="notes" defaultValue={application.notes} /></div>
            </div>
            <div className="form-actions"><button className="button" type="submit">Save details</button></div>
          </form>
        </details>
      </div>
    </article>
  );
}

export default function ApplicationsPage() {
  const applications = db.prepare(`
    SELECT applications.*, jobs.title, jobs.company, jobs.location, jobs.apply_url
    FROM applications JOIN jobs ON jobs.id = applications.job_id
    ORDER BY applications.updated_at DESC
  `).all() as ApplicationRow[];
  const { activeApplications, rejectedApplications } = partitionTrackedApplications(applications);

  return (
    <div className="page">
      <PageHeader title="Applications" description="Track submission, follow-up, conversations, and outcomes in one place.">
        <a className="button secondary" href="/api/export/applications">Export CSV</a>
        <a className="button secondary" href="/api/backup">Back up database</a>
      </PageHeader>

      <section className="card">
        <div className="card-header"><div><h2>{activeApplications.length} active applications</h2><p>Update a record whenever the employer responds.</p></div></div>
        {activeApplications.length
          ? <div className="card-body stack">{activeApplications.map((application) => <ApplicationCard application={application} key={application.id} />)}</div>
          : <EmptyState title="No active applications" body="After submitting an application, mark it applied from the resume workspace. Scout records the date and follow-up automatically." href="/jobs" action="Review jobs" />}
      </section>

      {rejectedApplications.length ? (
        <details className="card rejected-applications">
          <summary className="rejected-applications-summary">
            <span className="rejected-applications-heading">
              <strong>Rejected applications</strong>
              <small>Hidden from active tracking</small>
            </span>
            <StatusPill status={`${rejectedApplications.length} rejected`} />
          </summary>
          <div className="card-body stack">
            {rejectedApplications.map((application) => <ApplicationCard application={application} key={application.id} />)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
