import { redirect } from "next/navigation";
import { saveOnboardingAction } from "@/app/actions";
import { db } from "@/lib/database";
import type { CandidateProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  if (profile.onboarding_complete) redirect("/");

  return (
    <div className="onboarding-shell">
      <div className="onboarding">
        <header className="onboarding-top">
          <span className="onboarding-logo">S</span>
          <p className="eyebrow">One candidate. One focused search.</p>
          <h1>Set up your search profile</h1>
          <p>Scout uses these facts to filter jobs and create honest, relevant resume versions.</p>
          <div className="progress" aria-label="Onboarding progress">
            <span className="active" /><span className="active" /><span className="active" /><span className="active" />
          </div>
        </header>

        <form action={saveOnboardingAction} className="card form-card">
          <section className="form-section">
            <h2>Candidate basics</h2>
            <p>This is a private local profile. There are no accounts or additional candidates.</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="full_name">Full name</label>
                <input id="full_name" name="full_name" required autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" autoComplete="email" />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input id="phone" name="phone" autoComplete="tel" />
              </div>
              <div className="field">
                <label htmlFor="home_location">Current location</label>
                <input id="home_location" name="home_location" placeholder="Chicago, IL" />
              </div>
              <div className="field full">
                <label htmlFor="professional_summary">Professional summary</label>
                <textarea id="professional_summary" name="professional_summary" placeholder="A short, factual summary of your experience and strengths." />
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>Target search</h2>
            <p>Use one item per line or separate items with commas.</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="target_titles">Target roles</label>
                <textarea id="target_titles" name="target_titles" required placeholder={"Product Designer\nUX Designer\nSenior Product Designer"} />
              </div>
              <div className="field">
                <label htmlFor="skills">Verified skills</label>
                <textarea id="skills" name="skills" required placeholder={"Figma\nUser research\nDesign systems\nPrototyping"} />
              </div>
              <div className="field">
                <label htmlFor="target_seniority">Target seniority</label>
                <select id="target_seniority" name="target_seniority" defaultValue="mid">
                  <option value="intern">Intern</option>
                  <option value="junior">Junior</option>
                  <option value="mid">Mid level</option>
                  <option value="senior">Senior</option>
                  <option value="staff">Staff</option>
                  <option value="lead">Lead</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="years_experience">Years of relevant experience</label>
                <input id="years_experience" name="years_experience" type="number" min="0" max="50" />
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>Location and eligibility</h2>
            <p>These answers power hard filters. Scout will show why a role was filtered.</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="preferred_locations">Preferred locations</label>
                <textarea id="preferred_locations" name="preferred_locations" placeholder={"Chicago\nNew York\nUnited States"} />
              </div>
              <div className="field">
                <label>Workplace preferences</label>
                <div className="check-row">
                  <label className="check-label"><input type="checkbox" name="workplace_preferences" value="remote" defaultChecked /> Remote</label>
                  <label className="check-label"><input type="checkbox" name="workplace_preferences" value="hybrid" /> Hybrid</label>
                  <label className="check-label"><input type="checkbox" name="workplace_preferences" value="on-site" /> On-site</label>
                </div>
              </div>
              <div className="field">
                <label htmlFor="work_authorization">Work authorization</label>
                <input id="work_authorization" name="work_authorization" placeholder="Authorized to work in the United States" />
              </div>
              <div className="field">
                <label htmlFor="minimum_salary">Minimum annual compensation</label>
                <input id="minimum_salary" name="minimum_salary" type="number" min="0" step="1000" placeholder="90000" />
              </div>
              <div className="field full">
                <label className="check-label">
                  <input type="checkbox" name="sponsorship_required" />
                  I require current or future employment sponsorship
                </label>
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>Resume and links</h2>
            <p>Paste your resume text now. You can add structured, verified achievement facts after setup.</p>
            <div className="form-grid">
              <div className="field full">
                <label htmlFor="base_resume_text">Base resume text</label>
                <textarea id="base_resume_text" name="base_resume_text" rows={12} required placeholder="Paste the complete text of your current resume." />
              </div>
              <div className="field">
                <label htmlFor="portfolio_url">Portfolio URL</label>
                <input id="portfolio_url" name="portfolio_url" type="url" placeholder="https://" />
              </div>
              <div className="field">
                <label htmlFor="linkedin_url">LinkedIn URL</label>
                <input id="linkedin_url" name="linkedin_url" type="url" placeholder="https://linkedin.com/in/..." />
              </div>
              <div className="field">
                <label htmlFor="github_url">GitHub URL</label>
                <input id="github_url" name="github_url" type="url" placeholder="https://github.com/..." />
              </div>
              <div className="field">
                <label htmlFor="collection_mode">Collection mode</label>
                <select id="collection_mode" name="collection_mode" defaultValue="manual">
                  <option value="manual">Manual only</option>
                  <option value="automatic">Automatic schedule</option>
                </select>
                <small>Automatic mode can be configured for four daily time slots later.</small>
              </div>
            </div>
          </section>

          <div className="form-actions">
            <button className="button" type="submit">Finish setup and open Scout</button>
          </div>
        </form>
        <p className="footer-note">Your resume and profile are stored only in the local SQLite database.</p>
      </div>
    </div>
  );
}
