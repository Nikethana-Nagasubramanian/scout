import { db, getSetting } from "@/lib/database";
import { fetchGmailAlertJobs, gmailConfiguration, markGmailMessagesProcessed } from "@/lib/gmail-alerts";
import { jobEligibilityReasons, type JobFitPreferences } from "@/lib/job-fit";
import { buildConfidenceSummary, buildMatchSummary, scoreJob, scorePostingConfidence } from "@/lib/scoring";
import type { CandidateProfile, DiscoverySource, Job, JobSource, WorkflowLogLevel } from "@/lib/types";
import { parseList, stripHtml } from "@/lib/utils";

const REQUEST_COOLDOWN_MS = 1_200;
const MAX_REQUEST_ATTEMPTS = 3;
const MAX_INLINE_RETRY_MS = 30_000;
const hostLastRequestAt = new Map<string, number>();

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

interface NormalizedJob {
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
  return {
    usaOnly: getSetting("search_usa_only", "1") === "1",
    minimumExperience: Number.isFinite(minimumExperience) ? Math.max(0, minimumExperience) : 2,
    maximumExperience: Number.isFinite(maximumExperience)
      ? Math.max(Number.isFinite(minimumExperience) ? minimumExperience : 2, maximumExperience)
      : 5,
  };
}

function filterCollectedJobs(
  jobs: NormalizedJob[],
  profile: CandidateProfile,
  preferences: JobFitPreferences,
): {
  evaluatedJobs: Array<{ job: NormalizedJob; reasons: string[] }>;
  filteredCount: number;
  reasonCounts: Record<string, number>;
} {
  const evaluatedJobs: Array<{ job: NormalizedJob; reasons: string[] }> = [];
  const reasonCounts: Record<string, number> = {};
  for (const job of jobs) {
    const reasons = jobEligibilityReasons({
      title: job.title,
      location: job.location,
      description: job.description,
      workplaceType: job.workplaceType,
    }, profile, preferences);
    evaluatedJobs.push({ job, reasons });
    for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  return {
    evaluatedJobs,
    filteredCount: evaluatedJobs.filter((item) => item.reasons.length > 0).length,
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
  const elapsed = Date.now() - (hostLastRequestAt.get(host) || 0);
  const waitMs = Math.max(0, REQUEST_COOLDOWN_MS - elapsed);
  if (waitMs > 0) {
    log("request.cooldown", "info", `Waiting ${waitMs} ms before the next ${host} request.`, { host, waitMs });
    await sleep(waitMs);
  }
  hostLastRequestAt.set(host, Date.now());
}

async function fetchJson<T>(url: string, log: RequestLogger): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    await respectHostCooldown(url, log);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "ScoutJobSearch/0.1" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      const durationMs = Date.now() - startedAt;
      if (response.ok) {
        log("request.success", "success", `API request returned ${response.status}.`, { url, attempt, status: response.status }, durationMs);
        return response.json() as Promise<T>;
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

function discoveryQuery(profile: CandidateProfile, cursor = 0): string {
  const titles = parseList(profile.target_titles);
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

  const base = source.identifier.startsWith("eu:") ? "https://api.eu.lever.co" : "https://api.lever.co";
  const identifier = source.identifier.replace(/^eu:/, "");
  const url = `${base}/v0/postings/${encodeURIComponent(identifier)}?mode=json`;
  const payload = await fetchJson<LeverJob[]>(url, log);
  return normalizeLeverJobs(source, payload);
}

export function scoreAllJobs(): void {
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const fitPreferences = currentFitPreferences();
  const jobs = db.prepare("SELECT * FROM jobs").all() as Job[];
  const update = db.prepare(`
    UPDATE jobs
    SET score = ?, hard_filter_pass = ?, score_breakdown = ?, match_summary = ?,
      confidence_score = ?, confidence_breakdown = ?, confidence_summary = ?
    WHERE id = ?
  `);
  const transaction = db.transaction(() => {
    for (const job of jobs) {
      const score = scoreJob(job, profile, fitPreferences);
      const recentCompanyJobCount = (db.prepare(`
        SELECT COUNT(*) AS count FROM jobs
        WHERE lower(company) = lower(?) AND datetime(first_seen_at) >= datetime('now', '-90 days')
      `).get(job.company) as { count: number }).count;
      const similarRoleCount = (db.prepare(`
        SELECT COUNT(*) AS count FROM jobs
        WHERE lower(company) = lower(?) AND lower(title) = lower(?)
      `).get(job.company, job.title) as { count: number }).count;
      const confidence = scorePostingConfidence(job, recentCompanyJobCount, similarRoleCount);
      update.run(
        score.total,
        score.hardFilterPass ? 1 : 0,
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
}

function syncRunEligibility(runId: number): void {
  const rows = db.prepare(`
    SELECT jobs.id, jobs.hard_filter_pass, jobs.score_breakdown
    FROM jobs
    JOIN collection_job_results ON collection_job_results.job_id = jobs.id
    WHERE collection_job_results.run_id = ?
  `).all(runId) as Array<{ id: number; hard_filter_pass: number | null; score_breakdown: string | null }>;
  const update = db.prepare(`
    UPDATE collection_job_results
    SET eligible = ?, reasons_json = ?
    WHERE run_id = ? AND job_id = ?
  `);
  const transaction = db.transaction(() => {
    for (const row of rows) {
      let reasons: string[] = [];
      try {
        const parsed = JSON.parse(row.score_breakdown || "{}") as { hardFilterReasons?: unknown };
        if (Array.isArray(parsed.hardFilterReasons)) {
          reasons = parsed.hardFilterReasons.filter((reason): reason is string => typeof reason === "string");
        }
      } catch {
        reasons = [];
      }
      update.run(row.hard_filter_pass === 1 ? 1 : 0, JSON.stringify(reasons), runId, row.id);
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
  const gmailOnly = slot === "gmail_manual";
  const discoverySources = gmailOnly
    ? []
    : db.prepare("SELECT * FROM discovery_sources WHERE enabled = 1 ORDER BY name").all() as DiscoverySource[];
  const sources = gmailOnly
    ? []
    : db.prepare("SELECT * FROM job_sources WHERE enabled = 1 ORDER BY name").all() as JobSource[];
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
    gmailAlertsConfigured: gmail.configured,
    gmailLabel: gmail.configured ? gmail.label : null,
    gmailOnly,
    searchQueries: discoverySources.map((source) => ({ source: source.key, query: discoveryQuery(profile, source.query_cursor) })),
    eligibility: fitPreferences,
    cooldownMs: REQUEST_COOLDOWN_MS,
    maximumAttempts: MAX_REQUEST_ATTEMPTS,
  });

  if (sources.length + discoverySources.length + (gmail.configured ? 1 : 0) === 0) {
    const message = "No automatic discovery feeds or company watchlist sources are enabled.";
    errors.push(message);
    writeWorkflowLog(runId, null, "workflow.preflight", "error", message);
    finishRun(runId, "failed", 0, 0, 0, errors);
    return { runId, status: "failed", message, jobsFound: 0, jobsAdded: 0, jobsUpdated: 0, skippedSources: 0, errors };
  }

  const totalSources = sources.length + discoverySources.length + (gmail.configured ? 1 : 0);
  writeWorkflowLog(
    runId,
    null,
    "workflow.preflight",
    "success",
    `${discoverySources.length} automatic feed${discoverySources.length === 1 ? "" : "s"}, ${sources.length} optional company source${sources.length === 1 ? "" : "s"}, and ${gmail.configured ? "1 Gmail alert inbox" : "no Gmail alert inbox"} passed preflight.`,
    { targetRoles: parseList(profile.target_titles), totalSources, gmailConfigured: gmail.configured },
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
    INSERT INTO collection_job_results (run_id, job_id, outcome, eligible, reasons_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(run_id, job_id) DO UPDATE SET
      outcome = excluded.outcome,
      eligible = excluded.eligible,
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
        jobsFound += fetched.jobs.length;
        const { evaluatedJobs, filteredCount, reasonCounts } = filterCollectedJobs(fetched.jobs, profile, fitPreferences);
        let sourceAdded = 0;
        let sourceUpdated = 0;
        const saveJobs = db.transaction(() => {
          for (const evaluation of evaluatedJobs) {
            const { job, reasons } = evaluation;
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
            recordRunJob.run(runId, jobId, outcome, reasons.length ? 0 : 1, JSON.stringify(reasons));
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
          `Gmail read ${fetched.messagesProcessed} new message${fetched.messagesProcessed === 1 ? "" : "s"} and extracted ${fetched.jobs.length} job${fetched.jobs.length === 1 ? "" : "s"}. Saved ${sourceAdded} new, refreshed ${sourceUpdated}, and marked ${filteredCount} as filtered.`,
          {
            label: fetched.label,
            messagesAvailable: fetched.messagesAvailable,
            messagesProcessed: fetched.messagesProcessed,
            messagesSkipped: fetched.messagesSkipped,
            jobsFound: fetched.jobs.length,
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
      jobsFound += fetchedJobs.length;
      const { evaluatedJobs, filteredCount, reasonCounts } = filterCollectedJobs(fetchedJobs, profile, fitPreferences);
      let sourceAdded = 0;
      let sourceUpdated = 0;
      const saveJobs = db.transaction(() => {
        for (const evaluation of evaluatedJobs) {
          const { job, reasons } = evaluation;
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
          recordRunJob.run(runId, jobId, outcome, reasons.length ? 0 : 1, JSON.stringify(reasons));
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
        `${source.name} returned ${fetchedJobs.length} jobs. Saved ${sourceAdded} new, refreshed ${sourceUpdated}, and marked ${filteredCount} as filtered.`,
        { source: source.key, jobsFound: fetchedJobs.length, filteredCount, filterReasons: reasonCounts, jobsAdded: sourceAdded, jobsUpdated: sourceUpdated, nextRequestAt },
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

  for (const source of sources) {
    const cooldownUntil = source.cooldown_until ? new Date(source.cooldown_until).getTime() : 0;
    if (cooldownUntil > Date.now()) {
      skippedSources += 1;
      writeWorkflowLog(
        runId,
        source.id,
        "source.cooldown",
        "warning",
        `${source.name} is cooling down until ${new Date(cooldownUntil).toLocaleString()}.`,
        { cooldownUntil: new Date(cooldownUntil).toISOString() },
      );
      continue;
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
      jobsFound += fetchedJobs.length;
      const { evaluatedJobs, filteredCount, reasonCounts } = filterCollectedJobs(fetchedJobs, profile, fitPreferences);
      let sourceAdded = 0;
      let sourceUpdated = 0;
      const saveJobs = db.transaction(() => {
        for (const evaluation of evaluatedJobs) {
          const { job, reasons } = evaluation;
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
          recordRunJob.run(runId, jobId, outcome, reasons.length ? 0 : 1, JSON.stringify(reasons));
        }
      });
      saveJobs();
      db.prepare(`
        UPDATE job_sources SET
          last_success_at = CURRENT_TIMESTAMP,
          last_error = '',
          consecutive_failures = 0,
          cooldown_until = NULL
        WHERE id = ?
      `).run(source.id);
      successfulSources += 1;
      writeWorkflowLog(
        runId,
        source.id,
        "source.complete",
        "success",
        `${source.name} returned ${fetchedJobs.length} jobs. Saved ${sourceAdded} new, refreshed ${sourceUpdated}, and marked ${filteredCount} as filtered.`,
        { jobsFound: fetchedJobs.length, filteredCount, filterReasons: reasonCounts, jobsAdded: sourceAdded, jobsUpdated: sourceUpdated },
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
  }

  const scoringStartedAt = Date.now();
  writeWorkflowLog(runId, null, "scoring.start", "info", "Scoring all collected jobs.");
  scoreAllJobs();
  syncRunEligibility(runId);
  writeWorkflowLog(runId, null, "scoring.complete", "success", "Fit and posting-confidence scores are current.", {}, Date.now() - scoringStartedAt);

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
    { jobsFound, jobsAdded, jobsUpdated, skippedSources, errors: errors.length },
  );
  finishRun(runId, status, jobsFound, jobsAdded, jobsUpdated, errors);

  return { runId, status, message, jobsFound, jobsAdded, jobsUpdated, skippedSources, errors };
}
