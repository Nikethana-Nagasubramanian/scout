/**
 * Deliberately dependency-free. Scoring imports this, and reaching for the shared text
 * helper in lib/job-description pulls in the database module, which imports job-fit,
 * which imports this file - a cycle that fails at import time rather than at runtime.
 */
function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Most postings that have a sponsorship policy simply say so, in a handful of stock
 * phrasings. Reading them is a regex, not a research task - so this runs first and the
 * research agent only sees the jobs where the posting is genuinely silent.
 */

export type SponsorshipVerdict = "sponsors" | "us_work_authorization_required";

export interface SponsorshipStatement {
  verdict: SponsorshipVerdict;
  /** The sentence it was read from, so the finding can cite the posting itself. */
  quote: string;
}

const NEGATIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:un(?:able|available)|not able|cannot|can not|can't)\b[^.]{0,60}\bsponsor/i,
  /\bnot\b[^.]{0,30}\beligible\b[^.]{0,30}\bsponsorship/i,
  /\bsponsorship\b[^.]{0,40}\b(?:not (?:available|offered|provided|possible)|unavailable|is not)\b/i,
  /\b(?:do(?:es)? not|will not|won't)\b[^.]{0,40}\bsponsor/i,
  /\bwithout(?:\s+\w+){0,3}\s+sponsorship\b/i,
  /\bno\b[^.]{0,20}\bvisa sponsorship\b/i,
];

const POSITIVE_PATTERNS: readonly RegExp[] = [
  /\bvisa sponsorship\b[^.]{0,30}\b(?:available|offered|provided)\b/i,
  /\b(?:we|company)\b[^.]{0,30}\b(?:offer|provide|will sponsor)s?\b[^.]{0,30}\bsponsorship\b/i,
  /\bhappy to sponsor\b/i,
  /\bsponsorship (?:is )?available\b/i,
];

/** Split into sentences, keeping it crude: postings are not prose and often lack punctuation. */
function sentences(text: string): string[] {
  // Entities survive tag stripping, and a quote shown to the user should read as prose.
  const decoded = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;|&rsquo;/gi, "'");
  return stripMarkup(decoded)
    .split(/(?<=[.!?])\s+|\s*[|•]\s*|\s{2,}/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * "Sponsored life insurance" is a benefit; "applicants must work without sponsorship" is a
 * policy. Both mention sponsorship, so the sentence has to name an immigration term or
 * otherwise read as being about employing this person.
 */
const IMMIGRATION_WORDS = /\b(?:visa|h-?1b|work(?:ing)? (?:authorization|authorisation|permit)|immigration|employment authorization)\b/i;
const EMPLOYMENT_WORDS = /\b(?:applicants?|candidates?|employment|hire[ds]?|hiring|work|role|position)\b/i;

function hasEmploymentContext(sentence: string): boolean {
  return IMMIGRATION_WORDS.test(sentence) || EMPLOYMENT_WORDS.test(sentence);
}

const QUOTE_CHARS = 240;

function quoteAround(sentence: string, marker: RegExp): string {
  if (sentence.length <= QUOTE_CHARS) return sentence;
  const at = sentence.search(marker);
  if (at < 0) return sentence.slice(0, QUOTE_CHARS);
  const start = Math.max(0, at - Math.floor(QUOTE_CHARS / 3));
  const slice = sentence.slice(start, start + QUOTE_CHARS).trim();
  return `${start > 0 ? "..." : ""}${slice}${start + QUOTE_CHARS < sentence.length ? "..." : ""}`;
}

/**
 * Returns the posting's stated policy, or null when it says nothing.
 * The sentence must mention a visa or work authorization: "sponsored life insurance" is
 * a benefit, and matching bare "sponsor" turns perks into eligibility rulings.
 */
export function sponsorshipFromPosting(description: string): SponsorshipStatement | null {
  for (const sentence of sentences(description)) {
    if (!/\bsponsor/i.test(sentence)) continue;
    if (!hasEmploymentContext(sentence)) continue;
    // Postings often lack punctuation, so a "sentence" can run for paragraphs. Centre the
    // quote on the sponsorship wording, or it cites text that shows none of the evidence.
    const quote = quoteAround(sentence, /\bsponsor/i);
    if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(sentence))) {
      return { verdict: "us_work_authorization_required", quote };
    }
    if (POSITIVE_PATTERNS.some((pattern) => pattern.test(sentence))) {
      return { verdict: "sponsors", quote };
    }
  }
  return null;
}
