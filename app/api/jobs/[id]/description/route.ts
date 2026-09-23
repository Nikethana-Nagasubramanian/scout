import { NextResponse } from "next/server";
import { db } from "@/lib/database";
import { ensureStoredJobDescription } from "@/lib/job-description";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Feeds the Jobs drawer: the stored description, re-fetched from the posting when thin. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const { job: resolved, enriched } = await ensureStoredJobDescription(job);
  // Text we fetched but did not store is a best-effort page scrape, so say so.
  const roughRead = resolved.description !== job.description && !enriched;
  return NextResponse.json({
    id: resolved.id,
    title: resolved.title,
    company: resolved.company,
    location: resolved.location,
    score: resolved.score,
    workplaceType: resolved.workplace_type,
    employmentType: resolved.employment_type,
    applyUrl: resolved.apply_url || resolved.canonical_url,
    sourceName: resolved.source_name,
    description: resolved.description,
    enriched,
    roughRead,
  });
}
