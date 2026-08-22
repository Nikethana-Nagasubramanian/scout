import type { CandidateFact, Job, ResumeContent } from "@/lib/types";
import { ensureResumeBlockIds } from "@/lib/resume-blocks";
import { normalizeText, parseList } from "@/lib/utils";

export interface ProactiveSuggestionPlan {
  keyword: string;
  blockId: string;
  target: { kind: "summary" } | { kind: "line"; sectionIndex: number; lineIndex: number };
  targetLabel: string;
  evidence: string;
  evidenceFactIds: number[];
  score: number;
}

const concepts: Array<{ keyword: string; aliases: string[]; summaryPreferred?: boolean }> = [
  { keyword: "analytics", aliases: ["analysis", "heatmap", "metrics", "data-driven", "usage data"] },
  { keyword: "SaaS", aliases: ["software as a service", "startup", "platform", "product"], summaryPreferred: true },
  { keyword: "B2B", aliases: ["business customers", "account managers", "enterprise", "customers"], summaryPreferred: true },
  { keyword: "B2B2C", aliases: ["consumers", "business customers", "customer-facing"], summaryPreferred: true },
  { keyword: "enterprise", aliases: ["enterprise", "account managers", "scale", "customers"], summaryPreferred: true },
  { keyword: "design systems", aliases: ["design system", "components", "component library"] },
  { keyword: "accessibility", aliases: ["accessible", "inclusive", "wcag"] },
  { keyword: "leadership", aliases: ["led", "owned", "advocated", "spearheaded", "mentored"] },
  { keyword: "collaboration", aliases: ["collaborated", "partnered", "cross-functional", "stakeholder"] },
  { keyword: "product strategy", aliases: ["strategy", "roadmap", "prioritization", "product direction"] },
  { keyword: "user research", aliases: ["research", "usability", "interviews", "user testing"] },
  { keyword: "prototyping", aliases: ["prototype", "prototyping", "figma"] },
  { keyword: "AI", aliases: ["artificial intelligence", "machine learning", "agentic", "claude", "ml"] },
  { keyword: "data visualization", aliases: ["visualization", "mapbox", "deck.gl", "dashboard"] },
  { keyword: "stakeholder management", aliases: ["stakeholders", "cross-functional", "partnered"] },
  { keyword: "usability testing", aliases: ["usability sessions", "usability tests", "user testing"] },
];

function includesPhrase(value: string, phrase: string): boolean {
  return normalizeText(value).includes(normalizeText(phrase));
}

function factText(fact: CandidateFact): string {
  return `${fact.category} ${fact.context} ${fact.claim} ${parseList(fact.skills).join(" ")}`;
}

export function planProactiveResumeSuggestions(
  input: ResumeContent,
  job: Pick<Job, "description" | "title">,
  facts: CandidateFact[],
  limit = 3,
): ProactiveSuggestionPlan[] {
  const content = ensureResumeBlockIds(input);
  const jobText = `${job.title} ${job.description}`;
  const narrativeResumeText = [
    content.summary,
    ...(content.sections || []).flatMap((section) => section.lines.map((line) => line.text)),
  ].join(" ");
  const verifiedFacts = facts.filter((fact) => fact.verified === 1);
  const plans: ProactiveSuggestionPlan[] = [];

  for (const concept of concepts) {
    if (!includesPhrase(jobText, concept.keyword) || includesPhrase(narrativeResumeText, concept.keyword)) continue;
    const matchingFacts = verifiedFacts.filter((fact) => (
      includesPhrase(factText(fact), concept.keyword)
      || concept.aliases.some((alias) => includesPhrase(factText(fact), alias))
    ));
    const careerFacts = matchingFacts.filter((fact) => fact.scope_type !== "employer");
    const exactFact = careerFacts.find((fact) => includesPhrase(factText(fact), concept.keyword));

    if (concept.summaryPreferred && exactFact) {
      plans.push({
        keyword: concept.keyword,
        blockId: content.summaryBlockId || "summary",
        target: { kind: "summary" },
        targetLabel: "Summary",
        evidence: exactFact.claim,
        evidenceFactIds: matchingFacts.map((fact) => fact.id),
        score: 120,
      });
      continue;
    }

    let best: ProactiveSuggestionPlan | null = null;
    for (const [sectionIndex, section] of (content.sections || []).entries()) {
      if (!/experience|project/i.test(section.title)) continue;
      for (const [lineIndex, line] of section.lines.entries()) {
        if (line.kind !== "bullet" || !line.text.trim() || !line.id) continue;
        const aliasMatches = concept.aliases.filter((alias) => includesPhrase(line.text, alias)).length;
        const keywordTokenMatches = normalizeText(concept.keyword)
          .split(" ")
          .filter((token) => token.length > 2 && includesPhrase(line.text, token)).length;
        const employerHeading = section.lines.slice(0, lineIndex).reverse().find((item) => item.kind === "entry")?.text || "";
        const eligibleFacts = matchingFacts.filter((fact) => fact.scope_type !== "employer"
          || (fact.scope_key && includesPhrase(employerHeading, fact.scope_key)));
        const lineExactFact = eligibleFacts.find((fact) => includesPhrase(factText(fact), concept.keyword));
        const score = aliasMatches * 25 + keywordTokenMatches * 10 + (eligibleFacts.length ? 8 : 0);
        if (score <= 0 || (best && best.score >= score)) continue;
        best = {
          keyword: concept.keyword,
          blockId: line.id,
          target: { kind: "line", sectionIndex, lineIndex },
          targetLabel: section.title,
          evidence: lineExactFact?.claim || line.text,
          evidenceFactIds: eligibleFacts.map((fact) => fact.id),
          score,
        };
      }
    }
    if (best) plans.push(best);
  }

  const usedBlocks = new Set<string>();
  return plans
    .sort((left, right) => right.score - left.score)
    .filter((plan) => {
      if (usedBlocks.has(plan.blockId)) return false;
      usedBlocks.add(plan.blockId);
      return true;
    })
    .slice(0, Math.max(0, Math.min(3, limit)));
}
