import Link from "next/link";
import { addManualJobAction, approveJobAction, runWorkflowAction, updateJobStatusAction } from "@/app/actions";
import { ConfidenceBadge, PageHeader, ScoreBadge, StatusPill } from "@/components/UI";
import { ResumeSubmitButton } from "@/components/ResumeSubmitButton";
import { WorkflowSubmitButton } from "@/components/WorkflowSubmitButton";
import { db } from "@/lib/database";
import { jobNeedsFreshReview } from "@/lib/job-deduplication";
import { isProductDesignRoleFamily } from "@/lib/job-fit";
import type { Job, ScoreBreakdown } from "@/lib/types";
import { formatDateTime, relativeAge, safeJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface SearchProps {
  searchParams: Promise<{ q?: string; status?: string; fit?: string; run?: string; source?: string }>;
}

interface RunSummary {
  id: number;
  status: string;
  jobs_found: number;
  jobs_added: number;
  jobs_updated: number;
  error_summary: string;
  eligible_jobs: number;
  needs_verification_jobs: number;
  filtered_jobs: number;
  outcome_jobs: number;
  duplicate_jobs: number;
}

interface FetchHistoryRow extends RunSummary {
  slot: string;
  started_at: string;
  completed_at: string | null;
  review_jobs: number;
  hiring_cafe_status: "ran" | "cooldown" | "failed" | "not_included";
}

interface FetchHistoryJob {
  id: number;
  title: string;
  company: string;
  source_name: string;
  source_type: string;
  source_origin_name: string | null;
  classification: string;
  outcome: string;
  reasons_json: string;
  description: string;
  duplicate_of_job_id: number | null;
  job_status: string;
  application_status: string | null;
  has_resume: number;
}

interface StrictRunMetrics {
  relevant: number;
  newJobs: number;
  refreshed: number;
  eligible: number;
  needsVerification: number;
  filtered: number;
  duplicates: number;
}

function strictRunMetrics(jobs: FetchHistoryJob[]): StrictRunMetrics {
  const relevantJobs = jobs.filter((job) => isProductDesignRoleFamily(job.title, job.description));
  return {
    relevant: relevantJobs.length,
    newJobs: relevantJobs.filter(jobNeedsFreshReview).length,
    refreshed: relevantJobs.filter((job) => job.outcome === "refreshed").length,
    eligible: relevantJobs.filter((job) => job.classification === "eligible").length,
    needsVerification: relevantJobs.filter((job) => job.classification === "needs_verification").length,
    filtered: relevantJobs.filter((job) => job.classification === "filtered").length,
    duplicates: relevantJobs.filter((job) => job.duplicate_of_job_id !== null).length,
  };
}

interface FetchSourceGroup {
  key: string;
  sourceName: string;
  sourceType: string;
  originName: string;
  jobs: FetchHistoryJob[];
  eligible: number;
  needsVerification: number;
  filtered: number;
  newJobs: number;
}

function groupFetchHistoryJobs(jobs: FetchHistoryJob[]): FetchSourceGroup[] {
  const groups = new Map<string, FetchSourceGroup>();
  for (const job of jobs) {
    const sourceName = job.source_name || job.source_type;
    const key = `${job.source_type}:${sourceName}`;
    const group = groups.get(key) || {
      key,
      sourceName,
      sourceType: job.source_type,
      originName: job.source_origin_name || "",
      jobs: [],
      eligible: 0,
      needsVerification: 0,
      filtered: 0,
      newJobs: 0,
    };
    group.jobs.push(job);
    if (job.classification === "eligible") group.eligible += 1;
    if (job.classification === "needs_verification") group.needsVerification += 1;
    if (job.classification === "filtered") group.filtered += 1;
    if (jobNeedsFreshReview(job)) group.newJobs += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => (
    right.eligible - left.eligible
    || right.needsVerification - left.needsVerification
    || left.sourceName.localeCompare(right.sourceName)
  ));
}

interface JobListRow extends Job {
  source_origin_name: string | null;
  source_origin_url: string | null;
  latest_resume_id: number | null;
  latest_resume_status: string | null;
  application_status: string | null;
  run_outcome: string | null;
  run_eligible: number | null;
  run_classification: string | null;
  run_reasons_json: string | null;
}

export default async function JobsPage({ searchParams }: SearchProps) {
  const parameters = await searchParams;
  const query = parameters.q?.trim() || "";
  const runId = Number(parameters.run);
  const run = !query && Number.isFinite(runId) && runId > 0
    ? db.prepare(`
        SELECT collection_runs.id, collection_runs.status, collection_runs.jobs_found,
          collection_runs.jobs_added, collection_runs.jobs_updated, collection_runs.error_summary,
          (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'eligible') AS eligible_jobs,
          (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'needs_verification') AS needs_verification_jobs,
          (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'filtered') AS filtered_jobs,
          (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id) AS outcome_jobs,
          (
            SELECT COUNT(*)
            FROM collection_job_results
            INNER JOIN jobs ON jobs.id = collection_job_results.job_id
            WHERE collection_job_results.run_id = collection_runs.id
              AND jobs.duplicate_of_job_id IS NOT NULL
          ) AS duplicate_jobs
        FROM collection_runs
        WHERE collection_runs.id = ?
      `).get(runId) as RunSummary | undefined
    : undefined;
  const status = query ? "all" : parameters.status || (run ? "all" : "active");
  const fit = query ? "all" : parameters.fit || (run ? "review" : "eligible");
  const source = parameters.source || "all";
  const fetchCount = (db.prepare("SELECT COUNT(*) AS count FROM collection_runs").get() as { count: number }).count;
  const fetchHistory = db.prepare(`
    SELECT collection_runs.id, collection_runs.slot, collection_runs.started_at,
      collection_runs.completed_at, collection_runs.status, collection_runs.jobs_found,
      collection_runs.jobs_added, collection_runs.jobs_updated, collection_runs.error_summary,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'eligible') AS eligible_jobs,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'needs_verification') AS needs_verification_jobs,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'filtered') AS filtered_jobs,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id) AS outcome_jobs,
      (
        SELECT COUNT(*)
        FROM collection_job_results
        INNER JOIN jobs ON jobs.id = collection_job_results.job_id
        WHERE collection_job_results.run_id = collection_runs.id
          AND jobs.duplicate_of_job_id IS NOT NULL
      ) AS duplicate_jobs,
      (
        SELECT COUNT(*)
        FROM collection_job_results
        INNER JOIN jobs ON jobs.id = collection_job_results.job_id
        WHERE run_id = collection_runs.id
          AND outcome = 'new'
          AND classification IN ('eligible', 'needs_verification')
          AND jobs.duplicate_of_job_id IS NULL
          AND jobs.status NOT IN ('irrelevant', 'dismissed', 'archived')
          AND NOT EXISTS (SELECT 1 FROM applications WHERE applications.job_id = jobs.id)
          AND NOT EXISTS (SELECT 1 FROM resume_versions WHERE resume_versions.job_id = jobs.id)
      ) AS review_jobs,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM workflow_logs
          WHERE run_id = collection_runs.id
            AND step = 'portfolio.complete'
            AND message LIKE 'HiringCafe%'
        ) THEN 'ran'
        WHEN EXISTS (
          SELECT 1 FROM workflow_logs
          WHERE run_id = collection_runs.id
            AND step = 'portfolio.cooldown'
            AND message LIKE 'HiringCafe%'
        ) THEN 'cooldown'
        WHEN EXISTS (
          SELECT 1 FROM workflow_logs
          WHERE run_id = collection_runs.id
            AND step = 'portfolio.failed'
            AND message LIKE 'HiringCafe%'
        ) THEN 'failed'
        ELSE 'not_included'
      END AS hiring_cafe_status
    FROM collection_runs
    ORDER BY collection_runs.id DESC
    LIMIT 10
  `).all() as FetchHistoryRow[];
  const historyJobsStatement = db.prepare(`
    SELECT jobs.id, jobs.title, jobs.company, jobs.description, jobs.duplicate_of_job_id,
      jobs.status AS job_status,
      jobs.source_name, jobs.source_type,
      job_sources.discovered_via_name AS source_origin_name,
      collection_job_results.classification, collection_job_results.outcome,
      collection_job_results.reasons_json,
      (SELECT applications.status FROM applications WHERE applications.job_id = jobs.id LIMIT 1) AS application_status,
      EXISTS(SELECT 1 FROM resume_versions WHERE resume_versions.job_id = jobs.id) AS has_resume
    FROM collection_job_results
    INNER JOIN jobs ON jobs.id = collection_job_results.job_id
    LEFT JOIN job_sources ON job_sources.id = jobs.source_id
    WHERE collection_job_results.run_id = ?
    ORDER BY
      CASE collection_job_results.classification
        WHEN 'eligible' THEN 0
        WHEN 'needs_verification' THEN 1
        ELSE 2
      END,
      CASE collection_job_results.outcome WHEN 'new' THEN 0 ELSE 1 END,
      jobs.score DESC,
      jobs.id DESC
  `);
  const historySourceGroups = new Map(
    fetchHistory.map((historyRun) => [
      historyRun.id,
      groupFetchHistoryJobs((historyJobsStatement.all(historyRun.id) as FetchHistoryJob[])
        .filter((job) => isProductDesignRoleFamily(job.title, job.description))),
    ]),
  );
  const selectedRunMetrics = run
    ? strictRunMetrics(historyJobsStatement.all(run.id) as FetchHistoryJob[])
    : null;
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
  if (fit === "review") {
    clauses.push(run
      ? "(run_result.outcome = 'new' AND run_result.classification IN ('eligible', 'needs_verification') AND jobs.duplicate_of_job_id IS NULL AND jobs.status NOT IN ('irrelevant', 'dismissed', 'archived') AND NOT EXISTS (SELECT 1 FROM applications WHERE applications.job_id = jobs.id) AND NOT EXISTS (SELECT 1 FROM resume_versions WHERE resume_versions.job_id = jobs.id))"
      : "eligibility_status = 'needs_verification'");
  }
  if (fit === "eligible") clauses.push("eligibility_status = 'eligible'");
  if (fit === "needs_verification") clauses.push("eligibility_status = 'needs_verification'");
  if (fit === "strong") clauses.push("eligibility_status = 'eligible' AND score >= 80");
  if (fit === "promising") clauses.push("eligibility_status = 'eligible' AND score BETWEEN 65 AND 79");
  if (fit === "filtered") clauses.push("eligibility_status = 'filtered'");
  if (source === "greenhouse" || source === "ashby" || source === "manual" || source === "hiring_cafe") {
    clauses.push("source_type = ?");
    values.push(source);
  } else if (source === "gmail") {
    clauses.push("source_type LIKE 'gmail_%'");
  } else if (source === "public") {
    clauses.push("source_type IN ('remotive', 'jobicy', 'himalayas')");
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const runJoin = run
    ? "INNER JOIN collection_job_results AS run_result ON run_result.job_id = jobs.id AND run_result.run_id = ?"
    : "";
  const runColumns = run
    ? "run_result.outcome AS run_outcome, run_result.eligible AS run_eligible, run_result.classification AS run_classification, run_result.reasons_json AS run_reasons_json"
    : "NULL AS run_outcome, NULL AS run_eligible, NULL AS run_classification, NULL AS run_reasons_json";
  const savedJobs = db.prepare(`
    SELECT jobs.*,
      source_metadata.discovered_via_name AS source_origin_name,
      source_metadata.discovered_via_url AS source_origin_url,
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
    LEFT JOIN job_sources AS source_metadata ON source_metadata.id = jobs.source_id
    ${where}
    ORDER BY
      CASE eligibility_status WHEN 'needs_verification' THEN 0 WHEN 'eligible' THEN 1 ELSE 2 END,
      CASE WHEN run_outcome = 'new' THEN 0 ELSE 1 END,
      score DESC,
      first_seen_at DESC
    LIMIT 250
  `).all(...(run ? [run.id, ...values] : values)) as JobListRow[];
  const jobs = savedJobs.filter((job) => isProductDesignRoleFamily(job.title, job.description));

  return (
    <div className="page">
      <PageHeader title="Jobs" description="Fetch, review, and decide which opportunities deserve your time.">
        <form action={runWorkflowAction}>
          <input type="hidden" name="slot" value="manual" />
          <WorkflowSubmitButton>Fetch new jobs</WorkflowSubmitButton>
        </form>
      </PageHeader>
      {run ? (
        <section className={`callout fetch-result ${run.status === "completed" ? "success" : run.status === "failed" ? "error" : "warning"}`} role="status">
          <div className="fetch-result-summary">
            <div className="fetch-result-title">
              <span className="fetch-result-icon" aria-hidden="true">{run.status === "completed" ? "✓" : run.status === "failed" ? "×" : "!"}</span>
              <div>
                <strong>
                  {run.status === "failed"
                    ? "Fetch failed"
                    : run.status === "completed_with_errors"
                      ? `Fetch completed with ${run.error_summary.split("\n").filter(Boolean).length} source issue${run.error_summary.split("\n").filter(Boolean).length === 1 ? "" : "s"}`
                      : run.status === "completed_with_warnings"
                        ? "Fetch completed with cooldowns"
                        : "Fetch complete"}
                </strong>
                <span>{run.status === "completed_with_errors" ? "Working sources still saved their results." : run.status === "completed_with_warnings" ? "Cooling sources were skipped safely and will run later." : "The workflow finished processing your enabled sources."}</span>
              </div>
            </div>
            {selectedRunMetrics && selectedRunMetrics.relevant > 0 ? (
              <>
                <p>Only Product Designer, UI/UX Designer, and verified digital Design Engineer roles count as found.</p>
                <div className="fetch-metric-grid">
                  <div><strong>{selectedRunMetrics.relevant}</strong><span>Relevant roles found</span></div>
                  <div><strong>{selectedRunMetrics.newJobs}</strong><span>New to review</span></div>
                  <div><strong>{selectedRunMetrics.refreshed}</strong><span>Seen before</span></div>
                  <div><strong>{selectedRunMetrics.eligible}</strong><span>Eligible</span></div>
                  <div><strong>{selectedRunMetrics.needsVerification}</strong><span>Needs verification</span></div>
                  <div><strong>{selectedRunMetrics.filtered}</strong><span>Filtered</span></div>
                  <div><strong>{selectedRunMetrics.duplicates}</strong><span>Duplicates hidden</span></div>
                </div>
                {run.error_summary ? <div className="fetch-source-issue"><strong>Source issue</strong><span>{run.error_summary}</span></div> : null}
              </>
            ) : (
              <p>No jobs from this fetch pass the current strict role gate. Raw source inventory remains available in Technical details. {run.error_summary}</p>
            )}
          </div>
          <div className="inline-actions fetch-result-links">
            <Link className="text-link" href={`/jobs?run=${run.id}&fit=all&status=all`}>All saved results</Link>
            <Link className="text-link" href={`/jobs?run=${run.id}&fit=review&status=all`}>New and needs review</Link>
            <Link className="text-link" href={`/jobs?run=${run.id}&fit=eligible&status=all`}>Eligible</Link>
            <Link className="text-link" href={`/jobs?run=${run.id}&fit=needs_verification&status=all`}>Needs verification</Link>
            <Link className="text-link" href={`/jobs?run=${run.id}&fit=filtered&status=all`}>Filtered</Link>
            <Link className="text-link" href={`/diagnostics?run=${run.id}`}>Technical details</Link>
          </div>
        </section>
      ) : null}

      <details className="card fetch-history-card">
        <summary>
          <span className="fetch-history-heading">
            <span>
              <strong>Fetch history</strong>
              <small>Inspect recent searches without crowding your job list</small>
            </span>
            <span className="fetch-history-latest">
              {fetchHistory[0] ? `Latest: Fetch ${fetchHistory[0].id}` : "No fetches yet"}
              <StatusPill status={fetchHistory[0]?.status || "not_started"} />
            </span>
          </span>
        </summary>
        <div className="fetch-history-body">
          <div className="fetch-history-intro">
            <p>{fetchCount} fetch{fetchCount === 1 ? "" : "es"} recorded. The 10 most recent are shown here.</p>
            <Link className="text-link" href="/sources">Manage sources and cooldowns</Link>
          </div>
          {fetchHistory.length ? (
            <div className="fetch-history-list">
              {fetchHistory.map((historyRun) => {
                const sourceGroups = historySourceGroups.get(historyRun.id) || [];
                const relevantCount = sourceGroups.reduce((total, group) => total + group.jobs.length, 0);
                return (
                  <details className="fetch-history-run" key={historyRun.id}>
                    <summary>
                      <span>
                        <strong>Fetch {historyRun.id}</strong>
                        <small>{formatDateTime(historyRun.completed_at || historyRun.started_at)} · {historyRun.slot.replaceAll("_", " ")}</small>
                      </span>
                      <span className="fetch-history-stats">
                        <span>{relevantCount} relevant roles found</span>
                        <span>{historyRun.review_jobs} to review</span>
                        <span>{historyRun.duplicate_jobs} duplicates hidden</span>
                      </span>
                      <StatusPill status={historyRun.status} />
                    </summary>
                    <div className="fetch-history-run-body">
                      <div className="fetch-source-status">
                        <strong>HiringCafe</strong>
                        <StatusPill status={historyRun.hiring_cafe_status} />
                        <span>
                          {historyRun.hiring_cafe_status === "ran"
                            ? "Checked during this fetch."
                            : historyRun.hiring_cafe_status === "cooldown"
                              ? "Included in the workflow, but skipped because its 24-hour cooldown was active."
                              : historyRun.hiring_cafe_status === "failed"
                                ? "Attempted, but the source check failed."
                                : "No HiringCafe activity was recorded for this fetch."}
                        </span>
                      </div>
                      {sourceGroups.length ? (
                        <div className="fetch-source-groups">
                          {sourceGroups.map((group) => (
                            <details className="fetch-source-group" key={group.key}>
                              <summary>
                                <span>
                                  <strong>{group.sourceName}</strong>
                                  <small>{group.sourceType.replaceAll("_", " ")}{group.originName ? ` via ${group.originName}` : ""}</small>
                                </span>
                                <span className="fetch-history-stats">
                                  <span>{group.jobs.length} saved</span>
                                  <span>{group.newJobs} new</span>
                                  <span>{group.eligible} eligible</span>
                                  <span>{group.needsVerification} verify</span>
                                  <span>{group.filtered} filtered</span>
                                </span>
                              </summary>
                              <div className="fetch-history-jobs">
                                {group.jobs.map((job) => {
                                  const reasons = safeJson<string[]>(job.reasons_json, []);
                                  const historyStatus = job.duplicate_of_job_id !== null
                                    ? "duplicate"
                                    : job.application_status
                                      ? job.application_status === "rejected" ? "previously_rejected" : "previously_applied"
                                      : ["irrelevant", "dismissed"].includes(job.job_status)
                                        ? "previously_rejected"
                                        : job.outcome === "refreshed"
                                          ? "previously_fetched"
                                          : job.outcome;
                                  return (
                                    <div className="fetch-history-job fetch-history-job-detailed" key={job.id}>
                                      <span>
                                        <strong>{job.title}</strong>
                                        <small>{job.company}</small>
                                        {reasons.length ? (
                                          <small className="fetch-history-reasons">{reasons.join(" ")}</small>
                                        ) : (
                                          <small className="success-text">No eligibility conflicts found.</small>
                                        )}
                                      </span>
                                      <span className="inline-actions">
                                        <StatusPill status={job.classification} />
                                        <StatusPill status={historyStatus} />
                                        <Link className="text-link" href={`/jobs/${job.id}`}>Review</Link>
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">
                          {historyRun.jobs_found > 0
                            ? "This older fetch did not retain exact per-job results."
                            : "No exact product design roles were saved from this fetch."}
                        </p>
                      )}
                      <div className="inline-actions fetch-history-actions">
                        <Link className="button secondary small" href={`/jobs?run=${historyRun.id}&fit=review&status=all`}>
                          Review this fetch
                        </Link>
                        <Link className="text-link" href={`/jobs?run=${historyRun.id}&fit=all&status=all`}>
                          View all {relevantCount} relevant jobs
                        </Link>
                        <Link className="text-link" href={`/diagnostics?run=${historyRun.id}`}>Technical details</Link>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="muted">Click Fetch new jobs to create the first recorded search.</p>
          )}
        </div>
      </details>

      <form className="card filter-bar" method="get">
        {run ? <input type="hidden" name="run" value={run.id} /> : null}
        <input type="search" name="q" defaultValue={query} placeholder="Search all saved jobs by title, company, or description" aria-label="Search all saved jobs" />
        <select name="fit" defaultValue={fit} aria-label="Profile match filter">
          {run ? <option value="review">New and needs review</option> : null}
          <option value="eligible">Eligible only</option>
          <option value="needs_verification">Needs verification</option>
          <option value="strong">Strong, 80+</option>
          <option value="promising">Promising, 65 to 79</option>
          <option value="all">All match levels</option>
          <option value="filtered">Filtered</option>
        </select>
        <select name="status" defaultValue={status} aria-label="Status filter"><option value="active">Active only</option><option value="all">All statuses</option><option value="discovered">Discovered</option><option value="reviewing">Reviewing</option><option value="shortlisted">Shortlisted</option><option value="irrelevant">Irrelevant</option><option value="dismissed">Dismissed</option></select>
        <select name="source" defaultValue={source} aria-label="Source filter">
          <option value="all">All sources</option>
          <option value="greenhouse">Greenhouse</option>
          <option value="ashby">Ashby</option>
          <option value="gmail">Email alerts and newsletters</option>
          <option value="hiring_cafe">HiringCafe</option>
          <option value="public">Public discovery feeds</option>
          <option value="manual">Manual imports</option>
        </select>
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
        {jobs.length ? <div className="table-wrap"><table><thead><tr><th>Role</th><th>Location</th><th>Profile match</th><th>Why</th><th>Posting signal</th><th>{run ? "Fetch result" : "Found"}</th><th>Source</th><th>Decision</th></tr></thead><tbody>
          {jobs.map((job) => {
            const breakdown = safeJson<ScoreBreakdown>(job.score_breakdown, {
              title: 0,
              skills: 0,
              seniority: 0,
              location: 0,
              recency: 0,
              compensation: 0,
              total: 0,
              eligibilityStatus: job.eligibility_status,
              hardFilterPass: true,
              hardFilterReasons: [],
              verificationReasons: [],
              matchingSkills: [],
              missingSkills: [],
            });
            const classification = job.run_classification || job.eligibility_status;
            const reasons = safeJson<string[]>(
              job.run_reasons_json,
              [...breakdown.hardFilterReasons, ...breakdown.verificationReasons],
            );
            const priorFetchStatus = job.duplicate_of_job_id !== null
              ? "duplicate"
              : job.application_status
                ? job.application_status === "rejected" ? "previously_rejected" : "previously_applied"
                : ["irrelevant", "dismissed"].includes(job.status)
                  ? "previously_rejected"
                  : job.run_outcome === "refreshed"
                    ? "previously_fetched"
                    : job.run_outcome || "saved";
            const priorFetchNote = job.duplicate_of_job_id !== null
              ? job.duplicate_reason || "Duplicate of an existing Scout job."
              : job.application_status
                ? "This role already exists in Applications."
                : ["irrelevant", "dismissed"].includes(job.status)
                  ? "You previously rejected this role."
                  : job.run_outcome === "refreshed"
                    ? "Scout has fetched this job before."
                    : "";
            const previouslyHandled = Boolean(
              job.duplicate_of_job_id !== null
              || job.application_status
              || ["irrelevant", "dismissed", "archived"].includes(job.status),
            );
            return <tr key={job.id}>
              <td>
                <span className="job-title">{job.title}</span>
                <span className="job-meta">{job.company}</span>
              </td>
              <td>{job.location || "Not listed"}</td>
              <td><ScoreBadge score={job.score} passed={classification !== "filtered"} /></td>
              <td className="filter-reason-cell">
                <StatusPill status={classification} />
                {reasons.length ? <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <span className="success-text">No conflicts found</span>}
              </td>
              <td><ConfidenceBadge score={job.confidence_score} /></td>
              <td>{run ? <><StatusPill status={priorFetchStatus} />{priorFetchNote ? <span className="job-meta fetch-state-note">{priorFetchNote}</span> : null}</> : relativeAge(job.first_seen_at)}</td>
              <td>
                <StatusPill status={job.source_type} />
              </td>
              <td>
                <div className="job-decision-actions">
                  {job.application_status ? (
                    <Link className="button secondary small" href="/applications">View application</Link>
                  ) : previouslyHandled ? (
                    <span className="muted">No action needed</span>
                  ) : job.latest_resume_id && job.latest_resume_status !== "rejected" ? (
                    <Link className="button secondary small" href={`/jobs/${job.id}?tab=resume`}>
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
                  {!previouslyHandled ? (
                    <form action={updateJobStatusAction}>
                      <input type="hidden" name="id" value={job.id} />
                      <input type="hidden" name="status" value="irrelevant" />
                      <button className="button ghost small danger-text" type="submit">Reject</button>
                    </form>
                  ) : null}
                </div>
              </td>
            </tr>;
          })}
        </tbody></table></div> : run && fit === "review" ? (
          <div className="empty-state">
            <h3>No new decisions needed</h3>
            <p>Every relevant role in this fetch was previously fetched, rejected, applied to, or already has resume work. Use All saved results to inspect them.</p>
          </div>
        ) : (
          <div className="empty-state"><h3>No jobs match these filters</h3><p>Clear a filter or collect more company sources.</p></div>
        )}
      </section>
    </div>
  );
}
