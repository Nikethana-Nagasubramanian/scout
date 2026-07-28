import type { Job, ResumeContent } from "@/lib/types";
import { normalizeSkillKey } from "@/lib/resume-skills";

interface OllamaResponse {
  response?: string;
}

interface ResumeRanking {
  skillOrder?: unknown;
}

function parseRanking(value: string): ResumeRanking {
  const cleaned = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/"sectionLineOrder\s*:/g, "\"sectionLineOrder\":")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
  return JSON.parse(cleaned) as ResumeRanking;
}

function exactSkillOrder(value: unknown, skills: string[]): string[] {
  if (!Array.isArray(value)) return skills;
  const requested = value
    .map(String)
    .map((item) => skills.find((skill) => skill.toLowerCase() === item.toLowerCase()))
    .filter((item): item is string => Boolean(item));
  return [...new Set([...requested, ...skills])];
}

export function applyResumeRanking(content: ResumeContent, ranking: ResumeRanking): ResumeContent {
  const skills = exactSkillOrder(ranking.skillOrder, content.skills);
  const skillOrder = new Map(skills.map((skill, index) => [normalizeSkillKey(skill), index]));
  return {
    ...content,
    skills,
    skillCategories: content.skillCategories?.map((category) => ({
      ...category,
      skills: [...category.skills].sort(
        (left, right) => (skillOrder.get(normalizeSkillKey(left)) ?? Number.MAX_SAFE_INTEGER)
          - (skillOrder.get(normalizeSkillKey(right)) ?? Number.MAX_SAFE_INTEGER),
      ),
    })),
    sections: content.sections,
  };
}

export async function prioritizeResumeWithOllama(
  content: ResumeContent,
  job: Job,
  model: string,
): Promise<ResumeContent> {
  const prompt = [
    "You rank existing candidate skills for an ATS-safe resume.",
    "Return JSON only with skillOrder.",
    "skillOrder must contain only exact strings from candidateSkills.",
    "Do not write, edit, paraphrase, reorder, or invent any resume experience.",
    JSON.stringify({
      jobTitle: job.title,
      jobDescription: job.description.slice(0, 18_000),
      candidateSkills: content.skills,
    }),
  ].join("\n");

  const response = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: {
        type: "object",
        properties: {
          skillOrder: { type: "array", items: { type: "string" } },
        },
        required: ["skillOrder"],
      },
      keep_alive: "10m",
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const payload = await response.json() as OllamaResponse;
  const ranking = parseRanking(payload.response || "{}");
  return applyResumeRanking(content, ranking);
}
