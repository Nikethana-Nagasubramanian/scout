"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { db, setSetting } from "@/lib/database";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/llm";
import { clearEligibilityOverrides, discoverOfficialBoardForJob, runCollection, scoreAllJobs, syncRunEligibility } from "@/lib/collector";
import { searchContactForJob } from "@/lib/contact-research";
import { createResumeVersion } from "@/lib/resume";
import { ensureResumeBlockIds } from "@/lib/resume-blocks";
import type { ResumeContent } from "@/lib/types";
import { toJsonList } from "@/lib/utils";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) || "").trim();
}

function nullableNumber(formData: FormData, key: string): number | null {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validatedResumeContent(formData: FormData): { id: number; contentJson: string } | null {
  const id = Number(text(formData, "id"));
  const contentJson = String(formData.get("content_json") || "");
  if (!Number.isFinite(id) || !contentJson || contentJson.length > 500_000) return null;
  try {
    const content = JSON.parse(contentJson) as {
      candidateName?: unknown;
      contactLine?: unknown;
      summary?: unknown;
      skills?: unknown;
      sections?: unknown;
    };
    if (
      typeof content.candidateName !== "string" ||
      typeof content.contactLine !== "string" ||
      typeof content.summary !== "string" ||
      !Array.isArray(content.skills) ||
      !Array.isArray(content.sections)
    ) return null;
    return { id, contentJson: JSON.stringify(ensureResumeBlockIds(content as ResumeContent)) };
  } catch {
    return null;
  }
}

function ensurePreparingApplicationForResume(resumeId: number): void {
  const resume = db.prepare("SELECT job_id FROM resume_versions WHERE id = ?").get(resumeId) as { job_id: number } | undefined;
  if (!resume) return;
  db.prepare(`
    INSERT INTO applications (job_id, resume_version_id, status)
    VALUES (?, ?, 'preparing')
    ON CONFLICT(job_id) DO UPDATE SET
      resume_version_id = excluded.resume_version_id,
      status = CASE
        WHEN applications.status IN ('ready_to_apply', 'preparing') THEN 'preparing'
        ELSE applications.status
      END,
      updated_at = CURRENT_TIMESTAMP
  `).run(resume.job_id, resumeId);
}

function persistProfile(formData: FormData): void {
  const resumeText = text(formData, "base_resume_text");
  db.prepare(`
    UPDATE candidate_profile SET
      full_name = ?, email = ?, phone = ?, home_location = ?, professional_summary = ?,
      base_resume_text = ?, target_titles = ?, target_seniority = ?, skills = ?,
      preferred_locations = ?, workplace_preferences = ?, minimum_salary = ?,
      work_authorization = ?, sponsorship_required = ?, years_experience = ?,
      portfolio_url = ?, linkedin_url = ?, github_url = ?, onboarding_complete = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    text(formData, "full_name"),
    text(formData, "email"),
    text(formData, "phone"),
    text(formData, "home_location"),
    text(formData, "professional_summary"),
    resumeText,
    toJsonList(formData.get("target_titles")),
    text(formData, "target_seniority"),
    toJsonList(formData.get("skills")),
    toJsonList(formData.get("preferred_locations")),
    JSON.stringify(formData.getAll("workplace_preferences").map(String)),
    nullableNumber(formData, "minimum_salary"),
    text(formData, "work_authorization"),
    formData.get("sponsorship_required") ? 1 : 0,
    nullableNumber(formData, "years_experience"),
    text(formData, "portfolio_url"),
    text(formData, "linkedin_url"),
    text(formData, "github_url"),
  );

  const factCount = (db.prepare("SELECT COUNT(*) AS count FROM candidate_facts").get() as { count: number }).count;
  if (factCount === 0 && resumeText) {
    const candidates = resumeText
      .split("\n")
      .map((line) => line.replace(/^[•*\-\s]+/, "").trim())
      .filter((line) => line.length >= 35 && !line.includes("@"))
      .slice(0, 30);
    const insert = db.prepare("INSERT INTO candidate_facts (category, context, claim, skills, verified) VALUES ('Experience', 'Imported from base resume', ?, '[]', 1)");
    const seed = db.transaction(() => candidates.forEach((line) => insert.run(line)));
    seed();
  }
}

export async function saveOnboardingAction(formData: FormData): Promise<void> {
  persistProfile(formData);
  setSetting("collection_mode", text(formData, "collection_mode") === "automatic" ? "automatic" : "manual");
  clearEligibilityOverrides();
  scoreAllJobs();
  redirect("/");
}

export async function saveProfileAction(formData: FormData): Promise<void> {
  persistProfile(formData);
  clearEligibilityOverrides();
  scoreAllJobs();
  revalidatePath("/profile");
  revalidatePath("/jobs");
  revalidatePath("/queue");
}

export async function addFactAction(formData: FormData): Promise<void> {
  const claim = text(formData, "claim");
  if (!claim) return;
  const scopeType = text(formData, "scope_type") === "employer" ? "employer" : "career";
  db.prepare("INSERT INTO candidate_facts (category, context, claim, skills, verified, scope_type, scope_key) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    text(formData, "category") || "Experience",
    text(formData, "context"),
    claim,
    toJsonList(formData.get("fact_skills")),
    formData.get("verified") ? 1 : 0,
    scopeType,
    scopeType === "employer" ? text(formData, "scope_key") : "",
  );
  revalidatePath("/profile");
}

export async function deleteFactAction(formData: FormData): Promise<void> {
  db.prepare("DELETE FROM candidate_facts WHERE id = ?").run(Number(text(formData, "id")));
  revalidatePath("/profile");
}

export async function addSourceAction(formData: FormData): Promise<void> {
  const name = text(formData, "name");
  const identifier = text(formData, "identifier").replace(/^https?:\/\/[^/]+\//, "").split(/[/?#]/)[0];
  const sourceType = text(formData, "source_type");
  if (!name || !identifier || !["greenhouse", "lever", "ashby"].includes(sourceType)) return;
  db.prepare("INSERT OR IGNORE INTO job_sources (name, source_type, identifier) VALUES (?, ?, ?)").run(
    name,
    sourceType,
    identifier,
  );
  revalidatePath("/sources");
}

export async function addCompanyDiscoverySourceAction(formData: FormData): Promise<void> {
  const name = text(formData, "name");
  const value = text(formData, "url");
  const includeCompanies = text(formData, "include_companies");
  const excludeCompanies = text(formData, "exclude_companies");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (!name || !["http:", "https:"].includes(url.protocol)) return;
  db.prepare(`
    INSERT INTO company_discovery_sources (name, url, include_companies, exclude_companies)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      name = excluded.name,
      include_companies = excluded.include_companies,
      exclude_companies = excluded.exclude_companies,
      enabled = 1
  `).run(name, url.toString(), includeCompanies, excludeCompanies);
  revalidatePath("/sources");
}

export async function toggleCompanyDiscoverySourceAction(formData: FormData): Promise<void> {
  db.prepare(`
    UPDATE company_discovery_sources
    SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END
    WHERE id = ?
  `).run(Number(text(formData, "id")));
  revalidatePath("/sources");
}

export async function deleteCompanyDiscoverySourceAction(formData: FormData): Promise<void> {
  db.prepare("DELETE FROM company_discovery_sources WHERE id = ?").run(Number(text(formData, "id")));
  revalidatePath("/sources");
}

export async function toggleSourceAction(formData: FormData): Promise<void> {
  db.prepare("UPDATE job_sources SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END WHERE id = ?").run(
    Number(text(formData, "id")),
  );
  revalidatePath("/sources");
}

export async function deleteSourceAction(formData: FormData): Promise<void> {
  db.prepare("DELETE FROM job_sources WHERE id = ?").run(Number(text(formData, "id")));
  revalidatePath("/sources");
}

export async function runWorkflowAction(formData: FormData): Promise<void> {
  const startedAt = Date.now();
  const slot = text(formData, "slot") || "manual";
  const result = await runCollection(slot);
  const remainingPreviewTime = 10_400 - (Date.now() - startedAt);
  if (remainingPreviewTime > 0) await new Promise((resolve) => setTimeout(resolve, remainingPreviewTime));
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath("/queue");
  revalidatePath("/sources");
  revalidatePath("/diagnostics");
  redirect(`/jobs?run=${result.runId}`);
}

export async function addManualJobAction(formData: FormData): Promise<void> {
  const company = text(formData, "company");
  const title = text(formData, "title");
  const description = text(formData, "description");
  const url = text(formData, "url");
  if (!company || !title || !url) return;
  const externalId = createHash("sha256").update(`${company}|${title}|${url || description.slice(0, 100)}`).digest("hex").slice(0, 20);
  const existing = url
    ? db.prepare("SELECT id FROM jobs WHERE source_type = 'manual' AND canonical_url = ?").get(url) as { id: number } | undefined
    : db.prepare("SELECT id FROM jobs WHERE source_type = 'manual' AND external_id = ?").get(externalId) as { id: number } | undefined;
  let jobId = existing?.id;
  if (jobId) {
    db.prepare(`
      UPDATE jobs SET
        company = ?, title = ?, location = ?, workplace_type = ?, employment_type = ?,
        description = ?, canonical_url = ?, apply_url = ?, last_seen_at = CURRENT_TIMESTAMP,
        seen_count = seen_count + 1
      WHERE id = ?
    `).run(
      company,
      title,
      text(formData, "location"),
      text(formData, "workplace_type") || "unspecified",
      text(formData, "employment_type"),
      description,
      url,
      url,
      jobId,
    );
  } else {
    const result = db.prepare(`
      INSERT INTO jobs (
        source_id, source_name, source_type, external_id, company, title, location,
        workplace_type, employment_type, description, canonical_url, apply_url
      ) VALUES (NULL, 'Manual import', 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      externalId,
      company,
      title,
      text(formData, "location"),
      text(formData, "workplace_type") || "unspecified",
      text(formData, "employment_type"),
      description,
      url,
      url,
    );
    jobId = Number(result.lastInsertRowid);
  }
  scoreAllJobs();
  await discoverOfficialBoardForJob(jobId);
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/sources");
  redirect(`/jobs/${jobId}?imported=1`);
}

export async function updateJobStatusAction(formData: FormData): Promise<void> {
  const allowed = ["discovered", "reviewing", "shortlisted", "irrelevant", "dismissed", "archived"];
  const status = text(formData, "status");
  if (!allowed.includes(status)) return;
  const id = Number(text(formData, "id"));
  db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/queue");
}

export async function restoreJobEligibilityAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, "id"));
  if (!Number.isFinite(id)) return;
  const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(id) as { status: string } | undefined;
  if (!job) return;
  const hasResume = (db.prepare("SELECT COUNT(*) AS count FROM resume_versions WHERE job_id = ?").get(id) as { count: number }).count > 0;
  const nextStatus = ["irrelevant", "dismissed"].includes(job.status) ? (hasResume ? "shortlisted" : "discovered") : job.status;
  db.prepare("UPDATE jobs SET eligibility_status = 'eligible', eligibility_override = 1, status = ? WHERE id = ?").run(nextStatus, id);
  syncRunEligibility();
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${id}`);
}

export async function approveJobAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, "id"));
  if (!Number.isFinite(id)) return;
  db.prepare("UPDATE jobs SET status = 'shortlisted' WHERE id = ?").run(id);
  const latestResume = db.prepare(`
    SELECT id, status
    FROM resume_versions
    WHERE job_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(id) as { id: number; status: string } | undefined;
  if (!latestResume || latestResume.status === "rejected") await createResumeVersion(id);
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath("/queue");
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}?tab=resume`);
}

export async function generateResumeAction(formData: FormData): Promise<void> {
  const jobId = Number(text(formData, "job_id"));
  await createResumeVersion(jobId);
  revalidatePath("/queue");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?tab=resume`);
}

export async function updateResumeStatusAction(formData: FormData): Promise<void> {
  const status = text(formData, "status");
  if (!["approved", "rejected", "draft"].includes(status)) return;
  const id = Number(text(formData, "id"));
  if (!Number.isFinite(id)) return;
  db.prepare("UPDATE resume_versions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    status,
    id,
  );
  if (status === "approved") ensurePreparingApplicationForResume(id);
  revalidatePath("/queue");
  revalidatePath("/applications");
  revalidatePath(`/resumes/${id}`);
  redirect(status === "rejected" ? "/queue#rejected-resumes" : "/queue");
}

export async function saveResumeContentAction(formData: FormData): Promise<void> {
  const resume = validatedResumeContent(formData);
  if (!resume) return;
  db.prepare("UPDATE resume_versions SET content_json = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    resume.contentJson,
    resume.id,
  );
  revalidatePath(`/resumes/${resume.id}`);
  revalidatePath("/queue");
  const row = db.prepare("SELECT job_id FROM resume_versions WHERE id = ?").get(resume.id) as { job_id: number } | undefined;
  redirect(row ? `/jobs/${row.job_id}?tab=resume` : `/resumes/${resume.id}`);
}

export async function saveAndApproveResumeAction(formData: FormData): Promise<void> {
  const resume = validatedResumeContent(formData);
  if (!resume) return;
  db.prepare("UPDATE resume_versions SET content_json = ?, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    resume.contentJson,
    resume.id,
  );
  ensurePreparingApplicationForResume(resume.id);
  revalidatePath(`/resumes/${resume.id}`);
  revalidatePath("/queue");
  revalidatePath("/applications");
  revalidatePath("/jobs");
  const row = db.prepare("SELECT job_id FROM resume_versions WHERE id = ?").get(resume.id) as { job_id: number } | undefined;
  redirect(row ? `/jobs/${row.job_id}?tab=cover-letter` : "/queue");
}

export async function approveCoverLetterAndQueueAction(formData: FormData): Promise<void> {
  const applicationId = Number(text(formData, "application_id"));
  const content = text(formData, "cover_letter_content")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-");
  if (!Number.isFinite(applicationId) || content.length < 80 || content.length > 6_000) return;
  const application = db.prepare(`
    SELECT applications.id, applications.job_id, jobs.title AS job_title, jobs.company AS job_company
    FROM applications
    JOIN resume_versions ON resume_versions.id = applications.resume_version_id
    JOIN jobs ON jobs.id = applications.job_id
    WHERE applications.id = ? AND resume_versions.status = 'approved'
  `).get(applicationId) as { id: number; job_id: number; job_title: string; job_company: string } | undefined;
  if (!application) return;
  db.prepare(`
    INSERT INTO cover_letters (application_id, content, generation_method, evidence_json, status)
    VALUES (?, ?, 'Written manually', '{}', 'approved')
    ON CONFLICT(application_id) DO UPDATE SET
      content = excluded.content,
      status = 'approved',
      updated_at = CURRENT_TIMESTAMP
  `).run(applicationId, content);
  db.prepare("UPDATE applications SET status = 'ready_to_apply', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(applicationId);
  db.prepare("INSERT INTO application_events (application_id, status, note) VALUES (?, 'ready_to_apply', 'Cover letter approved and application queued.')").run(applicationId);
  revalidatePath(`/jobs/${application.job_id}`);
  revalidatePath("/queue");
  revalidatePath("/applications");
  revalidatePath("/");
  const params = new URLSearchParams({
    queued: "1",
    company: application.job_company,
    title: application.job_title,
  });
  redirect(`/jobs?${params.toString()}`);
}

export async function createApplicationAction(formData: FormData): Promise<void> {
  const jobId = Number(text(formData, "job_id"));
  const resumeId = nullableNumber(formData, "resume_id");
  if (!Number.isFinite(jobId)) return;
  db.prepare(`
    INSERT INTO applications (
      job_id, resume_version_id, status, applied_at, follow_up_at
    ) VALUES (?, ?, 'applied', CURRENT_TIMESTAMP, datetime('now', '+7 days'))
    ON CONFLICT(job_id) DO UPDATE SET
      resume_version_id = excluded.resume_version_id,
      status = 'applied',
      applied_at = COALESCE(applications.applied_at, CURRENT_TIMESTAMP),
      follow_up_at = COALESCE(applications.follow_up_at, datetime('now', '+7 days')),
      updated_at = CURRENT_TIMESTAMP
  `).run(jobId, resumeId);
  const application = db.prepare("SELECT id FROM applications WHERE job_id = ?").get(jobId) as { id: number };
  db.prepare("INSERT INTO application_events (application_id, status, note) VALUES (?, 'applied', 'Marked applied from the job workflow.')").run(application.id);
  revalidatePath("/applications");
  revalidatePath("/");
  revalidatePath("/queue");
  revalidatePath(`/jobs/${jobId}`);
  if (resumeId) revalidatePath(`/resumes/${resumeId}`);
  redirect("/applications");
}

export async function quickUpdateApplicationAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, "id"));
  const status = text(formData, "status");
  const allowed = ["applied", "follow_up_due", "recruiter_screen", "interview", "rejected", "withdrawn", "offer", "archived"];
  if (!allowed.includes(status)) return;
  if (status === "applied") {
    db.prepare(`
      UPDATE applications SET
        status = 'applied',
        applied_at = COALESCE(applied_at, CURRENT_TIMESTAMP),
        follow_up_at = COALESCE(follow_up_at, datetime('now', '+7 days')),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);
  } else if (["rejected", "withdrawn", "offer", "archived"].includes(status)) {
    db.prepare("UPDATE applications SET status = ?, follow_up_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
  } else {
    db.prepare("UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
  }
  db.prepare("INSERT INTO application_events (application_id, status, note) VALUES (?, ?, 'Quick status update')").run(id, status);
  revalidatePath("/applications");
  revalidatePath("/");
}

export async function updateApplicationAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, "id"));
  const status = text(formData, "status");
  const allowed = [
    "ready_to_apply", "applied", "follow_up_due", "recruiter_screen", "interview",
    "needs_review", "blocked", "expired", "ineligible", "rejected", "withdrawn", "offer", "archived",
  ];
  if (!allowed.includes(status)) return;
  const existing = db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as {
    applied_at: string | null;
    follow_up_at: string | null;
    contact_name: string;
    contact_details: string;
    notes: string;
  } | undefined;
  if (!existing) return;
  const appliedAt = formData.has("applied_at") ? text(formData, "applied_at") || null : existing.applied_at;
  const followUpAt = formData.has("follow_up_at") ? text(formData, "follow_up_at") || null : existing.follow_up_at;
  const contactName = formData.has("contact_name") ? text(formData, "contact_name") : existing.contact_name;
  const contactDetails = formData.has("contact_details") ? text(formData, "contact_details") : existing.contact_details;
  const notes = formData.has("notes") ? text(formData, "notes") : existing.notes;
  db.prepare(`
    UPDATE applications SET status = ?, applied_at = ?, follow_up_at = ?, contact_name = ?,
      contact_details = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(
    status,
    appliedAt,
    followUpAt,
    contactName,
    contactDetails,
    notes,
    id,
  );
  db.prepare("INSERT INTO application_events (application_id, status, note) VALUES (?, ?, ?)").run(
    id,
    status,
    notes,
  );
  revalidatePath("/applications");
  revalidatePath("/");
}

export async function searchContactsAction(formData: FormData): Promise<void> {
  const jobId = Number(text(formData, "job_id"));
  if (!Number.isFinite(jobId) || jobId <= 0) return;
  await searchContactForJob(jobId);
  revalidatePath("/applications");
  revalidatePath("/contacts");
  revalidatePath("/applications");
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const mode = text(formData, "collection_mode") === "automatic" ? "automatic" : "manual";
  setSetting("collection_mode", mode);
  for (const slot of ["morning", "afternoon", "evening", "night"]) {
    setSetting(`${slot}_enabled`, formData.get(`${slot}_enabled`) ? "1" : "0");
    setSetting(`${slot}_time`, text(formData, `${slot}_time`));
  }
  setSetting("minimum_queue_score", String(nullableNumber(formData, "minimum_queue_score") || 65));
  const minimumExperience = Math.max(0, nullableNumber(formData, "search_experience_min") ?? 2);
  const maximumExperience = Math.max(minimumExperience, nullableNumber(formData, "search_experience_max") ?? 5);
  setSetting("search_usa_only", formData.get("search_usa_only") ? "1" : "0");
  setSetting("search_experience_min", String(minimumExperience));
  setSetting("search_experience_max", String(maximumExperience));
  setSetting("search_max_age_days", String(Math.max(1, nullableNumber(formData, "search_max_age_days") ?? 60)));
  setSetting("local_ai_enabled", formData.get("local_ai_enabled") ? "1" : "0");
  setSetting("ollama_model", text(formData, "ollama_model") || "gemma3:4b");
  const provider = text(formData, "ai_provider");
  setSetting("ai_provider", provider === "anthropic" ? "anthropic" : "ollama");
  setSetting("anthropic_model", text(formData, "anthropic_model") || DEFAULT_ANTHROPIC_MODEL);
  clearEligibilityOverrides();
  scoreAllJobs();
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath("/queue");
}
