import Link from "next/link";
import { notFound } from "next/navigation";
import { approveJobAction, generateResumeAction, updateJobStatusAction } from "@/app/actions";
import { ResumeEditor } from "@/components/ResumeEditor";
import { ConfidenceBadge, ScoreBadge, StatusPill } from "@/components/UI";
import { ResumeSubmitButton } from "@/components/ResumeSubmitButton";
import { db } from "@/lib/database";
import { inferRequiredExperience } from "@/lib/job-fit";
import type { ConfidenceBreakdown, Job, ResumeContent, ScoreBreakdown } from "@/lib/types";
import { formatDate, safeJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface JobPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ imported?: string; tab?: string }>;
}

interface ResumeRow {
  id: number;
  status: string;
  content_json: string;
}

interface ApplicationRow {
  id: number;
  status: string;
}

type WorkspaceTab = "description" | "match" | "resume";

function selectedTab(value: string | undefined): WorkspaceTab {
  return value === "match" || value === "resume" ? value : "description";
}

function salaryLabel(job: Job): string {
  if (!job.salary_min && !job.salary_max) return "Salary not listed";
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: job.salary_currency || "USD",
    maximumFractionDigits: 0,
  });
  if (job.salary_min && job.salary_max) return `${formatter.format(job.salary_min)} to ${formatter.format(job.salary_max)}`;
  return job.salary_min ? `From ${formatter.format(job.salary_min)}` : `Up to ${formatter.format(job.salary_max || 0)}`;
}

function experienceLabel(description: string): string {
  const experience = inferRequiredExperience(description);
  if (experience.minimum !== null && experience.maximum !== null && experience.minimum !== experience.maximum) {
    return `${experience.minimum} to ${experience.maximum} years`;
  }
  if (experience.minimum !== null) return `${experience.minimum}+ years`;
  if (experience.maximum !== null) return `Up to ${experience.maximum} years`;
  return "Experience not stated";
}

export default async function JobDetailPage({ params, searchParams }: JobPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(id)) as Job | undefined;
  if (!job) notFound();

  const tab = selectedTab(query.tab);
  const breakdown = safeJson<ScoreBreakdown>(job.score_breakdown, {
    title: 0, skills: 0, seniority: 0, location: 0, recency: 0, compensation: 0,
    total: 0, eligibilityStatus: job.eligibility_status, hardFilterPass: true,
    hardFilterReasons: [], verificationReasons: [], matchingSkills: [], missingSkills: [],
  });
  const confidence = safeJson<ConfidenceBreakdown>(job.confidence_breakdown, {
    sourceIntegrity: 0, freshness: 0, completeness: 0, specificity: 0, repeatedSightings: 0,
    companyActivity: 0, riskAdjustment: 0, total: 0, dataSufficiency: "low", positiveSignals: [], cautionSignals: [],
  });
  const latestResume = db.prepare(`
    SELECT id, status, content_json
    FROM resume_versions
    WHERE job_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(job.id) as ResumeRow | undefined;
  const application = db.prepare("SELECT id, status FROM applications WHERE job_id = ?").get(job.id) as ApplicationRow | undefined;
  const resumeContent = latestResume ? safeJson<ResumeContent>(latestResume.content_json, {
    candidateName: "",
    contactLine: "",
    targetTitle: job.title,
    summary: "",
    skills: [],
    facts: [],
    sections: [],
    audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] },
  }) : null;
  const sourceLabel = job.source_type === "ashby"
    ? "Ashby application"
    : job.source_type === "greenhouse"
      ? "Greenhouse application"
      : job.source_type === "lever"
        ? "Lever application"
        : `${job.source_name || job.source_type} source`;
  const rejected = ["irrelevant", "dismissed", "archived"].includes(job.status);

  return (
    <div className="page job-workspace-page">
      <header className="job-workspace-header">
        <div>
          <Link className="workspace-back-link" href="/jobs">Back to jobs</Link>
          <h1>{job.title} <span aria-hidden="true">·</span> {job.company}</h1>
          <p className="job-workspace-meta">
            <span>{job.location || "Location not listed"}</span>
            <span>{salaryLabel(job)}</span>
            <span>{experienceLabel(job.description)}</span>
          </p>
        </div>
        <div className="job-workspace-actions">
          {application && application.status !== "ready_to_apply" ? (
            <Link className="button" href="/applications">View application</Link>
          ) : latestResume?.status === "approved" ? (
            job.apply_url ? <a className="button" href={job.apply_url} target="_blank" rel="noreferrer">Open application</a> : null
          ) : latestResume && latestResume.status !== "rejected" ? (
            <Link className="button" href={`/jobs/${job.id}?tab=resume`}>Review resume</Link>
          ) : (
            <form action={approveJobAction}>
              <input type="hidden" name="id" value={job.id} />
              <ResumeSubmitButton className="button">Approve</ResumeSubmitButton>
            </form>
          )}
          {!rejected ? (
            <form action={updateJobStatusAction}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="status" value="irrelevant" />
              <button className="button danger" type="submit">Reject</button>
            </form>
          ) : <StatusPill status="rejected" />}
        </div>
      </header>

      {query.imported === "1" ? (
        <div className="callout success" role="status">
          <strong>Job imported and scored.</strong> Scout opened the workspace so you can review it immediately.
        </div>
      ) : null}

      <nav className="workspace-tabs" aria-label="Job workspace">
        <Link className={tab === "description" ? "active" : ""} href={`/jobs/${job.id}`}>Job Description</Link>
        <Link className={tab === "match" ? "active" : ""} href={`/jobs/${job.id}?tab=match`}>Profile Match</Link>
        <Link className={tab === "resume" ? "active" : ""} href={`/jobs/${job.id}?tab=resume`}>Edit Resume</Link>
      </nav>

      {tab === "description" ? (
        <section className="card workspace-content-card">
          <div className="workspace-card-tools">
            {job.apply_url ? <a className="text-link" href={job.apply_url} target="_blank" rel="noreferrer">View application</a> : null}
            <span className="source-chip">{sourceLabel}</span>
          </div>
          <div className="workspace-job-description">{job.description || "No job description was provided by this source."}</div>
          <footer className="workspace-source-note">
            Collected {formatDate(job.first_seen_at)} · Last seen {formatDate(job.last_seen_at)}
            {job.canonical_url ? <a className="text-link" href={job.canonical_url} target="_blank" rel="noreferrer">View source</a> : null}
          </footer>
        </section>
      ) : null}

      {tab === "match" ? (
        <div className="workspace-match-grid">
          <section className="card workspace-score-card">
            <div className="card-header">
              <div><h2>Profile match</h2><p>{job.match_summary}</p></div>
              <ScoreBadge score={job.score} passed={job.hard_filter_pass !== 0} />
            </div>
            <div className="card-body">
              {!breakdown.hardFilterPass ? <div className="callout warning"><strong>Eligibility conflict</strong><ul>{breakdown.hardFilterReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}
              {breakdown.verificationReasons.length ? <div className="callout warning"><strong>Needs verification</strong><ul>{breakdown.verificationReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}
              <ul className="breakdown-list workspace-breakdown">
                <li><span>Title alignment</span><strong>{breakdown.title}/25</strong></li>
                <li><span>Requirement coverage</span><strong>{breakdown.skills}/35</strong></li>
                <li><span>Seniority</span><strong>{breakdown.seniority}/15</strong></li>
                <li><span>Location</span><strong>{breakdown.location}/10</strong></li>
                <li><span>Recency</span><strong>{breakdown.recency}/10</strong></li>
                <li><span>Compensation</span><strong>{breakdown.compensation}/5</strong></li>
              </ul>
              <div className="workspace-requirements">
                <div><h3>Requirements with evidence</h3><div className="tag-list">{breakdown.matchingSkills.length ? breakdown.matchingSkills.map((item) => <span className="tag match" key={item}>{item}</span>) : <span className="muted">No supported requirements detected.</span>}</div></div>
                <div><h3>Requirements without evidence</h3><div className="tag-list">{breakdown.missingSkills.length ? breakdown.missingSkills.map((item) => <span className="tag" key={item}>{item}</span>) : <span className="muted">No unsupported requirements detected.</span>}</div></div>
              </div>
            </div>
          </section>

          <section className="card workspace-score-card">
            <div className="card-header">
              <div><h2>Posting signal</h2><p>{job.confidence_summary || "Waiting for scoring data."}</p></div>
              <ConfidenceBadge score={job.confidence_score} />
            </div>
            <div className="card-body">
              <div className="callout warning">This is an approval aid, not proof that the role is active or funded.</div>
              <ul className="breakdown-list workspace-breakdown">
                <li><span>Source integrity</span><strong>{confidence.sourceIntegrity}/15</strong></li>
                <li><span>Freshness</span><strong>{confidence.freshness}/25</strong></li>
                <li><span>Completeness</span><strong>{confidence.completeness}/20</strong></li>
                <li><span>Specificity</span><strong>{confidence.specificity}/15</strong></li>
                <li><span>Repeated sightings</span><strong>{confidence.repeatedSightings}/10</strong></li>
                <li><span>Company activity</span><strong>{confidence.companyActivity}/15</strong></li>
                <li><span>Risk adjustment</span><strong>{confidence.riskAdjustment}</strong></li>
              </ul>
              <div className="workspace-signal-copy">
                <div><h3>Positive signals</h3>{confidence.positiveSignals.length ? <ul>{confidence.positiveSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul> : <p className="muted">No strong positive signals yet.</p>}</div>
                <div><h3>Caution signals</h3>{confidence.cautionSignals.length ? <ul>{confidence.cautionSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul> : <p className="muted">No material cautions detected.</p>}</div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "resume" ? (
        latestResume && resumeContent && latestResume.status !== "rejected" ? (
          <ResumeEditor
            resumeId={latestResume.id}
            resumeStatus={latestResume.status}
            jobId={job.id}
            initialContent={resumeContent}
            jobDescription={job.description}
            jobTitle={job.title}
            company={job.company}
            applyUrl={job.apply_url}
            applicationStatus={application?.status || null}
            embedded
          />
        ) : (
          <section className="card workspace-empty-resume">
            <h2>Prepare a tailored resume</h2>
            <p>Scout will preserve your verified experience, prioritize relevant evidence, and create an editable PDF preview for this role.</p>
            <form action={generateResumeAction}>
              <input type="hidden" name="job_id" value={job.id} />
              <ResumeSubmitButton>Generate tailored resume</ResumeSubmitButton>
            </form>
          </section>
        )
      ) : null}
    </div>
  );
}
