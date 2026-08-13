import { addFactAction, deleteFactAction, saveProfileAction } from "@/app/actions";
import { EmptyState, PageHeader, StatusPill } from "@/components/UI";
import { db } from "@/lib/database";
import type { CandidateFact, CandidateProfile } from "@/lib/types";
import { parseList } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const facts = db.prepare("SELECT * FROM candidate_facts ORDER BY created_at DESC").all() as CandidateFact[];
  const workplaces = parseList(profile.workplace_preferences);

  return (
    <div className="page">
      <PageHeader title="Candidate profile" description="The single source of truth for matching and resume generation.">
        <StatusPill status={`${facts.filter((fact) => fact.verified).length} verified facts`} />
      </PageHeader>

      <div className="dashboard-grid">
        <form action={saveProfileAction} className="card form-card">
          <section className="form-section">
            <h2>Identity and default summary</h2>
            <p>Keep these fields current because every newly generated resume uses them.</p>
            <div className="form-grid">
              <div className="field"><label htmlFor="full_name">Full name</label><input id="full_name" name="full_name" required defaultValue={profile.full_name} /></div>
              <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" defaultValue={profile.email} /></div>
              <div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" defaultValue={profile.phone} /></div>
              <div className="field"><label htmlFor="home_location">Current location</label><input id="home_location" name="home_location" defaultValue={profile.home_location} /></div>
              <div className="field full"><label htmlFor="professional_summary">Default resume summary</label><textarea id="professional_summary" name="professional_summary" rows={5} defaultValue={profile.professional_summary} /><small>This is the source of truth for the summary in newly generated resumes. Replace the current Product Designer / Design Engineer wording here.</small></div>
            </div>
          </section>

          <section className="form-section">
            <h2>Search preferences</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="target_titles">Target roles</label><textarea id="target_titles" name="target_titles" defaultValue={parseList(profile.target_titles).join("\n")} /></div>
              <div className="field"><label htmlFor="skills">Verified skills</label><textarea id="skills" name="skills" defaultValue={parseList(profile.skills).join("\n")} /></div>
              <div className="field"><label htmlFor="target_seniority">Target seniority</label><select id="target_seniority" name="target_seniority" defaultValue={profile.target_seniority}><option value="intern">Intern</option><option value="junior">Junior</option><option value="mid">Mid level</option><option value="senior">Senior</option><option value="staff">Staff</option><option value="lead">Lead</option><option value="manager">Manager</option></select></div>
              <div className="field"><label htmlFor="years_experience">Years of experience</label><input id="years_experience" name="years_experience" type="number" min="0" max="50" defaultValue={profile.years_experience ?? ""} /></div>
              <div className="field"><label htmlFor="preferred_locations">Preferred locations</label><textarea id="preferred_locations" name="preferred_locations" defaultValue={parseList(profile.preferred_locations).join("\n")} /></div>
              <div className="field"><label>Workplace preferences</label><div className="check-row">
                {[["remote", "Remote"], ["hybrid", "Hybrid"], ["on-site", "On-site"]].map(([value, label]) => <label className="check-label" key={value}><input type="checkbox" name="workplace_preferences" value={value} defaultChecked={workplaces.includes(value)} /> {label}</label>)}
              </div></div>
              <div className="field"><label htmlFor="work_authorization">Work authorization</label><input id="work_authorization" name="work_authorization" defaultValue={profile.work_authorization} /></div>
              <div className="field"><label htmlFor="minimum_salary">Minimum compensation</label><input id="minimum_salary" name="minimum_salary" type="number" min="0" step="1000" defaultValue={profile.minimum_salary ?? ""} /></div>
              <div className="field full"><label className="check-label"><input type="checkbox" name="sponsorship_required" defaultChecked={Boolean(profile.sponsorship_required)} /> I require current or future sponsorship</label></div>
            </div>
          </section>

          <section className="form-section">
            <h2>Resume and links</h2>
            <div className="form-grid">
              <div className="field full"><label htmlFor="base_resume_text">Full base resume content</label><textarea id="base_resume_text" name="base_resume_text" rows={18} defaultValue={profile.base_resume_text} /><small>Paste the complete latest resume here. Existing tailored resume versions remain unchanged so an approved application cannot change unexpectedly.</small></div>
              <div className="field"><label htmlFor="portfolio_url">Portfolio URL</label><input id="portfolio_url" name="portfolio_url" type="url" defaultValue={profile.portfolio_url} /></div>
              <div className="field"><label htmlFor="linkedin_url">LinkedIn URL</label><input id="linkedin_url" name="linkedin_url" type="url" defaultValue={profile.linkedin_url} /></div>
              <div className="field"><label htmlFor="github_url">GitHub URL</label><input id="github_url" name="github_url" type="url" defaultValue={profile.github_url} /></div>
            </div>
          </section>
          <div className="form-actions"><button className="button" type="submit">Save and rescore jobs</button></div>
        </form>

        <aside className="stack">
          <section className="card form-card">
            <div className="form-section">
              <h2>Add verified fact</h2>
              <p>Resume generation can use only facts confirmed here.</p>
              <form action={addFactAction} className="stack">
                <div className="field"><label htmlFor="category">Section</label><select id="category" name="category"><option>Experience</option><option>Project</option><option>Education</option><option>Certification</option></select></div>
                <div className="field"><label htmlFor="context">Company, project, or school</label><input id="context" name="context" placeholder="Nike, Senior Designer" /></div>
                <div className="field"><label htmlFor="claim">Fact or achievement</label><textarea id="claim" name="claim" required placeholder="Led a verified project and include a metric when one is known." /></div>
                <div className="field"><label htmlFor="fact_skills">Skills demonstrated</label><input id="fact_skills" name="fact_skills" placeholder="Figma, research, facilitation" /></div>
                <label className="check-label"><input type="checkbox" name="verified" defaultChecked /> I confirm this is accurate</label>
                <button className="button" type="submit">Add to truth bank</button>
              </form>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><div><h2>Truth bank</h2><p>{facts.length} candidate facts</p></div></div>
            {facts.length ? <div className="card-body stack">{facts.map((fact) => <article key={fact.id}>
              <div className="inline-actions"><StatusPill status={fact.category} />{fact.verified ? <span className="success-text">Verified</span> : <span className="danger-text">Unverified</span>}</div>
              <strong>{fact.context}</strong><p>{fact.claim}</p>
              <div className="inline-actions"><div className="tag-list">{parseList(fact.skills).map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div><form action={deleteFactAction}><input type="hidden" name="id" value={fact.id} /><button className="button ghost small danger-text" type="submit">Remove</button></form></div>
            </article>)}</div> : <EmptyState title="No facts yet" body="Add accomplishments, projects, education, and credentials that resume generation may use." />}
          </section>
        </aside>
      </div>
    </div>
  );
}
