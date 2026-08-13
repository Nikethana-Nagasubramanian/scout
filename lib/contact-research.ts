import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db, getSetting, setSetting } from "@/lib/database";
import { stripHtml, truncate } from "@/lib/utils";

const HUNTER_COMPANY_ENRICHMENT_CREDITS = 0.2;
const HUNTER_EMAIL_FINDER_CREDITS = 1;
const HUNTER_WORKFLOW_RESERVATION = HUNTER_COMPANY_ENRICHMENT_CREDITS + HUNTER_EMAIL_FINDER_CREDITS;
const MAX_PUBLIC_PAGES = 5;
const MAX_PUBLIC_HTML_LENGTH = 1_500_000;
const HUNTER_REQUEST_GAP_MS = 1_200;
const PUBLIC_REQUEST_GAP_MS = 900;
const PERSON_NAME_PATTERN = "[A-Z][A-Za-z.'-]{1,30}(?:\\s+[A-Z][A-Za-z.'-]{1,30}){1,3}";
const TARGET_ROLE_PATTERN = [
  "co-?founder",
  "founder",
  "chief executive officer",
  "ceo",
  "chief product officer",
  "cpo",
  "chief design officer",
  "senior vice president(?:,| of)?\\s*(?:product|design)",
  "svp(?: of)?\\s*(?:product|design)",
  "vice president(?:,| of)?\\s*(?:product|design)",
  "vp(?: of)?\\s*(?:product|design)",
  "head of (?:product|design)",
  "director of (?:product|design)",
  "product design manager",
  "design manager",
  "product manager",
  "senior product designer",
  "product designer",
].join("|");

const BLOCKED_NAME_WORDS = new Set([
  "about",
  "blog",
  "careers",
  "chief",
  "company",
  "design",
  "director",
  "founder",
  "head",
  "leadership",
  "manager",
  "meet",
  "news",
  "people",
  "product",
  "team",
  "vice",
]);

export interface PublicContactCandidate {
  name: string;
  title: string;
  evidenceUrl: string;
  evidenceSummary: string;
  source: "json_ld" | "page_text";
  score?: number;
}

interface JobForContactResearch {
  id: number;
  company: string;
  title: string;
  description: string;
  canonical_url: string;
}

interface HunterErrorItem {
  details?: string;
  id?: string;
}

let lastHunterRequestAt = 0;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hunterApiKey(): string {
  return process.env.HUNTER_API_KEY?.trim() || "";
}

export function hunterConfigured(): boolean {
  return Boolean(hunterApiKey());
}

export function hunterBudgetStatus(): { budget: number; used: number; remaining: number } {
  const budget = Math.max(0, Number(getSetting("hunter_credit_budget", "40")) || 40);
  const used = Math.max(0, Number(getSetting("hunter_credits_used_by_scout", "0")) || 0);
  return {
    budget,
    used,
    remaining: Math.max(0, Number((budget - used).toFixed(1))),
  };
}

export interface HunterAccountUsage {
  used: number;
  available: number;
  remaining: number;
  resetDate: string;
  checkedAt: string;
}

function cachedHunterAccountUsage(): HunterAccountUsage | null {
  try {
    const cached = JSON.parse(getSetting("hunter_account_usage_cache", "")) as HunterAccountUsage;
    return Number.isFinite(cached.used) && Number.isFinite(cached.available) && Number.isFinite(cached.remaining)
      ? cached
      : null;
  } catch {
    return null;
  }
}

export async function hunterAccountUsage(): Promise<HunterAccountUsage | null> {
  const cached = cachedHunterAccountUsage();
  const checkedAt = cached ? new Date(cached.checkedAt).getTime() : 0;
  if (checkedAt && Date.now() - checkedAt < 60 * 60_000) return cached;

  const apiKey = hunterApiKey();
  if (!apiKey) return cached;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = new URL("https://api.hunter.io/v2/account");
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return cached;
    const payload = await response.json() as {
      data?: {
        reset_date?: unknown;
        requests?: {
          credits?: {
            used?: unknown;
            available?: unknown;
            remaining?: unknown;
          };
        };
      };
    };
    const credits = payload.data?.requests?.credits;
    const used = Number(credits?.used);
    const available = Number(credits?.available);
    const remaining = Number(credits?.remaining);
    if (![used, available, remaining].every(Number.isFinite)) return cached;
    const usage: HunterAccountUsage = {
      used,
      available,
      remaining,
      resetDate: typeof payload.data?.reset_date === "string" ? payload.data.reset_date : "",
      checkedAt: new Date().toISOString(),
    };
    setSetting("hunter_account_usage_cache", JSON.stringify(usage));
    return usage;
  } catch {
    return cached;
  } finally {
    clearTimeout(timeout);
  }
}

function reserveHunterCredits(amount: number): boolean {
  const reserve = db.transaction(() => {
    const budget = Math.max(0, Number(getSetting("hunter_credit_budget", "40")) || 40);
    const used = Math.max(0, Number(getSetting("hunter_credits_used_by_scout", "0")) || 0);
    if (used + amount > budget) return false;
    setSetting("hunter_credits_used_by_scout", String(Number((used + amount).toFixed(1))));
    return true;
  });
  return reserve();
}

function settleHunterReservation(reserved: number, consumed: number): void {
  const settle = db.transaction(() => {
    const used = Math.max(0, Number(getSetting("hunter_credits_used_by_scout", "0")) || 0);
    setSetting(
      "hunter_credits_used_by_scout",
      String(Math.max(0, Number((used - reserved + consumed).toFixed(1)))),
    );
  });
  settle();
}

async function hunterRequest(pathname: string, parameters: Record<string, string>): Promise<unknown> {
  const waitFor = Math.max(0, lastHunterRequestAt + HUNTER_REQUEST_GAP_MS - Date.now());
  if (waitFor) await delay(waitFor);

  const url = new URL(pathname, "https://api.hunter.io");
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    lastHunterRequestAt = Date.now();
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-Key": hunterApiKey(),
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const record = asRecord(payload);
      const errors = Array.isArray(record?.errors) ? record.errors as HunterErrorItem[] : [];
      const detail = errors[0]?.details || errors[0]?.id || `Hunter returned HTTP ${response.status}`;
      throw new Error(detail);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) return isPrivateIp(normalized.slice(7));
  if (isIP(normalized) !== 4) return false;
  const parts = normalized.split(".").map(Number);
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    || parts[0] >= 224;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public HTTP websites can be researched.");
  const hostname = normalizedHost(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("The company website did not resolve to a public host.");
  }
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("The company website resolved to a private address.");
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error("The company website did not resolve to a safe public address.");
  }
}

async function fetchPublicHtml(input: URL): Promise<{ html: string; finalUrl: URL }> {
  let current = input;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(current, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "ScoutContactResearch/1.0",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("The company website returned an incomplete redirect.");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`The company website returned HTTP ${response.status}.`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_PUBLIC_HTML_LENGTH) throw new Error("The company page was too large to inspect safely.");
      const html = (await response.text()).slice(0, MAX_PUBLIC_HTML_LENGTH);
      return { html, finalUrl: current };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("The company website redirected too many times.");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function targetTitle(value: string): string {
  const match = value.match(new RegExp(`\\b(${TARGET_ROLE_PATTERN})\\b`, "i"));
  return match?.[1]?.trim() || "";
}

function isTargetTitle(value: string): boolean {
  return Boolean(targetTitle(value));
}

function isLikelyPersonName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  const parts = name.split(" ");
  if (parts.length < 2 || parts.length > 4 || name.length > 70) return false;
  if (parts.some((part) => BLOCKED_NAME_WORDS.has(part.toLowerCase()))) return false;
  return parts.every((part) => /^[A-Z][A-Za-z.'-]{1,30}$/.test(part));
}

function normalizedIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchesOrganizationName(name: string, organizationName: string): boolean {
  if (!organizationName) return false;
  const candidate = normalizedIdentity(name);
  const organization = normalizedIdentity(organizationName);
  return Boolean(candidate && organization && (candidate === organization || organization.startsWith(candidate)));
}

function findNames(value: string): string[] {
  const matches = value.match(/\b[A-Z][A-Za-z.'-]{1,30}(?:\s+[A-Z][A-Za-z.'-]{1,30}){1,3}\b/g) || [];
  return [...new Set(matches.map((item) => item.trim()).filter(isLikelyPersonName))];
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roleRelatedNames(
  line: string,
  previousLine: string,
  nextLine: string,
  title: string,
  organizationName: string,
): string[] {
  const exactTitle = escapeRegularExpression(title);
  const patterns = [
    new RegExp(`\\b(?:[Aa]ppoints?|[Nn]ames?|[Nn]amed|[Ww]elcomes?|[Hh]ires?|[Pp]romotes?)\\s+(${PERSON_NAME_PATTERN})\\s+(?:as|to)\\s+(?:its\\s+)?${exactTitle}\\b`),
    new RegExp(`\\b(${PERSON_NAME_PATTERN})\\s*(?:,|\\||:|-|is\\s+|as\\s+|serves\\s+as\\s+)${exactTitle}\\b`),
    new RegExp(`\\b${exactTitle}\\s*(?:,|\\||:|-|is\\s+)?(${PERSON_NAME_PATTERN})\\b`),
    new RegExp(`\\b(${PERSON_NAME_PATTERN})\\s+${exactTitle}\\b`),
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    const name = match?.[1]?.trim() || "";
    if (isLikelyPersonName(name) && !matchesOrganizationName(name, organizationName)) return [name];
  }

  for (const adjacent of [previousLine, nextLine]) {
    const names = findNames(adjacent).filter((name) => !matchesOrganizationName(name, organizationName));
    if (names.length === 1 && adjacent.trim() === names[0]) return names;
  }
  return [];
}

function addJsonLdCandidates(
  value: unknown,
  sourceUrl: string,
  organizationName: string,
  candidates: PublicContactCandidate[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => addJsonLdCandidates(item, sourceUrl, organizationName, candidates));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const rawType = record["@type"];
  const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType || "")];
  const name = typeof record.name === "string" ? decodeHtml(record.name).trim() : "";
  const title = typeof record.jobTitle === "string" ? decodeHtml(record.jobTitle).trim() : "";
  if (
    types.some((item) => item.toLowerCase() === "person")
    && isLikelyPersonName(name)
    && !matchesOrganizationName(name, organizationName)
    && isTargetTitle(title)
  ) {
    candidates.push({
      name,
      title,
      evidenceUrl: typeof record.url === "string" ? new URL(record.url, sourceUrl).toString() : sourceUrl,
      evidenceSummary: `${name}, ${title}`,
      source: "json_ld",
    });
  }
  Object.values(record).forEach((item) => addJsonLdCandidates(item, sourceUrl, organizationName, candidates));
}

export function findPublicPeopleFromHtml(
  html: string,
  sourceUrl: string,
  organizationName = "",
): PublicContactCandidate[] {
  const candidates: PublicContactCandidate[] = [];
  const jsonLdPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(jsonLdPattern)) {
    try {
      addJsonLdCandidates(JSON.parse(match[1]), sourceUrl, organizationName, candidates);
    } catch {
      continue;
    }
  }

  const visibleText = stripHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(?:address|article|div|h1|h2|h3|h4|li|p|section|td)>/gi, "\n"),
  );
  const lines = visibleText
    .split("\n")
    .map((line) => decodeHtml(line).replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1 && line.length < 500);

  lines.forEach((line, index) => {
    if (!isTargetTitle(line)) return;
    const title = targetTitle(line);
    const context = [lines[index - 1], line, lines[index + 1]].filter(Boolean).join(" | ");
    const names = roleRelatedNames(
      line,
      lines[index - 1] || "",
      lines[index + 1] || "",
      title,
      organizationName,
    );
    for (const name of names) {
      candidates.push({
        name,
        title,
        evidenceUrl: sourceUrl,
        evidenceSummary: truncate(context, 260),
        source: "page_text",
      });
    }
  });

  const unique = new Map<string, PublicContactCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.name.toLowerCase()}|${candidate.title.toLowerCase()}`;
    const existing = unique.get(key);
    if (!existing || candidate.source === "json_ld") unique.set(key, candidate);
  }
  return [...unique.values()];
}

function titleScore(title: string, companySize: number): number {
  const value = title.toLowerCase();
  const founder = /\bfounder\b|\bceo\b|chief executive/.test(value);
  const executiveProduct = /chief (?:product|design)|\bcpo\b|vice president|\bsvp\b|\bvp\b|head of (?:product|design)/.test(value);
  const director = /director of (?:product|design)/.test(value);
  const manager = /manager/.test(value);
  if (companySize <= 15) {
    if (founder) return 100;
    if (executiveProduct) return 92;
  } else {
    if (executiveProduct) return 100;
    if (founder) return 90;
  }
  if (director) return 86;
  if (manager) return 78;
  return 68;
}

export function rankPublicCandidates(
  candidates: PublicContactCandidate[],
  companySize: number,
): PublicContactCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: titleScore(candidate.title, companySize) + (candidate.source === "json_ld" ? 3 : 0),
    }))
    .sort((left, right) => (right.score || 0) - (left.score || 0));
}

function extractPublicLinks(html: string, baseUrl: URL): URL[] {
  const links: URL[] = [];
  const baseHost = normalizedHost(baseUrl.hostname);
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), baseUrl);
      if (normalizedHost(url.hostname) !== baseHost) continue;
      if (!/(about|author|blog|company|leadership|news|people|team)/i.test(url.pathname)) continue;
      url.hash = "";
      links.push(url);
    } catch {
      continue;
    }
  }
  const scorePath = (url: URL): number => {
    const path = url.pathname.toLowerCase();
    if (/(leadership|\/team|\/people|executive)/.test(path)) return 100;
    if (/about/.test(path)) return 90;
    if (/company/.test(path)) return 80;
    if (/(newsroom|press)/.test(path)) return 70;
    if (/author/.test(path)) return 60;
    if (/(blog|news|insights)/.test(path)) return 50;
    return 0;
  };
  return [...new Map(links.map((url) => [url.toString(), url])).values()]
    .sort((left, right) => scorePath(right) - scorePath(left))
    .slice(0, MAX_PUBLIC_PAGES - 1);
}

async function crawlPublicCompanyPeople(
  domain: string,
  organizationName: string,
): Promise<PublicContactCandidate[]> {
  const queue = [new URL(`https://${domain}`)];
  const visited = new Set<string>();
  const candidates: PublicContactCandidate[] = [];
  let pagesFetched = 0;

  while (queue.length && pagesFetched < MAX_PUBLIC_PAGES) {
    const requestedUrl = queue.shift();
    if (!requestedUrl || visited.has(requestedUrl.toString())) continue;
    if (pagesFetched) await delay(PUBLIC_REQUEST_GAP_MS);
    let page: { html: string; finalUrl: URL };
    try {
      page = await fetchPublicHtml(requestedUrl);
    } catch {
      continue;
    }
    const { html, finalUrl } = page;
    pagesFetched += 1;
    visited.add(requestedUrl.toString());
    visited.add(finalUrl.toString());
    candidates.push(...findPublicPeopleFromHtml(html, finalUrl.toString(), organizationName));
    if (pagesFetched === 1) {
      for (const link of extractPublicLinks(html, finalUrl)) {
        if (!visited.has(link.toString()) && queue.length + pagesFetched < MAX_PUBLIC_PAGES) queue.push(link);
      }
    }
  }

  return candidates;
}

function parseCompanySize(value: unknown): { label: string; maximum: number | null } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { label: String(value), maximum: Math.max(0, Math.round(value)) };
  }
  if (typeof value !== "string") return { label: "", maximum: null };
  const label = value.trim();
  if (!label) return { label: "", maximum: null };
  const numbers = label.match(/\d[\d,]*/g)?.map((item) => Number(item.replaceAll(",", ""))) || [];
  if (!numbers.length) return { label, maximum: null };
  if (/\+/.test(label)) return { label, maximum: Number.POSITIVE_INFINITY };
  return { label, maximum: Math.max(...numbers) };
}

function hunterCompanySize(payload: unknown): { label: string; maximum: number | null } {
  const data = asRecord(asRecord(payload)?.data);
  const metrics = asRecord(data?.metrics);
  return parseCompanySize(
    metrics?.employees
      ?? data?.employee_count
      ?? data?.employees
      ?? data?.company_size,
  );
}

function hunterDomain(payload: unknown): string {
  const data = asRecord(payload)?.data;
  const first = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
  const domain = typeof first?.domain === "string" ? normalizedHost(first.domain) : "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : "";
}

function companyIdentityIsAmbiguous(job: JobForContactResearch): boolean {
  const companyTokens = job.company.match(/[A-Za-z0-9]+/g) || [];
  if (companyTokens.length !== 1 || companyTokens[0].length > 5 || job.description.trim().length >= 250) return false;
  try {
    const host = normalizedHost(new URL(job.canonical_url).hostname);
    return /(indeed|jobicy|linkedin|glassdoor|builtin|ziprecruiter)/.test(host);
  } catch {
    return true;
  }
}

export function validateHunterEmailCandidate(input: {
  email: string;
  confidence: number | null;
  verificationStatus: string;
  personName: string;
  companyName: string;
}): { accepted: boolean; reason: string } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { accepted: false, reason: "Hunter did not return a valid email address." };
  }
  const local = email.split("@")[0];
  const normalizedLocal = normalizedIdentity(local);
  const genericLocal = /^(admin|careers?|contact|hello|help|hiring|hr|info|jobs?|office|press|recruiting|sales|support|team)$/i.test(local);
  if (genericLocal || normalizedLocal === normalizedIdentity(input.companyName)) {
    return { accepted: false, reason: "Hunter returned a generic or company-name email pattern, so Scout rejected it." };
  }
  const nameParts = input.personName
    .split(/\s+/)
    .map(normalizedIdentity)
    .filter((part) => part.length >= 2);
  const nameAppearsInEmail = nameParts.some((part) => normalizedLocal.includes(part));
  const verified = input.verificationStatus.toLowerCase() === "valid";
  if (!verified && (input.confidence === null || input.confidence < 75 || !nameAppearsInEmail)) {
    return { accepted: false, reason: "Hunter returned an inferred email below Scout's 75% confidence requirement." };
  }
  return { accepted: true, reason: "" };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "The research request timed out.";
  if (error instanceof Error) return truncate(error.message, 280);
  return "Contact research failed unexpectedly.";
}

export async function searchContactForJob(jobId: number): Promise<void> {
  const job = db.prepare("SELECT id, company, title, description, canonical_url FROM jobs WHERE id = ?").get(jobId) as JobForContactResearch | undefined;
  if (!job) return;

  const existing = db.prepare("SELECT status, email FROM contact_research WHERE job_id = ?").get(jobId) as {
    status: string;
    email: string;
  } | undefined;
  if (existing?.status === "found" && existing.email) return;

  db.prepare(`
    INSERT INTO contact_research (job_id, status, searched_at)
    VALUES (?, 'searching', CURRENT_TIMESTAMP)
    ON CONFLICT(job_id) DO UPDATE SET
      status = 'searching',
      last_error = '',
      searched_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(jobId);

  if (!hunterConfigured()) {
    db.prepare("UPDATE contact_research SET status = 'not_configured', last_error = 'HUNTER_API_KEY is not configured.', updated_at = CURRENT_TIMESTAMP WHERE job_id = ?").run(jobId);
    return;
  }
  if (!reserveHunterCredits(HUNTER_WORKFLOW_RESERVATION)) {
    db.prepare("UPDATE contact_research SET status = 'budget_exhausted', last_error = 'Scout reached the local Hunter budget.', updated_at = CURRENT_TIMESTAMP WHERE job_id = ?").run(jobId);
    return;
  }

  let consumedCredits = 0;
  try {
    const domainPayload = await hunterRequest("/v2/domain-finder", {
      company: job.company,
      limit: "1",
      perfect_match: "true",
    });
    const domain = hunterDomain(domainPayload);
    if (!domain) {
      db.prepare("UPDATE contact_research SET status = 'domain_not_found', last_error = 'No confident company domain was found.', updated_at = CURRENT_TIMESTAMP WHERE job_id = ?").run(jobId);
      return;
    }
    if (companyIdentityIsAmbiguous(job)) {
      db.prepare(`
        UPDATE contact_research SET
          status = 'domain_ambiguous', company_domain = '',
          last_error = 'The source supplied an ambiguous company name without enough job context. Scout stopped before using a paid email lookup.',
          updated_at = CURRENT_TIMESTAMP
        WHERE job_id = ?
      `).run(jobId);
      return;
    }

    let companySize = { label: "", maximum: null as number | null };
    try {
      const enrichmentPayload = await hunterRequest("/v2/companies/find", { domain });
      consumedCredits += HUNTER_COMPANY_ENRICHMENT_CREDITS;
      companySize = hunterCompanySize(enrichmentPayload);
    } catch {
      companySize = { label: "", maximum: null };
    }
    db.prepare(`
      UPDATE contact_research SET
        company_domain = ?, company_size = ?, company_size_label = ?,
        provider = ?, updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `).run(
      domain,
      Number.isFinite(companySize.maximum) ? companySize.maximum : null,
      companySize.label,
      companySize.label ? "Hunter company enrichment" : "Hunter Domain Finder",
      jobId,
    );

    const rankingSize = companySize.maximum ?? 51;
    const rankedCandidates = rankPublicCandidates(
      await crawlPublicCompanyPeople(domain, job.company),
      rankingSize,
    );
    const selected = rankedCandidates[0];
    if (!selected) {
      db.prepare(`
        UPDATE contact_research SET
          status = 'no_public_contact', candidates_json = '[]',
          last_error = 'No evidence-backed product, design, or founder contact was found on public company pages.',
          updated_at = CURRENT_TIMESTAMP
        WHERE job_id = ?
      `).run(jobId);
      return;
    }

    db.prepare(`
      UPDATE contact_research SET
        person_name = ?, person_title = ?, evidence_url = ?, evidence_summary = ?,
        candidates_json = ?, status = 'resolving_email', updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `).run(
      selected.name,
      selected.title,
      selected.evidenceUrl,
      selected.evidenceSummary,
      JSON.stringify(rankedCandidates.slice(0, 8)),
      jobId,
    );

    const emailPayload = await hunterRequest("/v2/email-finder", {
      domain,
      full_name: selected.name,
    });
    const emailData = asRecord(asRecord(emailPayload)?.data);
    const email = typeof emailData?.email === "string" ? emailData.email.trim() : "";
    const confidence = typeof emailData?.score === "number" ? Math.round(emailData.score) : null;
    const verification = asRecord(emailData?.verification);
    const verificationStatus = typeof verification?.status === "string" ? verification.status : "";
    if (!email) {
      db.prepare("UPDATE contact_research SET status = 'no_email', last_error = 'A public person was found, but Hunter did not return an email.', updated_at = CURRENT_TIMESTAMP WHERE job_id = ?").run(jobId);
      return;
    }
    consumedCredits += HUNTER_EMAIL_FINDER_CREDITS;
    const emailValidation = validateHunterEmailCandidate({
      email,
      confidence,
      verificationStatus,
      personName: selected.name,
      companyName: job.company,
    });
    if (!emailValidation.accepted) {
      db.prepare(`
        UPDATE contact_research SET
          status = 'email_unverified', email = '', email_confidence = ?,
          provider = 'Public evidence and Hunter Email Finder',
          last_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE job_id = ?
      `).run(confidence, emailValidation.reason, jobId);
      return;
    }
    db.prepare(`
      UPDATE contact_research SET
        status = 'found', email = ?, email_confidence = ?, provider = 'Public evidence and Hunter Email Finder',
        last_error = '', updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `).run(email, confidence, jobId);
    db.prepare(`
      UPDATE applications SET
        contact_name = ?, contact_details = ?, updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
    `).run(selected.name, email, jobId);
  } catch (error) {
    db.prepare("UPDATE contact_research SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?").run(
      errorMessage(error),
      jobId,
    );
  } finally {
    settleHunterReservation(HUNTER_WORKFLOW_RESERVATION, consumedCredits);
    db.prepare("UPDATE contact_research SET credits_used = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?").run(
      consumedCredits,
      jobId,
    );
  }
}
