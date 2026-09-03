import Link from "next/link";
import { redirect } from "next/navigation";
import { runWorkflowAction } from "@/app/actions";
import { Button, EmptyState, PageHeader, ScoreBadge, StatusPill } from "@/components/UI";
import { WorkflowSubmitButton } from "@/components/WorkflowSubmitButton";
import { db, getSetting } from "@/lib/database";
import type { CandidateProfile, Job, ResumeStatus } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface MetricRow { count: number }
interface LatestResumeRow {
  resume_id: number;
  job_id: number;
  job_title: string;
  job_company: string;
  resume_status: ResumeStatus;
  application_status: string | null;
  applied_at: string | null;
  updated_at: string;
}
interface CollectionRun {
  completed_at: string | null;
  status: string;
  jobs_found: number;
  jobs_added: number;
  error_summary: string;
  eligible_jobs: number;
  needs_verification_jobs: number;
  filtered_jobs: number;
  relevant_jobs: number;
  id: number;
}

function count(query: string): number {
  return (db.prepare(query).get() as MetricRow).count;
}

export default function DashboardPage() {
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  if (!profile.onboarding_complete) redirect("/onboarding");

  const minimumScore = Number(getSetting("minimum_queue_score", "65"));
  const appliedLast24hCount = count("SELECT COUNT(*) AS count FROM applications WHERE applied_at IS NOT NULL AND datetime(applied_at) >= datetime('now', '-1 day')");
  const readyToPrepareCount = count(`
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE eligibility_status = 'eligible'
      AND score >= ${minimumScore}
      AND status NOT IN ('irrelevant', 'dismissed', 'archived')
      AND id NOT IN (SELECT job_id FROM resume_versions)
      AND id NOT IN (SELECT job_id FROM applications)
  `);
  const approvedToApplyCount = count(`
    SELECT COUNT(*) AS count
    FROM applications
    JOIN resume_versions ON resume_versions.id = applications.resume_version_id
    WHERE applications.status = 'ready_to_apply'
      AND resume_versions.status = 'approved'
  `);
  const followUpCount = count("SELECT COUNT(*) AS count FROM applications WHERE follow_up_at IS NOT NULL AND datetime(follow_up_at) <= datetime('now', '+1 day') AND status NOT IN ('rejected', 'withdrawn', 'offer', 'archived')");
  const recentJobs = db.prepare(`
    SELECT * FROM jobs
    WHERE eligibility_status = 'eligible'
      AND score >= ?
      AND status NOT IN ('irrelevant', 'dismissed', 'archived')
      AND id NOT IN (SELECT job_id FROM resume_versions)
      AND id NOT IN (SELECT job_id FROM applications)
    ORDER BY first_seen_at DESC, score DESC
    LIMIT 6
  `).all(minimumScore) as Job[];
  const lastRun = db.prepare(`
    SELECT collection_runs.*,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'eligible') AS eligible_jobs,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'needs_verification') AS needs_verification_jobs,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND classification = 'filtered') AS filtered_jobs
      ,(SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id) AS relevant_jobs
    FROM collection_runs
    ORDER BY id DESC
    LIMIT 1
  `).get() as CollectionRun | undefined;
  const mode = getSetting("collection_mode", "manual");
  const latestResume = db.prepare(`
    SELECT resume_versions.id AS resume_id, resume_versions.job_id AS job_id,
      jobs.title AS job_title, jobs.company AS job_company,
      resume_versions.status AS resume_status,
      applications.status AS application_status, applications.applied_at AS applied_at,
      resume_versions.updated_at AS updated_at
    FROM resume_versions
    INNER JOIN jobs ON jobs.id = resume_versions.job_id
    LEFT JOIN applications ON applications.job_id = resume_versions.job_id
    ORDER BY
      CASE WHEN applications.applied_at IS NOT NULL THEN 0 ELSE 1 END,
      COALESCE(applications.applied_at, resume_versions.updated_at) DESC
    LIMIT 1
  `).get() as LatestResumeRow | undefined;

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="30 day search"
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${profile.full_name.split(" ")[0] || "candidate"}.`}
        description="Focus on the strongest opportunities and keep every next step visible."
      >
        <form action={runWorkflowAction}>
          <input type="hidden" name="slot" value="manual" />
          <WorkflowSubmitButton>Fetch new jobs</WorkflowSubmitButton>
        </form>
      </PageHeader>

      <section className="card workflow-map" aria-labelledby="workflow-map-title">
        <div className="card-header">
          <div><h2 id="workflow-map-title">How Scout works</h2><p>Follow this path from a fresh job to a submitted application</p></div>
          <Link className="text-link" href="/settings">Manage automation</Link>
        </div>
        <div className="workflow-map-grid">
          <Link href="/sources"><span>1</span><strong>Job sources</strong><small>Fetch new opportunities</small></Link>
          <Link href="/jobs"><span>2</span><strong>Jobs</strong><small>Keep or dismiss matches</small></Link>
          <Link href="/queue"><span>3</span><strong>Resume queue</strong><small>Edit and approve a resume</small></Link>
          <Link href="/applications"><span>4</span><strong>Applications</strong><small>Track outreach and follow-up</small></Link>
        </div>
      </section>

      <section className="metric-grid" aria-label="Search metrics">
        <div className="card metric"><span className="metric-label">Fetched last run</span><strong className="metric-value">{lastRun?.jobs_found ?? 0}</strong><span className="metric-note">Roles scanned across active sources</span></div>
        <div className="card metric"><span className="metric-label">Applied last 24h</span><strong className="metric-value">{appliedLast24hCount}</strong><span className="metric-note">Submissions in the past day</span></div>
        <div className="card metric"><span className="metric-label">Ready to prepare</span><strong className="metric-value">{readyToPrepareCount}</strong><span className="metric-note">Eligible jobs without a tailored resume</span></div>
        <div className="card metric"><span className="metric-label">Follow-ups due</span><strong className="metric-value">{followUpCount}</strong><span className="metric-note">Due within the next day</span></div>
      </section>

      <div className="dashboard-grid">
        <div className="stack">
          <section className="card">
            <div className="card-header">
              <div><h2>Newest opportunities</h2><p>Fresh jobs, ranked against your confirmed profile</p></div>
              <Link className="text-link" href="/jobs">View all</Link>
            </div>
            {recentJobs.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Role</th><th>Profile match</th><th>Next step</th></tr></thead>
                  <tbody>
                    {recentJobs.map((job) => (
                      <tr key={job.id}>
                        <td><span className="job-title">{job.title}</span><span className="job-meta">{job.company} · {job.location || "Location not listed"}</span></td>
                        <td><ScoreBadge score={job.score} passed={job.hard_filter_pass !== 0} /></td>
                        <td><Button href={`/jobs/${job.id}`} variant="secondary" size="small">Review and prepare</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No jobs ready to prepare" body="There are no eligible jobs without a tailored resume right now." href="/jobs" action="Review all jobs" />}
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-header"><div><h2>Latest resume</h2><p>{latestResume?.applied_at ? "Most recently applied" : "Most recently tailored"}</p></div></div>
            <div className="card-body">
              {latestResume ? (
                <div className="stack">
                  <div>
                    <span className="job-title">{latestResume.job_title}</span>
                    <span className="job-meta">{latestResume.job_company}</span>
                  </div>
                  <div className="inline-actions">
                    <StatusPill status={latestResume.application_status || latestResume.resume_status} />
                    <span className="muted">{formatDateTime(latestResume.applied_at || latestResume.updated_at)}</span>
                  </div>
                  <Button href={`/jobs/${latestResume.job_id}?tab=resume`} variant="secondary">View resume</Button>
                </div>
              ) : <EmptyState title="No resume tailored yet" body="Prepare your first job to start a tailored resume." href="/jobs" action="Review jobs" />}
            </div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2>Collection status</h2><p>{mode === "automatic" ? "Automatic collection is on" : "Manual collection is on"}</p></div><StatusPill status={mode} /></div>
            <div className="card-body">
              <p className="muted">Last completed</p>
              <strong>{formatDateTime(lastRun?.completed_at)}</strong>
              {lastRun ? <p className="muted">{lastRun.relevant_jobs} relevant roles, {lastRun.jobs_added} new, {lastRun.eligible_jobs} eligible, {lastRun.needs_verification_jobs} need verification, {lastRun.filtered_jobs} filtered</p> : <p className="muted">No collection has run yet.</p>}
              {lastRun?.error_summary ? (
                <div className="source-health-note">
                  <span className="status-dot" aria-hidden="true" />
                  <div><strong>One source needs attention</strong><span>{lastRun.error_summary}</span></div>
                </div>
              ) : null}
              {lastRun ? <Link className="text-link" href={`/jobs?run=${lastRun.id}`}>View fetched jobs</Link> : null}
              <Button href="/settings" variant="secondary">Manage schedule</Button>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2>Next actions</h2><p>Keep the search moving</p></div></div>
            <div className="card-body stack">
              <Button href="/jobs" variant="secondary">Review {readyToPrepareCount} jobs</Button>
              <Button href="/queue#approved-to-apply" variant="secondary">Apply to {approvedToApplyCount} approved jobs</Button>
              <Button href="/applications" variant="secondary">Handle {followUpCount} follow-ups</Button>
              <Button href="/profile" variant="secondary">Strengthen truth bank</Button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
