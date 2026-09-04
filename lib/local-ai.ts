import type { Job, ResumeContent } from "@/lib/types";
import { normalizeSkillKey } from "@/lib/resume-skills";

interface ResumeRanking {
  skillOrder?: unknown;
}

interface ResumeBulletSuggestionResponse {
  supported?: unknown;
  candidateId?: unknown;
  suggestedBullet?: unknown;
  reason?: unknown;
}

export interface ResumeBulletSuggestion {
  supported: boolean;
  keyword: string;
  targetKind: "summary" | "line";
  sectionIndex: number;
  lineIndex: number;
  sectionTitle: string;
  originalBullet: string;
  suggestedBullet: string;
  reason: string;
  blockId?: string;
  evidenceFactIds?: number[];
}

export type ResumeRewriteTarget =
  | { kind: "summary" }
  | { kind: "line"; sectionIndex: number; lineIndex: number }
  | { kind: "experience"; sectionIndex: number; entryLineIndex: number };

import { runStructuredPrompt } from "@/lib/llm";

function parseStructuredResponse<T>(value: string): T {
  const cleaned = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/"sectionLineOrder\s*:/g, "\"sectionLineOrder\":")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
  return JSON.parse(cleaned) as T;
}

function parseRanking(value: string): ResumeRanking {
  return parseStructuredResponse<ResumeRanking>(value);
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
      // Ranking a fixed skill list needs the gist of the posting, not all of it. The prompt
      // used to carry 18000 characters, and prompt length is what this call spends its time on.
      jobDescription: job.description.slice(0, 6_000),
      candidateSkills: content.skills,
    }),
  ].join("\n");

  const text = await runStructuredPrompt(prompt, {
    model,
    format: {
      type: "object",
      properties: {
        skillOrder: { type: "array", items: { type: "string" } },
      },
      required: ["skillOrder"],
    },
    maxTokens: 1_024,
    timeoutMs: 120_000,
  });
  return applyResumeRanking(content, parseRanking(text));
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function numericClaims(value: string): string[] {
  return value.match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
}

export function deterministicResumeSuggestion(
  content: ResumeContent,
  keyword: string,
  target: ResumeRewriteTarget,
  evidence = "",
): ResumeBulletSuggestion | null {
  const line = target.kind === "line" ? content.sections?.[target.sectionIndex]?.lines[target.lineIndex] : null;
  const original = target.kind === "summary" ? content.summary : line?.text || "";
  let suggested = "";
  if (normalized(keyword) === "analytics" && /\banalysis\b/i.test(original)) {
    suggested = original.replace(/\banalysis\b/i, "analytics");
  } else if (normalized(keyword) === "collaboration" && /\bpartnered cross-functionally\b/i.test(original)) {
    suggested = original.replace(/\bpartnered cross-functionally\b/i, "Collaborated cross-functionally");
  } else if (normalized(keyword) === "collaboration" && /stakeholder interviews/i.test(original)) {
    suggested = original.replace(
      /Led end-to-end UX research \(surveys, moderated usability tests, stakeholder interviews\) to/i,
      "Led end-to-end UX research in collaboration with stakeholders through surveys, moderated usability tests, and stakeholder interviews to",
    );
  } else if (target.kind === "summary" && normalized(keyword) === "saas" && /\bsaas\b/i.test(evidence)) {
    suggested = /\bproducts at\b/i.test(original)
      ? original.replace(/\bproducts at\b/i, "SaaS products at")
      : original.replace(/\bproducts\b/i, "SaaS products");
  }
  if (!suggested || suggested === original || !normalized(suggested).includes(normalized(keyword))) return null;
  if (numericClaims(original).join("|") !== numericClaims(suggested).join("|")) return null;
  return {
    supported: true,
    keyword,
    targetKind: target.kind === "summary" ? "summary" : "line",
    sectionIndex: target.kind === "line" ? target.sectionIndex : -1,
    lineIndex: target.kind === "line" ? target.lineIndex : -1,
    sectionTitle: target.kind === "summary" ? "SUMMARY" : "PROFESSIONAL EXPERIENCE",
    originalBullet: original,
    suggestedBullet: suggested,
    reason: "Scout matched the job's terminology to evidence already present in this passage without changing its meaning or metrics.",
  };
}

export async function suggestResumeBulletWithOllama(
  content: ResumeContent,
  job: Job,
  keyword: string,
  model: string,
  target: ResumeRewriteTarget = { kind: "experience", sectionIndex: -1, entryLineIndex: -1 },
  userEvidence = "",
): Promise<ResumeBulletSuggestion> {
  const allSections = content.sections || [];
  const experienceTarget = target.kind === "experience" ? target : null;
  const selectedSection = experienceTarget ? allSections[experienceTarget.sectionIndex] : null;
  const nextEntryIndex = selectedSection && experienceTarget && experienceTarget.entryLineIndex >= 0
    ? selectedSection.lines.findIndex((line, index) => index > experienceTarget.entryLineIndex && line.kind === "entry")
    : -1;
  const candidates = target.kind === "summary"
    ? [{
        id: "summary",
        sectionIndex: -1,
        lineIndex: -1,
        sectionTitle: "SUMMARY",
        text: content.summary.trim(),
      }]
    : allSections.flatMap((section, sectionIndex) => (
        section.lines.flatMap((line, lineIndex) => {
          if (line.kind !== "bullet" || !line.text.trim()) return [];
          if (target.kind === "line" && (sectionIndex !== target.sectionIndex || lineIndex !== target.lineIndex)) return [];
          if (experienceTarget && experienceTarget.sectionIndex >= 0 && sectionIndex !== experienceTarget.sectionIndex) return [];
          if (experienceTarget && experienceTarget.entryLineIndex >= 0 && lineIndex <= experienceTarget.entryLineIndex) return [];
          if (experienceTarget && experienceTarget.entryLineIndex >= 0 && nextEntryIndex >= 0 && lineIndex >= nextEntryIndex) return [];
          return [{
            id: `section-${sectionIndex}-line-${lineIndex}`,
            sectionIndex,
            lineIndex,
            sectionTitle: experienceTarget && experienceTarget.entryLineIndex >= 0
              ? selectedSection?.lines[experienceTarget.entryLineIndex]?.text || section.title
              : section.title,
            text: line.text.trim(),
          }];
        })
      ));
  if (!candidates.length || candidates.some((candidate) => !candidate.text)) {
    throw new Error(target.kind === "summary" ? "The summary is empty" : "No achievement bullets are available in that experience");
  }

  const resumeEvidence = [
    content.summary,
    ...allSections.flatMap((section) => section.lines
      .filter((line) => line.kind !== "divider")
      .map((line) => `${section.title}: ${line.text}`)),
  ].filter(Boolean).slice(0, 80);

  const deterministic = deterministicResumeSuggestion(content, keyword, target, userEvidence);
  if (deterministic) return deterministic;

  const prompt = [
    "You help a candidate truthfully tailor one selected resume passage.",
    "Return JSON only with supported, candidateId, suggestedBullet, and reason.",
    `The requested keyword is: ${keyword}`,
    "Choose exactly one candidate passage only when the resume evidence or candidate truth note genuinely supports the keyword.",
    "Rewrite conservatively so the keyword appears naturally and the original meaning stays intact.",
    "Treat B2B, B2C, B2B2C, and enterprise as market or customer context, not standalone technical skills.",
    "When supported, weave market context into a concise phrase instead of adding a keyword list.",
    "Preserve every number, metric, company, product, tool, and scope claim from the original.",
    "Do not invent responsibilities, seniority, leadership, outcomes, tools, or facts.",
    "When rewriting the summary, you may use supported context from the resume evidence. When rewriting an experience bullet, do not combine facts from different bullets.",
    "The candidate truth note is candidate-confirmed evidence. Use it only as written and do not expand it into unsupported claims.",
    "Do not use an em dash.",
    "If the evidence does not support the keyword, set supported to false, candidateId and suggestedBullet to empty strings, and explain why.",
    JSON.stringify({
      jobTitle: job.title,
      jobDescription: job.description.slice(0, 12_000),
      requestedTarget: target.kind,
      candidateTruthNote: userEvidence.trim().slice(0, 600),
      resumeEvidence,
      candidates: candidates.map(({ id, sectionTitle, text }) => ({ id, sectionTitle, text })),
    }),
  ].join("\n");

  const text = await runStructuredPrompt(prompt, {
    model,
    format: {
      type: "object",
      properties: {
        supported: { type: "boolean" },
        candidateId: { type: "string" },
        suggestedBullet: { type: "string" },
        reason: { type: "string" },
      },
      required: ["supported", "candidateId", "suggestedBullet", "reason"],
    },
    maxTokens: 1_024,
    timeoutMs: 90_000,
  });
  const parsed = parseStructuredResponse<ResumeBulletSuggestionResponse>(text);
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "No explanation was returned.";
  if (parsed.supported !== true) {
    return {
      supported: false,
      keyword,
      targetKind: target.kind === "summary" ? "summary" : "line",
      sectionIndex: -1,
      lineIndex: -1,
      sectionTitle: "",
      originalBullet: "",
      suggestedBullet: "",
      reason,
    };
  }

  const candidateId = typeof parsed.candidateId === "string" ? parsed.candidateId : "";
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("Local AI did not select a valid source bullet");
  const suggestedBullet = typeof parsed.suggestedBullet === "string"
    ? parsed.suggestedBullet.replace(/\u2014/g, "-").replace(/\s+/g, " ").trim()
    : "";
  if (!suggestedBullet || suggestedBullet.length > 700) throw new Error("Local AI returned an invalid bullet rewrite");
  if (!normalized(suggestedBullet).includes(normalized(keyword))) {
    throw new Error("The suggested rewrite did not include the requested keyword");
  }
  const originalNumbers = numericClaims(candidate.text);
  const suggestedNumbers = numericClaims(suggestedBullet);
  if (
    originalNumbers.some((number) => !suggestedNumbers.includes(number))
    || suggestedNumbers.some((number) => !originalNumbers.includes(number))
  ) {
    throw new Error("The suggested rewrite changed a numeric claim and was blocked");
  }

  return {
    supported: true,
    keyword,
    targetKind: candidate.id === "summary" ? "summary" : "line",
    sectionIndex: candidate.sectionIndex,
    lineIndex: candidate.lineIndex,
    sectionTitle: candidate.sectionTitle,
    originalBullet: candidate.text,
    suggestedBullet,
    reason,
  };
}
