import { redirect } from "next/navigation";
import { db } from "@/lib/database";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Pulls plain text out of an uploaded PDF, DOCX, TXT, or Markdown resume. */
export async function extractResumeText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  let text: string;
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    text = (await extractText(pdf, { mergePages: true })).text;
  } else if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (name.endsWith(".txt") || name.endsWith(".md")) {
    text = buffer.toString("utf8");
  } else {
    throw new Error("Upload a PDF, DOCX, TXT, or Markdown file.");
  }
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Seeds the truth bank from resume lines the first time a resume is saved, so it is never empty. */
export function seedFactsFromResume(resumeText: string): void {
  const factCount = (db.prepare("SELECT COUNT(*) AS count FROM candidate_facts").get() as { count: number }).count;
  if (factCount > 0 || !resumeText) return;
  const candidates = resumeText
    .split("\n")
    .map((line) => line.replace(/^[•*\-\s]+/, "").trim())
    .filter((line) => line.length >= 35 && !line.includes("@"))
    .slice(0, 30);
  const insert = db.prepare("INSERT INTO candidate_facts (category, context, claim, skills, verified) VALUES ('Experience', 'Imported from base resume', ?, '[]', 1)");
  db.transaction(() => candidates.forEach((line) => insert.run(line)))();
}

/** A fresh install has no profile yet, so every entry point sends the user to set one up first. */
export function requireProfile(): void {
  const profile = db.prepare("SELECT onboarding_complete FROM candidate_profile WHERE id = 1").get() as { onboarding_complete: number };
  if (!profile.onboarding_complete) redirect("/profile");
}
