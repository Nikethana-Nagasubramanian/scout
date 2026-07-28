import Link from "next/link";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { db } from "@/lib/database";
import type { DiscoverySource, JobSource, WorkflowLog } from "@/lib/types";
import { formatDateTime, safeJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface RunRow {
  id: number;
  slot: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  jobs_found: number;
  jobs_added: number;
  jobs_updated: number;
  error_summary: string;
  duration_ms: number | null;
  log_count: number;
  eligible_jobs: number;
  filtered_jobs: number;
}

interface DiagnosticsProps {
  searchParams: Promise<{ run?: string }>;
}

export default async function DiagnosticsPage({ searchParams }: DiagnosticsProps) {
  const parameters = await searchParams;
  const runs = db.prepare(`
    SELECT collection_runs.*,
      CASE WHEN completed_at IS NULL THEN NULL ELSE ROUND((julianday(completed_at) - julianday(started_at)) * 86400000) END AS duration_ms,
      (SELECT COUNT(*) FROM workflow_logs WHERE workflow_logs.run_id = collection_runs.id) AS log_count,
      (SELECT COUNT(*) FROM collection_job_results WHERE collection_job_results.run_id = collection_runs.id AND eligible = 1) AS eligible_jobs,
      (SELECT COUNT(*) FROM collection_job_results WHERE collection_job_results.run_id = collection_runs.id AND eligible = 0) AS filtered_jobs
    FROM collection_runs
    ORDER BY id DESC
    LIMIT 20
  `).all() as RunRow[];
  const requestedRunId = Number(parameters.run);
  const selectedRun = Number.isFinite(requestedRunId) && requestedRunId > 0
    ? runs.find((run) => run.id === requestedRunId) || null
    : runs[0] || null;
  const logs = selectedRun
    ? db.prepare(`
        SELECT workflow_logs.*, job_sources.name AS source_name
        FROM workflow_logs
        LEFT JOIN job_sources ON job_sources.id = workflow_logs.source_id
        WHERE workflow_logs.run_id = ?
        ORDER BY workflow_logs.id
      `).all(selectedRun.id) as WorkflowLog[]
    : [];
  const sources = db.prepare("SELECT * FROM job_sources ORDER BY name").all() as JobSource[];
  const discoverySources = db.prepare("SELECT * FROM discovery_sources ORDER BY name").all() as DiscoverySource[];
  const now = (db.prepare("SELECT unixepoch('now') AS value").get() as { value: number }).value * 1_000;
  const allSources = [...discoverySources, ...sources];
  const healthySources = allSources.filter((source) => source.enabled && !source.last_error).length;
  const failingSources = allSources.filter((source) => Boolean(source.last_error)).length;
  const coolingSources = allSources.filter((source) => source.cooldown_until && new Date(source.cooldown_until).getTime() > now).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Local developer tools"
        title="Workflow diagnostics"
        description="Inspect every collection, API request, retry, cooldown, persistence step, and scoring result."
      >
        <Link className="button secondary" href="/sources">Manage sources</Link>
      </PageHeader>

      <section className="metric-grid" aria-label="Collector health">
        <div className="card metric"><span className="metric-label">Active sources</span><strong className="metric-value">{allSources.length}</strong><span className="metric-note">{discoverySources.length} automatic, {sources.length} company watchlist</span></div>
        <div className="card metric"><span className="metric-label">Healthy sources</span><strong className="metric-value">{healthySources}</strong><span className="metric-note">Last attempt succeeded</span></div>
        <div className="card metric"><span className="metric-label">Failing sources</span><strong className="metric-value">{failingSources}</strong><span className="metric-note">Need developer review</span></div>
        <div className="card metric"><span className="metric-label">Cooling down</span><strong className="metric-value">{coolingSources}</strong><span className="metric-note">Temporarily skipped</span></div>
      </section>

      <div className="spacer" />
      <section className="card">
        <div className="card-header"><div><h2>Automatic feed health</h2><p>Rate limits, cooldowns, and errors persist between workflow runs.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Feed</th><th>Status</th><th>Last attempt</th><th>Last success</th><th>Next request</th><th>Last error</th></tr></thead><tbody>
          {discoverySources.map((source) => {
            const cooling = source.cooldown_until && new Date(source.cooldown_until).getTime() > now;
            const status = !source.enabled ? "paused" : cooling ? "cooldown" : source.last_error ? "error" : source.last_success_at ? "healthy" : "ready";
            return <tr key={source.key}>
              <td><span className="job-title">{source.name}</span><span className="job-meta">{source.key} · {source.minimum_interval_minutes} minute minimum interval</span></td>
              <td><StatusPill status={status} /></td>
              <td>{formatDateTime(source.last_attempt_at)}</td>
              <td>{formatDateTime(source.last_success_at)}</td>
              <td>{cooling ? formatDateTime(source.cooldown_until) : "Ready"}</td>
              <td className={source.last_error ? "danger-text" : "muted"}>{source.last_error || "None"}</td>
            </tr>;
          })}
        </tbody></table></div>
      </section>

      <div className="spacer" />
      <section className="card">
        <div className="card-header"><div><h2>Optional company watchlist health</h2><p>Direct Greenhouse and Lever board checks.</p></div></div>
        {sources.length ? (
          <div className="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Last attempt</th><th>Last success</th><th>Cooldown</th><th>Last error</th></tr></thead><tbody>
            {sources.map((source) => {
              const cooling = source.cooldown_until && new Date(source.cooldown_until).getTime() > now;
              const status = !source.enabled ? "paused" : cooling ? "cooldown" : source.last_error ? "error" : source.last_success_at ? "healthy" : "not tested";
              return <tr key={source.id}>
                <td><span className="job-title">{source.name}</span><span className="job-meta">{source.source_type} · {source.identifier}</span></td>
                <td><StatusPill status={status} /></td>
                <td>{formatDateTime(source.last_attempt_at)}</td>
                <td>{formatDateTime(source.last_success_at)}</td>
                <td>{cooling ? formatDateTime(source.cooldown_until) : "None"}</td>
                <td className={source.last_error ? "danger-text" : "muted"}>{source.last_error || "None"}</td>
              </tr>;
            })}
          </tbody></table></div>
        ) : <EmptyState title="No companies watched" body="Automatic discovery is active. Add companies only for optional direct board coverage." href="/sources" action="Manage discovery" />}
      </section>

      <div className="spacer" />
      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header"><div><h2>{selectedRun ? `Run ${selectedRun.id} details` : "Workflow steps"}</h2><p>Ordered from preflight through scoring</p></div>{selectedRun ? <StatusPill status={selectedRun.status} /> : null}</div>
          {selectedRun ? (
            <div className="card-body">
              <div className="three-column">
                <div><span className="metric-label">Started</span><strong className="job-title">{formatDateTime(selectedRun.started_at)}</strong></div>
                <div><span className="metric-label">Duration</span><strong className="job-title">{selectedRun.duration_ms === null ? "Still running" : `${selectedRun.duration_ms} ms`}</strong></div>
                <div><span className="metric-label">Jobs</span><strong className="job-title">{selectedRun.jobs_found} fetched · {selectedRun.jobs_added} new</strong></div>
                <div><span className="metric-label">Passed filters</span><strong className="job-title">{selectedRun.eligible_jobs}</strong></div>
                <div><span className="metric-label">Filtered</span><strong className="job-title">{selectedRun.filtered_jobs}</strong></div>
              </div>
              {selectedRun.error_summary ? <div className="callout warning workflow-log-summary">{selectedRun.error_summary}</div> : null}
              {logs.length ? <div className="log-list">{logs.map((log) => {
                const details = safeJson<Record<string, unknown>>(log.details_json, {});
                const hasDetails = Object.keys(details).length > 0;
                return <article className="log-row" key={log.id}>
                  <div><StatusPill status={log.level} /><p className="muted">{formatDateTime(log.created_at)}</p></div>
                  <div><span className="log-step">{log.step}</span>{log.source_name ? <p>{log.source_name}</p> : null}</div>
                  <div><strong>{log.message}</strong>{log.duration_ms !== null ? <p className="muted">Completed in {log.duration_ms} ms</p> : null}</div>
                  <div>{hasDetails ? <details className="log-details"><summary>Details</summary><pre>{JSON.stringify(details, null, 2)}</pre></details> : null}</div>
                </article>;
              })}</div> : <EmptyState title="No step logs for this fetch" body="This fetch happened before developer diagnostics were enabled. Its summary is still shown above." />}
            </div>
          ) : <EmptyState title="No fetches yet" body="Fetch new jobs to search from the candidate profile and create a diagnostic trace." />}
        </section>

        <aside className="card">
          <div className="card-header"><div><h2>Recent fetches</h2><p>Select one to inspect</p></div></div>
          {runs.length ? <div className="card-body stack">{runs.map((run) => <Link className="card run-link" href={`/diagnostics?run=${run.id}`} key={run.id}>
            <div className="inline-actions"><strong>Fetch {run.id}</strong><StatusPill status={run.status} /></div>
            <span className="job-meta">{run.slot.replaceAll("_", " ")} · {formatDateTime(run.started_at)}</span>
            <span className="job-meta">{run.jobs_found} fetched · {run.jobs_added} new · {run.eligible_jobs} passed · {run.filtered_jobs} filtered · {run.log_count} logs</span>
          </Link>)}</div> : <EmptyState title="No history" body="Job fetches will appear here." />}
        </aside>
      </div>
    </div>
  );
}
