import Link from "next/link";
import { PageHeader, StatusPill } from "@/components/UI";
import { db } from "@/lib/database";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface SignalsPageProps {
  searchParams: Promise<{ q?: string; source?: string }>;
}

interface HiringSignalRow {
  id: number;
  source_name: string;
  company: string;
  role_hint: string;
  location: string;
  signal_text: string;
  url: string;
  signal_type: string;
  first_seen_at: string;
  last_seen_at: string;
  related_job_id: number | null;
  related_job_title: string | null;
}

export default async function TargetCompaniesPage({ searchParams }: SignalsPageProps) {
  const parameters = await searchParams;
  const query = parameters.q?.trim() || "";
  const source = parameters.source?.trim() || "all";
  const clauses = ["gmail_hiring_signals.signal_type = 'company_hiring'"];
  const values: string[] = [];
  if (query) {
    clauses.push("(gmail_hiring_signals.company LIKE ? OR gmail_hiring_signals.signal_text LIKE ? OR gmail_hiring_signals.role_hint LIKE ?)");
    values.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (source !== "all") {
    clauses.push("gmail_hiring_signals.source_name = ?");
    values.push(source);
  }
  const signals = db.prepare(`
    SELECT gmail_hiring_signals.*,
      (
        SELECT jobs.id FROM jobs
        WHERE lower(jobs.company) = lower(gmail_hiring_signals.company)
          AND jobs.duplicate_of_job_id IS NULL
        ORDER BY CASE jobs.eligibility_status WHEN 'eligible' THEN 0 WHEN 'needs_verification' THEN 1 ELSE 2 END,
          jobs.score DESC, jobs.last_seen_at DESC
        LIMIT 1
      ) AS related_job_id,
      (
        SELECT jobs.title FROM jobs
        WHERE lower(jobs.company) = lower(gmail_hiring_signals.company)
          AND jobs.duplicate_of_job_id IS NULL
        ORDER BY CASE jobs.eligibility_status WHEN 'eligible' THEN 0 WHEN 'needs_verification' THEN 1 ELSE 2 END,
          jobs.score DESC, jobs.last_seen_at DESC
        LIMIT 1
      ) AS related_job_title
    FROM gmail_hiring_signals
    WHERE ${clauses.join(" AND ")}
    ORDER BY gmail_hiring_signals.last_seen_at DESC, gmail_hiring_signals.id DESC
    LIMIT 200
  `).all(...values) as HiringSignalRow[];
  const sources = db.prepare(`
    SELECT DISTINCT source_name
    FROM gmail_hiring_signals
    WHERE signal_type = 'company_hiring'
    ORDER BY source_name
  `).all() as Array<{ source_name: string }>;
  const summary = db.prepare(`
    SELECT COUNT(*) AS signals, COUNT(DISTINCT lower(company)) AS companies
    FROM gmail_hiring_signals
    WHERE signal_type = 'company_hiring'
  `).get() as { signals: number; companies: number };
  const relatedCompanyCount = new Set(signals.filter((signal) => signal.related_job_id).map((signal) => signal.company.toLowerCase())).size;

  return (
    <div className="page">
      <PageHeader title="Target companies" description="Early company momentum worth validating before contact research and outreach." />

      <section className="signal-summary-grid">
        <div><strong>{summary.signals}</strong><span>Unranked signals</span></div>
        <div><strong>{summary.companies}</strong><span>Companies mentioned</span></div>
        <div><strong>{relatedCompanyCount}</strong><span>Companies with a related Scout job</span></div>
      </section>

      <div className="callout signal-policy-note">
        <strong>These are leads, not recommendations yet.</strong> Scout should only promote a company after it finds credible momentum, a product-design fit, and a reachable decision maker.
      </div>

      <form className="jobs-filter-bar signal-filter-bar" method="get">
        <label className="jobs-search-field">
          <span aria-hidden="true">⌕</span>
          <input aria-label="Search target companies" defaultValue={query} name="q" placeholder="Search company or momentum evidence" type="search" />
        </label>
        <select aria-label="Newsletter source" defaultValue={source} name="source">
          <option value="all">All newsletters</option>
          {sources.map((item) => <option key={item.source_name} value={item.source_name}>{item.source_name}</option>)}
        </select>
        <button className="button secondary" type="submit">Filter</button>
      </form>

      <section className="card signal-list-card">
        <div className="card-header"><div><h2>{signals.length} companies to validate</h2><p>These remain unranked until Scout confirms momentum, fit, and reachability.</p></div></div>
        {signals.length ? (
          <div className="signal-list">
            {signals.map((signal) => (
              <article className="signal-row" key={signal.id}>
                <div className="signal-company">
                  <strong>{signal.company}</strong>
                  <span>{signal.source_name}</span>
                  <small>Last seen {formatDateTime(signal.last_seen_at)}</small>
                </div>
                <div className="signal-evidence">
                  <p>{signal.signal_text}</p>
                  <div className="inline-actions">
                    {signal.location ? <span className="tag">{signal.location}</span> : null}
                    <StatusPill status="newsletter_signal" />
                  </div>
                </div>
                <div className="signal-actions">
                  <a className="button secondary small" href={signal.url} rel="noreferrer" target="_blank">Open evidence</a>
                  {signal.related_job_id ? (
                    <Link className="text-link" href={`/jobs/${signal.related_job_id}`}>Review {signal.related_job_title || "related job"}</Link>
                  ) : (
                    <Link className="text-link" href={`/jobs?q=${encodeURIComponent(signal.company)}`}>Check Scout jobs</Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><h3>No signals match these filters</h3><p>Clear the filters or wait for the next newsletter import.</p></div>}
      </section>
    </div>
  );
}
