import Link from "next/link";
import { addSourceAction, deleteSourceAction, runWorkflowAction, toggleSourceAction } from "@/app/actions";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { WorkflowSubmitButton } from "@/components/WorkflowSubmitButton";
import { db, getSetting } from "@/lib/database";
import { gmailConfiguration } from "@/lib/gmail-alerts";
import type { CandidateProfile, DiscoverySource, JobSource } from "@/lib/types";
import { formatDateTime, parseList } from "@/lib/utils";

export const dynamic = "force-dynamic";

const focusedHiringCafeUrl = "https://hiringcafe.com/?searchState=%7B%22dateFetchedPastNDays%22%3A4%2C%22departments%22%3A%5B%22Engineering%22%2C%22Design%22%2C%22Software+Development%22%2C%22Information+Technology%22%2C%22Product+Management%22%5D%2C%22roleYoeRange%22%3A%5B2%2C5%5D%2C%22roleTypes%22%3A%5B%22Individual+Contributor%22%5D%2C%22seniorityLevel%22%3A%5B%22Mid+Level%22%2C%22Entry+Level%22%5D%2C%22jobTitleQuery%22%3A%22Product+Designer%22%7D";

interface RunRow {
  id: number;
  slot: string;
  completed_at: string | null;
  status: string;
  jobs_found: number;
  jobs_added: number;
  jobs_updated: number;
  error_summary: string;
  eligible_jobs: number;
  filtered_jobs: number;
}

export default function SourcesPage() {
  const sources = db.prepare("SELECT * FROM job_sources ORDER BY name").all() as JobSource[];
  const discoverySources = db.prepare("SELECT * FROM discovery_sources ORDER BY name").all() as DiscoverySource[];
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const targetTitles = parseList(profile.target_titles);
  const runs = db.prepare(`
    SELECT collection_runs.*,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND eligible = 1) AS eligible_jobs,
      (SELECT COUNT(*) FROM collection_job_results WHERE run_id = collection_runs.id AND eligible = 0) AS filtered_jobs
    FROM collection_runs
    ORDER BY id DESC
    LIMIT 8
  `).all() as RunRow[];
  const now = (db.prepare("SELECT unixepoch('now') AS value").get() as { value: number }).value * 1_000;
  const gmail = gmailConfiguration();
  const gmailState = db.prepare("SELECT * FROM gmail_alert_state WHERE id = 1").get() as {
    last_attempt_at: string | null;
    last_success_at: string | null;
    cooldown_until: string | null;
    last_error: string;
  };
  const processedEmailCount = (db.prepare("SELECT COUNT(DISTINCT mailbox || ':' || uid) AS count FROM gmail_processed_messages").get() as { count: number }).count;
  const gmailCooling = Boolean(gmailState.cooldown_until && new Date(gmailState.cooldown_until).getTime() > now);
  const gmailStatus = !gmail.configured ? "setup needed" : gmailState.last_error ? "error" : gmailCooling ? "cooldown" : gmailState.last_success_at ? "healthy" : "ready";

  return (
    <div className="page">
      <PageHeader title="Job sources" description="Choose where Scout looks. You never need to enter companies for the public discovery feeds.">
        <form action={runWorkflowAction}><input type="hidden" name="slot" value="manual" /><WorkflowSubmitButton>Fetch new jobs</WorkflowSubmitButton></form>
      </PageHeader>

      <section className="card fetch-explainer">
        <div className="card-header"><div><h2>What happens when you fetch</h2><p>One action, four visible steps</p></div></div>
        <div className="workflow-map-grid compact">
          <div><span>1</span><strong>Check</strong><small>Scout calls only ready sources</small></div>
          <div><span>2</span><strong>Filter</strong><small>USA, role, and experience rules run</small></div>
          <div><span>3</span><strong>Rank</strong><small>Fit and confidence are calculated</small></div>
          <div><span>4</span><strong>Review</strong><small>You land in Jobs with a run summary</small></div>
        </div>
      </section>

      <div className="spacer" />
      <section className="card">
        <div className="card-header">
          <div><h2>BuiltIn and Indeed alerts</h2><p>Read-only Gmail import from one dedicated label</p></div>
          <StatusPill status={gmailStatus} />
        </div>
        <div className="card-body">
          <p className="muted">Scout reads alert messages, extracts job links, deduplicates them, saves every result, and labels each one as passed or filtered. It does not send email, delete messages, mark them read, or automate either job-board account.</p>
          {gmail.configured ? (
            <div className="callout">
              <strong>Connected to {gmail.label}.</strong> {processedEmailCount} alert email{processedEmailCount === 1 ? "" : "s"} processed.
              {gmailState.last_success_at ? ` Last successful check: ${formatDateTime(gmailState.last_success_at)}.` : " Fetch new jobs to run the first import."}
              {gmailCooling && gmailState.cooldown_until ? ` Next Gmail check: ${formatDateTime(gmailState.cooldown_until)}.` : ""}
              {gmailState.last_error ? ` Last error: ${gmailState.last_error}` : ""}
            </div>
          ) : (
            <div className="callout warning"><strong>Setup incomplete.</strong> Add the missing local Gmail environment variables, then restart Scout.</div>
          )}
        </div>
      </section>

      <div className="spacer" />
      <section className="card">
        <div className="card-header"><div><h2>Automatic discovery feeds</h2><p>Scout searches these feeds using your target role, location, seniority, and experience profile.</p></div><StatusPill status="enabled" /></div>
        <div className="card-body">
          <p className="muted">When collection runs, Scout sends one target role and a broad country filter to each public service. Every result is saved, then checked against local role-family, seniority, experience, and country rules. Feeds rotate through target roles without bypassing rate limits. Your name, contact details, resume, and application history are never sent.</p>
          <div className="callout"><strong>Current strict filter:</strong> {getSetting("search_usa_only", "1") === "1" ? "United States only" : "All configured locations"}, {getSetting("search_experience_min", "2")} to {getSetting("search_experience_max", "5")} years, {profile.target_seniority || "profile"} seniority.</div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Feed</th><th>Next role query</th><th>Rate policy</th><th>Next request</th><th>Health</th></tr></thead><tbody>
          {discoverySources.map((source) => {
            const cooling = source.cooldown_until && new Date(source.cooldown_until).getTime() > now;
            const status = cooling ? "cooldown" : source.last_error ? "error" : source.last_success_at ? "healthy" : "ready";
            return <tr key={source.key}>
              <td><span className="job-title">{source.name}</span><span className="job-meta">No account or API key needed</span></td>
              <td>{targetTitles.length ? targetTitles[source.query_cursor % targetTitles.length] : profile.target_seniority || "Professional"}</td>
              <td>At most once every {source.minimum_interval_minutes >= 60 ? `${source.minimum_interval_minutes / 60} hour${source.minimum_interval_minutes === 60 ? "" : "s"}` : `${source.minimum_interval_minutes} minutes`}</td>
              <td>{cooling ? formatDateTime(source.cooldown_until) : "Ready now"}</td>
              <td><StatusPill status={status} /></td>
            </tr>;
          })}
        </tbody></table></div>
      </section>

      <div className="spacer" />
      <section className="card">
        <div className="card-header"><div><h2>Focused external searches</h2><p>Use these alongside Scout without account automation</p></div></div>
        <div className="card-body two-column">
          <div>
            <h3>HiringCafe</h3>
            <p className="muted">Open the focused 2 to 5 year Product Designer search. Confirm the United States location filter in HiringCafe before reviewing results.</p>
            <a className="button secondary" href={focusedHiringCafeUrl} target="_blank" rel="noreferrer">Open focused HiringCafe search</a>
          </div>
          <div>
            <h3>LinkedIn Jobs</h3>
            <p className="muted">Use a saved LinkedIn search or alert. Scout does not scrape or automate a LinkedIn account. Import a promising posting from the Jobs page when needed.</p>
            <a className="button secondary" href="https://www.linkedin.com/jobs/" target="_blank" rel="noreferrer">Open LinkedIn Jobs</a>
          </div>
        </div>
      </section>

      <div className="spacer" />
      <div className="two-column">
        <section className="card form-card">
          <div className="form-section">
            <h2>Optional company watchlist</h2>
            <p>Add a company only when you want deeper coverage of its Greenhouse or Lever board. This is not required for automatic discovery.</p>
            <form action={addSourceAction}>
              <div className="form-grid">
                <div className="field full"><label htmlFor="name">Company name</label><input id="name" name="name" required placeholder="Example Company" /></div>
                <div className="field"><label htmlFor="source_type">Career platform</label><select id="source_type" name="source_type"><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></div>
                <div className="field"><label htmlFor="identifier">Board token or site name</label><input id="identifier" name="identifier" required placeholder="examplecompany" /></div>
              </div>
              <div className="form-actions"><button className="button" type="submit">Add source</button></div>
            </form>
          </div>
        </section>

        <section className="card">
          <div className="card-header"><div><h2>Watched companies</h2><p>{sources.filter((source) => source.enabled).length} enabled</p></div></div>
          {sources.length ? (
            <div className="table-wrap"><table><thead><tr><th>Company</th><th>Platform</th><th>Status</th><th /></tr></thead><tbody>
              {sources.map((source) => <tr key={source.id}>
                <td><span className="job-title">{source.name}</span><span className="job-meta">{source.identifier}</span></td>
                <td>{source.source_type}</td>
                <td><StatusPill status={source.enabled ? "enabled" : "paused"} /></td>
                <td><div className="inline-actions">
                  <form action={toggleSourceAction}><input type="hidden" name="id" value={source.id} /><button className="button ghost small" type="submit">{source.enabled ? "Pause" : "Enable"}</button></form>
                  <form action={deleteSourceAction}><input type="hidden" name="id" value={source.id} /><button className="button ghost small danger-text" type="submit">Remove</button></form>
                </div></td>
              </tr>)}
            </tbody></table></div>
          ) : <EmptyState title="No companies watched" body="That is fine. Automatic discovery works without this list." />}
        </section>
      </div>

      <div className="spacer" />
      <section className="card">
        <div className="card-header"><div><h2>Recent collection runs</h2><p>Feed failures remain visible and do not stop other sources.</p></div></div>
        {runs.length ? <div className="table-wrap"><table><thead><tr><th>Run</th><th>Time</th><th>Result</th><th>Jobs</th><th>Notes</th></tr></thead><tbody>
          {runs.map((run) => <tr key={run.id}><td><Link className="text-link" href={`/jobs?run=${run.id}`}>Fetch {run.id}</Link><span className="job-meta">{run.slot.replaceAll("_", " ")}</span></td><td>{formatDateTime(run.completed_at)}</td><td><StatusPill status={run.status} /></td><td>{run.jobs_found} fetched · {run.jobs_added} new · {run.jobs_updated} refreshed · {run.eligible_jobs} passed · {run.filtered_jobs} filtered</td><td className={run.error_summary ? "danger-text" : "muted"}>{run.error_summary || "No errors"}</td></tr>)}
        </tbody></table></div> : <EmptyState title="No collection history" body="Fetch new jobs once to search from your profile." />}
      </section>
    </div>
  );
}
