import Link from "next/link";
import { addManualJobAction, approveJobAction, runWorkflowAction } from "@/app/actions";
import { ConfidenceBadge, PageHeader, ScoreBadge, StatusPill } from "@/components/UI";
import { JobTriageButtons } from "@/components/JobTriageButtons";
import { ResumeSubmitButton } from "@/components/ResumeSubmitButton";
import { WorkflowSubmitButton } from "@/components/WorkflowSubmitButton";
import { db } from "@/lib/database";
import type { Job, ScoreBreakdown } from "@/lib/types";
import { relativeAge, safeJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface SearchProps {
  searchParams: Promise<{ q?: string; status?: string; fit?: string; run?: string }>;
}

interface RunSummary {
  id: number;
  status: string;
  jobs_found: number;
  jobs_added: number;
  jobs_updated: number;
  error_summary: string;
  eligible_jobs: number;
  filtered_jobs: number;
  outcome_jobs: number;
}

interface JobListRow extends Job {
  latest_resume_id: number | null;
  latest_resume_status: string | null;
  application_status: string | null;
  run_outcome: string | null;
  run_eligible: number | null;
  run_reasons_json: string | null;
}

export default async function JobsPage({ searchParams }: SearchProps) {
  const parameters = await searchParams;
  const query = parameters.q?.trim() || "";
  const runId = Number(parameters.run);
  const run = Number.isFinite(runId) && runId > 0
    ? db.prepare(`
        SELECT collection_runs.id, collection_runs.status, collection_runs.jobs_found,
          collection_runs.jobs_added, collection_runs.jobs_updated, collection_runs.error_summary,
          (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND eligible = 1) AS eligible_jobs,
          (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND eligible = 0) AS filtered_jobs,
          (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id) AS outcome_jobs
        FROM collection_runs
        WHERE collection_runs.id = ?
      `).get(runId) as RunSummary | undefined
    : undefined;
  const status = parameters.status || (run ? "all" : "active");
  const fit = parameters.fit || (run ? "all" : "eligible");
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (query) {
    clauses.push("(title LIKE ? OR company LIKE ? OR description LIKE ?)");
    values.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (status === "active") {
    clauses.push("status IN ('discovered', 'reviewing')");
  } else if (status !== "all") {
    clauses.push("status = ?");
    values.push(status);
  }
  if (fit === "eligible") clauses.push("hard_filter_pass = 1");
  if (fit === "strong") clauses.push("hard_filter_pass = 1 AND score >= 80");
  if (fit === "promising") clauses.push("hard_filter_pass = 1 AND score BETWEEN 65 AND 79");
  if (fit === "filtered") clauses.push("hard_filter_pass = 0");

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const runJoin = run
    ? "INNER JOIN collection_job_results AS run_result ON run_result.job_id = jobs.id AND run_result.run_id = ?"
    : "";
  const runColumns = run
    ? "run_result.outcome AS run_outcome, run_result.eligible AS run_eligible, run_result.reasons_json AS run_reasons_json"
    : "NULL AS run_outcome, NULL AS run_eligible, NULL AS run_reasons_json";
  const jobs = db.prepare(`
    SELECT jobs.*,
      ${runColumns},
      (
        SELECT resume_versions.id
        FROM resume_versions
        WHERE resume_versions.job_id = jobs.id
        ORDER BY resume_versions.created_at DESC, resume_versions.id DESC
        LIMIT 1
      ) AS latest_resume_id,
      (
        SELECT resume_versions.status
        FROM resume_versions
        WHERE resume_versions.job_id = jobs.id
        ORDER BY resume_versions.created_at DESC, resume_versions.id DESC
        LIMIT 1
      ) AS latest_resume_status,
      (
        SELECT applications.status
        FROM applications
        WHERE applications.job_id = jobs.id
        LIMIT 1
      ) AS application_status
    FROM jobs
    ${runJoin}
    ${where}
    ORDER BY hard_filter_pass DESC, score DESC, first_seen_at DESC
    LIMIT 250
  `).all(...(run ? [run.id, ...values] : values)) as JobListRow[];

  return (
    <div className="page">
      <PageHeader title="Jobs" description="Fetch, review, and decide which opportunities deserve your time.">
        <form action={runWorkflowAction}>
          <input type="hidden" name="slot" value="manual" />
          <WorkflowSubmitButton>Fetch new jobs</WorkflowSubmitButton>
        </form>
      </PageHeader>
      {run ? (
        <section className={`callout fetch-result ${run.status === "completed" ? "success" : "warning"}`} role="status">
          <div>
            <strong>{run.status === "failed" ? "Fetch failed" : "Fetch complete"}</strong>
            {run.outcome_jobs > 0 ? (
              <p>{run.jobs_found} fetched, {run.jobs_added} newly saved, and {run.jobs_updated} seen before. {run.eligible_jobs} passed your filters and {run.filtered_jobs} were filtered. {run.error_summary}</p>
            ) : (
              <p>{run.jobs_found} fetched, {run.jobs_added} newly saved, and {run.jobs_updated} seen before. This older fetch did not retain per-job outcomes. {run.error_summary}</p>
            )}
          </div>
          <div className="inline-actions">
            <Link className="text-link" href={`/jobs?run=${run.id}&fit=all&status=all`}>All fetched</Link>
            <Link className="text-link" href={`/jobs?run=${run.id}&fit=eligible&status=all`}>Passed filters</Link>
            <Link className="text-link" href={`/jobs?run=${run.id}&fit=filtered&status=all`}>Filtered</Link>
            <Link className="text-link" href={`/diagnostics?run=${run.id}`}>Technical details</Link>
          </div>
        </section>
      ) : null}
      <form className="card filter-bar" method="get">
        {run ? <input type="hidden" name="run" value={run.id} /> : null}
        <input type="search" name="q" defaultValue={query} placeholder="Search title, company, or description" aria-label="Search jobs" />
        <select name="fit" defaultValue={fit} aria-label="Fit filter"><option value="eligible">Eligible only</option><option value="strong">Strong, 80+</option><option value="promising">Promising, 65 to 79</option><option value="all">All fit levels</option><option value="filtered">Hard filtered</option></select>
        <select name="status" defaultValue={status} aria-label="Status filter"><option value="active">Active only</option><option value="all">All statuses</option><option value="discovered">Discovered</option><option value="reviewing">Reviewing</option><option value="shortlisted">Shortlisted</option><option value="irrelevant">Irrelevant</option><option value="dismissed">Dismissed</option></select>
        <button className="button secondary" type="submit">Filter</button>
      </form>

      <details className="card form-card">
        <summary className="text-link">Import a job manually</summary>
        <form action={addManualJobAction} className="form-section">
          <div className="form-grid">
            <div className="field"><label htmlFor="company">Company</label><input id="company" name="company" required /></div>
            <div className="field"><label htmlFor="title">Job title</label><input id="title" name="title" required /></div>
            <div className="field"><label htmlFor="location">Location</label><input id="location" name="location" /></div>
            <div className="field"><label htmlFor="url">Job URL</label><input id="url" name="url" type="url" /></div>
            <div className="field"><label htmlFor="workplace_type">Workplace</label><select id="workplace_type" name="workplace_type"><option value="unspecified">Not specified</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="on-site">On-site</option></select></div>
            <div className="field"><label htmlFor="employment_type">Employment type</label><input id="employment_type" name="employment_type" placeholder="Full-time" /></div>
            <div className="field full"><label htmlFor="description">Job description</label><textarea id="description" name="description" required rows={10} /></div>
          </div>
          <div className="form-actions"><button className="button" type="submit">Import and score</button></div>
        </form>
      </details>
      <div className="spacer" />

      <section className="card">
        <div className="card-header"><div><h2>{run ? `${jobs.length} results from Fetch ${run.id}` : `${jobs.length} opportunities`}</h2><p>{run ? "Every saved result from this fetch remains inspectable" : "Showing up to 250 ranked results"}</p></div></div>
        {jobs.length ? <div className="table-wrap"><table><thead><tr><th>Role</th><th>Location</th><th>Fit</th><th>Why</th><th>Confidence</th><th>{run ? "Fetch result" : "Found"}</th><th>Status</th><th>Decision</th><th>Application</th><th /></tr></thead><tbody>
          {jobs.map((job) => {
            const breakdown = safeJson<ScoreBreakdown>(job.score_breakdown, {
              title: 0,
              skills: 0,
              seniority: 0,
              location: 0,
              recency: 0,
              compensation: 0,
              total: 0,
              hardFilterPass: true,
              hardFilterReasons: [],
              matchingSkills: [],
              missingSkills: [],
            });
            const reasons = safeJson<string[]>(job.run_reasons_json, breakdown.hardFilterReasons);
            return <tr key={job.id}>
              <td><span className="job-title">{job.title}</span><span className="job-meta">{job.company} · {job.source_name || job.source_type}</span></td>
              <td>{job.location || "Not listed"}</td>
              <td><ScoreBadge score={job.score} passed={job.hard_filter_pass !== 0} /></td>
              <td className="filter-reason-cell">
                {job.hard_filter_pass === 1 ? <span className="success-text">Passed filters</span> : (
                  <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                )}
              </td>
              <td><ConfidenceBadge score={job.confidence_score} /></td>
              <td>{run ? <StatusPill status={job.run_outcome || "saved"} /> : relativeAge(job.first_seen_at)}</td>
              <td><StatusPill status={job.status} /></td>
              <td><JobTriageButtons jobId={job.id} /></td>
              <td>
                {job.application_status && job.application_status !== "ready_to_apply" ? (
                  <Link className="button secondary small" href="/applications">View application</Link>
                ) : job.latest_resume_id && job.latest_resume_status !== "rejected" ? (
                  <Link className="button secondary small" href={`/resumes/${job.latest_resume_id}`}>
                    {job.latest_resume_status === "approved" ? "Continue to application" : "Continue preparation"}
                  </Link>
                ) : (
                  <form action={approveJobAction}>
                    <input type="hidden" name="id" value={job.id} />
                    <ResumeSubmitButton className="button secondary small">
                      {job.latest_resume_status === "rejected" ? "Prepare again" : "Prepare application"}
                    </ResumeSubmitButton>
                  </form>
                )}
              </td>
              <td><Link className="text-link" href={`/jobs/${job.id}`}>Review</Link></td>
            </tr>;
          })}
        </tbody></table></div> : <div className="empty-state"><h3>No jobs match these filters</h3><p>Clear a filter or collect more company sources.</p></div>}
      </section>
    </div>
  );
}
