import Link from "next/link";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

interface ContactOpportunity {
  id: number;
  title: string;
  company: string;
  description: string;
  apply_url: string;
  status: string;
  application_status: string | null;
  contact_name: string | null;
  contact_details: string | null;
}

function companyDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function publicContacts(value: string): string[] {
  const emails = value.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  const linkedIn = value.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s<>"')]+/gi) || [];
  return [...new Set([...emails, ...linkedIn])].slice(0, 4);
}

export default function ContactsPage() {
  const opportunities = db.prepare(`
    SELECT jobs.id, jobs.title, jobs.company, jobs.description, jobs.apply_url, jobs.status,
      applications.status AS application_status,
      applications.contact_name,
      applications.contact_details
    FROM jobs
    LEFT JOIN applications ON applications.job_id = jobs.id
    WHERE applications.id IS NOT NULL OR jobs.status IN ('reviewing', 'shortlisted')
    ORDER BY applications.updated_at DESC, jobs.score DESC, jobs.first_seen_at DESC
    LIMIT 100
  `).all() as ContactOpportunity[];

  return (
    <div className="page">
      <PageHeader
        title="Contact research"
        description="Find a recruiter, hiring manager, or warm connection for every serious application."
      />

      <div className="callout">
        Scout does not invent names or email addresses. These links open targeted searches, and saved contacts appear in this table after you confirm them.
      </div>
      <div className="spacer" />

      <section className="card">
        <div className="card-header"><div><h2>{opportunities.length} contact plans</h2><p>Shortlisted and tracked opportunities</p></div></div>
        {opportunities.length ? <div className="table-wrap"><table><thead><tr><th>Opportunity</th><th>Saved contact</th><th>Research links</th><th>Application</th><th>Status</th></tr></thead><tbody>
          {opportunities.map((opportunity) => {
            const domain = companyDomain(opportunity.apply_url);
            const recruiterSearch = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${opportunity.company} recruiter talent acquisition`)}`;
            const managerSearch = `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in ${opportunity.company} ${opportunity.title} manager`)}`;
            const emailSearch = `https://www.google.com/search?q=${encodeURIComponent(`${opportunity.company} recruiter email ${domain}`)}`;
            const contactIsEmail = Boolean(opportunity.contact_details && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opportunity.contact_details));
            const detectedContacts = publicContacts(opportunity.description);
            return <tr key={opportunity.id}>
              <td><Link className="job-title" href={`/jobs/${opportunity.id}`}>{opportunity.title}</Link><span className="job-meta">{opportunity.company}</span></td>
              <td>{opportunity.contact_name || opportunity.contact_details
                ? <><span className="job-title">{opportunity.contact_name || "Saved contact"}</span>{contactIsEmail ? <a className="text-link" href={`mailto:${opportunity.contact_details}`}>{opportunity.contact_details}</a> : <span className="job-meta">{opportunity.contact_details}</span>}</>
                : detectedContacts.length
                  ? <div className="stack compact-stack">{detectedContacts.map((contact) => contact.includes("@") ? <a className="text-link" href={`mailto:${contact}`} key={contact}>{contact}</a> : <a className="text-link" href={contact} target="_blank" rel="noreferrer" key={contact}>LinkedIn profile</a>)}</div>
                  : <span className="muted">Not confirmed yet</span>}</td>
              <td><div className="inline-actions"><a className="text-link" href={recruiterSearch} target="_blank" rel="noreferrer">Recruiters</a><a className="text-link" href={managerSearch} target="_blank" rel="noreferrer">Hiring manager</a><a className="text-link" href={emailSearch} target="_blank" rel="noreferrer">Public email search</a></div></td>
              <td>{opportunity.apply_url ? <a className="button secondary small" href={opportunity.apply_url} target="_blank" rel="noreferrer">Apply</a> : <span className="muted">Unavailable</span>}</td>
              <td><StatusPill status={opportunity.application_status || opportunity.status} /></td>
            </tr>;
          })}
        </tbody></table></div> : <EmptyState title="No contact plans yet" body="Shortlist a job or mark an application submitted to create a contact plan." href="/jobs" action="Review jobs" />}
      </section>
    </div>
  );
}
