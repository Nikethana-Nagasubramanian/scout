import { z } from "zod";

const text = z.string().trim().min(1).max(800);
const explanations = z.array(text).min(1).max(5);
export const opportunityBandSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const signalKindSchema = z.enum([
  "funding", "product_launch", "product_expansion", "enterprise_adoption",
  "ai_workflow", "integrations", "onboarding", "hiring", "customer_expansion",
  "design_consistency", "operational_interface", "other",
]);
export const newsletterProfileSchema = z.object({
  targetRoles: z.array(text).max(20),
  strengths: z.array(text).max(50),
  summary: z.string().trim().max(2000).default(""),
  workAuthorization: z.string().trim().max(800).default(""),
  sponsorshipRequired: z.boolean().nullable().default(null),
}).strict();
export const extractionSchema = z.object({
  companies: z.array(z.object({
    company: z.string().trim().min(1).max(160),
    observedSignals: z.array(z.object({
      quote: z.string().min(1).max(2000),
      kind: signalKindSchema,
    }).strict()).min(1).max(20),
  }).strict()).max(100),
}).strict();
export const assessmentSchema = z.object({
  signalStrength: opportunityBandSchema,
  productComplexity: opportunityBandSchema,
  designRelevance: opportunityBandSchema,
  profileFit: opportunityBandSchema,
  specificity: opportunityBandSchema,
  uncertainty: opportunityBandSchema,
}).strict();
export const inferenceSchema = z.object({
  opportunities: z.array(z.object({
    companyId: z.string().min(1),
    inferredNeed: text,
    reasoning: explanations,
    unknowns: z.array(text).max(6),
    recommendedResearch: explanations,
    outreachAngle: z.string().trim().max(800),
    assessment: assessmentSchema,
  }).strict()).max(5),
}).strict();

export type NewsletterProfile = Omit<z.infer<typeof newsletterProfileSchema>, "workAuthorization" | "sponsorshipRequired">
  & Partial<Pick<z.infer<typeof newsletterProfileSchema>, "workAuthorization" | "sponsorshipRequired">>;
export type OpportunityBand = z.infer<typeof opportunityBandSchema>;
export type OpportunityAssessment = z.infer<typeof assessmentSchema>;
export type OpportunityInference = z.infer<typeof inferenceSchema>["opportunities"][number];
export interface ObservedSignal {
  quote: string;
  kind: z.infer<typeof signalKindSchema>;
  sourceStart: number;
  sourceEnd: number;
}
export interface NewsletterCompany {
  companyId: string;
  company: string;
  observedSignals: ObservedSignal[];
}
export interface NewsletterOpportunity extends NewsletterCompany, Omit<OpportunityInference, "companyId"> {
  opportunityScore: OpportunityBand;
  rankingReasons: string[];
}
export interface NewsletterResult {
  schemaVersion: 1;
  counts: { detected: number; potentiallyRelevant: number; worthInvestigating: number };
  shortlist: NewsletterOpportunity[];
}

export const newsletterResultSchema = z.object({
  schemaVersion: z.literal(1),
  counts: z.object({
    detected: z.number().int().nonnegative(),
    potentiallyRelevant: z.number().int().nonnegative(),
    worthInvestigating: z.number().int().nonnegative(),
  }).strict(),
  shortlist: z.array(inferenceSchema.shape.opportunities.element.extend({
    unknowns: z.array(text).max(8),
    company: z.string().trim().min(1).max(160),
    observedSignals: z.array(z.object({
      quote: z.string().min(1).max(2000), kind: signalKindSchema,
      sourceStart: z.number().int().nonnegative(), sourceEnd: z.number().int().nonnegative(),
    }).strict()).min(1),
    opportunityScore: opportunityBandSchema,
    rankingReasons: z.array(text),
  })),
}).strict();

// The same shapes steer Ollama; Zod remains the authority for both providers.
const stringFormat = { type: "string" };
const listFormat = { type: "array", items: stringFormat };
const bandFormat = { type: "string", enum: opportunityBandSchema.options };
function objectFormat(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
export const extractionFormat = objectFormat({
  companies: { type: "array", items: objectFormat({
    company: stringFormat,
    observedSignals: { type: "array", items: objectFormat({
      quote: stringFormat, kind: { type: "string", enum: signalKindSchema.options },
    }) },
  }) },
});
export const inferenceFormat = objectFormat({
  opportunities: { type: "array", items: objectFormat({
    companyId: stringFormat, inferredNeed: stringFormat, reasoning: listFormat,
    unknowns: listFormat, recommendedResearch: listFormat, outreachAngle: stringFormat,
    assessment: objectFormat(Object.fromEntries(Object.keys(assessmentSchema.shape).map((key) => [key, bandFormat]))),
  }) },
});
