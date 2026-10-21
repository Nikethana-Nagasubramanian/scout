import { extractNewsletterCompanies, parseNewsletterJson, validatedNewsletterCompletion, type NewsletterOptions } from "@/lib/newsletter";
import { newsletterProfileSchema, type NewsletterCompany, type NewsletterProfile } from "@/lib/newsletter-models";
import { newsletterUrl, type NewsletterSource } from "@/lib/newsletter-input";
import {
  beliefSchema, researchCriteriaSchema, researchDecisionSchema, researchDecisionFormat, researchPolicySchema, researchTopics,
  type CompanyResearch, type NewsletterResearchResult, type ResearchBelief, type ResearchDecision, type ResearchPolicy,
} from "@/lib/newsletter-research-models";
import { newsletterResearchPrompt } from "@/lib/newsletter-research-prompts";
import { createNewsletterResearchTools, type NewsletterResearchTools } from "@/lib/newsletter-research-tools";
import { sourcePassages } from "@/lib/newsletter-research-evidence";

export interface ResearchOptions extends NewsletterOptions {
  policy?: Partial<ResearchPolicy>;
  tools?: NewsletterResearchTools;
  onCheckpoint?: (result: NewsletterResearchResult) => void | Promise<void>;
}

export function initialCompanyResearch(company: NewsletterCompany, source: NewsletterSource): CompanyResearch {
  const now = new Date().toISOString();
  const sources = company.observedSignals.map((signal, index) => ({
    id: `newsletter-${index + 1}`, kind: "newsletter" as const, url: source.url, title: source.title,
    text: signal.quote, retrieved_at: now, published_at: null, truncated: false,
  }));
  const mentionParagraphs = source.text.split(/\n\s*\n/).filter((paragraph) => paragraph.toLowerCase().includes(company.company.toLowerCase()));
  const textUrls = mentionParagraphs.flatMap((paragraph) => [...paragraph.matchAll(/https?:\/\/[^\s<>"')]+/g)].map((match) => ({ url: match[0].replace(/[.,;]+$/, ""), label: company.company })));
  // Issue links remain candidate URLs until identity is verified; never guess a company domain.
  const links = [...textUrls, ...(source.links || []).filter((link) => link.label.toLowerCase().includes(company.company.toLowerCase()))];
  return {
    companyId: company.companyId, company: company.company,
    known_facts: sources.map((item, index) => ({ id: `F${index + 1}`, source_id: item.id, quote: item.text.slice(0, 800), topic: "company_identity" })),
    current_hypothesis: "The newsletter mention may indicate an opportunity; company fit and design demand need assessment.",
    confidence: "LOW", unknowns: ["Company identity, target market, adoption, growth, design capacity, hiring and visa fit need assessment."],
    criteria: researchCriteriaSchema.parse(Object.fromEntries(researchTopics.map((topic) => [topic, { status: "unknown", summary: "Not yet assessed.", evidence_ids: [] }]))),
    verdict: "watch", opportunity_brief: "Pending investigation.", status: "pending", stop_reason: null, actions_taken: 0,
    sources, available_urls: safeLinks(links), research_history: [],
  };
}

function safeLinks(links: { url: string; label: string }[]): { url: string; label: string }[] {
  const safe = new Map<string, { url: string; label: string }>();
  for (const link of links) {
    try { const url = newsletterUrl(link.url).toString(); safe.set(url, { url, label: link.label.slice(0, 200) }); } catch { /* Ignore unsupported links. */ }
  }
  return [...safe.values()].slice(0, 200);
}

export function parseResearchDecision(response: string, company: CompanyResearch, policy: ResearchPolicy): ResearchDecision {
  const parsed = parseNewsletterJson(response, researchDecisionSchema);
  const decision: ResearchDecision = { ...parsed, known_facts: parsed.known_facts.map((fact) => {
    if ("quote" in fact) return fact;
    const source = company.sources.find((source) => source.id === fact.source_id);
    const passage = source && sourcePassages(source).find((passage) => passage.id === fact.passage_id);
    if (!passage) throw new Error(`Unknown source passage ${fact.passage_id}. Select an exact supplied passage_id.`);
    return { id: fact.id, source_id: fact.source_id, quote: passage.text, topic: fact.topic };
  }) };
  const facts = new Map(decision.known_facts.map((fact) => [fact.id, fact]));
  if (facts.size !== decision.known_facts.length) throw new Error("known_facts IDs must be unique.");
  for (const fact of facts.values()) {
    const source = company.sources.find((source) => source.id === fact.source_id);
    if (!source || !source.text.includes(fact.quote)) throw new Error(`Fact ${fact.id} is not an exact quote from source ${fact.source_id}: ${JSON.stringify(fact.quote)}. Copy a short literal passage from that supplied source, or omit this fact and leave its criterion unknown.`);
  }
  const leaveUnknown = (topic: keyof ResearchBelief["criteria"], reason: string) => {
    decision.criteria[topic] = { status: "unknown", summary: reason, evidence_ids: [] };
    decision.unknowns = [...new Set([...decision.unknowns, reason])].slice(0, 12);
  };
  for (const [topic, criterion] of Object.entries(decision.criteria)) {
    if (criterion.status !== "unknown" && !criterion.evidence_ids.length) { leaveUnknown(topic as keyof ResearchBelief["criteria"], `${topic}: no attributed evidence supports a conclusion yet.`); continue; }
    if (criterion.evidence_ids.some((id) => !facts.has(id))) throw new Error(`${topic} cites an unknown fact ID.`);
    if (criterion.status === "contradicted" && criterion.evidence_ids.every((id) => company.sources.find((source) => source.id === facts.get(id)?.source_id)?.kind === "search_excerpt")) throw new Error(`Read a full page before treating ${topic} search excerpts as decisive contrary evidence.`);
  }
  const quotes = (topic: keyof ResearchBelief["criteria"]) => decision.criteria[topic].evidence_ids.map((id) => facts.get(id)!.quote).join(" ");
  // These narrow evidence checks prevent common substitutions: activity for growth,
  // design culture for capacity, and customer count for employee count.
  const growthEvidence = /\b(?:customers?|revenue|users?|sales|adoption|employees?|headcount|team|usage)\b.{0,80}\b(?:grew|grown|increased|increasing|doubled|tripled|expanded|expanding)\b|\b(?:grew|grown|increased|increasing|doubled|tripled|expanded|expanding)\b.{0,80}\b(?:customers?|revenue|users?|sales|adoption|employees?|headcount|team|usage)\b|\d[\d,.]*\s*%[^.]{0,60}\bgrowth\b|\bgrowth\b[^.]{0,60}\d[\d,.]*\s*%/i;
  if (decision.criteria.growth.status === "supported" && !growthEvidence.test(quotes("growth"))) leaveUnknown("growth", "Growth over time is not established by the cited evidence; launches and customer totals alone are insufficient.");
  const capacityEvidence = /\b(?:first|founding|sole|only)\s+(?:(?:product|ux|ui|full.time|in.house)\s+)?designer\b|\b(?:no|without|lacks?|lacking)\s+(?:a\s+)?(?:designers?|design (?:team|support|capacity))\b|\b(?:understaffed|underresourced|limited|insufficient)\b.{0,50}\bdesign\b|\bdesign\b.{0,50}\b(?:understaffed|underresourced|limited capacity|insufficient capacity)\b/i;
  if (decision.criteria.design_gap.status === "supported" && !capacityEvidence.test(quotes("design_gap"))) leaveUnknown("design_gap", "A design capacity gap is unverified; design culture and open roles alone do not establish understaffing.");
  const headcountEvidence = /\b(?:headcount|staff size|company size)\b|\b\d[\d,]*[\s-](?:person|employee|member)\s+(?:company|organization)\b|\b\d[\d,]*\s+(?:employees|staff members)\b/i;
  if (decision.criteria.company_size.status !== "unknown" && !headcountEvidence.test(quotes("company_size"))) leaveUnknown("company_size", "Company headcount relative to your size preference is unknown; customer count and project team size are insufficient.");
  if (decision.criteria.company_identity.status === "supported") {
    if (!decision.criteria.company_identity.evidence_ids.some((id) => company.sources.some((source) => source.id === facts.get(id)?.source_id && source.kind === "page"))) {
      leaveUnknown("company_identity", "Company identity needs a relevant page read; newsletter mentions and search excerpts alone do not confirm it.");
    }
  }
  if (decision.verdict === "pass" && !Object.values(decision.criteria).some((criterion) => criterion.status === "contradicted")) {
    throw new Error("A pass requires contrary evidence. Missing evidence belongs in watch/unknowns.");
  }
  // Deterministic conservative gates protect the shortlist from an optimistic model.
  const core = ["company_identity", "target_market", "product_market_fit", "growth"] as const;
  if (decision.verdict === "pursue" && (core.some((topic) => decision.criteria[topic].status !== "supported")
    || ![decision.criteria.design_gap.status, decision.criteria.hiring.status].includes("supported")
    || decision.criteria.visa_fit.status === "contradicted" || decision.criteria.company_size.status === "contradicted")) decision.verdict = "watch";
  if (decision.verdict === "pursue" && decision.confidence === "LOW") decision.verdict = "watch";
  if (decision.verdict === "pursue" && decision.confidence === "HIGH" && (decision.unknowns.length || decision.criteria.visa_fit.status === "unknown")) decision.confidence = "MEDIUM";
  if (decision.action === "stop" && decision.verdict === "watch" && stateNeedsInitialInspection(company, policy)) {
    decision.action = "inspect_company_site";
    decision.target_url = company.available_urls.length === 1 ? company.available_urls[0].url : "";
    decision.stop_reason = ""; decision.worth_taking = true;
    decision.confidence = "LOW";
    decision.key_uncertainty = "Company identity, target market and whether an opportunity exists beyond the initial mention.";
    decision.expected_information_gain = "One bounded site inspection or discovery search could establish fit and materially change the initial assessment.";
    decision.decision_reason = "The company has not yet been inspected and there is no decisive contrary evidence. Scout requires one initial investigation before stopping an unresolved company.";
  }
  if (decision.action === "stop") {
    if (decision.worth_taking || decision.target_url || !decision.stop_reason) throw new Error("A stop needs a reason, no target URL, and worth_taking=false.");
    if (decision.stop_reason === "confidence_high" && (decision.confidence !== "HIGH" || decision.unknowns.length)) throw new Error("Use low_information_gain when confidence is not HIGH or material unknowns remain.");
    if (decision.stop_reason === "opportunity_weak" && decision.verdict !== "pass") throw new Error("Weak-opportunity stopping requires contrary evidence and pass.");
    if (decision.stop_reason === "budget_reached" && company.actions_taken < policy.maxActions) throw new Error("The action budget has not been reached.");
    const designPostings = company.available_urls.filter((link) => /design(?:er| engineer)/i.test(link.label)
      && /\/careers\/.+|\/jobs\/.+|ashbyhq\.com\/|lever\.co\/|greenhouse\.io\//i.test(link.url));
    const inspectedPosting = company.research_history.some((entry) => entry.decision.action === "inspect_careers" && !entry.error && designPostings.some((link) => link.url === entry.decision.target_url));
    if (decision.stop_reason === "low_information_gain" && company.actions_taken < policy.maxActions && decision.verdict === "watch"
      && decision.criteria.visa_fit.status === "unknown" && /visa|sponsor|citizen|eligib|clearance/i.test(decision.key_uncertainty)
      && designPostings.length && !inspectedPosting) {
      throw new Error("An available design posting has not been inspected and could resolve eligibility. Use inspect_careers on the most relevant observed posting before declaring low information gain.");
    }
  } else {
    if (!decision.worth_taking || decision.stop_reason) throw new Error("Research actions need worth_taking=true and no stop_reason.");
    if (company.actions_taken >= policy.maxActions) throw new Error("The budget is reached. Update with the last evidence and choose stop.");
    if (decision.action === "search_recent_news" && decision.target_url) throw new Error("News search needs an empty target_url.");
    if (decision.target_url) decision.target_url = newsletterUrl(decision.target_url).toString();
    if (decision.target_url && !company.available_urls.some((link) => link.url === decision.target_url)) {
      // Preserve the chosen investigation goal, but a guessed URL can only trigger discovery.
      decision.target_url = "";
      decision.decision_reason = `${decision.decision_reason.slice(0, 950)} The proposed URL was not observed; a discovery search is required before reading a page.`;
    }
    if (company.research_history.some((entry) => entry.decision.action !== "stop" && (decision.target_url ? entry.decision.target_url === decision.target_url : entry.decision.action === decision.action && !entry.decision.target_url))) {
      throw new Error("This action/target was already attempted. Choose another worthwhile action or stop.");
    }
  }
  return decision;
}

function stateNeedsInitialInspection(company: CompanyResearch, policy: ResearchPolicy): boolean {
  return company.actions_taken === 0 && policy.maxActions > 0 && !company.sources.some((source) => source.kind === "page");
}

export function summarizeResearch(companies: CompanyResearch[], top = 5): NewsletterResearchResult {
  const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const shortlist = companies.filter((company) => company.verdict === "pursue" && company.status === "stopped")
    .sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]
      || Number(b.criteria.design_gap.status === "supported") - Number(a.criteria.design_gap.status === "supported")
      || Number(b.criteria.company_size.status === "supported") - Number(a.criteria.company_size.status === "supported")
      || a.company.localeCompare(b.company)).slice(0, top);
  return { schemaVersion: 2, companies, shortlist, counts: {
    detected: companies.length, completed: companies.filter((company) => company.status === "stopped").length,
    potentiallyRelevant: companies.filter((company) => company.verdict !== "pass").length,
    worthInvestigating: companies.filter((company) => company.verdict === "pursue").length,
  } };
}

export async function investigateCompany(company: CompanyResearch, profile: NewsletterProfile, options: ResearchOptions = {}): Promise<CompanyResearch> {
  const policy = researchPolicySchema.parse(options.policy || {});
  const tools = options.tools || createNewsletterResearchTools({ ai: options.ai });
  const state = structuredClone(company);
  state.status = "investigating";
  let failures = 0;
  // A final model assessment always sees the last tool result, including at the action ceiling.
  for (let turn = 0; turn <= policy.maxActions; turn++) {
    try {
      options.onProgress?.(`${state.company}: assessing evidence (${state.actions_taken}/${policy.maxActions} actions)`);
      const decision = await validatedNewsletterCompletion(newsletterResearchPrompt(state, profile, policy),
        { ...options.ai, format: researchDecisionFormat, maxTokens: 7000, timeoutMs: 90_000 },
        (response) => parseResearchDecision(response, state, policy), options);
      const belief = beliefSchema.strip().parse(decision);
      const previous = state.research_history.at(-1);
      if (previous && !previous.after) previous.after = structuredClone(belief);
      Object.assign(state, belief);
      const entry = {
        step: state.research_history.length + 1, at: new Date().toISOString(),
        decision: { action: decision.action, target_url: decision.target_url, key_uncertainty: decision.key_uncertainty, expected_information_gain: decision.expected_information_gain, worth_taking: decision.worth_taking, decision_reason: decision.decision_reason },
        before: structuredClone(belief), after: null as ResearchBelief | null, source_ids: [] as string[], outcome: "", error: null as string | null,
      };
      state.research_history.push(entry);
      if (decision.action === "stop") {
        state.status = "stopped";
        state.stop_reason = `${decision.stop_reason}: ${decision.decision_reason}`;
        entry.outcome = state.stop_reason;
        entry.after = structuredClone(belief);
        break;
      }
      state.actions_taken++;
      options.onProgress?.(`${state.company}: ${decision.action} (${state.actions_taken}/${policy.maxActions}). ${decision.key_uncertainty}`);
      await options.onCheckpoint?.(summarizeResearch([state], options.top));
      try {
        const result = await tools.execute(decision.action, decision.target_url, structuredClone(state));
        for (const document of result.sources) {
          const existing = state.sources.find((source) => source.kind === document.kind && source.url === document.url && source.text === document.text);
          if (existing) { entry.source_ids.push(existing.id); continue; }
          const id = `research-${state.sources.length + 1}`;
          state.sources.push({ ...document, id, retrieved_at: new Date().toISOString() });
          entry.source_ids.push(id);
        }
        state.available_urls = safeLinks([...result.links, ...state.available_urls]);
        entry.outcome = result.note;
        failures = 0;
      } catch (error) {
        entry.error = error instanceof Error ? error.message : "Research action failed.";
        entry.outcome = "No evidence gathered. The failure is not evidence against the company.";
        state.unknowns = [...new Set([...state.unknowns, entry.error])].slice(0, 12);
        failures++;
      }
      await options.onCheckpoint?.(summarizeResearch([state], options.top));
      if (failures >= 2) { state.stop_reason = "information_unavailable: two consecutive research actions failed; unresolved uncertainties remain."; break; }
    } catch (error) {
      state.stop_reason = `assessment_failed: ${error instanceof Error ? error.message : "The model assessment failed."}`;
      break;
    }
  }
  if (state.status !== "stopped") {
    state.status = "stopped";
    state.stop_reason ||= "budget_reached: research action ceiling reached.";
    // Failed final assessment must never preserve an optimistic, stale shortlist decision.
    state.confidence = "LOW";
    if (state.verdict === "pursue") state.verdict = "watch";
    state.unknowns = [...new Set([...state.unknowns, "The last research evidence could not be fully assessed; review the history."])].slice(0, 12);
    const belief = beliefSchema.strip().parse(state);
    state.research_history.push({ step: state.research_history.length + 1, at: new Date().toISOString(),
      decision: { action: "stop", target_url: "", key_uncertainty: "Research or assessment could not continue within the available limits.", expected_information_gain: "Further automatic calls are not justified after the failure or budget ceiling.", worth_taking: false, decision_reason: state.stop_reason },
      before: structuredClone(belief), after: structuredClone(belief), source_ids: [], outcome: state.stop_reason, error: state.stop_reason.startsWith("assessment_failed") ? state.stop_reason : null,
    });
  }
  await options.onCheckpoint?.(summarizeResearch([state], options.top));
  return state;
}

export async function researchNewsletter(source: NewsletterSource, profile: NewsletterProfile, options: ResearchOptions = {}): Promise<NewsletterResearchResult> {
  newsletterProfileSchema.parse(profile);
  const policy = researchPolicySchema.parse(options.policy || {});
  const top = options.top ?? 5;
  if (!Number.isInteger(top) || top < 1 || top > 100) throw new Error("Shortlist size must be from 1 to 100.");
  const discovered = await extractNewsletterCompanies(source.text, options);
  const companies = discovered.map((company) => initialCompanyResearch(company, source));
  const checkpoint = async () => { await options.onCheckpoint?.(summarizeResearch(companies, top)); };
  await checkpoint();
  for (const [index, company] of companies.entries()) {
    options.onProgress?.(`Investigating company ${index + 1}/${companies.length}: ${company.company}`);
    companies[index] = await investigateCompany(company, profile, { ...options, policy, onCheckpoint: async (partial) => { companies[index] = partial.companies[0]; await checkpoint(); } });
    await checkpoint();
  }
  return summarizeResearch(companies, top);
}
