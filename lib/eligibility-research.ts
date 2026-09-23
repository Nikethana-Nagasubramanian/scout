import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { db } from "@/lib/database";
import { cleanDescriptionText, safeLiveUrl } from "@/lib/job-description";
import { anthropicApiKey, modelFor } from "@/lib/llm";
import { sponsorshipFromPosting } from "@/lib/sponsorship-text";
import type { Job } from "@/lib/types";

/**
 * The one genuinely agentic step in Scout.
 *
 * Whether a company sponsors visas is usually not in the posting at all - it lives on a
 * careers page, an FAQ, or nowhere. There is no fixed number of pages to read, so the
 * model decides where to look. What keeps that honest is that it may only answer with a
 * quote, and the quote is re-fetched and checked by code afterwards: a finding whose
 * quote is not actually on the page it cites is marked unverified and never trusted.
 *
 * Everything here proposes. Nothing here changes a job's eligibility - that stays a
 * decision the user makes from the finding.
 */

export type EligibilityQuestion = "us_eligibility" | "clearance";

export const ELIGIBILITY_VERDICTS = [
  "sponsors",
  "no_sponsorship",
  "us_work_authorization_required",
  "clearance_required",
  "no_clearance_required",
  "unknown",
] as const;

export type EligibilityVerdict = typeof ELIGIBILITY_VERDICTS[number];

export interface EligibilityFinding {
  jobId: number;
  question: EligibilityQuestion;
  verdict: EligibilityVerdict;
  quote: string;
  sourceUrl: string;
  reasoning: string;
  quoteVerified: boolean;
  pagesRead: number;
  model: string;
  /** Summed across every turn, so the cost of a run is a measured number not a guess. */
  inputTokens: number;
  outputTokens: number;
}

/** Hard ceilings, because an agent with a fetch tool will happily read the whole internet. */
const MAX_PAGES = 6;
const PAGE_CHARS = 12_000;
const POSTING_CHARS = 8_000;
const MAX_TOKENS = 4_096;
const FETCH_TIMEOUT_MS = 15_000;

const QUESTION_PROMPTS: Record<EligibilityQuestion, string> = {
  us_eligibility:
    "Does this role require existing US work authorization, or will the company sponsor a visa?",
  clearance:
    "Does this role require a US security clearance or carry an export control (ITAR/EAR) restriction?",
};

/**
 * Language that appears on nearly every US posting and proves nothing either way.
 * I-9 wording is federal hiring boilerplate, not a sponsorship policy; an LCA notice is a
 * posting obligation showing a company once filed a petition, not an offer to sponsor
 * this role. Both read as strong evidence to a model, so they are rejected in code.
 */
const BOILERPLATE_PATTERNS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /verify identity and eligibility to work/i, why: "I-9 verification boilerplate" },
  { pattern: /employment eligibility verification/i, why: "I-9 verification boilerplate" },
  { pattern: /form i-?9\b/i, why: "I-9 verification boilerplate" },
  { pattern: /e-?verify/i, why: "E-Verify participation notice" },
  { pattern: /labor condition application/i, why: "LCA public notice, not a sponsorship offer" },
  { pattern: /equal opportunity employer/i, why: "EEO boilerplate" },
  // An application form asking about sponsorship is a screening question, not a policy.
  { pattern: /\bare you (?:currently |legally )?(?:authorized|eligible)\b/i, why: "application form question, not a policy" },
  { pattern: /\bwill you (?:now or in the future )?require\b/i, why: "application form question, not a policy" },
  { pattern: /\bdo you (?:now or in the future )?(?:require|need)\b/i, why: "application form question, not a policy" },
];

export function boilerplateReason(quote: string): string | null {
  return BOILERPLATE_PATTERNS.find((entry) => entry.pattern.test(quote))?.why || null;
}

function normalizeForMatch(value: string): string {
  return cleanDescriptionText(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchPageText(url: URL): Promise<{ text: string; links: string[] } | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Scout local job search copilot" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
    const html = (await response.text()).slice(0, 750_000);
    const body = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
    const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)]
      .map((match) => {
        try {
          return new URL(match[1], url).toString();
        } catch {
          return "";
        }
      })
      .filter((link) => link.startsWith("https://"));
    return { text: cleanDescriptionText(body).slice(0, PAGE_CHARS), links: [...new Set(links)] };
  } catch {
    return null;
  }
}

/** Re-fetch the cited page and confirm the quote is really there. Code checks, not the model. */
async function verifyQuote(quote: string, sourceUrl: string): Promise<boolean> {
  const needle = normalizeForMatch(quote);
  if (needle.length < 12) return false;
  const url = safeLiveUrl(sourceUrl);
  if (!url) return false;
  const page = await fetchPageText(url);
  if (!page) return false;
  return normalizeForMatch(page.text).includes(needle);
}

export interface ResearchOptions {
  question?: EligibilityQuestion;
  /** Logs every tool call, so the agent's choices are visible rather than assumed. */
  onTrace?: (line: string) => void;
}

export async function researchJobEligibility(job: Job, options: ResearchOptions = {}): Promise<EligibilityFinding> {
  const { question = "us_eligibility", onTrace } = options;

  // Most postings that have a policy just state it. Reading that costs nothing, so the
  // model is never asked a question the text in hand already answers.
  if (question === "us_eligibility") {
    const stated = sponsorshipFromPosting(job.description);
    if (stated) {
      onTrace?.(`  posting states it, no research needed`);
      return {
        jobId: job.id,
        question,
        verdict: stated.verdict,
        quote: stated.quote,
        sourceUrl: job.canonical_url || job.apply_url || "",
        reasoning: "Stated directly in the job posting.",
        quoteVerified: true,
        pagesRead: 0,
        model: "deterministic",
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }

  const apiKey = anthropicApiKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = modelFor("anthropic");
  const client = new Anthropic({ apiKey });

  interface SubmittedFinding {
    verdict: EligibilityVerdict;
    quote: string;
    sourceUrl: string;
    reasoning: string;
  }

  let pagesRead = 0;
  let submitted: SubmittedFinding | null = null;

  const readPage = betaZodTool({
    name: "read_page",
    description:
      "Fetch one https page and return its visible text plus the links it contains. "
      + "Use it to open a company careers page, an FAQ, or a job posting. "
      + "Returns an error string if the page cannot be read.",
    inputSchema: z.object({
      url: z.string().describe("Absolute https URL to read."),
    }),
    run: async ({ url }) => {
      if (pagesRead >= MAX_PAGES) return `Page budget of ${MAX_PAGES} reached. Answer with what you have, or unknown.`;
      const safe = safeLiveUrl(url);
      if (!safe) return "That URL cannot be read: only public https URLs are allowed.";
      pagesRead += 1;
      onTrace?.(`  read_page(${safe.hostname}${safe.pathname})`);
      const page = await fetchPageText(safe);
      if (!page) return `Could not read ${safe.toString()}.`;
      const links = page.links.slice(0, 40).join("\n");
      return `TEXT:\n${page.text}\n\nLINKS:\n${links}`;
    },
  });

  const submitFinding = betaZodTool({
    name: "submit_finding",
    description:
      "Record the answer and finish. Every verdict other than 'unknown' must include an exact "
      + "quote copied verbatim from a page you read, and the URL you read it on. "
      + "If you did not find explicit wording, answer 'unknown' with an empty quote - that is a "
      + "correct and useful answer, and guessing is not.",
    inputSchema: z.object({
      verdict: z.enum(ELIGIBILITY_VERDICTS),
      quote: z.string().describe("Exact sentence from the source page, copied character for character. Empty when the verdict is unknown."),
      source_url: z.string().describe("The page the quote came from. Empty when the verdict is unknown."),
      reasoning: z.string().describe("One sentence explaining what the quote establishes."),
    }),
    run: async ({ verdict, quote, source_url, reasoning }) => {
      submitted = { verdict, quote: quote.trim(), sourceUrl: source_url.trim(), reasoning: reasoning.trim() };
      onTrace?.(`  submit_finding(${verdict})`);
      return "Recorded.";
    },
  });

  const postingUrl = job.canonical_url || job.apply_url;
  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: MAX_TOKENS,
    tools: [readPage, submitFinding],
    system:
      "You research one factual question about a job posting for a candidate, using only pages you actually read.\n"
      + "Rules:\n"
      + "- Never state a fact you have not read. No inference from company size, industry, or reputation.\n"
      + "- A quote must be copied exactly from the page text you were given, not paraphrased.\n"
      + "- 'unknown' is the right answer whenever the wording is not explicit. Most companies say nothing.\n"
      + "- These do NOT answer the question and must never be quoted as evidence: I-9 or E-Verify wording "
      + "('verify identity and eligibility to work in the United States'), Labor Condition Application "
      + "notices, and equal opportunity statements. Every US employer publishes these.\n"
      + "- Evidence looks like an explicit policy: 'we do not sponsor employment visas', 'visa sponsorship "
      + "available', 'must be authorized to work in the US without sponsorship'.\n"
      + `- You may read at most ${MAX_PAGES} pages. Start with the posting, then the company careers or FAQ pages.\n`
      + "- Finish by calling submit_finding exactly once.",
    messages: [{
      role: "user",
      content: [
        `Question: ${QUESTION_PROMPTS[question]}`,
        "",
        `Company: ${job.company}`,
        `Role: ${job.title}`,
        `Location: ${job.location || "not stated"}`,
        `Posting URL: ${postingUrl || "not available"}`,
        "",
        "Posting text Scout already has:",
        cleanDescriptionText(job.description).slice(0, POSTING_CHARS) || "(none stored)",
      ].join("\n"),
    }],
  });

  let inputTokens = 0;
  let outputTokens = 0;
  for await (const message of runner) {
    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;
  }

  // The tool callback assigns this, which control-flow analysis cannot see from here.
  const finding = submitted as SubmittedFinding | null;
  if (!finding) {
    return {
      jobId: job.id,
      question,
      verdict: "unknown",
      quote: "",
      sourceUrl: "",
      reasoning: "The research run ended without recording a finding.",
      quoteVerified: false,
      pagesRead,
      model,
      inputTokens,
      outputTokens,
    };
  }

  // Boilerplate is rejected before the quote is even checked: it is real text that
  // means nothing, which is worse than a quote that fails to verify.
  const boilerplate = finding.verdict === "unknown" ? null : boilerplateReason(finding.quote);
  if (boilerplate) {
    return {
      jobId: job.id,
      question,
      verdict: "unknown",
      quote: "",
      sourceUrl: "",
      reasoning: `Rejected: the only evidence found was ${boilerplate}, which every US employer publishes.`,
      quoteVerified: false,
      pagesRead,
      model,
      inputTokens,
      outputTokens,
    };
  }

  const quoteVerified = finding.verdict !== "unknown" && Boolean(finding.quote) && Boolean(finding.sourceUrl)
    ? await verifyQuote(finding.quote, finding.sourceUrl)
    : false;

  return { jobId: job.id, question, ...finding, quoteVerified, pagesRead, model, inputTokens, outputTokens };
}

export function saveEligibilityFinding(finding: EligibilityFinding): void {
  db.prepare(`
    INSERT INTO eligibility_findings
      (job_id, question, verdict, quote, source_url, quote_verified, reasoning, model, pages_read, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed')
    ON CONFLICT(job_id, question) DO UPDATE SET
      verdict = excluded.verdict,
      quote = excluded.quote,
      source_url = excluded.source_url,
      quote_verified = excluded.quote_verified,
      reasoning = excluded.reasoning,
      model = excluded.model,
      pages_read = excluded.pages_read,
      status = 'proposed',
      created_at = CURRENT_TIMESTAMP
  `).run(
    finding.jobId,
    finding.question,
    finding.verdict,
    finding.quote,
    finding.sourceUrl,
    finding.quoteVerified ? 1 : 0,
    finding.reasoning,
    finding.model,
    finding.pagesRead,
  );
}

export interface ProposedFinding {
  id: number;
  job_id: number;
  question: EligibilityQuestion;
  verdict: EligibilityVerdict;
  quote: string;
  source_url: string;
  quote_verified: number;
  reasoning: string;
  model: string;
  pages_read: number;
}

/** Only findings that actually say something: an "unknown" is not worth a decision. */
export function proposedFindingsByJob(): Map<number, ProposedFinding> {
  const rows = db.prepare(`
    SELECT id, job_id, question, verdict, quote, source_url, quote_verified, reasoning, model, pages_read
    FROM eligibility_findings
    WHERE status = 'proposed' AND verdict != 'unknown'
    ORDER BY id
  `).all() as ProposedFinding[];
  return new Map(rows.map((row) => [row.job_id, row]));
}

export function findingById(id: number): ProposedFinding | undefined {
  return db.prepare(`
    SELECT id, job_id, question, verdict, quote, source_url, quote_verified, reasoning, model, pages_read
    FROM eligibility_findings WHERE id = ?
  `).get(id) as ProposedFinding | undefined;
}

export function setFindingStatus(id: number, status: "accepted" | "dismissed"): void {
  db.prepare("UPDATE eligibility_findings SET status = ? WHERE id = ?").run(status, id);
}

/** Plain-language summary of what a verdict means for this candidate. */
export function describeVerdict(verdict: EligibilityVerdict, sponsorshipRequired: boolean): string {
  if (verdict === "sponsors") return "This employer sponsors visas.";
  if (verdict === "us_work_authorization_required") {
    return sponsorshipRequired
      ? "This role needs existing US work authorization, which rules it out for you."
      : "This role needs existing US work authorization.";
  }
  if (verdict === "clearance_required") return "This role requires a US security clearance.";
  if (verdict === "no_clearance_required") return "No security clearance is required.";
  return "No explicit policy was found.";
}

/** Jobs still waiting on this question, best-scoring first. */
export function jobsNeedingEligibilityResearch(limit: number, question: EligibilityQuestion = "us_eligibility"): Job[] {
  return db.prepare(`
    SELECT jobs.* FROM jobs
    WHERE jobs.duplicate_of_job_id IS NULL
      AND jobs.eligibility_status = 'needs_verification'
      AND jobs.status NOT IN ('irrelevant', 'dismissed', 'archived')
      AND NOT EXISTS (
        SELECT 1 FROM eligibility_findings
        WHERE eligibility_findings.job_id = jobs.id AND eligibility_findings.question = ?
      )
    ORDER BY jobs.score DESC, jobs.id DESC
    LIMIT ?
  `).all(question, limit) as Job[];
}
