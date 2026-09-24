import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateCoverLetterPdf } from "@/lib/cover-letter";
import { db } from "@/lib/database";
import { READY_TO_APPLY_QUERY } from "@/lib/ready-to-apply";
import { generatePdf } from "@/lib/resume";
import { coverLetterPdfFilename, resumePdfFilename } from "@/lib/resume-filename";
import { resumeSkillCategories } from "@/lib/resume-skills";
import type { ResumeContent } from "@/lib/types";
import { safeJson } from "@/lib/utils";

/**
 * Usage: pnpm export:queue [outputDir]
 *
 * Writes one folder per ready-to-apply application, each holding the resume and cover
 * letter PDFs, plus a manifest.json describing the whole queue. The manifest is the
 * contract an external applier reads: where to apply, which files to attach, and the
 * endpoint to call once it has actually submitted.
 */

interface QueueRow {
  application_id: number;
  job_id: number;
  company: string;
  title: string;
  location: string;
  apply_url: string;
  canonical_url: string;
  resume_id: number | null;
  content_json: string | null;
  description: string;
  letter_content: string | null;
  letter_updated_at: string | null;
  letter_status: string | null;
}

const EMPTY_RESUME: ResumeContent = {
  candidateName: "Candidate",
  contactLine: "",
  targetTitle: "",
  summary: "",
  skills: [],
  facts: [],
  audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] },
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "role";
}

async function main(): Promise<void> {
  const outputRoot = process.argv[2] || join(process.cwd(), "data", "generated", "ready-to-apply");
  const baseUrl = process.env.SCOUT_BASE_URL || "http://localhost:3000";

  const profile = db.prepare(`
    SELECT full_name, email, phone, home_location, portfolio_url, linkedin_url
    FROM candidate_profile WHERE id = 1
  `).get() as Record<string, string> | undefined;
  const contactLine = [profile?.email, profile?.phone, profile?.home_location, profile?.portfolio_url, profile?.linkedin_url]
    .filter(Boolean)
    .join(" | ");

  const rows = db.prepare(READY_TO_APPLY_QUERY).all() as QueueRow[];

  if (!rows.length) {
    console.log("Nothing is ready to apply.");
    return;
  }

  mkdirSync(outputRoot, { recursive: true });
  const manifest: Record<string, unknown>[] = [];

  for (const row of rows) {
    const folderName = `${String(row.application_id).padStart(3, "0")}-${slug(row.company)}-${slug(row.title)}`;
    const folder = join(outputRoot, folderName);
    mkdirSync(folder, { recursive: true });

    let resumeFile: string | null = null;
    if (row.resume_id && row.content_json) {
      const parsed = safeJson<ResumeContent>(row.content_json, EMPTY_RESUME);
      const content = { ...parsed, skillCategories: resumeSkillCategories(parsed, row.description) };
      const name = resumePdfFilename(row.company, parsed.candidateName);
      writeFileSync(join(folder, name), await generatePdf(content));
      resumeFile = join(folderName, name);
    }

    let letterFile: string | null = null;
    if (row.letter_content) {
      const name = coverLetterPdfFilename(row.company, profile?.full_name || "");
      const buffer = await generateCoverLetterPdf(
        row.letter_content,
        profile?.full_name || "",
        contactLine,
        row.company,
        row.letter_updated_at || new Date().toISOString(),
      );
      writeFileSync(join(folder, name), buffer);
      letterFile = join(folderName, name);
    }

    manifest.push({
      applicationId: row.application_id,
      jobId: row.job_id,
      company: row.company,
      title: row.title,
      location: row.location,
      applyUrl: row.apply_url || row.canonical_url,
      resumePdf: resumeFile,
      coverLetterPdf: letterFile,
      coverLetterStatus: row.letter_status || "none",
      // Call this after a real submission. It is the only thing that moves the job.
      markAppliedUrl: `${baseUrl}/api/applications/${row.application_id}/applied`,
    });

    console.log(`${folderName}  resume:${resumeFile ? "yes" : "MISSING"}  letter:${letterFile ? "yes" : "none"}`);
  }

  const manifestPath = join(outputRoot, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    candidate: profile?.full_name || "",
    applications: manifest,
  }, null, 2)}\n`);

  const withResume = manifest.filter((entry) => entry.resumePdf).length;
  const withLetter = manifest.filter((entry) => entry.coverLetterPdf).length;
  console.log(`\n${manifest.length} applications exported to ${outputRoot}`);
  console.log(`${withResume} with a resume, ${withLetter} with a cover letter.`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
