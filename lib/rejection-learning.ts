import { db } from "@/lib/database";
import type { RejectionReason } from "@/lib/rejection-reasons";

/**
 * Rejection learning is deliberately deterministic: every rule below is derived by
 * counting rejections, never by a model. A rule that hides roles has to be one you can
 * read, explain, and undo - so rules are computed from the stored rejections on every
 * read rather than baked into a job row somewhere.
 */

export { isRejectionReason, reasonLabel, REJECTION_REASONS, type RejectionReason } from "@/lib/rejection-reasons";

export type RuleKind = "company" | "seniority" | "location" | "role_type";

export interface LearnedRule {
  kind: RuleKind;
  /** Normalized value the rule matches on, and the identity used for overrides. */
  value: string;
  label: string;
  rejectionCount: number;
}

interface RejectionRow {
  reason: string;
  company: string;
  title: string;
  location: string;
}

/**
 * How many rejections of the same signal it takes before Scout starts hiding roles.
 * "Not this company" is 1 because naming a company is already an explicit decision;
 * the inferred signals need corroboration before they are trusted.
 */
const RULE_THRESHOLDS: Record<RuleKind, number> = {
  company: 1,
  seniority: 2,
  location: 2,
  role_type: 2,
};

const SENIORITY_TOKENS = [
  "principal", "staff", "senior", "sr", "lead", "head", "director", "vp",
  "vice president", "manager", "junior", "jr", "entry", "intern", "associate",
];

/** Tokens that describe how a role is worked rather than where, still a location decision. */
const WORKPLACE_TOKENS = ["remote", "hybrid", "on-site", "onsite", "in office", "in-office"];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function seniorityToken(title: string): string | null {
  const normalized = normalize(title);
  return SENIORITY_TOKENS.find((token) => new RegExp(`\\b${token}\\b`).test(normalized)) || null;
}

export function workplaceToken(location: string): string | null {
  const normalized = normalize(location);
  return WORKPLACE_TOKENS.find((token) => normalized.includes(token)) || null;
}

/** The role itself, with seniority words stripped: "Senior Product Designer" -> "product designer". */
export function roleTypeToken(title: string): string | null {
  let normalized = normalize(title);
  for (const token of SENIORITY_TOKENS) {
    normalized = normalized.replace(new RegExp(`\\b${token}\\b`, "g"), " ");
  }
  normalized = normalized.replace(/\b(i{1,3}|iv|v|\d+)\b/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length >= 3 ? normalized : null;
}

/** A location rule keys on the workplace type when present, otherwise the city/region text. */
function locationKey(location: string): string | null {
  const workplace = workplaceToken(location);
  if (workplace) return workplace;
  const normalized = normalize(location);
  if (!normalized || normalized === "not specified") return null;
  return normalized.split(",")[0].trim() || null;
}

export function recordJobRejection(jobId: number, reason: RejectionReason): void {
  const job = db.prepare("SELECT company, title, location FROM jobs WHERE id = ?").get(jobId) as
    { company: string; title: string; location: string } | undefined;
  if (!job) return;
  db.prepare(`
    INSERT INTO job_rejections (job_id, reason, company, title, location)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, reason, job.company, job.title, job.location || "");
}

function ruleIdentity(rule: Pick<LearnedRule, "kind" | "value">): string {
  return `${rule.kind}:${rule.value}`;
}

function dismissedRuleIdentities(): Set<string> {
  const rows = db.prepare("SELECT kind, value FROM rejection_rule_overrides").all() as Array<{ kind: RuleKind; value: string }>;
  return new Set(rows.map(ruleIdentity));
}

/** Turn off a learned rule. The rejections stay - only the inference is undone. */
export function dismissLearnedRule(kind: RuleKind, value: string): void {
  db.prepare("INSERT OR IGNORE INTO rejection_rule_overrides (kind, value) VALUES (?, ?)").run(kind, value);
}

export function restoreLearnedRule(kind: RuleKind, value: string): void {
  db.prepare("DELETE FROM rejection_rule_overrides WHERE kind = ? AND value = ?").run(kind, value);
}

/**
 * Count rejections per signal and keep the ones over threshold. "Comp or stage" is
 * recorded but never becomes a rule: comp is not reliably in the posting text, so a
 * rule built on it would hide roles for a reason Scout cannot actually verify.
 */
export function learnedRejectionRules(includeDismissed = false): LearnedRule[] {
  const rows = db.prepare("SELECT reason, company, title, location FROM job_rejections").all() as RejectionRow[];
  const counts = new Map<string, LearnedRule>();

  function tally(kind: RuleKind, value: string | null, label: string) {
    if (!value) return;
    const key = `${kind}:${value}`;
    const existing = counts.get(key);
    if (existing) existing.rejectionCount += 1;
    else counts.set(key, { kind, value, label, rejectionCount: 1 });
  }

  for (const row of rows) {
    if (row.reason === "not_this_company") tally("company", normalize(row.company), row.company);
    if (row.reason === "wrong_seniority") {
      const token = seniorityToken(row.title);
      tally("seniority", token, token ? `${token} roles` : "");
    }
    if (row.reason === "wrong_location") {
      const key = locationKey(row.location);
      tally("location", key, key || "");
    }
    if (row.reason === "wrong_role_type") {
      const token = roleTypeToken(row.title);
      tally("role_type", token, token || "");
    }
  }

  const dismissed = includeDismissed ? new Set<string>() : dismissedRuleIdentities();
  return [...counts.values()]
    .filter((rule) => rule.rejectionCount >= RULE_THRESHOLDS[rule.kind])
    .filter((rule) => !dismissed.has(ruleIdentity(rule)))
    .sort((left, right) => right.rejectionCount - left.rejectionCount || left.label.localeCompare(right.label));
}

export interface SuppressibleJob {
  company: string;
  title: string;
  location: string | null;
}

/** The first rule that catches this job, or null. Callers show the rule, never hide silently. */
export function matchingRule(job: SuppressibleJob, rules: LearnedRule[]): LearnedRule | null {
  const company = normalize(job.company);
  const seniority = seniorityToken(job.title);
  const location = locationKey(job.location || "");
  const roleType = roleTypeToken(job.title);
  return rules.find((rule) => {
    if (rule.kind === "company") return rule.value === company;
    if (rule.kind === "seniority") return rule.value === seniority;
    if (rule.kind === "location") return rule.value === location;
    return rule.value === roleType;
  }) || null;
}

export function describeRule(rule: LearnedRule): string {
  const source = `${rule.rejectionCount} ${rule.rejectionCount === 1 ? "rejection" : "rejections"}`;
  if (rule.kind === "company") return `Hidden because you rejected ${rule.label} (${source}).`;
  if (rule.kind === "seniority") return `Hidden because you rejected ${rule.label} (${source}).`;
  if (rule.kind === "location") return `Hidden because you rejected roles in ${rule.label} (${source}).`;
  return `Hidden because you rejected ${rule.label} roles (${source}).`;
}

export function ruleHeadline(rule: LearnedRule): string {
  if (rule.kind === "company") return `Company: ${rule.label}`;
  if (rule.kind === "seniority") return `Seniority: ${rule.label}`;
  if (rule.kind === "location") return `Location: ${rule.label}`;
  return `Role type: ${rule.label}`;
}

