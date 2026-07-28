import Link from "next/link";
import { notFound } from "next/navigation";
import { generateResumeAction, updateJobStatusAction } from "@/app/actions";
import { ConfidenceBadge, PageHeader, ScoreBadge, StatusPill } from "@/components/UI";
import { ResumeSubmitButton } from "@/components/ResumeSubmitButton";
import { db } from "@/lib/database";
import type { ConfidenceBreakdown, Job, ScoreBreakdown } from "@/lib/types";
import { formatDate, safeJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface JobPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ imported?: string }>;
}

export default async function JobDetailPage({ params, searchParams }: JobPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(Number(id)) as Job | undefined;
  if (!job) notFound();
  const breakdown = safeJson<ScoreBreakdown>(job.score_breakdown, {
    title: 0, skills: 0, seniority: 0, location: 0, recency: 0, compensation: 0,
    total: 0, hardFilterPass: true, hardFilterReasons: [], matchingSkills: [], missingSkills: [],
  });
  const latestResume = db.prepare("SELECT id, status FROM resume_versions WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(job.id) as { id: number; status: string } | undefined;
  const application = db.prepare("SELECT id, status FROM applications WHERE job_id = ?").get(job.id) as { id: number; status: string } | undefined;
  const applicationIsActive = application && application.status !== "ready_to_apply";
  const confidence = safeJson<ConfidenceBreakdown>(job.confidence_breakdown, {
    sourceIntegrity: 0, freshness: 0, completeness: 0, specificity: 0, repeatedSightings: 0,
    companyActivity: 0, riskAdjustment: 0, total: 0, dataSufficiency: "low", positiveSignals: [], cautionSignals: [],
  });

  return (
    <div className="page">
      <PageHeader eyebrow={`${job.company} · ${job.source_type}`} title={job.title} description={`${job.location || "Location not listed"} · ${job.employment_type || job.workplace_type || "Work type not listed"}`}>
        <ScoreBadge score={job.score} passed={job.hard_filter_pass !== 0} />
        <ConfidenceBadge score={job.confidence_score} />
        {job.apply_url ? <a className="button secondary" href={job.apply_url} target="_blank" rel="noreferrer">View original posting</a> : null}
      </PageHeader>
      {query.imported === "1" ? (
        <div className="callout success" role="status">
          <strong>Job imported and scored.</strong>
          <p>Scout opened the result directly because jobs outside your saved criteria are hidden from the default eligible list.</p>
        </div>
      ) : null}

      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <div className="card-header"><div><h2>Match assessment</h2><p>{job.match_summary}</p></div><StatusPill status={job.status} /></div>
            <div className="card-body">
              {!breakdown.hardFilterPass ? <div className="callout warning"><strong>Hard filter review</strong><ul>{breakdown.hardFilterReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}
              <div className="two-column">
                <div><h3>Matching profile skills</h3><div className="tag-list">{breakdown.matchingSkills.length ? breakdown.matchingSkills.map((skill) => <span className="tag match" key={skill}>{skill}</span>) : <span className="muted">No direct skill matches found.</span>}</div></div>
                <div><h3>Profile skills not found</h3><div className="tag-list">{breakdown.missingSkills.length ? breakdown.missingSkills.map((skill) => <span className="tag" key={skill}>{skill}</span>) : <span className="muted">No missing profile skills.</span>}</div></div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2>Posting confidence</h2><p>{job.confidence_summary || "Waiting for scoring data."}</p></div><ConfidenceBadge score={job.confidence_score} /></div>
            <div className="card-body">
              <div className="callout warning">Use this as an approval aid only. It is not proof that a role is genuine, funded, or actively reviewed.</div>
              <ul className="breakdown-list">
                <li><span>Source integrity</span><strong>{confidence.sourceIntegrity}/15</strong></li>
                <li><span>Freshness</span><strong>{confidence.freshness}/25</strong></li>
                <li><span>Completeness</span><strong>{confidence.completeness}/20</strong></li>
                <li><span>Specificity</span><strong>{confidence.specificity}/15</strong></li>
                <li><span>Repeated sightings</span><strong>{confidence.repeatedSightings}/10</strong></li>
                <li><span>Company activity</span><strong>{confidence.companyActivity}/15</strong></li>
                <li><span>Risk adjustment</span><strong>{confidence.riskAdjustment}</strong></li>
              </ul>
              <h3>Positive signals</h3>
              {confidence.positiveSignals.length ? <ul>{confidence.positiveSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul> : <p className="muted">No strong positive signals yet.</p>}
              <h3>Caution signals</h3>
              {confidence.cautionSignals.length ? <ul>{confidence.cautionSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul> : <p className="muted">No material cautions detected.</p>}
              <p className="muted">Data sufficiency: <strong>{confidence.dataSufficiency}</strong></p>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2>Job description</h2><p>Source: {job.source_name || job.source_type} · Collected {formatDate(job.first_seen_at)} · Last seen {formatDate(job.last_seen_at)}</p></div>{job.canonical_url ? <a className="text-link" href={job.canonical_url} target="_blank" rel="noreferrer">View source</a> : null}</div>
            <div className="card-body job-description">{job.description || "No description was provided by this source."}</div>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-header"><div><h2>Score breakdown</h2><p>Explainable and deterministic</p></div></div>
            <div className="card-body"><ul className="breakdown-list"><li><span>Title alignment</span><strong>{breakdown.title}/25</strong></li><li><span>Skill coverage</span><strong>{breakdown.skills}/35</strong></li><li><span>Seniority</span><strong>{breakdown.seniority}/15</strong></li><li><span>Location</span><strong>{breakdown.location}/10</strong></li><li><span>Recency</span><strong>{breakdown.recency}/10</strong></li><li><span>Compensation</span><strong>{breakdown.compensation}/5</strong></li></ul></div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2>Decision</h2><p>Keep the queue intentional</p></div></div>
            <div className="card-body stack">
              <div className="inline-actions">
                <form action={updateJobStatusAction}><input type="hidden" name="id" value={job.id} /><input type="hidden" name="status" value="shortlisted" /><button className="button secondary" type="submit">Shortlist</button></form>
                <form action={updateJobStatusAction}><input type="hidden" name="id" value={job.id} /><input type="hidden" name="status" value="dismissed" /><button className="button danger" type="submit">Dismiss</button></form>
              </div>
              {applicationIsActive ? (
                <Link className="button" href="/applications">View {application.status.replaceAll("_", " ")} application</Link>
              ) : latestResume?.status === "draft" ? (
                <Link className="button" href={`/resumes/${latestResume.id}`}>Continue preparation</Link>
              ) : latestResume?.status === "approved" ? (
                <Link className="button" href={`/resumes/${latestResume.id}`}>Continue to application</Link>
              ) : (
                <form action={generateResumeAction}>
                  <input type="hidden" name="job_id" value={job.id} />
                  <ResumeSubmitButton>{latestResume?.status === "rejected" ? "Prepare again" : "Prepare application"}</ResumeSubmitButton>
                </form>
              )}
              <small className="muted">Next: resume workspace, approval, company application, then tracking.</small>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
