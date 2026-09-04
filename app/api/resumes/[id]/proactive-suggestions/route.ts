import { db } from "@/lib/database";
import { activeModel } from "@/lib/llm";
import { deterministicResumeSuggestion, suggestResumeBulletWithOllama, type ResumeBulletSuggestion } from "@/lib/local-ai";
import { ensureResumeBlockIds } from "@/lib/resume-blocks";
import { planProactiveResumeSuggestions } from "@/lib/resume-suggestions";
import type { CandidateFact, Job, ResumeContent } from "@/lib/types";
import { safeJson } from "@/lib/utils";

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

  let body: { content?: ResumeContent } = {};
  try {
    body = await request.json() as { content?: ResumeContent };
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const content = ensureResumeBlockIds(body.content || safeJson<ResumeContent>(row.content_json, fallbackContent));
  const facts = db.prepare("SELECT * FROM candidate_facts WHERE verified = 1 ORDER BY created_at DESC")
    .all() as CandidateFact[];
  const plans = planProactiveResumeSuggestions(content, row, facts, 3);
  if (!plans.length) return Response.json({ content, suggestions: [] });

  const suggestions: ResumeBulletSuggestion[] = [];
  const failures: string[] = [];
  // Ollama serves these concurrently against one loaded model, so asking for the suggestions
  // together costs about as much as the slowest one instead of the sum of all three.
  const settled = await Promise.all(plans.map(async (plan) => {
    try {
      const suggestion = await suggestResumeBulletWithOllama(
        content,
        row,
        plan.keyword,
        activeModel(),
        plan.target,
        plan.evidence,
      );
      return { plan, suggestion, error: null as string | null };
    } catch (error) {
      return { plan, suggestion: null, error: error instanceof Error ? error.message : "A suggestion could not be generated" };
    }
  }));
  for (const { plan, suggestion, error } of settled) {
    if (suggestion) {
      if (suggestion.supported) suggestions.push({
        ...suggestion,
        blockId: plan.blockId,
        evidenceFactIds: plan.evidenceFactIds,
      });
      continue;
    }
    const fallback = deterministicResumeSuggestion(content, plan.keyword, plan.target, plan.evidence);
    if (fallback) {
      suggestions.push({ ...fallback, blockId: plan.blockId, evidenceFactIds: plan.evidenceFactIds });
    } else if (error) {
      failures.push(error);
    }
  }
  return Response.json({ content, suggestions, failures });
}
