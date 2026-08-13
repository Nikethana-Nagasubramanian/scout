import { db } from "@/lib/database";

interface ComparableJob {
  id: number;
  company: string;
  title: string;
  canonical_url: string;
  apply_url: string;
  duplicate_of_job_id: number | null;
  duplicate_reason: string;
}

interface CandidateJob extends ComparableJob {
  classification: string;
  reasons_json: string;
}

export interface DuplicateReconciliation {
  suppressed: number;
  exactMatches: number;
  roleMatches: number;
  locationVariants: number;
}

export interface JobReviewHistory {
  outcome: string;
  classification: string;
  duplicate_of_job_id: number | null;
  job_status: string;
  application_status: string | null;
  has_resume: number;
}

export function jobNeedsFreshReview(job: JobReviewHistory): boolean {
  return job.outcome === "new"
    && ["eligible", "needs_verification"].includes(job.classification)
    && job.duplicate_of_job_id === null
    && !job.application_status
    && job.has_resume === 0
    && !["irrelevant", "dismissed", "archived"].includes(job.job_status);
}

export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(incorporated|inc|llc|ltd|limited|corporation|corp|company)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeRoleTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bui\s*\/\s*ux\b/g, "ui ux")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function jobRoleSignature(job: Pick<ComparableJob, "company" | "title">): string {
  return `${normalizeCompanyName(job.company)}|${normalizeRoleTitle(job.title)}`;
}

export function atsJobIdentity(...urls: Array<string | null | undefined>): string | null {
  for (const value of urls) {
    if (!value) continue;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const segments = url.pathname.split("/").filter(Boolean);
      if (host.endsWith("greenhouse.io")) {
        const jobsIndex = segments.indexOf("jobs");
        if (jobsIndex < 0) continue;
        const board = jobsIndex === 0 ? segments[1] : segments[jobsIndex - 1];
        const requisition = jobsIndex === 0 ? segments[2] : segments[jobsIndex + 1];
        if (board && requisition) return `greenhouse:${board.toLowerCase()}:${requisition}`;
      }
      if (host === "jobs.ashbyhq.com" && segments.length >= 2) {
        return `ashby:${segments[0].toLowerCase()}:${segments[1].toLowerCase()}`;
      }
      if (host.endsWith("lever.co") && segments.length >= 2) {
        return `lever:${segments[0].toLowerCase()}:${segments[1].toLowerCase()}`;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function appendReason(value: string, reason: string): string {
  try {
    const reasons = JSON.parse(value) as unknown;
    if (Array.isArray(reasons)) {
      return JSON.stringify([...new Set([...reasons.map(String), reason])]);
    }
  } catch {
    return JSON.stringify([reason]);
  }
  return JSON.stringify([reason]);
}

export function reconcileDuplicateJobs(runId: number): DuplicateReconciliation {
  const protectedJobs = db.prepare(`
    SELECT jobs.id, jobs.company, jobs.title, jobs.canonical_url, jobs.apply_url,
      jobs.duplicate_of_job_id, jobs.duplicate_reason
    FROM jobs
    WHERE EXISTS (
      SELECT 1
      FROM applications
      WHERE applications.job_id = jobs.id
        AND applications.status != 'archived'
    )
    OR EXISTS (
      SELECT 1
      FROM resume_versions
      WHERE resume_versions.job_id = jobs.id
        AND resume_versions.status = 'approved'
    )
    ORDER BY jobs.id
  `).all() as ComparableJob[];
  const protectedIds = new Set(protectedJobs.map((job) => job.id));
  const protectedByIdentity = new Map<string, ComparableJob>();
  const protectedByRole = new Map<string, ComparableJob>();
  for (const job of protectedJobs) {
    const identity = atsJobIdentity(job.apply_url, job.canonical_url);
    if (identity && !protectedByIdentity.has(identity)) protectedByIdentity.set(identity, job);
    const signature = jobRoleSignature(job);
    if (signature !== "|" && !protectedByRole.has(signature)) protectedByRole.set(signature, job);
  }

  const candidates = db.prepare(`
    SELECT jobs.id, jobs.company, jobs.title, jobs.canonical_url, jobs.apply_url,
      jobs.duplicate_of_job_id, jobs.duplicate_reason,
      collection_job_results.classification, collection_job_results.reasons_json
    FROM collection_job_results
    INNER JOIN jobs ON jobs.id = collection_job_results.job_id
    WHERE collection_job_results.run_id = ?
    ORDER BY
      CASE collection_job_results.classification
        WHEN 'eligible' THEN 0
        WHEN 'needs_verification' THEN 1
        ELSE 2
      END,
      jobs.score DESC,
      jobs.id
  `).all(runId) as CandidateJob[];
  const candidateById = new Map(candidates.map((job) => [job.id, job]));
  const representativeByRole = new Map<string, CandidateJob>();
  const updates: Array<{ job: CandidateJob; anchor: ComparableJob; reason: string; kind: "exact" | "role" | "variant" }> = [];

  for (const job of candidates) {
    if (protectedIds.has(job.id)) continue;
    if (job.duplicate_of_job_id) {
      const anchor = candidateById.get(job.duplicate_of_job_id)
        || protectedJobs.find((item) => item.id === job.duplicate_of_job_id);
      if (anchor) {
        updates.push({
          job,
          anchor,
          reason: job.duplicate_reason || "Duplicate of an existing approved or tracked application.",
          kind: "role",
        });
      }
      continue;
    }

    const identity = atsJobIdentity(job.apply_url, job.canonical_url);
    const exactAnchor = identity ? protectedByIdentity.get(identity) : undefined;
    if (exactAnchor) {
      updates.push({
        job,
        anchor: exactAnchor,
        reason: `Already tracked as ${exactAnchor.company} ${exactAnchor.title}. Exact ATS requisition match.`,
        kind: "exact",
      });
      continue;
    }

    const signature = jobRoleSignature(job);
    const roleAnchor = protectedByRole.get(signature);
    if (roleAnchor) {
      updates.push({
        job,
        anchor: roleAnchor,
        reason: `Already tracked as ${roleAnchor.company} ${roleAnchor.title}. Company and role match.`,
        kind: "role",
      });
      continue;
    }

    if (job.classification === "filtered") continue;
    const representative = representativeByRole.get(signature);
    if (representative) {
      updates.push({
        job,
        anchor: representative,
        reason: `Another location variant for ${representative.company} ${representative.title} is already in this fetch.`,
        kind: "variant",
      });
      continue;
    }
    representativeByRole.set(signature, job);
  }

  const updateJob = db.prepare(`
    UPDATE jobs
    SET status = 'archived',
      hard_filter_pass = 0,
      eligibility_status = 'filtered',
      duplicate_of_job_id = ?,
      duplicate_reason = ?
    WHERE id = ?
  `);
  const updateResult = db.prepare(`
    UPDATE collection_job_results
    SET eligible = 0,
      classification = 'filtered',
      reasons_json = ?
    WHERE run_id = ? AND job_id = ?
  `);
  const transaction = db.transaction(() => {
    for (const update of updates) {
      updateJob.run(update.anchor.id, update.reason, update.job.id);
      updateResult.run(appendReason(update.job.reasons_json, update.reason), runId, update.job.id);
    }
  });
  transaction();

  return {
    suppressed: updates.length,
    exactMatches: updates.filter((item) => item.kind === "exact").length,
    roleMatches: updates.filter((item) => item.kind === "role").length,
    locationVariants: updates.filter((item) => item.kind === "variant").length,
  };
}
