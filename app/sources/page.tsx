import Link from "next/link";
import {
  addCompanyDiscoverySourceAction,
  addSourceAction,
  deleteCompanyDiscoverySourceAction,
  deleteSourceAction,
  runWorkflowAction,
  toggleCompanyDiscoverySourceAction,
  toggleSourceAction,
  wakeRestingSourcesAction,
} from "@/app/actions";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { WorkflowSubmitButton } from "@/components/WorkflowSubmitButton";
import { db, getSetting } from "@/lib/database";
import { exaBudgetStatus, exaConfigured } from "@/lib/exa-discovery";
import { gmailConfiguration } from "@/lib/gmail-alerts";
import { broadDiscoverySearchTitles } from "@/lib/job-fit";
import type { CandidateProfile, CompanyDiscoverySource, DiscoverySource, JobSource } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";


interface CompanyDiscoverySummary {
  sourceId: number;
  directJobsFound?: number;
  directBoardsFound: number;
  companiesFound: number;
  companiesInspected: number;
  boardsAdded: number;
}

function companyDiscoverySummaryText(summary: CompanyDiscoverySummary | undefined, inspectedTotal: number): string {
  if (!summary) return `${inspectedTotal} company sites inspected so far`;
  if (summary.directBoardsFound > 0 && summary.companiesInspected === 0) {
    const directJobs = summary.directJobsFound ? `${summary.directJobsFound} direct jobs, ` : "";
    return `Latest check: ${directJobs}${summary.directBoardsFound} direct ATS links found, ${summary.boardsAdded} new boards saved. No company-site crawl was needed.`;
  }
  return `Latest check: ${summary.companiesInspected} company sites inspected, ${summary.boardsAdded} new boards saved.`;
}

function ExaBudgetNotice() {
  const budget = exaBudgetStatus();
  if (budget.state === "ok") return null;
  const percent = Math.round(budget.fraction * 100);
  return (
    <p className="callout warning">
      <strong>Exa credits: </strong>
      {budget.state === "exhausted"
        ? `${budget.exhaustedReason} Company discovery is paused until you add credit. Scout has spent ${budget.used.toFixed(2)} of your ${budget.budget.toFixed(2)} dollar budget.`
        : `You have used ${budget.used.toFixed(2)} of your ${budget.budget.toFixed(2)} dollar budget (${percent} percent). Scout keeps searching until Exa reports the credits are gone.`}
    </p>
  );
}

function BoardTable({ rows, caption, now }: { rows: JobSource[]; caption: string; now: number }) {
  if (!rows.length) return null;
  return (
    <div className="board-tier">
      {caption ? <h3 className="board-tier-title">{caption} <span className="muted">({rows.length})</span></h3> : null}
      <div className="table-wrap"><table><thead><tr><th>Company</th><th>Platform</th><th>Origin</th><th>Next request</th><th>Health</th><th /></tr></thead><tbody>
        {rows.map((source) => {
          const cooling = source.cooldown_until && new Date(source.cooldown_until).getTime() > now;
          const status = !source.enabled ? "paused" : source.last_error ? "error" : cooling ? "cooldown" : source.last_success_at ? "healthy" : "ready";
          return <tr key={source.id}>
            <td><span className="job-title">{source.name}</span><span className="job-meta">{source.identifier}</span>{source.discovered_from_url ? <a className="job-meta text-link" href={source.discovered_from_url} target="_blank" rel="noreferrer">Detection evidence</a> : null}</td>
            <td>{source.source_type}</td>
            <td>
              {source.auto_discovered ? "Automatic" : "Manual"}
              {source.discovered_via_name ? <span className="job-meta">via {source.discovered_via_name}</span> : null}
            </td>
            <td>{cooling ? formatDateTime(source.cooldown_until) : "Ready now"}</td>
            <td><StatusPill status={status} /></td>
            <td><div className="inline-actions">
              <form action={toggleSourceAction}><input type="hidden" name="id" value={source.id} /><button className="button ghost small" type="submit">{source.enabled ? "Pause" : "Enable"}</button></form>
              <form action={deleteSourceAction}><input type="hidden" name="id" value={source.id} /><button className="button ghost small danger-text" type="submit">Remove</button></form>
            </div></td>
          </tr>;
        })}
      </tbody></table></div>
    </div>
  );
}

interface ExaQueryRowView {
  id: number;
  query: string;
  kind: string;
  last_run_at: string | null;
  last_result_count: number;
  consecutive_zero_runs: number;
  minimum_interval_minutes: number;
}

function ExaSection({ queries, budget, configured }: {
  queries: ExaQueryRowView[];
  budget: ReturnType<typeof exaBudgetStatus>;
  configured: boolean;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Exa company discovery</h2>
          <p>Semantic searches that find companies hiring for your role before they appear anywhere else Scout looks.</p>
        </div>
        <div className="contact-budget">
          <StatusPill status={configured ? (budget.state === "ok" ? "healthy" : budget.state) : "setup needed"} />
          <strong>{configured
            ? `${budget.remaining.toFixed(2)} of ${budget.budget.toFixed(2)} dollars left`
            : "EXA_API_KEY is not set"}</strong>
        </div>
      </div>
      {configured ? (
        <div className="table-wrap"><table><thead><tr><th>Query</th><th>Scope</th><th>Last run</th><th>Found</th></tr></thead><tbody>
          {queries.map((query) => (
            <tr key={query.id}>
              <td><span className="job-title">{query.query}</span></td>
              <td>{query.kind === "ats_daily" ? "Daily, known ATS hosts" : "Weekly, open web"}</td>
              <td>{query.last_run_at ? formatDateTime(query.last_run_at) : "Not yet run"}</td>
              <td>
                {query.last_result_count} new
                {query.consecutive_zero_runs >= 3 ? <span className="job-meta">quiet for {query.consecutive_zero_runs} runs, slowing down</span> : null}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      ) : (
        <EmptyState title="Exa is not configured" body="Add EXA_API_KEY to your .env file to let Scout find companies that are not on any board it already tracks." />
      )}
    </section>
  );
}

export default function SourcesPage() {
  const sources = db.prepare("SELECT * FROM job_sources ORDER BY name").all() as JobSource[];
  const companyDiscoverySources = db.prepare("SELECT * FROM company_discovery_sources ORDER BY name").all() as CompanyDiscoverySource[];
  const discoverySources = db.prepare("SELECT * FROM discovery_sources ORDER BY name").all() as DiscoverySource[];
  const companyDiscoverySummaries = new Map<number, CompanyDiscoverySummary>();
  const companyDiscoveryLogRows = db.prepare(`
    SELECT details_json
    FROM workflow_logs
    WHERE step = 'portfolio.complete'
    ORDER BY id DESC
  `).all() as Array<{ details_json: string }>;
  for (const row of companyDiscoveryLogRows) {
    try {
      const summary = JSON.parse(row.details_json) as CompanyDiscoverySummary;
      if (summary.sourceId && !companyDiscoverySummaries.has(summary.sourceId)) {
        companyDiscoverySummaries.set(summary.sourceId, summary);
      }
    } catch {
      // Older or malformed logs should not prevent the sources page from loading.
    }
  }
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const targetTitles = broadDiscoverySearchTitles(profile);
  const now = (db.prepare("SELECT unixepoch('now') AS value").get() as { value: number }).value * 1_000;
  const tierOf = (source: JobSource) => {
    const tier = source.tier || "standard";
    return tier === "watchlist" || tier === "dormant" ? tier : "standard";
  };
  const enabledSources = sources.filter((source) => source.enabled);
  const byTier = {
    watchlist: enabledSources.filter((source) => tierOf(source) === "watchlist"),
    standard: enabledSources.filter((source) => tierOf(source) === "standard"),
    dormant: enabledSources.filter((source) => tierOf(source) === "dormant"),
  };
  const tierCounts = {
    watchlist: byTier.watchlist.length,
    standard: byTier.standard.length,
    dormant: byTier.dormant.length,
  };
  const exaQueries = db.prepare("SELECT * FROM exa_queries WHERE enabled = 1 ORDER BY kind, id").all() as ExaQueryRowView[];
  const exaBudget = exaBudgetStatus();
  const exaReady = exaConfigured();
  const gmail = gmailConfiguration();
  const gmailState = db.prepare("SELECT * FROM gmail_alert_state WHERE id = 1").get() as {
    last_attempt_at: string | null;
    last_success_at: string | null;
    cooldown_until: string | null;
    last_error: string;
  };
  const processedEmailCount = (db.prepare("SELECT COUNT(DISTINCT mailbox || ':' || uid) AS count FROM gmail_processed_messages").get() as { count: number }).count;
  const newsletterSignalCounts = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN signal_type = 'explicit_role' THEN 1 ELSE 0 END) AS explicit_roles,
      SUM(CASE WHEN signal_type = 'company_hiring' THEN 1 ELSE 0 END) AS company_signals
    FROM gmail_hiring_signals
  `).get() as { total: number; explicit_roles: number | null; company_signals: number | null };
  const gmailCooling = Boolean(gmailState.cooldown_until && new Date(gmailState.cooldown_until).getTime() > now);
  const gmailStatus = !gmail.configured ? "setup needed" : gmailState.last_error ? "error" : gmailCooling ? "cooldown" : gmailState.last_success_at ? "healthy" : "ready";

  return (
    <div className="page">
      <PageHeader title="Job sources" description="Everywhere Scout looks, and how often it looks there.">
        <form action={runWorkflowAction}><input type="hidden" name="slot" value="manual" /><WorkflowSubmitButton>Fetch new jobs</WorkflowSubmitButton></form>
      </PageHeader>

      {exaReady ? <ExaBudgetNotice /> : null}

      <ExaSection queries={exaQueries} budget={exaBudget} configured={exaReady} />

      <div className="spacer" />

      <section className="card fetch-explainer">
        <div className="card-header"><div><h2>What happens when you fetch</h2><p>One action, five visible steps</p></div></div>
        <div className="workflow-map-grid compact">
          <div><span>1</span><strong>Check</strong><small>Feeds, your inbox, and only the boards whose rest period is up</small></div>
          <div><span>2</span><strong>Classify</strong><small>Eligible, needs verification, or filtered</small></div>
          <div><span>3</span><strong>Rank</strong><small>Profile match and posting signal are calculated</small></div>
          <div><span>4</span><strong>Discover</strong><small>Exa looks for companies not yet on any board</small></div>
          <div><span>5</span><strong>Review</strong><small>You land in Jobs with a run summary</small></div>
        </div>
        <p className="callout">Boards found by discovery are read on the next fetch, not the one that found them.</p>
      </section>

      <div className="spacer" />
      <section className="card">
        <div className="card-header">
          <div><h2>Job alert inbox</h2><p>BuiltIn, Indeed, Substack, and curated hiring newsletters from one Gmail label</p></div>
          <StatusPill status={gmailStatus} />
        </div>
        <div className="card-body">
          <p className="muted">Scout reads alert messages, extracts specific job links, deduplicates them, and classifies each result. Curated newsletters use a second path: explicit roles become jobs, while broad company hiring mentions are retained as signals and official Greenhouse or Ashby boards are added for future fetches. Scout does not send email, delete messages, or mark them read.</p>
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
          {newsletterSignalCounts.total > 0 ? (
            <div className="callout">
              <strong>{newsletterSignalCounts.total} company leads retained.</strong>{" "}
              {newsletterSignalCounts.explicit_roles || 0} name a specific role and {newsletterSignalCounts.company_signals || 0} identify a company that is hiring more broadly.
              {newsletterSignalCounts.company_signals ? <>{" "}<Link className="text-link" href="/signals">Review target companies</Link></> : null}
            </div>
          ) : null}
        </div>
      </section>

      <div className="spacer" />
      <section className="card">
        <div className="card-header"><div><h2>Automatic discovery feeds</h2><p>Scout searches these feeds using your target role, location, seniority, and experience profile.</p></div><StatusPill status="enabled" /></div>
        <div className="card-body">
          <p className="muted">When collection runs, Scout searches for Product Designer and UI/UX Designer across broad public services. Design Engineer stays limited to Gmail, imports, Greenhouse, Ashby, and direct sources where Scout can inspect the description and confirm digital product work.</p>
          <div className="callout"><strong>Current rules:</strong> {getSetting("search_usa_only", "1") === "1" ? "United States only" : "All configured locations"}, {getSetting("search_experience_min", "2")} to {getSetting("search_experience_max", "5")} years, up to {getSetting("search_max_age_days", "60")} days old. Senior Product Designer passes when the posting asks for five years or less.</div>
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
      

      <div className="spacer" />
      <div className="two-column">
        <section className="card form-card">
          <div className="form-section">
            <h2>Company discovery pages</h2>
            <p>Add a VC portfolio or company directory once. Scout rotates through its company links and detects Greenhouse or Ashby career boards automatically.</p>
            <form action={addCompanyDiscoverySourceAction}>
              <div className="form-grid">
                <div className="field full"><label htmlFor="directory_name">Source name</label><input id="directory_name" name="name" required placeholder="Example Ventures portfolio" /></div>
                <div className="field full"><label htmlFor="directory_url">Portfolio or directory URL</label><input id="directory_url" name="url" type="url" required placeholder="https://example.vc/portfolio" /></div>
                <div className="field"><label htmlFor="include_companies">Only these companies</label><input id="include_companies" name="include_companies" placeholder="Hanover, Variance" /><span className="field-help">Optional comma-separated allowlist.</span></div>
                <div className="field"><label htmlFor="exclude_companies">Exclude companies</label><input id="exclude_companies" name="exclude_companies" placeholder="Arbor" /><span className="field-help">Optional comma-separated blocklist.</span></div>
              </div>
              <div className="form-actions"><button className="button" type="submit">Add discovery page</button></div>
            </form>
          </div>
        </section>

        <section className="card">
          <div className="card-header"><div><h2>Discovery pages</h2><p>{companyDiscoverySources.filter((source) => source.enabled).length} enabled</p></div></div>
          {companyDiscoverySources.length ? (
            <div className="table-wrap"><table><thead><tr><th>Source</th><th>Next check</th><th>Status</th><th /></tr></thead><tbody>
              {companyDiscoverySources.map((source) => {
                const cooling = source.cooldown_until && new Date(source.cooldown_until).getTime() > now;
                const status = !source.enabled ? "paused" : source.last_error ? "error" : cooling ? "cooldown" : source.last_success_at ? "healthy" : "ready";
                return <tr key={source.id}>
                  <td><a className="job-title text-link" href={source.url} target="_blank" rel="noreferrer">{source.name}</a><span className="job-meta">{source.last_error || companyDiscoverySummaryText(companyDiscoverySummaries.get(source.id), source.query_cursor)}</span>{source.include_companies ? <span className="job-meta">Only: {source.include_companies}</span> : null}{source.exclude_companies ? <span className="job-meta">Excluded: {source.exclude_companies}</span> : null}</td>
                  <td>{cooling ? formatDateTime(source.cooldown_until) : "Ready now"}</td>
                  <td><StatusPill status={status} /></td>
                  <td><div className="inline-actions">
                    <form action={toggleCompanyDiscoverySourceAction}><input type="hidden" name="id" value={source.id} /><button className="button ghost small" type="submit">{source.enabled ? "Pause" : "Enable"}</button></form>
                    <form action={deleteCompanyDiscoverySourceAction}><input type="hidden" name="id" value={source.id} /><button className="button ghost small danger-text" type="submit">Remove</button></form>
                  </div></td>
                </tr>;
              })}
            </tbody></table></div>
          ) : <EmptyState title="No discovery pages yet" body="Add a VC portfolio or company directory when you want Scout to expand its official company coverage." />}
        </section>
      </div>

      <div className="spacer" />
      <div className="two-column">
        <section className="card form-card">
          <div className="form-section">
            <h2>Add an official board manually</h2>
            <p>Scout normally detects Greenhouse and Ashby boards from jobs and discovery pages. Manual entry remains available for a board you already know.</p>
            <form action={addSourceAction}>
              <div className="form-grid">
                <div className="field full"><label htmlFor="name">Company name</label><input id="name" name="name" required placeholder="Example Company" /></div>
                <div className="field"><label htmlFor="source_type">Career platform</label><select id="source_type" name="source_type"><option value="greenhouse">Greenhouse</option><option value="ashby">Ashby</option><option value="lever">Lever</option></select></div>
                <div className="field"><label htmlFor="identifier">Board token or site name</label><input id="identifier" name="identifier" required placeholder="examplecompany" /></div>
              </div>
              <div className="form-actions"><button className="button" type="submit">Add source</button></div>
            </form>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>Official company boards</h2>
              <p>{tierCounts.watchlist} checked every fetch, {tierCounts.standard} daily, {tierCounts.dormant} weekly. A board earns frequent checks by producing a role you can actually apply to, and slows down when it stays quiet. None are ever deleted.</p>
            </div>
            {tierCounts.standard + tierCounts.dormant > 0 ? (
              <form action={wakeRestingSourcesAction}>
                <button className="button secondary small" type="submit">Wake all resting boards</button>
              </form>
            ) : null}
          </div>
          {sources.length ? (
            <div className="card-body stack">
              <BoardTable rows={byTier.watchlist} caption="Checked every fetch" now={now} />
              <BoardTable rows={byTier.standard} caption="Checked daily" now={now} />
              {byTier.dormant.length ? (
                <details className="board-tier-group">
                  <summary>{byTier.dormant.length} resting boards, checked weekly</summary>
                  <BoardTable rows={byTier.dormant} caption="" now={now} />
                </details>
              ) : null}
            </div>
          ) : <EmptyState title="No official boards detected yet" body="Scout adds Greenhouse, Ashby, and Lever boards automatically when Exa or a collected job exposes one." />}
        </section>
      </div>

      <div className="spacer" />
      
    </div>
  );
}
