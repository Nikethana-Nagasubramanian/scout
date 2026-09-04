import { db, getSetting } from "@/lib/database";
import {
  detectAtsBoardFromUrl,
  detectAtsBoardsFromHtml,
  extractCareerPageLinks,
  extractCompanyLinks,
  extractConsiderAtsBoards,
  extractGetroAtsBoards,
  extractHiringCafeAtsBoards,
  extractHiringCafeJobs,
  type DetectedAtsBoard,
} from "@/lib/ats-discovery";
import {
  fetchGmailAlertJobs,
  gmailConfiguration,
  markGmailMessagesProcessed,
  parseHiringNewsletterSignals,
} from "@/lib/gmail-alerts";
import {
  canonicalJobUrl,
  dueExaQueries,
  EXA_ATS_DOMAINS,
  exaBudgetStatus,
  exaConfigured,
  recordQueryRun,
  searchExa,
} from "@/lib/exa-discovery";
import { reconcileDuplicateJobs } from "@/lib/job-deduplication";
import {
  assessJobEligibility,
  broadDiscoverySearchTitles,
  classifyRoleFamily,
  type JobFitPreferences,
} from "@/lib/job-fit";
import { buildConfidenceSummary, buildMatchSummary, scoreJob, scorePostingConfidence } from "@/lib/scoring";
import type {
  CandidateProfile,
  CompanyDiscoverySource,
  DiscoverySource,
  EligibilityStatus,
  Job,
  JobSource,
  WorkflowLogLevel,
} from "@/lib/types";
import { parseList, stripHtml } from "@/lib/utils";

const REQUEST_COOLDOWN_MS = 250;
const MAX_REQUEST_ATTEMPTS = 3;
const MAX_INLINE_RETRY_MS = 30_000;
const SOURCE_CONCURRENCY = 4;
// Reserved start time for the next request to a host. Slots are claimed synchronously so
// concurrent callers space themselves out instead of all waking against a single timestamp.
const hostNextRequestAt = new Map<string, number>();

export const sourceTiers = ["watchlist", "standard", "dormant"] as const;
export type SourceTier = (typeof sourceTiers)[number];

// How long a board rests after a successful check. Boards that keep producing relevant
// roles are checked every run; ones that never do fall back to a weekly look.
export const tierIntervalMinutes: Record<SourceTier, number> = {
  watchlist: 60,
  standard: 1_440,
  dormant: 10_080,
};

const DEMOTE_TO_STANDARD_AFTER = 3;
const DEMOTE_TO_DORMANT_AFTER = 8;

export function nextSourceTier(currentTier: string, consecutiveZeroRuns: number, eligibleCount: number): {
  tier: SourceTier;
  consecutiveZeroRuns: number;
} {
  // Any genuinely relevant role promotes the board back to the frequent watchlist.
  if (eligibleCount > 0) return { tier: "watchlist", consecutiveZeroRuns: 0 };
  const zeroRuns = consecutiveZeroRuns + 1;
  if (zeroRuns >= DEMOTE_TO_DORMANT_AFTER) return { tier: "dormant", consecutiveZeroRuns: zeroRuns };
  if (zeroRuns >= DEMOTE_TO_STANDARD_AFTER) return { tier: "standard", consecutiveZeroRuns: zeroRuns };
  const tier = sourceTiers.includes(currentTier as SourceTier) ? currentTier as SourceTier : "standard";
  return { tier, consecutiveZeroRuns: zeroRuns };
}

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

type RequestLogger = (
  step: string,
  level: WorkflowLogLevel,
  message: string,
  details?: Record<string, unknown>,
  durationMs?: number,
) => void;

class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

export interface NormalizedJob {
  sourceName?: string;
  sourceType?: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  workplaceType: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  description: string;
  canonicalUrl: string;
  applyUrl: string;
  postedAt: string | null;
}

function currentFitPreferences(): JobFitPreferences {
  const minimumExperience = Number(getSetting("search_experience_min", "2"));
  const maximumExperience = Number(getSetting("search_experience_max", "5"));
  const maximumAgeDays = Number(getSetting("search_max_age_days", "60"));
  return {
    usaOnly: getSetting("search_usa_only", "1") === "1",
    minimumExperience: Number.isFinite(minimumExperience) ? Math.max(0, minimumExperience) : 2,
    maximumExperience: Number.isFinite(maximumExperience)
      ? Math.max(Number.isFinite(minimumExperience) ? minimumExperience : 2, maximumExperience)
      : 5,
    maximumAgeDays: Number.isFinite(maximumAgeDays) ? Math.max(1, maximumAgeDays) : 60,
  };
}

function filterCollectedJobs(
  jobs: NormalizedJob[],
  profile: CandidateProfile,
  preferences: JobFitPreferences,
): {
  evaluatedJobs: Array<{ job: NormalizedJob; status: EligibilityStatus; reasons: string[] }>;
  eligibleCount: number;
  needsVerificationCount: number;
  filteredCount: number;
  reasonCounts: Record<string, number>;
} {
  const evaluatedJobs: Array<{ job: NormalizedJob; status: EligibilityStatus; reasons: string[] }> = [];
  const reasonCounts: Record<string, number> = {};
  for (const job of jobs) {
    const assessment = assessJobEligibility({
      title: job.title,
      location: job.location,
      description: job.description,
      workplaceType: job.workplaceType,
      postedAt: job.postedAt,
      firstSeenAt: new Date().toISOString(),
    }, profile, preferences);
    const reasons = [...assessment.filterReasons, ...assessment.verificationReasons];
    evaluatedJobs.push({ job, status: assessment.status, reasons });
    for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  return {
    evaluatedJobs,
    eligibleCount: evaluatedJobs.filter((item) => item.status === "eligible").length,
    needsVerificationCount: evaluatedJobs.filter((item) => item.status === "needs_verification").length,
    filteredCount: evaluatedJobs.filter((item) => item.status === "filtered").length,
    reasonCounts,
  };
}

interface GreenhouseJob {
  id: number;
  title: string;
  updated_at?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  metadata?: Array<{ name?: string; value?: unknown }>;
}

interface LeverJob {
  id: string;
  text: string;
  categories?: {
    location?: string;
    commitment?: string;
    team?: string;
    department?: string;
    allLocations?: string[];
  };
  descriptionPlain?: string;
  openingPlain?: string;
  additionalPlain?: string;
  hostedUrl: string;
  applyUrl: string;
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string };
}

interface AshbyJob {
  title: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  employmentType?: string;
  jobUrl: string;
  applyUrl: string;
  compensation?: {
    summaryComponents?: Array<{
      compensationType?: string;
      interval?: string;
      currencyCode?: string | null;
      minValue?: number | null;
      maxValue?: number | null;
    }>;
  };
}

interface RemotiveJob {
  id: number | string;
  url: string;
  title: string;
  company_name: string;
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

interface JobicyJob {
  id: number | string;
  url: string;
  jobTitle: string;
  companyName: string;
  jobType?: string;
  jobGeo?: string;
  jobLevel?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  pubDate?: string;
  salaryMin?: number | string | null;
  salaryMax?: number | string | null;
  annualSalaryMin?: number | string | null;
  annualSalaryMax?: number | string | null;
  salaryCurrency?: string;
}

interface HimalayasJob {
  guid: string;
  title: string;
  companyName: string;
  employmentType?: string;
  locationRestrictions?: Array<{ name?: string; alpha2?: string }>;
  seniority?: string[];
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string;
  description?: string;
  excerpt?: string;
  pubDate?: number;
  applicationLink: string;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

export function retryDelay(attempt: number): number {
  return Math.min(MAX_INLINE_RETRY_MS, 1_000 * 2 ** Math.max(0, attempt - 1));
}

async function respectHostCooldown(url: string, log: RequestLogger): Promise<void> {
  const host = new URL(url).host;
  const now = Date.now();
  const startAt = Math.max(now, hostNextRequestAt.get(host) || 0);
  hostNextRequestAt.set(host, startAt + REQUEST_COOLDOWN_MS);
  const waitMs = startAt - now;
  if (waitMs > 0) {
    log("request.cooldown", "info", `Waiting ${waitMs} ms before the next ${host} request.`, { host, waitMs });
    await sleep(waitMs);
  }
}

async function fetchWithRetry(url: string, log: RequestLogger, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    await respectHostCooldown(url, log);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "User-Agent": "ScoutJobSearch/0.1", ...(init.headers || {}) },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      const durationMs = Date.now() - startedAt;
      if (response.ok) {
        log("request.success", "success", `API request returned ${response.status}.`, { url, attempt, status: response.status }, durationMs);
        return response;
      }

      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const retryable = response.status === 429 || response.status >= 500;
      log(
        "request.response",
        retryable ? "warning" : "error",
        `API request returned ${response.status}.`,
        { url, attempt, status: response.status, retryAfterMs },
        durationMs,
      );

      if (!retryable || attempt === MAX_REQUEST_ATTEMPTS) {
        throw new HttpRequestError(`Request failed with status ${response.status}`, response.status, retryAfterMs);
      }

      const waitMs = retryAfterMs ?? retryDelay(attempt);
      if (waitMs > MAX_INLINE_RETRY_MS) {
        throw new HttpRequestError(
          `Rate limited for approximately ${Math.ceil(waitMs / 1_000)} seconds`,
          response.status,
          waitMs,
        );
      }
      log("request.retry", "warning", `Retrying after ${waitMs} ms.`, { url, attempt, waitMs });
      await sleep(waitMs);
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      lastError = error;
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Unknown network error";
      log("request.network_error", "warning", message, { url, attempt }, durationMs);
      if (attempt === MAX_REQUEST_ATTEMPTS) break;
      const waitMs = retryDelay(attempt);
      log("request.retry", "warning", `Retrying after ${waitMs} ms.`, { url, attempt, waitMs });
      await sleep(waitMs);
    }
  }
  const message = lastError instanceof Error ? lastError.message : "Request failed after all retries";
  throw new HttpRequestError(message, null, null);
}

async function fetchJson<T>(url: string, log: RequestLogger): Promise<T> {
  const response = await fetchWithRetry(url, log);
  return response.json() as Promise<T>;
}

async function postJson<T>(
  url: string,
  body: unknown,
  log: RequestLogger,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetchWithRetry(url, log, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<T>;
}

export function cookieHeaderFromSetCookies(setCookies: string[]): string {
  return setCookies
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function responseCookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() || [];
  return cookieHeaderFromSetCookies(setCookies);
}

export function considerRequestHeaders(sourceUrl: string, csrfToken: string, cookieHeader: string): Record<string, string> {
  const source = new URL(sourceUrl);
  return {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    Origin: source.origin,
    Referer: sourceUrl,
    "X-CSRF-Token": csrfToken,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
}

async function fetchHtml(
  url: string,
  log: RequestLogger,
  headers: Record<string, string> = {},
): Promise<{ finalUrl: string; html: string; cookieHeader: string }> {
  const response = await fetchWithRetry(url, log, { headers });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new HttpRequestError("The page did not return HTML.", response.status, null);
  }
  return {
    finalUrl: response.url || url,
    html: await response.text(),
    cookieHeader: responseCookieHeader(response),
  };
}

export function normalizeGreenhouseJobs(source: JobSource, jobs: GreenhouseJob[]): NormalizedJob[] {
  return jobs.map((job) => ({
    externalId: String(job.id),
    company: source.name,
    title: job.title,
    location: job.location?.name || "",
    workplaceType: /remote/i.test(job.location?.name || "") ? "remote" : "unspecified",
    employmentType: "",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: "",
    description: stripHtml(job.content || ""),
    canonicalUrl: job.absolute_url,
    applyUrl: job.absolute_url,
    postedAt: job.updated_at || null,
  }));
}

export function normalizeLeverJobs(source: JobSource, jobs: LeverJob[]): NormalizedJob[] {
  return jobs.map((job) => ({
    externalId: job.id,
    company: source.name,
    title: job.text,
    location: job.categories?.allLocations?.join(", ") || job.categories?.location || "",
    workplaceType: job.workplaceType || "unspecified",
    employmentType: job.categories?.commitment || "",
    salaryMin: job.salaryRange?.min || null,
    salaryMax: job.salaryRange?.max || null,
    salaryCurrency: job.salaryRange?.currency || "",
    description: [job.openingPlain, job.descriptionPlain, job.additionalPlain].filter(Boolean).join("\n\n"),
    canonicalUrl: job.hostedUrl,
    applyUrl: job.applyUrl,
    postedAt: null,
  }));
}

export function normalizeAshbyJobs(source: JobSource, jobs: AshbyJob[]): NormalizedJob[] {
  return jobs
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const locations = [
        job.location,
        ...(job.secondaryLocations || []).map((location) => location.location),
      ].filter((location): location is string => Boolean(location));
      const salary = job.compensation?.summaryComponents?.find((component) => (
        component.compensationType === "Salary" && component.interval === "1 YEAR"
      ));
      const jobUrlParts = new URL(job.jobUrl).pathname.split("/").filter(Boolean);
      return {
        externalId: jobUrlParts.at(-1) || job.applyUrl,
        company: source.name,
        title: job.title,
        location: [...new Set(locations)].join(", "),
        workplaceType: job.workplaceType?.toLowerCase() || (job.isRemote ? "remote" : "unspecified"),
        employmentType: job.employmentType || "",
        salaryMin: salary?.minValue ?? null,
        salaryMax: salary?.maxValue ?? null,
        salaryCurrency: salary?.currencyCode || "",
        description: job.descriptionPlain || stripHtml(job.descriptionHtml || ""),
        canonicalUrl: job.jobUrl,
        applyUrl: job.applyUrl,
        postedAt: job.publishedAt || null,
      };
    });
}

export function normalizeRemotiveJobs(jobs: RemotiveJob[]): NormalizedJob[] {
  return jobs.map((job) => ({
    externalId: String(job.id),
    company: job.company_name,
    title: job.title,
    location: job.candidate_required_location || "Remote",
    workplaceType: "remote",
    employmentType: job.job_type || "",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: "",
    description: stripHtml(job.description || ""),
    canonicalUrl: job.url,
    applyUrl: job.url,
    postedAt: job.publication_date || null,
  }));
}

function optionalNumber(value: number | string | null | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeJobicyJobs(jobs: JobicyJob[]): NormalizedJob[] {
  return jobs.map((job) => ({
    externalId: String(job.id),
    company: job.companyName,
    title: job.jobTitle,
    location: job.jobGeo || "Remote",
    workplaceType: "remote",
    employmentType: job.jobType || "",
    salaryMin: optionalNumber(job.salaryMin ?? job.annualSalaryMin),
    salaryMax: optionalNumber(job.salaryMax ?? job.annualSalaryMax),
    salaryCurrency: job.salaryCurrency || "",
    description: `${job.jobLevel ? `Seniority: ${job.jobLevel}\n\n` : ""}${stripHtml(job.jobDescription || job.jobExcerpt || "")}`,
    canonicalUrl: job.url,
    applyUrl: job.url,
    postedAt: job.pubDate || null,
  }));
}

export function normalizeHimalayasJobs(jobs: HimalayasJob[]): NormalizedJob[] {
  return jobs.map((job) => {
    const annualSalary = !job.salaryPeriod || job.salaryPeriod === "annual";
    const seniority = job.seniority?.length ? `Seniority: ${job.seniority.join(", ")}\n\n` : "";
    return {
      externalId: job.guid,
      company: job.companyName,
      title: job.title,
      location: job.locationRestrictions?.map((location) => location.name || location.alpha2).filter(Boolean).join(", ") || "Worldwide",
      workplaceType: "remote",
      employmentType: job.employmentType || "",
      salaryMin: annualSalary ? job.minSalary ?? null : null,
      salaryMax: annualSalary ? job.maxSalary ?? null : null,
      salaryCurrency: job.currency || "",
      description: `${seniority}${stripHtml(job.description || job.excerpt || "")}`,
      canonicalUrl: job.applicationLink,
      applyUrl: job.applicationLink,
      postedAt: job.pubDate ? new Date(job.pubDate).toISOString() : null,
    };
  });
}

export function normalizeHiringCafeJobs(html: string): NormalizedJob[] {
  return extractHiringCafeJobs(html).map((job) => ({
    externalId: job.externalId,
    company: job.company,
    title: job.title,
    location: job.location,
    workplaceType: job.workplaceType,
    employmentType: job.employmentType,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    description: job.description,
    canonicalUrl: job.applyUrl,
    applyUrl: job.applyUrl,
    postedAt: job.postedAt,
  }));
}

function discoveryQuery(profile: CandidateProfile, cursor = 0): string {
  const titles = broadDiscoverySearchTitles(profile);
  return titles.length ? titles[cursor % titles.length] : profile.target_seniority || "professional";
}

function jobicyGeo(profile: CandidateProfile): string {
  const location = [...parseList(profile.preferred_locations), profile.home_location].join(" ").toLowerCase();
  if (/\b(canada|canadian)\b/.test(location)) return "canada";
  if (/\b(united kingdom|uk|england|scotland|wales)\b/.test(location)) return "uk";
  if (/\b(india|indian)\b/.test(location)) return "india";
  if (/\b(australia|australian)\b/.test(location)) return "australia";
  if (/\b(germany|german)\b/.test(location)) return "germany";
  if (/\b(united states|usa|u\.s\.|us)\b/.test(location) || /,\s*[a-z]{2}\b/.test(location)) return "usa";
  return "";
}

function countryCode(profile: CandidateProfile): string {
  const geo = jobicyGeo(profile);
  const codes: Record<string, string> = {
    usa: "US",
    canada: "CA",
    uk: "GB",
    india: "IN",
    australia: "AU",
    germany: "DE",
  };
  return codes[geo] || "";
}

function himalayasSeniority(profile: CandidateProfile): string {
  const value = profile.target_seniority.toLowerCase();
  if (value.includes("junior") || value.includes("entry")) return "Entry-level";
  if (value.includes("mid")) return "Mid-level";
  if (value.includes("senior") || value.includes("staff") || value.includes("lead")) return "Senior";
  if (value.includes("manager")) return "Manager";
  if (value.includes("director")) return "Director";
  return "";
}

export async function fetchDiscoverySource(
  source: DiscoverySource,
  profile: CandidateProfile,
  log: RequestLogger = () => undefined,
): Promise<NormalizedJob[]> {
  const query = discoveryQuery(profile, source.query_cursor);
  if (source.key === "remotive") {
    const parameters = new URLSearchParams({ search: query, limit: "100" });
    const payload = await fetchJson<{ jobs?: RemotiveJob[] }>(`https://remotive.com/api/remote-jobs?${parameters}`, log);
    return normalizeRemotiveJobs(payload.jobs || []);
  }

  if (source.key === "jobicy") {
    const parameters = new URLSearchParams({ count: "100", tag: query });
    const geo = jobicyGeo(profile);
    if (geo) parameters.set("geo", geo);
    const payload = await fetchJson<{ jobs?: JobicyJob[] }>(`https://jobicy.com/api/v2/remote-jobs?${parameters}`, log);
    return normalizeJobicyJobs(payload.jobs || []);
  }

  const parameters = new URLSearchParams({ q: query, sort: "recent" });
  const country = countryCode(profile);
  const seniority = himalayasSeniority(profile);
  if (country) parameters.set("country", country);
  if (seniority) parameters.set("seniority", seniority);
  const payload = await fetchJson<{ jobs?: HimalayasJob[] }>(`https://himalayas.app/jobs/api/search?${parameters}`, log);
  return normalizeHimalayasJobs(payload.jobs || []);
}

export async function fetchSource(source: JobSource, log: RequestLogger = () => undefined): Promise<NormalizedJob[]> {
  if (source.source_type === "greenhouse") {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.identifier)}/jobs?content=true`;
    const payload = await fetchJson<{ jobs: GreenhouseJob[] }>(url, log);
    return normalizeGreenhouseJobs(source, payload.jobs);
  }

  if (source.source_type === "ashby") {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.identifier)}?includeCompensation=true`;
    const payload = await fetchJson<{ jobs?: AshbyJob[] }>(url, log);
    return normalizeAshbyJobs(source, payload.jobs || []);
  }

  const base = source.identifier.startsWith("eu:") ? "https://api.eu.lever.co" : "https://api.lever.co";
  const identifier = source.identifier.replace(/^eu:/, "");
  const url = `${base}/v0/postings/${encodeURIComponent(identifier)}?mode=json`;
  const payload = await fetchJson<LeverJob[]>(url, log);
  return normalizeLeverJobs(source, payload);
}

function isSafePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost"
      || host === "::1"
      || host.endsWith(".local")
      || /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^169\.254\./.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function persistDetectedBoard(
  company: string,
  board: DetectedAtsBoard,
  discoveredVia?: { name: string; url: string },
): boolean {
  if (!/^[a-z0-9_-]{2,100}$/i.test(board.identifier)) return false;
  const result = db.prepare(`
    INSERT OR IGNORE INTO job_sources (
      name, source_type, identifier, enabled, auto_discovered, discovered_from_url,
      discovered_via_name, discovered_via_url
    ) VALUES (?, ?, ?, 1, 1, ?, ?, ?)
  `).run(
    company || board.identifier,
    board.sourceType,
    board.identifier,
    board.evidenceUrl,
    discoveredVia?.name || "",
    discoveredVia?.url || "",
  );
  if (result.changes === 0) {
    db.prepare(`
      UPDATE job_sources
      SET discovered_from_url = CASE WHEN discovered_from_url = '' THEN ? ELSE discovered_from_url END,
        discovered_via_name = CASE WHEN discovered_via_name = '' THEN ? ELSE discovered_via_name END,
        discovered_via_url = CASE WHEN discovered_via_url = '' THEN ? ELSE discovered_via_url END
      WHERE source_type = ? AND identifier = ?
    `).run(
      board.evidenceUrl,
      discoveredVia?.name || "",
      discoveredVia?.url || "",
      board.sourceType,
      board.identifier,
    );
  }
  return result.changes > 0;
}

function bootstrapDirectAtsBoardsFromJobs(): number {
  const jobs = db.prepare(`
    SELECT company, canonical_url, apply_url, source_name, source_type
    FROM jobs
    WHERE source_type NOT IN ('greenhouse', 'ashby', 'lever')
      AND status NOT IN ('irrelevant', 'dismissed', 'archived')
    ORDER BY last_seen_at DESC
    LIMIT 500
  `).all() as Array<Pick<Job, "company" | "canonical_url" | "apply_url" | "source_name" | "source_type">>;
  let added = 0;
  for (const job of jobs) {
    for (const url of [...new Set([job.apply_url, job.canonical_url].filter(Boolean))]) {
      const board = detectAtsBoardFromUrl(url);
      if (board && persistDetectedBoard(job.company, board, {
        name: job.source_name || job.source_type,
        url: job.canonical_url || job.apply_url,
      })) added += 1;
    }
  }
  return added;
}

async function detectBoardsOnPage(
  url: string,
  log: RequestLogger,
): Promise<{ boards: DetectedAtsBoard[]; html: string; finalUrl: string }> {
  const direct = detectAtsBoardFromUrl(url);
  if (direct) return { boards: [direct], html: "", finalUrl: url };
  if (!isSafePublicUrl(url)) return { boards: [], html: "", finalUrl: url };
  const page = await fetchHtml(url, log);
  const boards = new Map<string, DetectedAtsBoard>();
  const redirected = detectAtsBoardFromUrl(page.finalUrl);
  if (redirected) boards.set(`${redirected.sourceType}:${redirected.identifier}`, redirected);
  for (const board of detectAtsBoardsFromHtml(page.html, page.finalUrl)) {
    boards.set(`${board.sourceType}:${board.identifier}`, board);
  }
  return { boards: [...boards.values()], html: page.html, finalUrl: page.finalUrl };
}

export async function discoverOfficialBoardForJob(
  jobId: number,
  log: RequestLogger = () => undefined,
): Promise<DetectedAtsBoard[]> {
  const job = db.prepare(`
    SELECT id, company, canonical_url, apply_url, source_name, source_type
    FROM jobs
    WHERE id = ?
  `).get(jobId) as Pick<Job, "id" | "company" | "canonical_url" | "apply_url" | "source_name" | "source_type"> | undefined;
  if (!job || ["greenhouse", "ashby", "lever"].includes(job.source_type)) return [];

  const boards = new Map<string, DetectedAtsBoard>();
  const urls = [...new Set([job.apply_url, job.canonical_url].filter(Boolean))];
  for (const url of urls.slice(0, 2)) {
    try {
      const result = await detectBoardsOnPage(url, log);
      for (const board of result.boards) boards.set(`${board.sourceType}:${board.identifier}`, board);
      if (boards.size) break;
    } catch (error) {
      log(
        "ats.discovery_page_failed",
        "warning",
        `Could not inspect ${new URL(url).hostname} for an official ATS board.`,
        { jobId, url, error: error instanceof Error ? error.message : "Unknown discovery error" },
      );
    }
  }

  for (const board of boards.values()) persistDetectedBoard(job.company, board, {
    name: job.source_name || job.source_type,
    url: job.canonical_url || job.apply_url,
  });
  return [...boards.values()];
}

async function discoverBoardsFromCompanyLink(
  company: string,
  url: string,
  log: RequestLogger,
  discoveredVia?: { name: string; url: string },
): Promise<DetectedAtsBoard[]> {
  const boards = new Map<string, DetectedAtsBoard>();
  try {
    const page = await detectBoardsOnPage(url, log);
    for (const board of page.boards) boards.set(`${board.sourceType}:${board.identifier}`, board);
    if (!boards.size && page.html) {
      for (const careerUrl of extractCareerPageLinks(page.html, page.finalUrl).slice(0, 2)) {
        try {
          const careerPage = await detectBoardsOnPage(careerUrl, log);
          for (const board of careerPage.boards) boards.set(`${board.sourceType}:${board.identifier}`, board);
          if (boards.size) break;
        } catch (error) {
          log(
            "portfolio.career_page_failed",
            "warning",
            `Could not inspect a career page for ${company}.`,
            { company, careerUrl, error: error instanceof Error ? error.message : "Unknown discovery error" },
          );
        }
      }
    }
  } catch (error) {
    log(
      "portfolio.company_failed",
      "warning",
      `Could not inspect ${company} for an official ATS board.`,
      { company, url, error: error instanceof Error ? error.message : "Unknown discovery error" },
    );
  }
  for (const board of boards.values()) persistDetectedBoard(company, board, discoveredVia);
  return [...boards.values()];
}

const MAX_EXA_COMPANIES_PER_RUN = 8;

/**
 * A board identifier is a slug, but it becomes the company name on every job the board
 * produces, so it is worth presenting properly.
 */
export function companyNameFromIdentifier(identifier: string): string {
  return identifier
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function runExaDiscovery(runId: number): Promise<number> {
  const log: RequestLogger = (step, level, message, details, durationMs) => {
    writeWorkflowLog(runId, null, step, level, message, details, durationMs);
  };
  if (!exaConfigured()) {
    log("exa.skipped", "info", "Exa discovery is off because EXA_API_KEY is not set.", {});
    return 0;
  }
  const budgetBefore = exaBudgetStatus();
  if (budgetBefore.state === "exhausted") {
    log("exa.budget_exhausted", "warning", `Exa discovery is paused. ${budgetBefore.exhaustedReason}`, {
      spentDollars: budgetBefore.used,
      budgetDollars: budgetBefore.budget,
    });
    return 0;
  }

  const startedAt = Date.now();
  const queries = dueExaQueries();
  if (!queries.length) {
    log("exa.not_due", "info", "No Exa query is due yet. Each one runs at most once a day, and the open web query once a week.", {});
    return 0;
  }

  const seenUrls = new Set<string>();
  const companyCandidates = new Map<string, { url: string; title: string }>();
  let boardsAdded = 0;
  let spent = 0;
  let stoppedEarly = false;

  for (const query of queries) {
    const isAtsQuery = query.kind === "ats_daily";
    const outcome = await searchExa(query.query, {
      includeDomains: isAtsQuery ? EXA_ATS_DOMAINS : undefined,
    });
    spent += outcome.costDollars;
    if (outcome.error) {
      log(outcome.exhausted ? "exa.budget_exhausted" : "exa.search_failed", "warning", outcome.error, { query: query.query });
      if (outcome.exhausted) {
        stoppedEarly = true;
        break;
      }
      continue;
    }

    let usefulResults = 0;
    for (const result of outcome.results) {
      // Deduplicate by canonical URL before doing anything that costs a request.
      const canonical = canonicalJobUrl(result.url);
      if (seenUrls.has(canonical)) continue;
      seenUrls.add(canonical);
      usefulResults += 1;

      if (isAtsQuery) {
        // These results are job postings on known ATS hosts, so the board is already in the
        // URL and no crawling is needed to find it.
        const board = detectAtsBoardFromUrl(result.url);
        // The board covers the whole company, so name it after the board identifier rather
        // than the one job title Exa happened to return.
        if (board && persistDetectedBoard(companyNameFromIdentifier(board.identifier), board, {
          name: "Exa job search",
          url: result.url,
        })) boardsAdded += 1;
        continue;
      }

      try {
        const host = new URL(result.url).hostname.replace(/^www\./, "");
        if (!companyCandidates.has(host)) companyCandidates.set(host, { url: result.url, title: result.title || host });
      } catch {
        continue;
      }
    }

    recordQueryRun(query.id, usefulResults);
    log("exa.search_complete", "info", `Exa returned ${outcome.results.length} results for a ${isAtsQuery ? "daily ATS" : "weekly open web"} query.`, {
      query: query.query,
      kind: query.kind,
      results: outcome.results.length,
      newResults: usefulResults,
      costDollars: outcome.costDollars,
    });
  }

  // Only the open web query needs site inspection, and only for pages that are not already
  // an ATS board Scout can read directly.
  const inspecting = [...companyCandidates.values()].slice(0, MAX_EXA_COMPANIES_PER_RUN);
  for (const candidate of inspecting) {
    const boards = await discoverBoardsFromCompanyLink(candidate.title, candidate.url, log, {
      name: "Exa open web discovery",
      url: candidate.url,
    });
    boardsAdded += boards.length;
  }

  const budgetAfter = exaBudgetStatus();
  log(
    "exa.discovery_complete",
    budgetAfter.state === "ok" ? "success" : "warning",
    `Exa ran ${queries.length} ${queries.length === 1 ? "query" : "queries"}, saw ${seenUrls.size} unique results, inspected ${inspecting.length} company pages, and saved ${boardsAdded} official boards. Spent ${spent.toFixed(3)} dollars this run, ${budgetAfter.used.toFixed(2)} of ${budgetAfter.budget.toFixed(2)} total.`,
    {
      queriesRun: queries.length,
      uniqueResults: seenUrls.size,
      companiesInspected: inspecting.length,
      boardsAdded,
      runCostDollars: Number(spent.toFixed(4)),
      spentDollars: budgetAfter.used,
      budgetDollars: budgetAfter.budget,
      remainingDollars: budgetAfter.remaining,
      budgetState: budgetAfter.state,
      stoppedEarly,
    },
    Date.now() - startedAt,
  );
  return boardsAdded;
}

async function discoverBoardsFromRun(runId: number): Promise<number> {
  const candidates = db.prepare(`
    SELECT jobs.id
    FROM collection_job_results
    JOIN jobs ON jobs.id = collection_job_results.job_id
    WHERE collection_job_results.run_id = ?
      AND collection_job_results.classification IN ('eligible', 'needs_verification')
      AND jobs.source_type NOT IN ('greenhouse', 'ashby', 'lever')
    ORDER BY CASE collection_job_results.classification WHEN 'eligible' THEN 0 ELSE 1 END,
      CASE collection_job_results.outcome WHEN 'new' THEN 0 ELSE 1 END,
      jobs.score DESC,
      jobs.id DESC
    LIMIT 12
  `).all(runId) as Array<{ id: number }>;
  let discovered = 0;
  const log: RequestLogger = (step, level, message, details, durationMs) => {
    writeWorkflowLog(runId, null, step, level, message, details, durationMs);
  };
  for (const candidate of candidates) {
    const boards = await discoverOfficialBoardForJob(candidate.id, log);
    discovered += boards.length;
  }
  return discovered;
}

interface ConsiderAutocompleteResponse {
  results?: Array<{
    self?: {
      label?: string;
      value?: string;
    };
  }>;
}

interface ConsiderSearchResponse {
  jobs?: Array<{
    applyUrl?: string;
    companyName?: string;
    url?: string;
  }>;
}

async function fetchConsiderAtsBoards(
  sourceUrl: string,
  html: string,
  cookieHeader: string,
  log: RequestLogger,
): Promise<ReturnType<typeof extractConsiderAtsBoards>> {
  const board = html.match(/"fixedBoard":"([^"]+)"/)?.[1];
  const csrfToken = html.match(/"csrfToken":"([^"]+)"/)?.[1];
  const source = new URL(sourceUrl);
  const roleLabel = source.searchParams.get("jobTypes");
  if (!board || !roleLabel || !csrfToken) return [];
  const requestHeaders = considerRequestHeaders(sourceUrl, csrfToken, cookieHeader);
  const boardPayload = { id: board, isParent: true };
  const autocomplete = await postJson<ConsiderAutocompleteResponse>(
    `${source.origin}/api-boards/autocomplete/jobtypes`,
    {
      q: roleLabel,
      board: boardPayload,
      skipCompanyExcludes: false,
    },
    log,
    requestHeaders,
  );
  const role = autocomplete.results
    ?.map((result) => result.self)
    .find((result) => result?.label?.toLowerCase() === roleLabel.toLowerCase())
    || autocomplete.results?.[0]?.self;
  if (!role?.value) return [];
  const search = await postJson<ConsiderSearchResponse>(
    `${source.origin}/api-boards/search-jobs`,
    {
      meta: { size: 50 },
      board: boardPayload,
      query: { jobTypes: [role.value] },
      grouped: false,
      parentSlug: board,
    },
    log,
    requestHeaders,
  );
  return extractConsiderAtsBoards(search.jobs || []);
}

interface CompanyDiscoveryResult {
  boardsAdded: number;
  directJobs: NormalizedJob[];
}

async function runCompanyDiscoverySource(runId: number, source: CompanyDiscoverySource): Promise<CompanyDiscoveryResult> {
  const log: RequestLogger = (step, level, message, details, durationMs) => {
    writeWorkflowLog(runId, null, step, level, `${source.name}: ${message}`, details, durationMs);
  };
  const sourceHost = new URL(source.url).hostname;
  const considerRequest = sourceHost === "jobs.greylock.com";
  const page = await fetchHtml(source.url, log, considerRequest ? {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  } : {});
  const hiringCafeSource = new URL(source.url).hostname.endsWith("hiringcafe.com");
  const newsletterSource = new URL(source.url).hostname.endsWith("substack.com");
  const getroSource = /Powered by Getro|www\.getro\.com\/vc/i.test(page.html);
  const considerSource = /Powered by Consider|product\.consider\.com/i.test(page.html)
    || new URL(source.url).hostname === "jobs.greylock.com";
  const namedHiringCafeBoards = hiringCafeSource ? extractHiringCafeAtsBoards(page.html) : [];
  const newsletterSignals = newsletterSource
    ? parseHiringNewsletterSignals({
      html: page.html,
      text: stripHtml(page.html),
      subject: source.name,
      from: "Substack",
      date: null,
    })
    : [];
  if (newsletterSignals.length) {
    const saveSignal = db.prepare(`
      INSERT INTO gmail_hiring_signals (
        external_id, source_name, company, role_hint, location, signal_text, url, signal_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET
        source_name = excluded.source_name,
        company = excluded.company,
        role_hint = excluded.role_hint,
        location = excluded.location,
        signal_text = excluded.signal_text,
        url = excluded.url,
        signal_type = excluded.signal_type,
        last_seen_at = CURRENT_TIMESTAMP
    `);
    const saveSignals = db.transaction(() => {
      for (const signal of newsletterSignals) {
        saveSignal.run(
          signal.externalId,
          signal.sourceName,
          signal.company,
          signal.roleHint,
          signal.location,
          signal.signalText,
          signal.url,
          signal.signalType,
        );
      }
    });
    saveSignals();
  }
  const directJobs: NormalizedJob[] = hiringCafeSource
    ? normalizeHiringCafeJobs(page.html)
    : newsletterSignals
      .filter((signal) => Boolean(signal.roleHint))
      .map((signal) => ({
        sourceName: signal.sourceName,
        sourceType: "gmail_newsletter",
        externalId: signal.externalId,
        company: signal.company,
        title: signal.roleHint,
        location: signal.location,
        workplaceType: /\bremote\b/i.test(signal.signalText) ? "remote" : "unspecified",
        employmentType: "",
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: "",
        description: signal.signalText,
        canonicalUrl: signal.url,
        applyUrl: signal.url,
        postedAt: null,
      }));
  const namedGetroBoards = getroSource
    ? extractGetroAtsBoards(
      page.html,
      parseList(source.include_companies),
      parseList(source.exclude_companies),
    )
    : [];
  const namedConsiderBoards = considerSource
    ? await fetchConsiderAtsBoards(source.url, page.html, page.cookieHeader, log)
    : [];
  const namedNewsletterBoards = newsletterSignals.flatMap((signal) => {
    const board = detectAtsBoardFromUrl(signal.url);
    return board ? [{ company: signal.company, board }] : [];
  });
  const namedBoards = namedHiringCafeBoards.length
    ? namedHiringCafeBoards
    : namedNewsletterBoards.length
      ? namedNewsletterBoards
    : namedGetroBoards.length
      ? namedGetroBoards
      : namedConsiderBoards;
  const directBoards = namedBoards.length
    ? namedBoards.map((item) => item.board)
    : detectAtsBoardsFromHtml(page.html, page.finalUrl);
  let discovered = 0;
  if (namedBoards.length) {
    for (const item of namedBoards) {
      if (persistDetectedBoard(item.company, item.board, { name: source.name, url: source.url })) discovered += 1;
    }
  } else {
    for (const board of directBoards) {
      if (persistDetectedBoard(board.identifier, board, { name: source.name, url: source.url })) discovered += 1;
    }
  }
  const companies = newsletterSource ? [] : extractCompanyLinks(page.html, page.finalUrl);
  const batchSize = 12;
  const start = companies.length ? source.query_cursor % companies.length : 0;
  const batch = hiringCafeSource || newsletterSource || getroSource || considerSource
    ? []
    : [...companies.slice(start), ...companies.slice(0, start)].slice(0, batchSize);
  for (const company of batch) {
    const boards = await discoverBoardsFromCompanyLink(
      company.name,
      company.url,
      log,
      { name: source.name, url: source.url },
    );
    discovered += boards.length;
  }
  db.prepare(`
    UPDATE company_discovery_sources
    SET last_success_at = CURRENT_TIMESTAMP,
      cooldown_until = datetime('now', '+24 hours'),
      last_error = '',
      consecutive_failures = 0,
      query_cursor = query_cursor + ?
    WHERE id = ?
  `).run(batch.length, source.id);
  writeWorkflowLog(
    runId,
    null,
    "portfolio.complete",
    "success",
    `${source.name} exposed ${directJobs.length} direct job${directJobs.length === 1 ? "" : "s"}, ${directBoards.length} direct ATS links, and ${companies.length} company links. ${batch.length
      ? `Inspected ${batch.length} company sites`
      : directBoards.length
        ? "Used the direct ATS links, so no company-site crawl was needed"
        : "No company sites were available to inspect"} and added ${discovered} official ATS board${discovered === 1 ? "" : "s"}.`,
    {
      sourceId: source.id,
      directBoardsFound: directBoards.length,
      directJobsFound: directJobs.length,
      companiesFound: companies.length,
      companiesInspected: batch.length,
      boardsAdded: discovered,
      includeCompanies: parseList(source.include_companies),
      excludeCompanies: parseList(source.exclude_companies),
    },
  );
  return { boardsAdded: discovered, directJobs };
}

export function scoreAllJobs(): void {
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const fitPreferences = currentFitPreferences();
  const jobs = db.prepare("SELECT * FROM jobs WHERE duplicate_of_job_id IS NULL").all() as Job[];
  const update = db.prepare(`
    UPDATE jobs
    SET score = ?, hard_filter_pass = ?,
      eligibility_status = CASE WHEN eligibility_override = 1 THEN eligibility_status ELSE ? END,
      score_breakdown = ?, match_summary = ?,
      confidence_score = ?, confidence_breakdown = ?, confidence_summary = ?
    WHERE id = ?
  `);
  const transaction = db.transaction(() => {
    for (const job of jobs) {
      const score = scoreJob(job, profile, fitPreferences);
      const recentCompanyJobCount = (db.prepare(`
        SELECT COUNT(*) AS count FROM jobs
        WHERE lower(company) = lower(?)
          AND duplicate_of_job_id IS NULL
          AND datetime(first_seen_at) >= datetime('now', '-90 days')
      `).get(job.company) as { count: number }).count;
      const similarRoleCount = (db.prepare(`
        SELECT COUNT(*) AS count FROM jobs
        WHERE lower(company) = lower(?)
          AND lower(title) = lower(?)
          AND duplicate_of_job_id IS NULL
      `).get(job.company, job.title) as { count: number }).count;
      const confidence = scorePostingConfidence(job, recentCompanyJobCount, similarRoleCount);
      update.run(
        score.total,
        score.hardFilterPass ? 1 : 0,
        score.eligibilityStatus,
        JSON.stringify(score),
        buildMatchSummary(score),
        confidence.total,
        JSON.stringify(confidence),
        buildConfidenceSummary(confidence),
        job.id,
      );
    }
  });
  transaction();
  syncRunEligibility();
}

export function clearEligibilityOverrides(): void {
  db.prepare("UPDATE jobs SET eligibility_override = 0 WHERE eligibility_override = 1").run();
}

export function syncRunEligibility(runId?: number): void {
  const rows = db.prepare(`
    SELECT jobs.id, jobs.hard_filter_pass, jobs.eligibility_status, jobs.score_breakdown
    FROM jobs
    JOIN collection_job_results ON collection_job_results.job_id = jobs.id
    WHERE jobs.duplicate_of_job_id IS NULL
      ${runId ? "AND collection_job_results.run_id = ?" : ""}
    GROUP BY jobs.id
  `).all(...(runId ? [runId] : [])) as Array<{
    id: number;
    hard_filter_pass: number | null;
    eligibility_status: EligibilityStatus;
    score_breakdown: string | null;
  }>;
  const update = db.prepare(`
    UPDATE collection_job_results
    SET eligible = ?, classification = ?, reasons_json = ?
    WHERE job_id = ?
      ${runId ? "AND run_id = ?" : ""}
  `);
  const transaction = db.transaction(() => {
    for (const row of rows) {
      let reasons: string[] = [];
      try {
        const parsed = JSON.parse(row.score_breakdown || "{}") as {
          hardFilterReasons?: unknown;
          verificationReasons?: unknown;
        };
        if (Array.isArray(parsed.hardFilterReasons)) {
          reasons = parsed.hardFilterReasons.filter((reason): reason is string => typeof reason === "string");
        }
        if (Array.isArray(parsed.verificationReasons)) {
          reasons.push(...parsed.verificationReasons.filter((reason): reason is string => typeof reason === "string"));
        }
      } catch {
        reasons = [];
      }
      update.run(
        row.eligibility_status === "eligible" ? 1 : 0,
        row.eligibility_status,
        JSON.stringify(reasons),
        row.id,
        ...(runId ? [runId] : []),
      );
    }
  });
  transaction();
}

export interface CollectionResult {
  runId: number;
  status: "completed" | "completed_with_errors" | "completed_with_warnings" | "failed";
  message: string;
  jobsFound: number;
  jobsAdded: number;
  jobsUpdated: number;
  eligibleJobs: number;
  needsVerificationJobs: number;
  filteredJobs: number;
  skippedSources: number;
  errors: string[];
}

function writeWorkflowLog(
  runId: number,
  sourceId: number | null,
  step: string,
  level: WorkflowLogLevel,
  message: string,
  details: Record<string, unknown> = {},
  durationMs?: number,
): void {
  db.prepare(`
    INSERT INTO workflow_logs (run_id, source_id, step, level, message, details_json, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(runId, sourceId, step, level, message, JSON.stringify(details), durationMs ?? null);
}

function finishRun(
  runId: number,
  status: CollectionResult["status"],
  jobsFound: number,
  jobsAdded: number,
  jobsUpdated: number,
  errors: string[],
): void {
  db.prepare(`
    UPDATE collection_runs SET
      completed_at = CURRENT_TIMESTAMP,
      status = ?,
      jobs_found = ?,
      jobs_added = ?,
      jobs_updated = ?,
      error_summary = ?
    WHERE id = ?
  `).run(status, jobsFound, jobsAdded, jobsUpdated, errors.join("\n"), runId);
}

export async function runCollection(slot = "manual"): Promise<CollectionResult> {
  const run = db.prepare("INSERT INTO collection_runs (slot) VALUES (?)").run(slot);
  const runId = Number(run.lastInsertRowid);
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const fitPreferences = currentFitPreferences();
  const bootstrappedBoards = bootstrapDirectAtsBoardsFromJobs();
  const gmailOnly = slot === "gmail_manual";
  const discoverySources = gmailOnly
    ? []
    : db.prepare("SELECT * FROM discovery_sources WHERE enabled = 1 ORDER BY name").all() as DiscoverySource[];
  let sources = gmailOnly
    ? []
    : db.prepare("SELECT * FROM job_sources WHERE enabled = 1 ORDER BY CASE tier WHEN 'watchlist' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END, name").all() as JobSource[];
  const companyDiscoverySources = gmailOnly
    ? []
    : db.prepare("SELECT * FROM company_discovery_sources WHERE enabled = 1 ORDER BY name").all() as CompanyDiscoverySource[];
  const gmail = gmailConfiguration();
  const gmailState = db.prepare("SELECT * FROM gmail_alert_state WHERE id = 1").get() as {
    label: string;
    last_attempt_at: string | null;
    last_success_at: string | null;
    cooldown_until: string | null;
    last_error: string;
  };
  let jobsFound = 0;
  let jobsAdded = 0;
  let jobsUpdated = 0;
  let skippedSources = 0;
  let successfulSources = 0;
  const errors: string[] = [];

  writeWorkflowLog(runId, null, "workflow.start", "info", `Workflow started from the ${slot.replaceAll("_", " ")} trigger.`, {
    slot,
    automaticFeeds: discoverySources.length,
    companyWatchlistSources: sources.length,
    companyDiscoverySources: companyDiscoverySources.length,
    gmailAlertsConfigured: gmail.configured,
    gmailLabel: gmail.configured ? gmail.label : null,
    gmailOnly,
    searchQueries: discoverySources.map((source) => ({ source: source.key, query: discoveryQuery(profile, source.query_cursor) })),
    eligibility: fitPreferences,
    cooldownMs: REQUEST_COOLDOWN_MS,
    maximumAttempts: MAX_REQUEST_ATTEMPTS,
    directAtsBoardsAdded: bootstrappedBoards,
  });
  if (bootstrappedBoards > 0) {
    writeWorkflowLog(
      runId,
      null,
      "ats.bootstrap",
      "success",
      `Automatically added ${bootstrappedBoards} official ATS board${bootstrappedBoards === 1 ? "" : "s"} from previously saved job URLs.`,
      { boardsAdded: bootstrappedBoards },
    );
  }

  if (sources.length + discoverySources.length + companyDiscoverySources.length + (gmail.configured ? 1 : 0) === 0) {
    const message = "No automatic discovery feeds or company watchlist sources are enabled.";
    errors.push(message);
    writeWorkflowLog(runId, null, "workflow.preflight", "error", message);
    finishRun(runId, "failed", 0, 0, 0, errors);
    return {
      runId,
      status: "failed",
      message,
      jobsFound: 0,
      jobsAdded: 0,
      jobsUpdated: 0,
      eligibleJobs: 0,
      needsVerificationJobs: 0,
      filteredJobs: 0,
      skippedSources: 0,
      errors,
    };
  }

  const totalSources = sources.length + discoverySources.length + companyDiscoverySources.length + (gmail.configured ? 1 : 0);
  writeWorkflowLog(
    runId,
    null,
    "workflow.preflight",
    "success",
    `${discoverySources.length} automatic feed${discoverySources.length === 1 ? "" : "s"}, ${sources.length} official company board${sources.length === 1 ? "" : "s"}, ${companyDiscoverySources.length} company discovery page${companyDiscoverySources.length === 1 ? "" : "s"}, and ${gmail.configured ? "1 Gmail alert inbox" : "no Gmail alert inbox"} passed preflight.`,
    {
      targetRoles: broadDiscoverySearchTitles(profile),
      totalSources,
      gmailConfigured: gmail.configured,
      companyDiscoverySources: companyDiscoverySources.length,
    },
  );

  const findExisting = db.prepare("SELECT id FROM jobs WHERE source_id = ? AND external_id = ?");
  const findExistingDiscovery = db.prepare("SELECT id FROM jobs WHERE source_id IS NULL AND source_type = ? AND external_id = ?");
  const insert = db.prepare(`
    INSERT INTO jobs (
      source_id, source_name, source_type, external_id, company, title, location,
      workplace_type, employment_type, salary_min, salary_max, salary_currency,
      description, canonical_url, apply_url, posted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE jobs SET
      source_name = ?, company = ?, title = ?, location = ?, workplace_type = ?,
      employment_type = ?, salary_min = ?, salary_max = ?, salary_currency = ?,
      description = ?, canonical_url = ?, apply_url = ?, posted_at = ?,
      last_seen_at = CURRENT_TIMESTAMP, seen_count = seen_count + 1
    WHERE source_id = ? AND external_id = ?
  `);

  const updateDiscovery = db.prepare(`
    UPDATE jobs SET
      source_name = ?, company = ?, title = ?, location = ?, workplace_type = ?,
      employment_type = ?, salary_min = ?, salary_max = ?, salary_currency = ?,
      description = ?, canonical_url = ?, apply_url = ?, posted_at = ?,
      last_seen_at = CURRENT_TIMESTAMP, seen_count = seen_count + 1
    WHERE source_id IS NULL AND source_type = ? AND external_id = ?
  `);
  const recordRunJob = db.prepare(`
    INSERT INTO collection_job_results (run_id, job_id, outcome, eligible, classification, reasons_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, job_id) DO UPDATE SET
      outcome = excluded.outcome,
      eligible = excluded.eligible,
      classification = excluded.classification,
      reasons_json = excluded.reasons_json
  `);

  if (gmail.configured) {
    const cooldownUntil = gmailState.cooldown_until ? new Date(gmailState.cooldown_until).getTime() : 0;
    if (cooldownUntil > Date.now()) {
      skippedSources += 1;
      writeWorkflowLog(
        runId,
        null,
        "gmail.cooldown",
        "warning",
        `Gmail alerts are cooling down until ${new Date(cooldownUntil).toLocaleString()}.`,
        { label: gmail.label, cooldownUntil: new Date(cooldownUntil).toISOString() },
      );
    } else {
      const gmailStartedAt = Date.now();
      db.prepare("UPDATE gmail_alert_state SET label = ?, last_attempt_at = CURRENT_TIMESTAMP WHERE id = 1").run(gmail.label);
      writeWorkflowLog(
        runId,
        null,
        "gmail.start",
        "info",
        `Reading new messages from the ${gmail.label} Gmail label.`,
        { label: gmail.label, maximumMessages: 50 },
      );
      try {
        const fetched = await fetchGmailAlertJobs();
        let newsletterBoardsAdded = 0;
        const saveHiringSignals = db.transaction(() => {
          const saveSignal = db.prepare(`
            INSERT INTO gmail_hiring_signals (
              external_id, source_name, company, role_hint, location, signal_text, url, signal_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(external_id) DO UPDATE SET
              source_name = excluded.source_name,
              company = excluded.company,
              role_hint = excluded.role_hint,
              location = excluded.location,
              signal_text = excluded.signal_text,
              url = excluded.url,
              signal_type = excluded.signal_type,
              last_seen_at = CURRENT_TIMESTAMP
          `);
          for (const signal of fetched.hiringSignals) {
            saveSignal.run(
              signal.externalId,
              signal.sourceName,
              signal.company,
              signal.roleHint,
              signal.location,
              signal.signalText,
              signal.url,
              signal.signalType,
            );
            const board = detectAtsBoardFromUrl(signal.url);
            if (board && persistDetectedBoard(signal.company, board, {
              name: signal.sourceName,
              url: signal.url,
            })) newsletterBoardsAdded += 1;
          }
        });
        saveHiringSignals();
        const roleFamilyJobs = fetched.jobs.filter((job) => classifyRoleFamily(job.title, job.description) !== "no");
        jobsFound += roleFamilyJobs.length;
        const {
          evaluatedJobs,
          eligibleCount,
          needsVerificationCount,
          filteredCount,
          reasonCounts,
        } = filterCollectedJobs(roleFamilyJobs, profile, fitPreferences);
        let sourceAdded = 0;
        let sourceUpdated = 0;
        const saveJobs = db.transaction(() => {
          for (const evaluation of evaluatedJobs) {
            const { job, status, reasons } = evaluation;
            const sourceType = job.sourceType || "gmail_alert";
            const sourceName = job.sourceName || "Gmail job alert";
            const existing = findExistingDiscovery.get(sourceType, job.externalId) as { id: number } | undefined;
            let jobId: number;
            let outcome: "new" | "refreshed";
            if (existing) {
              updateDiscovery.run(
                sourceName,
                job.company,
                job.title,
                job.location,
                job.workplaceType,
                job.employmentType,
                job.salaryMin,
                job.salaryMax,
                job.salaryCurrency,
                job.description,
                job.canonicalUrl,
                job.applyUrl,
                job.postedAt,
                sourceType,
                job.externalId,
              );
              jobId = existing.id;
              outcome = "refreshed";
              jobsUpdated += 1;
              sourceUpdated += 1;
            } else {
              const inserted = insert.run(
                null,
                sourceName,
                sourceType,
                job.externalId,
                job.company,
                job.title,
                job.location,
                job.workplaceType,
                job.employmentType,
                job.salaryMin,
                job.salaryMax,
                job.salaryCurrency,
                job.description,
                job.canonicalUrl,
                job.applyUrl,
                job.postedAt,
              );
              jobId = Number(inserted.lastInsertRowid);
              outcome = "new";
              jobsAdded += 1;
              sourceAdded += 1;
            }
            recordRunJob.run(
              runId,
              jobId,
              outcome,
              status === "eligible" ? 1 : 0,
              status,
              JSON.stringify(reasons),
            );
          }
        });
        saveJobs();
        markGmailMessagesProcessed(fetched.label, fetched.processedMessages);
        const nextRequestAt = new Date(Date.now() + 5 * 60_000).toISOString();
        db.prepare(`
          UPDATE gmail_alert_state SET
            label = ?,
            last_success_at = CURRENT_TIMESTAMP,
            cooldown_until = ?,
            last_error = ''
          WHERE id = 1
        `).run(fetched.label, nextRequestAt);
        successfulSources += 1;
        writeWorkflowLog(
          runId,
          null,
          "gmail.complete",
          filteredCount > 0 ? "warning" : "success",
          `Gmail read ${fetched.messagesProcessed} new message${fetched.messagesProcessed === 1 ? "" : "s"} and extracted ${fetched.jobs.length} specific job${fetched.jobs.length === 1 ? "" : "s"}. Retained ${fetched.hiringSignals.length} curated hiring signal${fetched.hiringSignals.length === 1 ? "" : "s"} and added ${newsletterBoardsAdded} official board${newsletterBoardsAdded === 1 ? "" : "s"}. ${roleFamilyJobs.length} matched the strict target role gate. Saved ${sourceAdded} new and refreshed ${sourceUpdated}. Classified ${eligibleCount} eligible, ${needsVerificationCount} for verification, and ${filteredCount} filtered.`,
          {
            label: fetched.label,
            messagesAvailable: fetched.messagesAvailable,
            messagesProcessed: fetched.messagesProcessed,
            messagesSkipped: fetched.messagesSkipped,
            jobsFound: fetched.jobs.length,
            hiringSignalsFound: fetched.hiringSignals.length,
            newsletterBoardsAdded,
            relevantJobsFound: roleFamilyJobs.length,
            eligibleCount,
            needsVerificationCount,
            filteredCount,
            filterReasons: reasonCounts,
            jobsAdded: sourceAdded,
            jobsUpdated: sourceUpdated,
            nextRequestAt,
          },
          Date.now() - gmailStartedAt,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Gmail alert error";
        errors.push(`Gmail alerts: ${message}`);
        const nextRequestAt = new Date(Date.now() + 15 * 60_000).toISOString();
        db.prepare(`
          UPDATE gmail_alert_state SET
            label = ?,
            last_error = ?,
            cooldown_until = ?
          WHERE id = 1
        `).run(gmail.label, message, nextRequestAt);
        writeWorkflowLog(
          runId,
          null,
          "gmail.failed",
          "error",
          `Gmail alerts failed: ${message}`,
          { label: gmail.label, nextRequestAt },
          Date.now() - gmailStartedAt,
        );
      }
    }
  }

  for (const source of discoverySources) {
    const cooldownUntil = source.cooldown_until ? new Date(source.cooldown_until).getTime() : 0;
    if (cooldownUntil > Date.now()) {
      skippedSources += 1;
      writeWorkflowLog(
        runId,
        null,
        "discovery.cooldown",
        "warning",
        `${source.name} is cooling down until ${new Date(cooldownUntil).toLocaleString()}. Existing jobs will still be scored.`,
        { source: source.key, cooldownUntil: new Date(cooldownUntil).toISOString() },
      );
      continue;
    }

    const sourceStartedAt = Date.now();
    db.prepare("UPDATE discovery_sources SET last_attempt_at = CURRENT_TIMESTAMP WHERE key = ?").run(source.key);
    writeWorkflowLog(
      runId,
      null,
      "discovery.start",
      "info",
      `Searching ${source.name} for ${discoveryQuery(profile, source.query_cursor)} roles.`,
      { source: source.key, query: discoveryQuery(profile, source.query_cursor), minimumIntervalMinutes: source.minimum_interval_minutes },
    );
    const sourceLog: RequestLogger = (step, level, message, details, durationMs) => {
      writeWorkflowLog(runId, null, step, level, `${source.name}: ${message}`, { source: source.key, ...(details || {}) }, durationMs);
    };

    try {
      const fetchedJobs = await fetchDiscoverySource(source, profile, sourceLog);
      const roleFamilyJobs = fetchedJobs.filter((job) => classifyRoleFamily(job.title, job.description) !== "no");
      jobsFound += roleFamilyJobs.length;
      const {
        evaluatedJobs,
        eligibleCount,
        needsVerificationCount,
        filteredCount,
        reasonCounts,
      } = filterCollectedJobs(roleFamilyJobs, profile, fitPreferences);
      let sourceAdded = 0;
      let sourceUpdated = 0;
      const saveJobs = db.transaction(() => {
        for (const evaluation of evaluatedJobs) {
          const { job, status, reasons } = evaluation;
          const existing = findExistingDiscovery.get(source.key, job.externalId) as { id: number } | undefined;
          let jobId: number;
          let outcome: "new" | "refreshed";
          if (existing) {
            updateDiscovery.run(
              source.name,
              job.company,
              job.title,
              job.location,
              job.workplaceType,
              job.employmentType,
              job.salaryMin,
              job.salaryMax,
              job.salaryCurrency,
              job.description,
              job.canonicalUrl,
              job.applyUrl,
              job.postedAt,
              source.key,
              job.externalId,
            );
            jobId = existing.id;
            outcome = "refreshed";
            jobsUpdated += 1;
            sourceUpdated += 1;
          } else {
            const inserted = insert.run(
              null,
              source.name,
              source.key,
              job.externalId,
              job.company,
              job.title,
              job.location,
              job.workplaceType,
              job.employmentType,
              job.salaryMin,
              job.salaryMax,
              job.salaryCurrency,
              job.description,
              job.canonicalUrl,
              job.applyUrl,
              job.postedAt,
            );
            jobId = Number(inserted.lastInsertRowid);
            outcome = "new";
            jobsAdded += 1;
            sourceAdded += 1;
          }
          recordRunJob.run(
            runId,
            jobId,
            outcome,
            status === "eligible" ? 1 : 0,
            status,
            JSON.stringify(reasons),
          );
        }
      });
      saveJobs();
      const nextRequestAt = new Date(Date.now() + source.minimum_interval_minutes * 60_000).toISOString();
      db.prepare(`
        UPDATE discovery_sources SET
          last_success_at = CURRENT_TIMESTAMP,
          last_error = '',
          consecutive_failures = 0,
          cooldown_until = ?,
          query_cursor = query_cursor + 1
        WHERE key = ?
      `).run(nextRequestAt, source.key);
      successfulSources += 1;
      writeWorkflowLog(
        runId,
        null,
        "discovery.complete",
        "success",
        `${source.name} returned ${fetchedJobs.length} jobs. Saved ${sourceAdded} new and refreshed ${sourceUpdated}. Classified ${eligibleCount} eligible, ${needsVerificationCount} for verification, and ${filteredCount} filtered.`,
        {
          source: source.key,
          jobsFound: fetchedJobs.length,
          eligibleCount,
          needsVerificationCount,
          filteredCount,
          classificationReasons: reasonCounts,
          jobsAdded: sourceAdded,
          jobsUpdated: sourceUpdated,
          nextRequestAt,
        },
        Date.now() - sourceStartedAt,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown discovery feed error";
      errors.push(`${source.name}: ${message}`);
      const retryAfterMs = error instanceof HttpRequestError ? error.retryAfterMs : null;
      const fallbackCooldownMs = Math.min(21_600_000, 300_000 * 2 ** source.consecutive_failures);
      const nextRequestAt = new Date(Date.now() + (retryAfterMs || fallbackCooldownMs)).toISOString();
      db.prepare(`
        UPDATE discovery_sources SET
          last_error = ?,
          consecutive_failures = consecutive_failures + 1,
          cooldown_until = ?
        WHERE key = ?
      `).run(message, nextRequestAt, source.key);
      writeWorkflowLog(
        runId,
        null,
        "discovery.failed",
        "error",
        `${source.name} failed: ${message}`,
        { source: source.key, status: error instanceof HttpRequestError ? error.status : null, retryAfterMs, nextRequestAt },
        Date.now() - sourceStartedAt,
      );
    }
  }

  for (const source of companyDiscoverySources) {
    const cooldownUntil = source.cooldown_until ? new Date(source.cooldown_until).getTime() : 0;
    if (cooldownUntil > Date.now()) {
      skippedSources += 1;
      writeWorkflowLog(
        runId,
        null,
        "portfolio.cooldown",
        "warning",
        `${source.name} is cooling down until ${new Date(cooldownUntil).toLocaleString()}.`,
        { sourceId: source.id, cooldownUntil: new Date(cooldownUntil).toISOString() },
      );
      continue;
    }

    db.prepare("UPDATE company_discovery_sources SET last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?").run(source.id);
    writeWorkflowLog(
      runId,
      null,
      "portfolio.start",
      "info",
      `Inspecting ${source.name} for company career boards.`,
      {
        sourceId: source.id,
        url: source.url,
        includeCompanies: parseList(source.include_companies),
        excludeCompanies: parseList(source.exclude_companies),
      },
    );
    try {
      const discoveryResult = await runCompanyDiscoverySource(runId, source);
      if (discoveryResult.directJobs.length) {
        const roleFamilyJobs = discoveryResult.directJobs.filter((job) => classifyRoleFamily(job.title, job.description) !== "no");
        jobsFound += roleFamilyJobs.length;
        const {
          evaluatedJobs,
          eligibleCount,
          needsVerificationCount,
          filteredCount,
          reasonCounts,
        } = filterCollectedJobs(roleFamilyJobs, profile, fitPreferences);
        let sourceAdded = 0;
        let sourceUpdated = 0;
        const saveJobs = db.transaction(() => {
          for (const evaluation of evaluatedJobs) {
            const { job, status, reasons } = evaluation;
            const sourceType = job.sourceType || "hiring_cafe";
            const existing = findExistingDiscovery.get(sourceType, job.externalId) as { id: number } | undefined;
            let jobId: number;
            let outcome: "new" | "refreshed";
            if (existing) {
              updateDiscovery.run(
                source.name,
                job.company,
                job.title,
                job.location,
                job.workplaceType,
                job.employmentType,
                job.salaryMin,
                job.salaryMax,
                job.salaryCurrency,
                job.description,
                job.canonicalUrl,
                job.applyUrl,
                job.postedAt,
                sourceType,
                job.externalId,
              );
              jobId = existing.id;
              outcome = "refreshed";
              jobsUpdated += 1;
              sourceUpdated += 1;
            } else {
              const inserted = insert.run(
                null,
                source.name,
                sourceType,
                job.externalId,
                job.company,
                job.title,
                job.location,
                job.workplaceType,
                job.employmentType,
                job.salaryMin,
                job.salaryMax,
                job.salaryCurrency,
                job.description,
                job.canonicalUrl,
                job.applyUrl,
                job.postedAt,
              );
              jobId = Number(inserted.lastInsertRowid);
              outcome = "new";
              jobsAdded += 1;
              sourceAdded += 1;
            }
            recordRunJob.run(
              runId,
              jobId,
              outcome,
              status === "eligible" ? 1 : 0,
              status,
              JSON.stringify(reasons),
            );
          }
        });
        saveJobs();
        writeWorkflowLog(
          runId,
          null,
          "portfolio.jobs_complete",
          "success",
          `${source.name} returned ${discoveryResult.directJobs.length} direct jobs. ${roleFamilyJobs.length} matched the exact product design role family. Saved ${sourceAdded} new and refreshed ${sourceUpdated}. Classified ${eligibleCount} eligible, ${needsVerificationCount} for verification, and ${filteredCount} filtered.`,
          {
            sourceId: source.id,
            sourceTypes: [...new Set(evaluatedJobs.map((evaluation) => evaluation.job.sourceType || "hiring_cafe"))],
            jobsFound: discoveryResult.directJobs.length,
            roleFamilyJobs: roleFamilyJobs.length,
            eligibleCount,
            needsVerificationCount,
            filteredCount,
            classificationReasons: reasonCounts,
            jobsAdded: sourceAdded,
            jobsUpdated: sourceUpdated,
          },
        );
      }
      successfulSources += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown company discovery error";
      errors.push(`${source.name}: ${message}`);
      const cooldown = new Date(Date.now() + Math.min(86_400_000, 900_000 * 2 ** source.consecutive_failures)).toISOString();
      db.prepare(`
        UPDATE company_discovery_sources
        SET last_error = ?,
          consecutive_failures = consecutive_failures + 1,
          cooldown_until = ?
        WHERE id = ?
      `).run(message, cooldown, source.id);
      writeWorkflowLog(
        runId,
        null,
        "portfolio.failed",
        "error",
        `${source.name} failed: ${message}`,
        { sourceId: source.id, url: source.url, cooldownUntil: cooldown },
      );
    }
  }

  sources = gmailOnly
    ? []
    : db.prepare("SELECT * FROM job_sources WHERE enabled = 1 ORDER BY CASE tier WHEN 'watchlist' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END, name").all() as JobSource[];

  await mapWithConcurrency(sources, SOURCE_CONCURRENCY, async (source) => {
    const cooldownUntil = source.cooldown_until ? new Date(source.cooldown_until).getTime() : 0;
    if (cooldownUntil > Date.now()) {
      skippedSources += 1;
      writeWorkflowLog(
        runId,
        source.id,
        "source.cooldown",
        "info",
        `${source.name} is resting on the ${source.tier || "standard"} schedule until ${new Date(cooldownUntil).toLocaleString()}.`,
        { cooldownUntil: new Date(cooldownUntil).toISOString(), tier: source.tier || "standard" },
      );
      return;
    }

    const sourceStartedAt = Date.now();
    db.prepare("UPDATE job_sources SET last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?").run(source.id);
    writeWorkflowLog(runId, source.id, "source.start", "info", `Starting ${source.source_type} collection for ${source.name}.`, {
      sourceType: source.source_type,
      identifier: source.identifier,
    });
    const sourceLog: RequestLogger = (step, level, message, details, durationMs) => {
      writeWorkflowLog(runId, source.id, step, level, message, details, durationMs);
    };

    try {
      const fetchedJobs = await fetchSource(source, sourceLog);
      const roleFamilyJobs = fetchedJobs.filter((job) => classifyRoleFamily(job.title, job.description) !== "no");
      jobsFound += roleFamilyJobs.length;
      const {
        evaluatedJobs,
        eligibleCount,
        needsVerificationCount,
        filteredCount,
        reasonCounts,
      } = filterCollectedJobs(roleFamilyJobs, profile, fitPreferences);
      let sourceAdded = 0;
      let sourceUpdated = 0;
      const saveJobs = db.transaction(() => {
        for (const evaluation of evaluatedJobs) {
          const { job, status, reasons } = evaluation;
          const existing = findExisting.get(source.id, job.externalId) as { id: number } | undefined;
          let jobId: number;
          let outcome: "new" | "refreshed";
          if (existing) {
            update.run(
              source.name,
              job.company,
              job.title,
              job.location,
              job.workplaceType,
              job.employmentType,
              job.salaryMin,
              job.salaryMax,
              job.salaryCurrency,
              job.description,
              job.canonicalUrl,
              job.applyUrl,
              job.postedAt,
              source.id,
              job.externalId,
            );
            jobId = existing.id;
            outcome = "refreshed";
            jobsUpdated += 1;
            sourceUpdated += 1;
          } else {
            const inserted = insert.run(
              source.id,
              source.name,
              source.source_type,
              job.externalId,
              job.company,
              job.title,
              job.location,
              job.workplaceType,
              job.employmentType,
              job.salaryMin,
              job.salaryMax,
              job.salaryCurrency,
              job.description,
              job.canonicalUrl,
              job.applyUrl,
              job.postedAt,
            );
            jobId = Number(inserted.lastInsertRowid);
            outcome = "new";
            jobsAdded += 1;
            sourceAdded += 1;
          }
          recordRunJob.run(
            runId,
            jobId,
            outcome,
            status === "eligible" ? 1 : 0,
            status,
            JSON.stringify(reasons),
          );
        }
      });
      saveJobs();
      const previousTier = source.tier || "standard";
      const { tier, consecutiveZeroRuns } = nextSourceTier(previousTier, source.consecutive_zero_runs || 0, eligibleCount);
      db.prepare(`
        UPDATE job_sources SET
          last_success_at = CURRENT_TIMESTAMP,
          last_error = '',
          consecutive_failures = 0,
          tier = ?,
          consecutive_zero_runs = ?,
          last_relevant_job_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_relevant_job_at END,
          tier_changed_at = CASE WHEN tier = ? THEN tier_changed_at ELSE CURRENT_TIMESTAMP END,
          cooldown_until = datetime('now', ?)
        WHERE id = ?
      `).run(tier, consecutiveZeroRuns, eligibleCount, tier, `+${tierIntervalMinutes[tier]} minutes`, source.id);
      if (tier !== previousTier) {
        writeWorkflowLog(
          runId,
          source.id,
          "source.tier_changed",
          "info",
          eligibleCount > 0
            ? `${source.name} produced a relevant role and moved to the frequent watchlist.`
            : `${source.name} has had ${consecutiveZeroRuns} checks without a relevant role and moved to the ${tier} schedule.`,
          { previousTier, tier, consecutiveZeroRuns, eligibleCount, nextCheckInMinutes: tierIntervalMinutes[tier] },
        );
      }
      successfulSources += 1;
      writeWorkflowLog(
        runId,
        source.id,
        "source.complete",
        "success",
        `${source.name} returned ${fetchedJobs.length} jobs. ${roleFamilyJobs.length} matched the exact product design role family. Saved ${sourceAdded} new and refreshed ${sourceUpdated}. Classified ${eligibleCount} eligible, ${needsVerificationCount} for verification, and ${filteredCount} filtered.`,
        {
          jobsFound: fetchedJobs.length,
          roleFamilyJobs: roleFamilyJobs.length,
          eligibleCount,
          needsVerificationCount,
          filteredCount,
          classificationReasons: reasonCounts,
          jobsAdded: sourceAdded,
          jobsUpdated: sourceUpdated,
        },
        Date.now() - sourceStartedAt,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown source error";
      errors.push(`${source.name}: ${message}`);
      const retryAfterMs = error instanceof HttpRequestError ? error.retryAfterMs : null;
      const cooldownUntil = retryAfterMs ? new Date(Date.now() + retryAfterMs).toISOString() : null;
      db.prepare(`
        UPDATE job_sources SET
          last_error = ?,
          consecutive_failures = consecutive_failures + 1,
          cooldown_until = ?
        WHERE id = ?
      `).run(message, cooldownUntil, source.id);
      writeWorkflowLog(
        runId,
        source.id,
        "source.failed",
        "error",
        `${source.name} failed: ${message}`,
        {
          status: error instanceof HttpRequestError ? error.status : null,
          retryAfterMs,
          cooldownUntil,
        },
        Date.now() - sourceStartedAt,
      );
    }
  });

  if (!gmailOnly) await runExaDiscovery(runId);

  const atsDiscoveryStartedAt = Date.now();
  writeWorkflowLog(
    runId,
    null,
    "ats.discovery_start",
    "info",
    "Checking eligible and uncertain jobs for official Greenhouse or Ashby boards.",
  );
  const detectedBoards = await discoverBoardsFromRun(runId);
  writeWorkflowLog(
    runId,
    null,
    "ats.discovery_complete",
    "success",
    `Detected ${detectedBoards} official ATS board${detectedBoards === 1 ? "" : "s"} from this fetch. Newly detected boards will run on the next fetch.`,
    { detectedBoards },
    Date.now() - atsDiscoveryStartedAt,
  );

  const scoringStartedAt = Date.now();
  writeWorkflowLog(runId, null, "scoring.start", "info", "Scoring all collected jobs.");
  scoreAllJobs();
  const duplicateResult = reconcileDuplicateJobs(runId);
  writeWorkflowLog(
    runId,
    null,
    "dedup.complete",
    "success",
    `${duplicateResult.suppressed} duplicate job${duplicateResult.suppressed === 1 ? "" : "s"} hidden from review.`,
    { ...duplicateResult },
  );
  const classificationCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN classification = 'eligible' THEN 1 ELSE 0 END) AS eligible,
      SUM(CASE WHEN classification = 'needs_verification' THEN 1 ELSE 0 END) AS needs_verification,
      SUM(CASE WHEN classification = 'filtered' THEN 1 ELSE 0 END) AS filtered
    FROM collection_job_results
    WHERE run_id = ?
  `).get(runId) as { eligible: number | null; needs_verification: number | null; filtered: number | null };
  const eligibleJobs = classificationCounts.eligible || 0;
  const needsVerificationJobs = classificationCounts.needs_verification || 0;
  const filteredJobs = classificationCounts.filtered || 0;
  writeWorkflowLog(
    runId,
    null,
    "scoring.complete",
    "success",
    `Profile match and posting signal scores are current. ${eligibleJobs} eligible, ${needsVerificationJobs} need verification, and ${filteredJobs} filtered.`,
    { eligibleJobs, needsVerificationJobs, filteredJobs },
    Date.now() - scoringStartedAt,
  );

  const status: CollectionResult["status"] = successfulSources === 0 && errors.length > 0
    ? "failed"
    : errors.length > 0
      ? "completed_with_errors"
      : skippedSources > 0
        ? "completed_with_warnings"
        : "completed";
  const message = status === "completed"
    ? `Workflow completed. Found ${jobsFound} jobs, added ${jobsAdded}, and updated ${jobsUpdated}.`
    : status === "completed_with_warnings"
        ? `Workflow completed using cached jobs while ${skippedSources} source${skippedSources === 1 ? " was" : "s were"} cooling down.`
      : status === "completed_with_errors"
        ? `Workflow completed, but ${errors.length} source${errors.length === 1 ? "" : "s"} failed.`
        : "Workflow failed because no source completed successfully.";

  writeWorkflowLog(
    runId,
    null,
    "workflow.complete",
    status === "completed" ? "success" : status === "failed" ? "error" : "warning",
    message,
    {
      jobsFound,
      jobsAdded,
      jobsUpdated,
      eligibleJobs,
      needsVerificationJobs,
      filteredJobs,
      skippedSources,
      errors: errors.length,
    },
  );
  finishRun(runId, status, jobsFound, jobsAdded, jobsUpdated, errors);

  return {
    runId,
    status,
    message,
    jobsFound,
    jobsAdded,
    jobsUpdated,
    eligibleJobs,
    needsVerificationJobs,
    filteredJobs,
    skippedSources,
    errors,
  };
}
