import { getSetting, setSetting } from "@/lib/database";
import { broadDiscoverySearchTitles } from "@/lib/job-fit";
import type { CandidateProfile } from "@/lib/types";
import { parseList } from "@/lib/utils";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_BUDGET_DOLLARS = 10;
const WARNING_THRESHOLD = 0.8;
const RESULTS_PER_QUERY = 10;
const MAX_QUERIES_PER_RUN = 4;

export type ExaBudgetState = "ok" | "warning" | "exhausted";

export interface ExaBudgetStatus {
  budget: number;
  used: number;
  remaining: number;
  fraction: number;
  state: ExaBudgetState;
  exhaustedReason: string;
}

function cleanEnvironmentValue(value: string | undefined): string {
  return (value || "").trim().replace(/^["']|["']$/g, "");
}

export function exaConfigured(): boolean {
  return cleanEnvironmentValue(process.env.EXA_API_KEY).length > 0;
}

export function exaBudgetStatus(): ExaBudgetStatus {
  const budget = Math.max(0, Number(getSetting("exa_budget_dollars", String(DEFAULT_BUDGET_DOLLARS))) || DEFAULT_BUDGET_DOLLARS);
  const used = Math.max(0, Number(getSetting("exa_spend_dollars", "0")) || 0);
  const exhaustedReason = getSetting("exa_exhausted_reason", "");
  const fraction = budget > 0 ? used / budget : 1;
  // Exa itself is the authority on whether credit remains, so a reported exhaustion always
  // wins over the local tally. The local budget only decides when to start warning.
  const state: ExaBudgetState = exhaustedReason
    ? "exhausted"
    : fraction >= WARNING_THRESHOLD ? "warning" : "ok";
  return {
    budget,
    used: Number(used.toFixed(4)),
    remaining: Math.max(0, Number((budget - used).toFixed(4))),
    fraction,
    state,
    exhaustedReason,
  };
}

export function recordExaSpend(costDollars: number): void {
  if (!Number.isFinite(costDollars) || costDollars <= 0) return;
  const used = Math.max(0, Number(getSetting("exa_spend_dollars", "0")) || 0);
  setSetting("exa_spend_dollars", String(Number((used + costDollars).toFixed(6))));
}

export function markExaExhausted(reason: string): void {
  setSetting("exa_exhausted_reason", reason);
}

export function clearExaExhausted(): void {
  setSetting("exa_exhausted_reason", "");
}

/**
 * Queries aimed at the candidate's actual craft rather than generic job-board phrasing,
 * so results lean toward company career pages instead of aggregator listings.
 */
export function companyDiscoveryQueries(profile: CandidateProfile): string[] {
  const titles = broadDiscoverySearchTitles(profile).slice(0, 2);
  const location = parseList(profile.preferred_locations)[0] || "United States";
  const queries = titles.flatMap((title) => [
    `startup careers page hiring a ${title} in ${location}`,
    `company job board now hiring ${title}`,
  ]);
  return [...new Set(queries)].slice(0, MAX_QUERIES_PER_RUN);
}

export interface ExaCompanyResult {
  url: string;
  title: string;
  publishedAt: string | null;
}

export interface ExaSearchOutcome {
  results: ExaCompanyResult[];
  costDollars: number;
  exhausted: boolean;
  error: string;
}

interface ExaResponseResult {
  url?: string;
  title?: string;
  publishedDate?: string;
}

interface ExaResponse {
  results?: ExaResponseResult[];
  costDollars?: { total?: number };
}

export async function searchCompanies(query: string, signal?: AbortSignal): Promise<ExaSearchOutcome> {
  const apiKey = cleanEnvironmentValue(process.env.EXA_API_KEY);
  if (!apiKey) return { results: [], costDollars: 0, exhausted: false, error: "EXA_API_KEY is not set." };

  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: "auto",
      category: "company",
      numResults: RESULTS_PER_QUERY,
    }),
    signal: signal ?? AbortSignal.timeout(20_000),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // 402 and these codes mean the account is out of credit, which is different from a
    // transient failure: Scout should stop asking and say so plainly.
    const exhausted = response.status === 402
      || /NO_MORE_CREDITS|API_KEY_BUDGET_EXCEEDED|TEAM_BUDGET_EXCEEDED/i.test(body);
    const error = exhausted
      ? `Exa credits are exhausted (HTTP ${response.status}).`
      : `Exa search failed with status ${response.status}.`;
    if (exhausted) markExaExhausted(error);
    return { results: [], costDollars: 0, exhausted, error };
  }

  const payload = await response.json() as ExaResponse;
  const costDollars = Number(payload.costDollars?.total) || 0;
  recordExaSpend(costDollars);
  clearExaExhausted();

  const results = (payload.results || [])
    .map((result) => ({
      url: (result.url || "").trim(),
      title: (result.title || "").trim(),
      publishedAt: result.publishedDate || null,
    }))
    .filter((result) => result.url.length > 0);

  return { results, costDollars, exhausted: false, error: "" };
}
