import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { db } from "@/lib/database";
import { stripHtml } from "@/lib/utils";

const PARSER_VERSION = 5;
const MAX_MESSAGES_PER_RUN = 50;

export interface GmailAlertJob {
  externalId: string;
  sourceName: string;
  sourceType: "gmail_indeed" | "gmail_builtin" | "gmail_alert";
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

export interface GmailProcessedMessage {
  uid: number;
  messageIdHash: string;
  jobsFound: number;
}

export interface GmailAlertFetchResult {
  jobs: GmailAlertJob[];
  messagesAvailable: number;
  messagesProcessed: number;
  messagesSkipped: number;
  processedMessages: GmailProcessedMessage[];
  label: string;
}

export interface GmailConfiguration {
  configured: boolean;
  label: string;
  missing: string[];
}

interface EmailAnchor {
  index: number;
  endIndex: number;
  href: string;
  text: string;
}

interface ParsedAlertInput {
  html: string;
  text: string;
  subject: string;
  from: string;
  date: Date | null;
}

function cleanEnvironmentValue(value: string | undefined): string {
  return String(value || "").trim();
}

export function gmailConfiguration(): GmailConfiguration {
  const address = cleanEnvironmentValue(process.env.SCOUT_GMAIL_ADDRESS);
  const password = cleanEnvironmentValue(process.env.SCOUT_GMAIL_APP_PASSWORD).replace(/\s+/g, "");
  const label = cleanEnvironmentValue(process.env.SCOUT_GMAIL_LABEL) || "Scout Job Alert";
  const missing: string[] = [];
  if (!address) missing.push("SCOUT_GMAIL_ADDRESS");
  if (!password) missing.push("SCOUT_GMAIL_APP_PASSWORD");
  if (!label) missing.push("SCOUT_GMAIL_LABEL");
  return { configured: missing.length === 0, label, missing };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function cleanInlineText(value: string): string {
  return decodeHtmlEntities(stripHtml(value))
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToLines(value: string): string[] {
  return decodeHtmlEntities(value)
    .replace(/<\/(?:div|td|tr|table|h[1-6]|section|article|span)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractAnchors(html: string): EmailAnchor[] {
  const anchors: EmailAnchor[] = [];
  const pattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    if (match.index === undefined) continue;
    anchors.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      href: decodeHtmlEntities(match[2]).trim(),
      text: cleanInlineText(match[3]),
    });
  }
  return anchors;
}

function nestedDestination(url: URL): string | null {
  const keys = ["url", "u", "q", "redirect", "redirect_url", "destination", "dest", "target", "continue"];
  for (const key of keys) {
    const candidate = url.searchParams.get(key);
    if (!candidate) continue;
    try {
      const decoded = decodeURIComponent(candidate);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch {
      if (/^https?:\/\//i.test(candidate)) return candidate;
    }
  }
  return null;
}

function pathDestination(url: URL): string | null {
  if (!url.hostname.toLowerCase().endsWith(".awstrack.me")) return null;
  for (const segment of url.pathname.split("/").filter(Boolean)) {
    let decoded = segment;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    if (/^https?:\/\//i.test(decoded)) return decoded;
  }
  return null;
}

function canonicalizeJobUrl(value: string): string | null {
  let candidate = value.trim().replace(/^<|>$/g, "");
  for (let depth = 0; depth < 3; depth += 1) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }
    const nested = nestedDestination(parsed) || pathDestination(parsed);
    if (!nested || nested === candidate) break;
    candidate = nested;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "indeed.com" || host.endsWith(".indeed.com")) {
    const jobKey = url.searchParams.get("jk") || url.searchParams.get("vjk");
    if (jobKey) return `https://www.indeed.com/viewjob?jk=${encodeURIComponent(jobKey)}`;
  }

  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|from$|source$|campaign$|tracking|trk$|ref$|preference_id$|i$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

function isJobUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const path = `${url.pathname}${url.search}`.toLowerCase();
  if (host === "cts.indeed.com") return /^\/v\d+\//.test(url.pathname);
  if (host === "indeed.com" || host.endsWith(".indeed.com")) {
    return /(?:viewjob|\/rc\/clk|\/pagead\/clk|[?&](?:jk|vjk)=)/.test(path);
  }
  if (host === "builtin.com" || host.endsWith(".builtin.com")) return /\/job\//.test(path);
  return /\/(?:jobs?|positions?|careers?|openings?)\//.test(path);
}

function isGenericAction(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return !normalized
    || /^(?:apply|apply now|view|view job|view jobs|see job|see jobs|learn more|read more|details|company|jobs|job alert|manage alerts|unsubscribe|yes|no|indeed|help center|edit profile|manage email settings|pause these emails|this is a bad match)$/.test(normalized)
    || /(?:privacy|terms|preferences|sign in|download the app|salary guide|career advice|no longer looking for a job|keep your indeed profile up to date|minimum base pay)/.test(normalized);
}

function looksLikeJobTitle(value: string): boolean {
  if (isGenericAction(value) || value.length < 3 || value.length > 140) return false;
  const words = value.split(/\s+/);
  if (words.length > 18) return false;
  return /[a-z]/i.test(value) && !/[.!?].+[.!?]/.test(value);
}

function titleFromLines(lines: string[]): string {
  return lines.find((line) =>
    looksLikeJobTitle(line)
    && /\b(?:product|design|designer|ux|ui|research|researcher|engineer|developer|manager|analyst)\b/i.test(line)
  ) || "";
}

const locationPattern = /\b(?:remote|hybrid|united states|usa|u\.s\.|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b)/i;

function extractLocation(lines: string[]): string {
  return lines.find((line) => line.length <= 120 && locationPattern.test(line)) || "";
}

function extractCompany(lines: string[], title: string, location: string): string {
  const titleIndex = lines.findIndex((line) => line.toLowerCase() === title.toLowerCase());
  const ordered = titleIndex >= 0
    ? [...lines.slice(titleIndex + 1), ...lines.slice(0, titleIndex)]
    : lines;
  const candidate = ordered.find((line) => {
    if (line === location || line.toLowerCase() === title.toLowerCase()) return false;
    if (line.length < 2 || line.length > 90 || isGenericAction(line)) return false;
    if (locationPattern.test(line) || /(?:\$|salary|per year|an hour|ago|today|easily apply)/i.test(line)) return false;
    if (/[.!?]$/.test(line) && line.split(/\s+/).length > 8) return false;
    return true;
  });
  return candidate || "Company not listed";
}

function normalizeJobTitle(value: string, company: string, location: string): string {
  let title = value.replace(/\s+/g, " ").trim();
  if (company !== "Company not listed" && title.toLowerCase().startsWith(company.toLowerCase())) {
    title = title.slice(company.length).trim();
  }
  const stopPatterns = [
    location,
    "In Office",
    "On-site",
    "Onsite",
    "Hybrid",
    "Remote",
  ].filter(Boolean);
  for (const stop of stopPatterns) {
    const index = title.toLowerCase().indexOf(stop.toLowerCase());
    if (index > 2) title = title.slice(0, index).trim();
  }
  title = title.replace(/\s+\$\s*\d[\s\S]*$/, "").trim();
  return title || value;
}

function repairBuiltInIdentity(company: string, title: string): { company: string; title: string } {
  const corruptedCompany = /(?:product designer|style=|display:|white-space|pen-to-square|<\/|<div|^iv\b)/i.test(company);
  if (!corruptedCompany) return { company, title };
  const roleStart = title.search(/\b(?:senior|staff|principal|founding|lead|innovation|product|ux|ui)\b[\s\S]*\bdesigner\b/i);
  if (roleStart <= 0) return { company, title };
  const repairedCompany = title.slice(0, roleStart).replace(/[,:|\s]+$/, "").trim();
  const repairedTitle = title.slice(roleStart).trim();
  if (!repairedCompany || !repairedTitle) return { company, title };
  return { company: repairedCompany, title: repairedTitle };
}

function extractSalary(text: string): { minimum: number | null; maximum: number | null } {
  const values = [...text.matchAll(/\$\s*(\d{2,3})(?:,\d{3})?(?:\s*[kK])?/g)]
    .map((match) => {
      const raw = match[0];
      const value = Number(match[1]);
      if (!Number.isFinite(value)) return null;
      return /[kK]/.test(raw) || value < 1_000 ? value * 1_000 : value;
    })
    .filter((value): value is number => value !== null && value >= 20_000 && value <= 1_000_000);
  return {
    minimum: values.length ? Math.min(...values) : null,
    maximum: values.length > 1 ? Math.max(...values) : values[0] || null,
  };
}

function inferSource(input: ParsedAlertInput, url: string): Pick<GmailAlertJob, "sourceName" | "sourceType"> {
  const evidence = `${input.from} ${input.subject} ${url}`.toLowerCase();
  if (evidence.includes("indeed")) return { sourceName: "Indeed email alert", sourceType: "gmail_indeed" };
  if (evidence.includes("builtin")) return { sourceName: "BuiltIn email alert", sourceType: "gmail_builtin" };
  return { sourceName: "Gmail job alert", sourceType: "gmail_alert" };
}

function buildJob(
  input: ParsedAlertInput,
  anchor: EmailAnchor,
  lines: string[],
): GmailAlertJob | null {
  const canonicalUrl = canonicalizeJobUrl(anchor.href);
  if (!canonicalUrl || !isJobUrl(canonicalUrl)) return null;
  if (new URL(canonicalUrl).hostname.toLowerCase() === "cts.indeed.com" && !looksLikeJobTitle(anchor.text)) return null;
  const rawTitle = looksLikeJobTitle(anchor.text) ? anchor.text : titleFromLines(lines);
  if (!rawTitle) return null;
  const location = extractLocation(lines);
  let company = extractCompany(lines, rawTitle, location);
  let title = normalizeJobTitle(rawTitle, company, location);
  const context = lines.join("\n").slice(0, 6_000);
  const salary = extractSalary(context);
  const workplaceType = /\bremote\b/i.test(context) ? "remote" : /\bhybrid\b/i.test(context) ? "hybrid" : "unspecified";
  const employmentType = /\bfull[- ]time\b/i.test(context)
    ? "Full-time"
    : /\bpart[- ]time\b/i.test(context)
      ? "Part-time"
      : /\bcontract\b/i.test(context)
        ? "Contract"
        : "";
  const source = inferSource(input, canonicalUrl);
  if (source.sourceType === "gmail_builtin") {
    const repaired = repairBuiltInIdentity(company, title);
    company = repaired.company;
    title = repaired.title;
  }
  const externalId = createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24);
  return {
    externalId,
    ...source,
    company,
    title,
    location,
    workplaceType,
    employmentType,
    salaryMin: salary.minimum,
    salaryMax: salary.maximum,
    salaryCurrency: salary.minimum !== null ? "USD" : "",
    description: context || `${title}\n${company}\n${location}`,
    canonicalUrl,
    applyUrl: canonicalUrl,
    postedAt: input.date?.toISOString() || null,
  };
}

export function parseJobAlertEmail(input: ParsedAlertInput): GmailAlertJob[] {
  const html = input.html || "";
  const anchors = extractAnchors(html)
    .map((anchor) => ({ ...anchor, href: canonicalizeJobUrl(anchor.href) || anchor.href }))
    .filter((anchor) => isJobUrl(anchor.href));
  const candidates: GmailAlertJob[] = [];

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const previous = anchors[index - 1];
    const next = anchors[index + 1];
    const start = Math.max(previous?.endIndex || 0, anchor.index - 1_200);
    const end = Math.min(next?.index || html.length, anchor.endIndex + 2_400);
    const lines = htmlToLines(html.slice(start, end));
    const job = buildJob(input, anchor, lines);
    if (job) candidates.push(job);
  }

  if (!candidates.length && input.text) {
    const lines = input.text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const urls = lines[index].match(/https?:\/\/[^\s<>()]+/g) || [];
      for (const url of urls) {
        const anchor: EmailAnchor = {
          index: index,
          endIndex: index,
          href: url.replace(/[),.;]+$/, ""),
          text: lines[index - 1] || "",
        };
        const contextLines = lines.slice(Math.max(0, index - 5), index + 8);
        const job = buildJob(input, anchor, contextLines);
        if (job) candidates.push(job);
      }
    }
  }

  return [...new Map(candidates.map((job) => [`${job.sourceType}:${job.externalId}`, job])).values()];
}

export async function fetchGmailAlertJobs(): Promise<GmailAlertFetchResult> {
  const configuration = gmailConfiguration();
  if (!configuration.configured) {
    throw new Error(`Gmail alerts are missing ${configuration.missing.join(", ")}.`);
  }

  const address = cleanEnvironmentValue(process.env.SCOUT_GMAIL_ADDRESS);
  const password = cleanEnvironmentValue(process.env.SCOUT_GMAIL_APP_PASSWORD).replace(/\s+/g, "");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: address, pass: password },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(configuration.label);
  try {
    const allUids = await client.search({ all: true }, { uid: true });
    const availableUids = Array.isArray(allUids) ? allUids : [];
    const processed = db.prepare(`
      SELECT 1 FROM gmail_processed_messages
      WHERE mailbox = ? AND uid = ? AND parser_version = ?
    `);
    const pendingUids = availableUids
      .filter((uid) => !processed.get(configuration.label, uid, PARSER_VERSION))
      .slice(-MAX_MESSAGES_PER_RUN);
    if (!pendingUids.length) {
      return {
        jobs: [],
        messagesAvailable: availableUids.length,
        messagesProcessed: 0,
        messagesSkipped: availableUids.length,
        processedMessages: [],
        label: configuration.label,
      };
    }

    const jobs: GmailAlertJob[] = [];
    const processedMessages: GmailProcessedMessage[] = [];
    for await (const message of client.fetch(pendingUids, { uid: true, source: true }, { uid: true })) {
      if (!message.source) continue;
      const parsed = await simpleParser(message.source);
      const parsedJobs = parseJobAlertEmail({
        html: typeof parsed.html === "string" ? parsed.html : "",
        text: parsed.text || "",
        subject: parsed.subject || "",
        from: parsed.from?.text || "",
        date: parsed.date || null,
      });
      jobs.push(...parsedJobs);
      processedMessages.push({
        uid: message.uid,
        messageIdHash: createHash("sha256").update(parsed.messageId || `${configuration.label}:${message.uid}`).digest("hex"),
        jobsFound: parsedJobs.length,
      });
    }

    return {
      jobs: [...new Map(jobs.map((job) => [`${job.sourceType}:${job.externalId}`, job])).values()],
      messagesAvailable: availableUids.length,
      messagesProcessed: processedMessages.length,
      messagesSkipped: availableUids.length - processedMessages.length,
      processedMessages,
      label: configuration.label,
    };
  } finally {
    lock.release();
    await client.logout();
  }
}

export function markGmailMessagesProcessed(label: string, messages: GmailProcessedMessage[]): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO gmail_processed_messages (
      mailbox, uid, parser_version, message_id_hash, jobs_found, processed_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const save = db.transaction(() => {
    for (const message of messages) {
      insert.run(label, message.uid, PARSER_VERSION, message.messageIdHash, message.jobsFound);
    }
  });
  save();
}
