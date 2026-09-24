import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api-auth";
import { db } from "@/lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AppliedBody {
  /** Free text recorded on the application event, e.g. which tool submitted it. */
  note?: unknown;
}

/**
 * Records a real submission. Mirrors what the Mark applied button does, so an external
 * applier and the UI leave the same trail. Only moves an application that is actually
 * ready: applying to something still being prepared would be a lie in the tracker.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = authorizeRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  const applicationId = Number(id);
  if (!Number.isFinite(applicationId) || applicationId <= 0) {
    return NextResponse.json({ error: "Invalid application id." }, { status: 400 });
  }

  const application = db.prepare(`
    SELECT applications.id, applications.status, applications.job_id, jobs.company, jobs.title
    FROM applications JOIN jobs ON jobs.id = applications.job_id
    WHERE applications.id = ?
  `).get(applicationId) as
    { id: number; status: string; job_id: number; company: string; title: string } | undefined;
  if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  if (application.status === "applied") {
    return NextResponse.json({ applicationId, status: "applied", alreadyApplied: true });
  }
  if (application.status !== "ready_to_apply") {
    return NextResponse.json(
      { error: `Application is ${application.status}, not ready_to_apply.` },
      { status: 409 },
    );
  }

  let note = "Submitted by an external applier.";
  try {
    const body = await request.json() as AppliedBody;
    if (typeof body?.note === "string" && body.note.trim()) note = body.note.trim().slice(0, 300);
  } catch {
    // An empty body is fine; the default note stands.
  }

  db.prepare(`
    UPDATE applications
    SET status = 'applied',
      applied_at = COALESCE(applied_at, CURRENT_TIMESTAMP),
      follow_up_at = COALESCE(follow_up_at, datetime('now', '+7 days')),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(applicationId);
  db.prepare("INSERT INTO application_events (application_id, status, note) VALUES (?, 'applied', ?)")
    .run(applicationId, note);

  revalidatePath("/applications");
  revalidatePath("/queue");
  revalidatePath("/");
  revalidatePath(`/jobs/${application.job_id}`);

  return NextResponse.json({
    applicationId,
    jobId: application.job_id,
    company: application.company,
    title: application.title,
    status: "applied",
    followUpInDays: 7,
  });
}
