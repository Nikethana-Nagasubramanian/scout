import { db } from "@/lib/database";
import { generatePdf } from "@/lib/resume";
import { resumePdfFilename } from "@/lib/resume-filename";
import { resumeSkillCategories } from "@/lib/resume-skills";
import type { ResumeContent } from "@/lib/types";
import { safeJson } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = db.prepare(`
    SELECT resume_versions.content_json, jobs.description, jobs.company
    FROM resume_versions
    JOIN jobs ON jobs.id = resume_versions.job_id
    WHERE resume_versions.id = ?
  `).get(Number(id)) as { content_json: string; description: string; company: string } | undefined;
  if (!row) return new Response("Resume not found", { status: 404 });
  const parsedContent = safeJson<ResumeContent>(row.content_json, { candidateName: "Candidate", contactLine: "", targetTitle: "", summary: "", skills: [], facts: [], audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] } });
  const content = { ...parsedContent, skillCategories: resumeSkillCategories(parsedContent, row.description) };
  const buffer = await generatePdf(content);
  const filename = resumePdfFilename(row.company);
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const disposition = preview ? "inline" : "attachment";
  return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename="${filename}"` } });
}
