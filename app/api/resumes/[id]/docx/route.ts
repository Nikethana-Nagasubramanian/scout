import { db } from "@/lib/database";
import { generateDocx } from "@/lib/resume";
import { resumeSkillCategories } from "@/lib/resume-skills";
import type { ResumeContent } from "@/lib/types";
import { safeJson } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = db.prepare(`
    SELECT resume_versions.content_json, jobs.description
    FROM resume_versions
    JOIN jobs ON jobs.id = resume_versions.job_id
    WHERE resume_versions.id = ?
  `).get(Number(id)) as { content_json: string; description: string } | undefined;
  if (!row) return new Response("Resume not found", { status: 404 });
  const parsedContent = safeJson<ResumeContent>(row.content_json, { candidateName: "Candidate", contactLine: "", targetTitle: "", summary: "", skills: [], facts: [], audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] } });
  const content = { ...parsedContent, skillCategories: resumeSkillCategories(parsedContent, row.description) };
  const buffer = await generateDocx(content);
  const filename = `${content.candidateName || "candidate"}-resume.docx`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
  return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${filename}"` } });
}
