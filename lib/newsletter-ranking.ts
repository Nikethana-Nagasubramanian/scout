import type {
  NewsletterCompany, NewsletterOpportunity, OpportunityAssessment, OpportunityInference,
} from "@/lib/newsletter-models";

const points = { HIGH: 2, MEDIUM: 1, LOW: 0 } as const;
const productKinds = new Set([
  "product_launch", "product_expansion", "enterprise_adoption", "ai_workflow",
  "integrations", "onboarding", "customer_expansion", "design_consistency", "operational_interface",
]);

export function hasProductSignal(company: NewsletterCompany): boolean {
  return company.observedSignals.some((signal) => productKinds.has(signal.kind));
}

function priority(assessment: OpportunityAssessment): number {
  return points[assessment.signalStrength] + points[assessment.productComplexity]
    + points[assessment.designRelevance] * 2 + points[assessment.profileFit]
    + points[assessment.specificity] * 2 - points[assessment.uncertainty];
}

export function rankNewsletterOpportunities(
  companies: NewsletterCompany[], inferences: OpportunityInference[],
): NewsletterOpportunity[] {
  const byId = new Map(inferences.map((inference) => [inference.companyId, inference]));
  if (byId.size !== inferences.length || inferences.length !== companies.length
    || inferences.some((inference) => !companies.some((company) => company.companyId === inference.companyId))) {
    throw new Error("Inference must contain exactly one assessment for every extracted company.");
  }
  return companies.map((company): NewsletterOpportunity => {
    const inference = byId.get(company.companyId)!;
    const a = inference.assessment;
    const rankingReasons: string[] = [];
    const eligible = hasProductSignal(company) && a.signalStrength !== "LOW"
      && a.designRelevance !== "LOW" && a.specificity !== "LOW" && a.profileFit !== "LOW";
    if (!hasProductSignal(company)) rankingReasons.push("Funding, hiring, or a mention alone does not establish a product/design need.");
    if (a.signalStrength === "LOW") rankingReasons.push("The source evidence is weak.");
    if (a.designRelevance === "LOW" || a.specificity === "LOW") rankingReasons.push("A specific product/design connection is missing.");
    if (a.profileFit === "LOW") rankingReasons.push("The hypothesis has little connection to the candidate profile.");
    const score = priority(a);
    const opportunityScore = !eligible || score < 6 ? "LOW"
      : score >= 10 && a.uncertainty !== "HIGH" ? "HIGH" : "MEDIUM";
    if (opportunityScore !== "LOW") rankingReasons.push("A source-backed product signal supports a specific hypothesis worth investigating.");
    if (a.uncertainty === "HIGH") rankingReasons.push("High uncertainty limits confidence to MEDIUM.");
    return { ...company, ...inference, opportunityScore, rankingReasons };
  }).sort((left, right) => (
    points[right.opportunityScore] - points[left.opportunityScore]
    || priority(right.assessment) - priority(left.assessment)
    || left.company.localeCompare(right.company)
  ));
}

export function shortlistNewsletterOpportunities(ranked: NewsletterOpportunity[], top = 5): NewsletterOpportunity[] {
  if (!Number.isInteger(top) || top < 1 || top > 100) throw new Error("top must be an integer from 1 to 100.");
  return ranked.filter((opportunity) => opportunity.opportunityScore !== "LOW").slice(0, top);
}
