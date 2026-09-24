import { NextResponse } from "next/server";
import { db } from "@/lib/database";
import { READY_TO_APPLY_QUERY } from "@/lib/ready-to-apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything an external applier needs to work the queue: where to apply, which files to
 * attach, and the endpoint that records the submission. Read-only.
 */
export async function GET(request: Request) {
  // The dev server binds 0.0.0.0, so request.url's origin is not dialable. The Host header
  // is whatever the caller actually reached Scout on, which is exactly what it can call back.
  const host = request.headers.get("host");
  const origin = (process.env.SCOUT_BASE_URL || "").trim()
    || (host ? `http://${host}` : new URL(request.url).origin);
  const rows = db.prepare(READY_TO_APPLY_QUERY).all() as Array<{
    application_id: number;
    job_id: number;
    company: string;
    title: string;
    location: string;
    apply_url: string;
    canonical_url: string;
    resume_id: number | null;
    cover_letter_id: number | null;
    cover_letter_status: string | null;
  }>;

  return NextResponse.json({
    count: rows.length,
    applications: rows.map((row) => ({
      applicationId: row.application_id,
      jobId: row.job_id,
      company: row.company,
      title: row.title,
      location: row.location,
      applyUrl: row.apply_url || row.canonical_url,
      resumePdfUrl: row.resume_id ? `${origin}/api/resumes/${row.resume_id}/pdf` : null,
      resumeDocxUrl: row.resume_id ? `${origin}/api/resumes/${row.resume_id}/docx` : null,
      coverLetterPdfUrl: row.cover_letter_id ? `${origin}/api/applications/${row.application_id}/cover-letter/pdf` : null,
      coverLetterStatus: row.cover_letter_status || "none",
      markAppliedUrl: `${origin}/api/applications/${row.application_id}/applied`,
    })),
  });
}
