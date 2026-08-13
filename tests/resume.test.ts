import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildResumeContent, generateDocx, generatePdf, parseResumeSections } from "@/lib/resume";
import { addResumeKeyword, isHighlightedKeyword } from "@/lib/resume-keywords";
import { categorizeResumeSkills, normalizeResumeSkills, resumeSkillCategories } from "@/lib/resume-skills";
import { applyResumeRanking, suggestResumeBulletWithOllama } from "@/lib/local-ai";
import type { CandidateFact, CandidateProfile, Job } from "@/lib/types";

function readZipEntry(archive: Buffer, target: string): string {
  const minimumEocdSize = 22;
  const maximumCommentSize = 65_535;
  let eocdOffset = -1;
  for (
    let offset = archive.length - minimumEocdSize;
    offset >= Math.max(0, archive.length - minimumEocdSize - maximumCommentSize);
    offset -= 1
  ) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("DOCX end-of-central-directory record not found");

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let directoryOffset = archive.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(directoryOffset) !== 0x02014b50) {
      throw new Error("Invalid DOCX central-directory entry");
    }
    const compressionMethod = archive.readUInt16LE(directoryOffset + 10);
    const compressedSize = archive.readUInt32LE(directoryOffset + 20);
    const fileNameLength = archive.readUInt16LE(directoryOffset + 28);
    const extraLength = archive.readUInt16LE(directoryOffset + 30);
    const commentLength = archive.readUInt16LE(directoryOffset + 32);
    const localHeaderOffset = archive.readUInt32LE(directoryOffset + 42);
    const fileName = archive
      .subarray(directoryOffset + 46, directoryOffset + 46 + fileNameLength)
      .toString("utf8");

    if (fileName === target) {
      if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`Invalid DOCX local header for ${target}`);
      }
      const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      if (compressionMethod === 0) return compressed.toString("utf8");
      if (compressionMethod === 8) return inflateRawSync(compressed).toString("utf8");
      throw new Error(`Unsupported DOCX compression method ${compressionMethod}`);
    }

    directoryOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  throw new Error(`DOCX entry not found: ${target}`);
}

const profile = {
  id: 1,
  full_name: "Test Candidate",
  email: "candidate@example.com",
  phone: "",
  home_location: "Chicago",
  professional_summary: "A verified summary.",
  base_resume_text: "",
  target_titles: "[]",
  target_seniority: "senior",
  skills: JSON.stringify(["Figma", "Research"]),
  preferred_locations: "[]",
  workplace_preferences: "[]",
  minimum_salary: null,
  work_authorization: "",
  sponsorship_required: 0,
  years_experience: 5,
  portfolio_url: "",
  linkedin_url: "",
  github_url: "",
  onboarding_complete: 1,
  updated_at: "2026-01-01",
} satisfies CandidateProfile;

const job = {
  id: 1,
  source_id: 1,
  source_name: "Example",
  source_type: "lever",
  external_id: "one",
  company: "Example",
  title: "Product Designer",
  location: "Remote",
  workplace_type: "remote",
  employment_type: "Full-time",
  salary_min: null,
  salary_max: null,
  salary_currency: "",
  description: "Lead Figma design and enterprise strategy.",
  canonical_url: "",
  apply_url: "",
  posted_at: null,
  first_seen_at: "2026-01-01",
  last_seen_at: "2026-01-01",
  status: "discovered",
  score: 80,
  hard_filter_pass: 1,
  eligibility_status: "eligible",
  score_breakdown: null,
  match_summary: null,
  seen_count: 1,
  confidence_score: null,
  confidence_breakdown: null,
  confidence_summary: null,
  duplicate_of_job_id: null,
  duplicate_reason: "",
} satisfies Job;

const facts: CandidateFact[] = [
  { id: 1, category: "Experience", context: "Verified job", claim: "Built a Figma component library.", skills: JSON.stringify(["Figma"]), verified: 1, created_at: "2026-01-01" },
  { id: 2, category: "Experience", context: "Unverified job", claim: "Claim that must not appear.", skills: "[]", verified: 0, created_at: "2026-01-01" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildResumeContent", () => {
  it("uses verified facts and excludes unsupported claims", () => {
    const content = buildResumeContent(job, profile, facts);
    expect(content.facts.map((fact) => fact.claim)).toContain("Built a Figma component library.");
    expect(content.facts.map((fact) => fact.claim)).not.toContain("Claim that must not appear.");
    expect(content.audit.unsupportedKeywords).toContain("strategy");
    expect(content.skillCategories?.[0]).toEqual({ name: "Product Design", skills: ["Figma", "Research"] });
    expect(content.skillCategories?.flatMap((category) => category.skills)).toContain("Research");
  });

  it("preserves traditional sections and joins wrapped achievement lines", () => {
    const sections = parseResumeSections([
      "EXPERIENCE",
      "Product Designer | Example",
      "2022 - Present",
      "●",
      "Increased completion by 48% by designing a trust-focused",
      "account connection experience across the product.",
      "●",
      "Streamlined design-to-code handoff across the team.",
      "EDUCATION",
      "BFA Interaction Design | Example University",
    ].join("\n"), profile);
    expect(sections.map((section) => section.title)).toEqual(["PROFESSIONAL EXPERIENCE", "EDUCATION"]);
    expect(sections[0].lines.some((line) => line.text.includes("trust-focused account connection"))).toBe(true);
    expect(sections[0].lines.some((line) => line.text === "●")).toBe(false);
    expect(sections[0].lines.filter((line) => line.kind === "bullet")).toHaveLength(2);
  });

  it("adds a confirmed keyword once and places it in a meaningful category", () => {
    const original = buildResumeContent(job, profile, facts);
    const updated = addResumeKeyword(original, "Enterprise");
    const repeated = addResumeKeyword(updated, "enterprise");
    expect(repeated.skills.filter((skill) => skill.toLowerCase() === "enterprise")).toHaveLength(1);
    expect(isHighlightedKeyword(repeated, "Enterprise")).toBe(true);
    expect(repeated.skillCategories?.find((category) => category.name === "Product and Strategy")?.skills).toContain("Enterprise");
    expect(repeated.audit.unsupportedKeywords).not.toContain("enterprise");
  });

  it("lets local AI rank skills without separating role headers from achievements", () => {
    const original = buildResumeContent(job, {
      ...profile,
      base_resume_text: [
        "EXPERIENCE",
        "Product Designer | Current Company | 2024 - Present",
        "• Increased completion by 48%.",
        "Product Designer | Previous Company | 2022 - 2024",
        "• Built a design system.",
      ].join("\n"),
    }, facts);
    const updated = applyResumeRanking(original, { skillOrder: ["Research", "Figma"] });
    expect(updated.skills.slice(0, 2)).toEqual(["Research", "Figma"]);
    expect(updated.sections).toEqual(original.sections);
  });

  it("returns an evidence-bound bullet rewrite without changing numeric claims", async () => {
    const content = buildResumeContent(job, {
      ...profile,
      base_resume_text: [
        "EXPERIENCE",
        "Product Designer | Example | 2022 - Present",
        "• Led cross-functional design reviews that increased completion by 48%.",
      ].join("\n"),
    }, []);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      response: JSON.stringify({
        supported: true,
        candidateId: "section-0-line-1",
        suggestedBullet: "Demonstrated leadership through cross-functional design reviews that increased completion by 48%.",
        reason: "The original bullet already shows leadership through leading cross-functional reviews.",
      }),
    }), { status: 200 })));

    const suggestion = await suggestResumeBulletWithOllama(content, job, "leadership", "test-model");
    expect(suggestion.supported).toBe(true);
    expect(suggestion.originalBullet).toContain("48%");
    expect(suggestion.suggestedBullet).toContain("leadership");
    expect(suggestion.suggestedBullet).toContain("48%");
  });

  it("rewrites the summary using a candidate-confirmed truth note", async () => {
    const content = buildResumeContent(job, profile, []);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      response: JSON.stringify({
        supported: true,
        candidateId: "summary",
        suggestedBullet: "Product Designer building trust-critical B2B and enterprise products at high-growth startups.",
        reason: "The candidate confirmed that the products served B2B2C customers.",
      }),
    }), { status: 200 })));

    const suggestion = await suggestResumeBulletWithOllama(
      content,
      job,
      "enterprise",
      "test-model",
      { kind: "summary" },
      "My last two products served B2B2C customers.",
    );
    expect(suggestion.supported).toBe(true);
    expect(suggestion.targetKind).toBe("summary");
    expect(suggestion.sectionTitle).toBe("SUMMARY");
    expect(suggestion.suggestedBullet).toContain("enterprise");
  });

  it("blocks a suggested rewrite that invents a new metric", async () => {
    const content = buildResumeContent(job, {
      ...profile,
      base_resume_text: [
        "EXPERIENCE",
        "Product Designer | Example | 2022 - Present",
        "• Led design reviews that increased completion by 48%.",
      ].join("\n"),
    }, []);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      response: JSON.stringify({
        supported: true,
        candidateId: "section-0-line-1",
        suggestedBullet: "Demonstrated leadership through design reviews that increased completion by 72%.",
        reason: "Reframed the existing work.",
      }),
    }), { status: 200 })));

    await expect(suggestResumeBulletWithOllama(content, job, "leadership", "test-model"))
      .rejects.toThrow("changed a numeric claim");
  });

  it("splits legacy category text and places job-description skills first", () => {
    const skills = normalizeResumeSkills([
      "TypeScript",
      "Figma",
      "AI & Tools: Claude Code, Codex",
      "Notion",
    ]);
    const categories = categorizeResumeSkills(skills, "We need a designer fluent in Figma and Codex.");
    expect(skills).toEqual(["TypeScript", "Figma", "Claude Code", "Codex", "Notion"]);
    expect(categories[0]).toEqual({ name: "Product Design", skills: ["Figma"] });
    expect(categories.find((category) => category.name === "AI Tools")?.skills).toEqual(["Codex", "Claude Code"]);
  });

  it("preserves custom category order and removes duplicate skills from later categories", () => {
    const content = buildResumeContent(job, profile, facts);
    content.skillCategories = [
      { name: "Developer Tools", skills: ["Git", "TypeScript"] },
      { name: "Frontend", skills: ["TypeScript", "React"] },
    ];
    expect(resumeSkillCategories(content)).toEqual([
      { name: "Developer Tools", skills: ["Git", "TypeScript"] },
      { name: "Frontend", skills: ["React"] },
    ]);
  });

  it("exports accurate metadata without generator fingerprints", async () => {
    const content = buildResumeContent(job, profile, facts);
    const [pdf, docx] = await Promise.all([generatePdf(content), generateDocx(content)]);

    const pdfSource = pdf.toString("latin1");
    expect(pdfSource).not.toContain("PDFKit");
    expect(pdfSource).toContain("Test Candidate Resume");
    expect(pdfSource).toContain("Test Candidate");
    expect(pdfSource).toContain("Resume");

    const coreProperties = readZipEntry(docx, "docProps/core.xml");
    const applicationProperties = readZipEntry(docx, "docProps/app.xml");
    expect(coreProperties).toContain("<dc:title>Test Candidate Resume</dc:title>");
    expect(coreProperties).toContain("<dc:subject>Resume</dc:subject>");
    expect(coreProperties).toContain("<dc:creator>Test Candidate</dc:creator>");
    expect(coreProperties).toContain("<cp:lastModifiedBy>Test Candidate</cp:lastModifiedBy>");
    expect(coreProperties).toContain("<cp:revision>1</cp:revision>");
    expect(coreProperties).not.toContain("Un-named");
    expect(applicationProperties).not.toContain("Microsoft Word");
    expect(applicationProperties).not.toContain("Scout");
  });
});
