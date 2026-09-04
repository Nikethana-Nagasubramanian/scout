import { db, getSetting, setSetting } from "@/lib/database";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_BUDGET_DOLLARS = 10;
const WARNING_THRESHOLD = 0.8;
const RESULTS_PER_QUERY = 10;
const PUBLISHED_WITHIN_DAYS = 30;
const HIGHLIGHT_MAX_CHARACTERS = 1_500;
// A query that keeps coming back empty is rotated down rather than dropped, so it still gets
// an occasional look without spending a slot every day.
const ROTATION_AFTER_ZERO_RUNS = 3;
const MAX_ROTATION_MULTIPLIER = 4;

// Domain filtering belongs in this request parameter, not in the query text. Exa is semantic,
// so keyword operators in the query would only make the search worse.
export const EXA_ATS_DOMAINS = [
  "jobs.ashbyhq.com",
  "jobs.lever.co",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
];

export type ExaBudgetState = "ok" | "warning" | "exhausted";

export interface ExaBudgetStatus {
  budget: number;
  used: number;
  remaining: number;
  fraction: number;
  state: ExaBudgetState;
  exhaustedReason: string;
}

export interface ExaQueryRow {
  id: number;
  query: string;
  kind: "ats_daily" | "open_weekly";
  enabled: number;
  minimum_interval_minutes: number;
  last_run_at: string | null;
  last_result_count: number;
  consecutive_zero_runs: number;
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

/** Queries that keep returning nothing are backed off, not disabled. */
export function effectiveIntervalMinutes(query: Pick<ExaQueryRow, "minimum_interval_minutes" | "consecutive_zero_runs">): number {
  if (query.consecutive_zero_runs < ROTATION_AFTER_ZERO_RUNS) return query.minimum_interval_minutes;
  const extraRounds = query.consecutive_zero_runs - ROTATION_AFTER_ZERO_RUNS + 1;
  return query.minimum_interval_minutes * Math.min(MAX_ROTATION_MULTIPLIER, 1 + extraRounds);
}

export function isQueryDue(query: ExaQueryRow, now = Date.now()): boolean {
  if (!query.enabled) return false;
  if (!query.last_run_at) return true;
  const lastRun = new Date(`${query.last_run_at.replace(" ", "T")}Z`).getTime();
  if (!Number.isFinite(lastRun)) return true;
  return now - lastRun >= effectiveIntervalMinutes(query) * 60_000;
}

/** The 24 hour cache the plan calls for is simply the query cadence, enforced here. */
export function dueExaQueries(now = Date.now()): ExaQueryRow[] {
  const rows = db.prepare("SELECT * FROM exa_queries WHERE enabled = 1 ORDER BY kind, id").all() as ExaQueryRow[];
  return rows.filter((row) => isQueryDue(row, now));
}

export function recordQueryRun(queryId: number, resultCount: number): void {
  db.prepare(`
    UPDATE exa_queries SET
      last_run_at = CURRENT_TIMESTAMP,
      last_result_count = ?,
      consecutive_zero_runs = CASE WHEN ? > 0 THEN 0 ELSE consecutive_zero_runs + 1 END
    WHERE id = ?
  `).run(resultCount, resultCount, queryId);
}

export function publishedAfterDate(now = Date.now()): string {
  return new Date(now - PUBLISHED_WITHIN_DAYS * 86_400_000).toISOString();
}

export interface ExaResult {
  url: string;
  title: string;
  publishedAt: string | null;
  highlights: string[];
}

export interface ExaSearchOutcome {
  results: ExaResult[];
  costDollars: number;
  exhausted: boolean;
  error: string;
}

interface ExaResponseResult {
  url?: string;
  title?: string;
  publishedDate?: string;
  highlights?: string[];
}

interface ExaResponse {
  results?: ExaResponseResult[];
  costDollars?: { total?: number };
}

export async function searchExa(
  query: string,
  options: { includeDomains?: string[]; now?: number; signal?: AbortSignal } = {},
): Promise<ExaSearchOutcome> {
  const apiKey = cleanEnvironmentValue(process.env.EXA_API_KEY);
  if (!apiKey) return { results: [], costDollars: 0, exhausted: false, error: "EXA_API_KEY is not set." };

  const body: Record<string, unknown> = {
    // "auto" deliberately, never a deep search variant: deep costs more and buys nothing here.
    type: "auto",
    query,
    numResults: RESULTS_PER_QUERY,
    startPublishedDate: publishedAfterDate(options.now),
    contents: { highlights: { maxCharacters: HIGHLIGHT_MAX_CHARACTERS } },
  };
  if (options.includeDomains?.length) body.includeDomains = options.includeDomains;

  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
    signal: options.signal ?? AbortSignal.timeout(20_000),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    // 402 and these codes mean the account is out of credit, which is different from a
    // transient failure: Scout should stop asking and say so plainly.
    const exhausted = response.status === 402
      || /NO_MORE_CREDITS|API_KEY_BUDGET_EXCEEDED|TEAM_BUDGET_EXCEEDED/i.test(responseBody);
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
      highlights: result.highlights || [],
    }))
    .filter((result) => result.url.length > 0);

  return { results, costDollars, exhausted: false, error: "" };
}

/** Strips tracking and fragment noise so the same posting is not processed twice. */
export function canonicalJobUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^gh_src$|^ref$|^source$/i.test(key)) url.searchParams.delete(key);
    }
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.hostname.replace(/^www\./, "")}${path}${url.search}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}
