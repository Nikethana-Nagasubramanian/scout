import Link from "next/link";
import { redirect } from "next/navigation";
import { runWorkflowAction } from "@/app/actions";
import { EmptyState, PageHeader, ScoreBadge, StatusPill } from "@/components/UI";
import { WorkflowSubmitButton } from "@/components/WorkflowSubmitButton";
import { db, getSetting } from "@/lib/database";
import type { CandidateProfile, Job } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface MetricRow { count: number }
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
  const jobsToday = count("SELECT COUNT(*) AS count FROM jobs WHERE eligibility_status = 'eligible' AND date(first_seen_at, 'localtime') = date('now', 'localtime')");
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
  const submittedCount = count("SELECT COUNT(*) AS count FROM applications WHERE applied_at IS NOT NULL");
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

  return (
    <div className="page">
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
        <div className="card metric"><span className="metric-label">New jobs today</span><strong className="metric-value">{jobsToday}</strong><span className="metric-note">Across active sources</span></div>
        <div className="card metric"><span className="metric-label">Ready to prepare</span><strong className="metric-value">{readyToPrepareCount}</strong><span className="metric-note">Eligible jobs without a tailored resume</span></div>
        <div className="card metric"><span className="metric-label">Approved to apply</span><strong className="metric-value">{approvedToApplyCount}</strong><span className="metric-note">Approved resumes awaiting submission</span></div>
        <div className="card metric"><span className="metric-label">Submitted</span><strong className="metric-value">{submittedCount}</strong><span className="metric-note">Confirmed application submissions</span></div>
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
                        <td><Link className="button secondary small" href={`/jobs/${job.id}`}>Review and prepare</Link></td>
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
              <Link className="button secondary" href="/settings">Manage schedule</Link>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2>Next actions</h2><p>Keep the search moving</p></div></div>
            <div className="card-body stack">
              <Link className="button secondary" href="/jobs">Review {readyToPrepareCount} jobs</Link>
              <Link className="button secondary" href="/queue#approved-to-apply">Apply to {approvedToApplyCount} approved jobs</Link>
              <Link className="button secondary" href="/applications">Handle {followUpCount} follow-ups</Link>
              <Link className="button secondary" href="/profile">Strengthen truth bank</Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
