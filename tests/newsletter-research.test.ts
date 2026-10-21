import { describe, expect, it, vi } from "vitest";
import { initialCompanyResearch, investigateCompany, parseResearchDecision, researchNewsletter, summarizeResearch } from "@/lib/newsletter-research";
import { researchPolicySchema, type CompanyResearch, type ResearchDecision } from "@/lib/newsletter-research-models";
import { claudeSearchPages, createNewsletterResearchTools } from "@/lib/newsletter-research-tools";

const profile = { targetRoles: ["Product Designer"], strengths: ["B2B workflows"], summary: "", workAuthorization: "Requires sponsorship", sponsorshipRequired: true };
const quote = "Acme raised a seed round to expand its B2B workflow product.";
const source = { kind: "text" as const, url: null, title: "Issue", text: quote };
const policy = researchPolicySchema.parse({});
function company(): CompanyResearch {
  const state = initialCompanyResearch({ companyId: "company-1", company: "Acme", observedSignals: [{ quote, kind: "funding", sourceStart: 0, sourceEnd: quote.length }] }, source);
  state.available_urls.push({ url: "https://acme.example.com/", label: "Acme" });
  return state;
}
function decision(state: CompanyResearch, changes: Partial<ResearchDecision> = {}): ResearchDecision {
  return {
    known_facts: state.known_facts, current_hypothesis: "Acme could be relevant; adoption and design capacity need evidence.",
    confidence: "LOW", unknowns: ["Adoption and design capacity are unverified."], criteria: structuredClone(state.criteria),
    verdict: "watch", opportunity_brief: "Potential B2B opportunity requiring verification.",
    action: "stop", target_url: "", key_uncertainty: "Design capacity and adoption.", expected_information_gain: "No further useful source is available.",
    worth_taking: false, decision_reason: "Evidence is insufficient and further research has low value.", stop_reason: "low_information_gain", ...changes,
  };
}
const pageText = "Acme makes B2B workflows. 200 paying customers renewed this year. Revenue doubled. We are hiring a product designer. Our 12-person company sponsors work visas.";
function supportedDecision(state: CompanyResearch, changes: Partial<ResearchDecision> = {}): ResearchDecision {
  const fact = { id: "F2", source_id: "research-2", quote: pageText, topic: "company_identity" as const };
  const result = decision(state, { known_facts: [...state.known_facts, fact], verdict: "pursue", confidence: "HIGH", unknowns: [], ...changes });
  for (const topic of ["company_identity", "target_market", "product_market_fit", "growth", "hiring", "company_size", "visa_fit"] as const) result.criteria[topic] = { status: "supported", summary: "Explicit company evidence supports this criterion.", evidence_ids: ["F2"] };
  return result;
}

describe("company investigation evidence and conservative judgments", () => {
  it("keeps the requested state and does not turn a funding mention into product-market fit", () => {
    const state = company();
    expect(state).toHaveProperty("research_history"); expect(state).toHaveProperty("known_facts");
    expect(state.criteria.product_market_fit.status).toBe("unknown");
    expect(state.criteria.design_gap.status).toBe("unknown");
  });
  it("retains an observed issue URL even when the extracted fact omitted the URL", () => {
    const input = { ...source, text: `${quote} https://acme.example.com/` };
    const state = initialCompanyResearch({ companyId: "company-1", company: "Acme", observedSignals: [{ quote, kind: "funding", sourceStart: 0, sourceEnd: quote.length }] }, input);
    expect(state.available_urls).toContainEqual({ url: "https://acme.example.com/", label: "Acme" });
  });
  it("rejects fabricated quotes, nonexistent citations and unsupported negative conclusions", () => {
    const state = company();
    expect(() => parseResearchDecision(JSON.stringify(decision(state, { known_facts: [{ ...state.known_facts[0], quote: "Acme has no designers." }] })), state, policy)).toThrow("exact quote");
    const bad = decision(state); bad.criteria.growth = { status: "supported", summary: "Growing", evidence_ids: ["invented"] };
    expect(() => parseResearchDecision(JSON.stringify(bad), state, policy)).toThrow("unknown fact");
    expect(() => parseResearchDecision(JSON.stringify(decision(state, { verdict: "pass" })), state, policy)).toThrow("contrary evidence");
  });
  it("copies numbered evidence passages itself and rejects invented passage IDs", () => {
    const state = company();
    const selected = { ...decision(state), known_facts: [{ id: "F1", source_id: "newsletter-1", passage_id: "newsletter-1:p1", topic: "growth" }] };
    expect(parseResearchDecision(JSON.stringify(selected), state, policy).known_facts[0].quote).toBe(quote);
    selected.known_facts[0].passage_id = "newsletter-1:p999";
    expect(() => parseResearchDecision(JSON.stringify(selected), state, policy)).toThrow("Unknown source passage");
  });
  it("requires a read page to confirm identity and keeps optimistic unsupported picks off the shortlist", () => {
    const state = company(); const bad = decision(state, { verdict: "pursue" });
    expect(parseResearchDecision(JSON.stringify(bad), state, policy).verdict).toBe("watch");
    bad.criteria.company_identity = { status: "supported", summary: "Official", evidence_ids: ["F1"] };
    expect(parseResearchDecision(JSON.stringify(bad), state, policy).criteria.company_identity.status).toBe("unknown");
  });
  it("does not substitute releases, craftsmanship or customer totals for growth, capacity or headcount", () => {
    const state = company(); const text = "Acme serves 40,000 teams. We launched an AI feature. We value design craftsmanship. We work in 3-person project teams.";
    state.sources.push({ id: "research-2", kind: "page", url: "https://acme.example.com/", title: "Acme", text, retrieved_at: "now", published_at: null, truncated: false });
    const result = decision(state, { known_facts: [{ id: "F2", source_id: "research-2", quote: text, topic: "growth" }] });
    for (const topic of ["growth", "design_gap", "company_size"] as const) result.criteria[topic] = { status: "supported", summary: "Optimistic interpretation", evidence_ids: ["F2"] };
    const checked = parseResearchDecision(JSON.stringify(result), state, policy);
    expect(checked.criteria.growth.status).toBe("unknown"); expect(checked.criteria.design_gap.status).toBe("unknown"); expect(checked.criteria.company_size.status).toBe("unknown");
  });
  it("keeps visa contradictions separate and prevents a pursue despite otherwise strong evidence", () => {
    const state = company(); state.sources.push({ id: "research-2", kind: "page", url: "https://acme.example.com/", title: "Acme", text: pageText, retrieved_at: "2026-10-14", published_at: null, truncated: false });
    const result = supportedDecision(state); result.criteria.visa_fit = { status: "contradicted", summary: "Role has an explicit eligibility conflict.", evidence_ids: ["F2"] };
    expect(parseResearchDecision(JSON.stringify(result), state, policy).verdict).toBe("watch");
  });
  it("requires full-page verification before search excerpts become decisive rejection evidence", () => {
    const state = company(); state.sources[0].kind = "search_excerpt";
    const bad = decision(state); bad.criteria.hiring = { status: "contradicted", summary: "Not hiring", evidence_ids: ["F1"] }; bad.verdict = "pass";
    expect(() => parseResearchDecision(JSON.stringify(bad), state, policy)).toThrow("full page");
  });
  it("routes guessed URLs to discovery and rejects repeated targets and premature budget stops", () => {
    const state = company();
    const next = decision(state, { action: "inspect_company_site", target_url: "https://guessed.example.com/", worth_taking: true, stop_reason: "" });
    expect(parseResearchDecision(JSON.stringify(next), state, policy).target_url).toBe("");
    next.target_url = "https://acme.example.com/";
    state.research_history.push({ step: 1, at: "now", decision: next, before: state, after: null, source_ids: [], outcome: "failed", error: "403" });
    expect(() => parseResearchDecision(JSON.stringify(next), state, policy)).toThrow("already attempted");
    const stopped = decision(company(), { stop_reason: "budget_reached" });
    expect(parseResearchDecision(JSON.stringify(stopped), company(), policy).action).toBe("inspect_company_site");
    const alreadyInvestigated = company(); alreadyInvestigated.actions_taken = 1;
    expect(() => parseResearchDecision(JSON.stringify(stopped), alreadyInvestigated, policy)).toThrow("not been reached");
  });
});

describe("bounded investigation loop", () => {
  it("assesses the last evidence at the ceiling and records a supported opportunity and belief revision", async () => {
    const state = company();
    const first = decision(state, { action: "inspect_company_site", target_url: "https://acme.example.com/", worth_taking: true, stop_reason: "" });
    const final = supportedDecision(state, { current_hypothesis: "Evidence supports a growing B2B company with a design opening.", stop_reason: "budget_reached" });
    const completion = vi.fn().mockResolvedValueOnce(JSON.stringify(first)).mockResolvedValueOnce(JSON.stringify(final));
    const execute = vi.fn(async () => ({ sources: [{ kind: "page" as const, url: "https://acme.example.com/", title: "Acme", text: pageText, published_at: null, truncated: false }], links: [], note: "Read site." }));
    const researched = await investigateCompany(state, profile, { policy: { maxActions: 1 }, completion, tools: { execute } });
    expect(execute).toHaveBeenCalledTimes(1); expect(completion).toHaveBeenCalledTimes(2);
    expect(researched.verdict).toBe("pursue"); expect(researched.status).toBe("stopped");
    expect(researched.research_history[0].after?.current_hypothesis).toContain("Evidence supports");
    expect(researched.research_history.at(-1)?.decision.action).toBe("stop");
    expect(summarizeResearch([researched]).shortlist).toHaveLength(1);
    expect(completion.mock.calls[1][0]).toContain("200 paying customers renewed this year.");
    expect(completion.mock.calls[1][0]).toContain("research-2:p5");
  });
  it("revises an optimistic belief downward when careers evidence says capacity is adequate and hiring is closed", async () => {
    const state = company(); state.confidence = "HIGH";
    const text = "Acme has adequate design capacity with six designers and is not accepting additional design hires.";
    const first = decision(state, { action: "inspect_careers", target_url: "https://acme.example.com/", worth_taking: true, stop_reason: "" });
    const final = decision(state, { known_facts: [...state.known_facts, { id: "F2", source_id: "research-2", quote: text, topic: "hiring" }], current_hypothesis: "Design capacity and closed hiring make this opportunity weak.", verdict: "pass", confidence: "HIGH", stop_reason: "opportunity_weak" });
    final.criteria.hiring = { status: "contradicted", summary: "Explicitly closed to design hires.", evidence_ids: ["F2"] };
    const result = await investigateCompany(state, profile, { completion: vi.fn().mockResolvedValueOnce(JSON.stringify(first)).mockResolvedValueOnce(JSON.stringify(final)), tools: { execute: async () => ({ sources: [{ kind: "page", url: "https://acme.example.com/", title: "Careers", text, published_at: null, truncated: false }], links: [], note: "Read careers." }) } });
    expect(result.verdict).toBe("pass"); expect(result.actions_taken).toBe(1); expect(summarizeResearch([result]).shortlist).toEqual([]);
  });
  it("logs tool failures as missing evidence and stops after two failures without treating them as rejection evidence", async () => {
    const state = company();
    const a = decision(state, { action: "inspect_company_site", worth_taking: true, stop_reason: "" });
    const b = decision(state, { action: "inspect_team", worth_taking: true, stop_reason: "" });
    const execute = vi.fn(async () => { throw new Error("HTTP 403"); });
    const result = await investigateCompany(state, profile, { completion: vi.fn().mockResolvedValueOnce(JSON.stringify(a)).mockResolvedValueOnce(JSON.stringify(b)), tools: { execute } });
    expect(result.verdict).toBe("watch"); expect(result.confidence).toBe("LOW"); expect(result.stop_reason).toContain("information_unavailable");
    expect(result.research_history[0].error).toBe("HTTP 403"); expect(result.research_history.at(-1)?.decision.action).toBe("stop");
  });
  it("fails closed after one invalid-output correction without spending tool calls", async () => {
    const completion = vi.fn(async () => "not json"); const execute = vi.fn();
    const result = await investigateCompany(company(), profile, { completion, tools: { execute } });
    expect(completion).toHaveBeenCalledTimes(2); expect(execute).not.toHaveBeenCalled();
    expect(result.stop_reason).toContain("assessment_failed"); expect(result.verdict).toBe("watch");
  });
  it("does not stop on low information gain before an available design posting can resolve visa uncertainty", () => {
    const state = company(); state.actions_taken = 2;
    const url = "https://acme.example.com/careers/product-designer";
    state.available_urls.push({ url, label: "Product Designer" });
    const stopped = decision(state, { key_uncertainty: "Visa sponsorship eligibility." });
    expect(() => parseResearchDecision(JSON.stringify(stopped), state, policy)).toThrow("available design posting");
    state.research_history.push({ step: 1, at: "now", decision: { ...stopped, action: "inspect_careers", target_url: url }, before: stopped, after: stopped, source_ids: [], outcome: "Read role; policy unstated.", error: null });
    expect(parseResearchDecision(JSON.stringify(stopped), state, policy).action).toBe("stop");
  });
  it("creates and investigates records for every company, including funding-only companies", async () => {
    const secondQuote = "OtherCo raised a seed round.";
    const input = { ...source, text: `${quote}\n\n${secondQuote}` };
    const other = initialCompanyResearch({ company: "OtherCo", companyId: "company-2", observedSignals: [{ quote: secondQuote, kind: "funding", sourceStart: quote.length + 2, sourceEnd: input.text.length }] }, input);
    const completion = vi.fn().mockResolvedValueOnce(JSON.stringify({ companies: [{ company: "Acme", observedSignals: [{ quote, kind: "funding" }] }, { company: "OtherCo", observedSignals: [{ quote: secondQuote, kind: "funding" }] }] }))
      .mockResolvedValueOnce(JSON.stringify(decision(company()))).mockResolvedValueOnce(JSON.stringify(decision(company(), { stop_reason: "budget_reached" })))
      .mockResolvedValueOnce(JSON.stringify(decision(other))).mockResolvedValueOnce(JSON.stringify(decision(other, { stop_reason: "budget_reached" })));
    const execute = vi.fn(async () => ({ sources: [], links: [], note: "No usable results; uncertainty remains." }));
    const result = await researchNewsletter(input, profile, { completion, policy: { maxActions: 1 }, tools: { execute } });
    expect(result.companies.map((item) => item.company)).toEqual(["Acme", "OtherCo"]); expect(result.counts.completed).toBe(2); expect(completion).toHaveBeenCalledTimes(5); expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("research tools", () => {
  it("reads selected pages and marks partial content, retaining links for the next action", async () => {
    const read = vi.fn(async () => ({ url: "https://acme.example.com/", title: "Acme", text: "x".repeat(20_000), links: [{ url: "https://acme.example.com/team", label: "Team" }] }));
    const result = await createNewsletterResearchTools({ read }).execute("inspect_company_site", "https://acme.example.com/", company());
    expect(result.sources[0].text).toHaveLength(18_000); expect(result.sources[0].truncated).toBe(true); expect(result.links).toHaveLength(2);
  });
  it("does one discovery search for an empty target and marks snippets as unverified", async () => {
    const search = vi.fn(async () => [{ url: "https://acme.example.com/", title: "Acme", text: "Acme grows", published_at: null }, { url: "http://127.0.0.1/private", title: "Private", text: "secret", published_at: null }]);
    const result = await createNewsletterResearchTools({ search }).execute("search_recent_news", "", company());
    expect(search).toHaveBeenCalledTimes(1); expect(search).toHaveBeenCalledWith(expect.any(String), true); expect(result.sources).toHaveLength(1); expect(result.sources[0].kind).toBe("search_excerpt");
  });
  it("uses native search source quotes, never the model's uncited summary or encrypted payload", () => {
    const result = claudeSearchPages([
      { type: "web_search_tool_result", caller: { type: "direct" }, tool_use_id: "tool", content: [{ type: "web_search_result", url: "https://acme.example.com", title: "Acme", encrypted_content: "opaque", page_age: null }] },
      { type: "text", text: "Invented uncited claim", citations: [{ type: "web_search_result_location", url: "https://acme.example.com", title: "Acme", encrypted_index: "opaque", cited_text: "Actual source excerpt" }] },
    ]);
    expect(result[0].text).toBe("Actual source excerpt"); expect(JSON.stringify(result)).not.toMatch(/Invented|opaque/);
  });
});
