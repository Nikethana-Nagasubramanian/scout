import { generateCoverLetterPdf } from "@/lib/cover-letter";
import { db } from "@/lib/database";
import { coverLetterPdfFilename } from "@/lib/resume-filename";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = db.prepare(`
    SELECT cover_letters.content, cover_letters.updated_at, jobs.company,
      candidate_profile.full_name, candidate_profile.email, candidate_profile.phone,
      candidate_profile.home_location, candidate_profile.portfolio_url, candidate_profile.linkedin_url
    FROM cover_letters
    JOIN applications ON applications.id = cover_letters.application_id
    JOIN jobs ON jobs.id = applications.job_id
    JOIN candidate_profile ON candidate_profile.id = 1
    WHERE cover_letters.application_id = ?
  `).get(Number(id)) as {
    content: string;
    updated_at: string;
    company: string;
    full_name: string;
    email: string;
    phone: string;
    home_location: string;
    portfolio_url: string;
    linkedin_url: string;
  } | undefined;
  if (!row) return new Response("Cover letter not found", { status: 404 });
  const contactLine = [row.email, row.phone, row.home_location, row.portfolio_url, row.linkedin_url]
    .filter(Boolean)
    .join(" | ");
  const buffer = await generateCoverLetterPdf(
    row.content,
    row.full_name,
    contactLine,
    row.company,
    row.updated_at,
  );
  const filename = coverLetterPdfFilename(row.company);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
