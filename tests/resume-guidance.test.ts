import { describe, expect, it } from "vitest";
import {
  appendResumeChange,
  ensureResumeBlockIds,
  removeResumeSection,
  replaceResumeBlockText,
  stripResumeBulletPrefix,
  undoLastResumeChange,
} from "@/lib/resume-blocks";
import { planProactiveResumeSuggestions } from "@/lib/resume-suggestions";
import { deterministicResumeSuggestion } from "@/lib/local-ai";
import type { CandidateFact, Job, ResumeContent } from "@/lib/types";

const content: ResumeContent = {
  candidateName: "Candidate",
  contactLine: "candidate@example.com",
  targetTitle: "Product Designer",
  summary: "Product Designer with five years building data-dense products at high-growth startups.",
  skills: ["Figma", "Research", "analytics"],
  facts: [],
  sections: [{
    title: "PROFESSIONAL EXPERIENCE",
    lines: [
      { text: "UX Designer, Community Lab | 2023 - 2024", kind: "entry" },
      { text: "Applied heatmap analysis, rage-click tracking, and A/B testing to improve navigation.", kind: "bullet" },
      { text: "Built and governed a 120-component design system across web and mobile.", kind: "bullet" },
      { text: "Partnered cross-functionally with engineering to ship product improvements.", kind: "bullet" },
    ],
  }],
  audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] },
};

const job = {
  title: "Product Designer",
  description: "Use analytics, SaaS product experience, design systems, and collaboration to improve workflows.",
} as Job;

const facts: CandidateFact[] = [{
  id: 10,
  category: "Career context",
  context: "Candidate verified",
  claim: "Worked exclusively on SaaS products at high-growth startups.",
  skills: JSON.stringify(["SaaS"]),
  verified: 1,
  scope_type: "career",
  scope_key: "",
  created_at: "2026-08-13",
}];

describe("resume guidance", () => {
  it("assigns stable IDs to resume passages", () => {
    const first = ensureResumeBlockIds(content);
    const second = ensureResumeBlockIds(first);
    expect(first.summaryBlockId).toBeTruthy();
    expect(first.sections?.[0].lines.every((line) => Boolean(line.id))).toBe(true);
    expect(second).toEqual(first);
  });

  it("returns no more than three evidence-ranked suggestions", () => {
    const plans = planProactiveResumeSuggestions(content, job, facts, 3);
    expect(plans).toHaveLength(3);
    expect(plans[0]).toMatchObject({ keyword: "SaaS", target: { kind: "summary" } });
    expect(plans.map((plan) => plan.keyword)).toContain("analytics");
    expect(new Set(plans.map((plan) => plan.blockId)).size).toBe(plans.length);
  });

  it("still suggests a narrative rewrite when a keyword exists only in Skills", () => {
    const plans = planProactiveResumeSuggestions(content, job, facts, 3);
    expect(plans.map((plan) => plan.keyword)).toContain("analytics");
  });

  it("accepts and safely undoes a job-only passage change", () => {
    const prepared = ensureResumeBlockIds(content);
    const blockId = prepared.sections?.[0].lines[1].id || "";
    const acceptedText = "Applied heatmap analytics, rage-click tracking, and A/B testing to improve navigation.";
    const changed = appendResumeChange(replaceResumeBlockText(prepared, blockId, acceptedText), {
      id: "change-one",
      blockId,
      keyword: "analytics",
      originalText: prepared.sections?.[0].lines[1].text || "",
      acceptedText,
      createdAt: "2026-08-13T00:00:00.000Z",
      source: "guided",
    });
    const undone = undoLastResumeChange(changed);
    expect(undone.undone?.keyword).toBe("analytics");
    expect(undone.content.sections?.[0].lines[1].text).toBe(content.sections?.[0].lines[1].text);
    expect(undone.content.changeHistory).toEqual([]);
  });

  it("uses safe deterministic terminology changes when local AI is unavailable", () => {
    const prepared = ensureResumeBlockIds(content);
    const suggestion = deterministicResumeSuggestion(prepared, "analytics", {
      kind: "line",
      sectionIndex: 0,
      lineIndex: 1,
    });
    expect(suggestion?.suggestedBullet).toContain("heatmap analytics");
    expect(suggestion?.suggestedBullet).toContain("A/B testing");
  });

  it("removes a stored text prefix when a real bullet marker is rendered", () => {
    expect(stripResumeBulletPrefix("- Improved completion by 23%.")).toBe("Improved completion by 23%.");
    expect(stripResumeBulletPrefix("• Improved completion by 23%.")).toBe("Improved completion by 23%.");
    expect(stripResumeBulletPrefix("Improved completion by 23%.")).toBe("Improved completion by 23%.");
  });

  it("removes legacy Scout-generated sections and lets the user delete a section", () => {
    const prepared = ensureResumeBlockIds({
      ...content,
      sections: [
        ...(content.sections || []),
        {
          title: "ADDITIONAL VERIFIED HIGHLIGHTS",
          lines: [{ text: "Worked exclusively on SaaS products.", kind: "bullet" }],
        },
      ],
    });
    expect(prepared.sections?.some((section) => section.title === "ADDITIONAL VERIFIED HIGHLIGHTS")).toBe(false);
    const sectionId = prepared.sections?.[0].id || "";
    expect(removeResumeSection(prepared, sectionId).sections).toEqual([]);
  });
});
