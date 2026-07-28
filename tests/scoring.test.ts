import { describe, expect, it } from "vitest";
import { scoreJob, scorePostingConfidence } from "@/lib/scoring";
import type { CandidateProfile, Job } from "@/lib/types";

const profile: CandidateProfile = {
  id: 1,
  full_name: "Test Candidate",
  email: "candidate@example.com",
  phone: "",
  home_location: "Chicago, IL",
  professional_summary: "Product designer",
  base_resume_text: "",
  target_titles: JSON.stringify(["Product Designer"]),
  target_seniority: "senior",
  skills: JSON.stringify(["Figma", "User research", "Design systems"]),
  preferred_locations: JSON.stringify(["Chicago"]),
  workplace_preferences: JSON.stringify(["remote", "hybrid"]),
  minimum_salary: 100000,
  work_authorization: "Authorized",
  sponsorship_required: 0,
  years_experience: 7,
  portfolio_url: "",
  linkedin_url: "",
  github_url: "",
  onboarding_complete: 1,
  updated_at: new Date().toISOString(),
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    source_id: 1,
    source_name: "Example",
    source_type: "greenhouse",
    external_id: "one",
    company: "Example",
    title: "Senior Product Designer",
    location: "Chicago, IL",
    workplace_type: "hybrid",
    employment_type: "Full-time",
    salary_min: 110000,
    salary_max: 140000,
    salary_currency: "USD",
    description: "Use Figma, user research, and design systems to improve our product.",
    canonical_url: "https://example.com/job",
    apply_url: "https://example.com/job",
    posted_at: new Date().toISOString(),
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    status: "discovered",
    score: null,
    hard_filter_pass: null,
    score_breakdown: null,
    match_summary: null,
    seen_count: 1,
    confidence_score: null,
    confidence_breakdown: null,
    confidence_summary: null,
    ...overrides,
  };
}

describe("scoreJob", () => {
  it("scores a strong aligned role highly", () => {
    const result = scoreJob(job(), profile);
    expect(result.hardFilterPass).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.matchingSkills).toHaveLength(3);
  });

  it("explains a sponsorship hard filter", () => {
    const result = scoreJob(job({ description: "Applicants must work without sponsorship." }), { ...profile, sponsorship_required: 1 });
    expect(result.hardFilterPass).toBe(false);
    expect(result.hardFilterReasons[0]).toContain("sponsorship");
  });

  it("does not hide location mismatch reasoning", () => {
    const result = scoreJob(job({ location: "Austin, TX", workplace_type: "on-site" }), profile);
    expect(result.hardFilterPass).toBe(false);
    expect(result.hardFilterReasons.join(" ")).toContain("location");
  });

  it("strictly rejects unrelated, senior, foreign, and overqualified roles", () => {
    const strictProfile = {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      years_experience: 5,
      preferred_locations: JSON.stringify(["United States", "Boston"]),
    };
    const preferences = { usaOnly: true, minimumExperience: 2, maximumExperience: 5 };
    expect(scoreJob(job({ title: "Staff Product Designer" }), strictProfile, preferences).hardFilterPass).toBe(false);
    expect(scoreJob(job({ title: "Software Engineer" }), strictProfile, preferences).hardFilterPass).toBe(false);
    expect(scoreJob(job({ title: "Product Designer", location: "Sao Paulo, Brazil" }), strictProfile, preferences).hardFilterPass).toBe(false);
    expect(scoreJob(job({
      title: "Product Designer",
      description: "Required qualifications include 7+ years of relevant experience.",
    }), strictProfile, preferences).hardFilterPass).toBe(false);
  });

  it("accepts a US mid-level product design role requiring two to five years", () => {
    const result = scoreJob(job({
      title: "Product Designer II",
      location: "Remote - United States",
      description: "Required qualifications include 3 to 5 years of relevant experience using Figma.",
    }), {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5 });
    expect(result.hardFilterPass).toBe(true);
  });

  it("recognizes a US restriction near the end of a long description", () => {
    const result = scoreJob(job({
      title: "Product Designer",
      location: "Remote",
      description: `${"Product design collaboration and delivery. ".repeat(100)}
        Required qualifications include 3 years of relevant experience.
        This role is remote within the United States.`,
    }), {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5 });
    expect(result.hardFilterPass).toBe(true);
  });

  it("accepts any US state when the candidate selected United States", () => {
    const result = scoreJob(job({
      title: "Product Designer",
      location: "Portland, Oregon",
      workplace_type: "on-site",
      description: "Required qualifications include 4 years of relevant product design experience.",
    }), {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5 });
    expect(result.hardFilterPass).toBe(true);
  });

  it("treats salary as a ranking preference instead of a hard rejection", () => {
    const result = scoreJob(job({
      title: "Product Designer",
      location: "Remote, United States",
      salary_min: 80000,
      salary_max: 90000,
      description: "Required qualifications include 3 years of relevant product design experience.",
    }), {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      preferred_locations: JSON.stringify(["United States"]),
      minimum_salary: 120000,
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5 });
    expect(result.hardFilterPass).toBe(true);
    expect(result.compensation).toBe(0);
  });
});

describe("scorePostingConfidence", () => {
  it("keeps confidence separate and explains limited history", () => {
    const result = scorePostingConfidence(job(), 1);
    expect(result.total).toBeGreaterThan(0);
    expect(result.dataSufficiency).not.toBe("high");
    expect(result.cautionSignals.join(" ")).toContain("history");
  });

  it("increases evidence after repeated healthy sightings", () => {
    const first = scorePostingConfidence(job(), 1);
    const repeated = scorePostingConfidence(job({ seen_count: 4 }), 5);
    expect(repeated.total).toBeGreaterThan(first.total);
    expect(repeated.positiveSignals.join(" ")).toContain("collection runs");
  });
});
