import Link from "next/link";
import { createApplicationAction, generateResumeAction, updateJobStatusAction, updateResumeStatusAction } from "@/app/actions";
import { ConfidenceBadge, EmptyState, PageHeader, ScoreBadge, StatusPill } from "@/components/UI";
import { ResumeSubmitButton } from "@/components/ResumeSubmitButton";
import { db, getSetting } from "@/lib/database";
import { partitionResumeQueue } from "@/lib/resume-queue";
import { resumeSkillCategories } from "@/lib/resume-skills";
import type { Job, ResumeContent } from "@/lib/types";
import { formatDateTime, safeJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ResumeRow {
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
  application_status: string | null;
  application_id: number | null;
  is_latest: number;
}

function ResumeVersionCard({ resume, isLatest, openByDefault = isLatest }: { resume: ResumeRow; isLatest: boolean; openByDefault?: boolean }) {
  const content = safeJson<ResumeContent>(resume.content_json, {
    candidateName: "",
    contactLine: "",
    targetTitle: "",
    summary: "",
    skills: [],
    facts: [],
    audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] },
  });

  return (
    <details className={`resume-version-card card ${isLatest ? "latest" : "older"}`} open={openByDefault}>
      <summary className="resume-version-summary">
        <span className="resume-version-chevron" aria-hidden="true">›</span>
        <span className="resume-version-title">
          <strong>{resume.title}</strong>
          <small>{resume.company} · {isLatest ? "Latest version" : "Earlier version"} · {formatDateTime(resume.created_at)}</small>
        </span>
        <span className="resume-version-badges"><ScoreBadge score={resume.score} /><StatusPill status={resume.status} /></span>
      </summary>
      <div className="card-body">
        {isLatest ? (
          <div className="resume-decision-bar">
            <div>
              <strong>Resume decision</strong>
              <small>Choose what happens next</small>
            </div>
            <div className="inline-actions">
              <form action={generateResumeAction}><input type="hidden" name="job_id" value={resume.job_id} /><ResumeSubmitButton className="button secondary small">Regenerate</ResumeSubmitButton></form>
              {resume.status !== "approved" && resume.status !== "rejected" ? (
                <form action={updateResumeStatusAction}><input type="hidden" name="id" value={resume.id} /><input type="hidden" name="status" value="approved" /><button className="button small" type="submit">Approve</button></form>
              ) : null}
              {resume.status === "rejected" ? (
                <form action={updateResumeStatusAction}><input type="hidden" name="id" value={resume.id} /><input type="hidden" name="status" value="draft" /><button className="button secondary small" type="submit">Restore to pending</button></form>
              ) : (
                <>
                  {resume.status !== "approved" ? (
                    <form action={updateResumeStatusAction}><input type="hidden" name="id" value={resume.id} /><input type="hidden" name="status" value="rejected" /><button className="button danger small" type="submit">Reject</button></form>
                  ) : null}
                  <form action={createApplicationAction}><input type="hidden" name="job_id" value={resume.job_id} /><input type="hidden" name="resume_id" value={resume.id} /><button className="button secondary small" type="submit">Mark applied</button></form>
                </>
              )}
            </div>
          </div>
        ) : null}
        <p className="muted version-change-summary">{resume.change_summary}</p>
        {!content.sections?.length ? <div className="callout warning"><strong>Legacy draft:</strong> regenerate this resume to use the new ATS-safe structure and inline editor.</div> : null}
        <div className="resume-preview-shell">
          <div className="resume-preview-toolbar" aria-label="Resume file actions">
            <div className="inline-actions">
              {resume.apply_url ? <a className="text-link" href={resume.apply_url} target="_blank" rel="noreferrer">Open application</a> : null}
              <Link className="text-link" href={`/jobs/${resume.job_id}?tab=resume`}>Edit resume</Link>
            </div>
            <a className="button secondary small" href={`/api/resumes/${resume.id}/pdf`}>Download PDF</a>
          </div>
          <div className="resume-preview">
            <h2>{content.candidateName || "Candidate name"}</h2>
            <p className="contact">{content.contactLine}</p>
            {content.summary ? <><h3>SUMMARY</h3><p>{content.summary}</p></> : null}
            <h3>SKILLS</h3>
            {resumeSkillCategories(content, resume.description).map((category, index) => <p className="resume-skill-category" key={`${category.name}-${index}`}><strong>{category.name}:</strong> {category.skills.join(", ")}</p>)}
            {content.sections?.length
              ? content.sections.map((section) => <div key={section.title}><h3>{section.title}</h3>{section.lines.map((line, index) => line.kind === "divider" ? <hr key={`divider-${index}`} /> : line.kind === "bullet" ? <ul key={`${line.text}-${index}`}><li>{line.text}</li></ul> : <p className={line.kind === "entry" ? "resume-entry" : undefined} key={`${line.text}-${index}`}>{line.text}</p>)}</div>)
              : [...new Set(content.facts.map((fact) => fact.category))].map((category) => <div key={category}><h3>{category.toUpperCase()}</h3><ul>{content.facts.filter((fact) => fact.category === category).map((fact, index) => <li key={`${fact.claim}-${index}`}>{fact.claim}</li>)}</ul></div>)}
          </div>
        </div>
        <div className="spacer" />
        {content.audit.unsupportedKeywords.length ? <div className="callout warning"><strong>Not added because they are unsupported:</strong> {content.audit.unsupportedKeywords.join(", ")}</div> : <div className="callout">All included claims trace to verified facts in the truth bank.</div>}
      </div>
    </details>
  );
}

function ResumeGroupList({ groups, openLatest = true }: { groups: ResumeRow[][]; openLatest?: boolean }) {
  return groups.map((group) => (
    <section className="resume-version-group" key={group[0].job_id}>
      {group.map((resume) => <ResumeVersionCard resume={resume} isLatest={resume.is_latest === 1} openByDefault={resume.is_latest === 1 && openLatest} key={resume.id} />)}
    </section>
  ));
}

export default function QueuePage() {
  const minimumScore = Number(getSetting("minimum_queue_score", "65"));
  const matchedJobs = db.prepare(`
    SELECT * FROM jobs
    WHERE eligibility_status = 'eligible'
      AND (status = 'shortlisted' OR score >= ?)
      AND status NOT IN ('irrelevant', 'dismissed', 'archived')
      AND id NOT IN (SELECT job_id FROM resume_versions)
    ORDER BY score DESC, first_seen_at DESC
    LIMIT 25
  `).all(minimumScore) as Job[];
  const resumes = db.prepare(`
    SELECT resume_versions.*, jobs.title, jobs.company, jobs.score, jobs.apply_url, jobs.description,
      applications.id AS application_id,
      applications.status AS application_status,
      CASE WHEN resume_versions.id = (
        SELECT latest_resume.id
        FROM resume_versions AS latest_resume
        WHERE latest_resume.job_id = jobs.id
        ORDER BY latest_resume.created_at DESC, latest_resume.id DESC
        LIMIT 1
      ) THEN 1 ELSE 0 END AS is_latest
    FROM resume_versions
    JOIN jobs ON jobs.id = resume_versions.job_id
    LEFT JOIN applications ON applications.job_id = jobs.id
    ORDER BY resume_versions.created_at DESC, resume_versions.id DESC
  `).all() as ResumeRow[];
  const { pendingGroups, approvedGroups, rejectedGroups } = partitionResumeQueue(resumes);

  return (
    <div className="page">
      <PageHeader title="Resume queue" description="Decide which tailored resumes are ready to use. Applied jobs move to Applications." />

      <div className="dashboard-grid">
        <div className="stack">
          <section className="card">
            <div className="card-header"><div><h2>Pending decision</h2><p>Review the latest tailored resume for each job</p></div><StatusPill status={`${pendingGroups.length} pending`} /></div>
            {pendingGroups.length ? <div className="card-body stack"><ResumeGroupList groups={pendingGroups} /></div> : <EmptyState title="No pending resumes" body="Prepare a job from the Jobs page to add its tailored resume here." href="/jobs" action="Review jobs" />}
          </section>

          {approvedGroups.length ? (
            <section className="card" id="approved-to-apply">
              <div className="card-header"><div><h2>Resume approved</h2><p>Finish the cover letter, then approve the complete application</p></div><StatusPill status={`${approvedGroups.length} approved`} /></div>
              <div className="card-body stack"><ResumeGroupList groups={approvedGroups} /></div>
            </section>
          ) : null}

          {rejectedGroups.length ? (
            <section className="card rejected-resumes" id="rejected-resumes">
              <div className="card-header"><div><h2>Rejected resumes</h2><p>Kept below the active queue in case you need to recover one</p></div><StatusPill status={`${rejectedGroups.length} rejected`} /></div>
              <div className="card-body stack"><ResumeGroupList groups={rejectedGroups} openLatest={false} /></div>
            </section>
          ) : null}
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-header"><div><h2>Ready to prepare</h2><p>Eligible jobs with no tailored resume yet</p></div></div>
            {matchedJobs.length ? <div className="card-body stack">{matchedJobs.map((job) => <article key={job.id}>
              <div className="inline-actions"><ScoreBadge score={job.score} /><ConfidenceBadge score={job.confidence_score} /></div>
              <Link className="job-title" href={`/jobs/${job.id}`}>{job.title}</Link><span className="job-meta">{job.company} · {job.location}</span>
              <p className="muted">{job.match_summary}</p>
              <div className="inline-actions"><Link className="button small" href={`/jobs/${job.id}`}>Prepare application</Link><form action={updateJobStatusAction}><input type="hidden" name="id" value={job.id} /><input type="hidden" name="status" value="dismissed" /><button className="button ghost small danger-text" type="submit">Dismiss</button></form></div>
            </article>)}</div> : <EmptyState title="Queue is clear" body="Fetch new jobs or lower the score threshold in Automation." href="/settings" action="Review automation" />}
          </section>
        </aside>
      </div>
    </div>
  );
}
