import { z } from "zod";
import type { NewsletterProfile } from "@/lib/newsletter-models";
import type { NewsletterSource } from "@/lib/newsletter-input";

export const researchActions = ["inspect_company_site", "inspect_team", "inspect_careers", "inspect_product", "search_recent_news", "stop"] as const;
export const researchTopics = ["company_identity", "target_market", "product_market_fit", "growth", "design_gap", "hiring", "company_size", "visa_fit"] as const;
const text = z.string().trim().min(1).max(1200);
const band = z.enum(["HIGH", "MEDIUM", "LOW"]);
const criterion = z.object({
  status: z.enum(["supported", "contradicted", "unknown"]),
  summary: text,
  evidence_ids: z.array(z.string().min(1)).max(12),
}).strict();
export const researchCriteriaSchema = z.object(Object.fromEntries(researchTopics.map((topic) => [topic, criterion])) as Record<typeof researchTopics[number], typeof criterion>).strict();
export const knownFactSchema = z.object({
  id: z.string().min(1).max(80), source_id: z.string().min(1).max(80),
  quote: z.string().min(1).max(800), topic: z.enum(researchTopics),
}).strict();
export const beliefSchema = z.object({
  known_facts: z.array(knownFactSchema).max(40),
  current_hypothesis: text,
  confidence: band,
  unknowns: z.array(text).max(12),
  criteria: researchCriteriaSchema,
  verdict: z.enum(["pursue", "watch", "pass"]),
  opportunity_brief: text,
}).strict();
export const researchDecisionSchema = beliefSchema.extend({
  known_facts: z.array(z.union([knownFactSchema, z.object({
    id: z.string().min(1).max(80), source_id: z.string().min(1).max(80),
    passage_id: z.string().min(1).max(100), topic: z.enum(researchTopics),
  }).strict()])).max(40),
  action: z.enum(researchActions),
  target_url: z.string().max(4096),
  key_uncertainty: text,
  expected_information_gain: text,
  worth_taking: z.boolean(),
  decision_reason: text,
  stop_reason: z.enum(["", "confidence_high", "opportunity_weak", "low_information_gain", "budget_reached"]),
}).strict();
export const defaultResearchCriteria = "Prioritize companies with a relevant target market, evidence of product-market fit and growth, and an underserved design function or explicit design hiring. Prefer smaller companies where my skills can make a substantial contribution. Pass when evidence shows adequate design capacity together with no hiring appetite, or an unsuitable company scale. Evaluate citizenship, clearance, export-control and sponsorship requirements separately from growth; security or defense alone is not a disqualifier. Do not equate a missing designer on a public team page with having no designers.";
export const researchPolicySchema = z.object({
  maxActions: z.number().int().min(1).max(10).default(5),
  stance: z.literal("conservative").default("conservative"),
  criteria: z.string().trim().min(1).max(4000).default(defaultResearchCriteria),
}).strict();

export type ResearchPolicy = z.infer<typeof researchPolicySchema>;
export type ResearchAction = typeof researchActions[number];
export type ResearchBelief = z.infer<typeof beliefSchema>;
export type ResearchDecision = Omit<z.infer<typeof researchDecisionSchema>, "known_facts"> & { known_facts: z.infer<typeof knownFactSchema>[] };
export interface ResearchSource {
  id: string; kind: "newsletter" | "page" | "search_excerpt";
  url: string | null; title: string; text: string;
  retrieved_at: string; published_at: string | null; truncated: boolean;
}
export interface ResearchHistoryEntry {
  step: number; at: string;
  decision: Pick<ResearchDecision, "action" | "target_url" | "key_uncertainty" | "expected_information_gain" | "worth_taking" | "decision_reason">;
  before: ResearchBelief;
  after: ResearchBelief | null;
  source_ids: string[]; outcome: string; error: string | null;
}
export interface CompanyResearch extends ResearchBelief {
  companyId: string; company: string;
  status: "pending" | "investigating" | "stopped";
  stop_reason: string | null;
  actions_taken: number;
  sources: ResearchSource[];
  available_urls: { url: string; label: string }[];
  research_history: ResearchHistoryEntry[];
}
export interface NewsletterResearchResult {
  schemaVersion: 2;
  counts: { detected: number; completed: number; potentiallyRelevant: number; worthInvestigating: number };
  companies: CompanyResearch[];
  shortlist: CompanyResearch[];
}
export interface NewsletterResearchRun {
  id: string;
  status: "running" | "complete" | "failed";
  created_at: string; updated_at: string;
  progress: string; error: string | null;
  source: NewsletterSource; profile: NewsletterProfile; policy: ResearchPolicy;
  analysis: NewsletterResearchResult | null;
  top: number;
}

const str = { type: "string" };
const strings = { type: "array", items: str };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const researchDecisionFormat = obj({
  known_facts: { type: "array", items: obj({ id: str, source_id: str, passage_id: str, topic: { type: "string", enum: researchTopics } }) },
  current_hypothesis: str, confidence: { type: "string", enum: band.options }, unknowns: strings,
  criteria: obj(Object.fromEntries(researchTopics.map((topic) => [topic, obj({ status: { type: "string", enum: criterion.shape.status.options }, summary: str, evidence_ids: strings })]))),
  verdict: { type: "string", enum: beliefSchema.shape.verdict.options }, opportunity_brief: str,
  action: { type: "string", enum: researchActions }, target_url: str, key_uncertainty: str,
  expected_information_gain: str, worth_taking: { type: "boolean" }, decision_reason: str,
  stop_reason: { type: "string", enum: researchDecisionSchema.shape.stop_reason.options },
});
