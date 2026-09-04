import { enrichCoverLetterJob, generateCoverLetterDraft } from "@/lib/cover-letter";
import { db, getSetting } from "@/lib/database";
import { buildResumeContent } from "@/lib/resume";
import type { CandidateFact, CandidateProfile, Job, ResumeContent } from "@/lib/types";
import { safeJson } from "@/lib/utils";

export const runtime = "nodejs";

interface ApplicationJobRow extends Job {
  application_id: number;
  resume_content: string | null;
}

function applicationContext(id: number): {
  application: ApplicationJobRow;
  content: ResumeContent;
} | null {
  const application = db.prepare(`
    SELECT jobs.*, applications.id AS application_id,
      COALESCE(
        linked_resume.content_json,
        (
          SELECT latest_resume.content_json
          FROM resume_versions AS latest_resume
          WHERE latest_resume.job_id = jobs.id
          ORDER BY latest_resume.created_at DESC, latest_resume.id DESC
          LIMIT 1
        )
      ) AS resume_content
    FROM applications
    JOIN jobs ON jobs.id = applications.job_id
    LEFT JOIN resume_versions AS linked_resume ON linked_resume.id = applications.resume_version_id
    WHERE applications.id = ?
  `).get(id) as ApplicationJobRow | undefined;
  if (!application) return null;
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const facts = db.prepare("SELECT * FROM candidate_facts WHERE verified = 1 ORDER BY created_at DESC").all() as CandidateFact[];
  const content = application.resume_content
    ? safeJson<ResumeContent>(application.resume_content, buildResumeContent(application, profile, facts))
    : buildResumeContent(application, profile, facts);
  return { application, content };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return Response.json({ error: "Invalid application" }, { status: 400 });
  const resolved = applicationContext(numericId);
  if (!resolved) return Response.json({ error: "Application not found" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { candidateNote?: unknown; provider?: unknown };
  const candidateNote = typeof body.candidateNote === "string" ? body.candidateNote.trim().slice(0, 800) : "";
  // A manual retry pins one provider for this request only, without changing the setting.
  const providerOverride = body.provider === "ollama" || body.provider === "anthropic" ? body.provider : undefined;
  const enrichedJob = await enrichCoverLetterJob(resolved.application);
  const draft = await generateCoverLetterDraft(
    enrichedJob,
    resolved.content,
    getSetting("local_ai_enabled", "0") === "1",
    candidateNote,
    providerOverride,
  );
  db.prepare(`
    INSERT INTO cover_letters (application_id, content, generation_method, evidence_json, candidate_note, status)
    VALUES (?, ?, ?, ?, ?, 'draft')
    ON CONFLICT(application_id) DO UPDATE SET
      content = excluded.content,
      generation_method = excluded.generation_method,
      evidence_json = excluded.evidence_json,
      candidate_note = excluded.candidate_note,
      status = 'draft',
      updated_at = CURRENT_TIMESTAMP
  `).run(numericId, draft.content, draft.method, JSON.stringify(draft.evidence), candidateNote);
  db.prepare(`
    UPDATE applications
    SET status = CASE WHEN status = 'ready_to_apply' THEN 'preparing' ELSE status END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(numericId);
  const coverLetter = db.prepare("SELECT * FROM cover_letters WHERE application_id = ?").get(numericId);
  return Response.json({ coverLetter });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return Response.json({ error: "Invalid application" }, { status: 400 });
  const application = db.prepare("SELECT id FROM applications WHERE id = ?").get(numericId);
  if (!application) return Response.json({ error: "Application not found" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { content?: unknown };
  const content = typeof body.content === "string"
    ? body.content.replace(/\u2014/g, "-").replace(/\u2013/g, "-").trim()
    : "";
  if (content.length < 80 || content.length > 6_000) {
    return Response.json({ error: "Cover letter must contain between 80 and 6,000 characters" }, { status: 400 });
  }
  db.prepare(`
    INSERT INTO cover_letters (application_id, content, generation_method, evidence_json, status)
    VALUES (?, ?, 'Written manually', '{}', 'edited')
    ON CONFLICT(application_id) DO UPDATE SET
      content = excluded.content,
      generation_method = CASE
        WHEN cover_letters.generation_method = '' THEN 'Written manually'
        ELSE cover_letters.generation_method || ', edited manually'
      END,
      status = 'edited',
      updated_at = CURRENT_TIMESTAMP
  `).run(numericId, content);
  db.prepare(`
    UPDATE applications
    SET status = CASE WHEN status = 'ready_to_apply' THEN 'preparing' ELSE status END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(numericId);
  const coverLetter = db.prepare("SELECT * FROM cover_letters WHERE application_id = ?").get(numericId);
  return Response.json({ coverLetter });
}
