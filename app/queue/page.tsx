import Link from "next/link";
import {
  createApplicationAction,
  generateResumeAction,
  restoreApplicationToQueueAction,
  updateResumeStatusAction,
} from "@/app/actions";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { ResumeSubmitButton } from "@/components/ResumeSubmitButton";
import { db } from "@/lib/database";
import { queueState, type QueueState } from "@/lib/resume-queue";
import type { ResumeContent } from "@/lib/types";
import { formatDateTime, safeJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

const QUEUE_SEGMENTS = [
  { value: "needs_review", label: "Needs review" },
  { value: "applied", label: "Applied" },
  { value: "rejected", label: "Rejected" },
] as const;

interface QueuePageProps {
  searchParams: Promise<{ q?: string; state?: string }>;
}

interface QueueRow {
  id: number;
  job_id: number;
  status: string;
  content_json: string;
  change_summary: string;
  created_at: string;
  title: string;
  company: string;
  score: number | null;
  apply_url: string;
  description: string;
  application_id: number | null;
  application_status: string | null;
  applied_at: string | null;
  has_cover_letter: number;
}

const emptyContent: ResumeContent = {
  candidateName: "",
  contactLine: "",
  targetTitle: "",
  summary: "",
  skills: [],
  facts: [],
  audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] },
};

/**
 * Generation notes are written for debugging. Only a genuine problem is worth a line in the
 * workflow, and the full text stays available under Generation details.
 */
function generationWarning(changeSummary: string): string {
  return /fallback/i.test(changeSummary) ? "Resume generated using fallback processing." : "";
}

function ResumeActions({ resume }: { resume: QueueRow }) {
  return (
    <div className="queue-artifact-actions">
      <Link className="queue-utility" href={`/jobs/${resume.job_id}?tab=resume`}>Edit</Link>
      <a className="queue-utility" href={`/api/resumes/${resume.id}/pdf?preview=1`} target="_blank" rel="noreferrer">Preview<span aria-hidden="true"> ↗</span></a>
      <a className="queue-utility" href={`/api/resumes/${resume.id}/pdf`}>Download PDF</a>
    </div>
  );
}

function CoverLetterRow({ resume }: { resume: QueueRow }) {
  if (!resume.application_id || !resume.has_cover_letter) {
    return (
      <div className="queue-artifact">
        <div className="queue-artifact-label">
          <strong>Cover letter</strong>
          <span>Not drafted yet</span>
        </div>
        <div className="queue-artifact-actions">
          <Link className="queue-utility" href={`/jobs/${resume.job_id}?tab=cover-letter`}>Write one</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="queue-artifact">
      <div className="queue-artifact-label">
        <strong>Cover letter</strong>
        <span>Ready</span>
      </div>
      <div className="queue-artifact-actions">
        <a className="queue-utility" href={`/api/applications/${resume.application_id}/cover-letter/pdf?preview=1`} target="_blank" rel="noreferrer">Preview<span aria-hidden="true"> ↗</span></a>
        <a className="queue-utility" href={`/api/applications/${resume.application_id}/cover-letter/pdf`}>Download PDF</a>
      </div>
    </div>
  );
}

function QueueCard({ resume, state }: { resume: QueueRow; state: QueueState }) {
  const content = safeJson<ResumeContent>(resume.content_json, emptyContent);
  const unsupported = content.audit?.unsupportedKeywords || [];
  const warning = generationWarning(resume.change_summary);
  const statusLabel = state === "applied" ? "Applied" : state === "rejected" ? "Rejected" : "Needs review";

  return (
    <details className="queue-row">
      <summary className="queue-row-summary">
        <span className="queue-row-chevron" aria-hidden="true" />
        <span className="queue-row-identity">
          <strong>{resume.title}</strong>
          <span>{resume.company}<i aria-hidden="true" />Latest version<i aria-hidden="true" />{formatDateTime(resume.created_at)}</span>
        </span>
        <span className="queue-row-match"><strong>{resume.score ?? 0}%</strong><span>Match</span></span>
        <span className="queue-row-state"><StatusPill status={statusLabel} /></span>
      </summary>

      <div className="queue-row-body">
        {state === "rejected" ? (
          <p className="queue-state-note">
            <strong>Rejected</strong>
            <span>This application was removed from your active queue.</span>
          </p>
        ) : null}
        {state === "applied" ? (
          <p className="queue-state-note applied">
            <strong>Applied</strong>
            <span>{resume.applied_at ? `Marked applied ${formatDateTime(resume.applied_at)}.` : "Marked applied."}</span>
          </p>
        ) : null}

        <div className="queue-artifacts">
          <h3>Application materials</h3>
          <div className="queue-artifact">
            <div className="queue-artifact-label">
              <strong>Resume</strong>
              <span>Updated for this role</span>
              {warning ? <em className="queue-artifact-warning">{warning}</em> : null}
              {unsupported.length ? (
                <em className="queue-artifact-warning">
                  {unsupported.length} {unsupported.length === 1 ? "suggestion was" : "suggestions were"} not added
                </em>
              ) : null}
            </div>
            <ResumeActions resume={resume} />
          </div>
          <CoverLetterRow resume={resume} />
        </div>

        <div className="queue-decision">
          {state === "needs_review" ? (
            <>
              <form action={createApplicationAction}>
                <input type="hidden" name="job_id" value={resume.job_id} />
                <input type="hidden" name="resume_id" value={resume.id} />
                <button className="button queue-primary" type="submit">Mark applied</button>
              </form>
              {resume.apply_url ? (
                <a className="queue-utility" href={resume.apply_url} target="_blank" rel="noreferrer">Open application<span aria-hidden="true"> ↗</span></a>
              ) : null}
              <span className="queue-decision-spacer" />
              <form action={generateResumeAction}>
                <input type="hidden" name="job_id" value={resume.job_id} />
                <ResumeSubmitButton className="queue-utility queue-utility-button">Regenerate</ResumeSubmitButton>
              </form>
              <form action={updateResumeStatusAction}>
                <input type="hidden" name="id" value={resume.id} />
                <input type="hidden" name="status" value="rejected" />
                <button className="queue-utility queue-utility-button queue-reject" type="submit">Reject</button>
              </form>
            </>
          ) : null}

          {state === "rejected" ? (
            <form action={updateResumeStatusAction}>
              <input type="hidden" name="id" value={resume.id} />
              <input type="hidden" name="status" value="draft" />
              <button className="button queue-primary" type="submit">Restore to queue</button>
            </form>
          ) : null}

          {state === "applied" && resume.application_id ? (
            <>
              <Link className="queue-utility" href={`/applications#application-${resume.application_id}`}>Open in Applications</Link>
              <span className="queue-decision-spacer" />
              <form action={restoreApplicationToQueueAction}>
                <input type="hidden" name="id" value={resume.application_id} />
                <button className="queue-utility queue-utility-button" type="submit">Restore to queue</button>
              </form>
            </>
          ) : null}
        </div>

        {resume.change_summary || unsupported.length ? (
          <details className="queue-generation-details">
            <summary>Generation details</summary>
            {resume.change_summary ? <p>{resume.change_summary}</p> : null}
            {unsupported.length ? <p>Not added because no verified fact supports them: {unsupported.join(", ")}.</p> : null}
          </details>
        ) : null}
      </div>
    </details>
  );
}

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const parameters = await searchParams;
  const query = parameters.q?.trim() || "";
  const requested = parameters.state || "needs_review";
  const state: QueueState = QUEUE_SEGMENTS.some((segment) => segment.value === requested)
    ? requested as QueueState
    : "needs_review";

  // One latest resume version per job. Earlier versions stay in the database and remain
  // reachable from the resume editor, but they are not decisions waiting to be made.
  const rows = db.prepare(`
    SELECT resume_versions.*, jobs.title, jobs.company, jobs.score, jobs.apply_url, jobs.description,
      applications.id AS application_id,
      applications.status AS application_status,
      applications.applied_at AS applied_at,
      CASE WHEN cover_letters.id IS NULL THEN 0 ELSE 1 END AS has_cover_letter
    FROM resume_versions
    JOIN jobs ON jobs.id = resume_versions.job_id
    LEFT JOIN applications ON applications.job_id = jobs.id
    LEFT JOIN cover_letters ON cover_letters.application_id = applications.id
    WHERE resume_versions.id = (
      SELECT latest_resume.id
      FROM resume_versions AS latest_resume
      WHERE latest_resume.job_id = jobs.id
      ORDER BY latest_resume.created_at DESC, latest_resume.id DESC
      LIMIT 1
    )
    ORDER BY resume_versions.created_at DESC, resume_versions.id DESC
  `).all() as QueueRow[];

  const counts = { needs_review: 0, applied: 0, rejected: 0 };
  for (const row of rows) counts[queueState(row)] += 1;

  const needle = query.toLowerCase();
  const visible = rows.filter((row) => {
    if (queueState(row) !== state) return false;
    if (!needle) return true;
    return `${row.title} ${row.company}`.toLowerCase().includes(needle);
  });

  return (
    <div className="page">
      <PageHeader title="Resume queue" description="Review your application materials and decide what happens next." />

      <form className="jobs-filter-bar" id="queue-toolbar" action="#queue-toolbar" method="get">
        <label className="jobs-search-field">
          <span className="jobs-search-icon" aria-hidden="true" />
          <input type="search" name="q" defaultValue={query} placeholder="Search the queue by role or company" aria-label="Search the resume queue" />
        </label>
        <div className="jobs-fit-segments" role="group" aria-label="Application state filter">
          {QUEUE_SEGMENTS.map((segment) => (
            <button className={state === segment.value ? "active" : ""} name="state" value={segment.value} type="submit" key={segment.value}>
              {segment.label} <span className="queue-segment-count">{counts[segment.value]}</span>
            </button>
          ))}
        </div>
      </form>

      <section className="queue-list">
        {visible.length ? (
          visible.map((row) => <QueueCard resume={row} state={state} key={row.id} />)
        ) : state === "needs_review" ? (
          <EmptyState title="Nothing waiting on you" body="Prepare a job from the Jobs page to add its tailored resume here." href="/jobs" action="Review jobs" />
        ) : (
          <EmptyState title={`No ${state === "applied" ? "applied" : "rejected"} applications`} body="Applications you finish or set aside are kept here." />
        )}
      </section>
    </div>
  );
}
