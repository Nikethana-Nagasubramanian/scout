import { db, getSetting } from "@/lib/database";
import { suggestResumeBulletWithOllama, type ResumeRewriteTarget } from "@/lib/local-ai";
import type { Job, ResumeContent } from "@/lib/types";
import { normalizeText, safeJson } from "@/lib/utils";

export const runtime = "nodejs";

const fallbackContent: ResumeContent = {
  candidateName: "",
  contactLine: "",
  targetTitle: "",
  summary: "",
  skills: [],
  facts: [],
  sections: [],
  audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] },
};

function isResumeContent(value: unknown): value is ResumeContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Partial<ResumeContent>;
  return typeof content.candidateName === "string"
    && typeof content.summary === "string"
    && Array.isArray(content.skills)
    && Array.isArray(content.sections)
    && content.sections.every((section) => (
      typeof section?.title === "string"
      && Array.isArray(section.lines)
      && section.lines.every((line) => typeof line?.text === "string" && typeof line?.kind === "string")
    ))
    && Boolean(content.audit);
}

function resumeIdFrom(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const resumeId = resumeIdFrom(id);
  if (!resumeId) return Response.json({ error: "Invalid resume" }, { status: 400 });

  const row = db.prepare(`
    SELECT resume_versions.content_json, jobs.*
    FROM resume_versions
    INNER JOIN jobs ON jobs.id = resume_versions.job_id
    WHERE resume_versions.id = ?
  `).get(resumeId) as ({ content_json: string } & Job) | undefined;
  if (!row) return Response.json({ error: "Resume not found" }, { status: 404 });

  let body: { keyword?: unknown; content?: unknown; target?: unknown; userEvidence?: unknown };
  try {
    body = await request.json() as { keyword?: unknown; content?: unknown; target?: unknown; userEvidence?: unknown };
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const keyword = typeof body.keyword === "string" ? body.keyword.replace(/\s+/g, " ").trim() : "";
  if (!keyword || keyword.length > 80) return Response.json({ error: "Enter a valid keyword" }, { status: 400 });
  if (!normalizeText(row.description).includes(normalizeText(keyword))) {
    return Response.json({ error: "That keyword is not present in the job description" }, { status: 400 });
  }

  const storedContent = safeJson<ResumeContent>(row.content_json, fallbackContent);
  const content = isResumeContent(body.content) ? body.content : storedContent;
  const candidateTarget = body.target as Partial<ResumeRewriteTarget> | undefined;
  const target: ResumeRewriteTarget = candidateTarget?.kind === "summary"
    ? { kind: "summary" }
    : candidateTarget?.kind === "experience"
      && Number.isInteger(candidateTarget.sectionIndex)
      && Number.isInteger(candidateTarget.entryLineIndex)
      ? {
          kind: "experience",
          sectionIndex: Number(candidateTarget.sectionIndex),
          entryLineIndex: Number(candidateTarget.entryLineIndex),
        }
      : { kind: "experience", sectionIndex: -1, entryLineIndex: -1 };
  const userEvidence = typeof body.userEvidence === "string"
    ? body.userEvidence.replace(/\s+/g, " ").trim().slice(0, 600)
    : "";
  try {
    const suggestion = await suggestResumeBulletWithOllama(
      content,
      row,
      keyword,
      getSetting("ollama_model", "llama3.2:3b"),
      target,
      userEvidence,
    );
    return Response.json({ suggestion });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const message = timedOut
      ? "Local AI did not finish within 90 seconds. Try a smaller Ollama model in Automation settings."
      : error instanceof Error
        ? error.message
        : "The bullet suggestion could not be generated";
    return Response.json({ error: message }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const resumeId = resumeIdFrom(id);
  if (!resumeId) return Response.json({ error: "Invalid resume" }, { status: 400 });
  const exists = db.prepare("SELECT id FROM resume_versions WHERE id = ?").get(resumeId);
  if (!exists) return Response.json({ error: "Resume not found" }, { status: 404 });

  let body: { content?: unknown };
  try {
    body = await request.json() as { content?: unknown };
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!isResumeContent(body.content)) return Response.json({ error: "Invalid resume content" }, { status: 400 });
  db.prepare(
    "UPDATE resume_versions SET content_json = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(JSON.stringify(body.content), resumeId);
  return Response.json({ content: body.content });
}
