import { db } from "@/lib/database";
import { addResumeKeyword } from "@/lib/resume-keywords";
import type { ResumeContent } from "@/lib/types";
import { safeJson } from "@/lib/utils";

export const runtime = "nodejs";

function isResumeContent(value: unknown): value is ResumeContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Partial<ResumeContent>;
  return (
    typeof content.candidateName === "string" &&
    typeof content.contactLine === "string" &&
    typeof content.targetTitle === "string" &&
    typeof content.summary === "string" &&
    Array.isArray(content.skills) &&
    content.skills.every((skill) => typeof skill === "string") &&
    Array.isArray(content.facts) &&
    Boolean(content.audit) &&
    Array.isArray(content.audit?.includedKeywords) &&
    Array.isArray(content.audit?.unsupportedKeywords)
  );
}

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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const resumeId = Number(id);
  if (!Number.isInteger(resumeId) || resumeId < 1) {
    return Response.json({ error: "Invalid resume" }, { status: 400 });
  }

  const row = db.prepare("SELECT content_json FROM resume_versions WHERE id = ?").get(resumeId) as
    | { content_json: string }
    | undefined;
  if (!row) return Response.json({ error: "Resume not found" }, { status: 404 });

  let body: { keyword?: unknown; content?: unknown };
  try {
    body = await request.json() as { keyword?: unknown; content?: unknown };
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const keyword = typeof body.keyword === "string" ? body.keyword.replace(/\s+/g, " ").trim() : "";
  if (!keyword || keyword.length > 80) {
    return Response.json({ error: "Enter a valid keyword" }, { status: 400 });
  }

  const storedContent = safeJson<ResumeContent>(row.content_json, fallbackContent);
  const sourceContent = isResumeContent(body.content) ? body.content : storedContent;
  const content = addResumeKeyword(sourceContent, keyword);
  db.prepare(
    "UPDATE resume_versions SET content_json = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(JSON.stringify(content), resumeId);

  return Response.json({ content });
}
