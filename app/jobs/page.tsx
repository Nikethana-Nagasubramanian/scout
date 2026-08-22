import Link from "next/link";
import { approveJobAction, runWorkflowAction, updateJobStatusAction } from "@/app/actions";
import { ManualJobModal } from "@/components/ManualJobModal";
import { PageHeader, StatusPill } from "@/components/UI";
import { ResumeSubmitButton } from "@/components/ResumeSubmitButton";
import { WorkflowSubmitButton } from "@/components/WorkflowSubmitButton";
import { db } from "@/lib/database";
import { buildFetchResourceAudit, type FetchResourceKey } from "@/lib/fetch-audit";
import { jobNeedsFreshReview } from "@/lib/job-deduplication";
import { isProductDesignRoleFamily } from "@/lib/job-fit";
import type { Job, ScoreBreakdown, WorkflowLog } from "@/lib/types";
import { formatDateTime, safeJson } from "@/lib/utils";

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

function fetchGroupResourceKey(group: FetchSourceGroup): FetchResourceKey {
  if (group.sourceType.startsWith("gmail_")) return "gmail";
  if (["remotive", "jobicy", "himalayas"].includes(group.sourceType)) return "public";
  if (group.sourceType === "hiring_cafe") return "hiring_cafe";
  return "official";
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
  const requestedRunId = Number(parameters.run);
  const latestRunId = (db.prepare("SELECT id FROM collection_runs ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined)?.id || 0;
  const runId = Number.isFinite(requestedRunId) && requestedRunId > 0 ? requestedRunId : latestRunId;
  const run = runId > 0
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
  const listRun = query ? undefined : run;
  const status = query ? "all" : parameters.status || (run ? "all" : "active");
  const fit = query ? "all" : parameters.fit || (run ? "review" : "eligible");
  const source = parameters.source || "all";
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
    LIMIT 5
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
  const selectedRunLogs = run ? db.prepare(`
    SELECT workflow_logs.*, job_sources.name AS source_name
    FROM workflow_logs
    LEFT JOIN job_sources ON job_sources.id = workflow_logs.source_id
    WHERE workflow_logs.run_id = ?
    ORDER BY workflow_logs.id
  `).all(run.id) as WorkflowLog[] : [];
  const resourceAudits = buildFetchResourceAudit(selectedRunLogs);
  const selectedSourceGroups = run ? historySourceGroups.get(run.id) || [] : [];
  const auditedResourceGroups = new Map<FetchResourceKey, FetchSourceGroup[]>();
  for (const group of selectedSourceGroups) {
    const key = fetchGroupResourceKey(group);
    const grouped = auditedResourceGroups.get(key) || [];
    grouped.push(group);
    auditedResourceGroups.set(key, grouped);
  }
  const accountedResourceCount = resourceAudits.filter((resource) => resource.status !== "not_checked").length;
  const checkedResourceCount = resourceAudits.filter((resource) => ["complete", "partial", "failed"].includes(resource.status)).length;
  const coolingResourceCount = resourceAudits.filter((resource) => resource.status === "cooldown" || resource.skipped > 0).length;
  const selectedRunMetrics = run
    ? strictRunMetrics(historyJobsStatement.all(run.id) as FetchHistoryJob[])
    : null;
  const selectedHistoryRun = run ? fetchHistory.find((historyRun) => historyRun.id === run.id) : undefined;
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
  const runJoin = listRun
    ? "INNER JOIN collection_job_results AS run_result ON run_result.job_id = jobs.id AND run_result.run_id = ?"
    : "";
  const runColumns = listRun
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
  `).all(...(listRun ? [listRun.id, ...values] : values)) as JobListRow[];
  const jobs = savedJobs.filter((job) => isProductDesignRoleFamily(job.title, job.description));
  const resultFoundCount = selectedRunMetrics?.relevant ?? jobs.length;
  const resultSourceCount = accountedResourceCount || resourceAudits.length;

  return (
    <div className="page jobs-page">
      <PageHeader title="Jobs" description="Fetch, review, and decide which opportunities deserve your time.">
        <ManualJobModal />
        <form action={runWorkflowAction}>
          <input type="hidden" name="slot" value="manual" />
          <WorkflowSubmitButton sourceCount={resourceAudits.length}>Fetch new jobs</WorkflowSubmitButton>
        </form>
      </PageHeader>
      <section className="jobs-results-summary" aria-label="Job collection summary">
        <h2>Scout found {jobs.length} {jobs.length === 1 ? "role" : "roles"} worth your time</h2>
        <p>Scout found {resultFoundCount} {resultFoundCount === 1 ? "role" : "roles"} across {resultSourceCount} {resultSourceCount === 1 ? "source" : "sources"}</p>
      </section>
      <section className="card fetch-audit-card" aria-label="Recent fetches">
        <div className="fetch-audit-header">
          <div>
            <h2>Recent fetches</h2>
            <p>Select a run to see exactly what Scout checked and what happened to every result.</p>
          </div>
          <div className="inline-actions">
            <Link className="text-link" href="/signals">View target companies</Link>
            <Link className="text-link" href="/sources">Manage sources</Link>
          </div>
        </div>
        {fetchHistory.length ? (
          <>
            <nav className="fetch-run-tabs" aria-label="Last five fetches">
              {fetchHistory.map((historyRun) => (
                <Link
                  className={run?.id === historyRun.id ? "active" : ""}
                  href={`/jobs?run=${historyRun.id}&fit=review&status=all`}
                  key={historyRun.id}
                >
                  <strong>Fetch {historyRun.id}</strong>
                  <small>{formatDateTime(historyRun.completed_at || historyRun.started_at)}</small>
                  <span>{historyRun.review_jobs} to review</span>
                </Link>
              ))}
            </nav>
            {run ? (
              <details className="fetch-audit-body">
                <summary className="fetch-audit-summary">
                  <div className="fetch-audit-summary-line">
                    <span>Summary of Fetch {run.id}</span>
                    <span aria-hidden="true" className="fetch-summary-dot" />
                    <span>{formatDateTime(selectedHistoryRun?.completed_at || selectedHistoryRun?.started_at || "")}</span>
                    <span className="fetch-summary-toggle" aria-hidden="true" />
                  </div>
                  {selectedRunMetrics ? (
                    <div className="fetch-metric-grid compact-metrics">
                      <div><strong>{run.jobs_found}</strong><span>Roles scanned</span></div>
                      <div><strong>{selectedRunMetrics.newJobs}</strong><span>New to review</span></div>
                      <div><strong>{selectedRunMetrics.refreshed}</strong><span>Seen before</span></div>
                      <div><strong>{Math.max(0, run.jobs_found - selectedRunMetrics.relevant)}</strong><span>Ruled out</span></div>
                      <div><strong>{selectedRunMetrics.relevant}</strong><span>Matched your search</span></div>
                      <div><strong>{selectedRunMetrics.filtered}</strong><span>Filtered out</span></div>
                      <div><strong>{selectedRunMetrics.duplicates}</strong><span>Duplicates removed</span></div>
                    </div>
                  ) : null}
                </summary>
                <div className="fetch-audit-expanded">
                  <p className="fetch-audit-accounting">Scout accounted for {accountedResourceCount} of {resourceAudits.length} resource groups. {checkedResourceCount} were checked and {coolingResourceCount} had an active cooldown.</p>
                {run.error_summary ? <div className="fetch-source-issue"><strong>Source issue</strong><span>{run.error_summary}</span></div> : null}
                <div className="fetch-resource-table">
                  <div className="fetch-resource-table-head">
                    <span>Resource</span><span>Extracted</span><span>Status</span>
                  </div>
                  {resourceAudits.map((resource) => {
                    const sourceGroups = auditedResourceGroups.get(resource.key) || [];
                    const savedJobs = sourceGroups.reduce((total, group) => total + group.jobs.length, 0);
                    return (
                      <details className="fetch-resource-row" key={resource.key}>
                        <summary>
                          <span><strong>{resource.label}</strong><small>{resource.description}</small></span>
                          <span>{savedJobs} relevant saved{resource.hiringSignals ? `, ${resource.hiringSignals} signals` : ""}{resource.boardsAdded ? `, ${resource.boardsAdded} boards added` : ""}</span>
                          <StatusPill status={resource.status} />
                        </summary>
                        <div className="fetch-resource-details">
                          <div className="fetch-resource-events">
                            {resource.events.length ? resource.events.map((event, index) => (
                              <div key={`${event.label}-${index}`}>
                                <span><strong>{event.label}</strong><small>{event.message}</small></span>
                                <StatusPill status={event.level} />
                              </div>
                            )) : <p className="muted">No source activity was recorded for this resource group.</p>}
                          </div>
                          {sourceGroups.length ? (
                            <div className="fetch-source-groups">
                              {sourceGroups.map((group) => (
                                <details className="fetch-source-group" key={group.key}>
                                  <summary>
                                    <span><strong>{group.sourceName}</strong><small>{group.sourceType.replaceAll("_", " ")}{group.originName ? ` via ${group.originName}` : ""}</small></span>
                                    <span className="fetch-history-stats"><span>{group.jobs.length} saved</span><span>{group.newJobs} new</span><span>{group.eligible} eligible</span><span>{group.needsVerification} verify</span><span>{group.filtered} filtered</span></span>
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
                                            : job.outcome === "refreshed" ? "previously_fetched" : job.outcome;
                                      return (
                                        <div className="fetch-history-job fetch-history-job-detailed" key={job.id}>
                                          <span><strong>{job.title}</strong><small>{job.company}</small>{reasons.length ? <small className="fetch-history-reasons">{reasons.join(" ")}</small> : <small className="success-text">No eligibility conflicts found.</small>}</span>
                                          <span className="inline-actions"><StatusPill status={job.classification} /><StatusPill status={historyStatus} /><Link className="text-link" href={`/jobs/${job.id}`}>Review</Link></span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    );
                  })}
                </div>
                <div className="inline-actions fetch-audit-links">
                  <Link className="text-link" href={`/jobs?run=${run.id}&fit=all&status=all`}>All saved results</Link>
                  <Link className="text-link" href={`/jobs?run=${run.id}&fit=review&status=all`}>New and needs review</Link>
                  <Link className="text-link" href={`/jobs?run=${run.id}&fit=filtered&status=all`}>Filtered</Link>
                  <Link className="text-link" href={`/diagnostics?run=${run.id}`}>Technical details</Link>
                </div>
                </div>
              </details>
            ) : null}
          </>
        ) : <p className="muted fetch-audit-empty">Click Fetch new jobs to create the first recorded search.</p>}
      </section>

      <form className="jobs-filter-bar" method="get">
        {listRun ? <input type="hidden" name="run" value={listRun.id} /> : null}
        <label className="jobs-search-field">
          <span className="jobs-search-icon" aria-hidden="true" />
          <input type="search" name="q" defaultValue={query} placeholder="Search all saved jobs by title, company, or description" aria-label="Search all saved jobs" />
        </label>
        <select name="status" defaultValue={status} aria-label="Status filter"><option value="active">Active only</option><option value="all">All statuses</option><option value="discovered">Discovered</option><option value="reviewing">Reviewing</option><option value="shortlisted">Shortlisted</option><option value="irrelevant">Irrelevant</option><option value="dismissed">Dismissed</option></select>
        <div className="jobs-fit-segments" role="group" aria-label="Profile match filter">
          <button className={fit === "review" ? "active" : ""} name="fit" value="review" type="submit">Needs review</button>
          <button className={fit === "eligible" ? "active" : ""} name="fit" value="eligible" type="submit">Eligible</button>
          <span aria-hidden="true" />
          <button className={fit === "filtered" ? "active" : ""} name="fit" value="filtered" type="submit">Filtered</button>
        </div>
      </form>

      <section className="jobs-results-list">
        {jobs.length ? <div className="jobs-result-rows">
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
            const previouslyHandled = Boolean(
              job.duplicate_of_job_id !== null
              || job.application_status
              || ["irrelevant", "dismissed", "archived"].includes(job.status),
            );
            return <article className="jobs-result-row" key={job.id}>
              <div className="jobs-result-primary">
                <div className="jobs-result-identity">
                  <strong>{job.title}</strong>
                  <span>{job.company}<i aria-hidden="true" />{job.location || "Not specified"}</span>
                </div>
                <div className="jobs-result-match"><strong>{job.score}%</strong><span>Profile match</span></div>
              </div>
              <div className="jobs-result-reason">
                <StatusPill status={classification} />
                <p>{reasons[0] || "No eligibility conflicts found."}</p>
              </div>
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
            </article>;
          })}
        </div> : listRun && fit === "review" ? (
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
