"use client";

import { useEffect, useState, useTransition } from "react";
import { newsletterResearchStatusAction, startNewsletterResearchAction } from "@/app/newsletters/actions";
import type { CompanyResearch, NewsletterResearchRun, ResearchPolicy } from "@/lib/newsletter-research-models";
import { Button, EmptyState, Spinner } from "@/components/UI";
import styles from "@/app/newsletters/newsletters.module.css";

const topicLabels = { company_identity: "Company identity", target_market: "Target market", product_market_fit: "Product-market fit", growth: "Growth", design_gap: "Design capacity", hiring: "Design hiring", company_size: "Company scale", visa_fit: "Visa and citizenship fit" };
const actionLabel = (action: string) => action.replaceAll("_", " ");

function CompanyRecord({ company, shortlisted }: { company: CompanyResearch; shortlisted: boolean }) {
  return <article className={styles.opportunity}>
    <header><h3>{company.company}</h3><span className={styles.band}>{shortlisted ? "Shortlisted" : company.verdict} · {company.confidence} confidence</span></header>
    <p className={styles.note}>{company.status === "stopped" ? `${company.actions_taken} research actions · ${company.stop_reason}` : `${company.status} · ${company.actions_taken} research actions`}</p>
    <div className={styles.hypothesis}><h4>What Scout currently believes</h4><p>{company.current_hypothesis}</p><h4>Opportunity brief</h4><p>{company.opportunity_brief}</p></div>
    <details className={styles.details} open={shortlisted}>
      <summary>Evidence, uncertainties and research history</summary>
      <h4>What supports this belief</h4>
      {company.known_facts.length ? company.known_facts.map((fact) => {
        const source = company.sources.find((source) => source.id === fact.source_id);
        return <div className={styles.evidence} id={`${company.companyId}-${fact.id}`} key={fact.id}>
          <blockquote>{fact.quote}</blockquote>
          <small>{fact.id} · {source?.kind === "newsletter" ? "Newsletter report" : source?.kind === "search_excerpt" ? "Search excerpt; full page not verified" : "Page read"}{source?.truncated ? " · partial text" : ""} · {source ? new Date(source.retrieved_at).toLocaleDateString() : ""}{source?.url ? <> · <a href={source.url} target="_blank" rel="noreferrer">{source.title || "Source"}</a></> : null}</small>
        </div>;
      }) : <p>No attributed facts yet.</p>}
      <h4>Your opportunity criteria</h4>
      <dl className={styles.criteria}>{Object.entries(company.criteria).map(([topic, criterion]) => <div key={topic}>
        <dt>{topicLabels[topic as keyof typeof topicLabels]} <span>{criterion.status}</span></dt>
        <dd>{criterion.summary}{criterion.evidence_ids.length ? <> · {criterion.evidence_ids.map((id) => <a key={id} href={`#${company.companyId}-${id}`}>{id} </a>)}</> : null}</dd>
      </div>)}</dl>
      <h4>What remains uncertain</h4>
      {company.unknowns.length ? <ul>{company.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul> : <p>No material uncertainty recorded.</p>}
      <h4>How Scout investigated</h4>
      <ol className={styles.history}>{company.research_history.map((entry) => <li key={entry.step}>
        <details><summary>{actionLabel(entry.decision.action)}{entry.error ? " · unavailable" : ""}</summary>
          <p><strong>Key uncertainty:</strong> {entry.decision.key_uncertainty}</p>
          <p><strong>Expected value:</strong> {entry.decision.expected_information_gain}</p>
          <p><strong>Worth taking:</strong> {entry.decision.worth_taking ? "Yes" : "No"}. {entry.decision.decision_reason}</p>
          {entry.decision.target_url ? <a href={entry.decision.target_url} target="_blank" rel="noreferrer">Inspected target</a> : null}
          <p><strong>Outcome:</strong> {entry.error || entry.outcome || "Gathering evidence..."}</p>
          {entry.after ? <p><strong>Updated belief:</strong> {entry.after.current_hypothesis} ({entry.after.confidence} confidence; {entry.after.verdict})</p> : null}
        </details>
      </li>)}</ol>
    </details>
  </article>;
}

export function NewsletterWorkspace({ profileReady, initialRun, initialPolicy }: { profileReady: boolean; initialRun: NewsletterResearchRun | null; initialPolicy: ResearchPolicy }) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [criteria, setCriteria] = useState(initialPolicy.criteria);
  const [maxActions, setMaxActions] = useState(initialPolicy.maxActions);
  const [run, setRun] = useState(initialRun);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const running = run?.status === "running";
  const busy = pending || running;
  const runId = run?.id;

  useEffect(() => {
    if (!runId || !running) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = runId;
    const poll = async () => {
      try {
        const updated = await newsletterResearchStatusAction(id);
        if (!active) return;
        setRun(updated);
        setError(null);
        if (updated.status !== "running") return;
      } catch { if (active) setError("Progress could not be refreshed. Scout keeps working; retrying shortly."); }
      if (active) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1500);
    return () => { active = false; clearTimeout(timer); };
  }, [runId, running]);

  function download() {
    if (!run) return;
    const blob = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = blob; link.download = `scout-newsletter-${run.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(blob), 1000);
  }
  const analysis = run?.analysis;
  const shortlistIds = new Set(analysis?.shortlist.map((company) => company.companyId));
  const otherCompanies = analysis?.companies.filter((company) => !shortlistIds.has(company.companyId)) || [];
  return <>
    <form className={styles.form} aria-busy={busy} onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setError(null);
      startTransition(async () => { try { const state = await startNewsletterResearchAction(form); setError(state.error); if (state.run) setRun(state.run); } catch { setError("Could not start the investigation. Try again."); } });
    }}>
      <fieldset className={styles.inputChoice} disabled={busy}>
        <legend>What newsletter should Scout investigate?</legend>
        <label><input type="radio" name="mode" value="url" checked={mode === "url"} onChange={() => setMode("url")} />Newsletter link</label>
        <label><input type="radio" name="mode" value="text" checked={mode === "text"} onChange={() => setMode("text")} />Paste issue text</label>
      </fieldset>
      <div className="field">{mode === "url" ? <>
        <label htmlFor="newsletter-url">Newsletter link</label>
        <input id="newsletter-url" name="url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/newsletter/issue" disabled={busy} autoComplete="off" aria-describedby="newsletter-input-help" />
      </> : <>
        <label htmlFor="newsletter-text">Newsletter issue text</label>
        <textarea id="newsletter-text" name="text" required value={text} onChange={(event) => setText(event.target.value)} maxLength={60_000} rows={8} placeholder="Paste the newsletter issue here..." disabled={busy} aria-describedby="newsletter-input-help" />
      </>}<small id="newsletter-input-help">Use a public issue link, or paste email-only and paywalled issue text. Scout investigates every detected company.</small></div>
      <details className={styles.policy}><summary>Your research preferences</summary>
        <div className="field"><label htmlFor="newsletter-criteria">What makes a company worth pursuing?</label><textarea id="newsletter-criteria" name="criteria" required value={criteria} onChange={(event) => setCriteria(event.target.value)} maxLength={4000} rows={5} disabled={busy} /></div>
        <div className="field"><label htmlFor="newsletter-budget">Maximum research actions per company</label><select id="newsletter-budget" name="maxActions" value={maxActions} onChange={(event) => setMaxActions(Number(event.target.value))} disabled={busy}>{[1, 2, 5, 10].map((value) => <option value={value} key={value}>{value}{value === 5 ? " (balanced)" : ""}</option>)}</select></div>
        <p className={styles.note}>Conservative shortlist. Stops earlier when the evidence is sufficient, the opportunity is weak, or another action has little value. Preferences are saved when a run starts.</p>
      </details>
      <div className={styles.submitRow}><p>Scout checks market fit, growth, design capacity and hiring. It assesses visa restrictions separately. Several companies can take a few minutes.</p><Button type="submit" disabled={busy || !profileReady}>{busy ? <><Spinner />{pending ? "Starting investigation..." : "Investigating companies..."}</> : "Investigate newsletter"}</Button></div>
    </form>
    {busy ? <p className={styles.progress} role="status" aria-live="polite">{pending ? "Reading the newsletter..." : run?.progress} {!pending && analysis ? `${analysis.counts.completed}/${analysis.counts.detected} company records completed.` : ""} Research is saved as it runs; you can return to this page.</p> : null}
    {error || run?.error ? <p className={styles.error} role="alert">{error || run?.error}</p> : null}
    {run ? <section className={styles.results} aria-label="Newsletter investigation">
      <div className={styles.resultsHeading}><div><p className="eyebrow">Investigation</p><h2>{run.source.title}</h2>{run.source.url ? <a className="text-link" href={run.source.url} target="_blank" rel="noreferrer">View newsletter source</a> : null}</div><Button variant="secondary" onClick={download}>Download all company records</Button></div>
      {analysis ? <><div className={styles.counts}><div><strong>{analysis.counts.detected}</strong><span>Companies detected</span></div><div><strong>{analysis.counts.completed}</strong><span>Assessments completed</span></div><div><strong>{analysis.shortlist.length}</strong><span>Shortlisted</span></div></div>
        <p className={styles.note}>Confidence describes Scout&apos;s current conclusion, not your chance of being hired. Unknown design capacity and eligibility remain visible.</p>
        {analysis.shortlist.length ? <><h3 className={styles.sectionTitle}>Worth pursuing</h3>{analysis.shortlist.map((company) => <CompanyRecord company={company} shortlisted key={company.companyId} />)}</> : !running ? <EmptyState title="No well-supported opportunities yet" body="Review the watch and pass records below. Missing evidence may leave a promising company on watch." /> : null}
        {otherCompanies.length ? <><h3 className={styles.sectionTitle}>All other companies ({otherCompanies.length})</h3>{otherCompanies.map((company) => <CompanyRecord company={company} shortlisted={false} key={company.companyId} />)}</> : null}
      </> : null}
      <details className={styles.source}><summary>Review the newsletter text Scout analyzed ({run.source.text.length.toLocaleString()} characters)</summary><pre>{run.source.text}</pre></details>
    </section> : !pending && !error ? <EmptyState title="Start with a newsletter you already read" body="Bring an issue about products, funding, or company growth. Scout investigates the companies against your preferences and saved profile." /> : null}
  </>;
}
