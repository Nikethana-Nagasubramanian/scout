import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  analyzeNewsletter, extractNewsletterCompanies, newsletterChunks, newsletterInferencePrompt,
  parseNewsletterExtraction, parseNewsletterInferences, parseNewsletterJson,
} from "@/lib/newsletter";
import { extractionSchema, newsletterProfileSchema, type NewsletterCompany, type OpportunityInference } from "@/lib/newsletter-models";
import { rankNewsletterOpportunities, shortlistNewsletterOpportunities } from "@/lib/newsletter-ranking";
import { newsletterProfileFromCandidate } from "@/lib/newsletter-profile";
import { evaluateNewsletter, fixtureNewsletter, newsletterFixtureSchema } from "@/lib/newsletter-evaluation";

const profile = { targetRoles: ["Design Engineer"], strengths: ["AI workflows", "B2B products"], summary: "" };
const source = "Acme AI launched an AI workflow with human approval.\n\nPlain Capital raised $3M.";
function extraction() {
  return { companies: [
    { company: "Acme AI", observedSignals: [{ quote: "Acme AI launched an AI workflow with human approval.", kind: "ai_workflow" }] },
    { company: "Plain Capital", observedSignals: [{ quote: "Plain Capital raised $3M.", kind: "funding" }] },
  ] };
}
function inference(companyId: string, changes: Partial<OpportunityInference> = {}): OpportunityInference {
  return {
    companyId,
    inferredNeed: "Could benefit from clear review states and approval interactions in the newly launched AI workflow.",
    reasoning: ["The human approval step may create a concrete interaction design surface."],
    unknowns: ["Whether reviewers experience friction is unknown."],
    recommendedResearch: ["Inspect the review and approval experience."],
    outreachAngle: "Potentially position around human-in-the-loop workflow design.",
    assessment: {
      signalStrength: "HIGH", productComplexity: "HIGH", designRelevance: "HIGH",
      profileFit: "HIGH", specificity: "HIGH", uncertainty: "MEDIUM",
    },
    ...changes,
  };
}
function companies(): NewsletterCompany[] {
  return parseNewsletterExtraction(JSON.stringify(extraction()), source);
}

describe("newsletter evidence parsing", () => {
  it("keeps facts as exact source excerpts with recoverable offsets", () => {
    for (const company of companies()) {
      for (const signal of company.observedSignals) {
        expect(source.slice(signal.sourceStart, signal.sourceEnd)).toBe(signal.quote);
      }
    }
  });

  it("recovers exact source typography and adds nearby company attribution", () => {
    const typographySource = "Cosign launched “Discourse” for what’s happening in tech.";
    const typography = parseNewsletterExtraction(JSON.stringify({ companies: [{
      company: "Cosign",
      observedSignals: [{ quote: 'Cosign launched "Discourse" for what\'s happening in tech.', kind: "product_launch" }],
    }] }), typographySource);
    expect(typography[0].observedSignals[0].quote).toBe(typographySource);

    const contextualSource = "Aleph Surgical raised a $7.5M pre-seed to build surgical robots. They’re now hiring the founding team.";
    const contextual = parseNewsletterExtraction(JSON.stringify({ companies: [{
      company: "Aleph Surgical",
      observedSignals: [{ quote: "They're now hiring the founding team.", kind: "hiring" }],
    }] }), contextualSource);
    expect(contextual[0].observedSignals[0].quote).toBe(contextualSource);
    expect(contextualSource.slice(
      contextual[0].observedSignals[0].sourceStart,
      contextual[0].observedSignals[0].sourceEnd,
    )).toBe(contextualSource);
  });

  it("rejects invented companies, paraphrases, changed numbers, and misattributed facts", () => {
    const bad = [
      { company: "Invented", quote: "Invented launched a product." },
      { company: "Acme AI", quote: "Acme AI launched an AI workflow." },
      { company: "Plain Capital", quote: "Plain Capital raised $8M." },
      { company: "Acme AI", quote: "Plain Capital raised $3M." },
    ];
    for (const item of bad) {
      expect(() => parseNewsletterExtraction(JSON.stringify({ companies: [{
        company: item.company, observedSignals: [{ quote: item.quote, kind: "product_launch" }],
      }] }), source)).toThrow("Unverified source quote");
    }
    expect(() => parseNewsletterExtraction(JSON.stringify({ companies: [{
      company: "Acme", observedSignals: [{ quote: "SuperAcme launched a product.", kind: "product_launch" }],
    }] }), "SuperAcme launched a product.")).toThrow("Unverified source quote");
  });

  it("merges duplicate companies and signals without merging unrelated names", () => {
    const first = extraction().companies[0];
    const result = parseNewsletterExtraction(JSON.stringify({ companies: [first, { ...first, company: "acme ai" }, extraction().companies[1]] }), source);
    expect(result).toHaveLength(2);
    expect(result[0].observedSignals).toHaveLength(1);
    expect(new Set(result.map((company) => company.companyId)).size).toBe(2);
  });

  it("accepts fenced JSON but rejects malformed responses and unexpected factual fields", () => {
    expect(parseNewsletterJson("```json\n{\"companies\":[]}\n```", extractionSchema)).toEqual({ companies: [] });
    expect(() => parseNewsletterJson("not JSON", extractionSchema)).toThrow();
    expect(() => parseNewsletterJson(JSON.stringify({ ...extraction(), hiringDesigners: true }), extractionSchema)).toThrow();
    expect(() => parseNewsletterJson('{"companies":"Acme AI"}', extractionSchema)).toThrow();
  });

  it("validates every extraction chunk and preserves global source offsets", async () => {
    const longSource = "Header ".repeat(850) + "\n\n" + source;
    const chunks = newsletterChunks(longSource);
    expect(chunks.join("")).toBe(longSource);
    const completion = vi.fn().mockResolvedValueOnce('{"companies":[]}').mockResolvedValueOnce(JSON.stringify(extraction()));
    const result = await extractNewsletterCompanies(longSource, { completion });
    expect(completion).toHaveBeenCalledTimes(2);
    expect(longSource.slice(result[1].observedSignals[0].sourceStart, result[1].observedSignals[0].sourceEnd)).toBe("Plain Capital raised $3M.");
  });

  it("rejects empty and oversized input instead of silently truncating it", () => {
    expect(() => newsletterChunks(" \n ")).toThrow("empty");
    expect(() => newsletterChunks("a".repeat(60_001))).toThrow("60,000");
    expect(() => newsletterChunks(source, 0)).toThrow("positive integer");
  });
});

describe("newsletter inference", () => {
  it("rejects omissions, duplicate IDs, and invented IDs", () => {
    for (const opportunities of [
      [inference("company-1")],
      [inference("company-1"), inference("company-1")],
      [inference("company-1"), inference("other")],
    ]) expect(() => parseNewsletterInferences(JSON.stringify({ opportunities }), companies())).toThrow("companyId");
  });

  it("requires hypotheses and rejects unsupported team/hiring assertions", () => {
    for (const inferredNeed of [
      "The company needs a designer.",
      "Could need help because they have no designers.",
      "Could need a first product designer.",
      "Could need help because they are hiring designers.",
    ]) expect(() => parseNewsletterInferences(JSON.stringify({ opportunities: [
      inference("company-1", { inferredNeed }), inference("company-2"),
    ] }), companies())).toThrow();
  });

  it("allows hiring facts quoted exactly from this company's observed evidence", () => {
    const quote = "ComputeCore is hiring three kernel engineers for low-level performance optimization.";
    const company = parseNewsletterExtraction(JSON.stringify({ companies: [{
      company: "ComputeCore", observedSignals: [{ quote, kind: "hiring" }],
    }] }), quote);
    const result = parseNewsletterInferences(JSON.stringify({ opportunities: [
      inference(company[0].companyId, { reasoning: [quote] }),
    ] }), company);
    expect(result[0].reasoning).toEqual([quote]);
    expect(() => parseNewsletterInferences(JSON.stringify({ opportunities: [
      inference(company[0].companyId, { reasoning: ["They are hiring product designers."] }),
    ] }), company)).toThrow("Unsupported");
  });

  it("keeps design capacity and hiring as unknowns", () => {
    const parsed = parseNewsletterInferences(JSON.stringify({ opportunities: [inference("company-1"), inference("company-2")] }), companies());
    expect(parsed[0].unknowns).toContain("Current product/design support beyond the source is unknown.");
    expect(parsed[0].unknowns).toContain("Design hiring plans and appetite for outside help are unverified.");
    expect(parsed[0].reasoning).toHaveLength(1);
  });

  it("allows irrelevant companies to have no outreach angle and preserves saved result types", async () => {
    const completion = vi.fn().mockResolvedValueOnce(JSON.stringify(extraction()))
      .mockResolvedValueOnce(JSON.stringify({ opportunities: [inference("company-1")] }));
    const result = await analyzeNewsletter(source, profile, { completion });
    const { newsletterResultSchema } = await import("@/lib/newsletter-models");
    expect(newsletterResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(result.shortlist.map((item) => item.company)).toEqual(["Acme AI"]);
  });

  it("instructs the model to separate facts, avoid hiring claims, and use the supplied fit context", () => {
    const prompt = newsletterInferencePrompt(companies(), profile);
    expect(prompt).toContain("Separate facts from inference");
    expect(prompt).toContain("Do not invent team composition");
    expect(prompt).toContain("Do not claim a company is hiring unless the source says so");
    expect(prompt).toContain("State when evidence is weak");
    expect(prompt).toContain("worth investigating");
    expect(prompt).toContain("AI workflows");
  });

  it("projects only relevant fit fields from the saved candidate profile", () => {
    const context = newsletterProfileFromCandidate({
      target_titles: '["Product Designer"]', skills: "AI workflows,Frontend", professional_summary: "Workflow designer",
    });
    expect(context).toEqual({ targetRoles: ["Product Designer"], strengths: ["AI workflows", "Frontend"], summary: "Workflow designer", workAuthorization: "", sponsorshipRequired: null });
    expect(() => newsletterProfileSchema.parse({ ...context, email: "private@example.com" })).toThrow();
  });
});

describe("newsletter ranking", () => {
  it("rejects funding-only and hiring-only opportunities even with optimistic model scores", () => {
    const ranked = rankNewsletterOpportunities(companies(), [inference("company-1"), inference("company-2")]);
    expect(ranked[0].opportunityScore).toBe("HIGH");
    expect(ranked[1].opportunityScore).toBe("LOW");
    const hiring = { ...companies()[1], observedSignals: [{ ...companies()[1].observedSignals[0], kind: "hiring" as const }] };
    expect(rankNewsletterOpportunities([hiring], [inference(hiring.companyId)])[0].opportunityScore).toBe("LOW");
  });

  it("excludes weak evidence, generic hypotheses, poor design relevance, and poor profile fit", () => {
    for (const dimension of ["signalStrength", "designRelevance", "specificity", "profileFit"] as const) {
      const assessment = { ...inference("company-1").assessment, [dimension]: "LOW" as const };
      const ranked = rankNewsletterOpportunities([companies()[0]], [inference("company-1", { assessment })]);
      expect(shortlistNewsletterOpportunities(ranked)).toEqual([]);
    }
  });

  it("penalizes uncertainty and caps highly uncertain opportunities at MEDIUM", () => {
    const assessment = { ...inference("company-1").assessment, uncertainty: "HIGH" as const };
    const ranked = rankNewsletterOpportunities([companies()[0]], [inference("company-1", { assessment })]);
    expect(ranked[0].opportunityScore).toBe("MEDIUM");
    expect(ranked[0].rankingReasons.join(" ")).toContain("High uncertainty");
  });

  it("returns at most five by default and resolves ties consistently", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({ ...companies()[0], companyId: `id-${i}`, company: `Company ${7 - i}` }));
    const ranked = rankNewsletterOpportunities(candidates, candidates.map((company) => inference(company.companyId)));
    expect(shortlistNewsletterOpportunities(ranked)).toHaveLength(5);
    expect(shortlistNewsletterOpportunities(ranked, 2).map((item) => item.company)).toEqual(["Company 0", "Company 1"]);
    expect(() => shortlistNewsletterOpportunities(ranked, 0)).toThrow();
  });
});

describe("newsletter pipeline and evaluation", () => {
  it("runs extraction, inference, ranking, and shortlist with no network or crawling", async () => {
    const completion = vi.fn().mockResolvedValueOnce(JSON.stringify(extraction()))
      .mockResolvedValueOnce(JSON.stringify({ opportunities: [inference("company-1")] }));
    const result = await analyzeNewsletter(source, profile, { completion });
    expect(completion).toHaveBeenCalledTimes(2);
    expect(result.counts).toEqual({ detected: 2, potentiallyRelevant: 1, worthInvestigating: 1 });
    expect(completion.mock.calls[1][0]).not.toContain("Plain Capital");
    expect(result.shortlist.map((item) => item.company)).toEqual(["Acme AI"]);
    expect(result.shortlist[0].observedSignals[0].quote).toBe(extraction().companies[0].observedSignals[0].quote);
  });

  it("does not make inference calls for newsletters with no detected companies", async () => {
    const completion = vi.fn().mockResolvedValue('{"companies":[]}');
    expect((await analyzeNewsletter("No company announcements today.", profile, { completion })).shortlist).toEqual([]);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it("skips inference for funding and hiring alone without losing detection counts", async () => {
    const funding = { companies: [extraction().companies[1]] };
    const completion = vi.fn().mockResolvedValue(JSON.stringify(funding));
    const result = await analyzeNewsletter("Plain Capital raised $3M.", profile, { completion });
    expect(result.counts).toEqual({ detected: 1, potentiallyRelevant: 0, worthInvestigating: 0 });
    expect(result.shortlist).toEqual([]);
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it("validates options before making AI calls and propagates failures without fake results", async () => {
    const completion = vi.fn().mockRejectedValue(new Error("provider failed"));
    await expect(analyzeNewsletter(source, profile, { completion, top: -1 })).rejects.toThrow("top");
    expect(completion).not.toHaveBeenCalled();
    await expect(analyzeNewsletter(source, profile, { completion })).rejects.toThrow("provider failed");
  });

  it("requests one correction for invalid model output and still fails closed if it remains invalid", async () => {
    const completion = vi.fn().mockResolvedValueOnce('{"companies":"invalid"}')
      .mockResolvedValueOnce(JSON.stringify(extraction()))
      .mockResolvedValueOnce(JSON.stringify({ opportunities: [inference("company-1")] }));
    expect((await analyzeNewsletter(source, profile, { completion })).shortlist).toHaveLength(1);
    expect(completion).toHaveBeenCalledTimes(3);
    expect(completion.mock.calls[1][0]).toContain("previous response was rejected");
    const invalid = vi.fn().mockResolvedValue('{"companies":"invalid"}');
    await expect(analyzeNewsletter(source, profile, { completion: invalid })).rejects.toThrow();
    expect(invalid).toHaveBeenCalledTimes(2);
  });

  it("measures strict and useful precision, counting unlabeled predictions as misses", () => {
    const candidates = ["Acme AI", "Maybe Co", "Bad Co", "Unknown Co"].map((company, i) => ({ ...companies()[0], company, companyId: `id-${i}` }));
    const result = { schemaVersion: 1 as const, counts: { detected: 4, potentiallyRelevant: 4, worthInvestigating: 4 },
      shortlist: rankNewsletterOpportunities(candidates, candidates.map((company) => inference(company.companyId))) };
    const fixture = newsletterFixtureSchema.parse({ examples: [
      { company: "Acme AI", text: source, label: "interesting" },
      { company: "Maybe Co", text: "Maybe Co launched a product.", label: "maybe" },
      { company: "Bad Co", text: "Bad Co sponsored a newsletter.", label: "no" },
      { company: "Missed Co", text: "Missed Co launched a review workflow.", label: "interesting" },
    ] });
    const evaluation = evaluateNewsletter(result, fixture);
    expect(evaluation.returned).toBe(4);
    expect(evaluation.precisionAtTop).toBe(0.25);
    expect(evaluation.usefulPrecisionAtTop).toBe(0.5);
    expect(evaluation.unlabeledPredictions).toBe(1);
    expect(evaluation.missedInteresting).toEqual(["Missed Co"]);
    expect(() => evaluateNewsletter({ ...result, counts: { ...result.counts, worthInvestigating: 6 } }, fixture)).toThrow("Rerun analysis");
    expect(evaluateNewsletter({ ...result, counts: { ...result.counts, worthInvestigating: 0 }, shortlist: [] }, fixture).precisionAtTop).toBeNull();
  });

  it("provides 20 labeled synthetic examples and never feeds labels into the newsletter", () => {
    const fixture = newsletterFixtureSchema.parse(JSON.parse(readFileSync("examples/newsletter/evaluation.json", "utf8")));
    expect(fixture.examples).toHaveLength(20);
    expect(fixtureNewsletter(fixture)).not.toContain('"label"');
    expect(new Set(fixture.examples.map((example) => example.label))).toEqual(new Set(["interesting", "maybe", "no"]));
    expect(() => newsletterFixtureSchema.parse({ examples: [fixture.examples[0], fixture.examples[0]] })).toThrow("exactly one label");
  });
});
