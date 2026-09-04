import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deterministicCoverLetter,
  generateCoverLetterDraft,
  generateCoverLetterPdf,
} from "@/lib/cover-letter";
import type { Job, ResumeContent } from "@/lib/types";

const job = {
  id: 1,
  source_id: 1,
  source_name: "Example",
  source_type: "ashby",
  external_id: "example-role",
  company: "Example Health",
  title: "Product Designer",
  location: "Remote, United States",
  workplace_type: "remote",
  employment_type: "Full time",
  salary_min: null,
  salary_max: null,
  salary_currency: "",
  description: "Our mission is to make complex healthcare decisions easier for families. You will lead user research, improve complex workflows, and maintain our design system in close partnership with engineering.",
  canonical_url: "",
  apply_url: "",
  posted_at: null,
  first_seen_at: "2026-08-01",
  last_seen_at: "2026-08-01",
  status: "shortlisted",
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

const resume = {
  candidateName: "Test Candidate",
  contactLine: "candidate@example.com | New Orleans, LA",
  targetTitle: "Product Designer",
  summary: "Product Designer with five years building trust-critical, data-dense products.",
  skills: ["Figma", "User Research"],
  facts: [],
  sections: [{
    title: "PROFESSIONAL EXPERIENCE",
    lines: [
      { kind: "entry", text: "Product Designer | Example" },
      { kind: "bullet", text: "Reduced user confusion by designing source attribution across 15 profile fields." },
      { kind: "bullet", text: "Built a 120-component design system used across web and mobile." },
    ],
  }],
  audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] },
} satisfies ResumeContent;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cover letter generation", () => {
  it("creates a factual company-specific fallback", () => {
    const draft = deterministicCoverLetter(job, resume);
    expect(draft.content).toContain("Dear Example Health team");
    expect(draft.content).toContain("make complex healthcare decisions easier");
    expect(draft.content).toContain("15 profile fields");
    expect(draft.content).not.toContain("\u2014");
    expect(draft.evidence.roleSignals).toContain("user research");
  });

  it("accepts a concise local AI draft grounded in resume evidence", async () => {
    const generated = [
      "Dear Example Health team,",
      "I am interested in the Product Designer role because making complex healthcare decisions easier for families is a clear and meaningful product problem. The focus on research and understandable workflows is especially relevant to the kind of work I have chosen throughout my career.",
      "In my recent work, I reduced user confusion by designing source attribution across 15 profile fields. I also built a 120-component design system used across web and mobile. Both projects required close collaboration with engineering, careful attention to how people interpret dense information, and a willingness to test the details rather than rely on assumptions.",
      "I would bring that same approach to Example Health: start with the user problem, make the underlying complexity legible, and stay involved through implementation. I would welcome a conversation about the product challenges the team is working through and how my background could contribute.",
      "Best,\nTest Candidate",
    ].join("\n\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      response: JSON.stringify({ content: generated }),
    }), { status: 200 })));
    const draft = await generateCoverLetterDraft(job, resume, true);
    expect(draft.content).toBe(generated);
    expect(draft.method).toContain("Draft written by");
  });

  it("rejects fabricated metrics and returns the factual fallback", async () => {
    const generated = `Dear Example Health team,\n\nI improved conversion by 99% and would bring that result to Example Health. ${"This unsupported claim should not be accepted. ".repeat(35)}\n\nBest,\nTest Candidate`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      response: JSON.stringify({ content: generated }),
    }), { status: 200 })));
    const draft = await generateCoverLetterDraft(job, resume, true);
    expect(draft.method).toContain("Structured fallback");
    expect(draft.content).not.toContain("99%");
  });

  it("exports a PDF without generator metadata", async () => {
    const draft = deterministicCoverLetter(job, resume);
    const pdf = await generateCoverLetterPdf(
      draft.content,
      resume.candidateName,
      resume.contactLine,
      job.company,
      "2026-08-05T12:00:00Z",
    );
    const source = pdf.toString("latin1");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(source).not.toContain("PDFKit");
    expect(source).toContain("Test Candidate");
  });
});

describe("cover letter evidence quality", () => {
  function jobWith(description: string, company = "Sunset"): Job {
    return { ...job, company, description };
  }

  it("quotes a company sentence rather than a responsibility line", () => {
    const draft = deterministicCoverLetter(
      jobWith("You will improve the path from setup instructions and permissions through recovery. At its core, Sunset was founded to help founders."),
      resume,
    );
    expect(draft.evidence.mission).toContain("founded to help founders");
    expect(draft.evidence.mission).not.toContain("You will");
    expect(draft.content).not.toContain("was You will");
  });

  it("drops a section heading that runs into the sentence", () => {
    const draft = deterministicCoverLetter(
      jobWith("ABOUT SUNSET At its core, Sunset was founded to help founders."),
      resume,
    );
    expect(draft.evidence.mission.startsWith("At its core")).toBe(true);
  });

  it("does not claim a theme the posting mentions only once in passing", () => {
    const draft = deterministicCoverLetter(
      jobWith("We build AI products. Prototyping AI products quickly matters. Our AI products team prototypes daily. Financial details are discussed at offer stage."),
      resume,
    );
    expect(draft.evidence.roleSignals).toContain("AI products");
    expect(draft.evidence.roleSignals).not.toContain("financial products");
  });
});
