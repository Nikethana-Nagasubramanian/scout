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
  filtered_jobs: number;
  id: number;
}

function count(query: string): number {
  return (db.prepare(query).get() as MetricRow).count;
}

export default function DashboardPage() {
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  if (!profile.onboarding_complete) redirect("/onboarding");

  const jobsToday = count("SELECT COUNT(*) AS count FROM jobs WHERE hard_filter_pass = 1 AND date(first_seen_at, 'localtime') = date('now', 'localtime')");
  const queueCount = count(`SELECT COUNT(*) AS count FROM jobs WHERE hard_filter_pass = 1 AND score >= ${Number(getSetting("minimum_queue_score", "65"))} AND status NOT IN ('irrelevant', 'dismissed', 'archived')`);
  const appliedCount = count("SELECT COUNT(*) AS count FROM applications WHERE status NOT IN ('ready_to_apply', 'archived')");
  const interviewCount = count("SELECT COUNT(*) AS count FROM applications WHERE status IN ('recruiter_screen', 'interview', 'offer')");
  const followUpCount = count("SELECT COUNT(*) AS count FROM applications WHERE follow_up_at IS NOT NULL AND datetime(follow_up_at) <= datetime('now', '+1 day') AND status NOT IN ('rejected', 'withdrawn', 'offer', 'archived')");
  const recentJobs = db.prepare("SELECT * FROM jobs WHERE hard_filter_pass = 1 AND status NOT IN ('irrelevant', 'dismissed', 'archived') ORDER BY first_seen_at DESC, score DESC LIMIT 6").all() as Job[];
  const lastRun = db.prepare(`
    SELECT collection_runs.*,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND eligible = 1) AS eligible_jobs,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND eligible = 0) AS filtered_jobs
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
        <div className="card metric"><span className="metric-label">Ready to review</span><strong className="metric-value">{queueCount}</strong><span className="metric-note">Passed filters and score threshold</span></div>
        <div className="card metric"><span className="metric-label">Applications</span><strong className="metric-value">{appliedCount}</strong><span className="metric-note">Submitted in this search</span></div>
        <div className="card metric"><span className="metric-label">Active conversations</span><strong className="metric-value">{interviewCount}</strong><span className="metric-note">Screens, interviews, and offers</span></div>
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
                  <thead><tr><th>Role</th><th>Fit</th><th>Status</th><th>Application</th><th /></tr></thead>
                  <tbody>
                    {recentJobs.map((job) => (
                      <tr key={job.id}>
                        <td><span className="job-title">{job.title}</span><span className="job-meta">{job.company} · {job.location || "Location not listed"}</span></td>
                        <td><ScoreBadge score={job.score} passed={job.hard_filter_pass !== 0} /></td>
                        <td><StatusPill status={job.status} /></td>
                        <td>{job.apply_url ? <a className="text-link" href={job.apply_url} target="_blank" rel="noreferrer">Apply</a> : <span className="muted">Unavailable</span>}</td>
                        <td><Link className="text-link" href={`/jobs/${job.id}`}>Review</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No jobs collected yet" body="Fetch new jobs to search automatically from your target role and location." href="/sources" action="View job sources" />}
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-header"><div><h2>Collection status</h2><p>{mode === "automatic" ? "Automatic collection is on" : "Manual collection is on"}</p></div><StatusPill status={mode} /></div>
            <div className="card-body">
              <p className="muted">Last completed</p>
              <strong>{formatDateTime(lastRun?.completed_at)}</strong>
              {lastRun ? <p className="muted">{lastRun.jobs_found} fetched, {lastRun.jobs_added} new, {lastRun.eligible_jobs} passed, {lastRun.filtered_jobs} filtered</p> : <p className="muted">No collection has run yet.</p>}
              {lastRun?.error_summary ? <p className="danger-text">{lastRun.error_summary}</p> : null}
              {lastRun ? <Link className="text-link" href={`/jobs?run=${lastRun.id}`}>View fetched jobs</Link> : null}
              <Link className="button secondary" href="/settings">Manage schedule</Link>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2>Next actions</h2><p>Keep the search moving</p></div></div>
            <div className="card-body stack">
              <Link className="button secondary" href="/queue">Review {queueCount} matched jobs</Link>
              <Link className="button secondary" href="/applications">Handle {followUpCount} follow-ups</Link>
              <Link className="button secondary" href="/profile">Strengthen truth bank</Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
