import { BorderStyle, Document, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";
import { db, getSetting } from "@/lib/database";
import { prioritizeResumeWithOllama } from "@/lib/local-ai";
import { categorizeResumeSkills, normalizeResumeSkills, resumeSkillCategories } from "@/lib/resume-skills";
import {
  ensureResumeBlockIds,
  isScoutGeneratedResumeSection,
  stripResumeBulletPrefix,
} from "@/lib/resume-blocks";
import type { CandidateFact, CandidateProfile, Job, ResumeContent } from "@/lib/types";
import { normalizeText, parseList } from "@/lib/utils";

function relevantFacts(facts: CandidateFact[], job: Job): CandidateFact[] {
  const jobText = normalizeText(`${job.title} ${job.description}`);
  return [...facts]
    .map((fact) => {
      const skills = parseList(fact.skills);
      const skillMatches = skills.filter((skill) => jobText.includes(normalizeText(skill))).length;
      const claimTokens = normalizeText(fact.claim).split(" ").filter((token) => token.length > 4);
      const textMatches = claimTokens.filter((token) => jobText.includes(token)).length;
      return { fact, relevance: skillMatches * 5 + textMatches };
    })
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, 10)
    .map(({ fact }) => fact);
}

type ResumeSection = NonNullable<ResumeContent["sections"]>[number];

const sectionNames: Record<string, string> = {
  summary: "SUMMARY",
  "professional summary": "SUMMARY",
  profile: "SUMMARY",
  skills: "SKILLS",
  "technical skills": "SKILLS",
  "core skills": "SKILLS",
  experience: "PROFESSIONAL EXPERIENCE",
  "work experience": "PROFESSIONAL EXPERIENCE",
  "professional experience": "PROFESSIONAL EXPERIENCE",
  education: "EDUCATION",
  projects: "PROJECTS",
  "selected projects": "PROJECTS",
  certifications: "CERTIFICATIONS",
  awards: "AWARDS",
  publications: "PUBLICATIONS",
};

function cleanLine(value: string): string {
  const cleaned = value
    .replace(/\*\*/g, "")
    .replace(/\u2014/g, "-")
    .replace(/^\s*[•●▪◦*]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^[•●▪◦*-]+$/.test(cleaned)) return "";
  if (cleaned.endsWith(")") && !cleaned.includes("(")) return cleaned.slice(0, -1).trim();
  return cleaned;
}

function canonicalHeading(value: string): string | null {
  const normalized = cleanLine(value).replace(/:$/, "").toLowerCase();
  return sectionNames[normalized] || null;
}

function shouldJoin(previous: string, current: string): boolean {
  if (!previous || !current || canonicalHeading(previous) || canonicalHeading(current)) return false;
  return /^[a-z0-9($~]/.test(current) || /(?:,|\b(?:and|or|to|for|with|across|into|a|an|the))$/i.test(previous);
}

function lineKind(text: string, original: string): "entry" | "bullet" | "text" {
  if (/^\s*[•●▪◦*-]\s+/.test(original)) return "bullet";
  if (/\b(?:19|20)\d{2}\b|\bpresent\b/i.test(text) || (/\s[|]\s/.test(text) && text.length < 160)) return "entry";
  if (/^(accelerated|built|collaborated|conducted|created|designed|developed|drove|improved|implemented|increased|launched|led|managed|owned|partnered|redesigned|reduced|saved|shipped|spearheaded|streamlined|translated)\b/i.test(text)) return "bullet";
  return "text";
}

export function parseResumeSections(baseResumeText: string, profile: CandidateProfile): ResumeSection[] {
  const rawLines: Array<{ original: string; text: string }> = [];
  let pendingBullet = false;
  for (const original of baseResumeText.split(/\r?\n/)) {
    if (/^\s*[•●▪◦*]+\s*$/.test(original)) {
      pendingBullet = true;
      continue;
    }
    const text = cleanLine(original);
    if (!text) continue;
    rawLines.push({
      original: pendingBullet ? `• ${original}` : original,
      text,
    });
    pendingBullet = false;
  }
  const logicalLines: Array<{ original: string; text: string }> = [];
  for (const line of rawLines) {
    const previous = logicalLines.at(-1);
    if (previous && shouldJoin(previous.text, line.text)) {
      previous.text = `${previous.text} ${line.text}`;
      previous.original = `${previous.original} ${line.original}`;
    } else {
      logicalLines.push({ ...line });
    }
  }

  const contactValues = [profile.full_name, profile.email, profile.phone, profile.home_location, profile.portfolio_url, profile.linkedin_url, profile.github_url]
    .filter(Boolean)
    .map((value) => normalizeText(value));
  const sections: ResumeSection[] = [];
  let current: ResumeSection | null = null;

  for (const line of logicalLines) {
    const heading = canonicalHeading(line.text);
    if (heading) {
      current = { title: heading, lines: [] };
      sections.push(current);
      continue;
    }
    const normalized = normalizeText(line.text);
    if (!current && contactValues.some((value) => value && (normalized === value || normalized.includes(value)))) continue;
    if (!current) {
      current = { title: "PROFESSIONAL EXPERIENCE", lines: [] };
      sections.push(current);
    }
    current.lines.push({ text: line.text, kind: lineKind(line.text, line.original) });
  }

  return sections
    .filter((section) => section.lines.length > 0)
    .map((section) => section.title === "EDUCATION"
      ? { ...section, lines: section.lines.map((line) => ({ ...line, kind: "entry" as const })) }
      : section);
}

export function buildResumeContent(job: Job, profile: CandidateProfile, facts: CandidateFact[]): ResumeContent {
  const selected = relevantFacts(facts.filter((fact) => fact.verified && !/imported from base resume/i.test(fact.context)), job);
  const profileSkills = normalizeResumeSkills(parseList(profile.skills));
  const jobText = normalizeText(`${job.title} ${job.description}`);
  const includedSkills = profileSkills.filter((skill) => jobText.includes(normalizeText(skill)));
  const otherSkills = profileSkills.filter((skill) => !includedSkills.includes(skill));
  const selectedSkills = [...includedSkills, ...otherSkills].slice(0, 24);
  const skillCategories = categorizeResumeSkills(selectedSkills, job.description);
  const parsedSections = parseResumeSections(profile.base_resume_text, profile);
  const parsedSummary = parsedSections.find((section) => section.title === "SUMMARY")?.lines.map((line) => line.text).join(" ") || "";
  const contentSections = parsedSections.filter((section) => section.title !== "SUMMARY" && section.title !== "SKILLS");

  const commonKeywords = [
    "accessibility",
    "analytics",
    "collaboration",
    "design systems",
    "leadership",
    "research",
    "strategy",
    "typescript",
    "user experience",
  ];
  const includedKeywords = commonKeywords.filter(
    (keyword) => jobText.includes(keyword) && profileSkills.some((skill) => normalizeText(skill).includes(keyword)),
  );
  const unsupportedKeywords = commonKeywords.filter(
    (keyword) => jobText.includes(keyword) && !includedKeywords.includes(keyword),
  );

  const contactLine = [profile.email, profile.phone, profile.home_location, profile.portfolio_url, profile.linkedin_url]
    .filter(Boolean)
    .join(" | ");

  return ensureResumeBlockIds({
    candidateName: profile.full_name,
    contactLine,
    targetTitle: job.title,
    summary: profile.professional_summary || parsedSummary,
    skills: selectedSkills,
    skillCategories,
    facts: selected.map((fact) => ({ category: fact.category, context: fact.context, claim: fact.claim })),
    sections: contentSections,
    audit: {
      selectedFactIds: selected.map((fact) => fact.id),
      includedKeywords,
      unsupportedKeywords,
    },
  });
}

export async function createResumeVersion(jobId: number): Promise<number> {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
  if (!job) throw new Error("Job not found");
  const profile = db.prepare("SELECT * FROM candidate_profile WHERE id = 1").get() as CandidateProfile;
  const facts = db.prepare("SELECT * FROM candidate_facts WHERE verified = 1 ORDER BY created_at DESC").all() as CandidateFact[];
  let content = buildResumeContent(job, profile, facts);
  let method = "Deterministic ATS tailoring";
  if (getSetting("local_ai_enabled", "0") === "1") {
    try {
      content = await prioritizeResumeWithOllama(content, job, getSetting("ollama_model", "llama3.2:3b"));
      method = "Local AI evidence prioritization";
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      const reason = timedOut
        ? "the selected model did not finish within 120 seconds"
        : error instanceof Error
          ? error.message
          : "Ollama was unavailable";
      method = `Deterministic fallback because local AI failed: ${reason}`;
    }
  }
  const changeSummary = `${method}. Preserved ${content.sections?.reduce((total, section) => total + section.lines.length, 0) || 0} source lines and prioritized ${content.skills.length} verified skills for ${job.title}.`;
  const result = db.prepare(
    "INSERT INTO resume_versions (job_id, content_json, change_summary) VALUES (?, ?, ?)",
  ).run(jobId, JSON.stringify(content), changeSummary);
  db.prepare("UPDATE jobs SET status = 'shortlisted' WHERE id = ?").run(jobId);
  return Number(result.lastInsertRowid);
}

function resumeSections(content: ResumeContent): ResumeSection[] {
  return (content.sections || [])
    .filter((section) => !isScoutGeneratedResumeSection(section.title))
    .map((section) => ({
    ...section,
    lines: section.lines.map((line) => ({
      ...line,
      text: line.kind === "bullet" ? stripResumeBulletPrefix(line.text) : line.text,
    })),
  }));
}

function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: title, bold: true, size: 21, font: "Arial" })],
    spacing: { before: 150, after: 55 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: "444444" } },
  });
}

function resumeDocumentMetadata(content: ResumeContent) {
  const candidateName = content.candidateName.trim() || "Candidate";
  return {
    candidateName,
    title: `${candidateName} Resume`,
    subject: "Resume",
  };
}

export async function generateDocx(content: ResumeContent): Promise<Buffer> {
  const metadata = resumeDocumentMetadata(content);
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: content.candidateName || "Candidate", bold: true, size: 34, font: "Arial" })],
      alignment: "center",
      spacing: { after: 45 },
    }),
    new Paragraph({ children: [new TextRun({ text: content.contactLine, size: 18, font: "Arial" })], alignment: "center", spacing: { after: 100 } }),
  ];

  if (content.summary) {
    children.push(sectionHeading("SUMMARY"));
    children.push(new Paragraph({ children: [new TextRun({ text: content.summary, size: 19, font: "Arial" })], spacing: { after: 80 } }));
  }

  children.push(sectionHeading("SKILLS"));
  for (const category of resumeSkillCategories(content)) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${category.name}: `, bold: true, size: 19, font: "Arial" }),
        ...category.skills.flatMap((skill, index) => {
          const runs = [
            new TextRun({
              text: skill,
              size: 19,
              font: "Arial",
            }),
          ];
          if (index < category.skills.length - 1) {
            runs.push(new TextRun({ text: ", ", size: 19, font: "Arial" }));
          }
          return runs;
        }),
      ],
      spacing: { after: 35 },
    }));
  }

  for (const section of resumeSections(content)) {
    children.push(sectionHeading(section.title));
    for (const line of section.lines) {
      if (line.kind === "divider") {
        children.push(new Paragraph({
          children: [],
          spacing: { before: 35, after: 70 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "9A9A9A" } },
        }));
        continue;
      }
      children.push(new Paragraph({
        children: [new TextRun({ text: line.text, bold: line.kind === "entry", size: 19, font: "Arial" })],
        bullet: line.kind === "bullet" ? { level: 0 } : undefined,
        spacing: { after: line.kind === "entry" ? 25 : 45 },
      }));
    }
  }

  const document = new Document({
    title: metadata.title,
    subject: metadata.subject,
    creator: metadata.candidateName,
    lastModifiedBy: metadata.candidateName,
    revision: 1,
    styles: { default: { document: { run: { font: "Arial", size: 19 } } } },
    sections: [{
      properties: { page: { margin: { top: 540, right: 576, bottom: 540, left: 576 } } },
      children,
    }],
  });
  return Packer.toBuffer(document);
}

export async function generatePdf(content: ResumeContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const metadata = resumeDocumentMetadata(content);
    const document = new PDFDocument({
      size: "LETTER",
      margin: 48,
      info: {
        Title: metadata.title,
        Author: metadata.candidateName,
        Subject: metadata.subject,
      },
    });
    delete document.info.Creator;
    delete document.info.Producer;
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    document.font("Helvetica-Bold").fontSize(18).text(content.candidateName || "Candidate", { align: "center" });
    document.moveDown(0.25).font("Helvetica").fontSize(9).text(content.contactLine, { align: "center" });

    if (content.summary) {
      document.moveDown().font("Helvetica-Bold").fontSize(11).text("SUMMARY");
      document.moveDown(0.25).font("Helvetica").fontSize(9.5).text(content.summary, { lineGap: 2 });
    }

    document.moveDown().font("Helvetica-Bold").fontSize(11).text("SKILLS");
    document.moveDown(0.25).fontSize(9.5);
    const left = document.page.margins.left;
    const right = document.page.width - document.page.margins.right;
    const lineHeight = 13;
    let y = document.y;
    const skillCategories = resumeSkillCategories(content);
    for (const [categoryIndex, category] of skillCategories.entries()) {
      if (categoryIndex > 0) y += lineHeight;
      let x = left;
      document.font("Helvetica-Bold");
      const label = `${category.name}: `;
      document.fillColor("#111111").text(label, x, y, { lineBreak: false });
      x += document.widthOfString(label);
      document.font("Helvetica");
      for (const [skillIndex, skill] of category.skills.entries()) {
        const separator = skillIndex < category.skills.length - 1 ? ", " : "";
        const skillWidth = document.widthOfString(skill);
        const separatorWidth = document.widthOfString(separator);
        if (x > left && x + skillWidth + separatorWidth > right) {
          x = left;
          y += lineHeight;
        }
        document.fillColor("#111111").text(skill, x, y, { lineBreak: false });
        x += skillWidth;
        if (separator) {
          document.text(separator, x, y, { lineBreak: false });
          x += separatorWidth;
        }
      }
    }
    document.x = left;
    document.y = y + lineHeight;

    for (const section of resumeSections(content)) {
      document.moveDown().font("Helvetica-Bold").fontSize(11).text(section.title);
      document.moveTo(document.x, document.y + 2).lineTo(document.page.width - 48, document.y + 2).lineWidth(0.5).strokeColor("#444444").stroke();
      document.moveDown(0.35);
      for (const [lineIndex, line] of section.lines.entries()) {
        if (line.kind === "entry") {
          const relatedLines = section.lines.slice(lineIndex).findIndex(
            (candidate, candidateIndex) => candidateIndex > 0 && candidate.kind === "entry",
          );
          const block = section.lines.slice(
            lineIndex,
            relatedLines === -1 ? section.lines.length : lineIndex + relatedLines,
          );
          const bodyWidth = document.page.width - document.page.margins.left - document.page.margins.right;
          const estimatedHeight = block.reduce((height, candidate) => {
            if (candidate.kind === "divider") return height + 12;
            const prefix = candidate.kind === "bullet" ? "• " : "";
            document.font(candidate.kind === "entry" ? "Helvetica-Bold" : "Helvetica").fontSize(9.5);
            return height + document.heightOfString(`${prefix}${candidate.text}`, {
              width: bodyWidth,
              indent: candidate.kind === "bullet" ? 10 : 0,
              lineGap: 1.5,
            }) + (candidate.kind === "entry" ? 2 : 4);
          }, 0);
          const pageBottom = document.page.height - document.page.margins.bottom;
          if (document.y + estimatedHeight > pageBottom && document.y > document.page.margins.top + 60) {
            document.addPage();
          }
        }
        if (line.kind === "divider") {
          document.moveDown(0.15);
          document.moveTo(document.page.margins.left, document.y)
            .lineTo(document.page.width - document.page.margins.right, document.y)
            .lineWidth(0.45)
            .strokeColor("#999999")
            .stroke();
          document.moveDown(0.45);
          continue;
        }
        const prefix = line.kind === "bullet" ? "• " : "";
        document.font(line.kind === "entry" ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).text(`${prefix}${line.text}`, {
          indent: line.kind === "bullet" ? 10 : 0,
          lineGap: 1.5,
        });
        document.moveDown(line.kind === "entry" ? 0.1 : 0.2);
      }
    }
    document.end();
  });
}
