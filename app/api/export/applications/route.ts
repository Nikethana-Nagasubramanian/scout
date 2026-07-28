import { db } from "@/lib/database";

export const runtime = "nodejs";

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  const rows = db.prepare(`
    SELECT jobs.company, jobs.title, jobs.location, jobs.apply_url, applications.status,
      applications.applied_at, applications.follow_up_at, applications.contact_name,
      applications.contact_details, applications.notes
    FROM applications JOIN jobs ON jobs.id = applications.job_id
    ORDER BY applications.updated_at DESC
  `).all() as Record<string, unknown>[];
  const columns = ["company", "title", "location", "apply_url", "status", "applied_at", "follow_up_at", "contact_name", "contact_details", "notes"];
  const csv = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=applications.csv" } });
}
