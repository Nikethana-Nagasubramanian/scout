import { db } from "@/lib/database";
import type { Job } from "@/lib/types";

/** Below this, a stored description is treated as an excerpt worth re-fetching from the posting. */
export const THIN_DESCRIPTION_LENGTH = 1_500;
const MAX_DESCRIPTION_LENGTH = 24_000;

export function cleanDescriptionText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Only https, and never a private host: these URLs come from third-party feeds. */
export function safeLiveUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (
      host === "localhost"
      || host.endsWith(".local")
      || /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

interface ExtractedDescription {
  text: string;
  /** True only when the text came from a JobPosting JSON-LD block. */
  structured: boolean;
}

/** Flatten a JSON-LD document into its nodes: some sites wrap the posting in @graph. */
function jsonLdNodes(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) return parsed.flatMap(jsonLdNodes);
  if (!parsed || typeof parsed !== "object") return [];
  const node = parsed as Record<string, unknown>;
  const graph = node["@graph"];
  return graph ? [node, ...jsonLdNodes(graph)] : [node];
}

export function jobPostingDescription(html: string): ExtractedDescription {
  // BuiltIn serves type="application/ld&#x2B;json", so the "+" has to tolerate entities.
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld(?:\+|&#x2b;|&#43;)json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const posting = jsonLdNodes(JSON.parse(decodeHtml(match[1])))
        .find((candidate) => candidate["@type"] === "JobPosting");
      if (posting && typeof posting.description === "string") {
        return { text: cleanDescriptionText(decodeHtml(posting.description)), structured: true };
      }
    } catch {
      continue;
    }
  }
  return {
    text: cleanDescriptionText(decodeHtml(html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " "))),
    structured: false,
  };
}

/**
 * Feeds vary wildly: ATS boards return the full posting while aggregators and Gmail
 * alerts often return an excerpt. Re-fetch the posting when what we stored looks thin.
 * Returns the job unchanged on any failure - a short description is never fatal.
 */
export interface EnrichedJob {
  job: Job;
  /** Whether the new text is trustworthy enough to store and score against. */
  structured: boolean;
}

export async function enrichJobDescription(job: Job): Promise<EnrichedJob> {
  if (cleanDescriptionText(job.description).length >= THIN_DESCRIPTION_LENGTH) return { job, structured: false };
  const url = safeLiveUrl(job.canonical_url || job.apply_url);
  if (!url) return { job, structured: false };
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Scout local job search copilot" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { job, structured: false };
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/json")) return { job, structured: false };
    const extracted = jobPostingDescription((await response.text()).slice(0, 750_000));
    if (extracted.text.length <= cleanDescriptionText(job.description).length) return { job, structured: false };
    return {
      job: { ...job, description: extracted.text.slice(0, MAX_DESCRIPTION_LENGTH) },
      structured: extracted.structured,
    };
  } catch {
    return { job, structured: false };
  }
}

/**
 * Enrich and persist. Scoring and resume tailoring both read jobs.description, so a
 * description recovered once should improve every later match rather than being thrown away.
 */
export async function ensureStoredJobDescription(job: Job): Promise<{ job: Job; enriched: boolean }> {
  const { job: enrichedJob, structured } = await enrichJobDescription(job);
  if (enrichedJob.description === job.description) return { job, enriched: false };
  // Only JSON-LD text is stored. The raw-HTML fallback picks up site navigation and
  // cookie banners, and writing that into jobs.description would poison scoring and
  // resume tailoring, which both keyword-match against it.
  if (!structured) return { job: enrichedJob, enriched: false };
  db.prepare("UPDATE jobs SET description = ? WHERE id = ?").run(enrichedJob.description, job.id);
  return { job: enrichedJob, enriched: true };
}
