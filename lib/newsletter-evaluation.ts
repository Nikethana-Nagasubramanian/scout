import { z } from "zod";
import type { NewsletterResult } from "@/lib/newsletter-models";

function companyKey(company: string): string {
  return company.toLowerCase().replace(/\s+/g, " ").trim();
}

export const newsletterFixtureSchema = z.object({
  examples: z.array(z.object({
    company: z.string().trim().min(1),
    text: z.string().trim().min(1),
    label: z.enum(["interesting", "maybe", "no"]),
  }).strict()).min(1).max(100),
}).strict().superRefine(({ examples }, context) => {
  const names = examples.map((example) => companyKey(example.company));
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Each fixture company must have exactly one label." });
  }
});
export type NewsletterFixture = z.infer<typeof newsletterFixtureSchema>;

export function fixtureNewsletter(fixture: NewsletterFixture): string {
  return fixture.examples.map((example) => example.text).join("\n\n");
}

export function evaluateNewsletter(result: NewsletterResult, fixture: NewsletterFixture, top = 5) {
  if (!Number.isInteger(top) || top < 1 || top > 100) throw new Error("top must be an integer from 1 to 100.");
  if (top > result.shortlist.length && result.counts.worthInvestigating > result.shortlist.length) {
    throw new Error(`Saved results contain only ${result.shortlist.length} shortlisted companies. Rerun analysis with --top ${top} to evaluate a larger shortlist.`);
  }
  const labels = new Map(fixture.examples.map((example) => [companyKey(example.company), example]));
  const selected = result.shortlist.filter((item) => item.opportunityScore !== "LOW").slice(0, top);
  if (new Set(selected.map((item) => companyKey(item.company))).size !== selected.length) {
    throw new Error("Evaluation results contain duplicate companies.");
  }
  const rows = selected.map((opportunity, index) => ({
    rank: index + 1, company: opportunity.company, score: opportunity.opportunityScore,
    label: labels.get(companyKey(opportunity.company))?.label ?? "unlabeled",
  }));
  const interesting = rows.filter((row) => row.label === "interesting").length;
  const useful = rows.filter((row) => row.label === "interesting" || row.label === "maybe").length;
  const selectedNames = new Set(rows.map((row) => companyKey(row.company)));
  return {
    requestedTop: top,
    returned: rows.length,
    // Unlabeled predictions count as misses; an empty shortlist has no measurable precision.
    precisionAtTop: rows.length ? interesting / rows.length : null,
    usefulPrecisionAtTop: rows.length ? useful / rows.length : null,
    unlabeledPredictions: rows.filter((row) => row.label === "unlabeled").length,
    missedInteresting: fixture.examples
      .filter((example) => example.label === "interesting" && !selectedNames.has(companyKey(example.company)))
      .map((example) => example.company),
    rows,
  };
}
