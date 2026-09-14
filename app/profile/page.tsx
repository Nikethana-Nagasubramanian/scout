import { addFactAction, deleteFactAction, importResumeAction, saveProfileAction } from "@/app/actions";
import { EmptyState, PageHeader } from "@/components/UI";
import { db } from "@/lib/database";
import type { CandidateFact, CandidateProfile } from "@/lib/types";
import { parseList } from "@/lib/utils";

export const dynamic = "force-dynamic";

const seniorityLabels: Record<string, string> = {
  intern: "Intern", junior: "Junior", mid: "Mid level", senior: "Senior", staff: "Staff", lead: "Lead", manager: "Manager",
};

function ProfileSection({ label, title, description, children }: { label: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="profile-section">
      <div className="profile-section-intro">
        <span>{label}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="form-grid">{children}</div>
    </section>
  );
}

const importMessages: Record<string, { tone: "done" | "issue"; text: string }> = {
  done: { tone: "done", text: "Resume imported. Check the text below, review the truth bank, then save your profile." },
  empty: { tone: "issue", text: "Choose a resume file before importing." },
  too_large: { tone: "issue", text: "That file is over 5 MB. Export a smaller PDF or paste the text instead." },
  unreadable: { tone: "issue", text: "Scout could not read text from that file. Scanned PDFs have no text layer, so paste the resume instead." },
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const importResult = importMessages[(await searchParams).import || ""];
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const facts = db.prepare("SELECT * FROM candidate_facts ORDER BY created_at DESC").all() as CandidateFact[];
  const workplaces = parseList(profile.workplace_preferences);
  const targetTitles = parseList(profile.target_titles);
  const locations = parseList(profile.preferred_locations);
  const verifiedCount = facts.filter((fact) => fact.verified).length;
  const firstRun = !profile.onboarding_complete;

  return (
    <div className="page profile-page">
      <PageHeader title="Search profile" description="What Scout matches jobs against and the only facts it may use when tailoring a resume.">
        <button className="button" type="submit" form="profile-form">{firstRun ? "Save profile" : "Save and rescore jobs"}</button>
      </PageHeader>

      {firstRun ? (
        <section className="profile-start" aria-label="Getting started">
          <strong>Start here</strong>
          <ol>
            <li><span>Upload your resume.</span> Scout extracts the text and seeds the truth bank with its bullet points.</li>
            <li><span>Review the truth bank.</span> Remove anything inaccurate and add achievements the resume leaves out. Tailored resumes can only use these facts.</li>
            <li><span>Set your search and save.</span> Target roles, seniority, and locations decide which jobs Scout keeps. Then fetch jobs from the Jobs page.</li>
          </ol>
        </section>
      ) : null}
      {importResult ? <p className={`profile-import-notice ${importResult.tone}`} role="status">{importResult.text}</p> : null}

      <section className="jobs-search-snapshot profile-snapshot" aria-label="Profile summary">
        <div><span>Target roles</span><strong>{targetTitles.length ? targetTitles.slice(0, 2).join(", ") + (targetTitles.length > 2 ? ` +${targetTitles.length - 2}` : "") : "Not set"}</strong></div>
        <div><span>Seniority</span><strong>{seniorityLabels[profile.target_seniority] || "Not set"}{profile.years_experience ? `, ${profile.years_experience} yrs` : ""}</strong></div>
        <div><span>Locations</span><strong>{[...locations.slice(0, 2), ...workplaces].join(", ") || "Anywhere"}</strong></div>
        <div className={verifiedCount ? "" : "has-issue"}><span>Truth bank</span><strong>{verifiedCount} of {facts.length} facts verified</strong></div>
      </section>

      <div className="profile-layout">
        <form id="resume-import-form" action={importResumeAction} hidden />
        <form id="profile-form" action={saveProfileAction} className="profile-form">
          <ProfileSection label="01" title="Resume" description="Upload a PDF, DOCX, or text file, or paste the text. Existing tailored resumes stay unchanged when this changes.">
            <div className="field full profile-upload">
              <label htmlFor="resume_file">Resume file</label>
              <div className="profile-upload-row">
                <input id="resume_file" name="resume_file" type="file" form="resume-import-form" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" />
                <button className="button secondary" type="submit" form="resume-import-form" formNoValidate>Import resume</button>
              </div>
              <small>Importing replaces the text below. The truth bank is only seeded when it is empty.</small>
            </div>
            <div className="field full"><label htmlFor="base_resume_text">Base resume text</label><textarea id="base_resume_text" name="base_resume_text" rows={14} required defaultValue={profile.base_resume_text} placeholder="Paste the complete text of your current resume, or import a file above." /></div>
            <div className="field"><label htmlFor="portfolio_url">Portfolio URL</label><input id="portfolio_url" name="portfolio_url" type="url" defaultValue={profile.portfolio_url} placeholder="https://" /></div>
            <div className="field"><label htmlFor="linkedin_url">LinkedIn URL</label><input id="linkedin_url" name="linkedin_url" type="url" defaultValue={profile.linkedin_url} placeholder="https://linkedin.com/in/..." /></div>
            <div className="field"><label htmlFor="github_url">GitHub URL</label><input id="github_url" name="github_url" type="url" defaultValue={profile.github_url} placeholder="https://github.com/..." /></div>
          </ProfileSection>

          <ProfileSection label="02" title="Identity and summary" description="Every newly generated resume starts from these fields.">
            <div className="field"><label htmlFor="full_name">Full name</label><input id="full_name" name="full_name" required defaultValue={profile.full_name} /></div>
            <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" defaultValue={profile.email} /></div>
            <div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" defaultValue={profile.phone} /></div>
            <div className="field"><label htmlFor="home_location">Current location</label><input id="home_location" name="home_location" defaultValue={profile.home_location} /></div>
            <div className="field full"><label htmlFor="professional_summary">Default resume summary</label><textarea id="professional_summary" name="professional_summary" rows={5} defaultValue={profile.professional_summary} /><small>Used as the summary in new resumes. Tailored versions can adjust it per job.</small></div>
          </ProfileSection>

          <ProfileSection label="03" title="Search preferences" description="Scout scores and filters every fetched job against these. One entry per line.">
            <div className="field"><label htmlFor="target_titles">Target roles</label><textarea id="target_titles" name="target_titles" required placeholder={"Product Designer\nUX Designer"} defaultValue={targetTitles.join("\n")} /></div>
            <div className="field"><label htmlFor="skills">Verified skills</label><textarea id="skills" name="skills" defaultValue={parseList(profile.skills).join("\n")} /></div>
            <div className="field"><label htmlFor="target_seniority">Target seniority</label><select id="target_seniority" name="target_seniority" defaultValue={profile.target_seniority}>{Object.entries(seniorityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            <div className="field"><label htmlFor="years_experience">Years of experience</label><input id="years_experience" name="years_experience" type="number" min="0" max="50" defaultValue={profile.years_experience ?? ""} /></div>
            <div className="field"><label htmlFor="preferred_locations">Preferred locations</label><textarea id="preferred_locations" name="preferred_locations" defaultValue={locations.join("\n")} /></div>
            <fieldset className="field profile-choices">
              <legend>Workplace</legend>
              {[["remote", "Remote"], ["hybrid", "Hybrid"], ["on-site", "On-site"]].map(([value, label]) => <label className="check-label" key={value}><input type="checkbox" name="workplace_preferences" value={value} defaultChecked={workplaces.includes(value)} /> {label}</label>)}
            </fieldset>
            <div className="field"><label htmlFor="work_authorization">Work authorization</label><input id="work_authorization" name="work_authorization" defaultValue={profile.work_authorization} /></div>
            <div className="field"><label htmlFor="minimum_salary">Minimum compensation</label><input id="minimum_salary" name="minimum_salary" type="number" min="0" step="1000" defaultValue={profile.minimum_salary ?? ""} /></div>
            <div className="field full"><label className="check-label"><input type="checkbox" name="sponsorship_required" defaultChecked={Boolean(profile.sponsorship_required)} /> I require current or future sponsorship</label></div>
          </ProfileSection>


          <div className="profile-form-actions"><button className="button" type="submit">{firstRun ? "Save profile" : "Save and rescore jobs"}</button></div>
        </form>

        <aside className="profile-truth">
          <section className="profile-panel">
            <header className="profile-panel-header"><h2>Truth bank</h2><p>{facts.length} {facts.length === 1 ? "fact" : "facts"}, {verifiedCount} verified</p></header>
            {facts.length ? (
              <div className="profile-facts">
                {facts.map((fact) => (
                  <article className="profile-fact" key={fact.id}>
                    <div className="profile-fact-meta">
                      <span>{fact.category}</span>
                      <span>{fact.scope_type === "employer" ? `Only ${fact.scope_key || "one employer"}` : "Career-wide"}</span>
                      <span className={fact.verified ? "verified" : "unverified"}>{fact.verified ? "Verified" : "Unverified"}</span>
                    </div>
                    {fact.context ? <strong>{fact.context}</strong> : null}
                    <p>{fact.claim}</p>
                    <div className="profile-fact-footer">
                      <div className="tag-list">{parseList(fact.skills).map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div>
                      <form action={deleteFactAction}><input type="hidden" name="id" value={fact.id} /><button className="button ghost small danger-text" type="submit">Remove</button></form>
                    </div>
                  </article>
                ))}
              </div>
            ) : <EmptyState title="No facts yet" body="Add accomplishments, projects, education, and credentials that resume generation may use." />}
          </section>
          <section className="profile-panel">
            <header className="profile-panel-header"><h2>Add verified fact</h2><p>Resume generation can only use facts confirmed here.</p></header>
            <form action={addFactAction} className="profile-panel-body">
              <div className="field"><label htmlFor="category">Section</label><select id="category" name="category"><option>Experience</option><option>Project</option><option>Education</option><option>Certification</option></select></div>
              <div className="field"><label htmlFor="context">Company, project, or school</label><input id="context" name="context" placeholder="Nike, Senior Designer" /></div>
              <div className="field"><label htmlFor="scope_type">Where Scout may use it</label><select id="scope_type" name="scope_type"><option value="career">Summary or any relevant role</option><option value="employer">One employer only</option></select></div>
              <div className="field"><label htmlFor="scope_key">Employer when restricted</label><input id="scope_key" name="scope_key" placeholder="Leave empty for career-wide facts" /></div>
              <div className="field"><label htmlFor="claim">Fact or achievement</label><textarea id="claim" name="claim" required placeholder="Led a verified project and include a metric when one is known." /></div>
              <div className="field"><label htmlFor="fact_skills">Skills demonstrated</label><input id="fact_skills" name="fact_skills" placeholder="Figma, research, facilitation" /></div>
              <label className="check-label"><input type="checkbox" name="verified" defaultChecked /> I confirm this is accurate</label>
              <button className="button secondary" type="submit">Add to truth bank</button>
            </form>
          </section>

        </aside>
      </div>
    </div>
  );
}
